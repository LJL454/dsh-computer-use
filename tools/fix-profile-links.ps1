# Repair the profile so that the host keeps loading its OWN @deepseek-ai packages.
#
# Why this exists
# ---------------
# The host resolves rows such as `tools` from <profile>\node_modules first, and only
# falls back to the copy bundled in the DeepSeek Harness install. Plugins that
# declared `@deepseek-ai/dsh-tools` as a peer made the package manager drop a real
# copy into <profile>\node_modules; from then on the host loaded that copy. When the
# copy did not match the running app the `tools` row was disabled, every row that
# injects it started waiting, and the app refused to start with:
#     The application could not start or stopped unexpectedly.
#     agent-loop (required)  tools ...
#
# 1.40.1 no longer declares that peer, so a fresh install cannot create the copy.
# Profiles installed with 1.39.x or with 1.40.0 can still contain it: run this once.
#
# usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\fix-profile-links.ps1
#   powershell ... -File tools\fix-profile-links.ps1 -CheckOnly
#   powershell ... -File tools\fix-profile-links.ps1 -Profile desktop,web

param(
    [string[]]$Profile = @('desktop'),
    [string]$DshHome = '',
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($DshHome)) {
    $DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
}
$LINKED = @('dsh-tools', 'dsh-scope')
$appRoot = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\app\dsh\node_modules\@deepseek-ai'

if (-not (Test-Path $appRoot)) {
    $asar = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\app.asar'
    if (Test-Path $asar) {
        Write-Output 'SKIP: the host runs from resources\app.asar (official layout).'
        Write-Output '      The official loader resolves @deepseek-ai peers itself; no junction is needed.'
        Write-Output '      Run `node setup.mjs --check` for the full picture.'
        exit 0
    }
    Write-Output "SKIP: host package directory not found: $appRoot"
    Write-Output "      Pass -DshHome and install the plugin on the machine that runs DSH."
    exit 3
}

function Get-PkgVersion([string]$dir) {
    $f = Join-Path $dir 'package.json'
    if (-not (Test-Path $f)) { return '(no package.json)' }
    try { return (Get-Content $f -Raw | ConvertFrom-Json).version } catch { return '(unreadable)' }
}

$problems = 0
$repaired = 0

foreach ($p in $Profile) {
    $nm = Join-Path $DshHome "profiles\$p\node_modules\@deepseek-ai"
    if (-not (Test-Path $nm)) {
        Write-Output ("[{0}] no node_modules yet - nothing to repair" -f $p)
        continue
    }
    foreach ($name in $LINKED) {
        $dst = Join-Path $nm $name
        $src = Join-Path $appRoot $name

        if (-not (Test-Path $dst)) {
            Write-Output ("[{0}] {1,-10} absent -> host falls back to the app copy (ok)" -f $p, $name)
            continue
        }

        $item  = Get-Item $dst -Force
        $isLink = [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)

        if ($isLink) {
            $target = @($item.Target)[0]
            if ($target -and (Test-Path $target)) {
                Write-Output ("[{0}] {1,-10} junction -> {2} (ok)" -f $p, $name, $target)
            } else {
                $problems++
                Write-Output ("[{0}] {1,-10} junction is dangling: {2}" -f $p, $name, $target)
            }
            continue
        }

        # A real directory: exactly the state that breaks the host.
        $problems++
        $profVer = Get-PkgVersion $dst
        $appVer  = Get-PkgVersion $src
        Write-Output ("[{0}] {1,-10} REAL COPY version={2} (app has {3})" -f $p, $name, $profVer, $appVer)

        if ($CheckOnly) { continue }

        cmd /c rmdir /s /q "`"$dst`"" | Out-Null
        cmd /c mklink /J "`"$dst`"" "`"$src`"" | Out-Null
        if (Test-Path (Join-Path $dst 'package.json')) {
            $repaired++
            Write-Output ("[{0}] {1,-10} replaced with a junction to the app copy" -f $p, $name)
        } else {
            Write-Output ("[{0}] {1,-10} REPAIR FAILED - check permissions" -f $p, $name)
        }
    }
}

# A copy that is a declared dependency cannot be pruned by an install: pnpm puts it back.
# Report it here, because replacing the directory would only hold until the next install.
$declared = 0
foreach ($p in $Profile) {
    $manifest = Join-Path $DshHome "profiles\$p\package.json"
    if (-not (Test-Path $manifest)) { continue }
    try { $pkg = Get-Content $manifest -Raw | ConvertFrom-Json } catch { continue }
    foreach ($section in 'dependencies', 'devDependencies', 'optionalDependencies') {
        $block = $pkg.$section
        if ($null -eq $block) { continue }
        foreach ($name in $LINKED) {
            if ($block.PSObject.Properties.Name -contains "@deepseek-ai/$name") {
                Write-Output ("[{0}] package.json DECLARES @deepseek-ai/{1} in {2} - delete that line, or the next install restores the copy" -f $p, $name, $section)
                $declared++
            }
        }
    }
}

Write-Output ''
if ($problems -eq 0 -and $declared -eq 0) {
    Write-Output 'OK: every profile uses the host copy. Nothing can shadow the tools row.'
    exit 0
}
if ($CheckOnly) {
    Write-Output ("FOUND {0} path problem(s), {1} declared dependency line(s). Re-run without -CheckOnly to repair the paths." -f $problems, $declared)
    exit 1
}
if ($repaired -gt 0 -and $declared -eq 0) {
    Write-Output ("Repaired {0} path(s). Fully quit and restart DSH." -f $repaired)
    exit 0
}
if ($repaired -gt 0) {
    Write-Output ("Repaired {0} path(s), but the profile still DECLARES the package - delete those package.json lines too, then restart DSH." -f $repaired)
    exit 1
}
Write-Output 'Nothing was repaired. Review the lines above.'
exit 1
