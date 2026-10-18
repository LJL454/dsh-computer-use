# The independent release path (9.txt §6 item 4).
#
# The worker unwinds whatever it still believes is held in a `finally` -- and a killed process
# never reaches its `finally`. So when the host has to force a worker away while it is holding a
# mouse button or a key, the release has to come from *another* process. This is that process:
# it is handed the state file the worker mirrors (`DSH_COMPUTER_USE_HELD_FILE`), injects the
# releases for exactly what is in it, and reports what it did.
#
# Two rules it must not break:
#   - it releases only what the file names. Sending key-ups for keys nobody holds is harmless in
#     itself, but claiming a desktop was tidied when the list was invented is not.
#   - a failure to release is reported as a failure. "The worker was killed" and "the input was
#     released" are two different facts, and the caller has to be able to tell them apart.
#
# Usage:
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File backend\release-input.ps1 -StateFile <path> [-KeepState]
#
# Prints one JSON line: {"ok":true,"released":["mouse:left","key:16"],"note":""} or
#                     {"ok":false,"released":[],"error":"..."}.

param(
    [Parameter(Mandatory = $true)][string]$StateFile,
    # Leave the state file in place (used by tests; the host always clears it on success).
    [switch]$KeepState
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- SendInput, self-contained
# Deliberately a second, small definition rather than a dot-source of worker.ps1: this script has
# to run when the worker is *gone*, and loading a 650 KB worker to send two events would make the
# release depend on the very machinery it is there to replace.
$signature = @'
using System;
using System.Runtime.InteropServices;

public static class DshReleaseNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public MOUSEKEYBDHARDWAREINPUT u;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct MOUSEKEYBDHARDWAREINPUT {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    private const uint INPUT_MOUSE = 0;
    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_EXTENDEDKEY = 0x0001;

    public static INPUT Mouse(uint flags) {
        INPUT input = new INPUT();
        input.type = INPUT_MOUSE;
        input.u.mi.dwFlags = flags;
        return input;
    }

    public static INPUT Key(ushort vk, uint flags) {
        INPUT input = new INPUT();
        input.type = INPUT_KEYBOARD;
        input.u.ki.wVk = vk;
        input.u.ki.dwFlags = flags;
        return input;
    }

    public static int Send(INPUT[] inputs) {
        return (int)SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    }
}
'@

try { Add-Type -TypeDefinition $signature -ErrorAction Stop } catch {
    # A second copy of the same type in one session is fine to ignore; a real compile failure is
    # reported by the caller's own Send() call below.
}

function Get-Label([int]$vk, [int]$downFlags) {
    if ($vk -ge 0) { return "key:$vk" }
    switch ($downFlags) {
        0x0002 { return 'mouse:left' }
        0x0008 { return 'mouse:right' }
        0x0020 { return 'mouse:middle' }
        default { return "mouse:$downFlags" }
    }
}

$released = New-Object System.Collections.Generic.List[string]
$error_ = ''

if (-not (Test-Path -LiteralPath $StateFile)) {
    # Nothing was recorded, so nothing is claimed. This is the common case and it is a success.
    [Console]::Out.WriteLine(([ordered]@{ ok = $true; released = @(); note = 'no held input was recorded' } | ConvertTo-Json -Compress))
    exit 0
}

try {
    $raw = [System.IO.File]::ReadAllText($StateFile)
    $state = $raw | ConvertFrom-Json
} catch {
    [Console]::Out.WriteLine(([ordered]@{ ok = $false; released = @(); error = "the held-input record could not be read: $($_.Exception.Message)" } | ConvertTo-Json -Compress))
    exit 2
}

$keys = @()
$buttons = @()
if ($null -ne $state.keys) { $keys = @($state.keys | ForEach-Object { [int]$_ }) }
if ($null -ne $state.buttons) { $buttons = @($state.buttons | ForEach-Object { [int]$_ }) }

$events = New-Object System.Collections.Generic.List[object]
foreach ($vk in $keys) {
    # Extended keys need the extended flag or the release lands on the wrong key.
    $flags = 0x0002
    if (@(0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B, 0x5C, 0x5D, 0x6F, 0x0D, 0xA3, 0xA5) -contains $vk) {
        $flags = $flags -bor 0x0001
    }
    $events.Add([DshReleaseNative]::Key([uint16]$vk, [uint32]$flags))
    $released.Add((Get-Label $vk -1))
}
foreach ($down in $buttons) {
    # The DOWN/UP pairs: UP is DOWN * 2 on the low nibbles.
    $events.Add([DshReleaseNative]::Mouse([uint32]($down * 2)))
    $released.Add((Get-Label -1 $down))
}

if ($events.Count -eq 0) {
    if (-not $KeepState) { Remove-Item -LiteralPath $StateFile -Force -ErrorAction SilentlyContinue }
    [Console]::Out.WriteLine(([ordered]@{ ok = $true; released = @(); note = 'the record was empty' } | ConvertTo-Json -Compress))
    exit 0
}

$sent = 0
try {
    $sent = [int][DshReleaseNative]::Send($events.ToArray())
} catch {
    $error_ = "SendInput failed: $($_.Exception.Message)"
}

if ($error_ -eq '' -and $sent -lt $events.Count) {
    $error_ = "SendInput inserted $sent of $($events.Count) release event(s), so the desktop may still be holding something"
}

# Only the releases that were really delivered are reported, and the record is cleared only when
# everything was delivered -- a partially released desktop has to be re-tried, not forgotten.
$delivered = $released.ToArray()
if ($error_ -ne '') { $delivered = @($delivered[0..([Math]::Max(-1, $sent - 1))]) }
$ok = ($error_ -eq '')
if ($ok -and -not $KeepState) { Remove-Item -LiteralPath $StateFile -Force -ErrorAction SilentlyContinue }

[Console]::Out.WriteLine(([ordered]@{
    ok       = $ok
    released = @($delivered)
    pid      = $state.pid
    error    = $error_
} | ConvertTo-Json -Compress))
exit $(if ($ok) { 0 } else { 3 })
