# 编译交互提示 helper（方案 4.13 / PR09）。
#
# 与 O0 探针一样只用机器上已有的 BuildTools：vcvars64 提供 cl.exe 与 INCLUDE/LIB，
# 链接 user32 / gdi32 / d2d1 / dwrite / shcore / ole32。
#
# 清单（indicator-helper.manifest）是**必须**的：它声明 PerMonitorV2 DPI 感知。
# 没有它，进程会被 DWM 按 150% 拉伸，窗口拿到的是 1707×960 逻辑坐标，人物必然发虚。
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File native/indicator-helper/build.ps1
#
# 阶段 1：正式安装与开发目录隔离。`-OutDir` 用来把验证构建写到另一个目录，
# 这样正在运行的 helper 占着默认 build 目录里的 exe 时（LNK1104），仍然可以编译与自检，
# 也不会把"验证产物"当成"发行产物"。
param(
  [switch]$Clean,
  [string]$OutDir = 'build'
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$vcvars = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path $vcvars)) { throw "vcvars64.bat not found at $vcvars" }
$outDir = if ([System.IO.Path]::IsPathRooted($OutDir)) { $OutDir } else { Join-Path $here $OutDir }
if ($Clean -and (Test-Path $outDir)) { Remove-Item $outDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$exe = Join-Path $outDir 'dsh-interaction-indicator.exe'
$manifest = Join-Path $here 'indicator-helper.manifest'
if (-not (Test-Path $manifest)) { throw "manifest not found at $manifest" }
$cmd = @(
  "call `"$vcvars`" >nul",
  "cd /d `"$here`"",
  "cl /nologo /std:c++20 /EHsc /O2 /W4 /utf-8 main.cpp /Fo:`"$outDir\\`" /Fe:`"$exe`" /link /SUBSYSTEM:CONSOLE /MANIFEST:EMBED /MANIFESTINPUT:`"$manifest`" user32.lib gdi32.lib d2d1.lib dwrite.lib shcore.lib ole32.lib windowscodecs.lib advapi32.lib"
) -join ' && '

Write-Output "building: $exe"
$output = cmd /c $cmd 2>&1
$output | ForEach-Object { Write-Output $_ }
# 退出码必须查：链接失败时旧 exe 还在，只判"文件存在"会把失败报成成功（LNK1104 就被这样吞过一次）。
# cl 有时在 LINK 致命错误下仍返回 0，所以**再扫一遍输出**里的错误标记，两条都过才算成功。
if ($LASTEXITCODE -ne 0) { throw "build failed: compiler/linker exited $LASTEXITCODE" }
$errors = $output | Select-String -Pattern 'error [A-Z]+\d+|: fatal error|LNK\d{4}' -SimpleMatch:$false
if ($errors) { throw "build failed: $($errors | Select-Object -First 1)" }
if (-not (Test-Path $exe)) { throw 'build failed: dsh-interaction-indicator.exe was not produced' }
Write-Output "built: $((Get-Item $exe).Length) bytes (link exit 0)"
