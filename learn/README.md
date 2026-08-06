# 学习笔记：提示词工程 × 上下文工程 × Harness 工程

> 基于 5 篇权威一手材料（Anthropic 工程博客 ×3 + OpenAI 官方指南 + Claude Code 最佳实践），原文存 `learn/raw/`。
> 学习时间：2026-08。目的：把 bun-bot 从"会算数的脚本执行器"升级为长期 agent 的理论地基。

## 0. 三者关系（先建立坐标系）

| 工程 | 回答的问题 | 一句话 |
| --- | --- | --- |
| **提示词工程** | 指令怎么写？ | 写什么 —— 让模型**理解期望**（system prompt 的写法、few-shot、分隔符） |
| **上下文工程** | 每次推理喂什么？ | 给什么 —— 在有限注意力预算里**策展最优 token 集**（提示词的自然演进，含 tools/历史/外部数据） |
| **Harness 工程** | agent 怎么跑？ | 怎么跑 —— 运行时循环、工具契约（ACI）、安全阀、持久化（Claude Code 是标杆） |

演进脉络：单次推理时代靠 prompt 优化 → 多轮 agent 时代要管理整个 context state（system + tools + MCP + 外部数据 + message history），且**每次推理前都要重新策展**——这就是上下文工程。harness 是让这一切转起来的骨架。

---

## 1. 提示词工程（Prompt Engineering）

### 1.1 OpenAI 六大策略（官方指南，长期有效）

1. **Write clear instructions（写清楚指令）**
   - 身份/角色定位；用分隔符（XML tags / Markdown headers）划分逻辑边界
   - 指定细节（要求、长度、格式）；给示例（few-shot）
2. **Provide reference text（给参考文本）** —— 减少幻觉，让模型基于给定材料回答
3. **Split complex tasks into simpler subtasks（拆分复杂任务）** —— 意图路由、对话摘要等
4. **Give the model time to "think"（给思考时间）** —— chain-of-thought，先推理再作答
5. **Use external tools（用外部工具）** —— 计算/检索等模型弱项交给确定性工具
6. **Test changes systematically（系统化测试）** —— evals / golden set，改 prompt 如改代码

### 1.2 OpenAI 的工程化提醒

- **prompt 是代码**：存进应用代码（typed inputs、code review、测试、部署流程），而不是可复用 prompt 对象（官方已弃用）
- **消息角色有权威层级**：`developer`（系统规则，优先级最高）> `user`（终端输入）> `assistant`（模型生成）
- **pin 模型快照**：生产环境钉死具体版本（如 `gpt-4.1-2025-04-14`），换模型要跑 eval 验证行为漂移

### 1.3 Anthropic 系统提示词原则

- **right altitude（正确海拔）**：系统提示词处于两个失败模式之间的"金发区"——
  - 一端：把脆弱 if-else 业务逻辑硬编码进 prompt（脆、难维护）
  - 另一端：过于宽泛的高层指导（没有具体信号，或错误假设共享上下文）
  - 目标：**足够具体以引导行为，又足够灵活以提供强启发式**
- **分节组织**：`<background_information>` `<instructions>` `## Tool guidance` `## Output description` 等，XML/Markdown 分隔
- **最小充分（minimal, not necessarily short）**：先拿最小 prompt + 最好模型测任务，再按**失败模式**增量补指令和示例

### 1.4 few-shot 的正确姿势

- 精选**多样、规范的示例**（canonical examples）来传达期望行为
- ❌ 不要往 prompt 里塞一长串 edge case 规则清单
- "For an LLM, examples are the pictures worth a thousand words."

---

## 2. 上下文工程（Context Engineering）

### 2.1 核心思想

> **Context** = 采样时送入模型的全部 token。**Context engineering** = 策展并维护这组 token 的最优解。
> 指导原则一句话：**找到能最大化期望结果概率的、最小的高信号 token 集。**

### 2.2 为什么必须做：context rot（上下文腐烂）

- 研究表明：**token 越多，模型从上下文中精确回忆信息的能力越差**（needle-in-a-haystack 基准）——所有模型都如此，只是衰减斜率不同
- 根因：transformer 的 n² 注意力 + 训练分布偏短序列 → 注意力预算（attention budget）有限，每个新 token 都在消耗它
- 结论：**上下文是有限资源，边际收益递减**；性能是渐变不是悬崖

