# 9.txt §7.4 item 1: when the caller says `patterns: false`, the cache request must not go on
# asking the provider for patterns.
#
# This is the gap the review names -- output fields were trimmed while the UIA *cost* stayed:
# the managed path's cache request used to add every pattern property unconditionally, so a
# `patterns: false` read still fetched patterns per node, cross-process. The COM engine has
# taken a `$withPatterns` flag all along; the managed wrapper now agrees with it.
#
# No window is needed: the helper is called directly and asked how many pattern properties it
# put into the cache request.
#
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File tools\uia-cache-test.ps1

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$worker = Join-Path (Split-Path -Parent $here) 'backend\worker.ps1'

$passed = 0
$failures = New-Object System.Collections.Generic.List[string]

function Check([string]$Label, [bool]$Condition, [string]$Detail = '') {
    if ($Condition) {
        $script:passed += 1
        Write-Host "  PASS  $Label"
    } else {
        $script:failures.Add("$Label :: $Detail")
        Write-Host "  FAIL  $Label :: $Detail"
    }
}

$null = . $worker

$allPatterns = @(Get-UiaPatternSpecs).Count

Write-Host '== a read that wants patterns still asks for all of them =='
$script:UiaCachePatterns = -1
$built = New-UiaCacheRequest $true
$asked = $script:UiaCachePatterns
Check 'the cache request is built' ($null -ne $built) 'null'
Check 'the pattern table is not empty (otherwise this assertion proves nothing)' ($allPatterns -gt 0) "table=$allPatterns"
Check 'it asks for exactly the pattern table' ($asked -eq $allPatterns) "asked=$asked table=$allPatterns"

Write-Host ''
Write-Host '== a read that does not want patterns asks for none =='
$script:UiaCachePatterns = -1
$builtBare = New-UiaCacheRequest $false
$askedBare = $script:UiaCachePatterns
Check 'the cache request is still built (the property cache is the point)' ($null -ne $builtBare) 'null'
Check 'and it asks for no pattern at all' ($askedBare -eq 0) "asked=$askedBare"

Write-Host ''
Write-Host '== the default keeps every existing caller behaving as before =='
$script:UiaCachePatterns = -1
$builtDefault = New-UiaCacheRequest
$askedDefault = $script:UiaCachePatterns
Check 'omitting the argument still asks for patterns' ($askedDefault -eq $allPatterns) "asked=$askedDefault table=$allPatterns"

Write-Host ''
Write-Host '== the count reaches the caller, so the saving is a fact and not a claim =='
$source = [System.IO.File]::ReadAllText($worker)
Check 'the managed tree reply carries cachePatterns' ($source -match 'cachePatterns = \[int\]\$\{?script:UiaCachePatterns') 'cachePatterns not reported in the managed tree reply'
Check 'the managed find reply carries cachePatterns too' (([regex]::Matches($source, 'cachePatterns')).Count -ge 2) 'fewer than two cachePatterns reports'
Check 'and the walk passes its own patterns flag into the cache request' ($source -match '\$cache = New-UiaCacheRequest \$probePatterns') 'the call site does not pass $probePatterns'

Write-Host ''
$total = $passed + $failures.Count
Write-Host "$passed/$total checks passed"
if ($failures.Count -gt 0) {
    foreach ($failure in $failures) { Write-Host "  - $failure" }
    exit 1
}
exit 0
