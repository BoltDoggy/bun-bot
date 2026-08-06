# docs — bun-bot 自我迭代文档

| 文档 | 说明 |
| --- | --- |
| [PLAN.md](./PLAN.md) | **主计划**：拥抱 1M 上下文，把 bun-bot 从"脚本执行器"迭代成"能读懂自己、修改自己、记住自己"的长期 agent |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 现状分析（as-is） |

## 里程碑进度

- ✅ **M1（P0+P1）已完成**：agent 认识自己、能改自己的文件 —— 自修改最小闭环成立
  - P0: 结构化自我认知 + `AGENT_STATE.json` / `MEMORY.md` 跨会话记忆，启动加载项目上下文
  - P1: 工具注册表 `src/tools.ts`（run_script 升级 + read_file / write_file / list_dir / run_bash）
  - 验收: `bun run index.ts "把 index.ts 顶部的注释改成两行"` 真实落盘 + diff 可见 + 测试全绿
  - 自测: `bun test` 12 用例全绿（工具层 + 记忆层，零外部依赖）
- ⏳ **M2（P2）**：`--self` 长任务 + checkpoint / `--resume` 续跑、上下文预算摘要
- ⏳ **M3（P3）**：回滚、测试闸门、沙箱加固、审计日志

> 更新时间：2025 年 · 起点 = 模型支持 1M 上下文
