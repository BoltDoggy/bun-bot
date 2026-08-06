/**
 * p4-config.test.ts — P4 通用化：项目级配置 .bunbot.json（第 3 项）
 *
 * 验证：
 *   1. 默认值合并（无配置文件）
 *   2. 配置文件读回（model / budget / permissions / testCommand / identity / stateDir / ignore）
 *   3. 优先级：环境变量 > 项目配置 > 默认值
 *   4. 合法性兜底（budget 非法 / permissions 非法 / 损坏 JSON）
 *   5. 接入验证：identity() 用配置的 identity；permissions=ask 来自配置文件时 run_bash 写操作被拒
 *
 * 运行：bun test
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, readProjectConfig, CONFIG_FILE, DEFAULT_CONFIG } from "../src/config";
import { identity } from "../src/context";
import { executeTool } from "../src/tools";
import { workspace } from "../src/memory";

// 保存环境变量，避免污染其他用例
const ENV_KEYS = ["BUN_BOT_MODEL", "BUN_BOT_CONTEXT_BUDGET", "BUN_BOT_PERMISSIONS", "AGENT_IDENTITY"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "bun-bot-p4-config-"));
  process.env.BUN_BOT_WORKSPACE = tmp;
  for (const k of ENV_KEYS) delete process.env[k];
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.BUN_BOT_WORKSPACE;
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test("P4 配置默认值：无 .bunbot.json 时返回默认配置", () => {
  const cfg = loadConfig(tmp);
  expect(cfg.model).toBe("deepseek-v4-flash");
  expect(cfg.budget).toBe(120_000);
  expect(cfg.permissions).toBe("auto");
  expect(cfg.testCommand).toBe("bun test");
  expect(cfg.identity).toContain("bun-bot");
  expect(cfg.stateDir).toBe(".bunbot");
  expect(cfg.ignore).toEqual([]);
});

test("P4 配置文件读回：.bunbot.json 全字段生效", () => {
  writeFileSync(join(tmp, CONFIG_FILE), JSON.stringify({
    model: "deepseek-v4-pro",
    budget: 50000,
    permissions: "ask",
    testCommand: "npm test",
    identity: "我是自定义 agent",
    stateDir: ".custom",
    ignore: ["vendor", "target"],
  }));
  const cfg = loadConfig(tmp);
  expect(cfg.model).toBe("deepseek-v4-pro");
  expect(cfg.budget).toBe(50000);
  expect(cfg.permissions).toBe("ask");
  expect(cfg.testCommand).toBe("npm test");
  expect(cfg.identity).toBe("我是自定义 agent");
  expect(cfg.stateDir).toBe(".custom");
  expect(cfg.ignore).toEqual(["vendor", "target"]);
  rmSync(join(tmp, CONFIG_FILE));
});

test("P4 优先级：环境变量 > 项目配置 > 默认值", () => {
  writeFileSync(join(tmp, CONFIG_FILE), JSON.stringify({
    model: "file-model", budget: 1000, permissions: "ask", identity: "file-identity",
  }));
  process.env.BUN_BOT_MODEL = "env-model";
  process.env.BUN_BOT_CONTEXT_BUDGET = "99999";
  process.env.BUN_BOT_PERMISSIONS = "auto";
  process.env.AGENT_IDENTITY = "env-identity";
  const cfg = loadConfig(tmp);
  expect(cfg.model).toBe("env-model");
  expect(cfg.budget).toBe(99999);
  expect(cfg.permissions).toBe("auto");
  expect(cfg.identity).toBe("env-identity");
  // 清环境变量后回到文件配置
  for (const k of ENV_KEYS) delete process.env[k];
  const cfg2 = loadConfig(tmp);
  expect(cfg2.model).toBe("file-model");
  expect(cfg2.budget).toBe(1000);
  expect(cfg2.permissions).toBe("ask");
  expect(cfg2.identity).toBe("file-identity");
  rmSync(join(tmp, CONFIG_FILE));
});

test("P4 合法性兜底：非法 budget/permissions、损坏 JSON 回退默认", () => {
  // budget 非法 + permissions 非法
  writeFileSync(join(tmp, CONFIG_FILE), JSON.stringify({ budget: -5, permissions: "hack" }));
  let cfg = loadConfig(tmp);
  expect(cfg.budget).toBe(DEFAULT_CONFIG.budget);
  expect(cfg.permissions).toBe("auto");
  rmSync(join(tmp, CONFIG_FILE));
  // 损坏 JSON → 默认
  writeFileSync(join(tmp, CONFIG_FILE), "{ not json !!");
  cfg = loadConfig(tmp);
  expect(cfg.model).toBe(DEFAULT_CONFIG.model);
  rmSync(join(tmp, CONFIG_FILE));
  expect(readProjectConfig(tmp)).toEqual({});
});

test("P4 接入：identity() 用配置的 identity；permissions=ask 来自配置文件时 run_bash 写操作被拒", async () => {
  writeFileSync(join(tmp, CONFIG_FILE), JSON.stringify({ identity: "我是接入测试 agent", permissions: "ask" }));
  // identity 接入（无 AGENT_IDENTITY 环境变量）
  expect(identity()).toBe("我是接入测试 agent");
  expect(workspace()).toBe(tmp);
  // ask 权限来自配置文件（非环境变量）→ run_bash 写操作被拒
  const r = JSON.parse(await executeTool("run_bash", JSON.stringify({ command: "echo hi > cfg-ask.txt" })));
  expect(r.error).toContain("权限模式 ask");
  // 只读命令放行（注意：echo/printf 等含写操作关键字，ask 模式下也会被拒，用 pwd）
  const ro = JSON.parse(await executeTool("run_bash", JSON.stringify({ command: "pwd" })));
  expect(ro.exitCode).toBe(0);
  rmSync(join(tmp, CONFIG_FILE));
});
