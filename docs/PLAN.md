# bun-bot 自我迭代计划：拥抱 1M 上下文

> 理论地基：`learn/`（结构化笔记 `learn/README.md` + 5 篇权威一手原文 `learn/raw/`）——提示词工程 × 上下文工程 × Harness 工程。
> 本计划的差距分析、优先级与验收口径均来自那里的学习成果；计划修订时先回 `learn/` 校准。
> 更新时间：2026-08 · 对齐 M1 + skills + learn + AGENTS.md + P2-1 ~ P2-4 + P3 后的现状（**P2 全部完成 + P3 质量与防护落地**）。

## 0. 为什么现在迭代

bun-bot 已完成 M1（P0+P1）与 skills 能力：`index.ts`（入口）+ `src/` 六模块 + `skills/` + `tests/`，自修改最小闭环成立。继续迭代的方向由 learn/ 三大主题校准：

| 工程 | 回答的问题 | 对本体的意义 |
| --- | --- | --- |
| **提示词工程** | 指令怎么写？ | 系统提示词 right altitude、分节、few-shot 精选（`learn/README.md` §1） |
| **上下文工程** | 每次推理喂什么？ | JIT 检索 / 渐进披露 / 长任务三件套（compaction、结构化笔记、子 agent）（§2） |
| **Harness 工程** | agent 怎么跑？ | ACI 工具设计五原则、Claude Code 实践清单（permissions/hooks/checkpoint/resume）（§3） |

M1 已解决的旧约束（当时为了省 token）：

| 旧约束 | 1M 时代的问题 | 现状 |
| --- | --- | --- |
| system prompt 极简，不认自己 | 没有项目意识，说不出自己是什么 | ✅ 五区块提示词（身份/能力/项目/记忆/规则） |
| 工具输出截 4000 字符 | 推理被截断的信息误导 | ✅ 65536 + 偏移续读 |
| 无记忆，每次运行从零开始 | 无法积累决策 | ✅ `AGENT_STATE.json` / `MEMORY.md` |
| 只能写 tmpdir，改不了工作区 | 永远"分析"而不"动手" | ✅ 五工具读写工作区 |
| 150 轮上限、30s 固定超时 | 长任务没有节奏感 | ✅ 均可配置 |

learn/ 校准后的**新差距（差距即路线图，详见 `learn/README.md` §4）**：

| learn/ 指出的差距 | 对应计划 |
| --- | --- |
| 工具描述无 example usage（工具设计五原则之五：prompt-engineering 工具描述） | **P2 第 1 项**（成本最低、收益最直接）✅ 已完成 |
| 无 token 预算 / 无 compaction（context rot：token 越多回忆越差） | **P2 budget.ts + tool result clearing**（从最轻档压缩做起）✅ 已完成 |
| 无 `--resume` / checkpoint（Claude Code 实践清单） | **P2 checkpoint**（会话级消息历史持久化）✅ 已完成 |
| 无测试闸门自动 revert（verify its work） | **P3 测试闸门** ✅ 已完成（2026-08） |
| 无权限分级 / hooks（Claude Code 清单） | **P3 沙箱扩展** ✅ 已完成（2026-08） |

**一句话：让 bun-bot 从"会算数的脚本执行器"迭代成"能读懂自己、修改自己、记住自己"的长期 agent。**

## 1. 1M 上下文解锁的能力

- **整库进上下文**：README + docs + 源码结构 + 记忆，全量塞进系统提示词，预算占比 <5%。
- **完整工具反馈**：不再 4K 截断，文件内容 / 测试输出 / diff 完整回传（默认上限 64KB，可配置）。
- **长视野任务**：一次会话完成"新增一个工具 + 写文档 + 跑测试 + 收尾"的完整闭环。
- **跨会话记忆**：状态文件持久化，重启后带着上次的决策继续。
- **跨会话能力沉淀**：skills 组合操作库把「多步 + 有坑 + 会过时」的操作固化成 SKILL.md，不再依赖 lastSummary 里会丢细节的结论。
- **断点续跑**：`--resume` 从上次会话 checkpoint 恢复完整消息历史，中断（Ctrl+C / 超迭代 / 崩溃）后不丢已执行的步骤。

## 2. 目标架构

