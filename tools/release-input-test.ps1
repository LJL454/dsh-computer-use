# §6 item 4: the independent release path must release exactly what was recorded, and must say
# so when it cannot.
#
# The worker's own `finally` never runs for a killed process, so the host needs a release that
# lives *outside* the worker. `backend/release-input.ps1` is that path. These checks drive it with
# fabricated state files -- a release is idempotent, so injecting key-ups and button-ups for
# something this session is not holding is harmless, which is what makes the real script testable.
#
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File tools/release-input-test.ps1

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$plugin = Split-Path -Parent $here
$script = Join-Path $plugin 'backend\release-input.ps1'
$scratch = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-release-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
[void](New-Item -ItemType Directory -Path $scratch -Force)

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

function Invoke-Release([string]$statePath, [switch]$KeepState) {
    $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $script, '-StateFile', $statePath)
    if ($KeepState) { $arguments += '-KeepState' }
    $output = & powershell @arguments 2>&1
    $text = ($output | Out-String).Trim()
    $last = ($text -split "`r?`n" | Where-Object { $_.Trim() -ne '' } | Select-Object -Last 1)
    $parsed = $null
    try { $parsed = $last | ConvertFrom-Json } catch { $parsed = $null }
    return [pscustomobject]@{ raw = $text; json = $parsed; code = $LASTEXITCODE }
}

try {
    Write-Host '== nothing recorded is a success, and nothing is claimed =='
    $absent = Join-Path $scratch 'absent.json'
    $none = Invoke-Release $absent
    Check 'the script answers with JSON' ($null -ne $none.json) $none.raw
    Check 'no held input is reported as ok' ($none.json.ok -eq $true) $none.raw
    Check 'and it releases nothing' (@($none.json.released).Count -eq 0) $none.raw
    Check 'saying why rather than inventing work' ($none.json.note -match 'no held input') $none.raw

    Write-Host ''
    Write-Host '== what is recorded is what is released =='
    $state = Join-Path $scratch 'held.json'
    [System.IO.File]::WriteAllText($state, '{"pid":4242,"bootGen":"ab12","keys":[16,91],"buttons":[2]}', (New-Object System.Text.UTF8Encoding($false)))
    $released = Invoke-Release $state
    Check 'the record is read and reported ok' ($released.json.ok -eq $true) $released.raw
    Check 'a shift key is released as itself' (@($released.json.released) -contains 'key:16') $released.raw
    Check 'the left button is released as itself' (@($released.json.released) -contains 'mouse:left') $released.raw
    Check 'the extended key is released too' (@($released.json.released) -contains 'key:91') $released.raw
    Check 'exactly the recorded items, no more' (@($released.json.released).Count -eq 3) $released.raw
    Check 'the process that recorded them is named' ($released.json.pid -eq 4242) $released.raw
    Check 'and the record is cleared once every release was delivered' (-not (Test-Path -LiteralPath $state)) 'the state file survived'

    Write-Host ''
    Write-Host '== a right button is not reported as a left one =='
    $rightState = Join-Path $scratch 'right.json'
    [System.IO.File]::WriteAllText($rightState, '{"pid":7,"keys":[],"buttons":[8,32]}', (New-Object System.Text.UTF8Encoding($false)))
    $right = Invoke-Release $rightState
    Check 'the right button is named right' (@($right.json.released) -contains 'mouse:right') $right.raw
    Check 'the middle button is named middle' (@($right.json.released) -contains 'mouse:middle') $right.raw
    Check 'and the mislabelling direction is impossible' (-not (@($right.json.released) -contains 'mouse:left')) $right.raw

    Write-Host ''
    Write-Host '== a record that cannot be read is a reported failure, never a silent success =='
    $broken = Join-Path $scratch 'broken.json'
    [System.IO.File]::WriteAllText($broken, '{ this is not json', (New-Object System.Text.UTF8Encoding($false)))
    $bad = Invoke-Release $broken
    Check 'it does not claim ok' ($bad.json.ok -eq $false) $bad.raw
    Check 'it says what was wrong' ($bad.json.error -match 'could not be read') $bad.raw
    Check 'it releases nothing' (@($bad.json.released).Count -eq 0) $bad.raw
    Check 'it exits non-zero, so a caller cannot read success by accident' ($bad.code -ne 0) "exit=$($bad.code)"
    Check 'and the unreadable record is left for the caller to inspect' (Test-Path -LiteralPath $broken) 'it was deleted anyway'

    Write-Host ''
    Write-Host '== an empty record clears the file and claims nothing =='
    $empty = Join-Path $scratch 'empty.json'
    [System.IO.File]::WriteAllText($empty, '{"pid":1,"keys":[],"buttons":[]}', (New-Object System.Text.UTF8Encoding($false)))
    $nothing = Invoke-Release $empty
    Check 'an empty record is ok' ($nothing.json.ok -eq $true) $nothing.raw
    Check 'with nothing released' (@($nothing.json.released).Count -eq 0) $nothing.raw
    Check 'and the file is cleared' (-not (Test-Path -LiteralPath $empty)) 'still there'

    Write-Host ''
    Write-Host '== KeepState leaves the record for the caller (used when the release is only partial) =='
    $kept = Join-Path $scratch 'kept.json'
    [System.IO.File]::WriteAllText($kept, '{"pid":9,"keys":[16],"buttons":[]}', (New-Object System.Text.UTF8Encoding($false)))
    $keptRun = Invoke-Release $kept -KeepState
    Check 'the release still happens' (@($keptRun.json.released) -contains 'key:16') $keptRun.raw
    Check 'and the record survives for the caller' (Test-Path -LiteralPath $kept) 'it was removed'
} finally {
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
$total = $passed + $failures.Count
Write-Host "$passed/$total checks passed"
if ($failures.Count -gt 0) {
    foreach ($failure in $failures) { Write-Host "  - $failure" }
    exit 1
}
exit 0
