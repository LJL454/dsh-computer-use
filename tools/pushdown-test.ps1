# 9.txt §7.4 item 3: a condition goes to the provider only when pushing it down is equivalent.
#
# The tool matches a control type with a *substring* test, so `Button` and `ControlType.Button`
# are different questions. Pushing the partial one down as an exact UIA condition would silently
# drop rows the caller would otherwise have got -- the review names that as the trap. The rule is
# therefore: push down exactly-named control types, never partial ones; push down automationId,
# which is exact by definition.
#
# This file checks the classifier itself, and the two call sites' use of it, without a window.
#
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File tools\pushdown-test.ps1

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

Write-Host '== a fully named control type may be pushed down =='
Check 'ControlType.Button is exact' ([DshUia.Engine]::IsExactControlType('ControlType.Button')) 'not exact'
Check 'ControlType.Edit is exact' ([DshUia.Engine]::IsExactControlType('ControlType.Edit')) 'not exact'
Check 'the name is matched case-insensitively, as the provider name is' ([DshUia.Engine]::IsExactControlType('controltype.button')) 'not exact'
Check 'surrounding space does not change the answer' ([DshUia.Engine]::IsExactControlType(' ControlType.ListItem ')) 'not exact'

Write-Host ''
Write-Host '== a partial one may not: that would change what the caller gets =='
Check 'a bare name is not exact' (-not [DshUia.Engine]::IsExactControlType('Button')) 'treated as exact'
Check 'a prefix of a name is not exact' (-not [DshUia.Engine]::IsExactControlType('Butt')) 'treated as exact'
Check 'the prefix alone is not exact' (-not [DshUia.Engine]::IsExactControlType('ControlType.')) 'treated as exact'
Check 'an unknown type name is not exact' (-not [DshUia.Engine]::IsExactControlType('ControlType.NotAThing')) 'treated as exact'
Check 'a regex-flavoured argument is not exact' (-not [DshUia.Engine]::IsExactControlType('ControlType.Button|Edit')) 'treated as exact'
Check 'an empty argument is not exact' (-not [DshUia.Engine]::IsExactControlType('')) 'treated as exact'
Check 'null is not exact' (-not [DshUia.Engine]::IsExactControlType($null)) 'treated as exact'

Write-Host ''
Write-Host '== the id it maps to is the UIA control type id =='
Check 'Button maps to 50000' ([DshUia.Engine]::ControlTypeIdFor('ControlType.Button') -eq 50000) "got=$([DshUia.Engine]::ControlTypeIdFor('ControlType.Button'))"
Check 'Edit maps to 50004' ([DshUia.Engine]::ControlTypeIdFor('ControlType.Edit') -eq 50004) "got=$([DshUia.Engine]::ControlTypeIdFor('ControlType.Edit'))"
Check 'Document maps to 50030' ([DshUia.Engine]::ControlTypeIdFor('ControlType.Document') -eq 50030) "got=$([DshUia.Engine]::ControlTypeIdFor('ControlType.Document'))"
Check 'the bare name maps the same way' ([DshUia.Engine]::ControlTypeIdFor('Button') -eq 50000) "got=$([DshUia.Engine]::ControlTypeIdFor('Button'))"
Check 'an unknown name maps to zero, never to some other type' ([DshUia.Engine]::ControlTypeIdFor('NotAThing') -eq 0) "got=$([DshUia.Engine]::ControlTypeIdFor('NotAThing'))"

Write-Host ''
Write-Host '== and both engines use the rule =='
$source = [System.IO.File]::ReadAllText($worker)
Check 'the COM engine pushes an exact control type down' ($source -match 'else if \(IsExactControlType\(wantType\)\)') 'the C# find has no exact-type branch'
Check 'the managed engine pushes one down too' ($source -match '\[DshUia\.Engine\]::IsExactControlType\(\$wantType\)') 'the managed find has no exact-type branch'
Check 'the managed engine reports what it pushed down' ($source -match "pushedDown \+= 'controlType'") 'no controlType push-down report'
Check 'the COM engine reports what it pushed down' ($source -match "IsExactControlType\(\`$wantType\)\) \{ 'controlType' \}") 'no COM push-down report'
Check 'the partial name still goes through the substring test that was there before' ($source -match '\[regex\]::Escape\(\$wantType\)') 'the substring test disappeared'

Write-Host ''
$total = $passed + $failures.Count
Write-Host "$passed/$total checks passed"
if ($failures.Count -gt 0) {
    foreach ($failure in $failures) { Write-Host "  - $failure" }
    exit 1
}
exit 0
