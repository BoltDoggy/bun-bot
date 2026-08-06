# 现状分析（as-is）

基于对 index.ts / src/ / skills/ / tests/ 的实际阅读与统计，更新于 **M1（P0+P1）+ skills 能力 + AGENTS.md 项目指令 + P2-1 工具描述 ACI 化落地之后**。

## 快照数据

| 项 | 值 |
| --- | --- |
| index.ts | 162 行 / 5.1 KB（入口：CLI 解析 + agent 主循环，保持轻量） |
| src/ | tools.ts 353 行 / 12.5 KB · context.ts 116 行 / 4.6 KB · memory.ts 217 行 / 6.0 KB · git.ts 41 行 / 1.2 KB |
| 工具数量 | 5 个：`run_script` / `read_file` / `write_file` / `list_dir` / `run_bash`（skills 不加新工具） |
| 工具描述 ACI 化 | ✅ P2-1 已完成：5 个工具 `description` 均带「示例：」JSON 参数形态的 example usage，参数语义同步打磨；系统提示词 [能力] 区块带极简 few-shot（双保险） |
| 项目级指令 | `AGENTS.md`（可选）：存在时由 `loadProjectContext` 加载进 [项目] 区块最前，[规则] 第 5 条声明其约束力（优先级高于 README/docs）；不存在时静默跳过 |
| skills | 1 个：`web-search` v2（search.ts / self-test.ts / samples/），索引进 [能力] 区块，细节按需 read_file |
| 模型 | `deepseek-v4-flash`（`BUN_BOT_MODEL` 可换，如 `deepseek-v4-pro`） |
| 最大迭代 | 150 轮（`BUN_BOT_MAX_ITERATIONS` 可调） |
| 脚本超时 | 默认 30s（`DEFAULT_TIMEOUT_MS`），`timeoutMs` 可放开长任务 |
| 工具输出上限 | 65536 字符（4K → 64KB），截断处带偏移信息可续读 |
| read_file 硬上限 | 1MB（`MAX_READ_BYTES`） |
| 记忆 | `AGENT_STATE.json` / `MEMORY.md` 本地跨会话持久化（gitignore，不纳入版本控制，避免每次会话的写回噪音） |
| 自修改安全 | `write_file` 落盘前自动 git 快照 + 返回行级 diff 摘要 |
| 自测 | 19 用例 / 87 expect，零外部依赖（`bun test`）；web-search 另有 `self-test.ts --online` 在线实测 |

## 模块解剖

```text
index.ts              入口：CLI 解析（--stream）+ agent 主循环 + 记忆读写钩子
src/tools.ts          工具注册表：5 个工具的定义与执行器（新增工具在此注册）
src/context.ts        系统提示词组装：[身份] [能力] [项目] [记忆] [规则] 五区块 + skills 索引 + AGENTS.md 约束声明
src/memory.ts         记忆读写：AGENT_STATE.json / MEMORY.md + AGENTS.md 项目指令 + 项目上下文加载
src/git.ts            自修改前的 git 快照（M1 简化版，完整安全阀属 P3）
skills/               组合操作库：skills/<name>/SKILL.md + 实现 + 离线样本 + 自测
tests/tools.test.ts   self-test 用例（agent 修改自身代码后的验证闸门）
```

## 工具集（5 个，description 均带 example usage）

| 工具 | 说明 | 示例 |
| --- | --- | --- |
| `run_script` | Bun 运行 JS/TS，默认沙箱 tmpdir，可指定 cwd 到工作区；`timeoutMs` 可配；输出 64KB 带偏移 | `{"code":"console.log(1+1)"}` |
| `read_file` | 读工作区文件，默认完整返回 64KB，可 offset 续读（单次硬上限 1MB） | `{"path":"src/tools.ts","offset":65536}` |
| `write_file` | 写工作区文件，自动 git 快照 + 返回行级 diff 摘要（改自己代码就靠它） | `{"path":"src/hello.ts","content":"..."}` |
| `list_dir` | 列目录（`-a` 显示隐藏文件、`depth` 限制递归深度） | `{"path":".","all":true,"depth":2}` |
| `run_bash` | shell 命令，cwd 默认工作区，可跑 git / bun test 等 | `{"command":"bun test"}` |

