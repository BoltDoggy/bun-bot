/**
 * budget.ts — 上下文 token 预算（P2-3）
 *
 * 动机：1M 上下文也非无限，且 context rot 真实存在（token 越多模型回忆越差，
 *       见 learn/raw/anthropic-effective-context-engineering.md）。
 *       长任务会不断累积工具结果，需要主动压缩早期消息。
 *
 * 压缩策略（从最轻档做起，先保 recall 再迭代 precision）：
 *   tool result clearing —— 工具结果用过即清：把最早的 role="tool" 消息的
 *   content 替换成短摘要（保留前若干字符 + 清理标记），消息结构不动
 *   （tool_call_id 关联必须保留，删消息会让 API 400；摘要化则完全安全）。
 *
 * 后续可迭代的更重档：压缩早期 assistant 文本、合并早期轮次、整段折叠成摘要。
 */
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/** 默认上下文预算（token）。1M 模型下仍留余量，可环境变量 BUN_BOT_CONTEXT_BUDGET 覆盖 */
export const DEFAULT_BUDGET_TOKENS = 120_000;
/** 清理工具结果时保留的前缀字符数（够模型认出"这是哪一步的结果"即可） */
export const TOOL_RESULT_KEEP_CHARS = 200;

/**
 * 估算一段文本的 token 数（离线近似，无需调 tokenizer API）：
 *   - 非 ASCII（中文等）：1 字符 ≈ 1 token
 *   - ASCII（英文/数字/符号）：4 字符 ≈ 1 token
 * 用于触发压缩的"相对预算检查"，不需要精确到个位。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++;
    else other++;
  }
  return Math.ceil(other + ascii / 4);
}

/** 估算整段对话（messages）的 token 数：content + tool_calls 全算 */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let sum = 0;
  for (const m of messages) sum += estimateTokens(JSON.stringify(m));
  return sum;
}

export interface CompressionResult {
  messages: ChatMessage[];
  /** 清理了几条工具结果 */
  cleared: number;
  beforeTokens: number;
  afterTokens: number;
}

/**
 * 最轻档上下文压缩：tool result clearing。
 * 超预算时从最早的 role="tool" 消息开始，把 content 摘要化（保留前
 * TOOL_RESULT_KEEP_CHARS 字符 + 清理标记），直到总 token 低于预算、
 * 或没有可清理的工具结果为止。
 *
 * 保证：消息数量与顺序不变，tool_call_id 关联保留（API 合法），
 *       system 消息永不清理。未超限时原样返回（不复制数组）。
 */
export function compressContext(
  messages: ChatMessage[],
  budgetTokens: number,
): CompressionResult {
  const beforeTokens = estimateMessagesTokens(messages);
  let current = messages;
  let cleared = 0;

  for (let i = 1; i < current.length && estimateMessagesTokens(current) > budgetTokens; i++) {
    const m = current[i];
    if (m.role !== "tool" || m.content == null) continue;
    const orig = m.content;
    const keep = orig.length <= TOOL_RESULT_KEEP_CHARS
      ? orig
      : orig.slice(0, TOOL_RESULT_KEEP_CHARS) +
        "\n…[工具结果已清理（context budget），原始 " + orig.length +
        " 字符，如需完整内容请重新调用工具]";
    if (keep === orig) continue; // 已够短，清了也没意义
    // 惰性复制：只在真正要改时复制数组
    current = current.map((mm, idx) => (idx === i ? { ...mm, content: keep } : mm));
    cleared++;
  }

  return {
    messages: current,
    cleared,
    beforeTokens,
    afterTokens: estimateMessagesTokens(current),
  };
}
