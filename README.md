# bun-bot

一个自我认知为 **Bun.js** 运行时的 agent —— 通过 DeepSeek 的 Function Calling 获得工具集，自己编写 JavaScript/TypeScript 脚本，由 Bun 实际执行，再观察结果继续推理，直到任务完成。

> 📖 **来自掘金文章《一个超级简单的 coding agent，100 行就可以做任何事》的读者**：那篇文章对应的是 **`v0.1.0`** tag —— 当时的整个 agent 只有 1 个文件（约 200 行 `index.ts`），就是文章描述的「百行精简实现」。
> 但 bun-bot 会**自我进化**：此后它给自己加上了工具注册表、跨会话记忆、任务模式、测试闸门、全平台分发…… 演变成了你现在看到的完整项目（`index.ts` + `src/` + `tests/` + `scripts/` + `.github/`）。
> 想复现文章里的「百行版本」，请切到 `v0.1.0`：
>
> ```bash
> git checkout v0.1.0
> # 或直接在线查看：https://github.com/BoltDoggy/bun-bot/tree/v0.1.0
> ```

> 💡 **阅读指引**：本 README 分两个视角 —— **用户视角**（安装 / 使用 / 配置，第一段）与 **开发者视角**（源码结构 / 构建发布 / 迭代路线，第二段）。按需跳转。

---

## 🧑💻 用户视角（使用 bun-bot）

### 快速开始

**第一步：安装 bun-bot（编译产物一键安装，无需 bun 环境）**

```bash
# macOS / Linux（一行安装：自动检测平台，下载最新 Release → SHA256 校验 → 装为 bun-bot 命令到 ~/.local/bin）
curl -fsSL https://raw.githubusercontent.com/BoltDoggy/bun-bot/HEAD/scripts/install.sh | sh

# Windows（PowerShell：下载 .exe → SHA256 校验 → 装为 bun-bot.exe 到 %LOCALAPPDATA%\bun-bot\bin → 加入用户 PATH）
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/BoltDoggy/bun-bot/HEAD/scripts/install.ps1 | iex"
```

> 安装脚本可定制：`BUN_BOT_REPO`（fork/私有源）、`BUN_BOT_VERSION`（默认 latest，指定如 0.3.3）、
> `--dir` 安装目录等，详见 `scripts/install.sh --help` 与 `scripts/install.ps1 -?`。

**第二步：在任意项目使用（P4）**

装好 `bun-bot` 命令后（第一步），在目标项目目录直接使用：

```bash
# 1.（可选）初始化项目：生成 AGENTS.md 模板 + .bunbot.json + .gitignore 条目
bun-bot init
# 2. 直接跑任务（身份/关键文件/测试闸门按项目自适应；状态文件进 .bunbot/ 不污染 git）
bun-bot "分析这个项目的结构并给出建议"
```

> 可选：在项目根目录放一个 `AGENTS.md` 写入项目约定（如禁止改哪些文件、必须跑什么测试），
> bun-bot 启动时会自动加载并优先遵守它。

> 想参与开发 / 从源码跑？见下方「开发者视角 → 本地开发（从源码运行）」。

### 命令行用法（`bun-bot` 为安装后的全局命令）

| 参数 | 说明 | 示例 |
| --- | --- | --- |
| （无） | 默认非流式执行 | `bun-bot "计算斐波那契数列第 30 项"` |
| `--stream` | SSE 流式输出 | `bun-bot --stream "..."` |
| `--self` | 任务模式：先 plan 后执行、逐项勾选、中断可续跑 | `bun-bot --self "给我加一个 read_file 工具并补文档"` |
| `--resume` | 从上次断点续跑（可不带任务；带任务作为追加指令） | `bun-bot --resume` |
| `--interactive` | 交互模式：多轮 REPL，对话跨轮保持 | `bun-bot --interactive` |

其他命令：`bun-bot init`（初始化项目）/ `bun-bot --version` / `bun-bot --help`。

### 能干什么（特性）

