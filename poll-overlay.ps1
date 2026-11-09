Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class W2 {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$deadline = (Get-Date).AddSeconds(14)
$events = New-Object System.Collections.ArrayList
while ((Get-Date) -lt $deadline) {
  $cb = {
    param($hWnd, $lParam)
    $sb = New-Object System.Text.StringBuilder 256
    [void][W2]::GetClassName($hWnd, $sb, 256)
    $name = $sb.ToString()
    if ($name -like 'Dsh*' -and [W2]::IsWindowVisible($hWnd)) {
      $r = New-Object W2+RECT
      [void][W2]::GetWindowRect($hWnd, [ref]$r)
      $stamp = (Get-Date).ToString('HH:mm:ss.fff')
      [void]$events.Add("$stamp VISIBLE $name at $($r.Left),$($r.Top) $($r.Right-$r.Left)x$($r.Bottom-$r.Top)")
    }
    return $true
  }
  [void][W2]::EnumWindows($cb, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 150
}
if ($events.Count -eq 0) { "no visible DSH window during the 14s window" } else {
  $events | Select-Object -First 4
  "..."
  $events | Select-Object -Last 2
  "total samples with a visible overlay: $($events.Count)"
}
