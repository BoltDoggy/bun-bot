# bun-bot

一个自我认知为 **Bun.js** 运行时的 agent —— 通过 DeepSeek 的 Function Calling 获得工具集，自己编写 JavaScript/TypeScript 脚本，由 Bun 实际执行，再观察结果继续推理，直到任务完成。

**M1 里程碑（P0+P1）**：agent 认识自己、能改自己的文件 —— 自修改最小闭环成立。
**附加能力**：skills 组合操作库 —— 多步、有坑、会过时的操作固化成 SKILL.md，按需加载、自带自测。
**M2 完成（P2-1 ~ P2-4）**：工具描述 ACI 化 + 任务模式（`--self`）+ 上下文预算（tool result clearing）+ `--resume` checkpoint —— 长任务「不爆预算、不丢上下文、中断可续跑」闭环成立。
**M3 完成（P3）**：git 安全阀补 `run_bash` + 测试闸门（收尾自动跑测试、失败自动回滚）+ 沙箱权限分级 + 审计日志 —— 自修改「可信、可回滚、不跑飞」闭环成立。

## 特性

- 🧠 **代码驱动推理**：所有结论都通过真实运行脚本验证，而不是凭空猜测
- 🔧 **工具注册表**：`src/tools.ts` 用注册表模式管理工具，agent 可以读自己 → 改自己 → 测自己
- 🎯 **ACI 化工具描述**：6 个工具的 `description` 均带「示例：」example usage（few-shot），参数语义同步打磨，系统提示词 [能力] 区块双保险（learn 工具设计五原则之五落地）
- 📋 **任务模式（P2-2）**：`--self` 开任务模式 —— agent 首轮产出 plan（`update_plan`），逐项执行勾选，进度写回 `AGENT_STATE.json`；中断/重启后从上次断点继续（checkpoint 的数据基础）
- 🧮 **上下文预算（P2-3）**：`budget.ts` 做 token 估算（中英混合离线近似），接近上限时压缩早期工具结果（最轻档 **tool result clearing**：最早的 tool 消息摘要化，消息结构不动、system 永不清理）；超限告警写回 `contextWarnings`，[记忆] 区块可见 —— 长任务不爆预算、不丢上下文（context rot 对策）
- 🔁 **断点续跑（P2-4）**：`--resume` 从上次会话 checkpoint 恢复 —— `AGENT_CHECKPOINT.json` 持久化消息历史（每次消息变更落盘），中断（Ctrl+C / 超迭代 / 崩溃）后恢复完整上下文继续，任务完成自动清除；与 `activePlan` 互补（任务级锚点 + 会话级上下文）
- 🧭 **自我认知**：启动时加载 AGENTS.md（如有）+ README + docs + 文件树 + 记忆，系统提示词含「身份 / 能力 / 项目 / 记忆 / 规则」五区块
- 📜 **AGENTS.md 项目级指令**：项目根目录的 `AGENTS.md`（可选）是用户与 agent 的项目级契约，存在时自动加载进 [项目] 区块最前、优先级最高（高于 README / docs），[规则] 中声明其约束力；类似 CLAUDE.md 的通用约定，方便接入任何支持 AGENTS.md 的 agent 工具链
- 🧩 **skills 组合操作库**：`skills/<name>/SKILL.md` 固化「多步 + 有坑 + 会过时」的操作（如 web-search），系统提示词只放一层索引，细节按需 `read_file` 加载；每个 skill 带版本号 + 自测命令，纳入测试闸门
- 💾 **跨会话记忆**：`AGENT_STATE.json`（机器态）+ `MEMORY.md`（人类可读版）本地持久化（gitignore，不纳入版本控制），重启后能引用上次决策
- 🛡️ **自修改安全（P3）**：`write_file` 落盘前自动 git 快照 + 返回行级 diff 摘要；`run_bash` 写操作命令前若工作区有未提交改动也自动快照（P3-1）
- ✅ **测试闸门（P3-2）**：`src/gate.ts` —— 本会话发生过自修改时，收尾自动跑 `bun test`（verify its work），失败自动回滚到会话开始前 HEAD（`git reset --hard` + `git clean -fd`，gitignore 本地状态不丢）并复测确认项目可继续跑
- 🔒 **沙箱权限分级（P3-3）**：路径（cwd / path）默认限制工作区内；`run_bash` 危险命令黑名单（`rm -rf /`、`git push`、fork bomb、sudo 等）直接拒绝；`BUN_BOT_PERMISSIONS=ask` 时写操作命令需人工确认
- 📝 **审计日志（P3-4）**：每次工具调用入参/出参摘要落盘 `AUDIT.log.jsonl`（gitignore，本地持久化），`appendAudit` 防御性截断、`loadAudit` 读回
- ⚡ **Bun 原生执行**：脚本用 `Bun.spawn` 运行，`run_script` 默认沙箱 tmpdir，可指定工作区 cwd

## 快速开始

