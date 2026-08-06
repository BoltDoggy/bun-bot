/**
 * p4-global.test.ts — P4 通用化：全局配置 ~/.bun-bot/ + 多项目状态隔离（第 8 项）
 *
 * 验证：
 *   1. ~/.bun-bot/config.json 读回（model / permissions / apiKey）
 *   2. 优先级：环境变量 > 项目配置 > 全局配置 > 默认值
 *   3. API key fallback：DEEPSEEK_API_KEY 缺失时用全局配置的 apiKey（不进项目配置）
 *   4. 多项目状态隔离：projA / projB 各自 .bunbot/ 状态互不串
 *
 * 运行：bun test
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConfig, readGlobalConfig, globalConfigDir, CONFIG_FILE,
} from "../src/config";
import { loadState, saveState, syncMemoryFile, statePath } from "../src/memory";

const savedHome = process.env.HOME;
const ENV_KEYS = ["BUN_BOT_MODEL", "BUN_BOT_PERMISSIONS", "AGENT_IDENTITY", "BUN_BOT_CONTEXT_BUDGET"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

let tmp: string;
let projA: string;
let projB: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "bun-bot-p4-global-"));
  process.env.HOME = tmp; // 全局配置目录 ~/.bun-bot/ 指向沙箱
  mkdirSync(join(tmp, ".bun-bot"), { recursive: true });
  writeFileSync(join(tmp, ".bun-bot", "config.json"), JSON.stringify({
    model: "global-model", permissions: "ask", apiKey: "global-key-123",
  }));
  projA = join(tmp, "projA");
  mkdirSync(projA, { recursive: true });
  projB = join(tmp, "projB");
  mkdirSync(projB, { recursive: true });
  for (const k of ENV_KEYS) delete process.env[k];
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test("P4 全局配置：~/.bun-bot/config.json 读回（model/permissions/apiKey）", () => {
  expect(globalConfigDir()).toBe(join(tmp, ".bun-bot"));
  const g = readGlobalConfig();
  expect(g.model).toBe("global-model");
  expect(g.permissions).toBe("ask");
  expect(g.apiKey).toBe("global-key-123");
});

test("P4 优先级：环境变量 > 项目配置 > 全局配置 > 默认值", () => {
  // 无项目配置 → 全局配置生效（默认值被全局覆盖）
  const c1 = loadConfig(projA);
  expect(c1.model).toBe("global-model");
  expect(c1.permissions).toBe("ask");
  // 项目配置覆盖全局
  writeFileSync(join(projA, CONFIG_FILE), JSON.stringify({ model: "file-model" }));
  const c2 = loadConfig(projA);
  expect(c2.model).toBe("file-model");
  expect(c2.permissions).toBe("ask"); // 项目未覆盖的字段仍用全局
  // 环境变量覆盖全部
  process.env.BUN_BOT_MODEL = "env-model";
  const c3 = loadConfig(projA);
  expect(c3.model).toBe("env-model");
  delete process.env.BUN_BOT_MODEL;
  rmSync(join(projA, CONFIG_FILE));
});

test("P4 API key fallback：全局 apiKey 可读，但不进入项目配置字段", () => {
  // index.ts 里 DEEPSEEK_API_KEY || readGlobalConfig().apiKey —— 全局 key 提供 fallback
  expect(readGlobalConfig().apiKey).toBe("global-key-123");
  // apiKey 不是项目配置字段：loadConfig 返回的配置里没有它（只做 fallback）
  const cfg = loadConfig(projB);
  expect((cfg as Record<string, unknown>).apiKey).toBeUndefined();
});

test("P4 多项目状态隔离：projA / projB 各自 .bunbot/ 状态互不串", () => {
  // projA 写状态
  process.env.BUN_BOT_WORKSPACE = projA;
  const sA = loadState();
  sA.lastTask = "项目 A 的任务";
  saveState(sA);
  syncMemoryFile(sA);
  expect(statePath()).toBe(join(projA, ".bunbot", "AGENT_STATE.json"));
  // projB 写状态
  process.env.BUN_BOT_WORKSPACE = projB;
  const sB = loadState();
  sB.lastTask = "项目 B 的任务";
  syncMemoryFile(sB);
  saveState(sB);
  expect(statePath()).toBe(join(projB, ".bunbot", "AGENT_STATE.json"));
  // 互不串：切回 A 读 A，切 B 读 B
  process.env.BUN_BOT_WORKSPACE = projA;
  expect(loadState().lastTask).toBe("项目 A 的任务");
  process.env.BUN_BOT_WORKSPACE = projB;
  expect(loadState().lastTask).toBe("项目 B 的任务");
  // 文件确实落在各自目录（含 MEMORY.md 各自生成）
  expect(existsSync(join(projA, ".bunbot", "AGENT_STATE.json"))).toBe(true);
  expect(existsSync(join(projB, ".bunbot", "AGENT_STATE.json"))).toBe(true);
  expect(existsSync(join(projA, ".bunbot", "MEMORY.md"))).toBe(true);
  expect(existsSync(join(projB, ".bunbot", "MEMORY.md"))).toBe(true);
  // 恢复
  process.env.BUN_BOT_WORKSPACE = tmp;
});
