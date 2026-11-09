Add-Type @"
using System;
using System.Runtime.InteropServices;
public class K {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@
Start-Sleep -Milliseconds 1200
[K]::keybd_event(0x1B, 0, 0, [UIntPtr]::Zero)   # key down
Start-Sleep -Milliseconds 60
[K]::keybd_event(0x1B, 0, 2, [UIntPtr]::Zero)   # key up
"synthetic Esc sent at $((Get-Date).ToString('HH:mm:ss.fff'))"