- 🧠 **代码驱动推理**：所有结论都通过真实运行脚本验证，而不是凭空猜测
- 📋 **任务模式（`--self`）**：agent 首轮产出 plan（`update_plan`），逐项执行勾选，进度写回状态；中断/重启后从上次断点继续
- 🔁 **断点续跑（`--resume`）**：会话消息历史每次变更落盘，中断后恢复完整上下文继续，任务完成自动清除
- 🧮 **长任务不爆上下文**：内置 token 预算，超限自动压缩最早的工具结果（消息结构不动、system 永不清理）
- 💾 **跨会话记忆**：`AGENT_STATE.json`（机器态）+ `MEMORY.md`（人类可读版）本地持久化（`.bunbot/` 下，gitignore），重启后能引用上次决策
- 🧭 **自我认知 + 项目级指令**：启动时加载 AGENTS.md（如有）+ README + docs + 文件树 + 记忆，系统提示词含「身份 / 能力 / 项目 / 记忆 / 规则」五区块；项目根目录的 `AGENTS.md` 是用户与 agent 的项目级契约，优先级最高
- 🧩 **skills 组合操作库**：多步、有坑、会过时的操作固化成 `skills/<name>/SKILL.md`，按需加载、自带自测
- 🛡️ **自修改安全（P3）**：`write_file` 落盘前自动 git 快照 + diff 摘要；写操作命令前自动快照；收尾自动跑测试、失败自动回滚到会话开始前 HEAD；每次工具调用入参/出参写审计日志
- 🔒 **权限分级**：`auto` 全自动 / `ask` 写操作需确认（`allowCommands` 白名单放行）/ `readonly` 只读（写操作拒绝）；路径默认限制工作区内，危险命令黑名单直接拒绝
- 🌍 **通用化（P4）**：可在**任意项目**使用 —— 身份可配置、关键文件按存在性动态生成、状态文件不污染目标仓库、大项目文件树感知 .gitignore + 截断
- ⚡ **Bun 原生执行**：脚本用 `Bun.spawn` 运行，默认沙箱 tmpdir，可指定工作区 cwd
- 📦 **编译产物自举**：`bun build --compile` 后无 bun 环境的用户机器也能跑 `run_script`（spawn 自身，内嵌运行时执行外部脚本）
- 🚀 **全平台分发（P5）**：6 平台（linux/darwin/windows × x64/arm64）编译产物 + 一行安装脚本（下载带进度条 → SHA256 校验 → 安装为 bun-bot 命令 → 加入 PATH）

### 工具集

| 工具 | 说明 |
| --- | --- |
| `run_script` | 用 Bun 运行 JS/TS（cwd 可指定工作区，默认 tmpdir；超时可配；输出上限 64KB 带偏移；spawn 自身运行时，编译产物无 bun 环境也能跑） |
| `read_file` | 读工作区文件，默认完整返回 64KB，可 offset 续读（单次硬上限 1MB） |
| `write_file` | 写工作区文件，自动 git 快照 + diff 摘要（readonly 模式下拒绝） |
| `list_dir` | 列目录（`-a` 显示隐藏文件、`depth` 限制深度，最大 8） |
| `run_bash` | 执行 shell 命令（cwd 默认工作区，超时可配；写操作命令前自动 git 快照；危险命令被权限系统拒绝） |
| `update_plan` | 更新任务计划（任务模式，P2-2）：全量覆盖式创建/勾选，进度写回状态跨会话保存（readonly 模式下拒绝） |

### skills（组合操作库）

| skill | 一句话 | 自测 |
| --- | --- | --- |
| `web-search` | 联网搜索（Bing 主路径 + DDG 降级），附真实 HTML 解析模板 | `bun run skills/web-search/self-test.ts` |

### 配置项（环境变量 + 项目配置 .bunbot.json）

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

---

## 👩💻 开发者视角（扩展 / 构建 / 迭代 bun-bot）

> 完整契约见项目根目录的 [AGENTS.md](./AGENTS.md)（优先级最高：运行 / 构建 / 测试闸门 / 代码约定 / 架构决策 / 踩坑），以下为速览。

### 项目结构

