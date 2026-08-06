/**
 * p4-bootstrap.test.ts — 编译产物自举（自带运行时）
 *
 * 验证：
 *   1. run_script 改为 spawn 自身（process.execPath）：源码时=bun，脚本由同一运行时执行
 *   2. 入口 `run <script>` 隐藏子命令：编译产物作为自带运行时执行外部脚本
 *      （顶层 await + Bun API + argv 透传；拦截在 API key 检查之前，无需 key）
 *   3. 错误脚本：exitCode 1 + stderr 有报错（catch 打 e.stack）
 *
 * 背景：`bun build --compile` 产物内嵌完整 Bun 运行时，但 run_script 若 spawn
 * PATH 里的 `bun`，无 bun 环境的用户机器会失败（bun: command not found）。
 * 解法：run_script spawn 自身（process.execPath：源码时=bun、编译时=编译产物），
 * 编译产物走 `./bun-bot run <script>` 子命令（index.ts 拦截）用内嵌运行时执行。
 *
 * 运行：bun test
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool } from "../src/tools";

const INDEX = join(import.meta.dir, "..", "index.ts");

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "bun-bot-boot-"));
  process.env.BUN_BOT_WORKSPACE = tmp;
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.BUN_BOT_WORKSPACE;
});

/** spawn 入口 index.ts，传 run 子命令（模拟编译产物 `./bun-bot run <script>`） */
async function runEntry(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([process.execPath, "run", INDEX, ...args], { cwd: tmp, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

test("run_script 改为 spawn 自身（process.execPath）：脚本由同一运行时执行", async () => {
  // 源码开发时 process.execPath = bun → spawn [bun, "run", file] 与旧实现等价；
  // 断言子进程 execPath 与父进程一致（即 spawn 的就是自身运行时）
  const r = await executeTool("run_script", JSON.stringify({
    code: "console.log('same-runtime=' + (process.execPath === " + JSON.stringify(process.execPath) + "));",
  }));
  const out = JSON.parse(r);
  expect(out.exitCode).toBe(0);
  expect(out.stdout).toContain("same-runtime=true");
});

test("入口 run 子命令：编译产物作为自带运行时执行外部脚本（顶层 await + Bun API + argv 透传）", async () => {
  const script = join(tmp, "self-boot.ts");
  writeFileSync(script, [
    "await Bun.write('self-boot.txt', 'written by embedded runtime');",
    "console.log('self-boot:' + (20 + 22));",
    "console.log('file:' + (await Bun.file('self-boot.txt').text()));",
    // import() 在宿主进程内执行 → 脚本共享宿主 argv：[..., "run", <script>]（argv[2]=run、argv[3]=script）
    "console.log('argv3=' + process.argv[3]);",
  ].join("\n"));
  const r = await runEntry(["run", script]);
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("self-boot:42");
  expect(r.stdout).toContain("file:written by embedded runtime");
  expect(r.stdout).toContain("argv3=" + script);
  expect(r.stderr).toBe("");
});

test("入口 run 子命令：错误脚本 exitCode 1 + stderr 有报错（catch 打堆栈）", async () => {
  const script = join(tmp, "self-boot-err.ts");
  writeFileSync(script, "throw new Error('boom from script');");
  const r = await runEntry(["run", script]);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain("boom from script");
});
