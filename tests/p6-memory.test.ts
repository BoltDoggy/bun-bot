/**
 * p6-memory.test.ts — P6-4 记忆防膨胀（吸收 research 分支防膨胀思路）
 *
 * 背景：跨会话记忆（AGENT_STATE.json）的 decisions / pitfalls / todo 数组若无限增长，
 *       [记忆] 区块会越来越臃肿、撑爆上下文。P6-4 给三个数组各设上限
 *       MAX_MEMORY_ITEMS（默认 30）条，超出丢最旧 —— load（读入）/ save（写盘）/
 *       sync（MEMORY.md 同步）三路径全部生效。
 *
 * 验证：
 *   1. capMemoryArrays 直接截断：超 30 条丢最旧，30 条以内不动
 *   2. saveState 写盘前截断 → loadState 读回已截断（持久化生效）
 *   3. syncMemoryFile 同步前截断 → MEMORY.md 只含最近 30 条
 *   4. 读入已有超长状态文件时（loadState）同样截断（防御历史遗留）
 *
 * 运行：bun test
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadState,
  saveState,
  syncMemoryFile,
  capMemoryArrays,
  MAX_MEMORY_ITEMS,
  statePath,
  memoryPath,
} from "../src/memory";

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "bun-bot-p6-memory-"));
  process.env.BUN_BOT_WORKSPACE = tmp;
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.BUN_BOT_WORKSPACE;
});

test("P6-4 capMemoryArrays：超 30 条丢最旧，30 条以内不动", () => {
  const s = loadState();
  s.decisions = Array.from({ length: 35 }, (_, i) => ({ when: "t" + i, what: "决策" + i, why: "" }));
  s.pitfalls = Array.from({ length: 40 }, (_, i) => "坑" + i);
  s.todo = Array.from({ length: 20 }, (_, i) => "待办" + i);
  capMemoryArrays(s);
  expect(s.decisions.length).toBe(MAX_MEMORY_ITEMS);
  expect(s.decisions[0].what).toBe("决策5"); // 丢最旧 0-4，保留 5-34
  expect(s.decisions[s.decisions.length - 1].what).toBe("决策34");
  expect(s.pitfalls.length).toBe(MAX_MEMORY_ITEMS);
  expect(s.pitfalls[0]).toBe("坑10");
  expect(s.pitfalls[s.pitfalls.length - 1]).toBe("坑39");
  expect(s.todo.length).toBe(20); // 未超限不动
  expect(s.todo[0]).toBe("待办0");
});

test("P6-4 saveState 写盘前截断 → loadState 读回已截断（持久化生效）", () => {
  const s = loadState();
  s.decisions = Array.from({ length: 33 }, (_, i) => ({ when: "w" + i, what: "W" + i, why: "" }));
  s.pitfalls = Array.from({ length: 50 }, (_, i) => "P" + i);
  s.todo = Array.from({ length: 5 }, (_, i) => "T" + i);
  saveState(s);
  const loaded = loadState();
  expect(loaded.decisions.length).toBe(MAX_MEMORY_ITEMS);
  expect(loaded.decisions[0].what).toBe("W3"); // 丢 0-2
  expect(loaded.pitfalls.length).toBe(MAX_MEMORY_ITEMS);
  expect(loaded.pitfalls[0]).toBe("P20");
  expect(loaded.todo.length).toBe(5); // 未超限
});

test("P6-4 syncMemoryFile 同步前截断 → MEMORY.md 只含最近 30 条", () => {
  const s = loadState();
  s.decisions = Array.from({ length: 35 }, (_, i) => ({ when: "s" + i, what: "S" + i, why: "" }));
  syncMemoryFile(s);
  const md = readFileSync(memoryPath(), "utf8");
  const count = (md.match(/^- \*\*s\d+\*\*/gm) || []).length;
  expect(count).toBe(MAX_MEMORY_ITEMS);
  // 被丢的最旧（s0）不在 MEMORY.md
  expect(md).not.toContain("S0");
  expect(md).toContain("S34");
});

test("P6-4 读入已有超长状态文件（loadState）同样截断（防御历史遗留）", () => {
  // 手工构造一个超长 AGENT_STATE.json（绕过 saveState 的截断）
  const raw = {
    version: 1,
    lastTask: "历史遗留超长记忆",
    lastSummary: "",
    lastRunAt: "",
    decisions: Array.from({ length: 45 }, (_, i) => ({ when: "h" + i, what: "H" + i, why: "" })),
    pitfalls: Array.from({ length: 45 }, (_, i) => "坑" + i),
    todo: Array.from({ length: 45 }, (_, i) => "待办" + i),
  };
  writeFileSync(statePath(), JSON.stringify(raw), "utf8");
  const loaded = loadState();
  expect(loaded.decisions.length).toBe(MAX_MEMORY_ITEMS);
  expect(loaded.decisions[0].what).toBe("H15");
  expect(loaded.pitfalls.length).toBe(MAX_MEMORY_ITEMS);
  expect(loaded.pitfalls[0]).toBe("坑15");
  expect(loaded.todo.length).toBe(MAX_MEMORY_ITEMS);
  expect(loaded.todo[0]).toBe("待办15");
  // 非数组字段不被误伤
  expect(loaded.lastTask).toBe("历史遗留超长记忆");
  expect(existsSync(statePath())).toBe(true);
});
