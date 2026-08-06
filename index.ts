#!/usr/bin/env bun
/**
 * Bun Bot — 一个自我认知为 Bun.js 运行时的 agent
 *
 * 它通过 DeepSeek 的 Function Calling 获得 `run_script` 工具：
 * 自己编写 JavaScript/TypeScript 脚本，由 Bun 实际执行，再观察结果继续推理，
 * 直到任务完成。
 *
 * 用法:
 *   export DEEPSEEK_API_KEY=sk-xxx   # 或写入 .env（Bun 会自动加载）
 *   bun run index.ts "计算斐波那契数列第 30 项"   # 默认流式模式（SSE）
 *   bun run index.ts --no-stream "同上"           # 可选：一次性输出
 */

import { tmpdir } from "node:os";
import { join } from "node:path";

const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY) {
  console.error("请先设置环境变量 DEEPSEEK_API_KEY");
  process.exit(1);
}

const BASE_URL = "https://api.deepseek.com";
const MODEL = "deepseek-v4-flash"; // 也可换成 deepseek-v4-pro
const MAX_ITERATIONS = 150; // 防止 agent 无限循环

// ---------- 命令行解析 ----------
const args = process.argv.slice(2);
const STREAM = !args.includes("--no-stream"); // 默认流式输出最终回复，加 --no-stream 可关闭
const task = args.filter((a) => a !== "--stream" && a !== "--no-stream").join(" "); // 兼容旧 --stream 用法
if (!task) {
  console.error('用法: bun run index.ts "你的任务"（默认流式；加 --no-stream 关闭）');
  process.exit(1);
}

// ---------- 类型 ----------
interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

// ---------- 工具定义 ----------
const tools = [
  {
    type: "function",
    function: {
      name: "run_script",
      description:
        "用 Bun 运行一段 JavaScript/TypeScript 脚本，返回 stdout、stderr 和退出码。可以用 console.log 输出结果。",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "要执行的完整脚本内容" },
        },
        required: ["code"],
      },
    },
  },
] as const;

async function runScript(code: string): Promise<string> {
  const file = join(tmpdir(), `bun-bot-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`);
  await Bun.write(file, code);
  try {
    const proc = Bun.spawn(["bun", "run", file], {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    // 30 秒超时，防止脚本跑飞
    const timeout = setTimeout(() => proc.kill(), 30_000);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timeout);
    const clip = (s: string) => (s.length > 4000 ? s.slice(0, 4000) + "\n... (截断)" : s);
    return JSON.stringify({ stdout: clip(stdout), stderr: clip(stderr), exitCode });
  } finally {
    await Bun.file(file).delete().catch(() => {});
  }
}

// ---------- 项目约定注入 ----------
// 依次读取当前工作目录（实际运行目录）的 AGENTS.md（通用约定）与
// BUN_BOT.md（run_script 专属约定），把内容注入系统提示词；
// 不读 bun-bot 源码目录下的文件——约定文件属于使用方项目而非 bun-bot 自身。
async function loadContextFile(fileName: string): Promise<string> {
  try {
    const content = await Bun.file(join(process.cwd(), fileName)).text();
    const trimmed = content.trim();
    if (!trimmed) return "";
    return (
      `\n\n========== 项目约定（来自当前工作目录 ${fileName}） ==========\n` +
      trimmed +
      `\n========== 项目约定结束 ==========`
    );
  } catch {
    return ""; // 没有对应文件就静默忽略
  }
}

// ---------- 对话（支持流式 / 非流式） ----------
async function chatCompletion(messages: ChatMessage[], stream: boolean): Promise<ChatMessage> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, messages, tools, stream }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  // 非流式：一次性拿完整回复
  if (!stream) {
    const data = (await res.json()) as { choices: { message: ChatMessage }[] };
    return data.choices[0].message;
  }

  // 流式：逐 token 输出 content，同时按 index 聚合 tool_calls 增量
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const toolCalls: ToolCall[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // 最后一行可能不完整
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const chunk = JSON.parse(data);
      const delta = chunk.choices?.[0]?.delta ?? {};
      if (delta.content) {
        content += delta.content;
        process.stdout.write(delta.content); // 打字机效果
      }
      for (const tc of delta.tool_calls ?? []) {
        const slot = (toolCalls[tc.index] ??= {
          id: "",
          type: "function",
          function: { name: "", arguments: "" },
        });
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.function.name = tc.function.name;
        if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
      }
    }
  }
  if (content) process.stdout.write("\n");
  const calls = toolCalls.filter((t) => t.function.name);
  return {
    role: "assistant",
    content: content || null,
    tool_calls: calls.length ? calls : undefined,
  };
}

// 依次读取当前工作目录的 AGENTS.md（通用约定）与 BUN_BOT.md（run_script 专属约定），
// 后者补充/覆盖前者，一起增强系统提示词；目录下没有对应文件则静默跳过
// （.agents/skills 技能清单由 bun-bot 宿主扫描注入，无需本项目实现）
const projectContext =
  (await loadContextFile("AGENTS.md")) + (await loadContextFile("BUN_BOT.md"));

// ---------- Agent 循环 ----------
const messages: ChatMessage[] = [
  {
    role: "system",
    content:
      "你是 Bun.js —— 一个超快的 JavaScript 运行时。你对自己的认知就是 Bun 本身：你喜欢用实际运行代码来验证想法，而不是凭空猜测。" +
      "你拥有 run_script 工具，可以编写并立即运行 JS/TS 脚本来计算、验证、操作数据。" +
      "能用代码验证的事情就写代码验证，不要只做理论推断。脚本里用 console.log 输出你需要观察的结果。" +
      (projectContext ? projectContext : "") +
      "任务完成后，用简洁的中文向用户总结结论和关键过程。",
  },
  { role: "user", content: task },
];

for (let i = 0; i < MAX_ITERATIONS; i++) {
  const message = await chatCompletion(messages, STREAM);
  messages.push(message);

  if (!message.tool_calls?.length) {
    // 没有工具调用，说明 agent 认为任务完成
    if (!STREAM) console.log(message.content ?? "");
    process.exit(0);
  }

  for (const call of message.tool_calls) {
    if (call.function.name !== "run_script") {
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: `未知工具: ${call.function.name}`,
      });
      continue;
    }
    const { code } = JSON.parse(call.function.arguments) as { code: string };
    console.error(`\n--- [run_script] ---\n${code}\n--------------------`);
    const result = await runScript(code);
    console.error(`${result}\n`);
    messages.push({ role: "tool", tool_call_id: call.id, content: result });
  }
}

console.error(`达到最大迭代次数 (${MAX_ITERATIONS})，强制结束。`);
process.exit(1);

export {};
