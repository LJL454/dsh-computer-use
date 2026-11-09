# 阶段 1：把交互提示 helper 部署到"普通用户安装位置"，并核验它真的不在低完整性下运行。
#
# 为什么需要这一步：源码树带有一条可继承的 Low 完整性标签。在树里构建/启动的 helper 会继承它，
# 进程以 Low 运行，于是 WH_MOUSE_LL / WH_KEYBOARD_LL 装得上、却收不到用户桌面上的输入 ——
# 表现就是"角色只有待机和移动，点击/拖拽/滚轮全都没有"。这不是鼠标驱动的问题，是部署问题。
#
# 只在**普通用户**上下文运行，不请求管理员，不改整棵树的权限，不复制开发树的 SACL。
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/deploy-helper.ps1
#   powershell ... -File tools/deploy-helper.ps1 -Source native/indicator-helper/build-verify -Destination "$env:LOCALAPPDATA\dsh-computer-use\helper"
#   powershell ... -File tools/deploy-helper.ps1 -VerifyOnly
param(
  [string]$Source = '',
  [string]$Destination = (Join-Path $env:LOCALAPPDATA 'dsh-computer-use\helper'),
  [switch]$VerifyOnly,
  [switch]$SkipProbe
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if ($Source -eq '') { $Source = Join-Path $root 'native\indicator-helper\build' }
$exeName = 'dsh-interaction-indicator.exe'
$sourceExe = Join-Path $Source $exeName
$destExe = Join-Path $Destination $exeName

function Get-IntegrityLabel([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return 'missing' }
  $out = & icacls $path 2>&1 | Out-String
  if ($out -match 'Low Mandatory Level') { return 'low' }
  if ($out -match 'Medium Mandatory Level') { return 'medium' }
  if ($out -match 'High Mandatory Level') { return 'high' }
  if ($out -match 'System Mandatory Level') { return 'system' }
  return 'unlabeled'
}

function Get-Sha256([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return '' }
  return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Invoke-IdentityProbe([string]$path) {
  # 直接同步调用：--hook-probe 只往 stdout 打一行 JSON，5 秒后退出。
  # 不用 Start-Process 是为了拿到原样的 stdout，也不给子进程继承一个会被 RedirectStandardOutput 影响的句柄。
  $line = (& $path '--hook-probe' 2>$null | Out-String).Trim()
  if ($line -eq '') { throw "the identity probe produced no output: $path" }
  return ($line | ConvertFrom-Json)
}

$report = [ordered]@{
  source = $sourceExe
  destination = $destExe
  verifyOnly = [bool]$VerifyOnly
  steps = @()
  ok = $false
  integrity = $null
  processIdentity = $null
  error = $null
}

try {
  if (-not $VerifyOnly) {
    if (-not (Test-Path -LiteralPath $sourceExe)) { throw "source helper not found: $sourceExe" }
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    # 只复制 helper 本体与清单：素材、日志、开发树里的其它产物都不带过去。
    Copy-Item -LiteralPath $sourceExe -Destination $destExe -Force
    $manifest = Join-Path $Source 'indicator-helper.manifest'
    if (Test-Path -LiteralPath $manifest) { Copy-Item -LiteralPath $manifest -Destination $Destination -Force }
    $report.steps += 'copied'
  }

  if (-not (Test-Path -LiteralPath $destExe)) { throw "deployed helper not found: $destExe" }
  $sourceHash = Get-Sha256 $sourceExe
  $destHash = Get-Sha256 $destExe
  $report.sourceSha256 = $sourceHash
  $report.destinationSha256 = $destHash
  if ($sourceHash -ne '' -and $sourceHash -ne $destHash) { throw 'the deployed helper differs from the source build' }
  $report.steps += 'hash-verified'

  # 文件标签：Low 意味着"在这个位置不可能收到桌面输入"。宁可在这里失败，也不要让用户去怀疑鼠标。
  $fileLabel = Get-IntegrityLabel $destExe
  $report.integrity = [ordered]@{ file = $fileLabel }
  if ($fileLabel -eq 'low') {
    throw "the deployed helper still carries a Low mandatory label ($destExe). Deploy outside the restricted source tree; do not hand-edit ACLs on the development tree."
  }
  $report.steps += 'file-label-ok'

  # 真实进程身份：文件标签只是必要条件，进程令牌才是判据（阶段 1 第 4/6 条）。
  if (-not $SkipProbe) {
    $probe = Invoke-IdentityProbe $destExe
    $report.processIdentity = [ordered]@{
      integrityRid = $probe.integrityRid
      integrity = $probe.integrity
      uiAccess = $probe.uiAccess
      session = $probe.session
      canObserveInput = $probe.canObserveInput
      hook = $probe.hook
      hookLastError = $probe.lastError
    }
    if ($probe.canObserveInput -ne $true) {
      throw "the deployed helper runs at $($probe.integrity) integrity ($($probe.integrityRid)); low-level hooks installed there cannot see the user's desktop input"
    }
    $report.steps += 'process-identity-ok'
  }

  $report.ok = $true
} catch {
  $report.error = $_.Exception.Message
}

$report | ConvertTo-Json -Depth 6
if ($report.ok -ne $true) { exit 1 }
