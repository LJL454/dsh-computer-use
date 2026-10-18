# Compile just the C# blocks of worker.ps1, so a syntax error in either Add-Type
# source is reported as a line number instead of as "the worker answered nothing".
# It does not need a desktop, a window or the plugin: Add-Type only compiles.
[CmdletBinding()]
param(
    [string]$Worker = ''
)

$ErrorActionPreference = 'Stop'
if ($Worker -eq '') {
    # $PSScriptRoot is not populated while a param default is evaluated on PowerShell 5.1,
    # and this check has to run on the same engine the worker runs on.
    $here = Split-Path -Parent $MyInvocation.MyCommand.Path
    $Worker = Join-Path $here 'backend\worker.ps1'
}
$lines = Get-Content -LiteralPath $Worker
$blocks = @()

# The two here-strings are the native helper and the COM UI Automation engine. Read them
# by their `@' ... '@` delimiters rather than by line number, so this keeps working when
# either block grows.
$open = $null
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^\s*\`$(\w+Source)\s*=\s*@'\s*$") {
        $open = @{ name = $Matches[1]; start = $i + 1 }
        continue
    }
    if ($null -ne $open -and $lines[$i] -match "^'@\s*$") {
        $blocks += [pscustomobject]@{
            name = $open.name
            start = $open.start
            end = $i - 1
            text = ($lines[$open.start..($i - 1)] -join "`n")
        }
        $open = $null
    }
}

if ($blocks.Count -eq 0) { throw "no Add-Type source blocks found in $Worker" }

$failed = 0
foreach ($block in $blocks) {
    try {
        Add-Type -TypeDefinition $block.text -Language CSharp -ErrorAction Stop | Out-Null
        Write-Host "OK   $($block.name) ($($block.text.Length) chars)"
    } catch {
        $failed++
        Write-Host "FAIL $($block.name) (worker.ps1 lines $($block.start)-$($block.end))"
        # Everything the compiler said, from wherever PowerShell keeps it: Add-Type puts
        # the useful part in a different place on 5.1 than on 7.
        $text = @()
        foreach ($record in @($_.Exception.Data['CompilerErrors'])) { $text += "$record" }
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $text += $_.ErrorDetails.Message }
        if ($text.Count -eq 0) { $text = @("$($_.Exception.Message)") }
        foreach ($line in ($text -join "`n" -split "`r?`n")) {
            if ($line.Trim() -ne '') { Write-Host "  $($line.Trim())" }
        }
    }
}

if ($failed -gt 0) { exit 1 }
Write-Host 'all C# blocks compiled'
