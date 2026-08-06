# bun-bot — 项目通用约定

本文件是通用项目定义，可被其他 AGENT 复用。bun-bot 启动时会自动读取本文件，并额外加载 BUN_BOT.md（其中包含 run_script 工具的专属约定），一起注入系统提示词。

## 项目是什么

- 一个用 **Bun + DeepSeek API（Function Calling）** 实现的编码代理示例。

## 运行方式

- 需要环境变量 `DEEPSEEK_API_KEY`（也可写入项目根目录的 `.env`，Bun 会自动加载）。
- 默认流式模式：`bun run index.ts "任务"`
- 需要一次性输出：`bun run index.ts --no-stream "任务"`
- 模型默认 `deepseek-v4-flash`，可换成 `deepseek-v4-pro`（文件顶部 `MODEL` 常量）。

## 工程约定

- 纯 ESM（`"type": "module"`），使用 TypeScript，禁止引入运行时第三方依赖（devDependencies 只有 `bun-types`）。
- 优先使用 Bun 原生 API：`Bun.file`、`Bun.write`、`Bun.spawn`，而不是 Node 的 `fs`/child_process 包装。
- 与用户沟通使用简洁的中文。
- 修改代码后请保持注释风格：中文、解释"为什么"。
