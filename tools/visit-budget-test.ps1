# 9.txt §7.4 item 2: the traversal budget is derived and honoured as documented.
#
# The budget is what keeps a tree of anonymous containers -- dropped one by one by skip_empty,
# so the node budget never fills -- from being walked without any bound of its own. The rules
# below are the ones the reply's `traversal.visitBudget` field reports, and they are pure
# arithmetic, so they are checked without a window.
#
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File tools\visit-budget-test.ps1

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

Write-Host '== an explicit budget is honoured as given =='
Check 'a plain number is used as-is' ((Get-VisitBudget 250 120) -eq 120) "got=$(Get-VisitBudget 250 120)"
Check 'a string number is accepted too (it arrives through JSON)' ((Get-VisitBudget 250 '90') -eq 90) "got=$(Get-VisitBudget 250 '90')"
Check 'zero means no limit and stays zero' ((Get-VisitBudget 250 0) -eq 0) "got=$(Get-VisitBudget 250 0)"
Check 'a negative budget is clamped to "no limit" rather than to something small' ((Get-VisitBudget 250 -5) -eq 0) "got=$(Get-VisitBudget 250 -5)"

Write-Host ''
Write-Host '== without one, the budget is derived from the node budget and stays generous =='
Check 'a small node budget still gets the floor of the derivation' ((Get-VisitBudget 40 $null) -eq 5000) "got=$(Get-VisitBudget 40 $null)"
Check 'a large node budget scales with it' ((Get-VisitBudget 1500 $null) -eq 30000) "got=$(Get-VisitBudget 1500 $null)"
Check 'the derivation never falls below the floor' ((Get-VisitBudget 1 $null) -ge 5000) "got=$(Get-VisitBudget 1 $null)"
Check 'an empty string behaves like an absent budget' ((Get-VisitBudget 250 '') -eq (Get-VisitBudget 250 $null)) "got=$(Get-VisitBudget 250 '')"

Write-Host ''
Write-Host '== a budget that cannot be parsed falls back to the derivation, never to a tiny number =='
Check 'garbage does not cap the walk at zero or one' ((Get-VisitBudget 250 'lots') -eq 5000) "got=$(Get-VisitBudget 250 'lots')"

Write-Host ''
$total = $passed + $failures.Count
Write-Host "$passed/$total checks passed"
if ($failures.Count -gt 0) {
    foreach ($failure in $failures) { Write-Host "  - $failure" }
    exit 1
}
exit 0
