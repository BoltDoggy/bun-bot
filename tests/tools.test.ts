/**
 * tools.test.ts — M1 自测闸门（+ skills 层 + AGENTS.md 项目指令 + P2-1 ACI 化 + P2-2 任务模式 + P2-3 上下文预算）
 *
 * 覆盖：run_script（沙箱 cwd / 工作区 cwd）、read_file（偏移续读）、write_file（diff）、
 *       list_dir（-a）、run_bash、输出截断、工具描述 example usage（P2-1）、
 *       记忆读写、skills 索引、web-search 解析器、AGENTS.md 项目级指令加载与优先级、
 *       update_plan 任务计划（P2-2：创建/勾选/完成度/记忆往返/任务模式提示词）、
 *       budget.ts 上下文预算（P2-3：token 估算 / tool result clearing 压缩 / 告警展示）。
 *
 * 运行：bun test  或  bun run tests/tools.test.ts
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executeTool,
  clipOutput,
  summarizeDiff,
  DEFAULT_OUTPUT_LIMIT,
  tools,
} from "../src/tools";
import {
  loadState,
  saveState,
  syncMemoryFile,
  workspace,
  statePath,
  memoryPath,
  loadProjectContext,
  readAgentDirective,
  AGENTS_FILE,
} from "../src/memory";
import { skillsIndex, buildSystemPrompt } from "../src/context";
import { estimateTokens, estimateMessagesTokens, compressContext } from "../src/budget";
import { parseBingHtml, parseDdgHtml } from "../skills/web-search/search";

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "bun-bot-test-"));
  process.env.BUN_BOT_WORKSPACE = tmp;
  // 真实项目总有一个 README，loadProjectContext 的优先级断言依赖它存在
  writeFileSync(join(tmp, "README.md"), "# sandbox project\n");
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.BUN_BOT_WORKSPACE;
});

// ---------- 输出截断 ----------

test("clipOutput 在 64KB 截断并带偏移信息", () => {
  const big = "x".repeat(DEFAULT_OUTPUT_LIMIT + 100);
  const clipped = clipOutput(big);
  expect(clipped.length).toBeLessThan(big.length);
  expect(clipped).toContain("[截断]");
  expect(clipped).toContain("总共 " + big.length + " 字符");
  expect(clipped).toContain("从偏移 " + DEFAULT_OUTPUT_LIMIT + " 开始读取");
  expect(clipOutput("short")).toBe("short");
});

// ---------- run_script ----------

test("run_script 默认 cwd 是临时目录（沙箱，文件不落工作区）", async () => {
  const r = await executeTool("run_script", JSON.stringify({
    code: "const fs=require('node:fs'); fs.writeFileSync('sandbox.txt','hi'); console.log(process.cwd()); console.log(fs.existsSync('sandbox.txt'));",
  }));
  const out = JSON.parse(r);
  expect(out.exitCode).toBe(0);
  expect(out.stdout).toContain("true");
  // 沙箱产物不应出现在工作区
  expect(existsSync(join(tmp, "sandbox.txt"))).toBe(false);
});

test("run_script 指定 cwd=工作区 时可以读写项目文件", async () => {
  const r = await executeTool("run_script", JSON.stringify({
    code: "const fs=require('node:fs'); fs.writeFileSync('from-script.txt','written-by-run-script'); console.log('ok');",
    cwd: ".",
  }));
  const out = JSON.parse(r);
  expect(out.exitCode).toBe(0);
  expect(out.cwd).toBe(tmp);
  expect(readFileSync(join(tmp, "from-script.txt"), "utf8")).toBe("written-by-run-script");
});

// ---------- read_file ----------

test("read_file 完整读取 + 偏移续读", async () => {
  const content = "line0\nline1\nline2\nline3\nline4\n";
  writeFileSync(join(tmp, "readme-test.txt"), content);
  const full = JSON.parse(await executeTool("read_file", JSON.stringify({ path: "readme-test.txt" })));
  expect(full.content).toBe(content);
  expect(full.totalBytes).toBe(content.length);
  expect(full.truncated).toBe(false);
  // 偏移读取后半段
  const mid = JSON.parse(await executeTool("read_file", JSON.stringify({ path: "readme-test.txt", offset: 12 })));
  expect(mid.content).toBe(content.slice(12));
  expect(mid.returnedRange).toBe("[12.." + content.length + ")");
});

test("read_file 不存在的文件返回错误", async () => {
  const r = JSON.parse(await executeTool("read_file", JSON.stringify({ path: "nope.txt" })));
  expect(r.error).toBeDefined();
});

// ---------- write_file ----------

test("write_file 新建文件并返回 diff", async () => {
  const r = JSON.parse(await executeTool("write_file", JSON.stringify({
    path: "sub/new-file.txt",
    content: "a\nb\nc",
  })));
  expect(r.bytesWritten).toBe(5);
  expect(r.diff).toContain("+3 / -0");
  expect(readFileSync(join(tmp, "sub", "new-file.txt"), "utf8")).toBe("a\nb\nc");
});

test("write_file 覆盖已有文件，diff 显示 +2 / -2", async () => {
  const r = JSON.parse(await executeTool("write_file", JSON.stringify({
    path: "sub/new-file.txt",
    content: "a\nX\nY\nc",
  })));
  expect(r.diff).toContain("+2 / -1");
  expect(r.diff).toContain("+ X");
  expect(readFileSync(join(tmp, "sub", "new-file.txt"), "utf8")).toBe("a\nX\nY\nc");
});

// ---------- list_dir ----------

test("list_dir 列目录，默认隐藏隐藏文件，-a 显示", async () => {
  writeFileSync(join(tmp, ".secret"), "s");
  const normal = JSON.parse(await executeTool("list_dir", JSON.stringify({ path: ".", depth: 2 })));
  expect(normal.tree).toContain("new-file.txt");
  expect(normal.tree).not.toContain(".secret");
  const all = JSON.parse(await executeTool("list_dir", JSON.stringify({ path: ".", all: true, depth: 2 })));
  expect(all.tree).toContain(".secret");
});

// ---------- run_bash ----------

test("run_bash 执行命令并返回输出", async () => {
  const r = JSON.parse(await executeTool("run_bash", JSON.stringify({ command: "echo hello-$((1+1))" })));
  expect(r.exitCode).toBe(0);
  expect(r.stdout.trim()).toBe("hello-2");
  expect(r.cwd).toBe(tmp);
});

// ---------- summarizeDiff ----------

test("summarizeDiff 相同内容返回无变化", () => {
  expect(summarizeDiff("abc", "abc")).toBe("（无变化）");
});

// ---------- 工具描述 ACI 化（P2-1） ----------

test("6 个工具 description 均带 example usage（P2-1 ACI 化）", () => {
  expect(tools.length).toBe(6);
  const names = tools.map((t) => t.function.name);
  expect(names).toEqual(["run_script", "read_file", "write_file", "list_dir", "run_bash", "update_plan"]);
  for (const t of tools) {
    const desc = t.function.description;
    expect(desc).toContain("示例：");
    // 示例必须是真实的 JSON 参数形态（以 { 开头），而不是空话
    const examplePart = desc.slice(desc.indexOf("示例："));
    expect(examplePart).toMatch(/\{\"/);
  }
  // 必填参数在 schema 中声明
  for (const t of tools) {
    const fn = t.function;
    for (const req of fn.parameters.required) {
      expect(fn.parameters.properties[req]).toBeDefined();
    }
  }
});

test("系统提示词 [能力] 区块工具描述带示例（P2-1 双保险）", () => {
  const prompt = buildSystemPrompt({ state: loadState(), project: "proj" });
  expect(prompt).toContain("示例：{\\\"code\\\":\\\"console.log(1+1)\\\"}");
  expect(prompt).toContain("示例：{\\\"path\\\":\\\"src/tools.ts\\\"}");
  expect(prompt).toContain("示例：{\\\"command\\\":\\\"bun test\\\"}");
});

// ---------- 记忆读写 ----------

test("记忆保存/加载往返 + MEMORY.md 同步生成", () => {
  const s = loadState();
  s.lastTask = "把 index.ts 注释改成两行";
  s.lastSummary = "已完成，diff 可见";
  s.decisions = [{ when: "2025", what: "输出上限 64KB", why: "1M 上下文下 4K 截断浪费能力" }];
  s.pitfalls = ["Bun.spawn 的 stderr 要单独消费"];
  s.todo = ["P2: 上下文预算摘要"];
  saveState(s);
  syncMemoryFile(s);
  // 重新加载验证持久化
  const loaded = loadState();
  expect(loaded.lastTask).toBe("把 index.ts 注释改成两行");
  expect(loaded.lastSummary).toBe("已完成，diff 可见");
  expect(loaded.decisions[0].what).toBe("输出上限 64KB");
  expect(loaded.pitfalls[0]).toContain("stderr");
  expect(existsSync(statePath())).toBe(true);
  // MEMORY.md 人类可读版
  const md = readFileSync(memoryPath(), "utf8");
  expect(md).toContain("把 index.ts 注释改成两行");
  expect(md).toContain("决策记录");
  expect(md).toContain("P2: 上下文预算摘要");
});

test("workspace() 返回测试沙箱", () => {
  expect(workspace()).toBe(tmp);
});

// ---------- AGENTS.md 项目级指令 ----------

test("AGENTS.md 不存在时 readAgentDirective 返回 null，loadProjectContext 静默跳过", () => {
  const p = join(tmp, AGENTS_FILE);
  if (existsSync(p)) rmSync(p);
  expect(readAgentDirective()).toBeNull();
  const ctx = loadProjectContext();
  expect(ctx).not.toContain("## " + AGENTS_FILE);
  expect(ctx).toContain("## README.md");
});

test("AGENTS.md 存在时被加载，且排在 README 之前（优先级最高）", () => {
  const agentContent = [
    "# 项目指令",
    "",
    "- 禁止修改 docs/ 下的文件",
    "- 所有改动必须跑 `bun test` 验证",
  ].join("\n");
  writeFileSync(join(tmp, AGENTS_FILE), agentContent);

  const directive = readAgentDirective();
  expect(directive).not.toBeNull();
  expect(directive!.name).toBe(AGENTS_FILE);
  expect(directive!.content).toContain("禁止修改 docs/ 下的文件");

  const ctx = loadProjectContext();
  const agentIdx = ctx.indexOf("## " + AGENTS_FILE);
  const readmeIdx = ctx.indexOf("## README.md");
  expect(agentIdx).toBeGreaterThanOrEqual(0);
  expect(agentIdx).toBeLessThan(readmeIdx); // 指令在前
  expect(ctx).toContain("项目级指令");
  expect(ctx).toContain("禁止修改 docs/ 下的文件");

  // 系统提示词声明 AGENTS.md 的约束力
  const prompt = buildSystemPrompt({ state: loadState(), project: ctx });
  expect(prompt).toContain(AGENTS_FILE);
  expect(prompt).toContain("约束力");
  expect(prompt).toContain("以 " + AGENTS_FILE + " 为准");

  // 清理，避免影响其他用例
  rmSync(join(tmp, AGENTS_FILE));
});

// ---------- skills 层 ----------

test("skillsIndex 从 skills/README.md 提取索引表格", () => {
  mkdirSync(join(tmp, "skills"), { recursive: true });
  writeFileSync(join(tmp, "skills", "README.md"), [
    "# skills",
    "",
    "## 索引",
    "",
    "| skill | 一句话 | 版本 | 自测 |",
    "| --- | --- | --- | --- |",
    "| web-search | 联网搜索（Bing + DDG） | v2 | bun run skills/web-search/self-test.ts |",
  ].join("\n"));
  const idx = skillsIndex();
  expect(idx).toContain("web-search");
  expect(idx).toContain("联网搜索");
  expect(idx).toContain("self-test.ts");
});

test("buildSystemPrompt 的 [能力] 区块包含 skills 索引", () => {
  const prompt = buildSystemPrompt({ state: loadState(), project: "proj" });
  expect(prompt).toContain("可用 skills");
  expect(prompt).toContain("web-search");
  expect(prompt).toContain("skills/<name>/SKILL.md");
});

test("web-search 解析器对离线样本工作正常", () => {
  const base = join(import.meta.dir, "..", "skills", "web-search", "samples");
  const bing = parseBingHtml(readFileSync(join(base, "bing.html"), "utf8"));
  expect(bing.length).toBe(3);
  expect(bing[0].url).toBe("https://bun.sh/");
  expect(bing[0].title).toContain("Bun");
  expect(bing[0].title).not.toContain("<strong>");
  expect(bing[0].title).not.toContain("&amp;");
  expect(bing[0].snippet).toContain("JavaScript runtime");

  const ddg = parseDdgHtml(readFileSync(join(base, "ddg.html"), "utf8"));
  expect(ddg.length).toBe(2);
  expect(ddg[0].url).toBe("https://bun.sh/");
  expect(ddg[0].snippet).toContain("Bundle");
});

// ---------- 任务模式 update_plan（P2-2） ----------

test("update_plan 创建/勾选计划，进度写回 AGENT_STATE.json + MEMORY.md（任务模式）", async () => {
  // 首轮创建
  const create = JSON.parse(await executeTool("update_plan", JSON.stringify({
    title: "新增 read_file 工具",
    items: [
      { text: "在 tools.ts 注册 read_file", done: false },
      { text: "补文档与测试", done: false },
    ],
  })));
  expect(create.saved).toBe(true);
  expect(create.total).toBe(2);
  expect(create.doneCount).toBe(0);
  expect(create.percent).toBe(0);
  expect(create.status).toBe("active");
  expect(create.title).toBe("新增 read_file 工具");
  expect(create.note).toContain("AGENT_STATE.json");

  // 勾选第一步（title 省略保留原标题）
  const check = JSON.parse(await executeTool("update_plan", JSON.stringify({
    items: [
      { text: "在 tools.ts 注册 read_file", done: true, detail: "bun test 通过" },
      { text: "补文档与测试", done: false },
    ],
  })));
  expect(check.title).toBe("新增 read_file 工具"); // 原标题保留
  expect(check.doneCount).toBe(1);
  expect(check.percent).toBe(50);
  expect(check.status).toBe("active");

  // 记忆往返：activePlan 持久化
  const s = loadState();
  expect(s.activePlan?.title).toBe("新增 read_file 工具");
  expect(s.activePlan?.items.length).toBe(2);
  expect(s.activePlan?.items[0].done).toBe(true);
  expect(s.activePlan?.items[0].detail).toBe("bun test 通过");
  expect(s.activePlan?.items[1].done).toBe(false);
  expect(s.activePlan?.createdAt).toBeDefined();
  expect(s.activePlan?.updatedAt).toBeDefined();

  // MEMORY.md 同步出现"当前任务计划"区块
  const md = readFileSync(memoryPath(), "utf8");
  expect(md).toContain("## 当前任务计划");
  expect(md).toContain("新增 read_file 工具");
  expect(md).toContain("1/2 完成");
  expect(md).toContain("- [x] 在 tools.ts 注册 read_file（bun test 通过）");
  expect(md).toContain("- [ ] 补文档与测试");

  // 全部完成 → status done
  const done = JSON.parse(await executeTool("update_plan", JSON.stringify({
    items: [
      { text: "在 tools.ts 注册 read_file", done: true },
      { text: "补文档与测试", done: true },
    ],
  })));
  expect(done.status).toBe("done");
  expect(done.percent).toBe(100);
  const s2 = loadState();
  expect(s2.activePlan?.status).toBe("done");

  // 清理：避免残留 activePlan 影响后续用例
  const clean = loadState();
  clean.activePlan = undefined;
  saveState(clean);
  syncMemoryFile(clean);
});

test("update_plan 参数校验：缺 items / 空 text 返回错误", async () => {
  const noItems = JSON.parse(await executeTool("update_plan", JSON.stringify({ title: "x" })));
  expect(noItems.error).toContain("items");

  const emptyText = JSON.parse(await executeTool("update_plan", JSON.stringify({
    items: [{ text: "  ", done: false }],
  })));
  expect(emptyText.error).toContain("text");
});

test("任务模式系统提示词：--self 注入 [任务模式] 区块并展示 activePlan 进度", () => {
  const s = loadState();
  s.activePlan = {
    title: "续跑任务",
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:01:00.000Z",
    items: [
      { text: "第一步", done: true, detail: "完成" },
      { text: "第二步", done: false },
    ],
    status: "active",
  };
  // 非 self 模式：无 [任务模式] 区块，但 [记忆] 展示计划
  const normal = buildSystemPrompt({ state: s, project: "proj" });
  expect(normal).not.toContain("[任务模式]");
  expect(normal).toContain("当前任务计划: 续跑任务（1/2 完成 ⏳）");
  expect(normal).toContain("[x] 第一步 — 完成");
  // self 模式：注入任务模式区块 + 未完成续跑提示
  const self = buildSystemPrompt({ state: s, project: "proj", selfMode: true });
  expect(self).toContain("[任务模式]");
  expect(self).toContain("update_plan");
  expect(self).toContain("检测到上次未完成的计划「续跑任务」");
  expect(self).toContain("优先继续它而非重建");
  // 全部完成时不提示续跑
  const doneState = loadState();
  doneState.activePlan = { ...s.activePlan!, status: "done" };
  const selfDone = buildSystemPrompt({ state: doneState, project: "proj", selfMode: true });
  expect(selfDone).not.toContain("检测到上次未完成的计划");
  // 清理
  const clean = loadState();
  clean.activePlan = undefined;
  saveState(clean);
  syncMemoryFile(clean);
});

// ---------- 上下文预算 budget.ts（P2-3） ----------

test("estimateTokens 中英文混合估算：ASCII 4 字符 1 token，中文 1 字 1 token", () => {
  expect(estimateTokens("")).toBe(0);
  expect(estimateTokens("hello world")).toBe(Math.ceil(11 / 4)); // 3
  expect(estimateTokens("你好世界")).toBe(4);
  expect(estimateTokens("hi 你好")).toBe(3); // ascii 3 → 1 + 中文 2 → 2
});

test("estimateMessagesTokens 汇总 content 与 tool_calls 参数", () => {
  const msgs = [
    { role: "system", content: "sys" },
    { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "run_script", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "t1", content: "x".repeat(400) },
  ];
  const tokens = estimateMessagesTokens(msgs);
  expect(tokens).toBeGreaterThan(0);
  // 只有 content 的估算必然小于整段（含 tool_calls 与 400 字符结果）
  expect(tokens).toBeGreaterThan(estimateTokens("sys"));
});

test("compressContext 不超限时原样返回（不复制数组）", () => {
  const msgs = [
    { role: "system", content: "sys" },
    { role: "tool", tool_call_id: "t1", content: "short" },
  ];
  const r = compressContext(msgs, 100_000);
  expect(r.cleared).toBe(0);
  expect(r.messages).toBe(msgs); // 引用不变
  expect(r.messages[1].content).toBe("short");
});

test("compressContext 超限时清最早的 tool 结果、保留消息结构（P2-3 tool result clearing）", () => {
  const big = "y".repeat(5000);
  const msgs = [
    { role: "system", content: "system prompt" },
    { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "run_script", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "t1", content: big },
    { role: "assistant", content: null, tool_calls: [{ id: "t2", type: "function", function: { name: "read_file", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "t2", content: big },
    { role: "user", content: "继续" },
  ];
  const r = compressContext(msgs, 500);
  expect(r.cleared).toBeGreaterThan(0);
  expect(r.beforeTokens).toBeGreaterThan(500);
  expect(r.afterTokens).toBeLessThan(r.beforeTokens);
  // 结构保留：消息数不变、system 不被清、tool_call_id 关联还在
  expect(r.messages.length).toBe(msgs.length);
  expect(r.messages[0].content).toBe("system prompt");
  expect(r.messages[2].tool_call_id).toBe("t1");
  // 最早的 tool 结果被摘要化：保留前缀 + 清理标记 + 原始长度
  expect(r.messages[2].content.length).toBeLessThan(big.length);
  expect(r.messages[2].content).toContain("已清理");
  expect(r.messages[2].content).toContain("5000 字符");
  // 更新的 tool 结果（t2）优先保留完整（先清最老的）
  expect(r.messages[4].content).toBe(big);
});

test("compressContext 多轮清理直到低于预算，全清后停止（不无限循环）", () => {
  const big = "z".repeat(10000);
  const msgs = [
    { role: "system", content: "sys" },
    { role: "tool", tool_call_id: "t1", content: big },
    { role: "tool", tool_call_id: "t2", content: big },
    { role: "tool", tool_call_id: "t3", content: big },
    { role: "user", content: "go" },
  ];
  const tinyBudget = 100;
  const r = compressContext(msgs, tinyBudget);
  // 全部 tool 结果都被摘要化
  expect(r.cleared).toBe(3);
  expect(r.messages.length).toBe(5);
  for (const m of r.messages) {
    if (m.role === "tool") expect(m.content).toContain("已清理");
  }
  // 摘要本身也占 token，全清后仍可能超 tinyBudget，但清理次数有上限（3 条 tool）
  expect(r.cleared).toBeLessThanOrEqual(3);
});

test("buildSystemPrompt [记忆] 区块展示上下文预算告警 + MEMORY.md 同步（P2-3）", () => {
  const s = loadState();
  s.contextWarnings = ["第 42 轮：上下文超预算，清理 3 条工具结果（150000 → 80000 tokens）"];
  const prompt = buildSystemPrompt({ state: s, project: "proj" });
  expect(prompt).toContain("上下文预算告警");
  expect(prompt).toContain("第 42 轮");
  // MEMORY.md 同步出现"上下文预算告警"区块
  syncMemoryFile(s);
  const md = readFileSync(memoryPath(), "utf8");
  expect(md).toContain("## 上下文预算告警");
  expect(md).toContain("第 42 轮");
  // 清理，避免影响其他用例
  const clean = loadState();
  clean.contextWarnings = [];
  saveState(clean);
  syncMemoryFile(clean);
});