## 项目级指令（AGENTS.md，可选）

| 行为 | 说明 |
| --- | --- |
| 加载时机 | `loadProjectContext()` 读取工作区根 `AGENTS.md`（`readAgentDirective()`），存在则置于项目认知最前 |
| 优先级 | 高于 README / docs：它是用户与 agent 之间的项目级契约 |
| 约束声明 | `buildSystemPrompt` 的 [规则] 第 5 条：内容冲突时以 AGENTS.md 为准 |
| 上限 | 8000 字符截断提示（与 README 同级），需完整内容可 read_file |
| 缺失时 | 返回 null / 静默跳过，老项目系统提示词不变 |

## skills（组合操作层，建在工具之上）

| skill | 一句话 | 版本 | 自测 |
| --- | --- | --- | --- |
| `web-search` | 联网搜索（Bing 主路径 + DDG 降级） | v2 | `bun run skills/web-search/self-test.ts [--online]` |

加载机制：`context.ts` 的 `skillsIndex()` 从 `skills/README.md` 提取索引表格进 [能力] 区块（只此一层）；
需要细节时用现有 `read_file` 读 `skills/<name>/SKILL.md` —— **不加新工具**。

## agent 主循环（index.ts）

1. 加载记忆（`loadState`）；首次运行初始化 `AGENT_STATE.json` / `MEMORY.md`
2. 加载项目上下文（`loadProjectContext`）→ AGENTS.md（如有）+ README + docs + 文件树 + 记忆
3. 组装系统提示词（`buildSystemPrompt`）→ 五区块 + skills 索引，预算 <5%
4. 循环：`chatCompletion` → 有 `tool_calls` 就 `executeTool` 并回填 → 直到无工具调用
5. 任务完成 → 写回 `lastTask` / `lastSummary` / `lastRunAt` → 退出

## 已解决的旧差距（M1 + skills + AGENTS.md + P2-1）

1. ~~不认识自己~~ → 系统提示词五区块，启动加载 README + docs 索引 + 记忆
2. ~~无记忆~~ → `AGENT_STATE.json` / `MEMORY.md` 持久化，重启可引用上次决策
3. ~~改不了自己~~ → 读写工作区的四工具 + git 快照，形成"读 → 改 → 测"闭环
4. ~~输出被截断~~ → 4000 → 65536 字符，截断带偏移可续读
5. ~~跨会话能力只能留在 lastSummary~~ → skills 组合操作库：SKILL.md 固化「多步 + 有坑 + 会过时」的操作（web-search v2 的修正教训永久沉淀），索引进提示词、按需 read_file、自带自测
6. ~~项目约定无处安放~~ → `AGENTS.md` 项目级指令：用户与 agent 的契约，加载进 [项目] 最前 + [规则] 声明约束力，接入通用 AGENTS.md 工具链
7. ~~工具描述无示例（few-shot 缺失）~~ → P2-1 工具描述 ACI 化：5 工具 description 均带 example usage + 参数语义打磨，[能力] 区块同步 few-shot（learn 工具设计五原则之五落地）

## 仍存在的差距（M2 / M3）

8. **长任务无支撑**：没有进度 checkpoint、没有 `--resume` 续跑、没有上下文预算管理（`budget.ts` 未实现），>100 轮容易迷失。
9. **任务模式未实现**：agent 首轮产出 plan 逐项勾选、进度写回 `AGENT_STATE.json` 尚未落地（P2 第 2 项）。
10. **回滚靠手动**：git 快照已自动打，但测试闸门、自动 revert、审计日志属 P3，尚未落地。
11. **`--self` 模式未实现**：还不能"只出 diff 预览 → 确认后应用"，自迭代仍需人在场确认。

> 迭代计划见 [PLAN.md](./PLAN.md)。
