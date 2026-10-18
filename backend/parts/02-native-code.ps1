# ---------------------------------------------------------------- native code

$nativeSource = @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class DshNative
{
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public InputUnion U; }

    public const uint INPUT_MOUSE = 0;
    public const uint INPUT_KEYBOARD = 1;

    public const uint MOUSEEVENTF_MOVE = 0x0001;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    public const uint MOUSEEVENTF_HWHEEL = 0x1000;
    public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
    public const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;

    public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint KEYEVENTF_UNICODE = 0x0004;

    public const int SM_XVIRTUALSCREEN = 76;
    public const int SM_YVIRTUALSCREEN = 77;
    public const int SM_CXVIRTUALSCREEN = 78;
    public const int SM_CYVIRTUALSCREEN = 79;

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    /// How many times the clipboard has changed since Windows started.
    ///
    /// This is what a borrow needs to know: it says *that* the clipboard changed under us,
    /// not who changed it (8.txt §6 -- a sequence number judges change, never authorship).
    [DllImport("user32.dll")]
    public static extern uint GetClipboardSequenceNumber();

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern IntPtr GetShellWindow();

    [DllImport("user32.dll")]
    public static extern int GetWindowLongW(IntPtr hWnd, int nIndex);

    public const int GWL_EXSTYLE = -20;
    public const int WS_EX_TOOLWINDOW = 0x00000080;
    public const int WS_EX_APPWINDOW = 0x00040000;
    public const int DWMWA_CLOAKED = 14;

    /// True for a window the DWM has cloaked: a suspended or hidden UWP surface
    /// still passes IsWindowVisible while being invisible to the user, so a window
    /// list built without this check offers the model targets it cannot act on.
    public static bool IsCloaked(IntPtr hWnd)
    {
        try
        {
            int cloaked;
            if (DwmGetWindowAttributeInt(hWnd, DWMWA_CLOAKED, out cloaked, 4) != 0) return false;
            return cloaked != 0;
        }
        catch (Exception) { return false; }
    }

    /// A pure tool window (WS_EX_TOOLWINDOW without WS_EX_APPWINDOW) is a floating
    /// helper surface -- a tooltip, a hidden message window -- not an application
    /// window, and the shell itself keeps those off the taskbar.
    public static bool IsToolWindow(IntPtr hWnd)
    {
        try
        {
            int ex = GetWindowLongW(hWnd, GWL_EXSTYLE);
            return (ex & (WS_EX_APPWINDOW | WS_EX_TOOLWINDOW)) == WS_EX_TOOLWINDOW;
        }
        catch (Exception) { return false; }
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);

    public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    public static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
    public const int WS_EX_TOPMOST = 0x00000008;

    /// Whether a window is currently flagged topmost, so the raise below can put it back.
    public static bool IsTopmost(IntPtr hWnd)
    {
        try { return (GetWindowLongW(hWnd, GWL_EXSTYLE) & WS_EX_TOPMOST) != 0; }
        catch (Exception) { return false; }
    }
    public const uint SWP_NOMOVE = 0x0002;
    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_SHOWWINDOW = 0x0040;

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    // The client area: the part of a window that belongs to the application, without its
    // title bar, borders or resize grips. `ClientToScreen` turns its origin into a screen
    // point, which is what places it inside the window's own bitmap (方案 §2.2 捕获面).
    [DllImport("user32.dll")]
    public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);

    // Ask the window to render itself into a DC. The point is that the window does the
    // drawing: whatever covers it on screen is not involved, which is the one thing a
    // screen BitBlt cannot give. PW_RENDERFULLCONTENT (0x2, Windows 8.1+) is what makes
    // it work for DirectComposition windows -- Chromium and Electron among them -- where
    // the plain form returns an empty frame.
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

    // What is actually under a screen point, and which window a handle belongs to.
    // WindowFromPoint answers the first in microseconds and without starting an
    // accessibility client, which is the difference between a landing guard that can run
    // on *every* coordinate action and one that can only afford to run when a window is
    // known to have moved.
    [DllImport("user32.dll")]
    public static extern IntPtr WindowFromPoint(POINT point);

    [DllImport("user32.dll")]
    public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    public const uint GA_PARENT = 1;
    public const uint GA_ROOT = 2;
    public const uint GA_ROOTOWNER = 3;
    public const uint GW_OWNER = 4;

    // The DPI a window is being rendered at. A window dragged onto a monitor with another
    // scale factor is re-rendered at a new DPI while its rectangle can stay exactly the
    // same, so "the window has not moved or resized" is not the same statement as "its
    // pixels still mean what they meant". A missing export (older Windows) answers 0, which
    // is reported as unknown rather than treated as a match.
    [DllImport("user32.dll", SetLastError = false)]
    public static extern uint GetDpiForWindow(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = false)]
    public static extern uint GetDpiForSystem();

    public static uint DpiForWindowOrZero(IntPtr hWnd)
    {
        try { return GetDpiForWindow(hWnd); } catch (Exception) { return 0; }
    }

    public static uint SystemDpiOrZero()
    {
        try { return GetDpiForSystem(); } catch (Exception) { return 0; }
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassNameW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);

    [DllImport("user32.dll")]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

    [DllImport("shcore.dll")]
    public static extern int SetProcessDpiAwareness(int value);

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool CloseDesktop(IntPtr hDesktop);

    public const uint DESKTOP_READOBJECTS = 0x0001;

    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

    /// Same entry point, 4-byte attribute. The native function demands a size that
    /// matches the attribute, so the cloak query cannot reuse the RECT overload.
    [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")]
    public static extern int DwmGetWindowAttributeInt(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern int SHGetKnownFolderPath(ref Guid rfid, uint dwFlags, IntPtr hToken, out IntPtr ppszPath);

    /// Resolve a KNOWNFOLDERID to its real directory. Start-menu entries for
    /// classic apps are stored as "{known-folder-guid}\\vendor\\app.exe", so this is
    /// what turns one of those into a path that can actually be started.
    public static string KnownFolderPath(string guidText)
    {
        Guid id;
        if (!Guid.TryParse(guidText, out id)) return null;
        IntPtr p = IntPtr.Zero;
        try
        {
            if (SHGetKnownFolderPath(ref id, 0, IntPtr.Zero, out p) != 0) return null;
            return Marshal.PtrToStringUni(p);
        }
        catch (Exception) { return null; }
        finally { if (p != IntPtr.Zero) Marshal.FreeCoTaskMem(p); }
    }

    /// DWMWA_EXTENDED_FRAME_BOUNDS. GetWindowRect includes the invisible resize
    /// border Windows 10+ adds around every frame, so it over-reports a window by
    /// ~7 px per side and a region built from it is offset from what the user sees.
    public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;

    /// Visual bounds of a window: the DWM frame when there is one, GetWindowRect
    /// otherwise. Returns false when neither source answers.
    public static bool WindowBounds(IntPtr hWnd, out RECT bounds)
    {
        bounds = new RECT();
        if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return false;
        try
        {
            if (DwmGetWindowAttribute(hWnd, DWMWA_EXTENDED_FRAME_BOUNDS, out bounds, Marshal.SizeOf(typeof(RECT))) == 0)
            {
                if (bounds.Right > bounds.Left && bounds.Bottom > bounds.Top) return true;
            }
        }
        catch (Exception) { }
        return GetWindowRect(hWnd, out bounds);
    }

    /// Per-monitor-v2 first, then the older shims. Without this the process sees
    /// virtualized (DPI-scaled) coordinates and every click lands off target on a
    /// scaled display.
    public static string EnableDpiAwareness()
    {
        try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return "per-monitor-v2"; } catch (Exception) { }
        try { if (SetProcessDpiAwareness(2) == 0) return "per-monitor"; } catch (Exception) { }
        try { if (SetProcessDPIAware()) return "system"; } catch (Exception) { }
        return "none";
    }

    [DllImport("user32.dll")]
    public static extern IntPtr GetThreadDpiAwarenessContext();

    [DllImport("user32.dll")]
    public static extern int GetAwarenessFromDpiAwarenessContext(IntPtr value);

    [DllImport("user32.dll")]
    public static extern bool AreDpiAwarenessContextsEqual(IntPtr a, IntPtr b);

    /// What the process's DPI awareness *actually is*, as opposed to what the setter
    /// above asked for. SetProcessDpiAwarenessContext fails when the awareness was
    /// already fixed -- by a manifest, by an earlier call, by the host -- and the
    /// setter then falls through to a weaker mode and reports that weaker mode as a
    /// success. On a scaled display an unaware process sees virtualized coordinates,
    /// which puts every click somewhere other than where the caller aimed.
    public static string ActualDpiAwareness()
    {
        try
        {
            IntPtr ctx = GetThreadDpiAwarenessContext();
            // GetAwarenessFromDpiAwarenessContext collapses per-monitor and
            // per-monitor-v2 into the same value, so the only way to tell them apart is
            // to compare the context handle itself against the well-known one.
            if (AreDpiAwarenessContextsEqual(ctx, new IntPtr(-4))) return "per-monitor-v2";
            int awareness = GetAwarenessFromDpiAwarenessContext(ctx);
            if (awareness == 2) return "per-monitor";
            if (awareness == 1) return "system";
            if (awareness == 0) return "unaware";
            return "unknown(" + awareness + ")";
        }
        catch (Exception) { return "unverified"; }
    }

    public static string WindowText(IntPtr hWnd)
    {
        StringBuilder sb = new StringBuilder(512);
        GetWindowTextW(hWnd, sb, sb.Capacity);
        return sb.ToString();
    }

    public static string WindowClass(IntPtr hWnd)
    {
        StringBuilder sb = new StringBuilder(256);
        GetClassNameW(hWnd, sb, sb.Capacity);
        return sb.ToString();
    }

    /// Bring a window to the foreground. Windows refuses SetForegroundWindow from a
    /// process that does not own the foreground, so this attaches to the current
    /// foreground thread first, which is the standard workaround.
    public static bool ForceForeground(IntPtr hWnd)
    {
        if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return false;
        if (IsIconic(hWnd)) ShowWindow(hWnd, 9); // SW_RESTORE
        IntPtr fg = GetForegroundWindow();
        if (fg == hWnd) return true;
        uint pid;
        uint targetThread = GetWindowThreadProcessId(hWnd, out pid);
        uint fgPid;
        uint fgThread = fg == IntPtr.Zero ? 0 : GetWindowThreadProcessId(fg, out fgPid);
        uint self = GetCurrentThreadId();
        bool attachedFg = false;
        bool attachedTarget = false;
        try
        {
            if (fgThread != 0 && fgThread != self) attachedFg = AttachThreadInput(fgThread, self, true);
            if (targetThread != 0 && targetThread != self) attachedTarget = AttachThreadInput(targetThread, self, true);
            // SW_SHOW (5) is deliberately NOT used here, and this is not a style preference.
            //
            // This process is started hidden (STARTF_USESHOWWINDOW with SW_HIDE, which is how
            // the host spawns the worker so no console flashes on screen), and Windows
            // substitutes that startup show state for the first ShowWindow call a process
            // makes. So `ShowWindow(foreignWindow, SW_SHOW)` did the opposite of what it says:
            // the window went from visible to hidden and stayed that way, and its own WinForms
            // reported Visible=false afterwards. Reproduced on this machine; it is also what
            // left the windows earlier test runs had focused invisible on the desktop.
            //
            // SW_SHOWNOACTIVATE (4) is not substituted, shows without activating, and leaves
            // the activation to SetForegroundWindow below -- which is the only part that was
            // ever supposed to move the foreground.
            ShowWindow(hWnd, 4);
            // BringWindowToTop in front of SetForegroundWindow, and both while the
            // input queues are attached: a window that is z-ordered behind another
            // one cannot be made foreground by SetForegroundWindow alone, and some
            // background process holding the foreground (a service window, for
            // instance) leaves exactly that situation.
            BringWindowToTop(hWnd);
            bool ok = SetForegroundWindow(hWnd);
            if (!ok)
            {
                // Last resort: a synthetic ALT tap lifts the foreground lock.
                INPUT[] alt = new INPUT[2];
                alt[0].type = INPUT_KEYBOARD;
                alt[0].U.ki.wVk = 0x12;
                alt[1].type = INPUT_KEYBOARD;
                alt[1].U.ki.wVk = 0x12;
                alt[1].U.ki.dwFlags = KEYEVENTF_KEYUP;
                SendInput(2, alt, Marshal.SizeOf(typeof(INPUT)));
                BringWindowToTop(hWnd);
                ok = SetForegroundWindow(hWnd);
            }
            if (!ok)
            {
                // A hidden service window can hold the foreground and never answer that ALT
                // tap (this machine: GameInputSvc's GameInputServiceWindow -- invisible,
                // untitled), and then nothing above lifts the lock, because there is no
                // foreground thread that will respond. SetWindowPos does not need the lock: it
                // puts the window at the top of the z-order and makes it visible, which is what
                // the pointer needs, and activation is retried while it is up there. The window
                // is dropped back out of topmost immediately so it does not float over
                // everything afterwards.
                SetWindowPos(hWnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
                // Dropped straight back out of topmost, and checked: leaving a window topmost
                // because the second call failed would float it over everything the user has
                // open, which is worse than not having raised it at all.
                for (int attempt = 0; attempt < 3 && IsTopmost(hWnd); attempt++)
                {
                    SetWindowPos(hWnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
                }
                ok = SetForegroundWindow(hWnd);
            }
            // A focus must never leave a window less visible than it found it: whatever the
            // startup show-state substitution did, put it back before returning.
            if (!IsWindowVisible(hWnd)) ShowWindow(hWnd, 1); // SW_SHOWNORMAL
            return ok;
        }
        finally
        {
            if (attachedTarget) AttachThreadInput(targetThread, self, false);
            if (attachedFg) AttachThreadInput(fgThread, self, false);
        }
    }

    public static INPUT Mouse(int dx, int dy, uint data, uint flags)
    {
        INPUT i = new INPUT();
        i.type = INPUT_MOUSE;
        i.U.mi.dx = dx;
        i.U.mi.dy = dy;
        i.U.mi.mouseData = data;
        i.U.mi.dwFlags = flags;
        return i;
    }

    public static INPUT Key(ushort vk, ushort scan, uint flags)
    {
        INPUT i = new INPUT();
        i.type = INPUT_KEYBOARD;
        i.U.ki.wVk = vk;
        i.U.ki.wScan = scan;
        i.U.ki.dwFlags = flags;
        return i;
    }

    public static uint Send(INPUT[] inputs)
    {
        if (inputs == null || inputs.Length == 0) return 0;
        return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    /// Absolute coordinates for SendInput live in a 0..65535 grid spanning the
    /// whole virtual desktop, so screen pixels must be normalized against the
    /// virtual-screen origin and size rather than the primary monitor.
    public static int ToAbsoluteX(int x)
    {
        int w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        int x0 = GetSystemMetrics(SM_XVIRTUALSCREEN);
        if (w <= 1) return 0;
        long v = ((long)(x - x0) * 65535L) / (w - 1);
        return (int)Math.Max(0, Math.Min(65535, v));
    }

    public static int ToAbsoluteY(int y)
    {
        int h = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        int y0 = GetSystemMetrics(SM_YVIRTUALSCREEN);
        if (h <= 1) return 0;
        long v = ((long)(y - y0) * 65535L) / (h - 1);
        return (int)Math.Max(0, Math.Min(65535, v));
    }
}
'@

Add-Type -TypeDefinition $nativeSource -Language CSharp | Out-Null
Add-Type -AssemblyName System.Drawing | Out-Null
Add-Type -AssemblyName System.Windows.Forms | Out-Null

