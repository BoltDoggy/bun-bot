# 现状分析（as-is）

基于对 index.ts / src/ / skills/ / tests/ 的实际阅读与统计，更新于 **M1（P0+P1）+ skills 能力 + AGENTS.md 项目指令 + P2-1 工具描述 ACI 化 + P2-2 任务模式 + P2-3 上下文预算 + P2-4 --resume checkpoint 全部落地之后**。

## 快照数据

| 项 | 值 |
| --- | --- |
| index.ts | 216 行 / 9.7 KB（入口：CLI 解析（--stream / --self / --resume）+ agent 主循环 + 记忆读写钩子 + P2-3 预算检查 + P2-4 checkpoint 保存/恢复/清理） |
| src/ | tools.ts 438 行 / 18.9 KB · memory.ts 339 行 / 12.8 KB（含 checkpoint 模块）· context.ts 158 行 / 9.2 KB · budget.ts 103 行 / 3.9 KB · git.ts 41 行 / 1.5 KB |
| 工具数量 | 6 个：`run_script` / `read_file` / `write_file` / `list_dir` / `run_bash` / `update_plan`（skills 不加新工具） |
| 工具描述 ACI 化 | ✅ P2-1 已完成：6 个工具 `description` 均带「示例：」JSON 参数形态的 example usage，参数语义同步打磨；系统提示词 [能力] 区块带极简 few-shot（双保险） |
| 任务模式 | ✅ P2-2 已完成：`--self` 注入 [任务模式] 区块（先 plan 后执行、逐项勾选、未完成计划续跑提示）；`update_plan` 工具全量覆盖式创建/勾选计划；`AgentState.activePlan` 持久化 + MEMORY.md「当前任务计划」区块；主循环结束重载 state 防覆盖 |
| 上下文预算 | ✅ P2-3 已完成：`budget.ts`（`estimateTokens` 中英混合离线估算 / `estimateMessagesTokens` / `compressContext` 最轻档 tool result clearing）；主循环每轮检查预算，超限压缩最早 tool 结果（保留前缀 + 清理标记，消息结构不动）；告警写回 `AgentState.contextWarnings`（[记忆] 区块 + MEMORY.md「上下文预算告警」区块可见） |
| checkpoint | ✅ P2-4 已完成：`--resume` 会话级断点续跑 —— `AGENT_CHECKPOINT.json` 持久化当前会话消息历史（不含 system，恢复时重建），每次消息变更落盘；中断（Ctrl+C / 超迭代 / 崩溃）后 `--resume` 恢复完整上下文继续；任务正常完成自动清除 |
| 项目级指令 | `AGENTS.md`（可选）：存在时由 `loadProjectContext` 加载进 [项目] 区块最前，[规则] 第 5 条声明其约束力（优先级高于 README/docs）；不存在时静默跳过 |
| skills | 1 个：`web-search` v2（search.ts / self-test.ts / samples/），索引进 [能力] 区块，细节按需 read_file |
| 模型 | `deepseek-v4-flash`（`BUN_BOT_MODEL` 可换，如 `deepseek-v4-pro`） |
| 最大迭代 | 150 轮（`BUN_BOT_MAX_ITERATIONS` 可调） |
| 脚本超时 | 默认 30s（`DEFAULT_TIMEOUT_MS`），`timeoutMs` 可放开长任务 |
| 上下文预算 | 默认 120000 tokens（`BUN_BOT_CONTEXT_BUDGET` 可调），超限触发 tool result clearing |
| 工具输出上限 | 65536 字符（4K → 64KB），截断处带偏移信息可续读 |
| read_file 硬上限 | 1MB（`MAX_READ_BYTES`） |
| 记忆 | `AGENT_STATE.json` / `MEMORY.md` 本地跨会话持久化（gitignore，不纳入版本控制，避免每次会话的写回噪音）；含 `activePlan` 当前任务计划 + `contextWarnings` 预算告警；`AGENT_CHECKPOINT.json` 会话级消息历史（gitignore，任务完成即清除） |
| 自修改安全 | `write_file` 落盘前自动 git 快照 + 返回行级 diff 摘要 |
| 自测 | 30 用例 / 174 expect，零外部依赖（`bun test`）；web-search 另有 `self-test.ts --online` 在线实测 |

## 模块解剖

