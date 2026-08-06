# 迭代计划（docs 索引）

| 文档 | 说明 |
| --- | --- |
| [PLAN.md](./PLAN.md) | **主计划**：拥抱 1M 上下文，把 bun-bot 从"脚本执行器"迭代成"能读懂自己、修改自己、记住自己"的长期 agent。P0/P1 已完成并勾选，P2/P3 待办 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 现状分析（as-is）：随代码演进更新，当前快照基于 M1（P0+P1）+ skills 能力落地后的实际代码 |

## 里程碑进度

- ✅ **M1（P0+P1）已完成**：agent 认识自己、能改自己的文件 —— 自修改最小闭环成立
  - P0: 结构化自我认知 + `AGENT_STATE.json` / `MEMORY.md` 跨会话记忆，启动加载项目上下文
  - P1: 工具注册表 `src/tools.ts`（run_script 升级 + read_file / write_file / list_dir / run_bash，共 5 工具）
  - 验收: `bun run index.ts "把 index.ts 顶部的注释改成两行"` 真实落盘 + diff 可见 + 测试全绿
  - 自测: `bun test` 15 用例全绿（工具层 + 记忆层 + skills 层，零外部依赖）
- ✅ **skills 组合操作库（附加能力）已完成**：跨会话能力沉淀
  - `skills/<name>/SKILL.md` 固化「多步 + 有坑 + 会过时」的操作，索引进 [能力] 区块，细节按需 read_file
  - 首个 skill：`web-search` v2（Bing 主路径 + DDG 降级 + 离线样本 + 自测；v1 全局正则被真实结构打脸的教训已沉淀）
  - 设计决策：**不加新工具**，用现有 read_file 加载；skill 必须带版本号 + 自测命令，纳入测试闸门
  - 自测: `bun test` + `bun run skills/web-search/self-test.ts --online`
- ⏳ **M2（P2）**：`--self` 长任务 + checkpoint / `--resume` 续跑、上下文预算摘要（`budget.ts`）
- ⏳ **M3（P3）**：回滚、测试闸门、沙箱加固、审计日志

## 与主 README 的关系

主 [README.md](../README.md) 面向使用者（快速开始 / 工具集 / 配置项）；本目录面向**自我迭代**（计划 / 现状 / 进度），是 agent 启动时加载的"项目上下文"一部分。

> 更新时间：2026-08 · 起点 = 模型支持 1M 上下文 · 最新修订 = ARCHITECTURE 快照对齐 M1 + skills 后代码
