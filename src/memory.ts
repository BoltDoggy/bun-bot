/**
 * memory.ts — 记忆读写（P0 + P2-2 任务模式 + P2-3 预算告警 + P2-4 checkpoint + P4 通用化）
 *
 * 数据（P4-4：默认移入 .bunbot/ 目录，不污染目标仓库 git status）：
 *   .bunbot/AGENT_STATE.json        机器可读状态（决策 / 踩坑 / TODO / 上次任务 / 当前任务计划 / 上下文预算告警）
 *   .bunbot/MEMORY.md               人类可读版，由 AGENT_STATE.json 同步生成
 *   .bunbot/AGENT_CHECKPOINT.json   会话级 checkpoint（--resume 断点续跑）：当前会话的消息历史
 *   .bunbot/AUDIT.log.jsonl         审计日志（P3-4，src/audit.ts）
 *   目录名可用 .bunbot.json 的 stateDir 配置（默认 .bunbot），环境变量 > 配置 > 默认。
 *   写状态文件前自动确保目录存在 + .gitignore 追加忽略（幂等）。
 *
 * P2-2 任务模式：AgentState.activePlan 持久化当前任务的 plan（首轮产出、逐项勾选），
 *               进度跨会话保存 —— 中断/重启后可从上次断点继续（checkpoint 的目标锚点）。
 * P2-3 上下文预算：AgentState.contextWarnings 记录每次超限压缩告警（保留最近 10 条），
 *               重启后 [记忆] 区块可见 —— agent 能感知长任务触发了多少次压缩。
 * P2-4 --resume checkpoint：把当前会话的消息历史（不含 system）落盘 AGENT_CHECKPOINT.json，
 *               每次消息变更即保存；--resume 启动时加载历史、重建 system 提示词继续跑，
 *               任务正常完成时清除。与 activePlan（任务级锚点）互补：checkpoint 是会话级
 *               全量上下文恢复，中断（Ctrl+C / 超迭代 / 崩溃）后不丢已执行的步骤。
 * P4-9 大项目上下文加载：buildFileTree 感知 .gitignore（+ 扩展忽略 vendor/target/
 *               __pycache__/.venv 等）+ 行数预算化截断（超限提示按需 list_dir）——
 *               大 monorepo / 大依赖目录不会撑爆系统提示词。
 *
 * 注意：状态文件都在 .gitignore 中（每次会话写回会产生噪音），仅本地持久化，不纳入版本控制。
 *
 * 项目级指令：
 *   AGENTS.md         可选。项目根目录的 agent 指令文件（多 agent 工具链通用命名，
 *                     类似 CLAUDE.md 的通用约定），存在时由 loadProjectContext 加载，
 *                     优先级高于 README / docs。
 *
 * 工作区：默认 process.cwd()，可用环境变量 BUN_BOT_WORKSPACE 覆盖（便于测试沙箱）。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ChatMessage } from "./budget";
import { loadConfig } from "./config";

export const STATE_FILE = "AGENT_STATE.json";
export const MEMORY_FILE = "MEMORY.md";
/** 会话级 checkpoint 文件（--resume 断点续跑的消息历史） */
export const CHECKPOINT_FILE = "AGENT_CHECKPOINT.json";
/** 项目级指令文件（多 agent 工具链通用约定，唯一命名） */
export const AGENTS_FILE = "AGENTS.md";

/** 当前工作区根目录（agent 可以读写的地方） */
export function workspace(): string {
  return process.env.BUN_BOT_WORKSPACE || process.cwd();
}

/** 状态目录（P4-4：默认 .bunbot/，可 .bunbot.json 的 stateDir 配置） */
export function stateDir(): string {
  return join(workspace(), loadConfig(workspace()).stateDir);
}

/** 确保状态目录存在（写状态文件前调用） */
export function ensureStateDir(): void {
  mkdirSync(stateDir(), { recursive: true });
}

/**
 * 确保状态目录被 .gitignore 忽略（P4-4：不污染用户仓库 git status）。
 * 幂等：.gitignore 已包含该目录则不动；非 git 仓库（无 .git 且无 .gitignore）静默跳过。
 */
export function ensureStateIgnored(): void {
  const base = workspace();
  const dir = loadConfig(base).stateDir;
  const gi = join(base, ".gitignore");
  if (!existsSync(join(base, ".git")) && !existsSync(gi)) return;
  try {
    const existing = existsSync(gi) ? readFileSync(gi, "utf8") : "";
    const line = (dir.endsWith("/") ? dir : dir + "/");
    if (existing.split("\n").some((l) => l.trim() === line.trim())) return;
    const sep = existing === "" || existing.endsWith("\n") ? "" : "\n";
    writeFileSync(gi, existing + sep + "# bun-bot 状态目录（本地持久化，不纳入版本控制）\n" + line + "\n", "utf8");
  } catch {
    // 写失败不致命：状态文件仍可用，只是可能出现在 git status
  }
}