```text
index.ts              入口：CLI 解析（--stream / --self / --resume）+ agent 主循环 + 记忆读写钩子（结束重载 state 防覆盖 activePlan）+ 预算检查（超限压缩）+ checkpoint 保存/恢复/清理（--resume）
src/tools.ts          工具注册表：6 个工具的定义与执行器（新增工具在此注册）
src/context.ts        系统提示词组装：[身份] [能力] [项目] [记忆] [任务模式] [规则] + skills 索引 + AGENTS.md 约束声明 + contextWarnings 展示
src/memory.ts         记忆读写：AGENT_STATE.json / MEMORY.md（含 activePlan + contextWarnings）+ AGENT_CHECKPOINT.json（checkpoint 模块）+ AGENTS.md 项目指令 + 项目上下文加载
src/budget.ts         上下文预算：token 估算 + 最轻档压缩器（tool result clearing：最早的 tool 结果摘要化，消息结构不动）
src/git.ts            自修改前的 git 快照（M1 简化版，完整安全阀属 P3）
skills/               组合操作库：skills/<name>/SKILL.md + 实现 + 离线样本 + 自测
tests/tools.test.ts   self-test 用例（agent 修改自身代码后的验证闸门）
```

## 工具集（6 个，description 均带 example usage）

| 工具 | 说明 | 示例 |
| --- | --- | --- |
| `run_script` | Bun 运行 JS/TS，默认沙箱 tmpdir，可指定 cwd 到工作区；`timeoutMs` 可配；输出 64KB 带偏移 | `{"code":"console.log(1+1)"}` |
| `read_file` | 读工作区文件，默认完整返回 64KB，可 offset 续读（单次硬上限 1MB） | `{"path":"src/tools.ts","offset":65536}` |
| `write_file` | 写工作区文件，自动 git 快照 + 返回行级 diff 摘要（改自己代码就靠它） | `{"path":"src/hello.ts","content":"..."}` |
| `list_dir` | 列目录（`-a` 显示隐藏文件、`depth` 限制递归深度） | `{"path":".","all":true,"depth":2}` |
| `run_bash` | shell 命令，cwd 默认工作区，可跑 git / bun test 等 | `{"command":"bun test"}` |
| `update_plan` | 更新任务计划（任务模式，P2-2）：全量覆盖式创建/勾选，进度写回 AGENT_STATE.json 跨会话保存 | `{"title":"新增工具","items":[{"text":"注册","done":false}]}` |

## 任务模式（P2-2）

| 行为 | 说明 |
| --- | --- |
| 入口 | `bun run index.ts --self "任务"`：`--self` 标志注入 [任务模式] 区块 |
| 流程 | 首轮 `update_plan` 创建计划（title + 可独立验证的分步 items）→ 每完成一步全量提交并勾选（done + detail 验证结果）→ 全部 done 后总结 |
| 持久化 | `AgentState.activePlan`（title / items / status / createdAt / updatedAt）写回 `AGENT_STATE.json`，MEMORY.md 同步「当前任务计划」区块 |
| 续跑 | 会话重启后 [记忆] 区块展示进度；`--self` 模式下检测到未完成计划输出续跑提示，优先继续而非重建 |
| 防覆盖 | 主循环结束时 `loadState()` 重载再写回 lastTask/lastSummary，避免旧 state 引用冲掉会话中 update_plan 的写入 |
| 完成 | 全部 items done → status 自动置 `"done"`（百分比 100%） |

## 上下文预算（P2-3）

| 行为 | 说明 |
| --- | --- |
| 估算 | `estimateTokens`：ASCII 4 字符 ≈ 1 token、中文等 1 字符 ≈ 1 token（离线近似，用于相对预算检查，不调 tokenizer API） |
| 压缩 | `compressContext(messages, budget)`：超限时从最早的 `role="tool"` 消息开始，content 摘要化（保留前 200 字符 + 清理标记），直到低于预算或无可清理项 |
| 安全 | 消息数量与顺序不变、`tool_call_id` 关联保留（API 合法）、system 消息永不清理、未超限不复制数组 |
| 接入 | 主循环每轮（assistant 消息后 + 每个 tool 结果后）检查 `estimateMessagesTokens > BUDGET_TOKENS`，触发压缩并打印 `[budget]` 告警 |
| 告警 | 写回 `AgentState.contextWarnings`（保留最近 10 条），[记忆] 区块 + MEMORY.md「上下文预算告警」区块展示 —— agent 重启后能感知长任务触发过多少次压缩 |
| 配置 | `BUN_BOT_CONTEXT_BUDGET`（默认 120000） |

## checkpoint / --resume（P2-4）

