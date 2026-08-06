/**
 * config.ts — 项目级配置（P4 通用化，第 3 项）+ 全局配置（第 8 项）
 *
 * 优先级：环境变量 > 项目配置（.bunbot.json）> 全局配置（~/.bun-bot/config.json）> 默认值。
 * 字段：model / budget / permissions / testCommand / identity / stateDir / ignore / allowCommands / skillsDir
 *   - skillsDir   技能目录（P6-3 生态对齐：默认 [".agents/skills", "skills"] 双目录兼容，
 *                  支持字符串或数组；.agents/skills 是 Claude Code 生态约定，frontmatter 自描述）
 *   - model        模型名（BUN_BOT_MODEL 可覆盖）
 *   - budget       上下文 token 预算（BUN_BOT_CONTEXT_BUDGET 可覆盖）
 *   - permissions  权限模式（BUN_BOT_PERMISSIONS 可覆盖）：
 *                    auto 全自动 / ask 写操作需确认（allowCommands 白名单可放行）
 *                    / readonly 只读（write_file / 写操作 run_bash / update_plan 拒绝，P4-7）
 *   - testCommand  测试闸门命令（P4-5 多生态探测时用，单命令直接跑它）
 *   - identity     agent 身份（AGENT_IDENTITY 可覆盖；context.ts [身份] 区块用）
 *   - stateDir     状态文件目录（相对工作区，默认 .bunbot —— 不污染目标仓库，P4-4）
 *   - ignore       文件树额外忽略规则（P4-9，如 vendor/target/__pycache__）
 *   - allowCommands ask 模式白名单命令（P4-7：整命令或命令前缀匹配，命中放行）
 *
 * 全局配置（P4-8）：~/.bun-bot/config.json 提供默认模型 / 默认权限 / API key fallback，
 *   被项目配置与环境变量逐级覆盖；多项目状态天然按项目 .bunbot/ 目录隔离。
 *
 * 注意：config.ts 不 import memory.ts（避免循环依赖：memory 要用 config 的 stateDir），
 *       调用方显式传 base（通常是 workspace()）。
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** 项目级配置文件（P4 通用化：环境变量 > 项目配置 > 全局配置 > 默认值） */
export const CONFIG_FILE = ".bunbot.json";
/** 全局配置目录名（用户主目录下，跨项目共享默认值） */
export const GLOBAL_CONFIG_DIR = ".bun-bot";
export const GLOBAL_CONFIG_FILE = "config.json";

export type PermissionMode = "auto" | "ask" | "readonly";

export interface BunBotConfig {
  model: string;
  budget: number;
  permissions: PermissionMode;
  testCommand: string;
  identity: string;
  stateDir: string;
  ignore: string[];
  /** ask 模式白名单命令（整命令或前缀，命中放行；readonly 模式不适用） */
  allowCommands: string[];
  /** 技能目录（P6-3 生态对齐：.agents/skills 生态约定 + skills 仓库内置，双目录兼容） */
  skillsDir: string[];
}

/** 全局配置（~/.bun-bot/config.json）：全部可选，提供默认值兜底 */
export interface GlobalConfig {
  model?: string;
  permissions?: PermissionMode;
  /** API key fallback（DEEPSEEK_API_KEY 未设置时使用） */
  apiKey?: string;
  testCommand?: string;
  identity?: string;
  stateDir?: string;
  ignore?: string[];
  allowCommands?: string[];
  /** 技能目录覆盖（默认双目录：.agents/skills + skills） */
  skillsDir?: string[];
}

export const DEFAULT_CONFIG: BunBotConfig = {
  model: "deepseek-v4-flash",
  budget: 120_000,
  permissions: "auto",
  testCommand: "bun test",
  identity: "我是 bun-bot，一个自我认知为 Bun.js 运行时的 agent。",
  stateDir: ".bunbot",
  ignore: [],
  allowCommands: [],
  skillsDir: [".agents/skills", "skills"],
};

