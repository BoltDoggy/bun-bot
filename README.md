# bun-bot

一个自我认知为 **Bun.js** 运行时的 agent —— 通过 DeepSeek 的 Function Calling 获得工具集，自己编写 JavaScript/TypeScript 脚本，由 Bun 实际执行，再观察结果继续推理，直到任务完成。

**M1 里程碑（P0+P1）**：agent 认识自己、能改自己的文件 —— 自修改最小闭环成立。
**附加能力**：skills 组合操作库 —— 多步、有坑、会过时的操作固化成 SKILL.md，按需加载、自带自测。
**M2 完成（P2-1 ~ P2-4）**：工具描述 ACI 化 + 任务模式（`--self`）+ 上下文预算（tool result clearing）+ `--resume` checkpoint —— 长任务「不爆预算、不丢上下文、中断可续跑」闭环成立。
**M3 完成（P3）**：git 安全阀补 `run_bash` + 测试闸门（收尾自动跑测试、失败自动回滚）+ 沙箱权限分级 + 审计日志 —— 自修改「可信、可回滚、不跑飞」闭环成立。
**M4 完成（P4 通用化）**：可在**任意项目**使用 —— 身份/项目认知去专用化 + `.bunbot.json` 项目配置 + 状态文件移入 `.bunbot/`（不污染 git）+ 多生态测试闸门 + CLI 分发与 `init` + 只读模式 + 全局配置 + 大项目文件树 + 交互模式。
**M5 完成（P5 全平台分发）**：GitHub Actions 多平台矩阵构建（linux / darwin / windows × x64 / arm64 共 6 平台）+ 用户安装脚本（`install.sh` / `install.ps1`：下载 → SHA256 校验 → 安装 → 加入 PATH）—— 打 tag 自动发布 Release，**无 bun 环境也能一键安装使用**。

## 特性