| 行为 | 说明 |
| --- | --- |
| 入口 | `bun run index.ts --resume`（可不带任务直接续跑；带任务则作为追加指令） |
| 保存 | `saveCheckpoint(messages)`：每次消息变更（assistant 回复后 + 每个工具结果入队后）把当前历史落盘 `AGENT_CHECKPOINT.json`，**过滤 system**（恢复时用最新 `buildSystemPrompt` 重建，state/project 变了旧 system 会过时） |
| 恢复 | `--resume` 时 `loadCheckpoint()` 取历史 → `buildResumeMessages` 组装（末尾 tool 消息补 user 兜底保证 API 合法 + 可选新任务追加）→ system 重建后继续主循环 |
| 清理 | 任务正常完成（无 tool_calls 的最终回复）→ `clearCheckpoint()`；超迭代强制结束时 checkpoint 保留，可 `--resume` 续跑 |
| 与任务模式 | 互补：`activePlan`（P2-2）管**任务级目标**（首轮 plan、逐项勾选，重启可见进度）；checkpoint 管**会话级上下文**（完整消息历史，中断后不丢已执行的步骤） |
| 安全 | `AGENT_CHECKPOINT.json` 在 .gitignore（会话写回噪音，仅本地持久化） |

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
3. 组装系统提示词（`buildSystemPrompt`）→ 六区块（--self 时含 [任务模式]）+ skills 索引，预算 <5%
4. **`--resume` 时从 `AGENT_CHECKPOINT.json` 恢复会话消息历史**（system 重建 + 末尾 tool 兜底 + 可选新任务追加）
5. 循环：`chatCompletion` → 有 `tool_calls` 就 `executeTool` 并回填 → **每轮检查上下文预算，超限压缩早期 tool 结果（P2-3）** → **每次消息变更落盘 checkpoint（P2-4）** → 直到无工具调用
6. 任务完成 → **重载 `loadState()`** 后写回 `lastTask` / `lastSummary` / `lastRunAt` / `contextWarnings` → **`clearCheckpoint()`** → 退出

## 已解决的旧差距（M1 + skills + AGENTS.md + P2-1 + P2-2 + P2-3 + P2-4）

1. ~~不认识自己~~ → 系统提示词五区块，启动加载 README + docs 索引 + 记忆
2. ~~无记忆~~ → `AGENT_STATE.json` / `MEMORY.md` 持久化，重启可引用上次决策
3. ~~改不了自己~~ → 读写工作区的四工具 + git 快照，形成"读 → 改 → 测"闭环
4. ~~输出被截断~~ → 4000 → 65536 字符，截断带偏移可续读
5. ~~跨会话能力只能留在 lastSummary~~ → skills 组合操作库：SKILL.md 固化「多步 + 有坑 + 会过时」的操作（web-search v2 的修正教训永久沉淀），索引进提示词、按需 read_file、自带自测
6. ~~项目约定无处安放~~ → `AGENTS.md` 项目级指令：用户与 agent 的契约，加载进 [项目] 最前 + [规则] 声明约束力，接入通用 AGENTS.md 工具链
7. ~~工具描述无示例（few-shot 缺失）~~ → P2-1 工具描述 ACI 化：工具 description 均带 example usage + 参数语义打磨，[能力] 区块同步 few-shot（learn 工具设计五原则之五落地）
8. ~~长任务无目标锚点~~ → P2-2 任务模式：agent 首轮产出 plan、逐项勾选，进度写回 `AGENT_STATE.json`（activePlan），中断/重启后从上次断点继续
9. ~~长任务消息无限增长（context rot）~~ → P2-3 上下文预算：`budget.ts` token 估算 + 最轻档 tool result clearing（最早的 tool 结果摘要化，先保 recall 再迭代 precision），告警写回 contextWarnings
10. ~~中断丢上下文~~ → P2-4 `--resume` checkpoint：`AGENT_CHECKPOINT.json` 持久化会话消息历史（每次消息变更落盘），中断后恢复完整上下文继续，任务完成自动清除

## 仍存在的差距（M3）

9. **回滚靠手动**：git 快照已自动打，但测试闸门、自动 revert、审计日志属 P3，尚未落地。
10. **权限分级未实现**：Claude Code permissions 模式（全自动区 + 需确认区）属 P3。
11. **审计日志未实现**：每次工具调用的入参/出参摘要落盘属 P3。

> 迭代计划见 [PLAN.md](./PLAN.md)。
