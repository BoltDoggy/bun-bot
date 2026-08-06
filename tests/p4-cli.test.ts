/**
 * p4-cli.test.ts — P4 通用化：CLI 分发与 init（第 6 项）
 *
 * 验证：
 *   1. package.json 声明 bin（bun-bot）→ bun link / bunx 可分发
 *   2. `bun-bot --version / -v` 输出版本号
 *   3. `bun-bot --help / -h` 输出用法；无参数打印 help 且退出码非 0
 *   4. `bun-bot init` 生成 AGENTS.md 模板 + .bunbot.json + .gitignore 条目（幂等）
 *   5. init 不覆盖已有 AGENTS.md（用户指令保留）
 *
 * 运行：bun test
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIN = join(import.meta.dir, "..", "bin", "bun-bot.ts");

async function runBin(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", BIN, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "bun-bot-p4-cli-"));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

test("P4 package.json 声明 bin（bun-bot → bin/bun-bot.ts），可 bun link / bunx 分发", () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"));
  expect(pkg.bin).toBeDefined();
  expect(pkg.bin["bun-bot"]).toBe("./bin/bun-bot.ts");
  expect(existsSync(join(import.meta.dir, "..", "bin", "bun-bot.ts"))).toBe(true);
});

test("P4 CLI --version / -v 输出版本号", async () => {
  const r = await runBin(["--version"], tmp);
  expect(r.exitCode).toBe(0);
  expect(r.stdout.trim()).toBe("bun-bot v0.1.0");
  const r2 = await runBin(["-v"], tmp);
  expect(r2.exitCode).toBe(0);
  expect(r2.stdout.trim()).toBe("bun-bot v0.1.0");
});

test("P4 CLI --help 输出用法；无参数打印 help 且退出码非 0", async () => {
  const r = await runBin(["--help"], tmp);
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("bun-bot v");
  expect(r.stdout).toContain("init");
  expect(r.stdout).toContain("--version");
  const r2 = await runBin([], tmp);
  expect(r2.exitCode).toBe(1);
  expect(r2.stdout).toContain("用法:");
});

test("P4 CLI init 生成 AGENTS.md + .bunbot.json + .gitignore 条目（幂等）", async () => {
  const proj = join(tmp, "init-proj");
  mkdirSync(proj, { recursive: true });
  const r = await runBin(["init"], proj);
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("bun-bot init 完成");
  expect(r.stdout).toContain("AGENTS.md");
  expect(r.stdout).toContain(".bunbot.json");
  expect(r.stdout).toContain(".gitignore");
  // 文件内容
  expect(existsSync(join(proj, "AGENTS.md"))).toBe(true);
  expect(readFileSync(join(proj, "AGENTS.md"), "utf8")).toContain("项目级指令");
  expect(existsSync(join(proj, ".bunbot.json"))).toBe(true);
  expect(readFileSync(join(proj, ".bunbot.json"), "utf8")).toContain("deepseek-v4-flash");
  const gi = readFileSync(join(proj, ".gitignore"), "utf8");
  expect(gi).toContain(".bunbot/");
  // 幂等：再跑一次不重复生成/追加
  const r2 = await runBin(["init"], proj);
  expect(r2.exitCode).toBe(0);
  expect(r2.stdout).toContain("无需改动");
  const gi2 = readFileSync(join(proj, ".gitignore"), "utf8");
  expect(gi2.split("\n").filter((l) => l.trim() === ".bunbot/").length).toBe(1);
});

test("P4 CLI init 不覆盖已有 AGENTS.md（用户指令保留）", async () => {
  const proj = join(tmp, "init-existing");
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, "AGENTS.md"), "# 用户已有指令\n");
  const r = await runBin(["init"], proj);
  expect(r.exitCode).toBe(0);
  expect(readFileSync(join(proj, "AGENTS.md"), "utf8")).toBe("# 用户已有指令\n");
  expect(r.stdout).not.toContain("AGENTS.md");
  // 其他文件照常生成
  expect(existsSync(join(proj, ".bunbot.json"))).toBe(true);
  expect(existsSync(join(proj, ".gitignore"))).toBe(true);
});