- 🧠 **代码驱动推理**：所有结论都通过真实运行脚本验证，而不是凭空猜测
- 🔧 **工具注册表**：`src/tools.ts` 用注册表模式管理工具，agent 可以读自己 → 改自己 → 测自己
- 🎯 **ACI 化工具描述**：6 个工具的 `description` 均带「示例：」example usage（few-shot），参数语义同步打磨，系统提示词 [能力] 区块双保险
- 📋 **任务模式（P2-2）**：`--self` 开任务模式 —— agent 首轮产出 plan（`update_plan`），逐项执行勾选，进度写回状态；中断/重启后从上次断点继续
- 🧮 **上下文预算（P2-3）**：`budget.ts` token 估算（中英混合离线近似），超限压缩最早工具结果（tool result clearing，消息结构不动、system 永不清理）
- 🔁 **断点续跑（P2-4）**：`--resume` 从 `AGENT_CHECKPOINT.json` 恢复会话消息历史（每次消息变更落盘），中断后恢复完整上下文继续，任务完成自动清除
- 🧭 **自我认知**：启动时加载 AGENTS.md（如有）+ README + docs + 文件树 + 记忆，系统提示词含「身份 / 能力 / 项目 / 记忆 / 规则」五区块
- 📜 **AGENTS.md 项目级指令**：项目根目录的 `AGENTS.md`（可选）是用户与 agent 的项目级契约，存在时自动加载进 [项目] 区块最前、优先级最高
- 🧩 **skills 组合操作库**：`skills/<name>/SKILL.md` 固化「多步 + 有坑 + 会过时」的操作，系统提示词只放一层索引，细节按需 `read_file` 加载
- 💾 **跨会话记忆**：`AGENT_STATE.json`（机器态）+ `MEMORY.md`（人类可读版）本地持久化（`.bunbot/` 下，gitignore），重启后能引用上次决策
- 🛡️ **自修改安全（P3）**：`write_file` 落盘前自动 git 快照 + diff 摘要；`run_bash` 写操作命令前若工作区有未提交改动也自动快照
- ✅ **测试闸门（P3-2 + P4-5）**：收尾自动跑测试（多生态探测：bun test / pytest / cargo test / go test / 配置 testCommand），失败自动回滚到会话开始前 HEAD 并复测
- 🔒 **沙箱权限分级（P3-3 + P4-7）**：路径限制工作区内；危险命令黑名单；`BUN_BOT_PERMISSIONS=ask`（写操作需确认，`allowCommands` 白名单可放行）/ `readonly`（只读模式，write_file / 写操作 run_bash / update_plan 拒绝）
- 📝 **审计日志（P3-4）**：每次工具调用入参/出参摘要落盘 `.bunbot/AUDIT.log.jsonl`（gitignore）
- 🌍 **通用化（P4）**：身份 `AGENT_IDENTITY` 可配置、关键文件按存在性动态生成（任意项目不出现 bun-bot 特有路径）；`.bunbot.json` 项目配置（环境变量 > 配置 > 全局 > 默认）；状态文件移入 `.bunbot/`（自动追加 .gitignore）；CLI `bun-bot init` 一键初始化；全局配置 `~/.bun-bot/config.json`（默认模型 / API key fallback）；文件树感知 .gitignore + 行数预算截断；`--interactive` 多轮 REPL
- ⚡ **Bun 原生执行**：脚本用 `Bun.spawn` 运行，`run_script` 默认沙箱 tmpdir，可指定工作区 cwd
- 📦 **编译产物自举**：`bun build --compile` 后 `run_script` spawn 自身（process.execPath），编译产物 `./bun-bot run <script>` 用内嵌运行时执行外部脚本 —— 无 bun 环境的用户机器也能跑 run_script
- 🚀 **全平台分发（P5）**：`.github/workflows/build.yml` 原生矩阵构建 6 平台（linux/darwin/windows × x64/arm64）编译产物 —— 打 tag `v*` 自动发布 GitHub Release（每个产物附 `.sha256` 校验文件），手动触发只出 artifact 不发 Release；`scripts/install.sh`（macOS/Linux）与 `scripts/install.ps1`（Windows）一行安装：自动检测平台 → 下载 → SHA256 校验 → 安装 → 提示/加入 PATH；`scripts/build.sh` 本地与 CI 共用（先测试后编译）

## 快速开始

```bash
bun install
cp .env.example .env   # 填入 DEEPSEEK_API_KEY
bun run index.ts "计算斐波那契数列第 30 项"            # 默认非流式
bun run index.ts --stream "计算斐波那契数列第 30 项"   # SSE 流式输出（--stream 可选）
bun run index.ts --self "给我加一个 read_file 工具并补文档"  # 任务模式：先 plan 后执行、逐项勾选、中断可续跑
bun run index.ts --resume                             # 从上次断点续跑（中断后恢复消息历史；可带新任务追加）
bun run index.ts --interactive                        # 交互模式：多轮 REPL，对话跨轮保持
```

**直接安装编译产物（无需 bun 环境，P5）**：

```bash
# macOS / Linux（一行安装：自动检测平台，下载最新 Release → SHA256 校验 → 装到 ~/.local/bin）
curl -fsSL https://raw.githubusercontent.com/BoltDoggy/bun-bot/HEAD/scripts/install.sh | sh

# Windows（PowerShell：下载 .exe → SHA256 校验 → 装到 %LOCALAPPDATA%\bun-bot\bin → 加入用户 PATH）
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/BoltDoggy/bun-bot/HEAD/scripts/install.ps1 | iex"
```

> 安装脚本可定制：`BUN_BOT_REPO`（fork/私有源）、`BUN_BOT_VERSION`（默认 latest，指定如 0.1.0）、
> `--dir` 安装目录等，详见 `scripts/install.sh --help` 与 `scripts/install.ps1 -?`。

**构建与发布（P5）**：

```bash
# 打 tag 自动构建 6 平台并发布 GitHub Release（.github/workflows/build.yml）；也可 Actions 页面手动触发
git tag v0.1.0 && git push origin v0.1.0

# 本地构建当前平台（脚本与 CI 共用）：产物 dist/bun-bot-<target>[.exe] + .sha256
bash scripts/build.sh
```

