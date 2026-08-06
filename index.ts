// bun-bot — 自我认知为 Bun.js 运行时的 agent。M1（P0+P1）：认识自己、能改自己 —— 自修改最小闭环成立（P0: AGENT_STATE.json / MEMORY.md 记忆；P1: run_script + read/write/list/bash 工具集）。P2-2 任务模式：--self 先 plan 后执行、逐项勾选、进度写回状态可续跑。P2-3 上下文预算：budget.ts token 估算 + tool result clearing（超限时压缩早期工具结果）。
// 用法: bun run index.ts [--stream] [--self] "你的任务"（--stream 走 SSE 流式；--self 开任务模式）
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
import {
  estimateMessagesTokens,
  compressContext,
  DEFAULT_BUDGET_TOKENS,
  type ChatMessage,
} from "./src/budget";

const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY) {
  console.error("请先设置环境变量 DEEPSEEK_API_KEY（或写入 .env）");
  process.exit(1);
}

const BASE_URL = "https://api.deepseek.com";
const MODEL = process.env.BUN_BOT_MODEL || "deepseek-v4-flash";
const MAX_ITERATIONS = Number(process.env.BUN_BOT_MAX_ITERATIONS || 150);
// P2-3：上下文 token 预算（超限时压缩早期工具结果），可环境变量覆盖
const BUDGET_TOKENS = Number(process.env.BUN_BOT_CONTEXT_BUDGET || DEFAULT_BUDGET_TOKENS);

// ---------- 命令行解析 ----------
const args = process.argv.slice(2);
const STREAM = args.includes("--stream");
const SELF_MODE = args.includes("--self");
const task = args.filter((a) => !a.startsWith("--")).join(" ");
if (!task) {
  console.error('用法: bun run index.ts [--stream] [--self] "你的任务"');
  process.exit(1);
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
  const toolCalls: ChatMessage["tool_calls"] = [];

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
  const calls = (toolCalls ?? []).filter((t) => t.function.name);
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
let messages: ChatMessage[] = [
  { role: "system", content: buildSystemPrompt({ state, project, selfMode: SELF_MODE }) },
  { role: "user", content: task },
];
// P2-3：本轮会话触发的上下文压缩告警（结束时写回 state.contextWarnings）
const sessionWarnings: string[] = [];

console.error("[bun-bot] 工作区: " + workspace());
console.error("[bun-bot] 模型: " + MODEL + " | 流式: " + STREAM + " | 任务模式: " + SELF_MODE + " | 上下文预算: " + BUDGET_TOKENS + " tokens");
// P2-2：任务模式下检测到上次未完成计划 → 提示续跑（[记忆] 区块已展示进度）
if (SELF_MODE && state.activePlan && state.activePlan.status === "active") {
  console.error("[bun-bot] 任务模式：检测到未完成计划「" + state.activePlan.title + "」，从上次断点继续（见 [记忆] 当前任务计划）");
}

// ---------- Agent 主循环 ----------
for (let i = 0; i < MAX_ITERATIONS; i++) {
  // P2-3：预算检查 —— 超限时压缩早期工具结果（tool result clearing）
  const enforceBudget = (round: number): void => {
    if (estimateMessagesTokens(messages) <= BUDGET_TOKENS) return;
    const r = compressContext(messages, BUDGET_TOKENS);
    if (r.cleared === 0) return; // 无可清理项（理论上不会：超限必有可清工具结果）
    messages = r.messages;
    const warn = "第 " + round + " 轮：上下文超预算，清理 " + r.cleared + " 条工具结果（" + r.beforeTokens + " → " + r.afterTokens + " tokens）";
    console.error("[budget] " + warn);
    sessionWarnings.push(warn);
  };

  const message = await chatCompletion(messages, STREAM);
  messages.push(message);
  enforceBudget(i + 1);

  if (!message.tool_calls?.length) {
    // 没有工具调用，任务完成：写回记忆后退出
    if (!STREAM) console.log(message.content ?? "");
    // 重新加载再写回：update_plan 可能已在会话中改过 activePlan，
    // 用旧 state 引用覆盖会把进度冲掉（防覆盖）
    const fresh = loadState();
    fresh.lastTask = task;
    fresh.lastSummary = message.content ?? "";
    fresh.lastRunAt = new Date().toISOString();
    // P2-3：本轮压缩告警合并进 contextWarnings（保留最近 10 条）
    if (sessionWarnings.length) {
      fresh.contextWarnings = sessionWarnings.concat(fresh.contextWarnings).slice(0, 10);
    }
    saveState(fresh);
    syncMemoryFile(fresh);
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
    // 工具结果是主要增长点：入队后立即检查预算
    enforceBudget(i + 1);
  }
}

console.error("达到最大迭代次数 (" + MAX_ITERATIONS + ")，强制结束。");
process.exit(1);

export {};
