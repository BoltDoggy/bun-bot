/**
 * self-test.ts — web-search skill 自测（纳入测试闸门）
 *
 * 默认离线：用 samples/ 里的真实抓取样本验证解析器（不依赖网络，测试环境可用）。
 * --online：额外做真实联网搜索，验证 Bing 主路径 + DDG 降级（网络环境可选）。
 *
 * 运行：bun run skills/web-search/self-test.ts [--online]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBingHtml, parseDdgHtml, searchWeb } from "./search";

const ok = (cond: boolean, msg: string): void => {
  console.log((cond ? "✅ PASS " : "❌ FAIL ") + msg);
  if (!cond) process.exitCode = 1;
};

// ---------- 离线：解析器对真实样本 ----------
const bingSample = readFileSync(join(import.meta.dir, "samples", "bing.html"), "utf8");
const ddgSample = readFileSync(join(import.meta.dir, "samples", "ddg.html"), "utf8");

const bing = parseBingHtml(bingSample);
console.log("Bing 样本解析出 " + bing.length + " 条");
ok(bing.length === 3, "Bing 样本应解析出 3 条（实测 " + bing.length + "）");
ok(bing[0]?.url === "https://bun.sh/", "首条 URL 应为 https://bun.sh/（实测 " + bing[0]?.url + "）");
ok((bing[0]?.title ?? "").startsWith("Bun"), "首条标题应含 Bun（实测 " + JSON.stringify(bing[0]?.title) + "）");
ok((bing[0]?.snippet ?? "").includes("JavaScript runtime"), "首条摘要应含原文（实测 " + JSON.stringify(bing[0]?.snippet?.slice(0, 60)) + "…）");
ok(!(bing[0]?.title ?? "").includes("<strong>"), "标题不应残留 HTML 标签");
ok(!(bing[0]?.title ?? "").includes("&amp;"), "标题不应残留 HTML 实体");

const ddg = parseDdgHtml(ddgSample);
console.log("DDG 样本解析出 " + ddg.length + " 条");
ok(ddg.length === 2, "DDG 样本应解析出 2 条（实测 " + ddg.length + "）");
ok(ddg[0]?.url === "https://bun.sh/", "DDG 首条 URL 应解码 uddg 为 https://bun.sh/（实测 " + ddg[0]?.url + "）");
ok((ddg[0]?.snippet ?? "").includes("Bundle"), "DDG 首条摘要应含原文");

// ---------- 在线（可选）：真实搜索 ----------
if (process.argv.includes("--online")) {
  console.log("\n--online：真实联网验证 --");
  const r = await searchWeb("bun javascript runtime", { timeoutMs: 20_000 });
  console.log("engine:", r.engine, "| 结果数:", r.results.length, r.error ? "| error: " + r.error : "");
  ok(r.results.length > 0, "在线搜索应返回结果（engine=" + r.engine + "）");
  if (r.results[0]) console.log("  首条:", r.results[0].title, "→", r.results[0].url);
} else {
  console.log("\n（跳过在线验证，加 --online 可跑真实搜索）");
}

console.log(process.exitCode ? "\n自测失败" : "\n自测通过");
