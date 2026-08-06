// src/cli.ts — CLI 命令逻辑（init / --version / --help），bin/bun-bot.ts（bun link）与 index.ts（编译产物）共用。
// init / --version / --help 都不依赖 DEEPSEEK_API_KEY，调用方必须在 API key 检查前拦截。
// 版本号用 JSON import —— bun build --compile 时内联进产物，编译产物也能读到正确版本（不依赖运行时文件路径）。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json";

/** 版本号从 package.json 读取（--version 用） */
export const VERSION: string = pkg.version ?? "0.0.0";

export function printHelp(): void {
  console.log("bun-bot v" + VERSION + " — 自我认知为 Bun.js 运行时的 agent（DeepSeek Function Calling + Bun 执行）");
  console.log("");
  console.log("用法:");
  console.log('  bun-bot [--stream] [--self] [--resume] [--interactive] "任务"   启动 agent（--resume/--interactive 可不带任务）');
  console.log("  bun-bot init                                    在当前目录生成项目配置（AGENTS.md 模板 + .bunbot.json + .gitignore 条目）");
  console.log("  bun-bot --version / -v                          显示版本号");
  console.log("  bun-bot --help / -h                             显示本帮助");
  console.log("");
  console.log("环境变量: DEEPSEEK_API_KEY（必填）/ BUN_BOT_MODEL / BUN_BOT_WORKSPACE / BUN_BOT_CONTEXT_BUDGET / BUN_BOT_PERMISSIONS");
  console.log("项目配置: .bunbot.json（P4：环境变量 > 项目配置 > 默认值，详见 src/config.ts）");
}

/**
 * init：在当前目录生成 AGENTS.md 模板 + .bunbot.json + .gitignore 条目。
 * 幂等：已有文件不覆盖，.gitignore 条目不重复追加。
 */
export function runInit(): void {
  const cwd = process.cwd();
  const AGENTS_TEMPLATE = [
    "# AGENTS.md — 项目级指令（bun-bot 自动加载，优先级最高）",
    "",
    "> 本文件是用户与 agent 之间的项目级契约。写入项目约定（如禁止改哪些文件、必须跑什么测试），",
    "> bun-bot 每次启动自动加载并优先遵守它。不存在时跳过，不影响运行。",
    "",
    "## 项目约定",
    "",
    "- 所有改动必须跑 `bun test`（或项目实际测试命令）验证",
    "- 禁止修改：docs/ 下的计划文档（如需修改先与用户确认）",
    "",
  ].join("\n");
  const CONFIG_TEMPLATE = [
    "{",
    "  // bun-bot 项目级配置（P4：环境变量 > 本文件 > 默认值）。删掉字段用默认值。",
    '  "model": "deepseek-v4-flash",',
    '  "budget": 120000,',
    '  "permissions": "auto",',
    '  "testCommand": "bun test",',
    '  "stateDir": ".bunbot",',
    '  "ignore": ["vendor", "target", "__pycache__", ".venv"]',
    "}",
    "",
  ].join("\n");

  const files: string[] = [];
  // 1. AGENTS.md（不存在才写，不覆盖用户已有指令）
  if (!existsSync(join(cwd, "AGENTS.md"))) {
    writeFileSync(join(cwd, "AGENTS.md"), AGENTS_TEMPLATE, "utf8");
    files.push("AGENTS.md");
  }
  // 2. .bunbot.json（不存在才写，不覆盖用户已有配置）
  if (!existsSync(join(cwd, ".bunbot.json"))) {
    writeFileSync(join(cwd, ".bunbot.json"), CONFIG_TEMPLATE, "utf8");
    files.push(".bunbot.json");
  }
  // 3. .gitignore：追加 .bunbot/（幂等，避免状态文件污染 git status）
  const gi = join(cwd, ".gitignore");
  const existing = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  if (!existing.split("\n").some((l) => l.trim() === ".bunbot/")) {
    const sep = existing === "" || existing.endsWith("\n") ? "" : "\n";
    writeFileSync(gi, existing + sep + "# bun-bot 状态目录（本地持久化，不纳入版本控制）\n.bunbot/\n", "utf8");
    files.push(".gitignore（追加 .bunbot/）");
  }
  if (files.length) {
    console.log("bun-bot init 完成，已生成/更新：" + files.join("、"));
  } else {
    console.log("bun-bot init：项目已初始化（AGENTS.md / .bunbot.json / .gitignore 均已就绪），无需改动");
  }
  console.log("下一步：设置 DEEPSEEK_API_KEY 后运行 `bun-bot \"你的任务\"` 开始使用。");
}