```
├── index.ts            # 入口：CLI 命令拦截（init / --version / --help，API key 检查前）+ CLI 解析（--stream / --self / --resume / --interactive）+ run 子命令自举（编译产物自带运行时）+ runAgentLoop 主循环 + 记忆读写钩子
├── AGENTS.md            # 可选：项目级指令（存在时自动加载，优先级最高）
├── .github/
│   └── workflows/
│       └── build.yml   # P5 全平台构建：矩阵 6 平台（tag v* 发布 Release + 手动触发出 artifact）
├── bin/
│   └── bun-bot.ts      # CLI 分发（P4-6）：复用 src/cli.ts（init / --version / --help），透传 index.ts；bun link 全局安装
├── scripts/
│   ├── build.sh        # 构建编译产物（本地与 CI 共用：先测试后编译 + SHA256 校验文件）
│   ├── install.sh      # 用户安装脚本（macOS/Linux：检测平台 → 下载（进度条）→ 校验 → 安装为 bun-bot → PATH 提示）
│   └── install.ps1     # 用户安装脚本（Windows：下载 .exe → 校验 → 装为 bun-bot.exe → 加用户 PATH）
├── src/
│   ├── tools.ts        # 工具注册表（新增工具在此注册；description 带 example usage；P4-7 readonly/ask 白名单）
│   ├── cli.ts          # CLI 命令（P4-6：init / --version / --help，bin/bun-bot.ts 与 index.ts 编译产物共用）
│   ├── context.ts      # 系统提示词组装（P4-2：身份可配置 + 关键文件按存在性动态生成）
│   ├── config.ts       # 项目配置 .bunbot.json + 全局配置 ~/.bun-bot/（P4-3/8：环境变量 > 项目 > 全局 > 默认）
│   ├── memory.ts       # 记忆读写（P4-4：状态移入 .bunbot/ + 自动 .gitignore；P4-9：文件树忽略/截断）
│   ├── budget.ts       # 上下文预算：token 估算 + 超限压缩（tool result clearing）
│   ├── gate.ts         # 测试闸门（P4-5：多生态探测 detectTestCommand + testCommand 配置）
│   ├── interactive.ts  # 交互模式驱动（P4-10：多轮 REPL，消息跨轮保持，可注入 runRound 离线测试）
│   ├── git.ts          # git 安全快照（write_file + run_bash 写操作前）
│   └── audit.ts        # 审计日志（落盘 .bunbot/AUDIT.log.jsonl）
├── skills/             # 组合操作库（SKILL.md + 实现 + 自测）
├── tests/              # 87 用例 / 514 expect（M1 + skills + AGENTS.md + P2 + P3 + P4 + P5 全量闸门）
├── .bunbot/            # 状态目录（P4-4：AGENT_STATE / MEMORY / CHECKPOINT / AUDIT，gitignore，本地持久化）
├── blog.md             # agent 真实运行实录（自我进化过程）
└── docs/               # 迭代进度与架构文档（面向自我迭代）
```

### 本地开发（从源码运行）

想改 bun-bot 本身 / 贡献代码时，从源码跑：

```bash
git clone https://github.com/BoltDoggy/bun-bot.git && cd bun-bot
bun install
cp .env.example .env   # 填入 DEEPSEEK_API_KEY
bun run index.ts "计算斐波那契数列第 30 项"
```

> 源码入口 `bun run index.ts` 与安装后的全局命令 `bun-bot` 等价（编译产物就是 index.ts 的 `bun build --compile` 产物，同样支持 init / --version / --help）；`bun link` 后也可直接用 `bun-bot`。

### 构建与发布（P5）

```bash
# 打 tag 自动构建 6 平台并发布 GitHub Release（.github/workflows/build.yml）；也可 Actions 页面手动触发
git tag v0.1.0 && git push origin v0.1.0

# 本地构建当前平台（脚本与 CI 共用）：产物 dist/bun-bot-<target>[.exe] + .sha256
bash scripts/build.sh
```