```text
index.ts              入口：CLI 解析 + agent 主循环（保持轻量）
src/tools.ts          工具定义与执行器（注册表模式，方便自增工具）
src/context.ts        系统提示词组装：身份 + 项目 + 记忆 + 规则 + skills 索引
src/memory.ts         记忆读写：AGENT_STATE.json / MEMORY.md / AGENT_CHECKPOINT.json（--resume）
src/budget.ts         上下文 token 预算与超限压缩（P2-3：tool result clearing）✅ 已建
src/gate.ts           测试闸门（P3-2：收尾自动跑测试、失败自动回滚到会话前 HEAD）✅ 已建
src/audit.ts          审计日志（P3-4：工具调用入参/出参摘要落盘 AUDIT.log.jsonl）✅ 已建
src/git.ts            git 安全快照（write_file + run_bash 写操作前）与 HEAD 查询 ✅ 已建
skills/               组合操作库：skills/<name>/SKILL.md + 实现 + 样本 + 自测
tests/                self-test 用例（agent 修改自身代码后的验证闸门）
learn/                理论地基：5 篇权威一手材料 + 结构化笔记（只读，按需 read_file，不预载）
```

> 当前已落地：index.ts / tools.ts / context.ts / memory.ts / budget.ts / gate.ts / audit.ts / git.ts / skills/ / tests/ / learn/（见 [ARCHITECTURE.md](./ARCHITECTURE.md) 快照）。
> 架构的理论依据：`learn/raw/anthropic-effective-context-engineering.md`（上下文工程，budget.ts 的来由）+ `anthropic-writing-tools-for-agents.md`（工具五原则，ACI 化的来由）+ `anthropic-claude-code-best-practices.md`（checkpoint/resume，P2-4 的来由）。

## 3. 分阶段计划

### P0 · 认知与记忆 —— 让 agent 知道自己是谁 ✅（M1 已完成）

**目标**：启动时 agent 能准确说出"我是谁、项目结构、上次干了什么"。

改动清单：
- [x] system prompt 增加结构化"自我认知"区块（见 §4）
- [x] 新增 `AGENT_STATE.json`：决策、踩坑、TODO、上次任务，运行结束时写回
- [x] 新增 `MEMORY.md`（人类可读版，git 可追踪）
- [x] 启动钩子：`loadContext()` 自动加载 README + docs 索引 + 记忆（落地为 `memory.ts` 的 `loadProjectContext()`）

**验收**：✅ 连跑两次任务，第二次能引用第一次的决策（跨会话记忆生效）。

### P1 · 工具集扩充 —— 让 agent 能真正改自己 ✅（M1 已完成）

**目标**：形成"读自己 → 改自己 → 测自己"的最小闭环。

新增工具（4 个已注册到 `src/tools.ts`）：
| 工具 | 说明 | 状态 |
| --- | --- | --- |
| `read_file` | 读工作区文件，默认完整返回（上限 64KB 可配，硬上限 1MB） | ✅ |
| `write_file` | 写工作区文件（配合 git 快照 + diff 摘要） | ✅ |
| `list_dir` | 列目录，支持 `-a` / 深度限制 | ✅ |
| `run_bash` | 执行 shell 命令（`cwd` 可指定工作区） | ✅ |

升级 `run_script`：
- [x] 支持 `cwd` 参数（默认 tmpdir，可指定工作区）
- [x] 超时可配（`timeoutMs`，默认 30s → 长任务可放开）
- [x] 输出上限 4000 → 65536，截断处带偏移信息

**验收**：✅ `bun run index.ts "把 index.ts 顶部的注释改成两行"` 真实落盘 + diff 可见 + `bun test` 17 用例全绿。

### skills · 组合操作库 —— 跨会话能力沉淀 ✅（已完成）

**目标**：把「多步、有坑、会过时」的操作固化成可复用、可自测的 SKILL.md。

- [x] `skills/README.md` 索引（名字 + 一句话 + 自测命令），被 `context.ts` 的 [能力] 区块引用
- [x] `skills/web-search/`：search.ts（Bing 主路径 + DDG 降级 + 重试）+ self-test.ts（离线样本 + `--online`）+ SKILL.md
- [x] **不加新工具**：加载用现有 `read_file` 按需读取，保持工具集精简
- [x] skill 必须带版本号 + 自测命令，纳入测试闸门（`bun test` 含解析器用例）

