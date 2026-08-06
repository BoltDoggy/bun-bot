# bun-bot

一个自我认知为 **Bun.js** 运行时的 agent —— 通过 DeepSeek 的 Function Calling 获得工具集，自己编写 JavaScript/TypeScript 脚本，由 Bun 实际执行，再观察结果继续推理，直到任务完成。

**M1 里程碑（P0+P1）**：agent 认识自己、能改自己的文件 —— 自修改最小闭环成立。

## 特性

- 🧠 **代码驱动推理**：所有结论都通过真实运行脚本验证，而不是凭空猜测
- 🔧 **工具注册表**：`src/tools.ts` 用注册表模式管理工具，agent 可以读自己 → 改自己 → 测自己
- 🧭 **自我认知**：启动时加载 README + docs + 文件树 + 记忆，系统提示词含「身份 / 能力 / 项目 / 记忆 / 规则」五区块
- 💾 **跨会话记忆**：`AGENT_STATE.json`（机器态）+ `MEMORY.md`（人类可读版）持久化，重启后能引用上次决策
- 🛡️ **自修改安全**：`write_file` 落盘前自动 git 快照 + 返回行级 diff 摘要
- ⚡ **Bun 原生执行**：脚本用 `Bun.spawn` 运行，`run_script` 默认沙箱 tmpdir，可指定工作区 cwd

## 快速开始

```bash
bun install
cp .env.example .env   # 填入 DEEPSEEK_API_KEY
bun run index.ts "计算斐波那契数列第 30 项"            # 默认非流式
bun run index.ts --stream "计算斐波那契数列第 30 项"   # SSE 流式输出（--stream 可选）
```

## 工具集

| 工具 | 说明 |
| --- | --- |
| `run_script` | 用 Bun 运行 JS/TS（cwd 可指定工作区，默认 tmpdir；超时可配；输出上限 64KB 带偏移） |
| `read_file` | 读工作区文件，默认完整返回 64KB，可 offset 续读（单次硬上限 1MB） |
| `write_file` | 写工作区文件，自动 git 快照 + diff 摘要 |
| `list_dir` | 列目录（`-a` 显示隐藏文件、`depth` 限制深度，最大 8） |
| `run_bash` | 执行 shell 命令（cwd 默认工作区，超时可配） |

## 项目结构

```
├── index.ts            # 入口：CLI 解析 + agent 主循环（保持轻量）
├── src/
│   ├── tools.ts        # 工具注册表（新增工具在此注册）
│   ├── context.ts      # 系统提示词组装：身份 + 项目 + 记忆 + 规则
│   ├── memory.ts       # 记忆读写：AGENT_STATE.json / MEMORY.md + 项目上下文
│   └── git.ts          # write_file 前的安全快照
├── tests/
│   └── tools.test.ts   # 12 个 self-test 用例（修改自身代码后的验证闸门）
├── AGENT_STATE.json    # 机器可读记忆
├── MEMORY.md           # 人类可读记忆（git 可追踪）
├── blog.md             # agent 真实运行实录（自我进化过程）
└── docs/               # 迭代计划与架构文档
```

## 配置项（环境变量）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | - | API Key（必填） |
| `BUN_BOT_MODEL` | `deepseek-v4-flash` | 模型名 |
| `BUN_BOT_MAX_ITERATIONS` | `150` | 防止 agent 无限循环 |
| `BUN_BOT_WORKSPACE` | `process.cwd()` | 工作区根目录（agent 可读写的范围，测试沙箱用它覆盖） |

## 自测

```bash
bun test   # 12 个用例：工具层 + 记忆层，零外部依赖
```

## 迭代路线

见 [docs/PLAN.md](./docs/PLAN.md)。M1 = P0（认知与记忆）+ P1（工具集扩充）。下一步 M2（`--self` 长任务 + checkpoint / 续跑），M3（回滚、测试闸门、沙箱加固）。
