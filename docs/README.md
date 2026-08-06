# 迭代计划（docs 索引）

| 文档 | 说明 |
| --- | --- |
| [PLAN.md](./PLAN.md) | **主计划**：拥抱 1M 上下文，把 bun-bot 从"脚本执行器"迭代成"能读懂自己、修改自己、记住自己"的长期 agent。P0/P1/skills/AGENTS.md/P2-1 ~ P2-4/P3/**P4 通用化** 已完成并勾选，**P2 + P3 + P4 全部收官** |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 现状分析（as-is）：随代码演进更新，当前快照基于 M1（P0+P1）+ skills 能力 + AGENTS.md + P2-1 ~ P2-4 + P3 质量与防护 + **P4 通用化（可在任意项目使用）** 全部落地后的实际代码 |

## 里程碑进度

- ✅ **M1（P0+P1）已完成**：agent 认识自己、能改自己的文件 —— 自修改最小闭环成立
  - P0: 结构化自我认知 + `AGENT_STATE.json` / `MEMORY.md` 跨会话记忆，启动加载项目上下文
  - P1: 工具注册表 `src/tools.ts`（run_script 升级 + read_file / write_file / list_dir / run_bash，共 5 工具）
  - 验收: `bun run index.ts "把 index.ts 顶部的注释改成两行"` 真实落盘 + diff 可见 + 测试全绿
  - 自测: `bun test` 17 用例全绿（工具层 + 记忆层 + skills 层 + AGENTS.md，零外部依赖）
- ✅ **skills 组合操作库（附加能力）已完成**：跨会话能力沉淀
  - `skills/<name>/SKILL.md` 固化「多步 + 有坑 + 会过时」的操作，索引进 [能力] 区块，细节按需 read_file
  - 首个 skill：`web-search` v2（Bing 主路径 + DDG 降级 + 离线样本 + 自测；v1 全局正则被真实结构打脸的教训已沉淀）
  - 设计决策：**不加新工具**，用现有 read_file 加载；skill 必须带版本号 + 自测命令，纳入测试闸门
  - 自测: `bun test` + `bun run skills/web-search/self-test.ts --online`
- ✅ **AGENTS.md 项目级指令（附加能力）已完成**：项目约定有处安放
  - `AGENTS.md`（可选）存在时由 `loadProjectContext` 加载进 [项目] 区块最前，优先级高于 README / docs
  - `buildSystemPrompt` [规则] 第 5 条声明其约束力（内容冲突时以 AGENTS.md 为准）；不存在时静默跳过，老项目不受影响
  - 自测: `bun test` 新增 2 用例（缺失跳过 / 存在加载且优先）
- ✅ **P2-1 工具描述 ACI 化（M2 第一项）已完成**：工具描述当 prompt 打磨（learn 工具设计五原则之五）
  - `src/tools.ts`：5 个工具 `description` 均带「示例：」JSON 参数形态的 example usage，参数语义同步打磨
  - `src/context.ts`：[能力] 区块工具描述同步带极简 few-shot（双保险）
  - 自测: `bun test` 新增 2 用例固化验收（5 工具 description 均含示例 / 系统提示词含示例），19 用例 / 87 expect 全绿
- ✅ **P2-2 任务模式（M2 第二项）已完成**：长任务有目标锚点，中断可续跑
  - `update_plan` 工具（全量覆盖式）：首轮创建计划（title + 分步 items）→ 每完成一步勾选（done + detail）→ 全部 done 自动 status=done
  - `AgentState.activePlan` 持久化 + MEMORY.md 同步「当前任务计划」区块；主循环结束重载 state 防覆盖
  - `--self` 标志注入 [任务模式] 区块（先 plan 后执行、逐项勾选、未完成计划续跑提示）
  - 自测: `bun test` 新增 3 用例固化验收（update_plan 创建/勾选/记忆往返 / 参数校验 / 任务模式提示词），22 用例 / 126 expect 全绿
- ✅ **P2-3 上下文预算（M2 第三项）已完成**：长任务不爆预算、不丢上下文（learn 上下文工程三件套之一）
  - `src/budget.ts`：`estimateTokens`（中英混合离线估算，无需调 tokenizer API）/ `estimateMessagesTokens` / `compressContext`（最轻档 **tool result clearing**：最早的 tool 消息 content 摘要化，保留前缀 + 清理标记，消息结构不动、tool_call_id 关联保留、system 永不清理）
  - `index.ts` 主循环每轮检查预算（`BUN_BOT_CONTEXT_BUDGET` 可配，默认 120000），超限压缩并把告警写回 `AgentState.contextWarnings`（[记忆] 区块 + MEMORY.md「上下文预算告警」区块可见）
  - 自测: `bun test` 新增 6 用例固化验收（估算 / 不超限不动 / 先清最老 / 结构保留 / 多轮不无限循环 / 告警展示），**28 用例 / 155 expect 全绿**
- ✅ **P2-4 --resume checkpoint（M2 收官项）已完成**：中断不丢上下文，长任务闭环
  - `src/memory.ts` checkpoint 模块：`AGENT_CHECKPOINT.json` 持久化会话消息历史（不含 system，恢复时重建）；`saveCheckpoint`（每次消息变更落盘）/ `loadCheckpoint` / `clearCheckpoint`（任务完成清除）/ `buildResumeMessages`（末尾 tool 补 user 兜底 + 可选新任务追加）
  - `index.ts` `--resume` 标志：可不带任务直接续跑，带任务作为追加指令；超迭代强制结束时 checkpoint 保留可续跑
  - 与任务模式互补：`activePlan` 管任务级目标锚点，checkpoint 管会话级完整上下文
  - 自测: `bun test` 新增 2 用例固化验收（save/load/clear 往返 / buildResumeMessages），**30 用例 / 174 expect 全绿**
- ✅ **M2（P2）已完成**：P2-1 ACI 化 + P2-2 任务模式 + P2-3 上下文预算 + P2-4 --resume checkpoint 全部收官，长任务「不爆预算、不丢上下文、中断可续跑」闭环成立
- ✅ **M3（P3）已完成**：自修改可信、可回滚、不跑飞
  - P3-1 git 安全阀补 `run_bash`：`src/git.ts` 新增 `hasUncommittedChanges` / `snapshotIfDirty` / `currentHead`，写操作命令前自动快照（只读命令不产生噪音提交）
  - P3-2 测试闸门：`src/gate.ts`（`runTestGate` / `revertToHead` / `enforceTestGate`），主循环收尾 didModify 时自动跑测试，失败自动回滚到会话前 HEAD + 复测（verify its work）
  - P3-3 沙箱权限分级：路径限制工作区内（`BUN_BOT_ALLOW_OUTSIDE_CWD=1` 放行）、危险命令黑名单（rm -rf /、git push、fork bomb 等）、`BUN_BOT_PERMISSIONS=ask` 写操作需确认
  - P3-4 审计日志：`src/audit.ts` 每次工具调用入参/出参摘要落盘 `AUDIT.log.jsonl`（gitignore）
  - 自测: `bun test` 新增 5 用例固化验收（run_bash 快照 / 路径限制 / 危险命令 / 审计往返 / 测试闸门回滚模拟），**35 用例 / 225 expect 全绿**；`bun build index.ts` 编译通过
- ✅ **M4（P4 通用化）已完成**：可在**任意项目**使用 bun-bot
  - P4-① 身份/项目认知去专用化（context.ts）：`AGENT_IDENTITY` / `.bunbot.json identity` 可配置；关键文件按存在性动态生成（无 src/ 的项目不出现 bun-bot 特有路径）→ `tests/p4-context.test.ts`（3 用例）
  - P4-② 项目级配置 `.bunbot.json`（新增 src/config.ts）：环境变量 > 项目配置 > 全局配置 > 默认值，支持 model/budget/permissions/testCommand/identity/stateDir/ignore/allowCommands → `tests/p4-config.test.ts`（5 用例）
  - P4-③ 状态文件不污染目标仓库：AGENT_STATE/MEMORY/CHECKPOINT/AUDIT 移入 `.bunbot/`（saveState 自动 ensureStateDir + .gitignore 幂等追加）；旧位置兼容读取不自动删除 → `tests/p4-state-dir.test.ts`（4 用例）
  - P4-④ 通用测试闸门（gate.ts）：`detectTestCommand` 多生态探测（package.json→bun test、pyproject→pytest、Cargo→cargo test、go.mod→go test、tests/ 兜底）+ testCommand 配置优先 → `tests/p4-gate.test.ts`（5 用例）
  - P4-⑤ CLI 分发与 init：`bin/bun-bot.ts`（bun link 全局安装；init 生成 AGENTS.md 模板 + .bunbot.json + .gitignore 条目；--version / --help）→ `tests/p4-cli.test.ts`（5 用例）
  - P4-⑥ 只读模式与权限细化：`BUN_BOT_PERMISSIONS=readonly`（write_file / 写操作 run_bash / update_plan 拒绝）+ ask 白名单 `allowCommands` → `tests/p4-readonly.test.ts`（5 用例）
  - P4-⑦ 全局配置 `~/.bun-bot/config.json`：默认模型/权限/API key fallback（DEEPSEEK_API_KEY 未设置时用全局）；多项目状态天然按 `.bunbot/` 隔离 → `tests/p4-global.test.ts`（4 用例）
  - P4-⑧ 大项目上下文加载：buildFileTree 感知 .gitignore + 扩展忽略（vendor/target/__pycache__/.venv 等）+ 行数预算截断（超限提示 list_dir）→ `tests/p4-filetree.test.ts`（4 用例）
  - P4-⑨ 交互模式 `--interactive`：多轮 REPL 对话连续（src/interactive.ts，runRound 可注入离线测试）+ index.ts 主循环提取 runAgentLoop → `tests/p4-interactive.test.ts`（4 用例）
  - 自测: `bun test` **74 用例 / 441 expect 全绿**；`bun build index.ts` 编译通过

## 与主 README 的关系

主 [README.md](../README.md) 面向使用者（快速开始 / 工具集 / 配置项）；本目录面向**自我迭代**（计划 / 现状 / 进度），是 agent 启动时加载的"项目上下文"一部分。

> 更新时间：2026-08 · 起点 = 模型支持 1M 上下文 · 最新修订 = ARCHITECTURE 快照对齐 M1 + skills + AGENTS.md + P2-1 ~ P2-4 + P3 + **P4 通用化** 后代码（P2 + P3 + P4 全部完成）
