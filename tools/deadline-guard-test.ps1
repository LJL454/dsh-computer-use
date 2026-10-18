# The deadline guard, checked by calling the shipping functions with the shapes the batch uses
# (9.txt §5.7: 每次输入发送前再次检查 / 用参数传递测试验证输入).
#
# Dot-sourcing worker.ps1 runs its startup and then its read loop, which ends immediately
# because stdin is at EOF -- so the functions are here and nothing was dispatched to the
# desktop. The proof that *nothing was sent* is the worker's own write ordinal: every write
# stamps `$script:WriteSeq`, so "the ordinal did not move" is a fact about this process rather
# than a reading of a return value.
#
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File tools\deadline-guard-test.ps1

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

Write-Host '== with no deadline the guard stays out of the way =='
Clear-Deadline
Check 'no deadline means "unbounded", not "zero"' ((Get-DeadlineRemainingMs) -eq [int]::MaxValue) "$(Get-DeadlineRemainingMs)"
$allowed = $true
try { Assert-WithinDeadline 'in the no-deadline case' } catch { $allowed = $false }
Check 'and a send is allowed' $allowed

Write-Host ''
Write-Host '== a spent deadline refuses *before* anything is sent =='
$before = [int64]$script:WriteSeq
Set-DeadlineAt ([int64]$script:Clock.ElapsedMilliseconds - 5)
Check 'the remaining budget is clamped to zero, never negative' ((Get-DeadlineRemainingMs) -eq 0) "$(Get-DeadlineRemainingMs)"
$refusal = ''
try { Assert-CanSend 'before a test send' } catch { $refusal = $_.Exception.Message }
Check 'the refusal names the budget as the reason' ($refusal.StartsWith('[DEADLINE_EXHAUSTED]')) $refusal
Check 'and it says nothing was sent' ($refusal -match 'nothing further was sent') $refusal
$typeRefused = ''
try { [void](Do-Type @{ text = ' ' }) } catch { $typeRefused = $_.Exception.Message }
Check 'typing is refused too' ($typeRefused.StartsWith('[DEADLINE_EXHAUSTED]')) $typeRefused
Check 'and the write ordinal never moved, so no input was sent' ([int64]$script:WriteSeq -eq $before) "before=$before after=$([int64]$script:WriteSeq)"
$moveRefused = $false
try { [void](Do-MouseMove 5 5) } catch { $moveRefused = $_.Exception.Message.StartsWith('[DEADLINE_EXHAUSTED]') }
Check 'a pointer move is refused as well' $moveRefused

Write-Host ''
Write-Host '== clearing the deadline makes the next call ordinary again =='
Clear-Deadline
$after = $true
try { Assert-WithinDeadline 'after the deadline was cleared' } catch { $after = $false }
Check 'sends are allowed again' $after
Check 'and the budget reads as unbounded' ((Get-DeadlineRemainingMs) -eq [int]::MaxValue) "$(Get-DeadlineRemainingMs)"

Write-Host ''
Write-Host '== a wait with no budget makes no observation =='
# A condition that no longer holds is the point: with no budget, nothing is checked at all, so
# the report cannot claim either answer. (The window handle is deliberately one nothing owns.)
$report = Wait-ForCondition @{ condition = @{ kind = 'window'; hwnd = 987654321 }; timeout_ms = 0 }
Check 'it reports the third answer rather than "false"' ("$($report.status)" -eq 'unknown') "status=$($report.status)"
Check 'with zero checks made' ([int]$report.polls -eq 0) "polls=$($report.polls)"
Check 'and the reason is the spent budget' ("$($report.timeoutKind)" -eq 'budget-spent') "timeoutKind=$($report.timeoutKind)"
Check 'it is reported as not satisfied' ($report.satisfied -eq $false) "satisfied=$($report.satisfied)"
Check 'and it says so in the observation text' ("$($report.observed)" -match 'no check was made') "$($report.observed)"

Write-Host ''
Write-Host '== a wait that has a budget still observes =='
$observed = Wait-ForCondition @{ condition = @{ kind = 'window'; hwnd = 987654321 }; timeout_ms = 400 }
Check 'it makes at least one check' ([int]$observed.polls -ge 1) "polls=$($observed.polls)"
Check 'and it is not the spent-budget answer' ("$($observed.timeoutKind)" -ne 'budget-spent') "timeoutKind=$($observed.timeoutKind)"

Write-Host ''
Write-Host "$passed passed, $($failures.Count) failed"
if ($failures.Count -gt 0) {
    Write-Host ''
    Write-Host 'failures:'
    foreach ($failure in $failures) { Write-Host "  - $failure" }
    exit 1
}
exit 0
