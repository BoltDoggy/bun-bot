# 现状分析（as-is）

基于对 index.ts / src/ / skills/ / tests/ 的实际阅读与统计，更新于 **M1（P0+P1）+ skills 能力 + AGENTS.md 项目指令 + P2-1 ~ P2-4 + P3 质量与防护 + P4 通用化（可在任意项目使用）+ P5 全平台分发（GitHub Actions 构建 + 安装脚本）全部落地之后**。

## 快照数据

| 项 | 值 |
| --- | --- |
| index.ts | 339 行 / 15.9 KB（入口：CLI 命令拦截（init / --version / --help，API key 检查前）+ CLI 解析（--stream / --self / --resume / --interactive）+ runAgentLoop 主循环 + 记忆读写钩子 + P2-3 预算检查 + P2-4 checkpoint + P3-2 测试闸门收尾 + P3-4 审计日志钩子 + P4-10 交互模式 REPL） |
| src/ | tools.ts 547 行 / 26 KB · memory.ts 447 行 / 13.3 KB（含 checkpoint + P4-4/9）· context.ts 189 行 / 11.7 KB（P4-2）· config.ts 137 行 / 5.8 KB（P4-3/8）· gate.ts 190 行 / 8.4 KB（P4-5）· budget.ts 103 行 / 3.9 KB · git.ts 69 行 / 2.7 KB · audit.ts 76 行 / 2.6 KB（P4-4）· interactive.ts 55 行 / 2.3 KB（P4-10）· cli.ts 80 行 / 4.1 KB（P4-6 CLI：init / --version / --help）· bin/bun-bot.ts 33 行 / 1.3 KB（复用 cli.ts，bun link 分发） |
| release（P5） | `.github/workflows/build.yml`（81 行：矩阵 6 平台 + tag 发布 + 手动 artifact）· scripts/build.sh（59 行：本地/CI 共用构建）· scripts/install.sh（145 行：POSIX 安装脚本）· scripts/install.ps1（73 行：Windows 安装脚本） |
| 工具数量 | 6 个：`run_script` / `read_file` / `write_file` / `list_dir` / `run_bash` / `update_plan`（skills 不加新工具） |
| 工具描述 ACI 化 | ✅ P2-1 已完成：6 个工具 `description` 均带「示例：」JSON 参数形态的 example usage，参数语义同步打磨；系统提示词 [能力] 区块带极简 few-shot（双保险） |
| 任务模式 | ✅ P2-2 已完成：`--self` 注入 [任务模式] 区块（先 plan 后执行、逐项勾选、未完成计划续跑提示）；`update_plan` 工具全量覆盖式创建/勾选计划；`AgentState.activePlan` 持久化 + MEMORY.md「当前任务计划」区块；主循环结束重载 state 防覆盖 |
| 上下文预算 | ✅ P2-3 已完成：`budget.ts`（`estimateTokens` 中英混合离线估算 / `estimateMessagesTokens` / `compressContext` 最轻档 tool result clearing）；主循环每轮检查预算，超限压缩最早 tool 结果（保留前缀 + 清理标记，消息结构不动）；告警写回 `AgentState.contextWarnings`（[记忆] 区块 + MEMORY.md「上下文预算告警」区块可见） |
| checkpoint | ✅ P2-4 已完成：`--resume` 会话级断点续跑 —— `AGENT_CHECKPOINT.json` 持久化当前会话消息历史（不含 system，恢复时重建），每次消息变更落盘；中断（Ctrl+C / 超迭代 / 崩溃）后 `--resume` 恢复完整上下文继续；任务正常完成自动清除 |
| 项目级指令 | `AGENTS.md`（可选）：存在时由 `loadProjectContext` 加载进 [项目] 区块最前，[规则] 第 5 条声明其约束力（优先级高于 README/docs）；不存在时静默跳过 |
| skills | 1 个：`web-search` v2（search.ts / self-test.ts / samples/），索引进 [能力] 区块，细节按需 read_file |
| 模型 | `deepseek-v4-flash`（`BUN_BOT_MODEL` 可换，如 `deepseek-v4-pro`） |
| 最大迭代 | 150 轮（`BUN_BOT_MAX_ITERATIONS` 可调） |
| 脚本超时 | 默认 30s（`DEFAULT_TIMEOUT_MS`），`timeoutMs` 可放开长任务 |
| 上下文预算 | 默认 120000 tokens（`BUN_BOT_CONTEXT_BUDGET` 可调），超限触发 tool result clearing |
| 工具输出上限 | 65536 字符（4K → 64KB），截断处带偏移信息可续读 |
| read_file 硬上限 | 1MB（`MAX_READ_BYTES`） |
| 记忆 | `.bunbot/AGENT_STATE.json` / `.bunbot/MEMORY.md` 本地跨会话持久化（P4-4：状态目录默认 .bunbot/，gitignore 自动追加，不污染用户仓库）；含 `activePlan` + `contextWarnings`；`.bunbot/AGENT_CHECKPOINT.json` 会话级消息历史（任务完成即清除） |
| 自修改安全 | `write_file` 落盘前自动 git 快照 + 返回行级 diff 摘要；P3-1：`run_bash` 写操作命令前若工作区有未提交改动也自动快照（`snapshotIfDirty`） |
| 测试闸门 | ✅ P3-2 已完成：`src/gate.ts`（`runTestGate` / `revertToHead` / `enforceTestGate`）；主循环收尾若本会话发生过自修改（write_file / 写操作 run_bash 的 `gitSnapshot`）自动跑 `bun test`，失败自动回滚到**会话开始前 HEAD**（`git reset --hard` + `git clean -fd`，gitignore 本地状态不丢）并复测确认项目可继续跑 |
| 沙箱权限分级 | ✅ P3-3 已完成：路径（cwd / path）默认限制工作区内（`BUN_BOT_ALLOW_OUTSIDE_CWD=1` 放行）；`run_bash` 危险命令黑名单（rm -rf /、git push、fork bomb、sudo、设备写入等）直接拒绝；`BUN_BOT_PERMISSIONS=ask` 时写操作命令需确认 |
| 审计日志 | ✅ P3-4 已完成：`src/audit.ts` —— 每次工具调用入参/出参摘要落盘 `AUDIT.log.jsonl`（gitignore），`appendAudit` 内部防御性截断（400 / 500），`loadAudit` 最新在前 |
| 编译产物自举 | ✅ 已落地：`run_script` spawn 自身（`process.execPath`：源码时=bun、编译时=编译产物）；入口 `run <script>` 子命令（index.ts 拦截于 API key 检查前）用内嵌运行时执行外部脚本，且 `init` / `--version` / `--help` 同样走 API key 检查前拦截（编译产物 = 完整 CLI） —— `bun build --compile` 后无 bun 环境也能跑（端到端实测：PATH 仅 /usr/bin:/bin 下 `./bun-bot-demo run <script>` exitCode 0，Bun API / 相对 import / 顶层 await 全可用） |
| 全平台分发 | ✅ P5 已完成：`.github/workflows/build.yml` 原生矩阵构建 6 平台（ubuntu-latest → linux-x64 / ubuntu-24.04-arm → linux-arm64 / macos-13 → darwin-x64 / macos-latest → darwin-arm64 / windows-latest → windows-x64 / windows-11-arm → windows-arm64 实验性），tag `v*` 自动发布 Release（每个产物附 `.sha256`）、手动触发只出 artifact；`scripts/install.sh`（macOS/Linux）+ `scripts/install.ps1`（Windows）一行安装：检测平台 → 下载 → SHA256 校验 → 安装为 bun-bot（命令统一不带平台后缀）→ PATH；`scripts/build.sh` 本地与 CI 共用（bun install → bun test → bun build --compile → .sha256） |
| 自测 | 86 用例 / 508 expect，零外部依赖（`bun test`）；web-search 另有 `self-test.ts --online` 在线实测 |