**验收**：✅ `bun test` 17 用例全绿 + `bun run skills/web-search/self-test.ts --online` 在线实测 Bing 10 条；v1 全局正则解析 0 条的教训永久沉淀进 SKILL.md 踩坑清单。

### P2 · 长任务与自迭代循环 ✅（M2 已完成）

**目标**：一次会话能自主完成多步骤的自我迭代；长任务不丢上下文、不爆预算、中断可续跑。对齐 `learn/README.md` §4 的"三条最值得立刻做的"。

- [x] **工具描述 ACI 化**：5 个工具的 `description` 补 example usage（如 `run_script` 给出"计算斐波那契"的调用示例），把工具描述当 prompt 打磨（工具设计五原则之五；**成本最低、收益最直接，先做**）✅（2026-08 完成：tools.ts 五工具 description 均带「示例：」JSON 参数形态 + 参数语义打磨；context.ts [能力] 区块同步 few-shot 双保险；测试新增 2 用例固化验收）
- [x] **任务模式**：agent 首轮产出 plan，逐项勾选，进度写回 `AGENT_STATE.json`（= learn 的结构化笔记 / agentic memory，跨上下文重置续跑不丢目标）✅（2026-08 完成：`update_plan` 工具全量覆盖式创建/勾选计划，`AgentState.activePlan` 持久化 + MEMORY.md 同步「当前任务计划」区块；`--self` 标志注入 [任务模式] 区块（先 plan 后执行、逐项勾选、未完成计划续跑提示）；主循环结束重载 state 防覆盖；测试新增 3 用例固化验收）
- [x] **上下文预算**：`budget.ts` 做 token 计数，接近上限时压缩早期消息——**从最轻档 tool result clearing 做起**（工具结果用过即清，先保 recall 再迭代 precision；1M 也非无限，context rot 真实存在）✅（2026-08 完成：`src/budget.ts` 新建 `estimateTokens`（中英混合离线估算）/ `estimateMessagesTokens` / `compressContext`（最早的 tool 消息 content 摘要化：保留前缀 + 清理标记，消息结构不动、tool_call_id 关联保留，system 永不清理）；index.ts 主循环每轮检查预算、超限压缩并把告警写回 `AgentState.contextWarnings`（[记忆] 区块 + MEMORY.md 可见）；`BUN_BOT_CONTEXT_BUDGET` 可配（默认 120000）；测试新增 6 用例固化验收）
- [x] **长任务 checkpoint**：`--resume` 从上次断点续跑（会话级消息历史持久化，中断后恢复完整上下文继续；任务模式的 activePlan 是任务级锚点，checkpoint 是会话级全量恢复，两者互补）✅（2026-08 完成：`src/memory.ts` 新增 `AGENT_CHECKPOINT.json` —— `saveCheckpoint`（每次消息变更落盘，过滤 system：恢复时用最新 `buildSystemPrompt` 重建）/ `loadCheckpoint` / `clearCheckpoint`（任务正常完成时清除）/ `buildResumeMessages`（末尾 tool 消息补 user 兜底保证 API 合法 + 可选新任务追加）；index.ts `--resume` 标志（task 可空：不带任务直接续跑，带任务作为追加指令）；超迭代强制结束时 checkpoint 保留可续跑；测试新增 2 用例固化验收）

**验收**：`bun run index.ts --self "给我加一个 read_file 工具并补文档"` 全流程无人干预完成；模拟 100 轮长任务不丢上下文、不爆预算；`bun run index.ts --resume`（中断后）从上次断点恢复消息历史继续，任务完成自动清除 checkpoint。✅（P2-1 ~ P2-4 各自验收已勾选）

### P3 · 质量与防护 ✅（M3 已完成）

**目标**：让自修改可信、可回滚、不跑飞。对齐 learn 的 verify its work（测试闸门）+ Claude Code 实践清单（permissions / audit）。

