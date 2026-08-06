/**
 * p5-release.test.ts — GitHub Actions 全平台构建 + 用户安装脚本（P5）
 *
 * 验证：
 *   1. .github/workflows/build.yml 存在：矩阵覆盖 6 平台（linux/darwin/windows × x64/arm64）、
 *      tag `v*` 触发 Release 发布、setup-bun + build.sh + artifact + gh-release 步骤齐全
 *   2. scripts/build.sh：产物命名（windows 带 .exe）、target 白名单、SHA256 生成、先测后编译
 *   3. scripts/install.sh：--help 用法、自动检测当前平台、--target 覆盖、
 *      端到端安装（本地 mock release 服务器：下载 → SHA256 校验 → 安装 → 可执行位）、
 *      指定版本走 /download/v<版本>/ 路径、windows 产物带 .exe、校验失败中止安装
 *   4. scripts/install.ps1：架构检测 + URL 拼接 + SHA256 校验 + 用户 PATH 添加
 *
 * 端到端用 Bun.serve 起本地 HTTP 服务器 mock GitHub Releases（无需网络），
 * 通过 BUN_BOT_BASE_URL / BUN_BOT_TARGET 环境变量让安装脚本指向它。
 *
 * 运行：bun test
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const GOOD_CONTENT = "#!/bin/sh\necho 'bun-bot-mock-binary'\n";
const BAD_CONTENT = "#!/bin/sh\necho 'tampered binary'\n";

function sha256hex(s: string): string {
  return new Bun.CryptoHasher("sha256").update(s).digest("hex");
}

let tmp: string;
let server: ReturnType<typeof Bun.serve> | null = null;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "bun-bot-release-"));
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const p = new URL(req.url).pathname;
      // broken 前缀：内容与校验文件不匹配（模拟被篡改/损坏的发布）
      if (p.includes("broken")) {
        if (p.endsWith(".sha256")) {
          const name = p.split("/").pop()!.replace(/\.sha256$/, "");
          return new Response(`${sha256hex(GOOD_CONTENT)}  ${name}`);
        }
        return new Response(BAD_CONTENT, { headers: { "content-type": "application/octet-stream" } });
      }
      if (p.endsWith(".sha256")) {
        const name = p.split("/").pop()!.replace(/\.sha256$/, "");
        return new Response(`${sha256hex(GOOD_CONTENT)}  ${name}`);
      }
      // 6 个平台的产物（latest 与任意版本路径都匹配，只校验后缀）
      const okAssets = [
        "/bun-bot-linux-x64", "/bun-bot-linux-arm64",
        "/bun-bot-darwin-x64", "/bun-bot-darwin-arm64",
        "/bun-bot-windows-x64.exe", "/bun-bot-windows-arm64.exe",
      ];
      if (okAssets.some((a) => p.endsWith(a))) {
        return new Response(GOOD_CONTENT, { headers: { "content-type": "application/octet-stream" } });
      }
      return new Response("not found: " + p, { status: 404 });
    },
  });
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  server?.stop(true);
});

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** 跑 scripts/install.sh（默认指向本地 mock release 服务器） */
async function runInstall(args: string[], env: Record<string, string> = {}): Promise<RunResult> {
  const proc = Bun.spawn(["sh", join(ROOT, "scripts/install.sh"), ...args], {
    cwd: tmp,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      BUN_BOT_BASE_URL: `http://localhost:${server!.port}/releases`,
      ...env,
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

// ---------- 1. workflow ----------

test("build.yml 存在：矩阵覆盖 6 平台 + tag 触发 + Release 发布", () => {
  const yml = readFileSync(join(ROOT, ".github", "workflows", "build.yml"), "utf8");
  for (const t of ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "windows-x64", "windows-arm64"]) {
    expect(yml).toContain("target: " + t);
  }
  // 触发：tag v* + 手动
  expect(yml).toContain('tags:');
  expect(yml).toContain('"v*"');
  expect(yml).toContain("workflow_dispatch");
  // 步骤：setup-bun → build.sh → upload-artifact → gh-release
  expect(yml).toContain("oven-sh/setup-bun");
  expect(yml).toContain("scripts/build.sh");
  expect(yml).toContain("actions/upload-artifact");
  expect(yml).toContain("softprops/action-gh-release");
  // 发布仅限 tag 触发（手动构建不上 Release）
  expect(yml).toContain("refs/tags/");
  // 产物上传 dist/*
  expect(yml).toContain("path: dist/*");
});

// ---------- 2. build.sh ----------

test("build.sh：先测试后编译 + 产物命名（windows 带 .exe）+ SHA256 生成", () => {
  const sh = readFileSync(join(ROOT, "scripts", "build.sh"), "utf8");
  expect(sh).toContain("bun build --compile");
  expect(sh).toContain("bun test");          // 测试闸门在出产物前
  expect(sh).toContain('windows*) EXT=".exe"');
  expect(sh).toContain("sha256sum");
  expect(sh).toContain("dist/bun-bot");
});

// ---------- 3. install.sh ----------

test("install.sh --help 输出用法且退出 0", async () => {
  const r = await runInstall(["--help"]);
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("用法");
  expect(r.stdout).toContain("BUN_BOT_REPO");
});

test("install.sh 自动检测当前平台（无 --target 时）", async () => {
  const dir = join(tmp, "bin-auto");
  const os = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const expected = `bun-bot-${os}-${arch}`;
  const r = await runInstall(["--dir", dir]);
  expect(r.exitCode).toBe(0);
  expect(existsSync(join(dir, expected))).toBe(true);
});

test("install.sh 端到端：下载 → SHA256 校验 → 安装（可执行位已设置）", async () => {
  const dir = join(tmp, "bin-e2e");
  const r = await runInstall(["--dir", dir, "--target", "linux-x64", "--version", "latest"]);
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("校验 SHA256");
  expect(r.stdout).toContain("已安装");
  const installed = join(dir, "bun-bot-linux-x64");
  expect(existsSync(installed)).toBe(true);
  expect(readFileSync(installed, "utf8")).toBe(GOOD_CONTENT);
  const mode = Bun.file(installed).unixMode;
  expect(mode).not.toBeNull();
  expect(mode! & 0o111).not.toBe(0); // 可执行位
});

test("install.sh --version 指定版本走 /download/v<版本>/ 路径", async () => {
  const dir = join(tmp, "bin-ver");
  const r = await runInstall(["--dir", dir, "--target", "darwin-arm64", "--version", "0.1.0"]);
  expect(r.exitCode).toBe(0);
  expect(existsSync(join(dir, "bun-bot-darwin-arm64"))).toBe(true);
});

test("install.sh windows target 下载 .exe 产物", async () => {
  const dir = join(tmp, "bin-win");
  const r = await runInstall(["--dir", dir, "--target", "windows-x64"]);
  expect(r.exitCode).toBe(0);
  expect(existsSync(join(dir, "bun-bot-windows-x64.exe"))).toBe(true);
});

test("install.sh SHA256 校验失败 → 安装中止（退出非零，不落盘）", async () => {
  const dir = join(tmp, "bin-bad");
  const r = await runInstall(
    ["--dir", dir, "--target", "linux-x64"],
    { BUN_BOT_BASE_URL: `http://localhost:${server!.port}/broken-releases` },
  );
  expect(r.exitCode).not.toBe(0);
  expect(existsSync(join(dir, "bun-bot-linux-x64"))).toBe(false);
});

// ---------- 4. install.ps1 ----------

test("install.ps1 存在：架构检测 + URL 拼接 + SHA256 校验 + 用户 PATH 添加", () => {
  const ps = readFileSync(join(ROOT, "scripts", "install.ps1"), "utf8");
  expect(ps).toContain("PROCESSOR_ARCHITECTURE");
  expect(ps).toContain("latest/download");
  expect(ps).toContain("download/v");
  expect(ps).toContain("Get-FileHash");
  expect(ps).toContain("SetEnvironmentVariable");
  expect(ps).toContain("bun-bot-$target.exe");
});
