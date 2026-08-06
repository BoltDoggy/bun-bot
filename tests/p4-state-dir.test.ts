/**
 * p4-state-dir.test.ts — P4 通用化：状态文件不污染目标仓库（第 4 项）
 *
 * 验证：
 *   1. 状态文件默认移入 .bunbot/（statePath / memoryPath / checkpointPath / auditPath）
 *   2. 模拟 git 仓库跑一轮：写状态文件后 .gitignore 自动追加忽略 → git status 无状态文件噪音
 *   3. 旧位置（工作区根）状态文件兼容读取（迁移读取不自动删除）
 *   4. stateDir 可配置（.bunbot.json 的 stateDir 生效）
 *
 * 运行：bun test
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  workspace, stateDir, statePath, memoryPath, checkpointPath,
  saveState, loadState, syncMemoryFile, saveCheckpoint, loadCheckpoint,
} from "../src/memory";
import { auditPath, appendAudit } from "../src/audit";
import { loadConfig, CONFIG_FILE } from "../src/config";
import { executeTool } from "../src/tools";

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "bun-bot-p4-state-"));
  process.env.BUN_BOT_WORKSPACE = tmp;
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.BUN_BOT_WORKSPACE;
});

test("P4 状态文件默认移入 .bunbot/ 目录", () => {
  expect(stateDir()).toBe(join(tmp, ".bunbot"));
  expect(statePath()).toBe(join(tmp, ".bunbot", "AGENT_STATE.json"));
  expect(memoryPath()).toBe(join(tmp, ".bunbot", "MEMORY.md"));
  expect(checkpointPath()).toBe(join(tmp, ".bunbot", "AGENT_CHECKPOINT.json"));
  expect(auditPath()).toBe(join(tmp, ".bunbot", "AUDIT.log.jsonl"));
  // 写一轮状态 → 全部落在 .bunbot/ 下，工作区根无噪音
  const s = loadState();
  s.lastTask = "状态目录测试";
  saveState(s);
  syncMemoryFile(s);
  saveCheckpoint([{ role: "user", content: "hi" }]);
  appendAudit({ ts: "2026-08-06T00:00:00.000Z", round: 1, tool: "run_script", args: "x", result: "y" });
  expect(existsSync(statePath())).toBe(true);
  expect(existsSync(memoryPath())).toBe(true);
  expect(existsSync(checkpointPath())).toBe(true);
  expect(existsSync(auditPath())).toBe(true);
  expect(existsSync(join(tmp, "AGENT_STATE.json"))).toBe(false);
  expect(existsSync(join(tmp, "MEMORY.md"))).toBe(false);
  // 读回
  expect(loadState().lastTask).toBe("状态目录测试");
  expect(loadCheckpoint()![0].content).toBe("hi");
});

test("P4 模拟 git 仓库跑一轮：.gitignore 自动忽略状态目录，git status 无状态文件噪音", async () => {
  const base = join(tmp, "git-proj");
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, "README.md"), "# git proj\n");
  const oldWs = process.env.BUN_BOT_WORKSPACE;
  process.env.BUN_BOT_WORKSPACE = base;
  try {
    // git init + 初始 commit（干净基线）
    const init = JSON.parse(await executeTool("run_bash", JSON.stringify({
      command: "git init -q && git config user.email p4@test && git config user.name p4-test && git add -A && git commit -qm init",
    })));
    expect(init.exitCode).toBe(0);
    // 跑一轮状态写入（模拟一次会话）
    const s = loadState();
    s.lastTask = "git 仓库一轮";
    saveState(s);
    syncMemoryFile(s);
    saveCheckpoint([{ role: "user", content: "x" }]);
    appendAudit({ ts: "2026-08-06T00:00:00.000Z", round: 1, tool: "read_file", args: "a", result: "b" });
    // .gitignore 自动追加 .bunbot/ 忽略规则
    const gi = readFileSync(join(base, ".gitignore"), "utf8");
    expect(gi).toContain(".bunbot/");
    // git status：状态文件噪音为零（.bunbot/ 与状态文件名不出现）；仅 .gitignore 新增
    const st = JSON.parse(await executeTool("run_bash", JSON.stringify({ command: "git status --porcelain" })));
    expect(st.exitCode).toBe(0);
    expect(st.stdout).not.toContain(".bunbot/");
    expect(st.stdout).not.toContain("AGENT_STATE");
    expect(st.stdout).not.toContain("MEMORY.md");
    expect(st.stdout).not.toContain("AUDIT");
    expect(st.stdout.trim()).toBe("?? .gitignore");
    // 状态文件确实在 .bunbot/ 下
    expect(existsSync(join(base, ".bunbot", "AGENT_STATE.json"))).toBe(true);
    expect(existsSync(join(base, "AGENT_STATE.json"))).toBe(false);
    // 固化 .gitignore（run_bash 写操作前自动快照可能已提交它，允许 nothing to commit）
    await executeTool("run_bash", JSON.stringify({
      command: "git add .gitignore; git commit -qm ignore-state 2>/dev/null || true",
    }));
    // 最终 git status 完全干净（无任何状态文件噪音）
    const done = JSON.parse(await executeTool("run_bash", JSON.stringify({ command: "git status --porcelain" })));
    expect(done.exitCode).toBe(0);
    expect(done.stdout.trim()).toBe("");
  } finally {
    process.env.BUN_BOT_WORKSPACE = oldWs!;
  }
});

test("P4 旧位置兼容：工作区根的状态文件可被读取（迁移读取不自动删除）", () => {
  const base = join(tmp, "legacy-proj");
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, "AGENT_STATE.json"), JSON.stringify({ version: 1, lastTask: "legacy 任务" }));
  const oldWs = process.env.BUN_BOT_WORKSPACE;
  process.env.BUN_BOT_WORKSPACE = base;
  try {
    const s = loadState();
    expect(s.lastTask).toBe("legacy 任务");
    // 旧文件保留（不自动删除，由用户决定迁移）
    expect(existsSync(join(base, "AGENT_STATE.json"))).toBe(true);
    expect(workspace()).toBe(base);
  } finally {
    process.env.BUN_BOT_WORKSPACE = oldWs!;
  }
});

test("P4 stateDir 可配置：.bunbot.json 的 stateDir 生效", () => {
  const base = join(tmp, "custom-state");
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, CONFIG_FILE), JSON.stringify({ stateDir: ".agent-data" }));
  const oldWs = process.env.BUN_BOT_WORKSPACE;
  process.env.BUN_BOT_WORKSPACE = base;
  try {
    expect(loadConfig(base).stateDir).toBe(".agent-data");
    expect(stateDir()).toBe(join(base, ".agent-data"));
    const s = loadState();
    s.lastTask = "自定义状态目录";
    saveState(s);
    expect(existsSync(join(base, ".agent-data", "AGENT_STATE.json"))).toBe(true);
    expect(existsSync(join(base, ".bunbot"))).toBe(false);
  } finally {
    process.env.BUN_BOT_WORKSPACE = oldWs!;
  }
});
