# AGENTS.md — 项目级指令（bun-bot 自动加载，优先级最高）

> `/init` 生成于 2026-08-06：分析代码库后固化的项目级契约。
> bun-bot 每次启动自动加载本文件（连同 BUN_BOT.md），约束力高于 [项目] 区块中 README / docs 的描述；
> 内容冲突时以本文件为准（[规则] 第 5 条已声明）。
> 改动本文件涉及行为变更时，同步更新 README / docs / tests 并跑 `bun test`。
> 2026-08 P6-2：AGENTS.md 精简为**通用项目契约**，bun-bot 自研细节（运行/构建、可调变量、测试闸门、架构决策、踩坑）拆入 BUN_BOT.md 一并加载。

## 项目约定

- **本仓库 = bun-bot 自身**（自我进化的 agent）：改动代码必须跑测试闸门 `bun test`（91 用例 / 530 expect，零外部依赖）全绿；新增能力必须补测试用例（tests/ 是自我进化的验证闸门）
- 注释、文档、回复用**中文**；代码风格与现有保持一致（双引号 + 分号）
- 提交信息用 conventional commits（`feat:` / `fix:` / `docs:` / `refactor:`）；`write_file` 的自动快照提交无需手动处理
- 代码改动后按需同步 README / docs（面向自我迭代）
- 本文件优先：与 README / docs 冲突时以本文件为准

> bun-bot 实现细节（运行/构建、可调变量、测试闸门、代码约定、架构决策、踩坑）见 **BUN_BOT.md** —— 同一优先级，一并加载。
