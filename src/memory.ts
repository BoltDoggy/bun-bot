/**
 * memory.ts — 记忆读写（P0）
 *
 * 数据：
 *   AGENT_STATE.json  机器可读状态（决策 / 踩坑 / TODO / 上次任务）
 *   MEMORY.md         人类可读版，由 AGENT_STATE.json 同步生成
 *
 * 注意：两个记忆文件在 .gitignore 中（每次会话写回会产生噪音），
 *       仅本地持久化，不纳入版本控制。
 *
 * 项目级指令：
 *   AGENTS.md         可选。项目根目录的 agent 指令文件（多 agent 工具链通用命名，
 *                     类似 CLAUDE.md 的通用约定），存在时由 loadProjectContext 加载，
 *                     优先级高于 README / docs。
 *                     兼容旧命名 AGENT.md：AGENTS.md 优先，缺失时回退 AGENT.md。
 *
 * 工作区：默认 process.cwd()，可用环境变量 BUN_BOT_WORKSPACE 覆盖（便于测试沙箱）。
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const STATE_FILE = "AGENT_STATE.json";
export const MEMORY_FILE = "MEMORY.md";
/** 主命名：AGENTS.md（多 agent 工具链通用约定） */
export const AGENTS_FILE = "AGENTS.md";
/** 兼容旧命名：AGENT.md（老项目可能已存在，AGENTS.md 缺失时回退） */
export const LEGACY_AGENT_FILE = "AGENT.md";

/** 当前工作区根目录（agent 可以读写的地方） */
export function workspace(): string {
  return process.env.BUN_BOT_WORKSPACE || process.cwd();
}

export function statePath(): string {
  return join(workspace(), STATE_FILE);
}

export function memoryPath(): string {
  return join(workspace(), MEMORY_FILE);
}

export interface Decision {
  when: string;
  what: string;
  why: string;
}

export interface AgentState {
  version: number;
  lastTask: string;      // 上次任务的描述
  lastSummary: string;   // 上次任务的结论（agent 的最终回复）
  lastRunAt: string;     // 上次运行结束时间（ISO）
  decisions: Decision[]; // 关键决策记录
  pitfalls: string[];    // 踩过的坑
  todo: string[];        // 待办
  contextWarnings: string[]; // 上下文预算告警（P2 用）
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
};

/** 读取 AGENT_STATE.json；文件不存在或损坏时返回默认态 */
export function loadState(): AgentState {
  try {
    if (existsSync(statePath())) {
      const raw = JSON.parse(readFileSync(statePath(), "utf8")) as Partial<AgentState>;
      return { ...DEFAULT_STATE, ...raw };
    }
  } catch (e) {
    console.error("[memory] 读取 " + STATE_FILE + " 失败，使用默认态: " + e);
  }
  return { ...DEFAULT_STATE };
}

/** 写回 AGENT_STATE.json */
export function saveState(state: AgentState): void {
  writeFileSync(statePath(), JSON.stringify(state, null, 2) + "\n", "utf8");
}

/** 由 AGENT_STATE.json 同步生成人类可读的 MEMORY.md */
export function syncMemoryFile(state: AgentState): void {
  const b: string[] = [];
  b.push("# bun-bot 记忆（人类可读版）");
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
  writeFileSync(memoryPath(), b.join("\n") + "\n", "utf8");
}

// ---------- 项目上下文 ----------

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".cache", "coverage"]);
const IGNORED_FILES = new Set([".DS_Store"]);

/** 生成项目文件树（带缩进 + 文件大小） */
export function buildFileTree(maxDepth = 4, base = workspace()): string {
  const lines: string[] = [];
  const walk = (dir: string, depth: number) => {
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
      if (e.dir && IGNORED_DIRS.has(e.name)) continue;
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
  return lines.join("\n");
}

export interface AgentDirective {
  /** 实际文件名：AGENTS.md（主）或 AGENT.md（兼容回退） */
  name: string;
  content: string;
}

/**
 * 读取项目级指令（AGENTS.md 优先，缺失时回退 AGENT.md 兼容旧项目）。
 * 存在时返回 { name, content }，不存在返回 null。
 * 指令优先级高于 README / docs：它是用户与 agent 之间的项目级契约。
 */
export function readAgentDirective(): AgentDirective | null {
  const candidates = [AGENTS_FILE, LEGACY_AGENT_FILE];
  for (const name of candidates) {
    try {
      const p = join(workspace(), name);
      if (!existsSync(p)) continue;
      let content = readFileSync(p, "utf8");
      if (content.length > 8000) {
        content = content.slice(0, 8000) + "\n… [" + name + " 过长，仅展示前 8000 字符，需完整内容请 read_file]";
      }
      return { name, content };
    } catch {
      // 尝试下一个候选
    }
  }
  return null;
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
  // 项目级指令放在最前，优先级最高（AGENTS.md 主命名，兼容 AGENT.md）
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