**在任意项目使用（P4）**：

```bash
# 1. 全局安装 CLI（或 bunx bun-bot）
bun link
# 2. 在目标项目初始化（生成 AGENTS.md 模板 + .bunbot.json + .gitignore 条目）
bun-bot init
# 3. 直接跑任务（身份/关键文件/测试闸门按项目自适应；状态文件进 .bunbot/ 不污染 git）
bun-bot "分析这个项目的结构并给出建议"
```

> 可选：在项目根目录放一个 `AGENTS.md` 写入项目约定（如禁止改哪些文件、必须跑什么测试），
> bun-bot 启动时会自动加载并优先遵守它。

## 工具集

| 工具 | 说明 |
| --- | --- |
| `run_script` | 用 Bun 运行 JS/TS（cwd 可指定工作区，默认 tmpdir；超时可配；输出上限 64KB 带偏移；spawn 自身运行时，编译产物无 bun 环境也能跑） |
| `read_file` | 读工作区文件，默认完整返回 64KB，可 offset 续读（单次硬上限 1MB） |
| `write_file` | 写工作区文件，自动 git 快照 + diff 摘要（readonly 模式下拒绝） |
| `list_dir` | 列目录（`-a` 显示隐藏文件、`depth` 限制深度，最大 8） |
| `run_bash` | 执行 shell 命令（cwd 默认工作区，超时可配；写操作命令前自动 git 快照；危险命令被权限系统拒绝） |
| `update_plan` | 更新任务计划（任务模式，P2-2）：全量覆盖式创建/勾选，进度写回状态跨会话保存（readonly 模式下拒绝） |

## skills（组合操作库）

| skill | 一句话 | 自测 |
| --- | --- | --- |
| `web-search` | 联网搜索（Bing 主路径 + DDG 降级），附真实 HTML 解析模板 | `bun run skills/web-search/self-test.ts` |

## 项目结构

```
├── index.ts            # 入口：CLI 解析（--stream / --self / --resume / --interactive）+ run 子命令自举（编译产物自带运行时）+ runAgentLoop 主循环 + 记忆读写钩子
├── AGENTS.md            # 可选：项目级指令（存在时自动加载，优先级最高）
├── .github/
│   └── workflows/
│       └── build.yml   # P5 全平台构建：矩阵 6 平台（tag v* 发布 Release + 手动触发出 artifact）
├── bin/
│   └── bun-bot.ts      # CLI 分发（P4-6）：bun link 全局安装；init / --version / --help / 透传 index.ts
├── scripts/
│   ├── build.sh        # 构建编译产物（本地与 CI 共用：先测试后编译 + SHA256 校验文件）
│   ├── install.sh      # 用户安装脚本（macOS/Linux：检测平台 → 下载 → 校验 → 安装 → PATH 提示）
│   └── install.ps1     # 用户安装脚本（Windows：下载 .exe → 校验 → 装到 %LOCALAPPDATA% → 加用户 PATH）
├── src/
│   ├── tools.ts        # 工具注册表（新增工具在此注册；description 带 example usage；P4-7 readonly/ask 白名单）
│   ├── context.ts      # 系统提示词组装（P4-2：身份可配置 + 关键文件按存在性动态生成）
│   ├── config.ts       # 项目配置 .bunbot.json + 全局配置 ~/.bun-bot/（P4-3/8：环境变量 > 项目 > 全局 > 默认）
│   ├── memory.ts       # 记忆读写（P4-4：状态移入 .bunbot/ + 自动 .gitignore；P4-9：文件树忽略/截断）
│   ├── budget.ts       # 上下文预算：token 估算 + 超限压缩（tool result clearing）
│   ├── gate.ts         # 测试闸门（P4-5：多生态探测 detectTestCommand + testCommand 配置）
│   ├── interactive.ts  # 交互模式驱动（P4-10：多轮 REPL，消息跨轮保持，可注入 runRound 离线测试）
│   ├── git.ts          # git 安全快照（write_file + run_bash 写操作前）
│   └── audit.ts        # 审计日志（落盘 .bunbot/AUDIT.log.jsonl）
├── skills/             # 组合操作库（SKILL.md + 实现 + 自测）
├── tests/              # 85 用例 / 490 expect（M1 + skills + AGENTS.md + P2 + P3 + P4 + P5 全量闸门）
├── .bunbot/            # 状态目录（P4-4：AGENT_STATE / MEMORY / CHECKPOINT / AUDIT，gitignore，本地持久化）
├── blog.md             # agent 真实运行实录（自我进化过程）
└── docs/               # 迭代进度与架构文档
```

