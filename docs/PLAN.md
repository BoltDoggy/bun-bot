# bun-bot 自我迭代计划：拥抱 1M 上下文

## 0. 为什么现在迭代

当前 bun-bot 是 201 行单文件 agent，其设计隐含了大量"省上下文"的旧约束。模型已支持 1M 上下文，这些约束要么是浪费，要么会反噬：

| 旧约束（为了省 token） | 1M 时代的问题 |
| --- | --- |
| system prompt 极简，不认自己 | 没有项目意识，说不出自己是什么、有哪些能力 |
| 工具输出截 4000 字符 | 完整的文件、日志、diff 传不回来，推理被截断的信息误导 |
| 无记忆，每次运行从零开始 | 长任务反复从头解释，无法积累决策 |
| 只能写 tmpdir，改不了工作区 | 读得到结果却落不了地，永远"分析"而不"动手" |
| 150 轮上限、30s 固定超时 | 长任务没有节奏感，写死导致要么跑飞要么不够用 |

**一句话：让 bun-bot 从"会算数的脚本执行器"迭代成"能读懂自己、修改自己、记住自己"的长期 agent。**

## 1. 1M 上下文解锁的能力

- **整库进上下文**：README + docs + 源码结构 + 记忆，全量塞进系统提示词，预算占比 <5%。
- **完整工具反馈**：不再 4K 截断，文件内容 / 测试输出 / diff 完整回传（默认上限 64KB，可配置）。
- **长视野任务**：一次会话完成"新增一个工具 + 写文档 + 跑测试 + 收尾"的完整闭环。
- **跨会话记忆**：状态文件持久化，重启后带着上次的决策继续。

## 2. 目标架构

```text
index.ts              入口：CLI 解析 + agent 主循环（保持轻量）
src/tools.ts          工具定义与执行器（注册表模式，方便自增工具）
src/context.ts        系统提示词组装：身份 + 项目 + 记忆 + 规则
src/memory.ts         记忆读写：AGENT_STATE.json / MEMORY.md
src/budget.ts         上下文 token 预算与超限摘要  ← P2 待建
src/git.ts            自修改前的安全提交与回滚
tests/                self-test 用例（agent 修改自身代码后的验证闸门）
```

> 当前已落地：index.ts / tools.ts / context.ts / memory.ts / git.ts / tests/（见 [ARCHITECTURE.md](./ARCHITECTURE.md) 快照）。

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

**验收**：✅ `bun run index.ts "把 index.ts 顶部的注释改成两行"` 真实落盘 + diff 可见 + `bun test` 12 用例全绿。

### P2 · 长任务与自迭代循环 ⏳（M2 进行中）

**目标**：一次会话能自主完成多步骤的自我迭代。

- [ ] 任务模式：agent 首轮产出 plan，逐项勾选，进度写回 `AGENT_STATE.json`
- [ ] `--self` 模式：读自己 → 分析痛点 → 提案（不改代码，只输出 diff 预览）→ 确认后应用 → 跑测试 → 总结
- [ ] 上下文预算：`budget.ts` 做 token 计数，接近上限时把早期消息压缩成摘要（1M 也非无限）
- [ ] 长任务 checkpoint：`--resume` 从上次断点续跑

**验收**：`bun run index.ts --self "给我加一个 read_file 工具并补文档"` 全流程无人干预完成。

### P3 · 质量与防护 ⏳（M3 进行中）

**目标**：让自修改可信、可回滚、不跑飞。

- [ ] git 安全阀：任何 `write_file` / `run_bash` 触及工作区前，`git add -A && git commit` 打快照（注：`write_file` 已自动打快照，`run_bash` 尚未）
- [ ] 测试闸门：每次自修改后强制跑 `tests/`，失败自动 `git revert`
- [ ] 沙箱：脚本默认限制 `cwd`，可选资源上限（内存/进程数）
- [ ] 审计日志：每次工具调用的入参/出参摘要落盘

**验收**：故意让 `--self` 写一个坏补丁，能自动回滚且项目可继续跑。

## 4. 系统提示词结构（预算 <5%）

```text
[身份]  我是 bun-bot，一个自我认知为 Bun.js 运行时的 agent
[能力]  工具契约：run_script / read_file / write_file / list_dir / run_bash
[项目]  文件树 + 架构图 + 关键文件位置 + 当前 MODE
[记忆]  上次任务的决策、踩坑、TODO（来自 AGENT_STATE.json）
[规则]  改工作区前必须 git 快照；改完必须跑 tests/；工具输出默认完整读取
```

> ✅ 已按此结构落地于 `src/context.ts`。

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
  "contextWarnings": ["超过 80 万 token 时系统提示词摘要会被压缩"]
}
```

> ✅ 格式已落地于 `src/memory.ts`（`AGENT_STATE.json` 实际含 `lastTask` / `lastSummary` / `lastRunAt` / `decisions` / `pitfalls` / `todo`）。

## 6. 成功指标

1. `bun run index.ts --self` 能安全修改自身代码、跑测试、通过或自动回滚。⏳（P3 完成）
2. 一次会话完成"新增工具 + 文档 + 测试 + 收尾"全流程，无需人工干预。✅（M1 已达成：工具集 + 文档 + 测试 + README 一次闭环）
3. 重启后能引用上次会话的决策（记忆持久化生效）。✅
4. 超过 100 轮工具调用的长任务不丢上下文、不爆预算。⏳（P2 的 budget.ts / checkpoint）

## 7. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 1M 也会被长会话填满 | `budget.ts` 摘要压缩，`--resume` 分段续跑 |
| 自修改破坏源码 | git 快照 + 测试闸门 + 自动 revert |
| 全量塞文件反而稀释注意力 | 按需 `read_file`，不全量灌入提示词 |
| 工具权限过大 | 沙箱 `cwd` 限制 + 资源上限 + 审计日志 |

## 8. 里程碑

- ✅ **M1**（P0+P1）：agent 认识自己、能改自己的文件 —— 自修改最小闭环成立（2026-08 完成）。
- ⏳ **M2**（P2）：`--self` 能自主完成多步自我迭代任务，带 checkpoint 与续跑。
- ⏳ **M3**（P3）：加固、回滚、测试，形成可信的自修改循环，可长期自动演进。

---

> 原则：**每阶段都先出可运行的脚本验证，再固化进代码**。计划里的每一项改动都应能落到 `run_script` 里实际跑通。
