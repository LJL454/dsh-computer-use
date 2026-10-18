# The batch's capture request normalisation, checked by passing arguments to the shipping
# function rather than by reading a reply (9.txt §5.4: 用参数传递测试验证输入).
#
# Dot-sourcing worker.ps1 runs its startup code and then its request loop, which ends at
# once because stdin is at EOF -- so the functions are available and nothing is dispatched
# to the desktop. `New-CaptureArgs` is then called with the argument shapes the host really
# sends, and what it resolves is asserted field by field.
#
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File tools\capture-spec-test.ps1

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

# The startup output of the worker (its readiness line) is not part of this test.
$null = . $worker

Write-Host '== the batch-level request reaches every capture it takes (9.txt §5.4) =='
$base = @{
    path = 'C:\tmp\batch.png'; display = 0; region = $null; regionSpace = 'window'; surface = 'client'
    clip = $true; format = 'jpeg'; quality = 80; scale = 0.5; settleMs = 120; stabilityMs = $null; stable = $null
}
$trailing = New-CaptureArgs $base
Check 'the trailing capture keeps the space the region is in' ("$($trailing.regionSpace)" -eq 'window') "regionSpace=$($trailing.regionSpace)"
Check 'and the clip request' ($trailing.clip -eq $true) "clip=$($trailing.clip)"
Check 'and the surface' ("$($trailing.surface)" -eq 'client') "surface=$($trailing.surface)"
Check 'and the scale' ([double]$trailing.scale -eq 0.5) "scale=$($trailing.scale)"
Check 'and the path' ("$($trailing.path)" -eq 'C:\tmp\batch.png') "path=$($trailing.path)"

Write-Host ''
Write-Host '== a step overrides only what it names (9.txt §5.4) =='
$step = [pscustomobject]@{ scale = 0.25; surface = 'window'; settle_ms = 0; path = 'C:\tmp\step.png' }
$stepArgs = New-CaptureArgs $base $step
Check 'the step scale wins' ([double]$stepArgs.scale -eq 0.25) "scale=$($stepArgs.scale)"
Check 'the step surface wins' ("$($stepArgs.surface)" -eq 'window') "surface=$($stepArgs.surface)"
Check 'the step settle floor wins' ([int]$stepArgs.settleMs -eq 0) "settleMs=$($stepArgs.settleMs)"
Check 'the step path wins' ("$($stepArgs.path)" -eq 'C:\tmp\step.png') "path=$($stepArgs.path)"
Check 'and what the step did not name still comes from the batch' ("$($stepArgs.regionSpace)" -eq 'window' -and $stepArgs.clip -eq $true) "regionSpace=$($stepArgs.regionSpace) clip=$($stepArgs.clip)"
Check 'the batch request itself was not mutated' ([double]$base.scale -eq 0.5 -and "$($base.surface)" -eq 'client') "scale=$($base.scale) surface=$($base.surface)"

Write-Host ''
Write-Host '== a step that spells region_space the way a caller might still lands (9.txt §5.4) =='
$snake = [pscustomobject]@{ region_space = 'screen'; clip = $false }
$snakeArgs = New-CaptureArgs $base $snake
Check 'the snake_case spelling is read too' ("$($snakeArgs.regionSpace)" -eq 'screen') "regionSpace=$($snakeArgs.regionSpace)"
Check 'and an explicit false clears the batch clip' ($snakeArgs.clip -eq $false) "clip=$($snakeArgs.clip)"

Write-Host ''
Write-Host '== a window named by the step carries its own requirement (9.txt §5.4) =='
$windowed = New-CaptureArgs $base ([pscustomobject]@{ window = 4242 })
Check 'the step window is used' ([int64]$windowed.window -eq 4242) "window=$($windowed.window)"
Check 'and it is required rather than falling back to the screen' ($windowed.requireWindow -eq $true) "requireWindow=$($windowed.requireWindow)"

Write-Host ''
Write-Host '== reuse is a claim about the whole request, not just the scale (9.txt §7.3) =='
$same = New-CaptureArgs $base
Check 'an identical request is the same picture' (Test-SameCaptureSpec $trailing $same)
$otherScale = New-CaptureArgs $base ([pscustomobject]@{ scale = 0.25 })
Check 'another scale is another picture' (-not (Test-SameCaptureSpec $trailing $otherScale))
$otherSpace = New-CaptureArgs $base
$otherSpace['regionSpace'] = 'screen'
Check 'another region space is another picture' (-not (Test-SameCaptureSpec $trailing $otherSpace))
$otherClip = New-CaptureArgs $base
$otherClip['clip'] = $false
Check 'another clip request is another picture' (-not (Test-SameCaptureSpec $trailing $otherClip))
$withRegion = New-CaptureArgs $base
$withRegion['region'] = [pscustomobject]@{ x = 1; y = 2; width = 3; height = 4 }
Check 'a rectangle the other one does not have is another picture' (-not (Test-SameCaptureSpec $trailing $withRegion))
$sameRegion = New-CaptureArgs $base
$sameRegion['region'] = [pscustomobject]@{ x = 1; y = 2; width = 3; height = 4 }
Check 'and the same rectangle in the same space is the same picture' (Test-SameCaptureSpec $withRegion $sameRegion)

Write-Host ''
Write-Host "$passed passed, $($failures.Count) failed"
if ($failures.Count -gt 0) {
    Write-Host ''
    Write-Host 'failures:'
    foreach ($failure in $failures) { Write-Host "  - $failure" }
    exit 1
}
exit 0
