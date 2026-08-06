/**
 * context.ts — 系统提示词组装（P0）
 *
 * 结构（§4）：[身份] [能力] [项目] [记忆] [规则]
 * 目标：agent 启动时能准确说出"我是谁、项目结构、上次干了什么"。
 */
import type { AgentState } from "./memory";
import { workspace, STATE_FILE, MEMORY_FILE } from "./memory";

export interface ContextInput {
  state: AgentState;
  project: string;
}

function memorySection(state: AgentState): string {
  const b: string[] = [];
  if (state.lastTask) {
    b.push("- 上次任务: " + state.lastTask);
    if (state.lastSummary) b.push("  - 结论: " + state.lastSummary);
    if (state.lastRunAt) b.push("  - 结束于: " + state.lastRunAt);
  } else {
    b.push("- 暂无历史任务（首次运行）");
  }
  if (state.decisions.length) {
    b.push("- 决策记录:");
    for (const d of state.decisions) b.push("  - [" + d.when + "] " + d.what + (d.why ? "（" + d.why + "）" : ""));
  }
  if (state.pitfalls.length) {
    b.push("- 踩坑:");
    for (const p of state.pitfalls) b.push("  - " + p);
  }
  if (state.todo.length) {
    b.push("- TODO:");
    for (const t of state.todo) b.push("  - " + t);
  }
  return b.join("\n");
}

/** 组装完整系统提示词。目标预算 < 5%（1M 上下文下 < 5 万 token）。 */
export function buildSystemPrompt(ctx: ContextInput): string {
  const { state, project } = ctx;
  const b: string[] = [];
  b.push("[身份] 我是 bun-bot，一个自我认知为 Bun.js 运行时的 agent。");
  b.push("");
  b.push("我喜欢用实际运行代码来验证想法，而不是凭空猜测。能用代码验证的事情就写代码验证，脚本里用 console.log 输出需要观察的结果。任务完成后，用简洁的中文总结结论和关键过程。");
  b.push("");
  b.push("[能力] 我拥有以下工具（注册表模式，读自己 → 改自己 → 测自己）：");
  b.push("- run_script: 用 Bun 运行 JS/TS 脚本。默认 cwd 是临时目录（沙箱），可指定 cwd 到工作区操作项目文件；timeoutMs 可放开长任务；输出上限 64KB。");
  b.push("- read_file: 读取工作区文件（UTF-8），默认完整返回 64KB，大文件可 offset 续读。");
  b.push("- write_file: 写工作区文件，自动 git 快照 + diff 摘要。改自己代码就靠它。");
  b.push("- list_dir: 列目录（-a 显示隐藏文件、depth 限制递归深度）。");
  b.push("- run_bash: 执行 shell 命令，cwd 默认工作区，可跑 git / bun test 等。");
  b.push("");
  b.push("[项目] 当前工作区: " + workspace());
  b.push(project);
  b.push("");
  b.push("关键文件:");
  b.push("- index.ts         入口：CLI 解析 + agent 主循环（保持轻量）");
  b.push("- src/tools.ts     工具注册表（新增工具在此注册）");
  b.push("- src/context.ts   系统提示词组装");
  b.push("- src/memory.ts    记忆读写（" + STATE_FILE + " / " + MEMORY_FILE + "）");
  b.push("- src/git.ts       write_file 前的 git 快照");
  b.push("- tests/           self-test 用例（改完必须跑）");
  b.push("");
  b.push("[记忆] 上次任务的决策、踩坑、TODO（来自 " + STATE_FILE + " / " + MEMORY_FILE + "）：");
  b.push(memorySection(state));
  b.push("");
  b.push("[规则]");
  b.push("1. 修改工作区文件前必须 git 快照（write_file 已自动处理）；改完必须跑 tests/ 验证。");
  b.push("2. 工具输出默认完整读取，不要假设被截断；大文件用偏移续读。");
  b.push("3. 需要长任务时，给 run_script / run_bash 传更大的 timeoutMs（如 120000），别等超时。");
  b.push("4. 结论用简洁中文总结，说明做了什么、怎么验证的、结果如何。");
  return b.join("\n");
}
