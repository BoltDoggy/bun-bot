/**
 * interactive.ts — 交互模式（P4-10：--interactive 多轮 REPL）
 *
 * 设计：多轮对话共享同一份 messages（对话连续），每轮把用户输入追加为 user 消息，
 * 交给 runRound 执行一轮 agent 主循环（真实实现里是 index.ts 的 runAgentLoop，
 * 内部跑 assistant 回复 + 工具循环，返回本轮结束后的完整消息列表）。
 *
 * 纯逻辑（退出词 / 空输入过滤 / 消息累积）与 API 调用解耦：
 *   - driveInteractive 接受注入的 runRound（测试用 fake 离线验证"连续两轮状态保持"）
 *   - index.ts 的 --interactive 分支用真实 runRound 驱动 stdin REPL
 */
import type { ChatMessage } from "./budget";

/** 一轮执行结果：本轮结束后的完整消息列表 + 是否正常完成 + 最终回复文本 */
export interface RoundResult {
  messages: ChatMessage[];
  done: boolean;
  reply: string;
}

export interface InteractiveOptions {
  /** 每轮执行（真实：agent 主循环；测试：注入 fake） */
  runRound: (messages: ChatMessage[], input: string) => Promise<RoundResult>;
  systemPrompt: string;
}

/** 退出词：exit / quit / q / 退出（大小写不敏感，前后空白容忍） */
export function isExitInput(input: string): boolean {
  const t = input.trim().toLowerCase();
  return t === "exit" || t === "quit" || t === "q" || t === "退出";
}

/**
 * 驱动一轮交互会话：依次处理 inputs（跳过空白、遇退出词停止）。
 * messages 跨轮保持（第二轮能看到第一轮的对话历史）—— 对话连续性的核心。
 * 某轮 runRound 返回 done=false（如超迭代）时中止。
 * @returns 实际轮数 + 最终消息列表（含 system + 全部历史）
 */
export async function driveInteractive(
  inputs: string[],
  opts: InteractiveOptions,
): Promise<{ rounds: number; finalMessages: ChatMessage[] }> {
  let messages: ChatMessage[] = [{ role: "system", content: opts.systemPrompt }];
  let rounds = 0;
  for (const raw of inputs) {
    const input = raw.trim();
    if (!input) continue;
    if (isExitInput(input)) break;
    const r = await opts.runRound(messages, input);
    messages = r.messages;
    rounds++;
    if (!r.done) break;
  }
  return { rounds, finalMessages: messages };
}
