# 编译 O0 原型（方案 4.14.1 / PR08）。
#
# 这条脚本只用机器上已有的 BuildTools：vcvars64 提供 cl.exe 与 INCLUDE/LIB，
# 链接 user32 / gdi32 / d2d1 / dwrite / shcore / ole32。
#
#   pwsh -File native/indicator-probe/build.ps1
#   pwsh -File native/indicator-probe/build.ps1 -Composition   # 预留：C++/WinRT 组合后端
param(
  [switch]$Composition,
  [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$vcvars = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path $vcvars)) { throw "vcvars64.bat not found at $vcvars" }
$outDir = Join-Path $here 'build'
if ($Clean -and (Test-Path $outDir)) { Remove-Item $outDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$defines = ''
if ($Composition) { $defines = '/DDSH_WITH_COMPOSITION' }
$exe = Join-Path $outDir 'indicator-probe.exe'
$cmd = @(
  "call `"$vcvars`" >nul",
  "cd /d `"$here`"",
  "cl /nologo /std:c++20 /EHsc /O2 /W4 /utf-8 $defines main.cpp /Fo:`"$outDir\\`" /Fe:`"$exe`" /link /SUBSYSTEM:CONSOLE user32.lib gdi32.lib d2d1.lib dwrite.lib shcore.lib ole32.lib"
) -join ' && '

Write-Output "building: $exe"
$output = cmd /c $cmd 2>&1
$output | ForEach-Object { Write-Output $_ }
if (-not (Test-Path $exe)) { throw 'build failed: indicator-probe.exe was not produced' }
Write-Output "built: $((Get-Item $exe).Length) bytes"