- [x] **git 安全阀补 run_bash**：`write_file` 落盘前自动快照（M1 已有）；P3-1 起 `run_bash` 执行"写操作"命令（sed -i / git commit / bun install / touch 等）前，若工作区有未提交改动先 `git add -A && git commit` 固化（`src/git.ts` 新增 `hasUncommittedChanges` / `snapshotIfDirty` / `currentHead`）—— shell 直接改文件也可回滚；只读命令（git status / git diff）不产生噪音提交 ✅（2026-08 完成）
- [x] **测试闸门**：新建 `src/gate.ts` —— `runTestGate`（工作区跑 `bun test`，pass/fail + 输出）/ `revertToHead`（`git reset --hard <head>` + `git clean -fd`，gitignore 的本地状态不丢）/ `enforceTestGate`（失败自动回滚到**会话开始前 HEAD** + 复测确认项目可继续跑）；`index.ts` 收尾时若本会话发生过自修改（write_file / 写操作 run_bash 的 `gitSnapshot`）自动触发，失败自动回滚 ✅（2026-08 完成：= learn 的 verify its work，给 agent 能跑出 pass/fail 的验证信号）
- [x] **沙箱权限分级**：路径（cwd / path）默认限制在工作区内（越界拒绝，`BUN_BOT_ALLOW_OUTSIDE_CWD=1` 可放行）；`run_bash` 危险命令黑名单（`rm -rf /`、`git push`、fork bomb、sudo、设备写入等）直接拒绝；`BUN_BOT_PERMISSIONS=ask` 时写操作命令需人工确认（无人值守返回提示）✅（2026-08 完成：Claude Code permissions 模式简化落地 —— 全自动区（默认）+ 需确认区）
- [x] **审计日志**：新建 `src/audit.ts` —— 每次工具调用入参/出参摘要落盘 `AUDIT.log.jsonl`（gitignore），`appendAudit` 内部防御性截断（400 / 500 字符），`loadAudit` 读回（最新在前）✅（2026-08 完成）

**验收**：✅ `tests/tools.test.ts` 新增 5 用例 —— 模拟"故意写坏补丁（语法错误测试文件）→ `enforceTestGate` 自动回滚到会话前 HEAD + 复测通过 + 坏文件被 clean 删除"，`bun test` 35 用例 / 225 expect 全绿，`bun build index.ts` 编译通过。

## 4. 系统提示词结构（预算 <5%）

```text
[身份]  我是 bun-bot，一个自我认知为 Bun.js 运行时的 agent
[能力]  工具契约：run_script / read_file / write_file / list_dir / run_bash / update_plan（各带 example usage）
        + skills 索引：web-search 等（细节按需 read_file skills/<name>/SKILL.md）
[项目]  文件树 + 架构图 + 关键文件位置 + 当前 MODE
[记忆]  上次任务的决策、踩坑、TODO、当前任务计划、上下文预算告警（来自 AGENT_STATE.json）
[任务模式]（--self 时注入）先 plan 后执行、逐项勾选、未完成计划续跑
[规则]  改工作区前必须 git 快照；改完必须跑 tests/；工具输出默认完整读取
```

> ✅ 已按此结构落地于 `src/context.ts`（skills 索引由 `skillsIndex()` 从 `skills/README.md` 提取）。right altitude 原则见 `learn/README.md` §1.3。

## 5. 记忆格式（草案）

```jsonc
// AGENT_STATE.json
{
  "version": 1,
  "lastTask": "给 run_script 加 cwd 支持",
  "decisions": [
    { "when": "2025-..", "what": "工具输出上限提到 64KB", "why": "1M 上下文下 4K 截断浪费能力" }
  ],
  "pitfalls": ["Bun.spawn 的 stderr 要单独消费，否则管道会阻塞"],
  "todo": ["P1: 给 write_file 加 git 快照", "P2: 上下文预算摘要算法"],
  "contextWarnings": ["第 42 轮：上下文超预算，清理 3 条工具结果（150000 → 80000 tokens）"],  // P2-3
  "activePlan": {  // P2-2 任务模式：当前任务计划（跨会话续跑的锚点）
    "title": "新增 read_file 工具并补文档",
    "items": [
      { "text": "在 tools.ts 注册 read_file", "done": true, "detail": "已注册" },
      { "text": "补 README 文档", "done": false }
    ],
    "status": "active",
    "createdAt": "2026-08-06T..",
    "updatedAt": "2026-08-06T.."
  }
}
// AGENT_CHECKPOINT.json  // P2-4 --resume 会话级 checkpoint（消息历史，不含 system；任务完成即清除）
// {
//   "savedAt": "2026-08-06T..",
//   "messages": [ { "role": "user", "content": "任务：…" }, { "role": "assistant", "tool_calls": […] }, … ]
// }
```

