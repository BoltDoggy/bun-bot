/**
 * p4-readonly.test.ts — P4 通用化：只读模式与权限细化（第 7 项）
 *
 * 验证：
 *   1. BUN_BOT_PERMISSIONS=readonly：write_file 返回 error 且未落盘
 *   2. readonly：run_bash 写操作命令被拒，只读命令放行
 *   3. readonly：update_plan 返回 error
 *   4. readonly：read_file / run_script（沙箱）正常
 *   5. ask 模式白名单：.bunbot.json allowCommands 命中放行，未命中拒绝
 *
 * 运行：bun test
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool } from "../src/tools";
import { workspace } from "../src/memory";
import { CONFIG_FILE } from "../src/config";

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "bun-bot-p4-ro-"));
  process.env.BUN_BOT_WORKSPACE = tmp;
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.BUN_BOT_WORKSPACE;
  delete process.env.BUN_BOT_PERMISSIONS;
});

test("P4 readonly：write_file 返回 error 且未落盘", async () => {
  process.env.BUN_BOT_PERMISSIONS = "readonly";
  try {
    const r = JSON.parse(await executeTool("write_file", JSON.stringify({
      path: "ro-write.txt", content: "should not persist",
    })));
    expect(r.error).toContain("readonly");
    expect(existsSync(join(tmp, "ro-write.txt"))).toBe(false);
  } finally {
    delete process.env.BUN_BOT_PERMISSIONS;
  }
});

test("P4 readonly：run_bash 写操作被拒、只读命令放行", async () => {
  process.env.BUN_BOT_PERMISSIONS = "readonly";
  try {
    const w = JSON.parse(await executeTool("run_bash", JSON.stringify({ command: "touch ro-touch.txt" })));
    expect(w.error).toContain("readonly");
    expect(w.exitCode).toBeUndefined(); // 未真正执行
    expect(existsSync(join(tmp, "ro-touch.txt"))).toBe(false);
    const ro = JSON.parse(await executeTool("run_bash", JSON.stringify({ command: "pwd" })));
    expect(ro.exitCode).toBe(0);
    // 只读命令放行（ls 不含写操作关键字）
    const ro2 = JSON.parse(await executeTool("run_bash", JSON.stringify({ command: "ls" })));
    expect(ro2.exitCode).toBe(0);
  } finally {
    delete process.env.BUN_BOT_PERMISSIONS;
  }
});

test("P4 readonly：update_plan 返回 error", async () => {
  process.env.BUN_BOT_PERMISSIONS = "readonly";
  try {
    const r = JSON.parse(await executeTool("update_plan", JSON.stringify({
      items: [{ text: "x", done: false }],
    })));
    expect(r.error).toContain("readonly");
  } finally {
    delete process.env.BUN_BOT_PERMISSIONS;
  }
});

test("P4 readonly：read_file / run_script 沙箱正常", async () => {
  writeFileSync(join(tmp, "ro-read.txt"), "readable");
  process.env.BUN_BOT_PERMISSIONS = "readonly";
  try {
    const rf = JSON.parse(await executeTool("read_file", JSON.stringify({ path: "ro-read.txt" })));
    expect(rf.content).toBe("readable");
    const rs = JSON.parse(await executeTool("run_script", JSON.stringify({ code: "console.log(1+1)" })));
    expect(rs.exitCode).toBe(0);
    expect(rs.stdout.trim()).toBe("2");
    // list_dir 也正常
    const ld = JSON.parse(await executeTool("list_dir", JSON.stringify({ path: "." })));
    expect(ld.tree).toContain("ro-read.txt");
  } finally {
    delete process.env.BUN_BOT_PERMISSIONS;
  }
});

test("P4 ask 白名单：.bunbot.json allowCommands 命中放行、未命中拒绝", async () => {
  // 配置文件声明 ask + 白名单（不用环境变量，验证配置生效）
  writeFileSync(join(tmp, CONFIG_FILE), JSON.stringify({ permissions: "ask", allowCommands: ["touch allowed.txt"] }));
  delete process.env.BUN_BOT_PERMISSIONS;
  try {
    // 命中白名单 → 放行
    const ok = JSON.parse(await executeTool("run_bash", JSON.stringify({ command: "touch allowed.txt" })));
    expect(ok.exitCode).toBe(0);
    expect(existsSync(join(tmp, "allowed.txt"))).toBe(true);
    // 未命中白名单 → 拒绝
    const no = JSON.parse(await executeTool("run_bash", JSON.stringify({ command: "touch denied.txt" })));
    expect(no.error).toContain("权限模式 ask");
    expect(existsSync(join(tmp, "denied.txt"))).toBe(false);
  } finally {
    rmSync(join(tmp, CONFIG_FILE));
  }
});