/** 全局配置目录：~/.bun-bot/（测试可用 HOME 环境变量覆盖） */
export function globalConfigDir(): string {
  const home = process.env.HOME || homedir(); // 优先 $HOME（测试可覆盖），fallback 系统 home
  return join(home, GLOBAL_CONFIG_DIR);
}

export function globalConfigPath(): string {
  return join(globalConfigDir(), GLOBAL_CONFIG_FILE);
}

/** 读全局配置 ~/.bun-bot/config.json；不存在或损坏返回空对象 */
export function readGlobalConfig(): GlobalConfig {
  try {
    if (!existsSync(globalConfigPath())) return {};
    const raw = JSON.parse(readFileSync(globalConfigPath(), "utf8")) as GlobalConfig;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

/** 读项目配置 .bunbot.json；不存在或损坏返回空对象（走默认值） */
export function readProjectConfig(base: string): Partial<BunBotConfig> {
  try {
    const p = join(base, CONFIG_FILE);
    if (!existsSync(p)) return {};
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<BunBotConfig>;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

/** 合并配置：环境变量 > 项目配置 > 全局配置 > 默认值（带合法性兜底） */
export function loadConfig(base: string): BunBotConfig {
  const global = readGlobalConfig();
  const { apiKey: _globalApiKey, ...globalRest } = global; // apiKey 只做 fallback，不进入项目配置
  const file = readProjectConfig(base);
  const cfg: BunBotConfig = {
    ...DEFAULT_CONFIG,
    ...globalRest,
    ...file,
    permissions: (file.permissions ?? global.permissions ?? DEFAULT_CONFIG.permissions) as PermissionMode,
  };
  // 环境变量覆盖（最高优先级）
  if (process.env.BUN_BOT_MODEL) cfg.model = process.env.BUN_BOT_MODEL;
  if (process.env.BUN_BOT_CONTEXT_BUDGET) {
    const n = Number(process.env.BUN_BOT_CONTEXT_BUDGET);
    if (Number.isFinite(n) && n > 0) cfg.budget = n;
  }
  if (process.env.BUN_BOT_PERMISSIONS) {
    const m = process.env.BUN_BOT_PERMISSIONS as PermissionMode;
    if (m === "auto" || m === "ask" || m === "readonly") cfg.permissions = m;
  }
  if (process.env.AGENT_IDENTITY) cfg.identity = process.env.AGENT_IDENTITY;
  // 合法性兜底（配置损坏 / 环境变量非法时不崩）
  if (cfg.permissions !== "auto" && cfg.permissions !== "ask" && cfg.permissions !== "readonly") {
    cfg.permissions = DEFAULT_CONFIG.permissions;
  }
  if (!Number.isFinite(cfg.budget) || cfg.budget <= 0) cfg.budget = DEFAULT_CONFIG.budget;
  if (!cfg.testCommand.trim()) cfg.testCommand = DEFAULT_CONFIG.testCommand;
  if (!cfg.identity.trim()) cfg.identity = DEFAULT_CONFIG.identity;
  if (!Array.isArray(cfg.ignore)) cfg.ignore = [];
  if (!Array.isArray(cfg.allowCommands)) cfg.allowCommands = [];
  // P6-3：skillsDir 支持字符串或数组，过滤空项
  if (typeof (cfg as { skillsDir?: unknown }).skillsDir === "string") {
    cfg.skillsDir = [(cfg as { skillsDir: string }).skillsDir];
  }
  if (!Array.isArray(cfg.skillsDir)) cfg.skillsDir = DEFAULT_CONFIG.skillsDir;
  cfg.skillsDir = cfg.skillsDir.map((s) => s.trim()).filter((s) => s !== "");
  if (!cfg.skillsDir.length) cfg.skillsDir = DEFAULT_CONFIG.skillsDir;
  if (!cfg.stateDir.trim()) cfg.stateDir = DEFAULT_CONFIG.stateDir;
  return cfg;
}
