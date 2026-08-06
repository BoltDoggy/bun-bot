/**
 * git.ts — 自修改前的安全快照（M1 简化版 + P3-1 run_bash 安全阀）
 *
 * 完整的安全阀（自动 revert、测试闸门）属于 P3（src/gate.ts）。
 * 这里提供：
 *   - write_file 落盘前 `git add -A && git commit` 打一个快照（M1）
 *   - run_bash 执行"写操作"命令前，若工作区有未提交改动先固化（P3-1），
 *     保证 agent 用 shell 直接改文件（sed -i / git commit / bun install 等）也可回滚。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { workspace } from "./memory";

export function isGitRepo(base = workspace()): boolean {
  return existsSync(join(base, ".git"));
}

async function runGit(base: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: base,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return (stderr.trim() || stdout.trim());
}

/**
 * 在工作区打一个快照提交。
 * @returns 人类可读的快照信息（非 git 仓库时返回提示）
 */
export async function snapshot(reason: string, base = workspace()): Promise<string> {
  if (!isGitRepo(base)) return "非 git 仓库，跳过自动快照";
  const branch = (await runGit(base, ["branch", "--show-current"])).trim();
  await runGit(base, ["add", "-A"]);
  const commit = await runGit(base, ["commit", "-m", "bun-bot 快照（修改前）: " + reason]);
  const m = commit.match(/\[([^\]]+)\]/);
  return "已提交 git 快照 [" + (m ? m[1] : commit.slice(0, 60)) + "]";
}

/** 工作区是否有未提交改动（含未跟踪文件）；非 git 仓库返回 false */
export async function hasUncommittedChanges(base = workspace()): Promise<boolean> {
  if (!isGitRepo(base)) return false;
  const out = await runGit(base, ["status", "--porcelain"]);
  return out.trim().length > 0;
}

/**
 * P3-1：run_bash 等工具执行前调用 —— 工作区有未提交改动时先打快照固化（可回滚）。
 * @returns 快照信息；没有未提交改动或非 git 仓库时返回 null（不产生噪音提交）
 */
export async function snapshotIfDirty(reason: string, base = workspace()): Promise<string | null> {
  if (await hasUncommittedChanges(base)) {
    return await snapshot(reason, base);
  }
  return null;
}

/** 当前 HEAD commit hash；非 git 仓库返回 null */
export async function currentHead(base = workspace()): Promise<string | null> {
  if (!isGitRepo(base)) return null;
  const out = await runGit(base, ["rev-parse", "HEAD"]);
  const hash = out.trim();
  return /^[0-9a-f]{40}$/.test(hash) ? hash : null;
}
