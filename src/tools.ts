/**
 * tools.ts — 工具定义与执行器（注册表模式，P1 + P2-2 任务模式 + P3-1/3-3 安全）
 *
 * 工具清单：
 *   run_script  用 Bun 运行 JS/TS（cwd 可指定工作区，默认 tmpdir；超时可配；输出上限 64KB）
 *   read_file   读工作区文件，默认完整返回（64KB，可偏移续读）
 *   write_file  写工作区文件（自动 git 快照 + diff 摘要）
 *   list_dir    列目录（-a 显示隐藏文件、深度限制）
 *   run_bash    执行 shell 命令（cwd 可指定工作区）
 *   update_plan 更新任务计划（P2-2 任务模式：首轮产出 plan、逐项勾选，进度写回 AGENT_STATE.json）
 *
 * P2-1 ACI 化：所有工具的 description 均带 example usage（工具设计五原则之五——
 *              描述/spec 会进上下文，能直接引导工具调用行为；示例即 few-shot）。
 * P3-1 git 安全阀：run_bash 执行"写操作"命令前，若工作区有未提交改动先打快照
 *              （src/git.ts snapshotIfDirty），shell 直接改文件也可回滚。
 * P3-3 沙箱权限分级：路径（cwd / path）默认限制在工作区内（BUN_BOT_ALLOW_OUTSIDE_CWD=1
 *              可放行）；run_bash 危险命令黑名单（rm -rf /、git push、fork bomb 等）直接拒绝；
 *              BUN_BOT_PERMISSIONS=ask 时写操作命令需白名单（无人值守返回需确认提示）。
 *
 * 新增工具：往 registry 数组里加一个 { def, run } 即可，agent 就能看到并调用它。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, dirname } from "node:path";
import { workspace, loadState, saveState, syncMemoryFile } from "./memory";
import { loadConfig } from "./config";
import { snapshotIfDirty } from "./git";

export const DEFAULT_OUTPUT_LIMIT = 65536; // P1: 4K → 64KB，1M 上下文下完整回传
export const MAX_READ_BYTES = 1_000_000;   // read_file 单次读取硬上限
export const DEFAULT_TIMEOUT_MS = 30_000;

/** 输出截断：截断处带偏移信息，方便模型续读 */
export function clipOutput(s: string, limit = DEFAULT_OUTPUT_LIMIT): string {
  if (s.length <= limit) return s;
  return s.slice(0, limit) +
    "\n\n… [截断] 总共 " + s.length + " 字符，已返回 [0.." + limit + ")，" +
    "剩余 " + (s.length - limit) + " 字符可从偏移 " + limit + " 开始读取。";
}

// ---------- 路径与权限（P3-3 沙箱权限分级） ----------

