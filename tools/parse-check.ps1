# Parse (do not run) worker.ps1, and report what encoding it is in.
#
# `compile-check.ps1` covers the two C# here-strings; this covers the PowerShell around
# them, which is where a hand edit goes wrong. A 500 KB script edited by something that
# writes the wrong encoding fails in the worst possible way: PowerShell 5.1 reads a
# no-BOM file as ANSI, so UTF-8 Chinese turns into mojibake *inside string literals* --
# the script still parses, still runs, and quietly hands the model garbage. Both halves
# are checked here so that neither can pass unnoticed.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\parse-check.ps1
[CmdletBinding()]
param(
    [string]$Worker = ''
)

$ErrorActionPreference = 'Stop'
if ($Worker -eq '') {
    $here = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
    $Worker = Join-Path $here 'backend\worker.ps1'
}
if (-not (Test-Path -LiteralPath $Worker)) { throw "worker script not found: $Worker" }

$bytes = [System.IO.File]::ReadAllBytes($Worker)
$hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
$utf8 = New-Object System.Text.UTF8Encoding($false, $false)
$decoded = $utf8.GetString($bytes)
# U+FFFD only appears when the bytes were not valid UTF-8; private-use characters are what
# a GBK second pass over UTF-8 text leaves behind. Either one means "this file has been
# through a re-encoding".
$broken = 0
$private = 0
foreach ($ch in $decoded.ToCharArray()) {
    $code = [int]$ch
    if ($code -eq 0xFFFD) { $broken++ }
    elseif ($code -ge 0xE000 -and $code -le 0xF8FF) { $private++ }
}

$tokens = $null
$errors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($Worker, [ref]$tokens, [ref]$errors)

Write-Host "worker: $Worker"
Write-Host ("bytes={0} lines={1} bom={2} replacement_chars={3} private_use_chars={4}" -f `
    $bytes.Length, ($decoded -split "`n").Count, $hasBom, $broken, $private)
$failed = $false
if ($hasBom) {
    Write-Host 'FAIL a UTF-8 BOM was added: worker.ps1 is expected to be UTF-8 without one'
    $failed = $true
}
if ($broken -gt 0 -or $private -gt 0) {
    Write-Host 'FAIL the text is not clean UTF-8: this file was re-encoded (ANSI/GBK round trip) and its Chinese strings are mojibake'
    $failed = $true
}
if ($errors.Count -gt 0) {
    $failed = $true
    Write-Host "FAIL $($errors.Count) parse error(s):"
    # NOT `$error`: it is a read-only automatic variable, so a `foreach ($error in ...)` here
    # threw "Cannot overwrite variable Error" and swallowed the very parse errors this script
    # exists to print -- the report said only that it could not report.
    foreach ($parseError in $errors) { Write-Host ("  line {0}: {1}" -f $parseError.Extent.StartLineNumber, $parseError.Message) }
} else {
    Write-Host 'OK   parses with no errors'
}
if ($failed) { exit 1 }