export function statePath(): string {
  return join(stateDir(), STATE_FILE);
}

export function memoryPath(): string {
  return join(stateDir(), MEMORY_FILE);
}

export function checkpointPath(): string {
  return join(stateDir(), CHECKPOINT_FILE);
}

export interface Decision {
  when: string;
  what: string;
  why: string;
}

/** 任务计划条目（P2-2）：text 是步骤描述，done 是否完成，detail 记录验证结果 */
export interface PlanItem {
  text: string;
  done: boolean;
  detail?: string;
}

/** 当前任务计划（P2-2）：持久化在 AGENT_STATE.json，跨会话续跑不丢目标 */
export interface ActivePlan {
  title: string;
  createdAt: string;
  updatedAt: string;
  items: PlanItem[];
  /** active=进行中 / done=全部勾选完成 / aborted=中断放弃 */
  status: "active" | "done" | "aborted";
}

export interface AgentState {
  version: number;
  lastTask: string;      // 上次任务的描述
  lastSummary: string;   // 上次任务的结论（agent 的最终回复）
  lastRunAt: string;     // 上次运行结束时间（ISO）
  decisions: Decision[]; // 关键决策记录
  pitfalls: string[];    // 踩过的坑
  todo: string[];        // 待办
  contextWarnings: string[]; // 上下文预算告警（P2-3：超限压缩记录，保留最近 10 条）
  activePlan?: ActivePlan;   // 当前任务计划（P2-2 任务模式）
}

export const DEFAULT_STATE: AgentState = {
  version: 1,
  lastTask: "",
  lastSummary: "",
  lastRunAt: "",
  decisions: [],
  pitfalls: [],
  todo: [],
  contextWarnings: [],
  activePlan: undefined,
};

/** 读取指定路径的 AGENT_STATE.json；状态文件不存在或损坏时返回 null */
function readStateAt(p: string): AgentState | null {
  try {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<AgentState>;
      return { ...DEFAULT_STATE, ...raw };
    }
  } catch (e) {
    console.error("[memory] 读取 " + p + " 失败，使用默认态: " + e);
  }
  return null;
}

/**
 * 读取 AGENT_STATE.json（.bunbot/ 状态目录下）；文件不存在或损坏时返回默认态。
 */
export function loadState(): AgentState {
  return readStateAt(statePath()) ?? { ...DEFAULT_STATE };
}

/** 写回 AGENT_STATE.json（写前确保目录存在 + .gitignore 忽略） */
export function saveState(state: AgentState): void {
  ensureStateDir();
  ensureStateIgnored();
  writeFileSync(statePath(), JSON.stringify(state, null, 2) + "\n", "utf8");
}

/** 由 AGENT_STATE.json 同步生成人类可读的 MEMORY.md */
export function syncMemoryFile(state: AgentState): void {
  const b: string[] = [];
  b.push("# agent 记忆（人类可读版）");
  b.push("");
  b.push("> 自动生成自 `AGENT_STATE.json`。改这里不会回写，长期修改请编辑 JSON 后重跑同步。");
  b.push("");
  b.push("## 上次任务");
  b.push("");
  b.push(state.lastTask || "（暂无）");
  if (state.lastSummary) {
    b.push("");
    b.push("**结论**：" + state.lastSummary);
  }
  if (state.lastRunAt) {
    b.push("");
    b.push("**结束于**：" + state.lastRunAt);
  }
  b.push("");
  b.push("## 决策记录");
  b.push("");
  if (!state.decisions.length) b.push("（暂无）");
  for (const d of state.decisions) {
    b.push("- **" + d.when + "** · " + d.what);
    if (d.why) b.push("  - 原因：" + d.why);
  }
  b.push("");
  b.push("## 踩坑");
  b.push("");
  if (!state.pitfalls.length) b.push("（暂无）");
  for (const p of state.pitfalls) b.push("- " + p);
  b.push("");
  b.push("## TODO");
  b.push("");
  if (!state.todo.length) b.push("（暂无）");
  for (const t of state.todo) b.push("- [ ] " + t);
  // P2-2 任务模式：当前任务计划（中断/重启后从 [记忆] 可见进度）
  if (state.activePlan) {
    const total = state.activePlan.items.length;
    const done = state.activePlan.items.filter((it) => it.done).length;
    b.push("");
    b.push("## 当前任务计划");
    b.push("");
    b.push("**" + state.activePlan.title + "**（" + done + "/" + total + " 完成" +
      (state.activePlan.status === "done" ? " ✅" : " ⏳") + "）");
    for (const it of state.activePlan.items) {
      b.push("- [" + (it.done ? "x" : " ") + "] " + it.text + (it.detail ? "（" + it.detail + "）" : ""));
    }
  }
  // P2-3 上下文预算：超限压缩告警（重启后 agent 能感知长任务触发过多少次压缩）
  if (state.contextWarnings.length) {
    b.push("");
    b.push("## 上下文预算告警");
    b.push("");
    for (const w of state.contextWarnings) b.push("- " + w);
  }
  ensureStateDir();
  ensureStateIgnored();
  writeFileSync(memoryPath(), b.join("\n") + "\n", "utf8");
}

