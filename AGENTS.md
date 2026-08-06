# AGENTS.md — bun-bot 项目契约

> `/init` 生成于 2026-08-06：分析代码库（构建 / 测试 / 代码模式）后固化的项目级指令。
> bun-bot 每次启动自动加载本文件，优先级最高（系统提示词 [规则] 第 5 条已声明）。
> 改动本文件涉及行为变更时，同步更新 README / docs / tests 并跑 `bun test`。
> 2026-08 修订：P2-2 任务模式（--self）+ P2-3 上下文预算 + P2-4 checkpoint（--resume）落地后，同步入口 / 可调变量 / 测试数字。

## 运行与构建

- 必填环境变量：`DEEPSEEK_API_KEY`（写入 `.env`，已 gitignore）
- 入口：`bun run index.ts [--stream] [--self] [--resume] "任务"`；`--stream` 走 SSE 流式输出，`--self` 开任务模式（先 plan 后执行、逐项勾选、中断可续跑），`--resume` 从上次断点恢复会话（可不带任务；带任务作为追加指令）
- 可调变量：`BUN_BOT_MODEL`（默认 `deepseek-v4-flash`）、`BUN_BOT_MAX_ITERATIONS`（默认 150）、`BUN_BOT_WORKSPACE`（工作区根，测试沙箱用它覆盖）、`BUN_BOT_CONTEXT_BUDGET`（上下文 token 预算，默认 120000，P2-3 超限压缩早期工具结果）
- 依赖极简（仅 `bun-types` devDep）；加新依赖前先确认是否必要，装完提交 `bun.lock`

## 测试闸门（改完必须跑）

- `bun test`：30 用例 / 174 expect，零外部依赖 —— 任何代码改动后必须全绿
- `bun run skills/web-search/self-test.ts --online`：web-search skill 在线实测（改了解析逻辑必须跑）
- 新增能力必须补测试用例：`tests/` 是自我进化的验证闸门

## 代码约定

- 注释、文档、回复用**中文**；代码风格与现有保持一致（双引号 + 分号）
- 系统提示词五区块：[身份] [能力] [项目] [记忆] [规则]（--self 时注入 [任务模式]），新内容按区块归位（`src/context.ts`）
- 新增工具：在 `src/tools.ts` 的 `registry` 数组注册 `{ def, run }`，同步 README 工具表
- skills 约定：**不加新工具**；`skills/<name>/SKILL.md` 必须带 `version` + 自测命令；索引表维护在 `skills/README.md` 的 `## 索引`
- 提交信息用 conventional commits（`feat:` / `fix:` / `docs:` / `refactor:`）；`write_file` 的自动快照提交（`bun-bot 快照（修改前）: ...`）无需手动处理

## 架构决策（改动前先想清楚）

- **记忆不提交**：`AGENT_STATE.json` / `MEMORY.md` / `AGENT_CHECKPOINT.json`（会话级断点）在 `.gitignore`（每次会话写回是噪音），仅本地持久化；不要 `git add -f` 它们
- **写文件前自动快照**：`write_file` 落盘前自动 `git add -A && commit`，所有修改可回溯
- **learn/ 只读**：理论地基（5 篇一手材料 + 结构化笔记），不预载进上下文、不修改，仅按需参考
- **docs/ 面向自我迭代**：PLAN（路线图）/ ARCHITECTURE（as-is 现状）/ README（索引），代码改动后按需同步
- **本文件优先**：与 README / docs 冲突时以本文件为准

## 踩坑（非显然行为）

- `run_script` 默认 cwd 是**临时沙箱**，读写工作区文件必须显式 `cwd: "."`
- 工具输出上限 64KB，截断带偏移可续读；大文件用 `read_file` 的 `offset` 续读，别假设被截断
- 长任务（测试 / 安装 / 搜索）给 `timeoutMs` 更大值（如 120000），默认 30s 易超时
- `Bun.spawn` 的 stdout / stderr 都要消费，否则子进程可能挂起
- 上下文预算压缩的是**最早的 tool 结果**（消息结构不动、tool_call_id 关联保留、system 永不清理），被清的工具结果如需细节要重新调用工具
- `--resume` 恢复的 checkpoint 不含 system 消息（恢复时用最新提示词重建）；若上次会话以工具结果中断，恢复时自动补一条 user 兜底消息保证 API 合法