### 2.3 有效上下文的解剖（每个组件都要"tight"）

| 组件 | 要点 |
| --- | --- |
| **system prompt** | right altitude + 分节 + 最小充分 |
| **tools** | token 效率（返回高信号信息）、功能最小重叠、自包含、健壮、参数无歧义 |
| **examples** | 精选规范示例，不堆 edge case |
| **message history** | 需要主动管理（见 2.5） |

### 2.4 JIT 检索 + 渐进披露（agentic search）

- **不要预载全部数据**：维护轻量标识（文件路径、存储查询、web 链接），用工具在运行时动态拉数据
- 元数据本身就是信号：目录结构、命名约定、时间戳都能帮 agent 判断信息用途与时效
- **渐进披露（progressive disclosure）**：文件大小→复杂度、命名→用途、时间戳→相关性，一层层探索组装理解，只保留工作记忆所需
- 代价：运行时探索比预计算慢；需要精心设计工具与启发式，否则 agent 浪费上下文走死路
- **混合策略（Claude Code 模式）**：`CLAUDE.md` 直接预载进上下文 + glob/grep 等原语 JIT 取文件；对动态性低的内容（法律/金融）更合适

### 2.5 长任务三件套（超出上下文窗口时的对策）

1. **Compaction（压缩）**：接近窗口上限 → 用模型把历史摘要成高保真摘要 → 重开窗口继续
   - 从最轻的一档做起：**tool result clearing**（工具结果用过即清，最安全）
   - 调优：先最大化 recall（别丢微妙关键上下文），再迭代提升 precision（砍冗余）
2. **结构化笔记（agentic memory）**：定期把笔记写到上下文之外（NOTES.md / todo list），需要时再拉回
   - 例：Claude 玩 Pokémon 数千步不丢目标——靠地图、成就、战斗策略笔记跨上下文重置续跑
3. **子 agent 架构**：专业子 agent 用干净窗口做深度探索（可用几万 token），**只返回 1-2k token 的浓缩摘要**；主 agent 保持窗口干净、专注综合
   - 适用：复杂研究与并行探索；多 agent 研究系统比单 agent 显著提升

**选择矩阵**：compaction 适合需要大量往返的对话流；笔记适合有清晰里程碑的迭代开发；多 agent 适合并行探索的研究任务。

---

## 3. Harness 工程（Agent Harness）

### 3.1 agent 的定义（Anthropic 收敛后的简单版）

> **Agents = LLMs autonomously using tools in a loop**（LLM 在循环中自主使用工具）。

### 3.2 构建三原则（Building Effective Agents）

1. **Simplicity（简单）**：先做最简单方案，复杂度只在能证明改进时加
2. **Transparency（透明）**：显式展示 agent 的规划步骤
3. **ACI（Agent-Computer Interface）**：像做 HCI 一样精心打磨工具文档与测试

### 3.3 workflows vs agents（模式谱系）

| 模式 | 本质 | 适用 |
| --- | --- | --- |
| prompt chaining | 任务分解为固定步骤链 + 程序化 gate | 可干净拆分的固定子任务 |
| routing | 分类后路由到专用 prompt/工具 | 不同类别需不同处理 |
| parallelization | sectioning（并行子任务）/ voting（多样输出） | 独立子任务 / 多视角高置信 |
| orchestrator-workers | 中央 LLM 动态分解 → 委派 → 综合 | 子任务不可预测（改多文件） |
| evaluator-optimizer | 生成 + 评估循环 | 有清晰评估标准、迭代有效 |
| **agents** | 模型动态主导全过程 | 开放问题、步数不可预测、环境可信任 |

### 3.4 ACI 与工具设计（Writing Tools for Agents 五原则）

1. **选对工具**：不是包装 API 就行，要考虑 agent 的 affordances；**工具集臃肿是头号失败模式**——人说不清该用哪个，agent 也说不清
2. **Namespacing（命名空间化）**：定义清晰功能边界，避免重叠导致选择歧义
3. **返回有意义上下文**：contextual relevance over flexibility；剔除 uuid、像素级 URL 等低层标识
4. **优化 token 效率**：控制返回给 agent 的信息量
5. **Prompt-engineering 工具描述**：描述/spec 会进上下文，能直接引导工具调用行为