```bash
bun install
cp .env.example .env   # 填入 DEEPSEEK_API_KEY
bun run index.ts "计算斐波那契数列第 30 项"            # 默认非流式
bun run index.ts --stream "计算斐波那契数列第 30 项"   # SSE 流式输出（--stream 可选）
bun run index.ts --self "给我加一个 read_file 工具并补文档"  # 任务模式：先 plan 后执行、逐项勾选、中断可续跑
bun run index.ts --resume                             # 从上次断点续跑（中断后恢复消息历史；可带新任务追加）
```

> 可选：在项目根目录放一个 `AGENTS.md` 写入项目约定（如禁止改哪些文件、必须跑什么测试），
> bun-bot 启动时会自动加载并优先遵守它。

## 工具集

| 工具 | 说明 |
| --- | --- |
| `run_script` | 用 Bun 运行 JS/TS（cwd 可指定工作区，默认 tmpdir；超时可配；输出上限 64KB 带偏移） |
| `read_file` | 读工作区文件，默认完整返回 64KB，可 offset 续读（单次硬上限 1MB） |
| `write_file` | 写工作区文件，自动 git 快照 + diff 摘要 |
| `list_dir` | 列目录（`-a` 显示隐藏文件、`depth` 限制深度，最大 8） |
| `run_bash` | 执行 shell 命令（cwd 默认工作区，超时可配；写操作命令前自动 git 快照；危险命令被权限系统拒绝） |
| `update_plan` | 更新任务计划（任务模式，P2-2）：全量覆盖式创建/勾选，进度写回 AGENT_STATE.json 跨会话保存 |

> 6 个工具的 `description` 均带 example usage（ACI 化，P2-1），详情见 `src/tools.ts`。

## skills（组合操作库）

| skill | 一句话 | 自测 |
| --- | --- | --- |
| `web-search` | 联网搜索（Bing 主路径 + DDG 降级），附真实 HTML 解析模板 | `bun run skills/web-search/self-test.ts` |

加载方式：系统提示词 [能力] 区块只放上面的索引，需要时用 `read_file` 读 `skills/<name>/SKILL.md`。

## 项目结构

```
├── index.ts            # 入口：CLI 解析（--stream / --self / --resume）+ agent 主循环（保持轻量）
├── AGENTS.md            # 可选：项目级指令（存在时自动加载，优先级最高）
├── src/
│   ├── tools.ts        # 工具注册表（新增工具在此注册；description 带 example usage）
│   ├── context.ts      # 系统提示词组装：身份 + 能力 + 项目 + 记忆 + 任务模式 + 规则
│   ├── memory.ts       # 记忆读写：AGENT_STATE.json / MEMORY.md（含 activePlan + contextWarnings）+ AGENT_CHECKPOINT.json（--resume）+ AGENTS.md + 项目上下文
│   ├── budget.ts       # 上下文预算：token 估算 + 超限压缩（P2-3：tool result clearing）
│   ├── gate.ts         # 测试闸门（P3-2）：收尾自动跑测试、失败自动回滚到会话前 HEAD
│   ├── audit.ts        # 审计日志（P3-4）：工具调用入参/出参摘要落盘 AUDIT.log.jsonl
│   └── git.ts          # git 安全快照（write_file + run_bash 写操作前）
├── skills/             # 组合操作库（SKILL.md + 实现 + 自测）
│   └── web-search/     # 联网搜索 skill（search.ts / self-test.ts / samples/）
├── tests/
│   └── tools.test.ts   # 35 个 self-test 用例（修改自身代码后的验证闸门）
├── AGENT_STATE.json    # 机器可读记忆（本地持久化，gitignore）
├── AGENT_CHECKPOINT.json # 会话级断点（--resume 消息历史，本地持久化，gitignore，任务完成即清除）
├── MEMORY.md           # 人类可读记忆（本地持久化，gitignore）
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
| `BUN_BOT_CONTEXT_BUDGET` | `120000` | 上下文 token 预算（P2-3：超限时压缩早期工具结果） |
| `BUN_BOT_PERMISSIONS` | `auto` | 权限模式（P3-3）：`auto` 全自动（黑名单拒绝危险命令）/ `ask` 写操作命令需人工确认 |
| `BUN_BOT_ALLOW_OUTSIDE_CWD` | 未设置 | P3-3：设为 `1` 时放行 cwd / path 超出工作区（不建议） |

## 自测

```bash
bun test   # 35 个用例：工具层 + 记忆层 + checkpoint + skills 层 + AGENTS.md + P2-1 ACI 化 + P2-2 任务模式 + P2-3 上下文预算 + P2-4 --resume + P3 安全（run_bash 快照 / 测试闸门回滚 / 路径限制 / 危险命令 / 审计日志），零外部依赖
bun run skills/web-search/self-test.ts --online   # web-search skill 在线实测（可选）
```

## 迭代路线

见 [docs/PLAN.md](./docs/PLAN.md)。M1 = P0（认知与记忆）+ P1（工具集扩充）✅。M2 = P2-1 ACI 化 ✅、P2-2 任务模式 ✅、P2-3 上下文预算 ✅、P2-4 --resume checkpoint ✅（**P2 全部完成**）。**M3 = P3 质量与防护 ✅**（git 安全阀补 run_bash / 测试闸门自动回滚 / 沙箱权限分级 / 审计日志，2026-08 完成）—— 自修改可信、可回滚、不跑飞。
