/**
 * git.ts — 自修改前的安全快照（M1 简化版）
 *
 * 完整的安全阀（自动 revert、测试闸门）属于 P3。M1 先落地最关键的：
 * 任何 write_file 落盘前先 `git add -A && git commit` 打一个快照，
 * 保证修改可回溯。
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