/** 路径是否在工作区内（相对路径不越界） */
export function isInsideWorkspace(p: string, base = workspace()): boolean {
  const rel = relative(base, p);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * 解析工作区路径（相对/绝对均可）。P3-3：默认限制在工作区内 ——
 * 越界返回 null（调用方返回权限错误）；BUN_BOT_ALLOW_OUTSIDE_CWD=1 可放行。
 */
function resolveInWorkspace(p: string, base = workspace()): string | null {
  const abs = isAbsolute(p) ? p : resolve(base, p);
  if (!isInsideWorkspace(abs, base) && process.env.BUN_BOT_ALLOW_OUTSIDE_CWD !== "1") {
    return null;
  }
  return abs;
}

/** 越界提示（各工具共用） */
function outsideError(kind: string, p: string): string {
  return JSON.stringify({ error: kind + " 超出工作区（权限限制）: " + p + "（可用 BUN_BOT_ALLOW_OUTSIDE_CWD=1 放行，但不建议）" });
}

// P3-3：run_bash 危险命令黑名单 —— 命中直接拒绝（保守优先：宁可拒绝可用，不可放过危险）
const DANGEROUS_PATTERNS: RegExp[] = [
  /(^|[\s|;&])rm\s+(-[^\s]*)?\s+(\/|~|\.)/,               // rm -rf /、~、.（含 / 开头绝对路径 / ~ / . 前缀）
  /(^|[\s|;&])git\s+push(\s|$)/,                          // 推远程
  /(^|[\s|;&])git\s+reset\s+--hard/,                      // 丢改动（测试闸门内部自己用）
  /(^|[\s|;&])sudo(\s|$)/,
  /(^|[\s|;&])su(\s|$)/,
  /(^|[\s|;&])mkfs(\s|$)/,
  /(^|[\s|;&])shutdown(\s|$)/,
  /(^|[\s|;&])reboot(\s|$)/,
  /(^|[\s|;&])halt(\s|$)/,
  /(^|[\s|;&])chmod\s+-R/,                                // 递归改权限
  /(^|[\s|;&])chown\s+-R/,
  /(^|[\s|;&])dd\s+if=/,                                  // 裸盘写入
  />\s*\/dev\/(sd|disk|nvm)/,                             // 写设备
  /:\(\)\s*\{/,                                           // fork bomb
  /(^|[\s|;&])curl\b[^|]*\|\s*(ba)?sh(\s|$)/,             // 下载即执行
  /(^|[\s|;&])wget\b[^|]*\|\s*(ba)?sh(\s|$)/,
];

// P3-1/3-3：写操作关键字（run_bash 前触发快照；ask 模式下命中需白名单）
const WRITE_HINTS = [
  "git commit", "git add", "git reset", "git revert", "git checkout", "git merge",
  "git rebase", "git clean", "git stash", "git cherry-pick", "git apply", "git am",
  "bun install", "bun add", "bun remove", "bun link", "bun pm",
  "npm install", "npm i ", "pnpm ", "yarn ",
  "sed -i", "> ", ">>", "rm ", "mv ", "cp ", "touch ", "mkdir ", "tee ",
  "echo ", "printf ", "dd ", "chmod ", "chown ", "ln ", "unlink ",
];

type PermissionMode = "auto" | "ask";

function permissionMode(): PermissionMode {

  return loadConfig(workspace()).permissions;
}

/** run_bash 命令合法性检查：黑名单 → 拒绝；ask 模式写操作 → 需确认 */
function checkCommand(command: string, mode: PermissionMode): { allowed: boolean; reason?: string } {
  for (const p of DANGEROUS_PATTERNS) {
    if (p.test(command)) {
      return { allowed: false, reason: "危险命令被权限系统拒绝（匹配: /" + p.source + "/）" };
    }
  }
  const isWrite = WRITE_HINTS.some((h) => command.includes(h));
  if (isWrite && mode === "ask") {
    const allow = loadConfig(workspace()).allowCommands;
    const cmd = command.trim();
    if (allow.some((a) => a.trim() && (cmd === a.trim() || cmd.startsWith(a.trim() + " ")))) {
      return { allowed: true };
    }
    return { allowed: false, reason: "权限模式 ask（BUN_BOT_PERMISSIONS=ask）：写操作命令需人工确认。可在 .bunbot.json 的 allowCommands 白名单放行，或换用 write_file 工具。" };
  }
  if (isWrite && mode === "readonly") {
    return { allowed: false, reason: "权限模式 readonly（BUN_BOT_PERMISSIONS=readonly）：写操作命令被禁止（只读模式，只能分析/读取，不能改文件）。" };
  }
  return { allowed: true };
}

// ---------- 进程执行辅助 ----------

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

async function spawnWithTimeout(
  cmd: string[],
  opts: { cwd?: string; env?: Record<string, string | undefined> },
  timeoutMs: number,
): Promise<SpawnResult> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: opts.cwd,
    env: opts.env ?? process.env,
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { stdout, stderr, exitCode, timedOut };
}

// ---------- 工具执行器 ----------

async function runRunScript(args: { code?: string; cwd?: string; timeoutMs?: number }): Promise<string> {
  if (!args.code) return JSON.stringify({ error: "缺少 code 参数" });
  const timeout = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cwd = args.cwd ? resolveInWorkspace(args.cwd) : tmpdir();
  if (args.cwd && cwd === null) return outsideError("cwd", args.cwd);
  const file = join(tmpdir(), "bun-bot-" + Date.now() + "-" + Math.random().toString(36).slice(2) + ".ts");
  await Bun.write(file, args.code);
  try {
    const r = await spawnWithTimeout(["bun", "run", file], { cwd }, timeout);
    return JSON.stringify({
      cwd,
      stdout: clipOutput(r.stdout),
      stderr: clipOutput(r.stderr),
      exitCode: r.exitCode,
      timedOut: r.timedOut,
    });
  } finally {
    await Bun.file(file).delete().catch(() => {});
  }
}

async function runReadFile(args: { path?: string; offset?: number; maxBytes?: number }): Promise<string> {
  if (!args.path) return JSON.stringify({ error: "缺少 path 参数" });
  const p = resolveInWorkspace(args.path);
  if (p === null) return outsideError("path", args.path);
  if (!existsSync(p)) return JSON.stringify({ error: "文件不存在: " + args.path });
  const stat = statSync(p);
  if (stat.isDirectory()) return JSON.stringify({ error: args.path + " 是目录，请用 list_dir" });
  const offset = Math.max(0, args.offset ?? 0);
  const maxBytes = Math.min(args.maxBytes ?? DEFAULT_OUTPUT_LIMIT, MAX_READ_BYTES);
  const total = stat.size;
  const end = Math.min(offset + maxBytes, total);
  const content = await Bun.file(p).slice(offset, end).text();
  return JSON.stringify({
    path: relative(workspace(), p) || p,
    bytes: content.length,
    totalBytes: total,
    returnedRange: "[" + offset + ".." + end + ")",
    truncated: end < total,
    content,
  });
}

/** 极简行级 diff 摘要：公共前缀/后缀 + 中间改动区 */
export function summarizeDiff(oldText: string, newText: string, maxHunk = 8): string {
  if (oldText === newText) return "（无变化）";
  const a = oldText === "" ? [] : oldText.split("\n");
  const b = newText === "" ? [] : newText.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const removed = endA - start;
  const added = endB - start;
  const lines: string[] = [];
  lines.push("+" + added + " / -" + removed + " 行变化（改动区间 第 " + (start + 1) + "~" + endA + " 行 → 第 " + (start + 1) + "~" + endB + " 行）");
  const showOld = a.slice(start, Math.min(endA, start + maxHunk)).map((l) => "- " + l);
  const showNew = b.slice(start, Math.min(endB, start + maxHunk)).map((l) => "+ " + l);
  if (showOld.length) {
    lines.push("删除:");
    lines.push(...showOld);
  }
  if (showNew.length) {
    lines.push("新增:");
    lines.push(...showNew);
  }
  if (removed > maxHunk || added > maxHunk) lines.push("…（改动较多，仅展示前 " + maxHunk + " 行）");
  return lines.join("\n");
}

async function runWriteFile(args: { path?: string; content?: string }): Promise<string> {
  if (!args.path || args.content === undefined) return JSON.stringify({ error: "缺少 path 或 content 参数" });
  if (permissionMode() === "readonly") {
    return JSON.stringify({ error: "权限模式 readonly：write_file 被禁止（只读模式，不能修改工作区文件）" });
  }
  const p = resolveInWorkspace(args.path);
  if (p === null) return outsideError("path", args.path);
  const old = existsSync(p) ? readFileSync(p, "utf8") : "";
  mkdirSync(dirname(p), { recursive: true });
  const snap = await snapshotIfDirty("write_file " + (relative(workspace(), p) || p)) ?? "（工作区无未提交改动，无需快照）";
  writeFileSync(p, args.content, "utf8");
  return JSON.stringify({
    path: relative(workspace(), p) || p,
    bytesWritten: Buffer.byteLength(args.content),
    gitSnapshot: snap,
    diff: summarizeDiff(old, args.content),
  });
}

async function runListDir(args: { path?: string; all?: boolean; depth?: number }): Promise<string> {
  const base = args.path ? resolveInWorkspace(args.path) : workspace();
  if (args.path && base === null) return outsideError("path", args.path);
  if (!existsSync(base)) return JSON.stringify({ error: "目录不存在: " + (args.path ?? ".") });
  const stat = statSync(base);
  if (!stat.isDirectory()) return JSON.stringify({ error: (args.path ?? ".") + " 不是目录，请用 read_file" });
  const depth = Math.min(Math.max(args.depth ?? 3, 0), 8);
  const showAll = args.all === true;
  const lines: string[] = [];
  const walk = (dir: string, cur: number) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (!showAll && e.name.startsWith(".")) continue;
      const isDir = e.isDirectory();
      const p = join(dir, e.name);
      let size = "";
      if (!isDir) {
        try { size = " (" + statSync(p).size + " B)"; } catch {}
      }
      lines.push(" ".repeat(cur * 2) + (isDir ? "📁 " : "📄 ") + e.name + (isDir ? "/" : size));
      if (isDir && cur < depth) walk(p, cur + 1);
    }
  };
  lines.push(base);
  walk(base, 0);
  return JSON.stringify({ root: base, depth, entries: lines.length - 1, tree: lines.join("\n") });
}

