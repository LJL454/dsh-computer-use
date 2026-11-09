# Enumerate overlay windows of a target process: visibility, rect, ex-style, capture affinity.
# ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI unless the file has a BOM,
# and a mangled comment can swallow the param block.
param([int]$TargetPid)
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class WinProbe {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr extra);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder name, int count);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);
  [DllImport("user32.dll")] public static extern int GetWindowDisplayAffinity(IntPtr hWnd, out uint affinity);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static List<string> Find(uint target) {
    var list = new List<string>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != target) return true;
      var name = new StringBuilder(128);
      GetClassName(h, name, 128);
      var rect = new RECT();
      GetWindowRect(h, out rect);
      uint affinity; GetWindowDisplayAffinity(h, out affinity);
      long style = GetWindowLongPtr(h, -20).ToInt64();
      list.Add(string.Format("{0}|{1}x{2}@{3},{4}|visible={5}|layered={6}|topmost={7}|affinity={8}",
        name.ToString(), rect.Right - rect.Left, rect.Bottom - rect.Top, rect.Left, rect.Top,
        IsWindowVisible(h), ((style & 0x80000) != 0), ((style & 0x8) != 0), affinity));
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
"@
[WinProbe]::SetProcessDpiAwarenessContext([IntPtr]-4) | Out-Null
$windows = [WinProbe]::Find([uint32]$TargetPid)
Write-Output "windows for pid ${TargetPid}: $($windows.Count)"
$windows | ForEach-Object { Write-Output $_ }
