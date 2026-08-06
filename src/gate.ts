/**
 * gate.ts — 测试闸门（P3-2：verify its work，改完自测，失败自动回滚）
 *
 * 对齐 learn 的 verify its work：给 agent 能跑出 pass/fail 的验证信号。
 * 主循环收尾（assistant 无 tool_calls 准备结束）时，若本会话发生过自修改
 * （write_file / 写操作 run_bash），自动跑测试闸门：
 *   1. runTestGate()  在工作区跑 `bun test`，返回 pass/fail + 输出
 *   2. 失败 → revertToHead(sessionStartHead) 回滚到会话开始前的 HEAD，
 *      并 git clean -fd 清掉未跟踪新文件（gitignore 文件如 AGENT_STATE.json
 *      不受影响，保证记忆/checkpoint 不丢）
 *   3. 回滚后再跑一次测试确认项目可继续跑
 *
 * 触发条件（主循环判断）：didModify && isGitRepo && 有测试信号
 * （存在 package.json 或 tests/ 目录 —— 非 bun 项目没有可跑的验证信号就跳过）。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isGitRepo, currentHead } from "./git";
import { workspace } from "./memory";
import { DEFAULT_TIMEOUT_MS } from "./tools";

export interface TestGateResult {
  /** 测试是否通过（exitCode === 0） */
  passed: boolean;
  exitCode: number;
  /** 测试输出摘要（截断） */
  output: string;
  timedOut: boolean;
}

/** 项目是否有可跑的测试信号（package.json 或 tests/ 目录） */
export function hasTestSignal(base = workspace()): boolean {
  return existsSync(join(base, "package.json")) || existsSync(join(base, "tests"));
}

/**
 * 跑测试闸门：在工作区执行 `bun test`（超时可配）。
 * 返回 pass/fail + 截断输出。非 bun 项目（无测试信号）返回 passed=true + 说明（跳过）。
 */
export async function runTestGate(opts: { base?: string; timeoutMs?: number } = {}): Promise<TestGateResult> {
  const base = opts.base ?? workspace();
  const timeoutMs = opts.timeoutMs ?? 120_000; // 测试闸门给足时间
  if (!hasTestSignal(base)) {
    return { passed: true, exitCode: 0, output: "（无测试信号：无 package.json / tests/，测试闸门跳过）", timedOut: false };
  }
  const proc = Bun.spawn(["bun", "test"], {
    cwd: base,
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  const output = (stdout + "\n" + stderr).trim();
  return { passed: exitCode === 0 && !timedOut, exitCode, output, timedOut };
}

export interface RevertResult {
  reverted: boolean;
  /** 回滚动作摘要（reset --hard 目标 + clean 统计） */
  output: string;
}

/**
 * 回滚到指定 HEAD：`git reset --hard <head>` + `git clean -fd`。
 * - reset --hard 恢复所有跟踪文件（丢弃会话内的全部改动，含 write_file 快照提交）
 * - git clean -fd 删除未跟踪新文件（-fd 不删 gitignore 文件：AGENT_STATE.json /
 *   MEMORY.md / AGENT_CHECKPOINT.json / AUDIT.log.jsonl 等本地状态不丢）
 * @returns 是否成功回滚 + 摘要
 */
export async function revertToHead(head: string, base = workspace()): Promise<RevertResult> {
  if (!isGitRepo(base)) return { reverted: false, output: "非 git 仓库，无法回滚" };
  const run = async (args: string[]): Promise<string> => {
    const proc = Bun.spawn(["git", ...args], { cwd: base, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    return (stderr.trim() || stdout.trim());
  };
  const reset = await run(["reset", "--hard", head]);
  const clean = await run(["clean", "-fd"]);
  return { reverted: true, output: "git reset --hard " + head.slice(0, 8) + " → " + reset + "；git clean -fd → " + clean };
}

/**
 * 一步到位的测试闸门流程（主循环收尾用）：
 *   跑测试 → 通过返回 { passed: true }；失败自动回滚到 sessionStartHead
 *   并再跑一次测试确认项目可继续跑。
 * @returns 结果摘要（passed = 最终状态；rolledBack = 是否发生了回滚）
 */
export async function enforceTestGate(
  sessionStartHead: string | null,
  opts: { base?: string; timeoutMs?: number } = {},
): Promise<{ passed: boolean; rolledBack: boolean; output: string }> {
  const base = opts.base ?? workspace();
  const gate = await runTestGate(opts);
  if (gate.passed) {
    return { passed: true, rolledBack: false, output: gate.output };
  }
  // 测试失败：尝试回滚到会话开始前的 HEAD
  if (!sessionStartHead || !isGitRepo(base)) {
    return { passed: false, rolledBack: false, output: gate.output };
  }
  const rev = await revertToHead(sessionStartHead, base);
  const verify = await runTestGate(opts);
  return {
    passed: verify.passed,
    rolledBack: true,
    output:
      "测试闸门：测试失败（exitCode " + gate.exitCode + "），已自动回滚到会话开始前的 HEAD。\n" +
      rev.output + "\n" +
      "回滚后复测 " + (verify.passed ? "通过 ✅" : "仍失败 ❌（问题可能与会话前状态有关）") + "\n" +
      "--- 失败输出（前 2000 字符）---\n" + gate.output.slice(0, 2000),
  };
}
