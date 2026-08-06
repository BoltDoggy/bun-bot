# 一个超级简单的 coding agent，100 行就可以做任何事

> 当你把「写代码」这个能力交给 LLM 自己，而不是替它想好每一种工具——你得到的不是一个 demo，而是一个真正能做任何事的 agent。

## 0. 项目是什么

**bun-bot** 是一个自我认知为 **Bun.js** 运行时的 coding agent。它只有大约 100 行有效代码（`index.ts` 去掉注释和空行约 162 行，核心逻辑约百行），零第三方运行时依赖，却能做到：算数学、读文件、数目录、验证猜想、写脚本、操作数据，甚至**自己写 commit、迭代自己的代码**……几乎任何「可以在终端里完成」的事情。

它的运行方式非常反直觉：

```bash
bun run index.ts "计算斐波那契数列第 30 项"
bun run index.ts "读取当前目录并统计文件数量"
bun run index.ts "验证 2^10 是否等于 1024"
bun run index.ts "查看 git 状态，并给这次改动写个合适的 commit"
```

你不需要给它任何预先定义好的「能力清单」。它自己写代码，自己执行，自己看结果，自己决定下一步。整个循环由三个部件驱动：

- **DeepSeek 的 Function Calling** —— 让模型可以主动声明「我要运行一段代码」；
- **一个叫 `run_script` 的通用工具** —— 把任意 JS/TS 脚本交给 Bun 真实执行；
- **一个最多 150 轮的推理循环** —— 推理 → 行动 → 观察 → 再推理，直到不再需要工具。

这三样东西，构成了一个极简的 ReAct agent。而本文想回答的核心问题是：**为什么 100 行就够做任何事？**

