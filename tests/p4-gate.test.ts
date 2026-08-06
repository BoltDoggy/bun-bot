/**
 * p4-gate.test.ts — P4 通用化：通用测试闸门多生态探测（第 5 项）
 *
 * 验证：
 *   1. detectTestCommand 多生态探测：package.json（scripts.test → bun run test /
 *      无 → bun test）、pyproject.toml → pytest、Cargo.toml → cargo test、
 *      go.mod → go test、tests/ 目录 → bun test、无信号 → null
 *   2. .bunbot.json 的 testCommand 配置覆盖探测
 *   3. runTestGate 实际执行探测到的命令（bun 项目）并返回 pass/fail + 输出带命令说明
 *
 * 运行：bun test
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectTestCommand, hasTestSignal, runTestGate } from "../src/gate";
import { CONFIG_FILE } from "../src/config";

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "bun-bot-p4-gate-"));
  process.env.BUN_BOT_WORKSPACE = tmp;
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.BUN_BOT_WORKSPACE;
});

test("P4 多生态探测：package.json 有 scripts.test → bun run test，无 → bun test", () => {
  const js = join(tmp, "js-proj");
  mkdirSync(js, { recursive: true });
  writeFileSync(join(js, "package.json"), JSON.stringify({ name: "js", scripts: { test: "vitest run" } }));
  const d1 = detectTestCommand(js)!;
  expect(d1.command).toEqual(["bun", "run", "test"]);
  expect(d1.hint).toContain("scripts.test");
  expect(hasTestSignal(js)).toBe(true);

  const js2 = join(tmp, "js-proj2");
  mkdirSync(js2, { recursive: true });
  writeFileSync(join(js2, "package.json"), JSON.stringify({ name: "js2", private: true }));
  const d2 = detectTestCommand(js2)!;
  expect(d2.command).toEqual(["bun", "test"]);
  expect(d2.hint).toContain("package.json");
});

test("P4 多生态探测：pyproject → pytest、Cargo → cargo test、go.mod → go test", () => {
  const py = join(tmp, "py-proj");
  mkdirSync(py, { recursive: true });
  writeFileSync(join(py, "pyproject.toml"), "[project]\nname = \"py\"\n");
  const dp = detectTestCommand(py)!;
  expect(dp.command).toEqual(["pytest"]);
  expect(dp.hint).toContain("pyproject");

  const rs = join(tmp, "rs-proj");
  mkdirSync(rs, { recursive: true });
  writeFileSync(join(rs, "Cargo.toml"), "[package]\nname = \"rs\"\n");
  const dr = detectTestCommand(rs)!;
  expect(dr.command).toEqual(["cargo", "test"]);
  expect(dr.hint).toContain("Cargo.toml");

  const go = join(tmp, "go-proj");
  mkdirSync(go, { recursive: true });
  writeFileSync(join(go, "go.mod"), "module example.com/go\n");
  const dg = detectTestCommand(go)!;
  expect(dg.command).toEqual(["go", "test"]);
  expect(dg.hint).toContain("go.mod");
});

test("P4 多生态探测：tests/ 目录兜底 → bun test；无信号 → null", () => {
  const t = join(tmp, "tests-only");
  mkdirSync(join(t, "tests"), { recursive: true });
  const dt = detectTestCommand(t)!;
  expect(dt.command).toEqual(["bun", "test"]);
  expect(dt.hint).toContain("tests/");

  const empty = join(tmp, "empty-proj");
  mkdirSync(empty, { recursive: true });
  expect(detectTestCommand(empty)).toBeNull();
  expect(hasTestSignal(empty)).toBe(false);
});

test("P4 testCommand 配置覆盖探测：.bunbot.json 指定 npm test 优先", () => {
  const base = join(tmp, "cfg-proj");
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, "Cargo.toml"), "[package]\nname = \"cfg\"\n");
  writeFileSync(join(base, CONFIG_FILE), JSON.stringify({ testCommand: "npm test -- --run" }));
  const d = detectTestCommand(base)!;
  expect(d.command).toEqual(["npm", "test", "--", "--run"]);
  expect(d.hint).toContain("testCommand");
});

test("P4 runTestGate 实际执行探测到的命令（bun 项目通过 / 失败），输出带命令说明", async () => {
  const base = join(tmp, "exec-proj");
  mkdirSync(join(base, "tests"), { recursive: true });
  writeFileSync(join(base, "package.json"), JSON.stringify({ name: "exec", private: true }));
  writeFileSync(join(base, "tests", "ok.test.ts"), "import { test, expect } from 'bun:test';\ntest('ok', () => expect(1).toBe(1));\n");
  // 通过
  const g1 = await runTestGate({ base });
  expect(g1.passed).toBe(true);
  expect(g1.output).toContain("测试命令: bun test");
  expect(g1.output).toContain("package.json");
  // 失败（写坏测试文件）
  writeFileSync(join(base, "tests", "broken.test.ts"), "this is not valid ts (((\n");
  const g2 = await runTestGate({ base });
  expect(g2.passed).toBe(false);
  expect(g2.exitCode).not.toBe(0);
  // 无信号：跳过不误报
  const empty = join(tmp, "no-signal");
  mkdirSync(empty, { recursive: true });
  const g3 = await runTestGate({ base: empty });
  expect(g3.passed).toBe(true);
  expect(g3.output).toContain("无测试信号");
});
