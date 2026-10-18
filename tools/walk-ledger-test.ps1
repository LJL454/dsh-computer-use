# 9.txt §7.4 item 5: one read counts -- and bounds -- every traversal it takes.
#
# A read could traverse the same window several times over: the walk, a re-walk after the UI
# Automation client was re-created in process, another re-walk when the rows looked like the
# MSAA bridge's, and a health probe before each of those. The host can then restart the whole
# worker and repeat the read on top. None of that was counted, so the retry cost was invisible
# and every new retry was somebody's local decision.
#
# The ledger is pure bookkeeping, so it is checked here without a window.
#
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File tools\walk-ledger-test.ps1

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

Write-Host '== an empty ledger allows the first traversal and counts it =='
$ledger = New-WalkLedger
Check 'a fresh ledger starts at zero' ($ledger.Walks -eq 0 -and $ledger.HealthProbes -eq 0 -and $ledger.Resets -eq 0) (($ledger | ConvertTo-Json -Compress))
Check 'the first traversal is allowed' ((Test-WalkAllowed $ledger) -eq $true) 'refused'
Add-WalkHit $ledger
Check 'and it is counted' ($ledger.Walks -eq 1) "walks=$($ledger.Walks)"
Check 'a second is still allowed' ((Test-WalkAllowed $ledger) -eq $true) 'refused'

Write-Host ''
Write-Host '== the cap is what stops a retry chain, not a caller-by-caller decision =='
Add-WalkHit $ledger
Add-WalkHit $ledger
Check 'the ledger reaches the cap' ($ledger.Walks -eq $ledger.Cap) "walks=$($ledger.Walks) cap=$($ledger.Cap)"
Check 'and then refuses another traversal' ((Test-WalkAllowed $ledger) -eq $false) 'still allowed'
Check 'the cap is a small, stated number' ($ledger.Cap -ge 1 -and $ledger.Cap -le 5) "cap=$($ledger.Cap)"

Write-Host ''
Write-Host '== probes and resets are counted too =='
Add-HealthProbe $ledger
Add-HealthProbe $ledger
Add-ClientReset $ledger
Check 'health probes are counted' ($ledger.HealthProbes -eq 2) "probes=$($ledger.HealthProbes)"
Check 'client re-creations are counted' ($ledger.Resets -eq 1) "resets=$($ledger.Resets)"
Check 'and neither of them grants extra traversals' ((Test-WalkAllowed $ledger) -eq $false) 'refused'

Write-Host ''
Write-Host '== the ledger is per read, so a long session is still allowed many reads =='
$script:WalkLedger = New-WalkLedger
Add-WalkHit $script:WalkLedger
Add-WalkHit $script:WalkLedger
Add-WalkHit $script:WalkLedger
Reset-WalkCounters
Check 'a new read starts with an empty ledger' ($script:WalkLedger.Walks -eq 0 -and $script:WalkLedger.HealthProbes -eq 0) (($script:WalkLedger | ConvertTo-Json -Compress))
Check 'and its first traversal is allowed again' ((Test-WalkAllowed $script:WalkLedger) -eq $true) 'refused'

Write-Host ''
Write-Host '== the helpers are null-safe: a caller without a ledger is never refused =='
Check 'a missing ledger allows the traversal' ((Test-WalkAllowed $null) -eq $true) 'refused'
Check 'and counting into nothing is a no-op' (@(Add-WalkHit $null; Add-HealthProbe $null; Add-ClientReset $null).Count -eq 0) 'something was emitted'

Write-Host ''
$total = $passed + $failures.Count
Write-Host "$passed/$total checks passed"
if ($failures.Count -gt 0) {
    foreach ($failure in $failures) { Write-Host "  - $failure" }
    exit 1
}
exit 0
