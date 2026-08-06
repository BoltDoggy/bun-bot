# bun-bot

一个自我认知为 **Bun.js** 运行时的 agent —— 通过 DeepSeek 的 Function Calling 获得 `run_script` 工具，自己编写 JavaScript/TypeScript 脚本，由 Bun 实际执行，再观察结果继续推理，直到任务完成。

## 特性

- 🧠 **代码驱动推理**：所有结论都通过真实运行脚本验证，而不是凭空猜测
- ⚡ **Bun 原生执行**：脚本用 `Bun.spawn` 临时写入并运行，返回 stdout / stderr / 退出码
- 🛡️ **防跑飞**：单脚本 30 秒超时；整个 agent 最多 15 轮迭代
- 📦 **零依赖运行**：仅需 `bun-types` 作为 devDependency

## 快速开始

### 1. 安装

```bash
bun install
```

### 2. 配置 API Key

```bash
cp .env.example .env
# 编辑 .env，填入你的 key
export DEEPSEEK_API_KEY=sk-xxx   # 或写入 .env（Bun 会自动加载）
```

### 3. 运行

```bash
bun run index.ts "计算斐波那契数列第 30 项"   # 默认流式（SSE），逐 token 打字机输出
```

## 用法示例

| 任务 | 命令 |
| --- | --- |
| 跑一个计算任务 | `bun run index.ts "1 到 100 的和"` |
| 操作数据 | `bun run index.ts "读取当前目录并统计文件数量"` |
| 验证想法 | `bun run index.ts "验证 2^10 是否等于 1024"` |
| 一次性输出 | `bun run index.ts --no-stream "1 到 100 的和"` |

## 工作原理

1. 启动时读取 CLI 参数作为任务，拼接到 messages 里发给 DeepSeek
2. 模型若需要验证/计算，会发起 `run_script` 工具调用
3. agent 把脚本临时写入 `tmpdir`，用 `bun run` 执行，把 stdout/stderr/exitCode 回传给模型
4. 模型观察结果后继续推理，直到不再调用工具，输出最终结论（默认流式逐 token 输出，加 `--no-stream` 可关闭）

## 配置项（index.ts 顶部常量）

| 常量 | 默认值 | 说明 |
| --- | --- | --- |
| `MODEL` | `deepseek-v4-flash` | 模型名，可换 `deepseek-v4-pro` |
| `MAX_ITERATIONS` | `150` | 防止 agent 无限循环 |
| `BASE_URL` | `https://api.deepseek.com` | API 端点 |

## 项目结构

```
├── index.ts        # 主程序：agent 循环 + run_script 工具
├── package.json    # bun-bot 元信息
├── tsconfig.json   # ESNext + bun-types
├── .env.example    # 环境变量模板
└── bun.lock        # 依赖锁文件
```