async function runRunBash(args: { command?: string; cwd?: string; timeoutMs?: number }): Promise<string> {
  if (!args.command) return JSON.stringify({ error: "缺少 command 参数" });
  const timeout = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cwd = args.cwd ? resolveInWorkspace(args.cwd) : workspace();
  if (args.cwd && cwd === null) return outsideError("cwd", args.cwd);
  // P3-3：危险命令黑名单 / 权限模式检查
  const perm = checkCommand(args.command, permissionMode());
  if (!perm.allowed) {
    return JSON.stringify({ error: perm.reason, command: args.command, cwd });
  }
  // P3-1：写操作命令且工作区有未提交改动 → 先打快照（shell 直接改文件也可回滚）
  const snap = WRITE_HINTS.some((h) => args.command.includes(h))
    ? await snapshotIfDirty("run_bash " + args.command.slice(0, 60))
    : null;
  const r = await spawnWithTimeout(["bash", "-c", args.command], { cwd }, timeout);
  return JSON.stringify({
    cwd,
    command: args.command,
    stdout: clipOutput(r.stdout),
    stderr: clipOutput(r.stderr),
    exitCode: r.exitCode,
    timedOut: r.timedOut,
    gitSnapshot: snap ?? undefined,
  });
}

// ---------- 任务模式：update_plan（P2-2） ----------