- 构建逻辑收敛在 `scripts/build.sh`（本地与 CI 共用：bun install → bun test 先绿 → bun build --compile → 生成 `.sha256`）
- `.github/workflows/build.yml` 原生矩阵 6 平台（linux/darwin/windows × x64/arm64），tag `v*` 自动发布 GitHub Release、手动触发只出 artifact
- 用户安装脚本 `scripts/install.sh`（POSIX sh）/ `install.ps1`（PowerShell）：检测平台 → 下载 → **SHA256 校验（失败中止）** → 安装为 `bun-bot` / `bun-bot.exe`（命令统一不带平台后缀）→ PATH

### 开发约定与测试闸门

- 改完必须跑 `bun test`：**87 用例 / 514 expect**，零外部依赖 —— 任何代码改动后必须全绿（P4 新增 10 个测试文件 + P5 新增 1 个 p5-release）
- `bun run skills/web-search/self-test.ts --online`：web-search skill 在线实测（改了解析逻辑必须跑）
- 新增能力必须补测试用例：`tests/` 是自我进化的验证闸门
- 提交信息用 conventional commits（`feat:` / `fix:` / `docs:` / `refactor:`）
- 新增工具：在 `src/tools.ts` 的 `registry` 数组注册 `{ def, run }`；skills 约定**不加新工具**、SKILL.md 必须带 `version` + 自测命令、索引维护在 `skills/README.md` 的 `## 索引`
- 架构决策速览（详见 AGENTS.md「架构决策」）：**记忆不提交**（状态文件在 `.bunbot/`，gitignore）；**写文件前自动快照**；**learn/ 只读**（理论地基，不预载）；**docs/ 面向自我迭代**；**配置三级**（环境变量 > 项目 > 全局 > 默认）；**编译产物自举**（`run_script` spawn 自身）；**release 流程**（构建收敛在 build.sh）
- 踩坑（血的教训）速览：BSD sed 多 -e 互相污染（复杂替换用 write_file 全量重写）；Bun 的 `os.homedir()` 不读 `$HOME`；`run_script` 默认 cwd 是临时沙箱（读写工作区要显式 `cwd: "."`）；长任务给更大 `timeoutMs`；`Bun.spawn` 的 stdout/stderr 都要消费；`--resume` 的 checkpoint 不含 system（恢复时重建）—— 详见 AGENTS.md「踩坑」

### 里程碑（M1-M5 全部完成 ✅）

- **M1（P0+P1）**：agent 认识自己、能改自己的文件 —— 自修改最小闭环成立
- **附加能力**：skills 组合操作库（多步、有坑、会过时的操作固化为 SKILL.md）+ AGENTS.md 项目级指令
- **M2（P2-1 ~ P2-4）**：工具描述 ACI 化 + 任务模式（`--self`）+ 上下文预算（tool result clearing）+ `--resume` checkpoint —— 长任务「不爆预算、不丢上下文、中断可续跑」闭环成立
- **M3（P3）**：git 安全阀补 `run_bash` + 测试闸门（收尾自动跑测试、失败自动回滚）+ 沙箱权限分级 + 审计日志 —— 自修改「可信、可回滚、不跑飞」闭环成立
- **M4（P4 通用化）**：可在**任意项目**使用 —— 身份/项目认知去专用化 + `.bunbot.json` 项目配置 + 状态文件移入 `.bunbot/` + 多生态测试闸门 + CLI 分发与 `init` + 只读模式 + 全局配置 + 大项目文件树 + 交互模式
- **M5（P5 全平台分发）**：GitHub Actions 矩阵构建 6 平台 + 用户安装脚本（`install.sh` / `install.ps1`：下载 → SHA256 校验 → 安装 → 加入 PATH）—— 打 tag 自动发布 Release，**无 bun 环境也能一键安装使用**

### 文档索引

| 文档 | 说明 |
| --- | --- |
| [docs/README.md](./docs/README.md) | 迭代计划索引 + 里程碑进度（面向自我迭代） |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 现状分析（as-is）：随代码演进更新的架构快照 |
| [blog.md](./blog.md) | agent 真实运行实录（自我进化过程） |
