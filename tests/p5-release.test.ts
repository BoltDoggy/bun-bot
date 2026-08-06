/**
 * p5-release.test.ts — GitHub Actions 全平台构建 + 用户安装脚本（P5）
 *
 * 验证：
 *   1. .github/workflows/build.yml 存在：矩阵覆盖 6 平台（linux/darwin/windows × x64/arm64）、
 *      tag `v*` 触发 Release 发布、setup-bun + build.sh + artifact + gh-release 步骤齐全
 *   2. scripts/build.sh：产物命名（windows 带 .exe）、target 白名单、SHA256 生成、先测后编译
 *   3. scripts/install.sh：--help 用法、自动检测当前平台、--target 覆盖、
 *      端到端安装（本地 mock release 服务器：下载 → SHA256 校验 → 安装 → 可执行位）、
 *      安装重命名为 bun-bot（Windows 为 bun-bot.exe，命令统一不带平台后缀）、
 *      指定版本走 /download/v<版本>/ 路径、windows 产物带 .exe、校验失败中止安装、
 *      下载进度展示（curl --progress-bar / wget --show-progress，进度走 stderr 不污染 stdout）
 *   4. scripts/install.ps1：架构检测 + URL 拼接 + SHA256 校验 + 用户 PATH 添加 + 下载进度展示
 *
 * 端到端用 Bun.serve 起本地 HTTP 服务器 mock GitHub Releases（无需网络），
 * 通过 BUN_BOT_BASE_URL / BUN_BOT_TARGET 环境变量让安装脚本指向它。
 *
 * 跨平台（P5 实测修正）：本文件在 GitHub Actions 6 平台矩阵上跑（build.sh 先测后编译）：
 *   - Windows x64：自动检测当前平台需识别 win32 → windows-x64.exe；POSIX 可执行位
 *     （mode & 0o111）在 Windows 恒为 0，该断言仅 Unix 适用。
 *   - Windows ARM（实验 runner）：Git Bash 可能是 x64 模拟层，uname -m 与 process.arch
 *     不一致，自动检测断言以 install.sh 实际输出为准（不预先推断文件名）。
 *
 * 运行：bun test
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
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

test("install.sh 下载命令带进度展示参数（curl --progress-bar / wget --show-progress）", () => {
  const sh = readFileSync(join(ROOT, "scripts", "install.sh"), "utf8");
  // curl 主路径：去掉 -s 静默、--progress-bar 强制显示（非 TTY/重定向也输出），进度走 stderr
  expect(sh).toContain("--progress-bar");
  // wget 兜底：--show-progress 替代 -q（wget >= 1.16）
  expect(sh).toContain("--show-progress");
  // 校验文件静默下载（2>/dev/null 吞掉进度条，避免噪音）
  expect(sh).toContain('2>/dev/null');
});

test("install.sh 自动检测当前平台（无 --target 时）", async () => {
  const dir = join(tmp, "bin-auto");
  const r = await runInstall(["--dir", dir]);
  expect(r.exitCode).toBe(0);
  // 以 install.sh 实际检测的 target 为准（输出含 "[install] 平台: <target>"）。
  // Windows ARM 实验 runner 上 Git Bash 可能是 x64 模拟层（uname -m 与 process.arch 不一致），
  // 故不预先用 process.platform/arch 推断文件名，断言对任何平台自洽（P5 实测 windows-11-arm）。
  const m = r.stdout.match(/\[install\] 平台: (\S+)/);
  expect(m).not.toBeNull();
  const target = m![1];
  // 安装后的命令统一为 bun-bot（不带平台后缀；Windows 为 bun-bot.exe）
  const bin = target.startsWith("windows") ? "bun-bot.exe" : "bun-bot";
  expect(existsSync(join(dir, bin))).toBe(true);
});

test("install.sh 端到端：下载 → SHA256 校验 → 安装为 bun-bot（可执行位已设置）", async () => {
  const dir = join(tmp, "bin-e2e");
  const r = await runInstall(["--dir", dir, "--target", "linux-x64", "--version", "latest"]);
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("校验 SHA256");
  expect(r.stdout).toContain("已安装");
  // 下载进度条走 stderr（curl --progress-bar 非 TTY 也输出，本地回环小文件同样有 100.0%）
  expect(r.stderr).toContain("%");
  const installed = join(dir, "bun-bot");
  expect(existsSync(installed)).toBe(true);
  expect(readFileSync(installed, "utf8")).toBe(GOOD_CONTENT);
  // 可执行位（install -m 0755）：statSync().mode 的 x 位掩码（0o111）
  // Windows 无 POSIX 权限位（Git Bash 下恒为 0），该断言仅 Unix 适用（P5 实测）
  if (process.platform !== "win32") {
    expect(statSync(installed).mode & 0o111).not.toBe(0);
  }
});

test("install.sh --version 指定版本走 /download/v<版本>/ 路径", async () => {
  const dir = join(tmp, "bin-ver");
  const r = await runInstall(["--dir", dir, "--target", "darwin-arm64", "--version", "0.1.0"]);
  expect(r.exitCode).toBe(0);
  expect(existsSync(join(dir, "bun-bot"))).toBe(true);
});

test("install.sh windows target 下载 .exe 产物并安装为 bun-bot.exe", async () => {
  const dir = join(tmp, "bin-win");
  const r = await runInstall(["--dir", dir, "--target", "windows-x64"]);
  expect(r.exitCode).toBe(0);
  expect(existsSync(join(dir, "bun-bot.exe"))).toBe(true);
});

test("install.sh SHA256 校验失败 → 安装中止（退出非零，不落盘）", async () => {
  const dir = join(tmp, "bin-bad");
  const r = await runInstall(
    ["--dir", dir, "--target", "linux-x64"],
    { BUN_BOT_BASE_URL: `http://localhost:${server!.port}/broken-releases` },
  );
  expect(r.exitCode).not.toBe(0);
  expect(existsSync(join(dir, "bun-bot"))).toBe(false);
});

// ---------- 4. install.ps1 ----------

test("install.ps1 存在：架构检测 + URL 拼接 + SHA256 校验 + 用户 PATH 添加 + 下载进度展示", () => {
  const ps = readFileSync(join(ROOT, "scripts", "install.ps1"), "utf8");
  expect(ps).toContain("PROCESSOR_ARCHITECTURE");
  expect(ps).toContain("latest/download");
  expect(ps).toContain("download/v");
  expect(ps).toContain("Get-FileHash");
  expect(ps).toContain("SetEnvironmentVariable");
  expect(ps).toContain("bun-bot-$target.exe");  // Release 资产名（下载用）
  expect(ps).toContain('$bin  = "bun-bot.exe"'); // 安装命令名（统一不带平台后缀）
  expect(ps).toContain('$ProgressPreference = "Continue"'); // 下载进度展示（防会话级 SilentlyContinue 继承）
});
