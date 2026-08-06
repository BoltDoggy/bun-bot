/**
 * p4-interactive.test.ts — P4 通用化：交互模式 --interactive（第 10 项）
 *
 * 验证（纯逻辑驱动，API 调用注入 fake runRound）：
 *   1. 连续两轮对话状态保持：第二轮能看到第一轮的 user 输入（消息累积）
 *   2. 退出词（exit / quit / q / 退出）停止会话
 *   3. 空输入跳过
 *   4. runRound done=false（超迭代）时中止
 *
 * 运行：bun test
 */
import { test, expect } from "bun:test";
import type { ChatMessage } from "../src/budget";
import { driveInteractive, isExitInput } from "../src/interactive";

/** fake 一轮：把历史 user 输入 + 本轮输入拼进回复（验证跨轮状态） */
const fakeRound = async (messages: ChatMessage[], input: string) => {
  const history = messages.filter((m) => m.role === "user").map((m) => m.content);
  const reply = "回复[" + history.join(" | ") + "→" + input + "]";
  return {
    messages: [
      ...messages,
      { role: "user", content: input },
      { role: "assistant", content: reply },
    ],
    done: true,
    reply,
  };
};

test("P4 交互：连续两轮对话状态保持（第二轮能看到第一轮输入）", async () => {
  const { rounds, finalMessages } = await driveInteractive(["第一轮问题", "第二轮问题"], {
    systemPrompt: "SYS",
    runRound: fakeRound,
  });
  expect(rounds).toBe(2);
  const users = finalMessages.filter((m) => m.role === "user").map((m) => m.content);
  expect(users).toEqual(["第一轮问题", "第二轮问题"]); // 两轮都在（消息累积）
  // assistant 回复可见两轮历史：第二轮回复里包含第一轮的输入
  const lastAssistant = finalMessages.filter((m) => m.role === "assistant").pop()!.content!;
  expect(lastAssistant).toContain("第一轮问题");
  expect(lastAssistant).toContain("第二轮问题");
  // system 只出现一次
  expect(finalMessages.filter((m) => m.role === "system").length).toBe(1);
});

test("P4 交互：退出词停止会话（exit / quit / q / 退出）", async () => {
  expect(isExitInput("exit")).toBe(true);
  expect(isExitInput("  quit ")).toBe(true);
  expect(isExitInput("q")).toBe(true);
  expect(isExitInput("退出")).toBe(true);
  expect(isExitInput("退出系统")).toBe(false);
  expect(isExitInput("task")).toBe(false);
  // 退出词后的输入不再执行
  const { rounds, finalMessages } = await driveInteractive(["第一轮", "exit", "不该执行"], {
    systemPrompt: "SYS",
    runRound: fakeRound,
  });
  expect(rounds).toBe(1);
  const users = finalMessages.filter((m) => m.role === "user").map((m) => m.content);
  expect(users).toEqual(["第一轮"]);
});

test("P4 交互：空输入跳过", async () => {
  const { rounds, finalMessages } = await driveInteractive(["", "   ", "任务", ""], {
    systemPrompt: "SYS",
    runRound: fakeRound,
  });
  expect(rounds).toBe(1);
  expect(finalMessages.filter((m) => m.role === "user").length).toBe(1);
});

test("P4 交互：runRound done=false（超迭代）时中止", async () => {
  const failing = async (messages: ChatMessage[], input: string) => ({
    messages: [...messages, { role: "user", content: input }],
    done: false,
    reply: "",
  });
  const { rounds } = await driveInteractive(["第一轮", "第二轮"], {
    systemPrompt: "SYS",
    runRound: failing,
  });
  expect(rounds).toBe(1); // 第一轮 done=false 后中止
});
