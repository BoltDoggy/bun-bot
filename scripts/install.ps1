<#
  install.ps1 — 安装 bun-bot（Windows，从 GitHub Releases 下载 x64/arm64 编译产物）

  用法:
    # 一行安装（PowerShell）：
    powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/BoltDoggy/bun-bot/HEAD/scripts/install.ps1 | iex"
    # 或下载后本地执行:
    powershell -ExecutionPolicy Bypass -File scripts/install.ps1 [-Dir <目录>] [-Version <版本>] [-Repo <owner/repo>]

  行为: 检测架构 → 下载 bun-bot-windows-<arch>.exe 与 .sha256 → SHA256 校验 → 安装到
  %LOCALAPPDATA%\bun-bot\bin（或 -Dir 指定）→ 加入用户 PATH（新终端生效）。
#>
param(
  [string]$Dir = "",
  [string]$Version = "latest",
  [string]$Repo = "BoltDoggy/bun-bot"
)

$ErrorActionPreference = "Stop"

# ---------- 架构检测 ----------
$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -eq "AMD64") { $arch = "x64" }
elseif ($arch -eq "ARM64") { $arch = "arm64" }
else { Write-Error "不支持的架构: $arch（仅支持 x64 / arm64）"; exit 1 }
$target = "windows-$arch"
$file = "bun-bot-$target.exe"

# ---------- Release 资产 URL ----------
$base = "https://github.com/$Repo/releases"
$releasePath = if ($Version -eq "latest") { "latest/download" } else { "download/v$Version" }
$url = "$base/$releasePath/$file"
$sumUrl = "$url.sha256"

# ---------- 安装目录（默认 %LOCALAPPDATA%\bun-bot\bin，无需管理员权限） ----------
if (-not $Dir) { $Dir = Join-Path $env:LOCALAPPDATA "bun-bot\bin" }
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$dest = Join-Path $Dir $file

Write-Host "[install] 平台: $target | 版本: $Version | 安装目录: $Dir"
Write-Host "[install] 下载 $url"
Invoke-WebRequest -Uri $url -OutFile $dest

# ---------- SHA256 校验（.sha256 文件: "<hash>  <文件名>"; 下载失败仅警告） ----------
try {
  $sumLine = (Invoke-WebRequest -Uri $sumUrl).Content.Trim()
  $expected = ($sumLine -split "\s+")[0].ToLower()
  $actual = (Get-FileHash -Path $dest -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $expected) {
    Write-Error "SHA256 校验失败：期望 $expected 实际 $actual（可能下载损坏或被篡改）"
    Remove-Item $dest -Force
    exit 1
  }
  Write-Host "[install] SHA256 校验通过"
} catch {
  Write-Warning "无法下载 SHA256 校验文件，跳过完整性校验: $sumUrl"
}

# ---------- 加入用户 PATH（HKCU\Environment，不污染系统 PATH） ----------
$bin = $Dir
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$bin*") {
  $newPath = if ($userPath) { "$userPath;$bin" } else { $bin }
  [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
  Write-Host "[install] 已将 $bin 加入用户 PATH（新终端生效）"
} else {
  Write-Host "[install] $bin 已在用户 PATH 中"
}

Write-Host "[install] 已安装: $dest"
Write-Host "下一步：设置环境变量 DEEPSEEK_API_KEY 后运行：$file `"你的任务`""
Write-Host "版本确认：$file --version"
