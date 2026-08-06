/**
 * tools.test.ts — M1 自测闸门（+ skills 层 + AGENT.md 项目指令）
 *
 * 覆盖：run_script（沙箱 cwd / 工作区 cwd）、read_file（偏移续读）、write_file（diff）、
 *       list_dir（-a）、run_bash、输出截断、记忆读写、skills 索引、web-search 解析器、
 *       AGENT.md 项目级指令加载与优先级。
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
  AGENT_FILE,
} from "../src/memory";
import { skillsIndex, buildSystemPrompt } from "../src/context";
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

// ---------- AGENT.md 项目级指令 ----------

test("AGENT.md 不存在时 readAgentDirective 返回 null，loadProjectContext 静默跳过", () => {
  const p = join(tmp, AGENT_FILE);
  if (existsSync(p)) rmSync(p);
  expect(readAgentDirective()).toBeNull();
  const ctx = loadProjectContext();
  expect(ctx).not.toContain("## " + AGENT_FILE);
  expect(ctx).toContain("## README.md");
});

test("AGENT.md 存在时被加载，且排在 README 之前（优先级最高）", () => {
  const agentContent = [
    "# 项目指令",
    "",
    "- 禁止修改 docs/ 下的文件",
    "- 所有改动必须跑 `bun test` 验证",
  ].join("\n");
  writeFileSync(join(tmp, AGENT_FILE), agentContent);

  const directive = readAgentDirective();
  expect(directive).toContain("禁止修改 docs/ 下的文件");

  const ctx = loadProjectContext();
  const agentIdx = ctx.indexOf("## " + AGENT_FILE);
  const readmeIdx = ctx.indexOf("## README.md");
  expect(agentIdx).toBeGreaterThanOrEqual(0);
  expect(agentIdx).toBeLessThan(readmeIdx); // 指令在前
  expect(ctx).toContain("项目级指令");
  expect(ctx).toContain("禁止修改 docs/ 下的文件");

  // 系统提示词声明 AGENT.md 的约束力
  const prompt = buildSystemPrompt({ state: loadState(), project: ctx });
  expect(prompt).toContain(AGENT_FILE);
  expect(prompt).toContain("约束力");
  expect(prompt).toContain("以 " + AGENT_FILE + " 为准");

  // 清理，避免影响其他用例
  rmSync(join(tmp, AGENT_FILE));
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
