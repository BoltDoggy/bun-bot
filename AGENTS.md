# bun-bot — 代理工作约定

这个文件会被 bun-bot 启动时自动读取并注入系统提示词，请严格遵守。

## 项目是什么

- 一个用 **Bun + DeepSeek API（Function Calling）** 实现的编码代理示例。
- 代理拥有唯一的工具 `run_script`：编写 JS/TS 脚本，交给 **Bun 实际执行**，观察 stdout/stderr/退出码后再继续推理，直到任务完成。

## 运行方式

- 需要环境变量 `DEEPSEEK_API_KEY`（也可写入项目根目录的 `.env`，Bun 会自动加载）。
- 默认流式模式：`bun run index.ts "任务"`
- 需要一次性输出：`bun run index.ts --no-stream "任务"`
- 模型默认 `deepseek-v4-flash`，可换成 `deepseek-v4-pro`（文件顶部 `MODEL` 常量）。

## 工程约定

- 纯 ESM（`"type": "module"`），使用 TypeScript，禁止引入运行时第三方依赖（devDependencies 只有 `bun-types`）。
- 优先使用 Bun 原生 API：`Bun.file`、`Bun.write`、`Bun.spawn`，而不是 Node 的 `fs`/child_process 包装。
- 新脚本用 `run_script` 实际运行验证结论，不要凭空猜测；脚本里用 `console.log` 输出结果。
- 与用户沟通使用简洁的中文。
- 修改代码后请保持注释风格：中文、解释"为什么"。
