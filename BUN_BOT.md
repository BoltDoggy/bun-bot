# BUN_BOT.md — bun-bot 实现细节（与 AGENTS.md 同级加载）

> 本文档是 **bun-bot 自研实现细节**（运行/构建、可调变量、测试闸门、代码约定、架构决策、踩坑），
> 由 bun-bot 启动时与 AGENTS.md 一并加载（[项目] 区块，优先级最高）。
> **AGENTS.md 是通用项目契约**（用户与 agent 之间的约定），bun-bot 特有的工程细节在这里。
> 改动本文档涉及行为变更时，同步更新 README / docs / tests 并跑 `bun test`。

## 运行与构建

- 必填环境变量：`DEEPSEEK_API_KEY`（写入 `.env`，已 gitignore；未设置时 fallback 全局配置 `~/.bun-bot/config.json` 的 `apiKey`）
- 入口：`bun run index.ts [--no-stream] [--self] [--resume] [--interactive] "任务"`；默认 SSE 流式输出（`--no-stream` 关闭改一次性输出，P6-1），`--self` 开任务模式（先 plan 后执行、逐项勾选、中断可续跑），`--resume` 从上次断点恢复会话（可不带任务；带任务作为追加指令），`--interactive` 多轮 REPL（可不带任务）；全局 CLI：`bun-bot`（bun link 安装 `bin/bun-bot.ts`，或安装编译产物；CLI 命令逻辑在 `src/cli.ts`，`index.ts` 编译产物入口在 API key 检查前同样拦截支持 `init` / `--version` / `--help`）
- 构建与发布（P5）：本地构建 `bash scripts/build.sh [target]`（产物 `dist/bun-bot-<target>[.exe]` + `.sha256`）；GitHub Actions（`.github/workflows/build.yml`）打 tag `v*` 自动构建 6 平台并发布 Release（独立 release job 等全部平台构建完合并统一发布，避免并发竞态），手动触发只出 artifact；用户安装 `curl -fsSL https://raw.githubusercontent.com/BoltDoggy/bun-bot/HEAD/scripts/install.sh | sh`（Windows 用 `install.ps1`，均安装为 `bun-bot` / `bun-bot.exe` 命令，不带平台后缀）
- 可调变量（优先级：环境变量 > .bunbot.json 项目配置 > ~/.bun-bot/config.json 全局配置 > 默认值）：
  - `BUN_BOT_MODEL` / `model`（默认 `deepseek-v4-flash`）
  - `BUN_BOT_MAX_ITERATIONS`（默认 150）
  - `BUN_BOT_WORKSPACE`（工作区根，测试沙箱用它覆盖）
  - `BUN_BOT_CONTEXT_BUDGET` / `budget`（上下文 token 预算，默认 120000，P2-3 超限压缩早期工具结果）
  - `BUN_BOT_PERMISSIONS` / `permissions`（`auto` 全自动 / `ask` 写操作需确认（`allowCommands` 白名单放行）/ `readonly` 只读，P4-7）
  - `AGENT_IDENTITY` / `identity`（[身份] 区块内容，P4-2）
  - `testCommand`（测试闸门命令，P4-5 多生态探测优先于默认 `bun test`）
  - `stateDir`（状态文件目录，默认 `.bunbot`，P4-4 不污染目标仓库）
  - `ignore`（文件树额外忽略规则，P4-9）
  - `BUN_BOT_ALLOW_OUTSIDE_CWD`（设为 `1` 放行路径越界，不建议）
- 依赖极简（仅 `bun-types` devDep）；加新依赖前先确认是否必要，装完提交 `bun.lock`

## 测试闸门（改完必须跑）

