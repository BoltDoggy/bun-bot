/**
 * p4-context.test.ts — P4 通用化：身份与项目认知去专用化（第 2 项）
 *
 * 验证：
 *   1. [身份] 可用 AGENT_IDENTITY 环境变量配置（默认 bun-bot）
 *   2. [项目] 关键文件按存在性动态生成：无 src/、无 index.ts 的模拟项目
 *      构建系统提示词时，关键文件区块不出现 bun-bot 特有文件路径
 *   3. 存在性感知：存在的文件列出（README.md / package.json / src/ 等），
 *      不存在的（src/、AGENTS.md）不在列表中
 *
 * 运行：bun test
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSystemPrompt, identity, keyFilesSection } from "../src/context";
import { loadState, workspace } from "../src/memory";

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "bun-bot-p4-test-"));
  process.env.BUN_BOT_WORKSPACE = tmp;
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.BUN_BOT_WORKSPACE;
});

/** 提取系统提示词中"关键文件:"到"[记忆]"之间的区块（避开 [能力] 区块的工具示例） */
function keyFilesBlock(prompt: string): string {
  const start = prompt.indexOf("关键文件");
  const end = prompt.indexOf("[记忆]");
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return prompt.slice(start, end);
}

// ---------- [身份] 可配置（AGENT_IDENTITY） ----------

test("P4 [身份] 默认是 bun-bot，AGENT_IDENTITY 环境变量可覆盖", () => {
  expect(identity()).toContain("bun-bot");
  const prompt = buildSystemPrompt({ state: loadState(), project: "proj" });
  expect(prompt).toContain("[身份] 我是 bun-bot，一个自我认知为 Bun.js 运行时的 agent。");

  const old = process.env.AGENT_IDENTITY;
  process.env.AGENT_IDENTITY = "我是 dev-agent，一个通用的项目助手。";
  try {
    expect(identity()).toBe("我是 dev-agent，一个通用的项目助手。");
    const p2 = buildSystemPrompt({ state: loadState(), project: "proj" });
    expect(p2).toContain("[身份] 我是 dev-agent，一个通用的项目助手。");
    expect(p2).not.toContain("[身份] 我是 bun-bot");
  } finally {
    if (old === undefined) delete process.env.AGENT_IDENTITY;
    else process.env.AGENT_IDENTITY = old;
  }
  // 清理后回到默认
  expect(identity()).toContain("bun-bot");
});

// ---------- 关键文件按存在性动态生成 ----------

test("P4 无 src/ 的模拟项目：关键文件区块不出现 bun-bot 特有文件路径", () => {
  // 模拟一个普通项目：只有 README.md + package.json，无 src/、无 index.ts、无 AGENTS.md
  const base = join(tmp, "foreign-proj");
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, "README.md"), "# foreign project\n");
  writeFileSync(join(base, "package.json"), JSON.stringify({ name: "foreign", private: true }));

  const oldWs = process.env.BUN_BOT_WORKSPACE;
  process.env.BUN_BOT_WORKSPACE = base;
  try {
    const prompt = buildSystemPrompt({ state: loadState(), project: "## 模拟项目（无 src/）" });
    const block = keyFilesBlock(prompt);
    // bun-bot 特有文件路径不出现在关键文件区块
    for (const p of [
      "src/tools.ts", "src/budget.ts", "src/gate.ts", "src/audit.ts",
      "src/context.ts", "src/memory.ts", "src/git.ts",
      "工具注册表（新增工具在此注册）",
      "上下文 token 预算与超限压缩",
    ]) {
      expect(block).not.toContain(p);
    }
    // 存在性感知：README.md / package.json 列出，src/ / AGENTS.md / index.ts 不列出
    expect(block).toContain("- README.md");
    expect(block).toContain("- package.json");
    expect(block).not.toContain("- src/");
    expect(block).not.toContain("- " + "AGENTS.md");
    expect(block).not.toContain("index.ts");
  } finally {
    process.env.BUN_BOT_WORKSPACE = oldWs!;
  }
});

test("P4 存在性感知：有 src/ + tests/ + AGENTS.md 时全部列出，keyFilesSection 独立可用", () => {
  const base = join(tmp, "rich-proj");
  mkdirSync(join(base, "src"), { recursive: true });
  mkdirSync(join(base, "tests"), { recursive: true });
  mkdirSync(join(base, "docs"), { recursive: true });
  writeFileSync(join(base, "AGENTS.md"), "# 指令\n");
  writeFileSync(join(base, "README.md"), "# rich\n");
  writeFileSync(join(base, "index.ts"), "console.log('hi')\n");

  const sec = keyFilesSection(base);
  expect(sec).toContain("- " + "AGENTS.md");
  expect(sec).toContain("- README.md");
  expect(sec).toContain("- index.ts / main.*");
  expect(sec).toContain("- src/");
  expect(sec).toContain("- tests/");
  expect(sec).toContain("- docs/");

  // 空目录：给兜底提示
  const empty = join(tmp, "empty-proj");
  mkdirSync(empty, { recursive: true });
  const sec2 = keyFilesSection(empty);
  expect(sec2).toContain("list_dir");
});
