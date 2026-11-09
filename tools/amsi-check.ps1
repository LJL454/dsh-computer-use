#requires -Version 5.1
<#
.SYNOPSIS
    DSH Computer Use 候选包的杀毒/AMSI 复核脚本（在**任何一台 Windows** 上跑，不需要装插件）。

.DESCRIPTION
    复核结论第 4 条要求"当前样本的 AMSI 检测记录、样本哈希和安全情报版本重新核实"。
    这里把该做的事一次性做完并落成 JSON：

      1. 记录机器与安全产品状态（Defender 是否启用、特征版本与时间、引擎版本、实时防护）；
      2. 对**实际运行的东西**算哈希：native helper、worker 的 PowerShell 脚本、随包清单本身；
      3. 用 MpCmdRun 逐个做自定义扫描（ScanType 3），记录结果码与输出；
      4. 读最近的威胁检测记录，按文件名/路径过滤到本包；
      5. Defender 被禁用时如实写"无法扫描"，并仍然输出哈希 —— 这些哈希就是提交误报/复核时要用的东西。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\amsi-check.ps1

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\amsi-check.ps1 -Root D:\unzipped\dsh-computer-use -Out D:\amsi.json
#>
[CmdletBinding()]
param(
    # 插件根目录（含 native/、backend/、assets/）。默认取本脚本的上一级。
    [string]$Root = '',
    # 结果写到哪。默认放在插件根的 dist/ 下。
    [string]$Out = '',
    # 跳过实际扫描，只收集状态与哈希（用来确认环境是否具备扫描条件）。
    [switch]$NoScan
)

$ErrorActionPreference = 'Stop'

# -File 启动时 $PSCommandPath 在参数绑定阶段可能为空，改成在正文里用 $PSScriptRoot 推导。
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = Split-Path -Parent $PSScriptRoot }
$Root = [System.IO.Path]::GetFullPath($Root)

