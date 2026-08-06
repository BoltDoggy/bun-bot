/**
 * bun-bot — 自我认知为 Bun.js 运行时的 agent
 *
 * M1（P0+P1）：agent 认识自己、能改自己的文件 —— 自修改最小闭环成立。
 *   - P0: 结构化自我认知 + AGENT_STATE.json / MEMORY.md 记忆，启动加载项目上下文
 *   - P1: 工具集扩充 run_script(read/write/list/batch) + read_file/write_file/list_dir/run_bash，
 *         run_script 支持 cwd、可配超时、输出上限 64KB
 *
 * 用法:
 *   bun run index.ts "你的任务"        # 普通模式
 *   bun run index.ts --stream "任务"   # 流式模式（SSE 打字机）
 */
import { existsSync } from "node:fs";
import {
  workspace,
  loadState,
  saveState,
  syncMemoryFile,
  loadProjectContext,
  statePath,
} from "./src/memory";
import { buildSystemPrompt } from "./src/context";
import { tools, executeTool } from "./src/tools";

const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY) {
  console.error("请先设置环境变量 DEEPSEEK_API_KEY（或写入 .env）");
  process.exit(1);
}

const BASE_URL = "https://api.deepseek.com";
const MODEL = process.env.BUN_BOT_MODEL || "deepseek-v4-flash";
const MAX_ITERATIONS = Number(process.env.BUN_BOT_MAX_ITERATIONS || 150);

// ---------- 命令行解析 ----------
const args = process.argv.slice(2);
const STREAM = args.includes("--stream");
const task = args.filter((a) => !a.startsWith("--")).join(" ");
if (!task) {
  console.error('用法: bun run index.ts [--stream] "你的任务"');
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

// ---------- 对话（支持流式 / 非流式） ----------
async function chatCompletion(messages: ChatMessage[], stream: boolean): Promise<ChatMessage> {
  const res = await fetch(BASE_URL + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + API_KEY,
    },
    body: JSON.stringify({ model: MODEL, messages, tools, stream }),
  });
  if (!res.ok) {
    throw new Error("HTTP " + res.status + ": " + (await res.text()));
  }

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
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const chunk = JSON.parse(data);
      const delta = chunk.choices?.[0]?.delta ?? {};
      if (delta.content) {
        content += delta.content;
        process.stdout.write(delta.content);
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

// ---------- 启动：加载记忆 + 项目上下文，组装系统提示词 ----------
const state = loadState();
// 首次运行：初始化记忆文件，让 agent 一启动就知道自己、有可写回的记忆
if (!existsSync(statePath())) {
  state.lastRunAt = new Date().toISOString();
  saveState(state);
  syncMemoryFile(state);
  console.error("[bun-bot] 首次运行，已初始化 " + statePath() + " / MEMORY.md");
}

const project = loadProjectContext();
const messages: ChatMessage[] = [
  { role: "system", content: buildSystemPrompt({ state, project }) },
  { role: "user", content: task },
];

console.error("[bun-bot] 工作区: " + workspace());
console.error("[bun-bot] 模型: " + MODEL + " | 流式: " + STREAM);

// ---------- Agent 主循环 ----------
for (let i = 0; i < MAX_ITERATIONS; i++) {
  const message = await chatCompletion(messages, STREAM);
  messages.push(message);

  if (!message.tool_calls?.length) {
    // 没有工具调用，任务完成：写回记忆后退出
    if (!STREAM) console.log(message.content ?? "");
    state.lastTask = task;
    state.lastSummary = message.content ?? "";
    state.lastRunAt = new Date().toISOString();
    saveState(state);
    syncMemoryFile(state);
    process.exit(0);
  }

  for (const call of message.tool_calls) {
    // stderr 打印工具调用与结果摘要（完整结果回传模型）
    const argPreview = call.function.arguments.length > 400
      ? call.function.arguments.slice(0, 400) + "…"
      : call.function.arguments;
    console.error("\n--- [" + call.function.name + "] " + argPreview);
    const result = await executeTool(call.function.name, call.function.arguments);
    const resultPreview = result.length > 2000 ? result.slice(0, 2000) + "\n… [结果过长，完整版已回传模型]" : result;
    console.error("\n" + resultPreview + "\n");
    messages.push({ role: "tool", tool_call_id: call.id, content: result });
  }
}

console.error("达到最大迭代次数 (" + MAX_ITERATIONS + ")，强制结束。");
process.exit(1);

export {};