// ---------- checkpoint（P2-4：--resume 会话级断点续跑） ----------

interface CheckpointData {
  savedAt: string;
  /** 会话消息历史（不含 system：恢复时用最新的 buildSystemPrompt 重建） */
  messages: ChatMessage[];
}

/**
 * 保存会话 checkpoint：把当前消息历史（不含 system）落盘 AGENT_CHECKPOINT.json。
 * 每次消息变更（assistant 回复 / 工具结果入队）后调用 —— 中断（Ctrl+C / 超迭代 / 崩溃）
 * 后 --resume 可恢复到最后一次消息变更的状态。
 * system 消息不存：恢复时 system 提示词用最新 buildSystemPrompt 重建
 * （state / project 可能已变，旧 system 会过时）。
 */
export function saveCheckpoint(messages: ChatMessage[]): void {
  const data: CheckpointData = {
    savedAt: new Date().toISOString(),
    messages: messages.filter((m) => m.role !== "system"),
  };
  ensureStateDir();
  ensureStateIgnored();
  writeFileSync(checkpointPath(), JSON.stringify(data, null, 2) + "\n", "utf8");
}

/**
 * 读取会话 checkpoint（.bunbot/ 状态目录下）；不存在或损坏时返回 null。
 */
export function loadCheckpoint(): ChatMessage[] | null {
  try {
    const p = checkpointPath();
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<CheckpointData>;
    if (!Array.isArray(raw.messages) || raw.messages.length === 0) return null;
    return raw.messages;
  } catch {
    return null;
  }
}

/** 清除会话 checkpoint（任务正常完成时调用，避免残留干扰下次运行） */
export function clearCheckpoint(): void {
  try {
    if (existsSync(checkpointPath())) rmSync(checkpointPath());
  } catch {
    // 清除失败不致命：下次 loadCheckpoint 读旧数据时会走 --resume 提示
  }
}

/**
 * 组装 --resume 恢复后的消息序列：checkpoint 历史 + （可选）新 task 追加。
 * 若历史以 role="tool" 结尾（中断发生在工具结果入队后、下一轮 assistant 回复前），
 * 补一条 user 消息保证对话结构合法 —— API 要求 tool 消息必须跟在 assistant
 * 的 tool_calls 之后，直接以 tool 结尾可能被拒。
 */
export function buildResumeMessages(checkpoint: ChatMessage[], newTask?: string): ChatMessage[] {
  const messages = checkpoint.map((m) => ({ ...m }));
  const last = messages[messages.length - 1];
  if (last && last.role === "tool") {
    messages.push({
      role: "user",
      content: "（checkpoint 恢复：对话在工具调用结果之后中断，请基于已有上下文继续执行当前任务。）",
    });
  }
  if (newTask && newTask.trim()) {
    messages.push({ role: "user", content: newTask });
  }
  return messages;
}

// ---------- 项目上下文 ----------

/** 常见忽略目录（P4-9 扩展：大依赖/构建产物目录不进文件树） */
const IGNORED_DIRS = new Set([
  ".git", "node_modules", "dist", "build", ".cache", "coverage",
  "vendor", "target", "__pycache__", ".venv", "venv",
  ".pytest_cache", ".mypy_cache", ".next", ".nuxt", ".turbo", ".docusaurus",
]);
const IGNORED_FILES = new Set([".DS_Store"]);

/**
 * 从 .gitignore 提取要忽略的目录名（P4-9：文件树感知 .gitignore）。
 * 只处理保守的目录形态：以 / 结尾（vendor/），或不含 /、*、!、. 的裸名
 * （如 vendor、dist —— 避免误伤 .env / *.log 这类文件规则）。
 */
