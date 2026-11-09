Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int index);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$found = New-Object System.Collections.ArrayList
$callback = {
  param($hWnd, $lParam)
  $sb = New-Object System.Text.StringBuilder 256
  [void][Win]::GetClassName($hWnd, $sb, 256)
  $name = $sb.ToString()
  if ($name -like 'Dsh*') {
    $r = New-Object Win+RECT
    [void][Win]::GetWindowRect($hWnd, [ref]$r)
    $ex = [Win]::GetWindowLong($hWnd, -20)
    [void]$found.Add([pscustomobject]@{
      Class = $name; Visible = [Win]::IsWindowVisible($hWnd);
      X = $r.Left; Y = $r.Top; W = ($r.Right - $r.Left); H = ($r.Bottom - $r.Top);
      ExStyle = ('0x{0:X}' -f $ex)
    })
  }
  return $true
}
[void][Win]::EnumWindows($callback, [IntPtr]::Zero)
if ($found.Count -eq 0) { "no DSH overlay windows found" } else { $found | Format-Table -AutoSize | Out-String -Width 120 }
