/**
 * search.ts — web-search skill 的核心实现（v2）
 *
 * v2 修正记录（2026-08）：cn.bing.com 会把请求重定向到 cn.bing.com 且结果块
 * `<li class="b_algo">` 内嵌大量 css link + siteicon 链接，v1 的全局
 * `href="http..."` 正则会解析出 0 条（全被导航链接淹没）。
 * v2 改为「按 b_algo 块切分 → 块内取 h2 > a[href] 为标题链接」。
 *
 * 使用：import { searchWeb } from "./search";
 * 自测：bun run skills/web-search/self-test.ts
 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOutcome {
  engine: "bing" | "ddg" | "none";
  results: SearchResult[];
  error?: string;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** 解码 HTML 实体（&amp; &lt; &#0183; &ensp; 等） */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|ensp|emsp|middot);/gi, (m, e) => {
    const lower = e.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) {
      const cp = parseInt(lower.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    switch (lower) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      case "nbsp":
      case "ensp":
      case "emsp": return " ";
      case "middot": return "·";
    }
    return m;
  });
}

/** 剥掉 HTML 标签并压缩空白 */
export function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/** 解析 Bing 搜索结果 HTML（v2：按 b_algo 块切分，块内取 h2 > a[href]） */
export function parseBingHtml(html: string): SearchResult[] {
  const out: SearchResult[] = [];
  const blockRe = /class="b_algo"[\s\S]*?<\/li>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    const block = m[0];
    // 标题链接：块内第一个 a[href]（h2 里的）。siteicon/tilk 链接在 h2 之前，不匹配 h2 规则。
    const h2 = block.indexOf("<h2");
    const a = h2 >= 0 ? /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block.slice(h2)) : null;
    if (!a) continue;
    const url = a[1];
    if (!/^https?:\/\//.test(url)) continue;
    const title = decodeEntities(stripTags(a[2]));
    // 摘要：块内第一个 <p>
    const p = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block);
    const snippet = p ? decodeEntities(stripTags(p[1])) : "";
    if (title) out.push({ title, url, snippet });
  }
  return out;
}

/** 解析 DuckDuckGo html 版结果（降级用） */
export function parseDdgHtml(html: string): SearchResult[] {
  const out: SearchResult[] = [];
  const snippets: string[] = [];
  const snipRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let s: RegExpExecArray | null;
  while ((s = snipRe.exec(html)) !== null) snippets.push(decodeEntities(stripTags(s[1])));
  const titleRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = titleRe.exec(html)) !== null) {
    let url = m[1];
    // DDG 用重定向链接，真实地址藏在 uddg 参数里
    const uddg = /[?&]uddg=([^&]+)/.exec(url);
    if (uddg) {
      try { url = decodeURIComponent(uddg[1]); } catch { /* 保留原样 */ }
    }
    if (!/^https?:\/\//.test(url)) continue;
    out.push({ title: decodeEntities(stripTags(m[2])), url, snippet: snippets[i] ?? "" });
    i++;
  }
  return out;
}

/**
 * 单次请求抓取搜索页 HTML。带重试：
 * - 网络错误 / 非 2xx → 重试
 * - DDG 反爬会间歇返回 202 挑战页或 0 结果页 → status 202 视为失败重试
 */
async function fetchHtml(url: string, timeoutMs: number, retries = 2): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 202) throw new Error("HTTP 202（疑似 DDG 反爬挑战页）");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const html = await res.text();
      if (html.length < 2000) throw new Error("响应过短（" + html.length + " 字符，疑似反爬页）");
      return html;
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

/** 主路径：cn.bing.com（会被重定向，UA 必须带上） */
async function tryBing(query: string, timeoutMs: number): Promise<SearchOutcome> {
  const url = "https://cn.bing.com/search?q=" + encodeURIComponent(query);
  const html = await fetchHtml(url, timeoutMs);
  const results = parseBingHtml(html);
  return { engine: "bing", results };
}

/** 降级路径：DuckDuckGo html 版（bing 解析 0 条或请求失败时用；不稳定，内部再兜一轮） */
async function tryDdg(query: string, timeoutMs: number): Promise<SearchOutcome> {
  let results: SearchResult[] = [];
  let lastError = "";
  for (let attempt = 0; attempt < 2 && results.length === 0; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
    try {
      const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
      const html = await fetchHtml(url, timeoutMs, 1);
      results = parseDdgHtml(html);
      if (results.length === 0) lastError = "ddg 返回 0 条";
    } catch (e) {
      lastError = "ddg 请求失败: " + (e instanceof Error ? e.message : String(e));
    }
  }
  if (results.length === 0 && lastError) throw new Error(lastError);
  return { engine: "ddg", results };
}

/**
 * 联网搜索：Bing 主路径 → 失败/0 条降级 DDG → 都失败返回 none。
 * 超时默认 15s（可按需放大）。
 */
export async function searchWeb(
  query: string,
  opts: { timeoutMs?: number } = {},
): Promise<SearchOutcome> {
  const timeout = opts.timeoutMs ?? 15_000;
  const errors: string[] = [];
  try {
    const bing = await tryBing(query, timeout);
    if (bing.results.length > 0) return bing;
    errors.push("bing 返回 0 条");
  } catch (e) {
    errors.push("bing 请求失败: " + (e instanceof Error ? e.message : String(e)));
  }
  try {
    const ddg = await tryDdg(query, timeout);
    if (ddg.results.length > 0) return ddg;
    errors.push("ddg 返回 0 条");
  } catch (e) {
    errors.push("ddg 请求失败: " + (e instanceof Error ? e.message : String(e)));
  }
  return { engine: "none", results: [], error: errors.join("；") };
}
