#!/usr/bin/env sh
# install.sh — 安装 bun-bot（从 GitHub Releases 下载对应平台的编译产物）
#
# 用法:
#   # 一行安装（macOS / Linux；Windows 用 scripts/install.ps1）
#   curl -fsSL https://raw.githubusercontent.com/BoltDoggy/bun-bot/HEAD/scripts/install.sh | sh
#   或下载后本地执行:
#   sh scripts/install.sh [--dir <安装目录>] [--version <版本>] [--repo <owner/repo>] [--target <平台>]
#
# 环境变量（与参数等价，脚本内可覆盖）:
#   BUN_BOT_REPO        仓库（默认 BoltDoggy/bun-bot，fork 或私有源可覆盖）
#   BUN_BOT_VERSION     版本号（默认 latest = 最新 Release；指定如 0.1.0 → 下载 v0.1.0）
#   BUN_BOT_INSTALL_DIR 安装目录（默认 ~/.local/bin；/usr/local/bin 可写时用后者）
#   BUN_BOT_TARGET      目标平台（默认自动检测；测试或手动指定用）
#   BUN_BOT_BASE_URL    下载源（默认 https://github.com/$REPO/releases；测试可指向本地服务）
#
# 行为: 检测平台 → 下载 bun-bot-<target> 与 .sha256 → 校验 → 安装 → 提示 PATH。
set -eu

REPO="${BUN_BOT_REPO:-BoltDoggy/bun-bot}"
VERSION="${BUN_BOT_VERSION:-latest}"
INSTALL_DIR="${BUN_BOT_INSTALL_DIR:-}"
TARGET="${BUN_BOT_TARGET:-}"
BASE_URL="${BUN_BOT_BASE_URL:-https://github.com/${REPO}/releases}"

usage() {
  echo "用法: sh install.sh [--dir <目录>] [--version <版本>] [--repo <owner/repo>] [--target <平台>] [--help]"
  echo "环境变量: BUN_BOT_REPO / BUN_BOT_VERSION / BUN_BOT_INSTALL_DIR / BUN_BOT_TARGET / BUN_BOT_BASE_URL"
}

# ---------- 参数解析 ----------
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --version) VERSION="${2:-}"; shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    --target) TARGET="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "未知参数: $1（--help 查看用法）" >&2; exit 1 ;;
  esac
done

# ---------- 平台检测（uname → 产物 target 名） ----------
detect_target() {
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    *) echo "错误：不支持的系统: $os（仅支持 macOS / Linux / Windows(MSYS/Git Bash)）" >&2; exit 1 ;;
  esac
  case "$arch" in
    x86_64|amd64|x64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) echo "错误：不支持的架构: $arch（仅支持 x64 / arm64）" >&2; exit 1 ;;
  esac
  echo "${os}-${arch}"
}

if [ -z "$TARGET" ]; then
  TARGET="$(detect_target)"
fi

# Windows 产物带 .exe 后缀
FILE="bun-bot-${TARGET}"
case "$TARGET" in windows*) FILE="${FILE}.exe";; esac

# ---------- 下载（curl 优先，wget 兜底） ----------
download() {
  url="$1"; out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 "$url" -o "$out"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$out"
  else
    echo "错误：需要 curl 或 wget 来下载" >&2
    return 1
  fi
}

# ---------- SHA256 校验（sha256sum 优先，shasum 兜底） ----------
verify_sum() {
  dir="$1"; sumfile="$2"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$dir" && sha256sum -c "$sumfile")
  elif command -v shasum >/dev/null 2>&1; then
    (cd "$dir" && shasum -a 256 -c "$sumfile")
  else
    echo "警告：找不到 sha256sum/shasum，跳过完整性校验" >&2
  fi
}

# ---------- 主流程 ----------
# Release 资产路径: latest → /latest/download/...；指定版本 → /download/v<版本>/...
if [ "$VERSION" = "latest" ]; then
  RELEASE_PATH="latest/download"
else
  RELEASE_PATH="download/v${VERSION}"
fi
URL="${BASE_URL}/${RELEASE_PATH}/${FILE}"
SUM_URL="${URL}.sha256"

# 安装目录：默认 ~/.local/bin；/usr/local/bin 可写时用之（免 sudo）
if [ -z "$INSTALL_DIR" ]; then
  if [ -w /usr/local/bin ]; then
    INSTALL_DIR="/usr/local/bin"
  else
    INSTALL_DIR="${HOME}/.local/bin"
  fi
fi

echo "[install] 平台: $TARGET | 版本: $VERSION | 安装目录: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[install] 下载 $URL"
download "$URL" "$TMP/$FILE"

# 校验文件可下载则强制校验；下载失败仅警告（避免无校验环境被卡死）
if download "$SUM_URL" "$TMP/$FILE.sha256" 2>/dev/null; then
  echo "[install] 校验 SHA256..."
  verify_sum "$TMP" "$FILE.sha256"
else
  echo "警告：无法下载 SHA256 校验文件，跳过完整性校验（URL: $SUM_URL）" >&2
fi

# 安装（保留可执行位；Windows .exe 无需 chmod，install -m 不影响）
install -m 0755 "$TMP/$FILE" "$INSTALL_DIR/$FILE"
echo "[install] 已安装: $INSTALL_DIR/$FILE"

# PATH 提示（已在 PATH 中则跳过）
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo "提示：$INSTALL_DIR 不在 PATH，添加以下一行到 ~/.zshrc / ~/.bashrc 后重新打开终端："
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac

echo "下一步：设置环境变量 DEEPSEEK_API_KEY 后运行：${FILE} \"你的任务\""
echo "版本确认：${FILE} --version"
