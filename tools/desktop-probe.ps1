# Desktop state helper for the soak harness (9.txt §12.2: "clean machine" runs).
#
# Why this exists: `MainWindowTitle` stays populated for MINIMIZED windows, so counting
# processes by title says nothing about what is actually on screen and competing with a
# screenshot. The honest question is "which top-level windows are visible AND not iconic",
# which needs two Win32 calls.
#
# Usage:
#   powershell -File tools/desktop-probe.ps1                 # list live windows (JSON)
#   powershell -File tools/desktop-probe.ps1 -Focus "notepad"    # restore + foreground a window
#   powershell -File tools/desktop-probe.ps1 -Minimize "settings"
#   powershell -File tools/desktop-probe.ps1 -Place "notepad" -Rect "0,0,900,600"
#
# ASCII only: PowerShell 5.1 decodes BOM-less .ps1 as ANSI, so non-ASCII in string literals
# mis-parses (the worker.ps1 notes say the same thing).
param(
    [string]$Focus = '',
    [string]$Minimize = '',
    [string]$Place = '',
    [string]$Rect = ''
)

$code = @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class DshDeskProbe {
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  delegate bool EnumProc(IntPtr h, IntPtr p);

  public static bool Move(IntPtr h, int x, int y, int cx, int cy) {
    // SWP_NOZORDER keeps whatever stacking order exists: placing a window must not change focus.
    return SetWindowPos(h, IntPtr.Zero, x, y, cx, cy, 0x0004 | 0x0010);
  }

  public static List<string> Titles(bool liveOnly) {
    var list = new List<string>();
    EnumWindows((h, p) => {
      if (liveOnly && (!IsWindowVisible(h) || IsIconic(h))) return true;
      int len = GetWindowTextLength(h);
      if (len <= 0) return true;
      var sb = new StringBuilder(len + 1);
      GetWindowText(h, sb, sb.Capacity);
      list.Add(h.ToInt64().ToString() + "|" + sb.ToString());
      return true;
    }, IntPtr.Zero);
    return list;
  }

  public static int Act(IntPtr h, string what) {
    if (what == "minimize") return ShowWindow(h, 6) ? 1 : 0;   // SW_MINIMIZE
    ShowWindow(h, 9);                                          // SW_RESTORE
    return SetForegroundWindow(h) ? 1 : 0;
  }
}
'@
Add-Type -TypeDefinition $code -Language CSharp

function Get-Live {
    $rows = @()
    foreach ($entry in [DshDeskProbe]::Titles($true)) {
        $parts = $entry.Split('|', 2)
        $rows += [pscustomobject]@{ hwnd = [int64]$parts[0]; title = $parts[1] }
    }
    return $rows
}

if ($Minimize -ne '') {
    foreach ($row in Get-Live) {
        if ($row.title.ToLower().Contains($Minimize.ToLower())) {
            $null = [DshDeskProbe]::Act([IntPtr]$row.hwnd, 'minimize')
            Write-Output ("minimized: " + $row.title)
        }
    }
}

if ($Focus -ne '') {
    # Restore and foreground the named window; report whether the call was accepted.
    $found = $false
    foreach ($entry in [DshDeskProbe]::Titles($false)) {
        $parts = $entry.Split('|', 2)
        if ($parts[1].ToLower().Contains($Focus.ToLower())) {
            $ok = [DshDeskProbe]::Act([IntPtr][int64]$parts[0], 'focus')
            Write-Output ("focus " + $parts[1] + " -> " + $ok)
            $found = $true
        }
    }
    if (-not $found) { Write-Output ("focus: no window matching " + $Focus) }
}

if ($Place -ne '' -and $Rect -ne '') {
    # Put the fixture at a fixed rectangle so the screen-region screenshot is the same pixels
    # every run (a window that drifts makes "the same scenario" a fiction).
    $numbers = $Rect.Split(',')
    if ($numbers.Count -eq 4) {
        $x = [int]$numbers[0]; $y = [int]$numbers[1]; $w = [int]$numbers[2]; $h = [int]$numbers[3]
        foreach ($entry in [DshDeskProbe]::Titles($false)) {
            $parts = $entry.Split('|', 2)
            if ($parts[1].ToLower().Contains($Place.ToLower())) {
                $ok = [DshDeskProbe]::Move([IntPtr][int64]$parts[0], $x, $y, $w, $h)
                Write-Output ("place " + $parts[1] + " at " + $Rect + " -> " + $ok)
            }
        }
    } else {
        Write-Output ("place: -Rect must be x,y,w,h (got " + $Rect + ")")
    }
}

Start-Sleep -Milliseconds 300
$live = Get-Live
Write-Output ("live windows: " + $live.Count)
foreach ($row in $live) { Write-Output ("  " + $row.hwnd + "  " + $row.title) }