interface PlanArgs {
  title?: string;
  items?: { text?: string; done?: boolean; detail?: string }[];
}

/**
 * 更新任务计划（全量覆盖式）。每次提交完整计划（含已完成项），
 * 进度写回 AGENT_STATE.json + MEMORY.md（跨会话保存，中断可恢复）。
 * 全部 done 时 status 自动置为 "done"。
 */
async function runUpdatePlan(args: PlanArgs): Promise<string> {
  if (permissionMode() === "readonly") {
    return JSON.stringify({ error: "权限模式 readonly：update_plan 被禁止（任务计划会写回状态文件，只读模式不可用）" });
  }
  if (!Array.isArray(args.items) || args.items.length === 0) {
    return JSON.stringify({ error: "缺少 items 数组（计划条目，至少 1 项）。示例：{\"title\":\"新增工具\",\"items\":[{\"text\":\"注册工具\",\"done\":false}]}" });
  }
  const items = args.items.map((it) => ({
    text: String(it?.text ?? "").trim(),
    done: it?.done === true,
    detail: it?.detail?.trim() || undefined,
  }));
  if (items.some((it) => !it.text)) {
    return JSON.stringify({ error: "items 每项必须含非空 text" });
  }
  const state = loadState();
  const now = new Date().toISOString();
  const prev = state.activePlan;
  const doneCount = items.filter((it) => it.done).length;
  state.activePlan = {
    title: (args.title?.trim() || prev?.title || "未命名任务").slice(0, 200),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    items,
    status: doneCount === items.length ? "done" : "active",
  };
  saveState(state);
  syncMemoryFile(state);
  return JSON.stringify({
    title: state.activePlan.title,
    status: state.activePlan.status,
    items: state.activePlan.items,
    doneCount,
    total: items.length,
    percent: Math.round((doneCount / items.length) * 100),
    saved: true,
    note: "进度已写回 " + "AGENT_STATE.json" + "（跨会话保存）",
  });
}

