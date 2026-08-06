// bun-bot — 自我认知为 Bun.js 运行时的 agent。M1（P0+P1）：认识自己、能改自己 —— 自修改最小闭环成立（P0: AGENT_STATE.json / MEMORY.md 记忆；P1: run_script + read/write/list/bash 工具集）。P2-2 任务模式：--self 先 plan 后执行、逐项勾选、进度写回状态可续跑。P2-3 上下文预算：budget.ts token 估算 + tool result clearing（超限时压缩早期工具结果）。P2-4 checkpoint：--resume 会话级断点续跑（消息历史落盘 AGENT_CHECKPOINT.json，中断后恢复上下文继续）。P3 质量与防护：git 安全阀补 run_bash（写操作前自动快照）+ 测试闸门（收尾自动跑测试、失败自动回滚）+ 沙箱权限分级（路径限制工作区 / 危险命令黑名单）+ 审计日志（AUDIT.log.jsonl）。
// 用法: bun run index.ts [--stream] [--self] [--resume] "你的任务"（--stream 走 SSE 流式；--self 开任务模式；--resume 从上次断点续跑，可不带任务）
import { existsSync } from "node:fs";
import {
  workspace,
  loadState,
  saveState,
  syncMemoryFile,
  loadProjectContext,
  statePath,
  checkpointPath,
  saveCheckpoint,
  loadCheckpoint,
  clearCheckpoint,
  buildResumeMessages,
} from "./src/memory";
import { buildSystemPrompt } from "./src/context";
import { tools, executeTool, clipOutput } from "./src/tools";
import { currentHead, isGitRepo } from "./src/git";
import { enforceTestGate } from "./src/gate";
import { appendAudit } from "./src/audit";
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
// P2-4：--resume 从上次 checkpoint 恢复会话（可不带新任务；带了则作为追加指令）
const RESUME = args.includes("--resume");
const task = args.filter((a) => !a.startsWith("--")).join(" ");
if (!task && !RESUME) {
  console.error('用法: bun run index.ts [--stream] [--self] [--resume] "你的任务"（--resume 从上次断点续跑，可不带任务）');
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
const systemPrompt = buildSystemPrompt({ state, project, selfMode: SELF_MODE });
let messages: ChatMessage[] = [
  { role: "system", content: systemPrompt },
  { role: "user", content: task || "（--resume 恢复：请基于已有上下文继续执行上次未完成的任务。）" },
];

// P2-4：--resume checkpoint —— 从上次断点恢复会话消息历史（system 用最新提示词重建）
let resumedFromCheckpoint = false;
if (RESUME) {
  const ckpt = loadCheckpoint();
  if (ckpt && ckpt.length) {
    messages = [
      { role: "system", content: systemPrompt },
      ...buildResumeMessages(ckpt, task || undefined),
    ];
    resumedFromCheckpoint = true;
    console.error("[bun-bot] --resume：已从断点恢复会话（" + ckpt.length + " 条历史消息" +
      (task ? "，并追加新任务「" + task + "」" : "，无新任务直接续跑") + "）");
  } else {
    console.error("[bun-bot] --resume：未找到 checkpoint（" + checkpointPath() + "），按普通模式从新任务开始");
  }
}
// P2-3：本轮会话触发的上下文压缩告警（结束时写回 state.contextWarnings）
const sessionWarnings: string[] = [];

// P3-2：记录会话开始时的 HEAD —— 测试闸门失败时回滚到这里（会话前的状态）
const sessionStartHead = await currentHead();
// P3-2：本会话是否发生过自修改（write_file / 写操作 run_bash）→ 收尾触发测试闸门
let didModify = false;

console.error("[bun-bot] 工作区: " + workspace());
console.error("[bun-bot] 模型: " + MODEL + " | 流式: " + STREAM + " | 任务模式: " + SELF_MODE + " | 续跑: " + RESUME + " | 上下文预算: " + BUDGET_TOKENS + " tokens" + (sessionStartHead ? " | 会话起点 HEAD: " + sessionStartHead.slice(0, 8) : "（非 git 仓库，无回滚锚点）"));
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
  // P2-4：assistant 回复后落盘 checkpoint（含 tool_calls 的轮次是恢复的关键节点）
  saveCheckpoint(messages);

  if (!message.tool_calls?.length) {
    // 没有工具调用，任务完成：跑测试闸门（P3-2）→ 写回记忆、清除 checkpoint 后退出
    let finalContent = message.content ?? "";
    // P3-2：本会话发生过自修改 → 收尾自动跑测试；失败自动回滚到会话开始前
    if (didModify && isGitRepo(workspace())) {
      const gate = await enforceTestGate(sessionStartHead);
      if (!gate.passed || gate.rolledBack) {
        finalContent = finalContent + "\n\n--- 测试闸门（P3-2）---\n" + gate.output;
      }
    }
    if (!STREAM) console.log(finalContent);
    // 重新加载再写回：update_plan 可能已在会话中改过 activePlan，
    // 用旧 state 引用覆盖会把进度冲掉（防覆盖）
    const fresh = loadState();
    fresh.lastTask = task || (resumedFromCheckpoint ? "（--resume 续跑完成）" : task);
    fresh.lastSummary = finalContent;
    fresh.lastRunAt = new Date().toISOString();
    // P2-3：本轮压缩告警合并进 contextWarnings（保留最近 10 条）
    if (sessionWarnings.length) {
      fresh.contextWarnings = sessionWarnings.concat(fresh.contextWarnings).slice(0, 10);
    }
    saveState(fresh);
    syncMemoryFile(fresh);
    // P2-4：任务正常完成，清除断点（未完成的会话才保留 checkpoint）
    clearCheckpoint();
    process.exit(0);
  }

  for (const call of message.tool_calls) {
    // stderr 打印工具调用与结果摘要（完整结果回传模型）
    const argPreview = call.function.arguments.length > 400
      ? call.function.arguments.slice(0, 400) + "…"
      : call.function.arguments;
    console.error("\n--- [" + call.function.name + "] " + argPreview);
    const result = await executeTool(call.function.name, call.function.arguments);
    // P3-4：审计日志 —— 每次工具调用入参/出参摘要落盘 AUDIT.log.jsonl
    let parsedResult: { exitCode?: number; gitSnapshot?: string } | null = null;
    try {
      parsedResult = JSON.parse(result) as { exitCode?: number; gitSnapshot?: string };
    } catch {}
    appendAudit({
      ts: new Date().toISOString(),
      round: i + 1,
      tool: call.function.name,
      args: clipOutput(call.function.arguments, 400),
      result: clipOutput(result, 500),
      exitCode: parsedResult?.exitCode,
    });
    // P3-2：跟踪自修改 —— write_file 成功，或 run_bash 返回了 gitSnapshot（写操作命令）
    if (call.function.name === "write_file" && parsedResult && !("error" in parsedResult)) {
      didModify = true;
    } else if (call.function.name === "run_bash" && parsedResult?.gitSnapshot) {
      didModify = true;
    }
    const resultPreview = result.length > 2000 ? result.slice(0, 2000) + "\n… [结果过长，完整版已回传模型]" : result;
    console.error("\n" + resultPreview + "\n");
    messages.push({ role: "tool", tool_call_id: call.id, content: result });
    // 工具结果是主要增长点：入队后立即检查预算
    enforceBudget(i + 1);
    // P2-4：工具结果入队后落盘 checkpoint（中断在此刻也能恢复）
    saveCheckpoint(messages);
  }
}

console.error("达到最大迭代次数 (" + MAX_ITERATIONS + ") 或异常中断，checkpoint 已保存（" + checkpointPath() + "），可用 --resume 续跑。");
process.exit(1);

export {};
