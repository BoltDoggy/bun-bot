# skill: web-search — 联网搜索

- **version**: 2（2026-08 修正）
- **一句话**：联网搜索（Bing 主路径 + DDG 降级），附真实 HTML 解析模板与自测
- **代码**：`search.ts`（实现） / `self-test.ts`（自测） / `samples/`（离线样本）
- **自测**：`bun run skills/web-search/self-test.ts [--online]`

## 何时用

需要获取工作区之外的最新信息时（文档 API 变化、某库最新版本、某概念解释等）。
**不要**用它搜工作区里已有的东西（read_file / list_dir 更快更准）。

## 怎么做

```ts
import { searchWeb } from "./skills/web-search/search";

const r = await searchWeb("bun 最新版本", { timeoutMs: 20_000 });
if (r.results.length === 0) {
  console.log("搜索失败:", r.error); // 降级路径也失败时的原因
}
for (const x of r.results.slice(0, 5)) {
  console.log(x.title, "→", x.url);
  console.log("  ", x.snippet);
}
```

流程：**Bing 主路径 → 解析 0 条/请求失败 → 自动降级 DDG → 都失败返回 `engine:"none"` + error**。

## 踩坑（v1 → v2 的真实教训）

1. **cn.bing.com 会重定向**：请求 `https://cn.bing.com/search?q=...` 会落到 cn 站，UA 必须带上，否则可能被重定向到无结果页。
2. **v1 正则解析 0 条**：`<li class="b_algo">` 块内嵌了大量 `<link rel="stylesheet">` 和 siteicon 链接，全局 `href="http..."` 匹配会全被导航链接淹没。**必须按 b_algo 块切分，且只取 h2 里的 `a[href]`**。
3. **标题/摘要里有 HTML**：标题含 `<strong>`（关键词加粗），摘要有 `&ensp; &#0183; &amp;` 等实体。必须 `stripTags` + `decodeEntities`。
4. **DDG 降级不稳定**：DDG html 版对短时间重复请求会间歇返回 0 结果页或 202 挑战页（POST 必被拦）。已内置重试（2 次递增间隔 + 3s 兜底），但降级仍可能失败，调用方要能接受 `engine:"none"`。
5. **知识会过时**：Bing/DDG 的 HTML 结构都可能变。改了解析器必须跑 `self-test.ts`（离线样本兜底 + `--online` 实测），并把新的样本结构更新进 `samples/`。

## 模板：解析 Bing 结果（v2 核心正则）

```ts
const blockRe = /class="b_algo"[\s\S]*?<\/li>/g;   // 按结果块切分
let m;
while ((m = blockRe.exec(html)) !== null) {
  const block = m[0];
  const h2 = block.indexOf("<h2");                  // 只认 h2 里的链接
  const a = h2 >= 0 ? /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block.slice(h2)) : null;
  if (!a) continue;
  const url = a[1];
  const title = stripTags(decodeEntities(a[2]));    // 剥 <strong> + 解码实体
  const p = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block);  // 摘要
}
```

完整实现见 `search.ts`（含 DDG uddg 解码、重试、降级）。改这里时同步更新 self-test 的断言。

## 版本历史

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v2 | 2026-08 | 修正解析：按 b_algo 块切分 + h2 内取链接；加 DDG 降级与重试；加离线样本与自测 |
| v1 | 2026-08 | 首版（全局 href 正则，已被真实结构打脸，废弃） |