> ✅ 格式已落地于 `src/memory.ts`（`AGENT_STATE.json` 实际含 `lastTask` / `lastSummary` / `lastRunAt` / `decisions` / `pitfalls` / `todo` / `contextWarnings` / `activePlan`；`AGENT_CHECKPOINT.json` 含 `savedAt` / `messages`）。

## 6. 成功指标

1. `bun run index.ts --self` 能安全修改自身代码、跑测试、通过或自动回滚。✅（P3 完成，2026-08：测试闸门收尾自动跑 bun test，失败自动回滚到会话开始前）
2. 一次会话完成"新增工具 + 文档 + 测试 + 收尾"全流程，无需人工干预。✅（M1 已达成）
3. 重启后能引用上次会话的决策（记忆持久化生效）。✅
4. 超过 100 轮工具调用的长任务不丢上下文、不爆预算、中断可续跑。✅（P2-3 budget.ts + tool result clearing + P2-4 --resume checkpoint，2026-08）
5. 跨会话能力不再只靠 lastSummary：修正过的操作能固化成带自测的 skill。✅（web-search v2 已落地）
6. 工具描述 ACI 化：工具 description 均带 example usage。✅（P2-1 已完成，2026-08）
7. `--self` 长任务可中断续跑：agent 首轮产出 plan，进度写回状态，重启后从上次断点继续。✅（P2-2 任务模式 + P2-4 --resume checkpoint 已完成，2026-08：activePlan 管任务级目标，checkpoint 管会话级上下文）

## 7. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 1M 也会被填满 + context rot（token 越多模型回忆越差） | `budget.ts` 摘要压缩 ✅ + **tool result clearing** ✅ + `--resume` checkpoint 分段续跑 ✅ |
| 自修改破坏源码 | git 快照 ✅ + 测试闸门 ✅ + 自动 revert ✅（P3-1/3-2 落地） |
| 全量塞文件反而稀释注意力 | 按需 `read_file` + 渐进披露，不全量灌入提示词（skills 索引同理：提示词只放一层索引） |
| 工具权限过大 | 沙箱 `cwd` 限制 + 资源上限 + 权限分级 + 审计日志 |
| 固化的知识会过时（HTML 结构变了） | skill 带版本号 + 自测命令（离线样本兜底 + `--online` 实测），纳入测试闸门 |
| 计划本身偏离理论（凭感觉迭代） | learn/ 作为理论地基随迭代修订，差距先回笔记 §4 校准 |

## 8. 里程碑

- ✅ **learn 理论地基**：5 篇权威一手材料（Anthropic 工程博客 ×3 + OpenAI 官方指南 + Claude Code best practices）→ 结构化笔记 `learn/README.md`，"差距即路线图"（2026-08 完成）。
- ✅ **M1**（P0+P1）：agent 认识自己、能改自己的文件 —— 自修改最小闭环成立（2026-08 完成）。
- ✅ **skills**：组合操作库落地，web-search v2 固化跨会话能力（2026-08 完成）。
- ✅ **AGENTS.md 项目指令**：项目级契约落地 —— 存在时加载进 [项目] 最前（优先级高于 README/docs），[规则] 第 5 条声明约束力；缺失时静默跳过（2026-08 完成）。
- ✅ **M2**（P2）：`--self` 自主迭代 + budget.ts / tool result clearing / checkpoint —— **P2-1 工具描述 ACI 化 ✅ + P2-2 任务模式 ✅ + P2-3 上下文预算 ✅ + P2-4 --resume checkpoint ✅ 全部完成**（2026-08）。
- ✅ **M3**（P3）：加固、回滚、测试闸门 —— git 安全阀补 run_bash + 测试闸门自动 revert + 沙箱权限分级 + 审计日志全部落地（2026-08 完成），形成可信的自修改循环，可长期自动演进。

---

> 原则：**每阶段都先出可运行的脚本验证，再固化进代码**。计划里的每一项改动都应能落到 `run_script` 里实际跑通。