if ([string]::IsNullOrWhiteSpace($Out)) {
    $Out = Join-Path (Join-Path $Root 'dist') ("amsi-check-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
$Out = [System.IO.Path]::GetFullPath($Out)
$null = New-Item -ItemType Directory -Path (Split-Path -Parent $Out) -Force

function Get-Sha256([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-DefenderState {
    $state = [ordered]@{
        servicePresent = $false
        serviceStatus  = $null
        amServiceEnabled = $null
        antivirusEnabled = $null
        realtimeEnabled  = $null
        signatureVersion = $null
        signatureUpdated = $null
        signatureAgeDays = $null
        engineVersion    = $null
        policyDisabled   = $null
        platform         = $null
        mpCmdRun         = $null
        error            = $null
    }
    try {
        $svc = Get-Service -Name WinDefend -ErrorAction SilentlyContinue
        if ($null -ne $svc) {
            $state.servicePresent = $true
            $state.serviceStatus = [string]$svc.Status
        }
    } catch { }

    try {
        $mp = Get-MpComputerStatus -ErrorAction Stop
        $state.amServiceEnabled = [bool]$mp.AMServiceEnabled
        $state.antivirusEnabled = [bool]$mp.AntivirusEnabled
        $state.realtimeEnabled = [bool]$mp.RealTimeProtectionEnabled
        $state.signatureVersion = [string]$mp.AntivirusSignatureVersion
        $state.signatureUpdated = if ($null -ne $mp.AntivirusSignatureLastUpdated) { ([datetime]$mp.AntivirusSignatureLastUpdated).ToString('o') } else { $null }
        $state.signatureAgeDays = $mp.AntivirusSignatureAge
        $state.engineVersion = [string]$mp.AMEngineVersion
    } catch {
        $state.error = $_.Exception.Message
    }

    foreach ($key in @('HKLM:\SOFTWARE\Microsoft\Windows Defender', 'HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender')) {
        try {
            $props = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
            if ($null -ne $props) {
                $flag = $null
                if ($null -ne $props.DisableAntiSpyware) { $flag = $props.DisableAntiSpyware }
                elseif ($null -ne $props.DisableAntiVirus) { $flag = $props.DisableAntiVirus }
                if ($null -ne $flag) { $state.policyDisabled = [int]$flag }
            }
        } catch { }
    }

    $platformRoot = Join-Path $env:ProgramData 'Microsoft\Windows Defender\Platform'
    if (Test-Path -LiteralPath $platformRoot) {
        $newest = Get-ChildItem -LiteralPath $platformRoot -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -ne 'CurrentVersion' } | Sort-Object LastWriteTime | Select-Object -Last 1
        if ($null -ne $newest) {
            $state.platform = $newest.Name
            $candidate = Join-Path $newest.FullName 'MpCmdRun.exe'
            if (Test-Path -LiteralPath $candidate) { $state.mpCmdRun = $candidate }
        }
    }
    return $state
}

function Invoke-Scan([string]$MpCmdRun, [string]$Path) {
    $result = [ordered]@{ path = $Path; exitCode = $null; output = ''; scanned = $false }
    if ([string]::IsNullOrWhiteSpace($MpCmdRun) -or -not (Test-Path -LiteralPath $MpCmdRun)) {
        $result.output = 'MpCmdRun.exe not found'
        return $result
    }
    if (-not (Test-Path -LiteralPath $Path)) {
        $result.output = 'file not found'
        return $result
    }
    try {
        $raw = & $MpCmdRun -Scan -ScanType 3 -File $Path -DisableRemediation 2>&1
        $result.exitCode = $LASTEXITCODE
        $result.output = ($raw | Out-String).Trim()
        $result.scanned = ($LASTEXITCODE -eq 0)
    } catch {
        $result.output = $_.Exception.Message
    }
    return $result
}

# ---------------------------------------------------------------- 收集目标 --

$targets = @()
foreach ($relative in @(
        'native/indicator-helper/build/dsh-interaction-indicator.exe',
        'native/indicator-probe/build/indicator-probe.exe'
    )) {
    $full = Join-Path $Root ($relative -replace '/', [System.IO.Path]::DirectorySeparatorChar)
    if (Test-Path -LiteralPath $full) {
        $targets += [pscustomobject]@{ role = 'binary'; relative = $relative; full = $full }
    }
}
foreach ($directory in @('backend', 'interaction')) {
    $full = Join-Path $Root $directory
    if (Test-Path -LiteralPath $full) {
        Get-ChildItem -LiteralPath $full -Filter '*.ps1' -File -ErrorAction SilentlyContinue | ForEach-Object {
            $targets += [pscustomobject]@{ role = 'script'; relative = ("$directory/{0}" -f $_.Name); full = $_.FullName }
        }
    }
}
$manifestPath = Join-Path $Root 'release-manifest.json'
if (Test-Path -LiteralPath $manifestPath) {
    $targets += [pscustomobject]@{ role = 'manifest'; relative = 'release-manifest.json'; full = $manifestPath }
}

$defender = Get-DefenderState
$canScan = -not $NoScan -and $defender.antivirusEnabled -eq $true -and -not [string]::IsNullOrWhiteSpace($defender.mpCmdRun)

Write-Host ''
Write-Host '== 安全产品状态 =='
Write-Host ("  WinDefend 服务      : {0}" -f $(if ($defender.servicePresent) { $defender.serviceStatus } else { 'not present' }))
Write-Host ("  Defender 启用        : antivirus={0}  AMSI={1}  实时防护={2}" -f $defender.antivirusEnabled, $defender.amServiceEnabled, $defender.realtimeEnabled)
Write-Host ("  特征版本             : {0}  (更新于 {1}, 龄期 {2} 天)" -f $defender.signatureVersion, $defender.signatureUpdated, $defender.signatureAgeDays)
Write-Host ("  引擎 / 平台          : {0} / {1}" -f $defender.engineVersion, $defender.platform)
if ($null -ne $defender.policyDisabled) { Write-Host ("  策略禁用             : {0}" -f $defender.policyDisabled) }
if (-not [string]::IsNullOrWhiteSpace($defender.error)) { Write-Host ("  状态读取错误         : {0}" -f $defender.error) }
Write-Host ("  可否扫描             : {0}" -f $canScan)
Write-Host ''

$items = @()
Write-Host '== 目标与哈希 =='
foreach ($target in $targets) {
    $hash = Get-Sha256 $target.full
    $size = if (Test-Path -LiteralPath $target.full) { (Get-Item -LiteralPath $target.full).Length } else { $null }
    $scan = $null
    if ($canScan) {
        $scan = Invoke-Scan -MpCmdRun $defender.mpCmdRun -Path $target.full
    }
    $verdict = 'not-scanned'
    if ($null -ne $scan) {
        if ($scan.scanned) { $verdict = 'clean' }
        elseif ($scan.output -match 'found|Threat|Threats') { $verdict = 'detected' }
        else { $verdict = 'scan-failed' }
    }
    $items += [pscustomobject][ordered]@{
        role = $target.role
        path = $target.relative
        bytes = $size
        sha256 = $hash
        scan = $scan
        verdict = $verdict
    }
    Write-Host ("  {0,-42} {1,-14} {2}" -f $target.relative, $hash, $verdict)
}

$detections = @()
try {
    $detections = Get-MpThreatDetection -ErrorAction Stop |
        Where-Object { $_.Resources -match 'dsh-interaction-indicator|indicator-probe|dsh-computer-use' } |
        Select-Object -Last 20 |
        ForEach-Object {
            [pscustomobject][ordered]@{
                threatId = $_.ThreatID
                threat = $_.Threat
                at = if ($null -ne $_.InitialDetectionTime) { ([datetime]$_.InitialDetectionTime).ToString('o') } else { $null }
                action = [string]$_.ActionSuccess
                resources = @($_.Resources)
            }
        }
} catch { }

$report = [pscustomobject][ordered]@{
    schema = 'dsh.amsi-check/v1'
    at = (Get-Date).ToString('o')
    host = [pscustomobject][ordered]@{
        name = $env:COMPUTERNAME
        os = (Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption
        build = (Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue).BuildNumber
        user = $env:USERNAME
    }
    root = $Root
    defender = $defender
    canScan = $canScan
    items = $items
    detections = $detections
    note = if ($canScan) { '' } else { '这台机器的 Defender 不可用（被策略禁用或未安装），因此只产出哈希；请把本文件与哈希带到有可用 Defender 的机器上重跑本脚本。' }
}

$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Out -Encoding UTF8
Write-Host ''
Write-Host ("报告：{0}" -f $Out)
if (-not $canScan) {
    Write-Host '注意：本机无法扫描（Defender 不可用）。把这份 JSON 和候选包带到有可用 Defender 的机器上再跑一次。'
}
if (($items | Where-Object { $_.verdict -eq 'detected' }).Count -gt 0) { exit 3 }
if (-not $canScan) { exit 2 }
exit 0