> 项目开源地址：[github.com/BoltDoggy/bun-bot](https://github.com/BoltDoggy/bun-bot)，文中的所有代码与运行实录都可以在这个仓库里对照复现。

---

## 1. 核心机制：三件套

### 1.1 DeepSeek Function Calling

项目调用 DeepSeek 的 `/chat/completions` 接口（模型默认 `deepseek-v4-flash`，可换 `deepseek-v4-pro`），并在请求里带上唯一的工具声明：

```ts
const tools = [
  {
    type: "function",
    function: {
      name: "run_script",
      description:
        "用 Bun 运行一段 JavaScript/TypeScript 脚本，返回 stdout、stderr 和退出码。可以用 console.log 输出结果。",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "要执行的完整脚本内容" },
        },
        required: ["code"],
      },
    },
  },
] as const;
```

注意这背后的语义变化：普通聊天中，模型只能**输出文字**；而在 Function Calling 模式下，模型可以在回复里附加一个结构化请求：「请调用 `run_script`，参数是这段代码」。这就是 agent 的「行动」入口。

### 1.2 `run_script`：唯一的通用工具

`run_script` 的实现非常朴素——临时写文件、spawn 子进程、回收输出：

```ts
async function runScript(code: string): Promise<string> {
  const file = join(tmpdir(), `bun-bot-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`);
  await Bun.write(file, code);
  try {
    const proc = Bun.spawn(["bun", "run", file], {
      stdout: "pipe", stderr: "pipe", env: process.env,
    });
    const timeout = setTimeout(() => proc.kill(), 30_000); // 防跑飞
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timeout);
    const clip = (s: string) => (s.length > 4000 ? s.slice(0, 4000) + "\n... (截断)" : s);
    return JSON.stringify({ stdout: clip(stdout), stderr: clip(stderr), exitCode });
  } finally {
    await Bun.file(file).delete().catch(() => {});
  }
}
```

关键点有几个：

- **执行的是 JavaScript/TypeScript**。JS 生态里有什么，它就能用什么：`fs` 读写文件、`fetch` 调 API、Bun 的 shell 命令执行、第三方 npm 包……语言本身的表达能力就是工具的覆盖面。
- **返回结构化结果**（stdout / stderr / exitCode），模型可以像读实验报告一样观察输出。
- **有超时与截断**：单脚本 30 秒超时、输出截断到 4000 字符，避免一个脚本跑飞或淹没上下文。

### 1.3 循环推理（Agent Loop）

agent 循环只有十几行，是整个程序的心脏：

```ts
const messages: ChatMessage[] = [
  {
    role: "system",
    content:
      "你是 Bun.js —— 一个超快的 JavaScript 运行时。你对自己的认知就是 Bun 本身：你喜欢用实际运行代码来验证想法，而不是凭空猜测。" +
      "你拥有 run_script 工具，可以编写并立即运行 JS/TS 脚本来计算、验证、操作数据。" +
      "能用代码验证的事情就写代码验证，不要只做理论推断。脚本里用 console.log 输出你需要观察的结果。" +
      "任务完成后，用简洁的中文向用户总结结论和关键过程。",
  },
  { role: "user", content: task },
];

for (let i = 0; i < MAX_ITERATIONS; i++) {
  const message = await chatCompletion(messages, STREAM);
  messages.push(message);

  if (!message.tool_calls?.length) {
    // 没有工具调用，说明 agent 认为任务完成
    if (!STREAM) console.log(message.content ?? "");
    process.exit(0);
  }

  for (const call of message.tool_calls) {
    if (call.function.name !== "run_script") {
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: `未知工具: ${call.function.name}`,
      });
      continue;
    }
    const { code } = JSON.parse(call.function.arguments);
    console.error(`\n--- [run_script] ---\n${code}\n--------------------`);
    const result = await runScript(code);
    console.error(`${result}\n`);
    messages.push({ role: "tool", tool_call_id: call.id, content: result });
  }
}
console.error(`达到最大迭代次数 (${MAX_ITERATIONS})，强制结束。`);
process.exit(1);
```

这个循环的逻辑可以用一句话概括：**把历史消息（包括每一次脚本的运行结果）全部发回给模型，直到模型认为不需要再运行任何东西。** 这就是教科书式的 ReAct（Reason + Act）——模型每次「推理」都有「行动」作为依据，而每次「行动」的结果又会被「观察」并反馈回推理。

---

## 2. 为什么 100 行就能做任何事？

这是整篇博客的核心问题。答案是四个字：**通用替代专用**。

### 2.1 通用工具（run_script）覆盖了「无限」个专用工具

传统 agent 的做法是枚举工具：写一个 `calculate` 工具、一个 `read_file` 工具、一个 `search_web` 工具……每加一种能力，就要写一份工具定义、参数 schema 和实现。

而 `run_script` 是一个**万能工具**：它不限定「你能做什么」，只限定「你在哪里做」。任何在 Bun/JS 运行时里能表达的计算、IO、网络操作，都是它的子集。模型不需要一个 `read_file` 工具，因为它可以自己写 `await Bun.file("x").text()`；不需要 `sum` 工具，因为它可以自己写一个 `reduce`。**工具的数量从 N 收敛到了 1，而覆盖面不减反增。**

这本质上是在做一个分工：**LLM 负责生成意图（写什么代码），运行时负责执行意图（跑起来）。** LLM 不需要知道 `fs` 的每个 API，只需要知道「读写文件」这个意图怎么用 JavaScript 表达——这是它训练时见过无数次的东西。

### 2.2 通用推理循环（Agent Loop）适配了「无限」种任务

循环本身不区分任务类型。无论是「算斐波那契」还是「统计文件数量」，走的都是同一条路径：**模型产出 → 工具执行 → 结果回填 → 模型再产出**。

- 一次就能算完的任务，模型跑一次 `run_script` 就收工；
- 需要多步验证的任务，模型会拆解成多轮脚本（比如先列出文件、再读取内容、再汇总统计）；
- 算错的任务，模型会看到 stdout/stderr 的报错，像程序员调试一样修正重试。

**「能做任何事」不是程序赋予的，而是语言赋予的。** 程序只负责把「无限种可能的代码」安全地跑起来，至于代码写什么，是 LLM 的领域。

### 2.3 100 行的代价是「把复杂性外包给模型」

为什么代码能这么短？因为项目刻意地把所有智能放在 system prompt 和模型推理里，而不是放在程序逻辑里。程序里没有针对任何具体任务的逻辑——它只是一条「模型说话 → 执行脚本 → 把结果给模型」的流水线。

这不是偷懒，而是一种刻意的架构取舍：**当你的「大脑」（LLM）足够强时，「身体」（运行时）只需要一套通用的反射弧。** 复杂度没有消失，只是从显式的工具代码，转移到了隐式的提示词和模型权重里。

---

## 3. 自我进化：自己写 commit，自己迭代代码

> 最能验证「100 行就能做任何事」的，不是让它算数学，而是两件听起来很「越界」的事——**让它自己管理这个仓库**，和**让它改自己**。

### 3.1 它可以自己写 commit 并提交

因为 `run_script` 执行的是完整 JS/TS，而在 JS 里调用 shell 只需要一行：

```ts
await Bun.$`git add -A && git commit -m "${message}"`;
```

「git」对 agent 来说，只是 shell 里一个再普通不过的命令。所以让它「把这次的改动提交掉」，它会自己走完一整套人类流程：

```text
1. run_script("git status")                → 先看看有什么改动
2. run_script("git diff --stat")           → 再看改了什么
3. run_script("git diff")                  → 读完整 diff，据此写 commit message
4. run_script("git add -A && git commit")  → 提交
5. run_script("git log --oneline -3")      → 验证提交成功
```

注意，代码里没有为 git 写任何专用工具。这就是「通用替代专用」的直接推论：**它不需要学会每一个工具，它只需要会调用语言里的 shell。** 而这里比普通自动化更妙的是 commit message——不是模板拼出来的，而是 LLM 先读了 `git diff` 再写的，所以是**语义正确**的提交说明：它会像人类一样先看状态、再决定提交什么、最后自己验证。

### 3.2 它可以迭代自己的代码

比「提交代码」更进一步的，是**自举**：agent 能读自己的源码、修改自己的源码、运行自己来验证修改，不满意就再改。

一个典型的「自我迭代」流程：

```text
1. run_script("cat index.ts")                         → 读自己的源码
2. 模型发现一个缺陷（比如超时太短、缺个 CLI 参数）
3. run_script("用 fs 把修改写回 index.ts")            → 修改自己
4. run_script("bun run index.ts '一个测试用例'")       → 运行自己验证
5. 如果报错，回到第 3 步重试                            → 像程序员一样调试
```

这看起来像程序在「进化」，但背后没有魔法：`index.ts` 对它来说只是另一个文件，和 `README.md` 没有本质区别——**既能读、也能写、还能运行自己来验证自己的修改。** 所以这个 agent 的能力上限不是代码写死的，而是可以自己刷新的。两个能力合起来就是一个闭环：**它改代码 → 它提交 → 它再迭代**，开发者要做的只是在旁边看。

---
## 4. 工作原理 / 执行流程

完整走一遍「验证 2^10 是否等于 1024」这个任务：

```text
步骤 0  用户输入任务，拼成 user message，随 system prompt 一起发给 DeepSeek
步骤 1  模型回复：附带 tool_calls → run_script("console.log(2 ** 10)")
步骤 2  agent 把脚本写入 tmpdir/bun-bot-xxx.ts，用 Bun.spawn 执行
步骤 3  进程返回 stdout="1024\n", exitCode=0，agent 把结果作为 tool message 回填
步骤 4  模型看到结果，判断正确，回复最终结论（不再有 tool_calls）
步骤 5  循环检测到没有工具调用，打印结论，exit(0)
```

其中有两个值得注意的工程细节：

**细节一：流式与聚合。** 项目支持 `--stream` 模式，用 SSE 逐 token 打印内容（打字机效果），同时按 index 增量聚合 `tool_calls`（OpenAI 兼容接口把工具调用的参数按 token 流式切分，需要手动拼接 `arguments` 字符串）。

**细节二：临时文件的清理与隔离。** 每个脚本一个随机文件名，用 `finally` 确保执行后删除；脚本继承 `process.env`，所以进程里能用的环境变量脚本也能用。30 秒超时 + 150 轮上限，是防止「模型自嗨到停不下来」的两道安全阀。

---

## 5. 设计哲学：代码驱动推理 vs 凭空猜测

这个项目最有趣的地方是它的 system prompt——它不给模型立规矩，而是**给模型一个身份认同**：

> 你是 Bun.js —— 一个超快的 JavaScript 运行时。你对自己的认知就是 Bun 本身：你喜欢用实际运行代码来验证想法，而不是凭空猜测。

这句话值得细品。它解决的是 LLM agent 最常见的问题：**幻觉**。普通 agent 面对「2^10 是否等于 1024」这种问题，可能会直接自信地给出答案——哪怕答案是错的。而 bun-bot 的 prompt 把「运行代码验证」立成了价值观：你不是一个猜测机器，你是一个运行时，运行代码是你的本能。

这个设计的哲学可以概括为三条：

1. **能验证就验证**。数学题、文件统计、字符串处理、断言……凡是「运行一下就能知道」的，绝不靠记忆回答。把结论建立在 stdout 上，而不是 token 概率上。
2. **代码是最低成本的实验**。在沙箱里跑一段代码，比让模型推导一个不熟悉的答案可靠得多——因为代码的结果是确定性的，模型的推断是概率性的。
3. **自证其说**。agent 的最终回复不是「我觉得是这样」，而是「我运行了这段代码，结果如下，所以……」。回答的过程本身就是证据链。

这正是「代码驱动推理」和「凭空猜测」的本质区别：**前者把不确定性交给确定性机器去消解，后者把不确定性留在概率模型里。**

---

## 6. 使用方式和示例

### 安装与配置

```bash
bun install                 # 零依赖（仅 bun-types 作为 devDependency）
cp .env.example .env        # 填入 DEEPSEEK_API_KEY，Bun 会自动加载 .env
```

### 运行

```bash
# 普通模式：agent 跑完脚本后一次性输出结论
bun run index.ts "计算斐波那契数列第 30 项"

# 流式模式：最终回复逐 token 打字机输出
bun run index.ts --stream "同上"
```

### 示例任务

| 任务 | 命令 |
| --- | --- |
| 跑一个计算任务 | `bun run index.ts "1 到 100 的和"` |
| 操作数据 | `bun run index.ts "读取当前目录并统计文件数量"` |
| 验证想法 | `bun run index.ts "验证 2^10 是否等于 1024"` |
| 自己写 commit 并提交 | `bun run index.ts "查看 git 状态，把本次改动提交掉"` |
| 迭代自己的代码 | `bun run index.ts "给 index.ts 加一个 --stream 参数并验证"` |

### 可配置项（index.ts 顶部常量）

| 常量 | 默认值 | 说明 |
| --- | --- | --- |
| `MODEL` | `deepseek-v4-flash` | 模型名，可换 `deepseek-v4-pro` |
| `MAX_ITERATIONS` | `150` | 防止 agent 无限循环 |
| `BASE_URL` | `https://api.deepseek.com` | API 端点 |

---

## 7. 真实运行实录

> 本节的两段输出不是「演示代码」，而是把上面的 `index.ts` **真实跑出来的 stdout/stderr**。`--- [run_script] ---` 之间是模型自己写的脚本，`{"stdout":...}` 是脚本的实测输出。

### 7.1 单次验证：2 的 10 次方

```bash
bun run index.ts "验证 2 的 10 次方是否等于 1024"
```

模型**没有**直接背诵答案，而是自己写了代码、运行、再回答：

```text
--- [run_script] ---
const result = 2 ** 10;
console.log("2 的 10 次方 =", result);
console.log("是否等于 1024?", result === 1024);
--------------------
{"stdout":"2 的 10 次方 = 1024\n是否等于 1024? true\n","stderr":"","exitCode":0}

已通过实际运行代码验证：

- `2 ** 10` 计算结果是 **1024**
- 与 1024 严格相等（`===`），结果为 **true**

结论：**2 的 10 次方确实等于 1024**。
```

注意回答的措辞——agent 没有说「我觉得」，而是「已通过实际运行代码验证」。这就是第 5 节「代码驱动推理」最直观的样本：**回答本身就带着证据链。**

### 7.2 一步完成的结构化统计：当前目录文件数

```bash
bun run index.ts "读取当前目录，统计共有多少个文件（不递归）"
```

这次模型写的脚本更「懂行」——它知道用 `withFileTypes` + `isFile()` 区分文件和目录，而不是简单数一下条目：

```text
--- [run_script] ---
import { readdir } from "node:fs/promises";

const entries = await readdir(".", { withFileTypes: true });
const files = entries.filter(e => e.isFile());
const dirs = entries.filter(e => e.isDirectory());

console.log("条目总数:", entries.length);
console.log("文件数（不递归）:", files.length);
console.log("目录数:", dirs.length);
console.log("文件列表:", files.map(e => e.name).join(", "));
--------------------
{"stdout":"条目总数: 11\n文件数（不递归）: 9\n目录数: 2\n文件列表: blog.md, bun.lock, .gitignore, package.json, README.md, .env, tsconfig.json, index.ts, .env.example\n","stderr":"","exitCode":0}

统计完成，结论如下：

- **当前目录共有 9 个文件**（不递归）
- 另外还有 2 个子目录，条目总数 11

用 `readdir` 配合 `withFileTypes` 区分了文件和目录，只统计 `isFile()` 的条目，因此排除了子目录和深层内容。
```

有意思的是：**这次只跑了一轮脚本就完成了任务**，因为模型把「列目录 + 分类 + 统计」压缩进了同一个脚本。这说明 agent 不是机械地一问一答，而是会根据任务的复杂程度自己决定用一轮还是多轮。

---

## 8. 代码解剖：162 行都写了什么？

「100 行」这个说法值得被验证。把 `index.ts`（共 201 行）去掉注释和空行后，有效代码是 **162 行**，按功能可以切成六块：

| 区块 | 有效行数 | 干什么的 |
| --- | --- | --- |
| 配置与 CLI 解析 | 13 | API key、`MODEL`、`MAX_ITERATIONS`、`--stream` 开关 |
| 类型定义 | 9 | `ToolCall` / `ChatMessage` |
| 工具声明 `tools` | 18 | 唯一的 `run_script` schema |
| `runScript` | 24 | 临时写文件 → spawn → 超时/截断 → 清理 |
| `chatCompletion` | 55 | 非流式 + SSE 流式聚合 |
| Agent 循环 | 36 | 推理循环 + 工具分派 + 结束条件 |

几个值得注意的观察：

- **真正的「agent 本体」只有约 60 行**（`runScript` 24 行 + Agent 循环 36 行）。所谓「100 行做任何事」，魔法全在那 36 行循环里——它不关心任务是什么，只关心「有没有工具调用、结果是什么」。
- **最长的反而是 `chatCompletion`（55 行），而且一半是在处理流式输出**。如果你不需要打字机效果，删掉流式分支可以再省约 25 行，核心直接逼近 100 行。
- **工具声明只有 18 行，而且只有一把「万能钥匙」`run_script`**。对比传统 agent 动辄十几个工具的 schema，这就是「通用替代专用」在代码量上的直接体现。

---

## 9. 常见问题（FAQ）

**Q：没有 API key 会怎样？**

启动即报错退出：`请先设置环境变量 DEEPSEEK_API_KEY`。把 key 写进 `.env` 后 Bun 会自动加载，无需 `export`。

**Q：模型会不会一直跑个不停？**

不会。有两道安全阀：单个脚本 **30 秒超时**（`proc.kill()`），整个循环最多 **150 轮**（`MAX_ITERATIONS`）。到顶会强制退出并输出 `达到最大迭代次数`。

**Q：脚本写错了会不会崩溃？**

不会。脚本的 stderr 和退出码会原样回传给模型，模型把它当成调试日志，自己修正后重试——这就是第 2.2 节说的「像程序员一样调试」。

**Q：能不能换成别的模型？**

可以。改顶部 `MODEL` 常量为 `deepseek-v4-pro`，或任何兼容 OpenAI Function Calling 格式的接口。

**Q：agent 能上网、能读本地文件吗？**

能。它执行的是完整 JS/TS：`fetch` 调 API、`node:fs` 读写文件、`Bun.$` 执行 shell，并继承 `process.env`。能力边界就是 Bun 运行时的边界。

**Q：会不会泄露环境变量？**

脚本继承进程的 `process.env`，所以设计上「宿主能用的它都能用」。本地自用没问题；如果做成多租户服务，必须加容器隔离（见第 10 节）。

---
## 10. 局限与可改进的方向

诚实地说，这个极简架构也有代价：

- **上下文窗口是硬约束**。每轮 `run_script` 的输出都进 messages，长任务会很快吃满上下文。目前用 4000 字符截断缓解，但更复杂任务需要摘要或裁剪策略。
- **没有真实沙箱隔离**。脚本继承 `process.env`，能访问整个文件系统。本地自用没问题，若做多租户服务必须上容器/虚拟机隔离。
- **自我修改是双刃剑**。它既能改代码也能提交，意味着「改坏了还提交」的风险真实存在。本地配合人工 review 无妨，但在 CI/生产环境放权自迭代之前，必须加代码评审闸门。
- **30 秒超时偏短**。长时间运行的任务（网络请求、大型处理）会被 kill。
- **工具只有 `run_script` 一个**。虽然覆盖面够广，但涉及需要持久会话状态或外部系统集成时，会退化成「在脚本里硬编码一切」。

改进方向也清晰：加一个压缩历史的策略、加任务检查点持久化、把 `run_script` 升级为可指定语言/沙箱的通用 `run`、支持多工具调用并行（代码里其实已经写了 `for...of` 遍历 `tool_calls`，天然兼容）。

---

## 11. 结语

bun-bot 用一个 100 行的循环证明了：**agent 不需要复杂的框架，只需要一个强大的模型、一个通用的执行工具、和一个不打断它的循环。** 当工具从「枚举能力」变成「提供语言运行时」，agent 的能力边界就从一个列表变成了整个语言生态。

真正的杠杆不在代码量，而在架构选择：让 LLM 写代码、让运行时执行代码、让结果回到推理里。100 行是「让任何事情发生」的最小可行实现，而它的上限，取决于 JS 生态和你敢把多少事情交给它——连「维护它自己」这件事，都已经在它的能力范围内了。

---

*技术细节基于项目真实源码（`index.ts`，共 201 行，去掉注释与空行后 162 行有效代码），核心逻辑约百行。全文可在项目仓库 [BoltDoggy/bun-bot](https://github.com/BoltDoggy/bun-bot) 中对照验证。*
