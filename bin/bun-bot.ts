#!/usr/bin/env bun
/**
 * bin/bun-bot.ts — CLI 分发入口（P4-6：bun link / bunx 可全局安装）
 *
 * 用法：
 *   bun-bot [--stream] [--self] [--resume] "任务"   启动 agent（代理到 index.ts 主循环）
 *   bun-bot init                                    在当前目录生成项目配置
 *                                                   （AGENTS.md 模板 + .bunbot.json + .gitignore 条目）
 *   bun-bot --version / -v                          显示版本号
 *   bun-bot --help / -h                             显示用法说明
 *
 * init / --version / --help 的命令逻辑在 src/cli.ts（index.ts 编译产物入口同样支持，API key 检查前拦截）；
 * 透传启动 agent 才需要 DEEPSEEK_API_KEY。
 */
import { printHelp, runInit, VERSION } from "../src/cli";

// ---------- 参数分发 ----------
const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(args.length === 0 ? 1 : 0);
}
if (args.includes("--version") || args.includes("-v")) {
  console.log("bun-bot v" + VERSION);
  process.exit(0);
}
if (args[0] === "init") {
  runInit();
  process.exit(0);
}

// 其他参数 → 透传启动主循环（index.ts 复用 CLI 解析与 agent 主循环；process.argv 保持原样）
await import("../index.ts");