## 模块解剖

```text
index.ts              入口：run 子命令自举（编译产物自带运行时）+ CLI 命令拦截（init / --version / --help，API key 检查前）+ CLI 解析（--stream / --self / --resume / --interactive）+ runAgentLoop 主循环 + 记忆读写钩子 + 预算检查 + checkpoint + 测试闸门收尾 + 交互模式 REPL
.github/workflows/     P5 发布工作流：build.yml —— 矩阵 6 平台（tag v* 触发 Release + workflow_dispatch 手动 artifact）
scripts/build.sh       P5 构建脚本（本地/CI 共用）：bun install → bun test → bun build --compile → SHA256 校验文件
scripts/install.sh     P5 安装脚本（POSIX sh）：检测平台 → 下载（latest/指定版本）→ SHA256 校验（失败中止）→ install -m 0755 重命名为 bun-bot → PATH 提示
scripts/install.ps1    P5 安装脚本（PowerShell）：架构检测 → 下载 .exe → Get-FileHash 校验 → 装为 bun-bot.exe → 加用户 PATH
src/tools.ts          工具注册表：6 个工具的定义与执行器（run_script spawn 自身：编译产物自举；P4-7 readonly 拒绝 + ask 白名单；permissionMode 接配置）
src/config.ts         项目/全局配置（P4-3/8）：loadConfig（环境变量 > .bunbot.json > ~/.bun-bot/config.json > 默认）+ API key fallback
src/context.ts        系统提示词组装：[身份] [能力] [项目] [记忆] [任务模式] [规则] + skills 索引 + AGENTS.md 约束声明 + contextWarnings 展示
src/memory.ts         记忆读写（P4-4/9）：状态文件在 .bunbot/（AGENT_STATE / MEMORY / CHECKPOINT，gitignore 自动追加）+ checkpoint 模块 + AGENTS.md + 项目上下文 + 文件树忽略/截断
src/budget.ts         上下文预算：token 估算 + 最轻档压缩器（tool result clearing：最早的 tool 结果摘要化，消息结构不动）
src/git.ts            git 安全快照：write_file + run_bash 写操作前（hasUncommittedChanges / snapshotIfDirty / currentHead）
src/gate.ts            测试闸门（P3-2 + P4-5）：detectTestCommand 多生态探测 / runTestGate / revertToHead / enforceTestGate
src/interactive.ts     交互模式（P4-10）：driveInteractive / isExitInput —— 多轮 REPL 消息跨轮保持，runRound 可注入离线测试
src/audit.ts           审计日志（P3-4）：appendAudit / loadAudit —— 落盘 .bunbot/AUDIT.log.jsonl
bin/bun-bot.ts         CLI 分发（P4-6）：复用 src/cli.ts 的 init / --version / --help / 透传 index.ts（bun link 全局安装；编译产物入口 index.ts 同样支持）
skills/               组合操作库：skills/<name>/SKILL.md + 实现 + 离线样本 + 自测
tests/                self-test 用例 86 / 508 expect（tools + memory + checkpoint + skills + AGENTS.md + P2/P3/P4 各闸门 + P5 release，零外部依赖）
```