**工具格式建议**：给足"思考"token；格式贴近模型在互联网文本中见过的自然形态；避免格式开销（数行数、转义）

**防错（poka-yoke）**：改参数让错误更难发生。例：SWE-bench 中相对路径导致模型犯错 → 强制绝对路径 → 零错误。

### 3.5 Claude Code 的 harness 实践清单（标杆）

| 机制 | 作用 |
| --- | --- |
| `CLAUDE.md` | 会话启动预载的项目记忆（Bash 命令、代码风格、工作流规则）——上下文工程里的"hybrid 预载" |
| **permissions** | 权限分级，不每步都问（全自动区 + 需确认区） |
| **hooks** | 确定性脚本，在 workflow 固定点强制执行（与 advisory 的指令不同，保证发生） |
| **skills** | 项目/领域知识按需加载（bun-bot 已有雏形） |
| **subagents** | 独立上下文 + 独立工具集，用于大量读文件的调研，不污染主窗口 |
| **checkpoints / rewind** | 每次改动前自动快照，可回滚代码/对话 |
| **resume / --continue** | 本地保存会话，跨坐续跑 |
| **auto-compaction** | 接近上下文限制时自动压缩历史 |
| **plan mode** | 先探索后计划再编码，分离探索与执行 |
| **verify its work** | 给 agent 一个能跑出 pass/fail 的验证信号（测试） |
| **-p 非交互 / 并行会话 / fan-out** | 水平扩展 |

### 3.6 harness 的安全底线

- 沙箱环境大量测试 + guardrails（护栏）
- **stopping conditions**（最大迭代数）控制跑飞
- 人类 checkpoint 介入（任务中途可暂停要反馈）
- 工具结果作为"ground truth"让 agent 每步校准

---

## 4. 对照 bun-bot 现状（差距即路线图）

| 主题 | 已做 ✅ | 差距 ⏳ | 建议 |
| --- | --- | --- | --- |
| **提示词工程** | 五区块系统提示词（身份/能力/项目/记忆/规则），Markdown 分节；规则区具体可执行 | 无 few-shot（工具描述无 example usage）；无任务级 evals（只有 self-test） | 工具描述加"示例用法"；沉淀任务级 golden set |
| **上下文工程** | JIT 检索（read_file/list_dir 按需加载 = 渐进披露）；记忆 AGENT_STATE/MEMORY.md（= 结构化笔记雏形）；skills 索引只放一层不稀释；工具输出 64KB 完整回传 | `budget.ts` 未建（无 token 预算跟踪）；无 compaction / tool result clearing；无子 agent | 建 budget.ts；长任务对早期 tool result 做摘要清理；notes 扩展成真正 agentic memory |
| **harness 工程** | 工具注册表 + 自描述契约；主循环（LLM→工具→回填）+ 150 轮停止条件；write_file 自动 git 快照 + diff 摘要（= checkpoint 雏形）；run_script 沙箱 cwd | run_bash 无快照；无 --resume 续跑；无权限分级；无测试闸门自动 revert；无 hooks；无 plan mode（--self 未实现） | 按 P2/P3：--self + checkpoint + --resume、测试闸门、审计日志 |

**三条最值得立刻做的**（对齐 Anthropic 三篇的共识）：
1. **工具描述 ACI 化**（prompt-engineering 工具描述 + example usage）——成本最低、收益最直接
2. **budget.ts + tool result clearing**（上下文工程的第一杠杆：从最轻的压缩做起）
3. **--resume / checkpoint**（harness 的持久化与续跑，P2 主线）

---

## 5. 参考源（learn/raw/ 原文）

| 文件 | 主题 |
| --- | --- |
| `anthropic-effective-context-engineering.md` | 上下文工程权威文（本文 §2 主干） |
| `anthropic-building-effective-agents.md` | workflows/agents 模式谱系 + ACI + 工具提示词化 |
| `anthropic-writing-tools-for-agents.md` | 工具设计五原则 + 原型/评估/协作流程 |
| `openai-prompt-engineering-guide.md` | OpenAI 官方提示词工程指南（六策略 + prompt 即代码） |
| `anthropic-claude-code-best-practices.md` | Claude Code harness 实践（CLAUDE.md/hooks/skills/checkpoint…） |
