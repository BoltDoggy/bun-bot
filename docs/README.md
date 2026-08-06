# 迭代计划（docs 索引）

| 文档 | 说明 |
| --- | --- |
| [PLAN.md](./PLAN.md) | **主计划**：拥抱 1M 上下文，把 bun-bot 从"脚本执行器"迭代成"能读懂自己、修改自己、记住自己"的长期 agent。P0/P1/skills/AGENTS.md/P2-1/P2-2/P2-3/P2-4 已完成并勾选，**P2 全部收官**，P3 待办 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 现状分析（as-is）：随代码演进更新，当前快照基于 M1（P0+P1）+ skills 能力 + AGENTS.md + P2-1 工具描述 ACI 化 + P2-2 任务模式 + P2-3 上下文预算 + P2-4 --resume checkpoint 全部落地后的实际代码 |

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
- ⏳ **M3（P3）待办**：git 安全阀补 run_bash、测试闸门自动 revert、沙箱权限分级、审计日志

## 与主 README 的关系

主 [README.md](../README.md) 面向使用者（快速开始 / 工具集 / 配置项）；本目录面向**自我迭代**（计划 / 现状 / 进度），是 agent 启动时加载的"项目上下文"一部分。

> 更新时间：2026-08 · 起点 = 模型支持 1M 上下文 · 最新修订 = ARCHITECTURE 快照对齐 M1 + skills + AGENTS.md + P2-1 + P2-2 + P2-3 + P2-4 后代码（P2 全部完成）