## 工具集（6 个，description 均带 example usage）

| 工具 | 说明 | 示例 |
| --- | --- | --- |
| `run_script` | Bun 运行 JS/TS，默认沙箱 tmpdir，可指定 cwd 到工作区；`timeoutMs` 可配；输出 64KB 带偏移 | `{"code":"console.log(1+1)"}` |
| `read_file` | 读工作区文件，默认完整返回 64KB，可 offset 续读（单次硬上限 1MB） | `{"path":"src/tools.ts","offset":65536}` |
| `write_file` | 写工作区文件，自动 git 快照 + 返回行级 diff 摘要（改自己代码就靠它） | `{"path":"src/hello.ts","content":"..."}` |
| `list_dir` | 列目录（`-a` 显示隐藏文件、`depth` 限制递归深度） | `{"path":".","all":true,"depth":2}` |
| `run_bash` | shell 命令，cwd 默认工作区，可跑 git / bun test 等；P3-1 写操作命令前自动 git 快照；P3-3 危险命令被权限系统拒绝 | `{"command":"bun test"}` |
| `update_plan` | 更新任务计划（任务模式，P2-2）：全量覆盖式创建/勾选，进度写回 AGENT_STATE.json 跨会话保存 | `{"title":"新增工具","items":[{"text":"注册","done":false}]}` |