// ---------- 注册表 ----------

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

interface RegisteredTool {
  def: ToolDefinition;
  run: (args: Record<string, unknown>) => Promise<string>;
}

const registry: RegisteredTool[] = [
  {
    def: {
      type: "function",
      function: {
        name: "run_script",
        description:
          "用 Bun 运行一段 JavaScript/TypeScript 脚本，返回 JSON：{ cwd, stdout, stderr, exitCode, timedOut }。" +
          "默认 cwd 是临时目录（沙箱），可指定 cwd 到工作区来读写项目文件。输出上限 64KB，截断处带偏移。" +
          "示例：{\"code\":\"console.log(1+1)\"}（沙箱算个表达式）；" +
          "{\"code\":\"await Bun.write('x.txt','hi')\",\"cwd\":\".\"}（在工作区落文件，顶层 await 可用）",
        parameters: {
          type: "object",
          properties: {
            code: { type: "string", description: "要执行的完整 JS/TS 脚本源码（必填）。脚本内用 console.log 输出需要观察的结果" },
            cwd: { type: "string", description: "可选。脚本工作目录，相对路径基于工作区（如 \".\" = 工作区根）。不传则用临时沙箱目录" },
            timeoutMs: { type: "number", description: "可选。超时毫秒数，默认 30000，长任务可放开（如 120000）" },
          },
          required: ["code"],
        },
      },
    },
    run: (a) => runRunScript(a as { code?: string; cwd?: string; timeoutMs?: number }),
  },
  {
    def: {
      type: "function",
      function: {
        name: "read_file",
        description:
          "读取工作区文件（UTF-8 文本），默认完整返回（上限 64KB）。超出部分在返回的 totalBytes / returnedRange / truncated 里说明，用 offset 偏移续读。" +
          "示例：{\"path\":\"src/tools.ts\"}（读前 64KB）；" +
          "{\"path\":\"src/tools.ts\",\"offset\":65536}（从偏移 65536 续读后半段）",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "文件路径，相对工作区或绝对路径（必填）" },
            offset: { type: "number", description: "可选。起始字节偏移，默认 0；大文件配合返回的 returnedRange 续读" },
            maxBytes: { type: "number", description: "可选。本次读取字节数上限，默认 65536，硬上限 1000000" },
          },
          required: ["path"],
        },
      },
    },
    run: (a) => runReadFile(a as { path?: string; offset?: number; maxBytes?: number }),
  },
  {
    def: {
      type: "function",
      function: {
        name: "write_file",
        description:
          "写工作区文件（覆盖式）。自动创建父目录、落盘前自动 git 快照（可回滚），返回 JSON：{ path, bytesWritten, gitSnapshot, diff }（diff 为行级摘要）。" +
          "这是 agent 修改自身代码的落盘工具。" +
          "示例：{\"path\":\"src/hello.ts\",\"content\":\"console.log('hi')\"}（新建）；同参再写即覆盖已有文件",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "文件路径，相对工作区或绝对路径（必填）。父目录自动创建" },
            content: { type: "string", description: "要写入的完整文件内容（必填，覆盖式写入，非追加）" },
          },
          required: ["path", "content"],
        },
      },
    },
    run: (a) => runWriteFile(a as { path?: string; content?: string }),
  },
  {
    def: {
      type: "function",
      function: {
        name: "list_dir",
        description:
          "列出目录内容（带缩进的文件树），返回 JSON：{ root, depth, entries, tree }。默认不显示隐藏文件，深度 3（最大 8）。" +
          "示例：{\"path\":\".\",\"depth\":2}（看工作区根两层）；{\"path\":\".\",\"all\":true}（含隐藏文件）",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "可选。目录路径，相对工作区或绝对路径，默认工作区根" },
            all: { type: "boolean", description: "可选。为 true 时显示隐藏文件（-a）" },
            depth: { type: "number", description: "可选。递归深度，默认 3，最大 8" },
          },
          required: [],
        },
      },
    },
    run: (a) => runListDir(a as { path?: string; all?: boolean; depth?: number }),
  },
  {
    def: {
      type: "function",
      function: {
        name: "run_bash",
        description:
          "在 shell 中执行命令（bash -c），返回 JSON：{ cwd, command, stdout, stderr, exitCode, timedOut }。" +
          "默认 cwd 是工作区，可指定其他目录。可用于 git、bun install、测试等。输出上限 64KB。" +
          "写操作命令前自动 git 快照（可回滚）；危险命令（rm -rf /、git push、fork bomb 等）会被权限系统拒绝。" +
          "示例：{\"command\":\"bun test\"}（跑测试闸门）；{\"command\":\"git status --short\"}（看改动）",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "要执行的 shell 命令字符串（必填，bash -c 语义，支持管道/变量）" },
            cwd: { type: "string", description: "可选。执行目录，相对路径基于工作区，默认工作区" },
            timeoutMs: { type: "number", description: "可选。超时毫秒数，默认 30000，长任务可放开（如 120000）" },
          },
          required: ["command"],
        },
      },
    },
    run: (a) => runRunBash(a as { command?: string; cwd?: string; timeoutMs?: number }),
  },
  {
    def: {
      type: "function",
      function: {
        name: "update_plan",
        description:
          "更新任务计划（任务模式，全量覆盖式）。返回 JSON：{ title, status, items, doneCount, total, percent, saved }。" +
          "复杂任务首轮用它创建计划（title + 拆成可独立验证的分步 items），每完成一步就重新提交完整计划并勾选该项（done: true，detail 写验证结果）。" +
          "进度写回 AGENT_STATE.json 跨会话保存：中断/重启后可从上次断点继续。title 首次给出后，后续勾选可省略（保留原标题）。" +
          "示例：{\"title\":\"新增 read_file 工具\",\"items\":[{\"text\":\"在 tools.ts 注册\",\"done\":false},{\"text\":\"补文档与测试\",\"done\":false}]}（首轮创建）；" +
          "{\"items\":[{\"text\":\"在 tools.ts 注册\",\"done\":true,\"detail\":\"bun test 通过\"},{\"text\":\"补文档与测试\",\"done\":false}]}（完成第一步后勾选）",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "可选。计划标题。首次创建时建议给出；后续勾选可省略（保留原标题）" },
            items: {
              type: "array",
              description: "计划条目（全量覆盖，必填）。每项 { text, done?, detail? }：text 步骤描述（必填）、done 是否完成（默认 false）、detail 完成时的验证说明（可选）",
              items: {
                type: "object",
                properties: {
                  text: { type: "string", description: "步骤描述（必填）" },
                  done: { type: "boolean", description: "是否已完成，默认 false" },
                  detail: { type: "string", description: "可选。完成时的说明（怎么验证的）" },
                },
                required: ["text"],
              },
            },
          },
          required: ["items"],
        },
      },
    },
    run: (a) => runUpdatePlan(a as PlanArgs),
  },
];

/** 暴露给 API 的工具定义列表 */
export const tools: ToolDefinition[] = registry.map((t) => t.def);

/** 按名字执行工具；未知工具或执行异常都返回 JSON 错误串，不抛到主循环 */
export async function executeTool(name: string, argsJson: string): Promise<string> {
  const t = registry.find((x) => x.def.function.name === name);
  if (!t) return JSON.stringify({ error: "未知工具: " + name });
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    return await t.run(args);
  } catch (e) {
    return JSON.stringify({ error: "执行 " + name + " 失败: " + (e instanceof Error ? e.stack : String(e)) });
  }
}
