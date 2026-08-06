# skills — 组合操作库

skills 是**组合操作**：建在 5 个原子工具之上（run_script / read_file / write_file / list_dir / run_bash），
把「多步、有坑、会过时」的操作固化成可复用的 SKILL.md。**不加新工具**，加载用现有 read_file 按需读取。

## 约定

- 每个 skill 一个目录：`skills/<name>/SKILL.md`，必须带 `version` 字段。
- SKILL.md 结构：何时用 / 怎么做 / 踩坑 / 模板代码 / 自测命令。
- **知识会过时**：skill 必须带自测命令（离线样本兜底 + 可选在线验证），纳入测试闸门；
  改了解析逻辑或发现线上结构变化，必须更新样本并跑自测。
- 系统提示词只放**这一层索引**（本文件），细节按需 `read_file skills/<name>/SKILL.md`。

## 索引

| skill | 一句话 | 版本 | 自测 |
| --- | --- | --- | --- |
| web-search | 联网搜索（Bing 主路径 + DDG 降级），附真实 HTML 解析模板 | v2 | `bun run skills/web-search/self-test.ts` |

> 本文件被 `src/context.ts` 的 [能力] 区块引用（自动提取索引表格进系统提示词）。