- `bun test`：91 用例 / 530 expect（2026-08 P6 后），零外部依赖 —— 任何代码改动后必须全绿（P4 新增 10 个测试文件：p4-context / p4-config / p4-state-dir / p4-gate / p4-cli / p4-readonly / p4-global / p4-filetree / p4-interactive / p4-bootstrap；P5 新增 1 个：p5-release；P6 新增 1 个：p6-stream —— release 工作流 + 安装脚本端到端（本地 mock release 服务器，无需网络））
- `bun run skills/web-search/self-test.ts --online`：web-search skill 在线实测（改了解析逻辑必须跑）
- 新增能力必须补测试用例：`tests/` 是自我进化的验证闸门

## 代码约定

- 注释、文档、回复用**中文**；代码风格与现有保持一致（双引号 + 分号）
- 系统提示词五区块：[身份] [能力] [项目] [记忆] [规则]（--self 时注入 [任务模式]），新内容按区块归位（`src/context.ts`）
- 新增工具：在 `src/tools.ts` 的 `registry` 数组注册 `{ def, run }`，同步 README 工具表
- skills 约定：**不加新工具**；`skills/<name>/SKILL.md` 必须带 `version` + 自测命令；索引表维护在 `skills/README.md` 的 `## 索引`
- 提交信息用 conventional commits（`feat:` / `fix:` / `docs:` / `refactor:`）；`write_file` 的自动快照提交（`bun-bot 快照（修改前）: ...`）无需手动处理
- 新增模块注意：`config.ts` 不 import `memory.ts`（避免循环依赖：memory 要用 config 的 stateDir），调用方显式传 base（通常 `workspace()`）

## 架构决策（改动前先想清楚）

- **记忆不提交**：状态文件（`AGENT_STATE.json` / `MEMORY.md` / `AGENT_CHECKPOINT.json` / `AUDIT.log.jsonl`）在 `.bunbot/` 目录（P4-4，gitignore），仅本地持久化；不要 `git add -f` 它们；`saveState` / `syncMemoryFile` / `saveCheckpoint` / `appendAudit` 写前自动确保目录存在 + .gitignore 幂等追加（`ensureStateIgnored`）
- **写文件前自动快照**：`write_file` 落盘前自动 `git add -A && commit`，所有修改可回溯（P3-1 后 run_bash 写操作命令前也 snapshotIfDirty）
- **learn/ 只读**：理论地基（5 篇一手材料 + 结构化笔记），不预载进上下文、不修改，仅按需参考
- **docs/ 面向自我迭代**：ARCHITECTURE（as-is 现状）/ README（索引 + 里程碑进度），代码改动后按需同步
- **本文件优先**：与 README / docs 冲突时以本文件为准（AGENTS.md / BUN_BOT.md 同级，均为项目级指令）
- **配置三级**：环境变量 > .bunbot.json > ~/.bun-bot/config.json（P4-3/8），`loadConfig(base)` 统一合并；API key 只做全局 fallback 不进项目配置
- **通用化原则（P4）**：系统提示词不硬编码 bun-bot 自身文件结构（关键文件按存在性动态生成）；测试闸门多生态探测；状态文件不污染用户仓库
- **编译产物自举（P4-11）**：`run_script` spawn 自身（`process.execPath`：源码时=bun、编译时=编译产物）；编译产物 `./bun-bot run <script>` 及 `init` / `--version` / `--help` 走 index.ts 顶部拦截（API key 检查前）—— 前者用内嵌运行时执行外部脚本，后者提供完整 CLI —— 无 bun 环境的用户机器也能跑 run_script（`bun build --compile` 分发，体积约 60MB+，按平台编译）
- **release 流程（P5）**：构建逻辑收敛在 `scripts/build.sh`（本地与 CI 共用：bun install → bun test → bun build --compile → 生成 `.sha256`）；`.github/workflows/build.yml` 原生矩阵 6 平台（`ubuntu-latest` linux-x64 / `ubuntu-24.04-arm` linux-arm64 / `macos-13` darwin-x64 / `macos-latest` darwin-arm64 / `windows-latest` windows-x64 / `windows-11-arm` windows-arm64 实验性），tag `v*` 触发发布 GitHub Release（独立 release job `needs: build` 下载合并后统一发布，避免并发 create 同名 Release 的 422 竞态）、手动触发只出 artifact；安装脚本 `scripts/install.sh`（POSIX sh）/ `install.ps1`（PowerShell）从 `github.com/<repo>/releases` 下载 `bun-bot-<target>[.exe]` + `.sha256`（latest 走 `/latest/download/`，指定版本走 `/download/v<版本>/`），**SHA256 校验失败必须中止安装**；安装时重命名为 `bun-bot` / `bun-bot.exe`（命令统一不带平台后缀）；安装脚本支持 `BUN_BOT_BASE_URL` 等环境变量覆盖（测试用本地 mock server 端到端验证，见 `tests/p5-release.test.ts`）

