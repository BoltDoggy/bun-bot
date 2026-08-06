/**
 * p6-stream.test.ts — P6-1 流式输出默认（吸收 research 分支理念）
 *
 * 背景：research 分支把 `--stream` 改为默认开启（流式输出逐 token 打字机效果），
 *       `--no-stream` 关闭改一次性输出。主线 P6-1 落地同一理念。
 *
 * 验证：
 *   1. bin/bun-bot.ts --help 宣传默认 SSE 流式 + --no-stream 开关
 *   2. index.ts（编译产物入口）--help 同样宣传
 *   3. `--no-stream` 被正常解析（不误伤参数分发）：无 API key 时带任务报 key 错误而非用法错误
 *   4. 源码判定逻辑：index.ts 的 STREAM = !args.includes("--no-stream")（防回归）
 *
 * 运行：bun test
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIN = join(import.meta.dir, "..", "bin", "bun-bot.ts");
const INDEX = join(import.meta.dir, "..", "index.ts");

async function runBin(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", BIN, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function runIndex(
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", INDEX, ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "bun-bot-p6-stream-"));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

test("P6-1 bin/bun-bot.ts --help 宣传默认 SSE 流式 + --no-stream 开关", async () => {
  const r = await runBin(["--help"], tmp);
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("--no-stream");
  expect(r.stdout).toContain("默认 SSE 流式输出");
  // 旧 --stream 不再作为开关宣传
  expect(r.stdout).not.toContain("[--stream]");
});

test("P6-1 index.ts（编译产物入口）--help 同样宣传 --no-stream", async () => {
  const r = await runIndex(["--help"], tmp);
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("--no-stream");
  expect(r.stdout).toContain("默认 SSE 流式输出");
});

test("P6-1 --no-stream 被正常解析（无 API key 时报 key 错误而非用法错误）", async () => {
  const noKey = { DEEPSEEK_API_KEY: "" };
  const r = await runIndex(["--no-stream", "随便一个任务"], tmp, noKey);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain("DEEPSEEK_API_KEY");
  expect(r.stderr).not.toContain("用法:");
});

test("P6-1 源码判定逻辑：STREAM = !args.includes(\"--no-stream\")（防回归）", () => {
  const src = readFileSync(INDEX, "utf8");
  expect(src).toContain('const STREAM = !args.includes("--no-stream");');
  // 不再以 --stream 作为开关（历史参数，保留兼容但不作为判定依据）
  expect(src).not.toMatch(/const STREAM = args\.includes\("--stream"\)/);
});