## P5 全平台分发（2026-08 完成）

| 项 | 落地 |
| --- | --- |
| 构建工作流 | `.github/workflows/build.yml`：`on` = push tag `v*` + workflow_dispatch；`strategy.matrix` 6 平台（ubuntu-latest / ubuntu-24.04-arm / macos-13 / macos-latest / windows-latest / windows-11-arm），windows-arm64 标 `experimental: true` + `continue-on-error` 不阻塞；步骤 = checkout → setup-bun → `bash scripts/build.sh <target>` → upload-artifact（dist/*）→ 若 tag 触发 `softprops/action-gh-release` 发布 Release（含 .sha256） |
| 构建脚本 | `scripts/build.sh [target]`：bun install → **bun test（测试闸门先绿才出产物）** → `bun build --compile index.ts --outfile dist/bun-bot-<target>[.exe]` → 生成 `.sha256`（sha256sum / shasum 兜底）；target 白名单校验；缺省自动检测当前平台（与 install.sh 同映射） |
| 安装脚本（unix） | `scripts/install.sh`（POSIX sh，`set -eu`）：`detect_target`（uname -s/-m → darwin/linux/windows × x64/arm64）；URL = `$BASE/latest/download/` 或 `$BASE/download/v<版本>/`；curl/wget 下载 → **SHA256 校验失败必须中止**（sha256sum -c / shasum -a 256 -c）→ `install -m 0755` 重命名为 `bun-bot` 装到 ~/.local/bin（/usr/local/bin 可写则用之）→ PATH 提示；环境变量可覆盖：`BUN_BOT_REPO` / `BUN_BOT_VERSION` / `BUN_BOT_INSTALL_DIR` / `BUN_BOT_TARGET` / `BUN_BOT_BASE_URL` |
| 安装脚本（windows） | `scripts/install.ps1`：`PROCESSOR_ARCHITECTURE` → x64/arm64；`Invoke-WebRequest` 下载 .exe → `Get-FileHash` SHA256 校验（失败删除并中止）→ 装为 `bun-bot.exe` 到 `%LOCALAPPDATA%\bun-bot\bin` → `SetEnvironmentVariable` 加用户 PATH |
| 端到端验证 | `tests/p5-release.test.ts`（9 用例 / 45 expect）：workflow 矩阵与触发断言；build.sh 关键逻辑断言；install.sh 用本地 `Bun.serve` mock release 服务器（`BUN_BOT_BASE_URL` 指向）跑真实下载 → 校验 → 安装（可执行位用 `statSync().mode & 0o111`）；windows .exe 命名；指定版本路径；校验失败中止且不落盘；install.ps1 关键逻辑断言 |

## 任务模式（P2-2）

| 行为 | 说明 |
| --- | --- |
| 入口 | `bun run index.ts --self "任务"`：`--self` 标志注入 [任务模式] 区块 |
| 流程 | 首轮 `update_plan` 创建计划（title + 可独立验证的分步 items）→ 每完成一步全量提交并勾选（done + detail 验证结果）→ 全部 done 后总结 |
| 持久化 | `AgentState.activePlan`（title / items / status / createdAt / updatedAt）写回 `AGENT_STATE.json`，MEMORY.md 同步「当前任务计划」区块 |
| 续跑 | 会话重启后 [记忆] 区块展示进度；`--self` 模式下检测到未完成计划输出续跑提示，优先继续而非重建 |
| 防覆盖 | 主循环结束时 `loadState()` 重载再写回 lastTask/lastSummary，避免旧 state 引用冲掉会话中 update_plan 的写入 |
| 完成 | 全部 items done → status 自动置 `"done"`（百分比 100%） |

## 上下文预算（P2-3）

| 行为 | 说明 |
| --- | --- |
| 估算 | `estimateTokens`：ASCII 4 字符 ≈ 1 token、中文等 1 字符 ≈ 1 token（离线近似，用于相对预算检查，不调 tokenizer API） |
| 压缩 | `compressContext(messages, budget)`：超限时从最早的 `role="tool"` 消息开始，content 摘要化（保留前 200 字符 + 清理标记），直到低于预算或无可清理项 |
| 安全 | 消息数量与顺序不变、`tool_call_id` 关联保留（API 合法）、system 消息永不清理、未超限不复制数组 |
| 接入 | 主循环每轮（assistant 消息后 + 每个 tool 结果后）检查 `estimateMessagesTokens > BUDGET_TOKENS`，触发压缩并打印 `[budget]` 告警 |
| 告警 | 写回 `AgentState.contextWarnings`（保留最近 10 条），[记忆] 区块 + MEMORY.md「上下文预算告警」区块展示 —— agent 重启后能感知长任务触发过多少次压缩 |
| 配置 | `BUN_BOT_CONTEXT_BUDGET`（默认 120000） |

## checkpoint / --resume（P2-4）

| 行为 | 说明 |
| --- | --- |
| 入口 | `bun run index.ts --resume`（可不带任务直接续跑；带任务则作为追加指令） |
| 保存 | `saveCheckpoint(messages)`：每次消息变更（assistant 回复后 + 每个工具结果入队后）把当前历史落盘 `AGENT_CHECKPOINT.json`，**过滤 system**（恢复时用最新 `buildSystemPrompt` 重建，state/project 变了旧 system 会过时） |
| 恢复 | `--resume` 时 `loadCheckpoint()` 取历史 → `buildResumeMessages` 组装（末尾 tool 消息补 user 兜底保证 API 合法 + 可选新任务追加）→ system 重建后继续主循环 |
| 清理 | 任务正常完成（无 tool_calls 的最终回复）→ `clearCheckpoint()`；超迭代强制结束时 checkpoint 保留，可 `--resume` 续跑 |
| 与任务模式 | 互补：`activePlan`（P2-2）管**任务级目标**（首轮 plan、逐项勾选，重启可见进度）；checkpoint 管**会话级上下文**（完整消息历史，中断后不丢已执行的步骤） |
| 安全 | `AGENT_CHECKPOINT.json` 在 .gitignore（会话写回噪音，仅本地持久化） |

## 项目级指令（AGENTS.md，可选）

| 行为 | 说明 |
| --- | --- |
| 加载时机 | `loadProjectContext()` 读取工作区根 `AGENTS.md`（`readAgentDirective()`），存在则置于项目认知最前 |
| 优先级 | 高于 README / docs：它是用户与 agent 之间的项目级契约 |
| 约束声明 | `buildSystemPrompt` 的 [规则] 第 5 条：内容冲突时以 AGENTS.md 为准 |
| 上限 | 8000 字符截断提示（与 README 同级），需完整内容可 read_file |
| 缺失时 | 返回 null / 静默跳过，老项目系统提示词不变 |

## skills（组合操作层，建在工具之上）

| skill | 一句话 | 版本 | 自测 |
| --- | --- | --- | --- |
| `web-search` | 联网搜索（Bing 主路径 + DDG 降级） | v2 | `bun run skills/web-search/self-test.ts [--online]` |

加载机制：`context.ts` 的 `skillsIndex()` 从 `skills/README.md` 提取索引表格进 [能力] 区块（只此一层）；
需要细节时用现有 `read_file` 读 `skills/<name>/SKILL.md` —— **不加新工具**。

## agent 主循环（index.ts）

1. 加载记忆（`loadState`）；首次运行初始化 `AGENT_STATE.json` / `MEMORY.md`
2. 加载项目上下文（`loadProjectContext`）→ AGENTS.md（如有）+ README + docs + 文件树 + 记忆
3. 组装系统提示词（`buildSystemPrompt`）→ 六区块（--self 时含 [任务模式]）+ skills 索引，预算 <5%
4. **`--resume` 时从 `AGENT_CHECKPOINT.json` 恢复会话消息历史**（system 重建 + 末尾 tool 兜底 + 可选新任务追加）
5. 记录**会话开始 HEAD**（`sessionStartHead`，P3-2 回滚锚点）；循环：`chatCompletion` → 有 `tool_calls` 就 `executeTool` 并回填 → **每轮检查上下文预算，超限压缩早期 tool 结果（P2-3）** → **每次消息变更落盘 checkpoint（P2-4）** → **每次工具调用后 appendAudit 入参/出参摘要（P3-4）** → **跟踪 didModify（write_file / 写操作 run_bash）** → 直到无工具调用
6. 任务完成（无 tool_calls）→ **若 didModify 且为 git 仓库：收尾自动跑测试闸门（P3-2），失败自动回滚到会话开始前并复测** → **重载 `loadState()`** 后写回 `lastTask` / `lastSummary` / `lastRunAt` / `contextWarnings` → **`clearCheckpoint()`** → 退出

## 已解决的旧差距（M1 + skills + AGENTS.md + P2-1 + P2-2 + P2-3 + P2-4）

1. ~~不认识自己~~ → 系统提示词五区块，启动加载 README + docs 索引 + 记忆
2. ~~无记忆~~ → `AGENT_STATE.json` / `MEMORY.md` 持久化，重启可引用上次决策
3. ~~改不了自己~~ → 读写工作区的四工具 + git 快照，形成"读 → 改 → 测"闭环
4. ~~输出被截断~~ → 4000 → 65536 字符，截断带偏移可续读
5. ~~跨会话能力只能留在 lastSummary~~ → skills 组合操作库：SKILL.md 固化「多步 + 有坑 + 会过时」的操作（web-search v2 的修正教训永久沉淀），索引进提示词、按需 read_file、自带自测
6. ~~项目约定无处安放~~ → `AGENTS.md` 项目级指令：用户与 agent 的契约，加载进 [项目] 最前 + [规则] 声明约束力，接入通用 AGENTS.md 工具链
7. ~~工具描述无示例（few-shot 缺失）~~ → P2-1 工具描述 ACI 化：工具 description 均带 example usage + 参数语义打磨，[能力] 区块同步 few-shot（learn 工具设计五原则之五落地）
8. ~~长任务无目标锚点~~ → P2-2 任务模式：agent 首轮产出 plan、逐项勾选，进度写回 `AGENT_STATE.json`（activePlan），中断/重启后从上次断点继续
9. ~~长任务消息无限增长（context rot）~~ → P2-3 上下文预算：`budget.ts` token 估算 + 最轻档 tool result clearing（最早的 tool 结果摘要化，先保 recall 再迭代 precision），告警写回 contextWarnings
10. ~~中断丢上下文~~ → P2-4 `--resume` checkpoint：`AGENT_CHECKPOINT.json` 持久化会话消息历史（每次消息变更落盘），中断后恢复完整上下文继续，任务完成自动清除
11. ~~编译产物只能在本地单平台构建~~ → P5 全平台分发：GitHub Actions 矩阵 6 平台 + tag 自动发布 Release + `scripts/install.sh` / `install.ps1` 一行安装（下载 → SHA256 校验 → 安装）

## P3 质量与防护（2026-08 完成）

| 项 | 落地 |
| --- | --- |
| P3-1 git 安全阀补 run_bash | `src/git.ts`：`hasUncommittedChanges` / `snapshotIfDirty` / `currentHead`；`run_bash` 写操作命令（sed -i / git commit / bun install / touch 等）前工作区 dirty 则自动快照，只读命令不产生噪音提交 |
| P3-2 测试闸门 | `src/gate.ts`：`runTestGate`（bun test pass/fail）/ `revertToHead`（reset --hard + clean -fd）/ `enforceTestGate`（失败自动回滚 + 复测）；主循环收尾 didModify 时自动触发；无测试信号（无 package.json / tests/）自动跳过 |
| P3-3 沙箱权限分级 | 路径限制工作区内（cwd / path 越界拒绝）；危险命令黑名单（rm -rf /、git push、fork bomb、sudo、chmod -R、设备写入、下载即执行）；`BUN_BOT_PERMISSIONS=ask` 写操作需确认；`BUN_BOT_ALLOW_OUTSIDE_CWD=1` 放行越界 |
| P3-4 审计日志 | `src/audit.ts`：每次工具调用入参/出参摘要落盘 `AUDIT.log.jsonl`（gitignore），`appendAudit` 防御性截断（400/500），`loadAudit` 最新在前；主循环 executeTool 后调用 |

> 里程碑进度与迭代索引见 [docs/README.md](./README.md)。