## 踩坑（非显然行为）

- P3 安全：run_bash 的危险命令（rm -rf /、git push、fork bomb、sudo 等）会被权限系统直接拒绝 —— 被拒后改用安全写法或 write_file；路径（cwd / path）默认限制在工作区内，越界被拒（BUN_BOT_ALLOW_OUTSIDE_CWD=1 可放行，但不建议）
- P3 测试闸门：本会话发生过自修改（write_file / 写操作 run_bash）时，收尾会自动跑测试（多生态探测，P4-5）；**失败会自动回滚到会话开始前的 HEAD**（reset --hard + clean -fd，gitignore 的 .bunbot/ 本地状态不丢）—— 不用手动 revert，回滚后重新检查改动
- run_bash 的写操作命令（含 sed -i / git commit / bun install / touch 等关键字）会先自动 git 快照；只读命令（git status / git diff）不产生噪音提交
- 审计日志 AUDIT.log.jsonl（P3-4）每次工具调用都会追加一行（入参/出参摘要，防御性截断），在 .bunbot/ 下 gitignore 仅本地持久化
- **sed 陷阱（血的教训）**：BSD sed 多 -e 在同一 pattern space 内会互相污染（替换引入的行会被后续 -e 再次匹配）；替换部分 `&` 是"整个匹配"（`&&` 必须写成 `\&\&`）；pattern 里的 `||` 与 `|` 分隔符冲突（换 `#` 分隔符）—— 复杂替换优先用 write_file 全量重写，别用 sed 硬刚
- **homedir 陷阱**：Bun 的 `os.homedir()` 不读 `$HOME` 环境变量（测试 mock 无效）—— `globalConfigDir()` 先读 `process.env.HOME` 再 fallback `homedir()`

- `run_script` 默认 cwd 是**临时沙箱**，读写工作区文件必须显式 `cwd: "."`
- 工具输出上限 64KB，截断带偏移可续读；大文件用 `read_file` 的 `offset` 续读，别假设被截断
- 长任务（测试 / 安装 / 搜索）给 `timeoutMs` 更大值（如 120000），默认 30s 易超时
- `Bun.spawn` 的 stdout / stderr 都要消费，否则子进程可能挂起
- 上下文预算压缩的是**最早的 tool 结果**（消息结构不动、tool_call_id 关联保留、system 永不清理），被清的工具结果如需细节要重新调用工具
- `--resume` 恢复的 checkpoint 不含 system 消息（恢复时用最新提示词重建）；若上次会话以工具结果中断，恢复时自动补一条 user 兜底消息保证 API 合法
- 交互模式（--interactive）多轮共享 messages（对话连续）；退出词 exit / quit / q / 退出；每轮 checkpoint 落盘，中断可 --resume 续跑
- P5 安装脚本：`Bun.file().unixMode` 返回 `undefined`（不是 number）—— 测试可执行位用 `statSync().mode & 0o111`；install.sh 是 POSIX sh（`set -eu`，不要用 bash 专属 `set -o pipefail` / `[[ ]]`）；run_bash 的危险命令黑名单会拦截 `curl | sh`（下载即执行），测试安装脚本用本地 mock server + `sh scripts/install.sh`，别在 agent 环境跑 `curl ... | sh`
