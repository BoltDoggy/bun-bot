#!/usr/bin/env bash
# build.sh — 构建 bun-bot 编译产物（单平台；本地与 GitHub Actions 矩阵共用）
#
# 用法:
#   bash scripts/build.sh [target]     target ∈ linux-x64|linux-arm64|darwin-x64|darwin-arm64|windows-x64|windows-arm64
#                                      （缺省时自动检测当前平台）
#
# 产物（输出到 dist/）:
#   dist/bun-bot-<target>[.exe]        编译产物（内嵌完整 Bun 运行时，无 bun 环境也能跑）
#   dist/bun-bot-<target>[.exe].sha256 SHA256 校验文件（安装脚本校验用）
#
# 说明: 编译产物自举 —— run_script spawn 自身（process.execPath），编译产物走
# `./bun-bot run <script>` 子命令（index.ts 拦截）用内嵌运行时执行外部脚本。
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  # 自动检测当前平台（与 scripts/install.sh 相同的映射）
  os="$(uname -s)"; arch="$(uname -m)"
  case "$os" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    *) echo "错误：不支持的系统: $os" >&2; exit 1 ;;
  esac
  case "$arch" in
    x86_64|amd64|x64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) echo "错误：不支持的架构: $arch" >&2; exit 1 ;;
  esac
  TARGET="${os}-${arch}"
fi

case "$TARGET" in
  linux-x64|linux-arm64|darwin-x64|darwin-arm64|windows-x64|windows-arm64) ;;
  *) echo "不支持的 target: $TARGET（应为 linux-x64|linux-arm64|darwin-x64|darwin-arm64|windows-x64|windows-arm64）" >&2; exit 1 ;;
esac

EXT=""
case "$TARGET" in windows*) EXT=".exe";; esac
OUT="dist/bun-bot-${TARGET}${EXT}"

echo "[build] target=$TARGET"
# 安装依赖（frozen 优先；lock 缺失时 fallback）
bun install --frozen-lockfile 2>/dev/null || bun install
# 测试闸门：改动后必须全绿再出产物
bun test
# 编译：bun build --compile 产出单文件可执行（内嵌完整 Bun 运行时）
mkdir -p dist
bun build --compile index.ts --outfile "$OUT"
# SHA256 校验文件（与安装脚本 scripts/install.sh / install.ps1 配套）
if command -v sha256sum >/dev/null 2>&1; then
  (cd dist && sha256sum "bun-bot-${TARGET}${EXT}" > "bun-bot-${TARGET}${EXT}.sha256")
else
  (cd dist && shasum -a 256 "bun-bot-${TARGET}${EXT}" > "bun-bot-${TARGET}${EXT}.sha256")
fi
echo "[build] 完成: $OUT (+ .sha256)"
