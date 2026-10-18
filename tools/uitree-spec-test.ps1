# 9.txt §9 first row: `Do-UiTree`'s duplicated parameter initialization is one entry now.
#
# The defaults and flags of a read used to be spelled out twice inside `Do-UiTree` -- once for the
# COM branch and once inside the managed one -- so a default could be changed in one place and the
# two engines would quietly disagree about what "the same read" means. `Get-UiTreeSpec` resolves
# them once; this file checks the contract it resolves to, and that the function is the only place
# they are resolved.
#
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File tools\uitree-spec-test.ps1

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

Write-Host '== the defaults a caller who says nothing gets =='
$spec = Get-UiTreeSpec ([ordered]@{})
Check 'depth defaults to 6' ($spec.maxDepth -eq 6) "got=$($spec.maxDepth)"
Check 'node budget defaults to 400' ($spec.maxNodes -eq 400) "got=$($spec.maxNodes)"
Check 'patterns are probed by default' ($spec.probePatterns -eq $true) "got=$($spec.probePatterns)"
Check 'anonymous containers are skipped by default' ($spec.skipEmpty -eq $true) "got=$($spec.skipEmpty)"
Check 'pruning is on by default' ($spec.pruneRows -eq $true) "got=$($spec.pruneRows)"
Check 'no delta is assumed' ($spec.sinceArg -eq '') "got='$($spec.sinceArg)'"

Write-Host ''
Write-Host '== a caller that turns something off is honoured, and only that thing =='
$off = Get-UiTreeSpec ([ordered]@{ patterns = $false; skipEmpty = $false; prune = $false })
Check 'patterns off' ($off.probePatterns -eq $false) "got=$($off.probePatterns)"
Check 'skipEmpty off' ($off.skipEmpty -eq $false) "got=$($off.skipEmpty)"
Check 'prune off' ($off.pruneRows -eq $false) "got=$($off.pruneRows)"
Check 'and the untouched defaults stay put' ($off.maxDepth -eq 6 -and $off.maxNodes -eq 400) "depth=$($off.maxDepth) nodes=$($off.maxNodes)"
$explicitTrue = Get-UiTreeSpec ([ordered]@{ patterns = $true; skipEmpty = $true; prune = $true })
Check 'an explicit true is the default, not a third state' ($explicitTrue.probePatterns -eq $true -and $explicitTrue.skipEmpty -eq $true -and $explicitTrue.pruneRows -eq $true) 'something turned off'

Write-Host ''
Write-Host '== budgets are clamped the way the tool documents =='
Check 'depth is at least 1' ((Get-UiTreeSpec ([ordered]@{ maxDepth = 0 })).maxDepth -eq 1) "got=$((Get-UiTreeSpec ([ordered]@{ maxDepth = 0 })).maxDepth)"
Check 'depth above the walk limit is still accepted as given here (the tool clamps its own range)' ((Get-UiTreeSpec ([ordered]@{ maxDepth = 10 })).maxDepth -eq 10) 'not honoured'
Check 'node budget is at least 10' ((Get-UiTreeSpec ([ordered]@{ maxNodes = 2 })).maxNodes -eq 10) 'not clamped'
Check 'a node budget is taken as given' ((Get-UiTreeSpec ([ordered]@{ maxNodes = 250 })).maxNodes -eq 250) 'not honoured'

Write-Host ''
Write-Host '== a named snapshot is carried through as a string =='
Check 'a snapshot id becomes the since argument' ((Get-UiTreeSpec ([ordered]@{ since = 'snap-7' })).sinceArg -eq 'snap-7') "got='$((Get-UiTreeSpec ([ordered]@{ since = 'snap-7' })).sinceArg)'"
Check 'a numeric snapshot is stringified' ((Get-UiTreeSpec ([ordered]@{ since = 12 })).sinceArg -eq '12') "got='$((Get-UiTreeSpec ([ordered]@{ since = 12 })).sinceArg)'"
Check 'an absent snapshot stays empty' ((Get-UiTreeSpec ([ordered]@{ since = $null })).sinceArg -eq '') 'not empty'

Write-Host ''
Write-Host '== the function is the only place those defaults are resolved =='
$source = [System.IO.File]::ReadAllText($worker)
$specCallers = ([regex]::Matches($source, 'Get-UiTreeSpec')).Count
Check 'the normalization function is defined and used' ($specCallers -ge 2) "occurrences=$specCallers"
$inlinePatterns = ([regex]::Matches($source, 'if \(\$Arg\.patterns -eq \$false\)')).Count
Check 'the pattern flag is resolved exactly once in the whole worker' ($inlinePatterns -eq 1) "found $inlinePatterns time(s)"
$specBody = $source.Substring($source.IndexOf('function Get-UiTreeSpec('))
$specEnd = $specBody.IndexOf('function Do-UiTree(')
Check 'and that once is inside the normalization function' ($specBody.Substring(0, $specEnd) -match 'if \(\$Arg\.patterns -eq \$false\)') 'it is not'
$doUiTreeBody = $source.Substring($source.IndexOf('function Do-UiTree('))
$bodyEnd = $doUiTreeBody.IndexOf('function Do-Health')
$body = $doUiTreeBody.Substring(0, $bodyEnd)
Check 'Do-UiTree itself no longer re-resolves the flags' (-not ($body -match 'if \(\$Arg\.patterns -eq \$false\)')) 'it still does'
Check 'and it reads them from the spec instead' ($body -match '\$spec = Get-UiTreeSpec \$Arg') 'no spec read'

Write-Host ''
$total = $passed + $failures.Count
Write-Host "$passed/$total checks passed"
if ($failures.Count -gt 0) {
    foreach ($failure in $failures) { Write-Host "  - $failure" }
    exit 1
}
exit 0