## 配置项（环境变量 + 项目配置 .bunbot.json）

优先级：**环境变量 > 项目配置（.bunbot.json）> 全局配置（~/.bun-bot/config.json）> 默认值**

| 变量 / 配置键 | 默认值 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | - | API Key（必填；未设置时 fallback 全局配置 `~/.bun-bot/config.json` 的 `apiKey`） |
| `BUN_BOT_MODEL` / `model` | `deepseek-v4-flash` | 模型名 |
| `BUN_BOT_MAX_ITERATIONS` | `150` | 防止 agent 无限循环 |
| `BUN_BOT_WORKSPACE` | `process.cwd()` | 工作区根目录（agent 可读写的范围，测试沙箱用它覆盖） |
| `BUN_BOT_CONTEXT_BUDGET` / `budget` | `120000` | 上下文 token 预算（超限时压缩早期工具结果） |
| `BUN_BOT_PERMISSIONS` / `permissions` | `auto` | `auto` 全自动 / `ask` 写操作需确认（`allowCommands` 白名单放行）/ `readonly` 只读 |
| `BUN_BOT_ALLOW_OUTSIDE_CWD` | 未设置 | 设为 `1` 时放行 cwd / path 超出工作区（不建议） |
| `AGENT_IDENTITY` / `identity` | bun-bot 身份 | [身份] 区块内容（P4-2 去专用化） |
| `testCommand` | `bun test` | 测试闸门命令（P4-5：显式配置优先于生态探测） |
| `stateDir` | `.bunbot` | 状态文件目录（P4-4：不污染目标仓库） |
| `ignore` | `[]` | 文件树额外忽略规则（P4-9，如 vendor/target/__pycache__） |
| `allowCommands` | `[]` | ask 模式白名单命令（P4-7：整命令或前缀匹配，命中放行） |

> 安装脚本（P5）另有环境变量：`BUN_BOT_REPO`（默认 `BoltDoggy/bun-bot`）、`BUN_BOT_VERSION`（默认 `latest`）、
> `BUN_BOT_INSTALL_DIR`、`BUN_BOT_TARGET`、`BUN_BOT_BASE_URL`（测试用），详见 `scripts/install.sh` 头部注释。

## 自测

```bash
bun test   # 85 用例 / 490 expect：工具层 + 记忆层 + checkpoint + skills + AGENTS.md + P2（ACI/任务模式/预算/resume）+ P3（安全/闸门/审计）+ P4（通用化 9 项）+ P5（release 工作流 + 安装脚本端到端），零外部依赖
bun run skills/web-search/self-test.ts --online   # web-search skill 在线实测（可选）
```

## 迭代路线

见 [docs/README.md](./docs/README.md)（里程碑进度与迭代索引）。M1 = P0+P1 ✅、skills ✅、AGENTS.md ✅、M2 = P2-1 ~ P2-4 ✅、**M3 = P3 质量与防护 ✅**、**M4 = P4 通用化 ✅（2026-08 完成）**、**M5 = P5 全平台分发 ✅（2026-08 完成）** —— `bun-bot init` 一键初始化 + GitHub Actions 构建全平台 + 一行安装脚本，任意项目 / 任意平台都能用。
