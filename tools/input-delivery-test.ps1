# The input-delivery rule, checked by calling the shipping classifier and the shipping refusal
# with synthetic counts (9.txt §6: 部分输入事件成功可能被当作全部成功 / §5.2: 部分输入是独立状态).
#
# SendInput reports how many events it *inserted*, and a fixed number of events is what each
# action needs: two for a click, two per character for typing, one per wheel step. Whether a
# short count is reported as a success, a refusal, or a partial action is therefore a pure
# function of (sent, expected), which is what this file checks -- no desktop involved.
#
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File tools\input-delivery-test.ps1

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

Write-Host '== a full delivery is a completed action =='
$full = Test-InputDelivery 2 2 'a click'
Check 'two of two events is completed' ("$($full.state)" -eq 'completed' -and $full.complete -eq $true) "$($full.state)/$($full.complete)"
Check 'and it carries the counts rather than a claim' ([int]$full.sent -eq 2 -and [int]$full.expected -eq 2) "sent=$($full.sent) expected=$($full.expected)"
$extra = Test-InputDelivery 5 4 'a click'
Check 'more inserted than expected is still completed' ("$($extra.state)" -eq 'completed') "$($extra.state)"
$nothing = Test-InputDelivery 0 0 'a no-op'
Check 'nothing to send is completed, not refused' ("$($nothing.state)" -eq 'completed') "$($nothing.state)"

Write-Host ''
Write-Host '== a short delivery is its own state, and says how short =='
$partial = Test-InputDelivery 3 5 'typing 3 character(s)'
Check 'three of five is partial' ("$($partial.state)" -eq 'partial') "$($partial.state)"
Check 'it is not complete' ($partial.complete -eq $false) "$($partial.complete)"
Check 'and the note counts what landed' ("$($partial.note)" -match '3 of the 5') "$($partial.note)"
$none = Test-InputDelivery 0 5 'typing 3 character(s)'
Check 'none of five is its own state too' ("$($none.state)" -eq 'none') "$($none.state)"
Check 'and it explains the usual causes' ("$($none.note)" -match 'locked|integrity') "$($none.note)"

Write-Host ''
Write-Host '== the refusal a short send earns =='
$ok = $true
$result = $null
try { $result = Assert-InputDelivered 4 4 'typing' 'the typed text' } catch { $ok = $false }
Check 'a full delivery passes without a word' ($ok -and ("$($result.state)" -eq 'completed')) "$($result.state)"

$partialRefusal = ''
try { [void](Assert-InputDelivered 2 4 'typing' 'the typed text') } catch { $partialRefusal = $_.Exception.Message }
Check 'a partial delivery throws' ($partialRefusal -ne '') 'no error was thrown'
Check 'with the partial code the batch reads' ($partialRefusal.StartsWith('[PARTIAL_INPUT]')) $partialRefusal
Check 'it states how much landed' ($partialRefusal -match 'inserted 2 of the 4') $partialRefusal
Check 'it says the action was sent' ($partialRefusal -match 'action_sent=true') $partialRefusal
Check 'and it warns against repeating the step' ($partialRefusal -match 'Do not repeat') $partialRefusal

$noneRefusal = ''
try { [void](Assert-InputDelivered 0 4 'typing' 'the typed text') } catch { $noneRefusal = $_.Exception.Message }
Check 'nothing landed is not called partial' (-not $noneRefusal.StartsWith('[PARTIAL_INPUT]')) $noneRefusal
Check 'it still says none of the events went out' ($noneRefusal -match 'none of the 4') $noneRefusal

Write-Host ''
Write-Host '== the classifier changes nothing it is not asked to change =='
$before = [int64]$script:WriteSeq
[void](Test-InputDelivery 1 9 'probe')
[void](Test-InputDelivery 9 1 'probe')
Check 'it does not stamp a write' ([int64]$script:WriteSeq -eq $before) "before=$before after=$([int64]$script:WriteSeq)"
$held = $script:HeldKeys.Count
Check 'and it holds no input open' ([int]$script:HeldKeys.Count -eq [int]$held) "held=$($script:HeldKeys.Count)"

Write-Host ''
Write-Host "$passed passed, $($failures.Count) failed"
if ($failures.Count -gt 0) {
    Write-Host ''
    Write-Host 'failures:'
    foreach ($failure in $failures) { Write-Host "  - $failure" }
    exit 1
}
exit 0