export function gitignoreDirs(base: string): Set<string> {
  const dirs = new Set<string>();
  try {
    const gi = join(base, ".gitignore");
    if (!existsSync(gi)) return dirs;
    for (const line of readFileSync(gi, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      if (t.endsWith("/")) {
        dirs.add(t.slice(0, -1));
      } else if (!t.includes("/") && !t.includes("*") && !t.includes("!") && !t.includes(".")) {
        dirs.add(t);
      }
    }
  } catch {
    // .gitignore 不可读时按内置忽略处理
  }
  return dirs;
}

/**
 * 生成项目文件树（带缩进 + 文件大小）。
 * P4-9 大项目上下文加载：
 *   - 内置忽略 + .gitignore 感知（大依赖目录不进上下文）
 *   - 行数预算化截断（maxLines，默认 200）—— 超限提示"用 list_dir 按需查看"，
 *     大 monorepo 不会撑爆系统提示词。
 */
export function buildFileTree(
  maxDepth = 4,
  base = workspace(),
  opts: { maxLines?: number } = {},
): string {
  const ignoreDirs = gitignoreDirs(base);
  const maxLines = opts.maxLines ?? 200;
  const lines: string[] = [];
  let truncated = false;
  const walk = (dir: string, depth: number) => {
    if (lines.length >= maxLines) {
      truncated = true;
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    entries.sort((a, b) => a.localeCompare(b));
    const info = entries.map((e) => {
      try {
        return { name: e, dir: statSync(join(dir, e)).isDirectory() };
      } catch {
        return { name: e, dir: false };
      }
    });
    for (const e of info) {
      if (lines.length >= maxLines) {
        truncated = true;
        break;
      }
      if (e.dir && (IGNORED_DIRS.has(e.name) || ignoreDirs.has(e.name))) continue;
      if (!e.dir && IGNORED_FILES.has(e.name)) continue;
      const p = join(dir, e.name);
      let size = "";
      if (!e.dir) {
        try { size = " (" + statSync(p).size + " B)"; } catch {}
      }
      lines.push(" ".repeat(depth) + (e.dir ? "📁 " : "📄 ") + e.name + (e.dir ? "/" : size));
      if (e.dir && depth < maxDepth) walk(p, depth + 1);
    }
  };
  walk(base, 0);
  if (truncated) {
    lines.push("… [文件树过大，仅展示前 " + maxLines + " 行；大目录请用 list_dir 按需查看]");
  }
  return lines.join("\n");
}

export interface AgentDirective {
  /** 实际文件名：AGENTS.md */
  name: string;
  content: string;
}

/**
 * 读取项目级指令 AGENTS.md。
 * 存在时返回 { name, content }，不存在返回 null。
 * 指令优先级高于 README / docs：它是用户与 agent 之间的项目级契约。
 */
export function readAgentDirective(): AgentDirective | null {
  try {
    const p = join(workspace(), AGENTS_FILE);
    if (!existsSync(p)) return null;
    let content = readFileSync(p, "utf8");
    if (content.length > 8000) {
      content = content.slice(0, 8000) + "\n… [" + AGENTS_FILE + " 过长，仅展示前 8000 字符，需完整内容请 read_file]";
    }
    return { name: AGENTS_FILE, content };
  } catch {
    return null;
  }
}

/** 读取 README + docs 索引 + 文件树，组装项目认知（按需截断） */
export function loadProjectContext(): string {
  const parts: string[] = [];
  const readIf = (p: string, cap: number): string | null => {
    try {
      const content = readFileSync(p, "utf8");
      if (content.length > cap) return content.slice(0, cap) + "\n… [文件过长，仅展示前 " + cap + " 字符，需完整内容请 read_file]";
      return content;
    } catch {
      return null;
    }
  };
  // 项目级指令放在最前，优先级最高
  const agent = readAgentDirective();
  if (agent) parts.push("## " + agent.name + "（项目级指令，优先级最高）\n" + agent.content);
  const readme = readIf(join(workspace(), "README.md"), 8000);
  if (readme) parts.push("## README.md\n" + readme);
  const docsIdx = readIf(join(workspace(), "docs", "README.md"), 2000);
  if (docsIdx) parts.push("## docs/README.md\n" + docsIdx);
  const arch = readIf(join(workspace(), "docs", "ARCHITECTURE.md"), 4000);
  if (arch) parts.push("## docs/ARCHITECTURE.md\n" + arch);
  parts.push("## 项目文件树\n" + buildFileTree());
  return parts.join("\n\n");
}
