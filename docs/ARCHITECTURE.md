# 现状分析（as-is）

基于对 index.ts / README.md 的实际阅读与统计，截止当前版本。

## 快照数据

| 项 | 值 |
| --- | --- |
| index.ts 行数 | 201 行 / 6.6 KB（单文件，全部逻辑） |
| 工具数量 | 1 个：`run_script` |
| 模型 | `deepseek-v4-flash`（可换 `deepseek-v4-pro`） |
| 最大迭代 | 150 轮 |
| 脚本超时 | 30 秒 |
| 工具输出截断 | 4000 字符 |
| 运行方式 | 每次 CLI 任务独立进程，**无状态** |

## 模块解剖

```text
index.ts
├── 配置区        BASE_URL / MODEL / MAX_ITERATIONS / API_KEY
├── CLI 解析      支持 --stream 标志
├── 类型          ToolCall / ChatMessage
├── 工具定义      唯一工具 run_script（写入 tmpdir 后 bun run）
├── runScript()   写临时文件 → spawn → 30s 超时 → 输出截 4000 字符 → 删除
├── chatCompletion()  非流式 / SSE 流式两条路径
└── agent 循环    messages 累积 → 有 tool_calls 就执行并回填 → 直到无工具调用
```

## 与 1M 上下文时代的差距

1. **不认识自己**：system prompt 极简，不加载 README / 项目结构 / 架构说明。
2. **无记忆**：`MEMORY` / 状态文件不存在，每次运行从零开始。
3. **改不了自己**：`run_script` 只能写 tmpdir 临时文件，无法读写工作区源码。
4. **输出被截断**：4000 字符上限是为小上下文时代设计的，现在反而浪费能力。
5. **长任务无支撑**：没有进度 checkpoint、没有上下文预算管理，>100 轮容易迷失。

> 本目录的 [PLAN.md](./PLAN.md) 针对以上五点给出分阶段迭代方案。
