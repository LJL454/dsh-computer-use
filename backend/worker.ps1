# DSH computer-use backend worker.
#
# A long-lived Windows PowerShell process that speaks one JSON request per line on
# stdin and one JSON response per line on stdout. Compiling the P/Invoke helpers
# costs about a second, so it happens once at startup and every later call is a
# few milliseconds; a one-shot `powershell -Command` per action would pay that
# cost every time.
#
# Protocol
#   request   {"id":1,"cmd":"screenshot","args":{...}}
#   response  {"id":1,"ok":true,"result":{...}} | {"id":1,"ok":false,"error":"..."}
#   startup   {"ready":true,"info":{...}}
#
# ASCII only on purpose: Windows PowerShell reads a .ps1 without a BOM as ANSI,
# so any non-ASCII literal in this file would be mangled. All user text arrives
# through the JSON protocol.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$OutputEncoding = [System.Text.Encoding]::UTF8

# Talk to the parent over explicit UTF-8 streams rather than the console code
# page. Windows PowerShell decodes redirected stdin as ANSI otherwise, which
# turns any non-ASCII argument -- every Chinese control name, for instance --
# into mojibake before the JSON is even parsed.
$utf8 = New-Object System.Text.UTF8Encoding($false)
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)
$stdout = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
$stdout.AutoFlush = $true

# ------------------------------------------------------------- cancellation
#
# This process cannot be interrupted in the middle of a blocking Win32 or UI
# Automation call, and it speaks one request at a time, so a second "cancel" line
# on stdin would not even be read until the first one finished. Cancellation is
# therefore cooperative and out of band: the parent drops a marker file (its path
# comes in through the environment) and this worker looks for it at step
# boundaries -- before every batch step, inside a wait, inside a drag's move loop,
# between keystrokes. That buys the property a caller actually wants: "I stopped
# it, so the rest will not happen", rather than "my wait ended while the desktop
# kept being driven". A request the parent never wrote to the pipe is dropped
# there and never reaches this file at all.
#
# The marker is cleared after each command and by the parent before each write, so
# a cancel can never leak into the next request.
$script:CancelFile = ''
if ($null -ne $env:DSH_COMPUTER_USE_CANCEL_FILE -and "$($env:DSH_COMPUTER_USE_CANCEL_FILE)" -ne '') {
    $script:CancelFile = "$($env:DSH_COMPUTER_USE_CANCEL_FILE)"
}

# A random per-process generation, folded into every snapshot id and therefore
# into every ref ("s3f9a12.7"). Counters restart at 1 in each new worker, so
# without this a ref minted before a restart could land on a *different* element
# that happens to occupy the same slot now -- the exact failure a ref exists to
# prevent. The parent additionally checks that a ref came from its own session.
$script:BootGen = [System.Guid]::NewGuid().ToString('N').Substring(0, 4)
# How many requests this worker has served. Used to name the files a *derived* capture writes
# (§5.5): the caller's path plus this worker's identity plus the request makes a name no other
# frame in this process -- or in another one -- can collide with.
$script:RequestSeq = 0

function Test-CancelRequested {
    if ($script:CancelFile -eq '') { return $false }
    try { return (Test-Path -LiteralPath $script:CancelFile) } catch { return $false }
}

function Clear-CancelRequest {
    if ($script:CancelFile -eq '') { return }
    try {
        if (Test-Path -LiteralPath $script:CancelFile) {
            Remove-Item -LiteralPath $script:CancelFile -Force -ErrorAction SilentlyContinue
        }
    } catch { }
}

function Assert-NotCancelled([string]$where) {
    if (Test-CancelRequested) {
        throw "[CANCELED] the caller cancelled this request ($where). No further input was sent to the desktop; anything this command was holding down is released before this error leaves the worker."
    }
}

# The budget of the call being served, as a script-scope instant (§5.7).
#
# The deadline has to be visible to the *input* functions, not only to the batch loop that
# computed it: a step that starts just before the budget runs out would otherwise send its
# whole input (a click, a typed string, a drag) into a call whose time was already spent. One
# request is served at a time, so a script-scope value is exact -- and 0 means "unbounded",
# which is what the single-step tools pass.
$script:DeadlineAtMs = [int64]0

function Set-DeadlineAt([int64]$atMs) { $script:DeadlineAtMs = $atMs }

function Clear-Deadline() { $script:DeadlineAtMs = [int64]0 }

function Get-DeadlineRemainingMs {
    if ($script:DeadlineAtMs -le 0) { return [int]::MaxValue }
    $left = [int64]$script:DeadlineAtMs - [int64]$script:Clock.ElapsedMilliseconds
    if ($left -lt 0) { $left = 0 }
    return [int]$left
}

function Assert-WithinDeadline([string]$where) {
    # Whether the clock, and not the request, is why the next thing can no longer be done.
    # Checked immediately before a send, so the failure lands between two inputs rather than in
    # the middle of one.
    if ((Get-DeadlineRemainingMs) -le 0) {
        throw "[DEADLINE_EXHAUSTED] this call's budget ran out $where; nothing further was sent to the desktop, and the steps that already ran did happen. Observe the result with computer_screenshot or computer_ui before deciding anything else -- do not repeat this step blindly."
    }
}

function Assert-CanSend([string]$where) {
    # Cancellation and the deadline, asked together at the moment before something is sent:
    # both mean "stop here", and both have to be asked *between* inputs (a gesture is only
    # stoppable at the points where nothing is held).
    Assert-NotCancelled $where
    Assert-WithinDeadline $where
}

function Test-InputDelivery([int]$sent, [int]$expected, [string]$what) {
    # What one SendInput call actually did (§6: 部分输入事件成功可能被当作全部成功).
    #
    # SendInput returns the number of events it *inserted*, so a non-zero count is not "all of
    # them" (Microsoft docs, SendInput): a click whose release was refused, or a typed string
    # that lost half its characters, used to be reported as a completed action because the only
    # question asked was "is the count zero". The answer here is a comparison of the expected
    # count with the real one, and "part of it landed" is its own state.
    # @returns @{ state; complete; sent; expected; note }.
    if ($expected -le 0) {
        return @{ state = 'completed'; complete = $true; sent = [int]$sent; expected = [int]$expected; note = 'nothing needed to be sent' }
    }
    if ($sent -ge $expected) {
        return @{ state = 'completed'; complete = $true; sent = [int]$sent; expected = [int]$expected; note = '' }
    }
    if ($sent -le 0) {
        return @{
            state = 'none'; complete = $false; sent = [int]$sent; expected = [int]$expected
            note = "SendInput inserted none of the $expected event(s) for $what (the desktop may be locked, or the target is at a higher integrity level)"
        }
    }
    return @{
        state = 'partial'; complete = $false; sent = [int]$sent; expected = [int]$expected
        note = "SendInput inserted $sent of the $expected event(s) for $what, so part of this action landed and part of it did not"
    }
}

function Assert-InputDelivered([int]$sent, [int]$expected, [string]$what, [string]$where) {
    # The refusal a short send earns, in the shape the rest of the plugin already reads: a coded
    # sentence, `action_sent` said out loud, and the counts reported rather than floored to
    # "some". A partial action is *not* replayed -- what landed cannot be taken back.
    $delivery = Test-InputDelivery $sent $expected $what
    if ($delivery.complete) { return $delivery }
    if ("$($delivery.state)" -eq 'none') { throw "$($delivery.note)" }
    throw "[PARTIAL_INPUT] $($delivery.note) ($where; action_sent=true, outcome=unknown). Do not repeat this step as it stands: some of it is already in the application, so observe the desktop (computer_screenshot or computer_ui) and decide from what is actually there."
}

function Wait-Cancellable([int]$ms, [int]$sliceMs = 100) {
    # A plain Start-Sleep cannot be stopped, and a 30 s wait is exactly the kind of
    # step a cancelling caller is waiting on. Sleep in slices and give up early.
    $remaining = [Math]::Max(0, $ms)
    while ($remaining -gt 0) {
        Assert-NotCancelled "during a $($ms) ms wait"
        $slice = [Math]::Min($sliceMs, $remaining)
        Start-Sleep -Milliseconds $slice
        $remaining -= $slice
    }
}

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

# ------------------------------------------------------------- COM UIA engine
#
# The managed System.Windows.Automation wrapper marshals every property through a
# managed object and cannot reach TextPattern2, WindowPattern or the legacy pattern
# at all. This block talks to IUIAutomation directly instead.
#
# Two rules govern the declarations below, both learned the hard way:
#   1. A [ComImport] interface is positional. CompareElements/CompareRuntimeIds lead
#      IUIAutomation's vtable; leaving them out shifts every later slot by two, and a
#      shifted slot does not fail loudly -- it calls a different function and the
#      QueryInterface for the declared return type fails with E_NOINTERFACE.
#   2. GUIDs come from the Windows SDK's UIAutomationClient.idl, never from memory.
#      Two of five IIDs written from memory were wrong, and a wrong method order
#      calls the wrong function outright.
#
# Only the prefix each feature needs is declared: properties are read through
# GetCurrentPropertyValue/GetCachedPropertyValue, so the 29 individual property
# getters and their 29 cached twins never have to be spelled out.

$uiaComSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace DshUia
{
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    [ComImport, Guid("30CBE57D-D9D0-452A-AB13-7AC5AC4825EE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomation
    {
        [PreserveSig] int CompareElements(IUIAutomationElement first, IUIAutomationElement second, out int areSame);
        [PreserveSig] int CompareRuntimeIds([MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_I4)] int[] first, [MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_I4)] int[] second, out int areSame);
        [PreserveSig] int GetRootElement([MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement root);
        [PreserveSig] int ElementFromHandle(IntPtr hwnd, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement element);
        [PreserveSig] int ElementFromPoint(POINT pt, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement element);
        [PreserveSig] int GetFocusedElement([MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement element);
        [PreserveSig] int GetRootElementBuildCache(IUIAutomationCacheRequest cacheRequest, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement root);
        [PreserveSig] int ElementFromHandleBuildCache(IntPtr hwnd, IUIAutomationCacheRequest cacheRequest, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement element);
        [PreserveSig] int ElementFromPointBuildCache(POINT pt, IUIAutomationCacheRequest cacheRequest, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement element);
        [PreserveSig] int GetFocusedElementBuildCache(IUIAutomationCacheRequest cacheRequest, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement element);
        [PreserveSig] int CreateTreeWalker(IUIAutomationCondition condition, out IntPtr walker);
        IntPtr ControlViewWalker { get; }
        IntPtr ContentViewWalker { get; }
        IntPtr RawViewWalker { get; }
        IUIAutomationCondition RawViewCondition { get; }
        IUIAutomationCondition ControlViewCondition { get; }
        IUIAutomationCondition ContentViewCondition { get; }
        [PreserveSig] int CreateCacheRequest([MarshalAs(UnmanagedType.Interface)] out IUIAutomationCacheRequest cacheRequest);
        [PreserveSig] int CreateTrueCondition([MarshalAs(UnmanagedType.Interface)] out IUIAutomationCondition condition);
        // Positional filler: CreatePropertyCondition is the next slot, and the IDL has
        // CreateFalseCondition in between.
        [PreserveSig] int CreateFalseCondition([MarshalAs(UnmanagedType.Interface)] out IUIAutomationCondition condition);
        [PreserveSig] int CreatePropertyCondition(int propertyId, [In, MarshalAs(UnmanagedType.Struct)] object value, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationCondition condition);
        // Positional filler too: the IDL has CreatePropertyConditionEx here, and the three
        // combining calls below follow it. Nothing above them may move -- a wrong slot
        // count for a ComImport interface is not a compile error, it is a call into an
        // unrelated vtable entry at run time.
        [PreserveSig] int CreatePropertyConditionEx(int propertyId, [In, MarshalAs(UnmanagedType.Struct)] object value, int flags, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationCondition condition);
        [PreserveSig] int CreateAndCondition(IUIAutomationCondition first, IUIAutomationCondition second, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationCondition condition);
        [PreserveSig] int CreateOrCondition(IUIAutomationCondition first, IUIAutomationCondition second, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationCondition condition);
        [PreserveSig] int CreateNotCondition(IUIAutomationCondition condition, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationCondition negated);
    }

    [ComImport, Guid("D22108AA-8AC5-49A5-837B-37BBB3D7591E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationElement
    {
        [PreserveSig] int SetFocus();
        [PreserveSig] int GetRuntimeId(out IntPtr runtimeId);
        [PreserveSig] int FindFirst(int scope, IUIAutomationCondition condition, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement found);
        [PreserveSig] int FindAll(int scope, IUIAutomationCondition condition, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElementArray found);
        [PreserveSig] int FindFirstBuildCache(int scope, IUIAutomationCondition condition, IUIAutomationCacheRequest cacheRequest, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement found);
        [PreserveSig] int FindAllBuildCache(int scope, IUIAutomationCondition condition, IUIAutomationCacheRequest cacheRequest, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElementArray found);
        [PreserveSig] int BuildUpdatedCache(IUIAutomationCacheRequest cacheRequest, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement updated);
        [PreserveSig] int GetCurrentPropertyValue(int propertyId, [MarshalAs(UnmanagedType.Struct)] out object value);
        [PreserveSig] int GetCurrentPropertyValueEx(int propertyId, int ignoreDefaultValue, [MarshalAs(UnmanagedType.Struct)] out object value);
        [PreserveSig] int GetCachedPropertyValue(int propertyId, [MarshalAs(UnmanagedType.Struct)] out object value);
        [PreserveSig] int GetCachedPropertyValueEx(int propertyId, int ignoreDefaultValue, [MarshalAs(UnmanagedType.Struct)] out object value);
        [PreserveSig] int GetCurrentPatternAs(int patternId, ref Guid riid, out IntPtr patternObject);
        [PreserveSig] int GetCachedPatternAs(int patternId, ref Guid riid, out IntPtr patternObject);
        [PreserveSig] int GetCurrentPattern(int patternId, [MarshalAs(UnmanagedType.Interface)] out object patternObject);
        [PreserveSig] int GetCachedPattern(int patternId, [MarshalAs(UnmanagedType.Interface)] out object patternObject);
    }

    [ComImport, Guid("14314595-B4BC-4055-95F2-58F2E42C9855"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationElementArray
    {
        [PreserveSig] int get_Length(out int length);
        [PreserveSig] int GetElement(int index, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement element);
    }

    [ComImport, Guid("B32A92B5-BC25-4078-9C08-D7EE95C48E03"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationCacheRequest
    {
        [PreserveSig] int AddProperty(int propertyId);
        [PreserveSig] int AddPattern(int patternId);
        [PreserveSig] int Clone([MarshalAs(UnmanagedType.Interface)] out IUIAutomationCacheRequest request);
        [PreserveSig] int get_TreeScope(out int scope);
        [PreserveSig] int put_TreeScope(int scope);
        [PreserveSig] int get_TreeFilter([MarshalAs(UnmanagedType.Interface)] out IUIAutomationCondition filter);
        [PreserveSig] int put_TreeFilter(IUIAutomationCondition filter);
        [PreserveSig] int get_AutomationElementMode(out int mode);
        [PreserveSig] int put_AutomationElementMode(int mode);
    }

    [ComImport, Guid("352FFBA8-0973-437C-A61F-F64CAFD81DF9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationCondition { }

    [ComImport, Guid("FB377FBE-8EA6-46D5-9C73-6499642D3059"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationInvokePattern
    {
        [PreserveSig] int Invoke();
    }

    [ComImport, Guid("A94CD8B1-0844-4CD6-9D2D-640537AB39E9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationValuePattern
    {
        [PreserveSig] int SetValue([MarshalAs(UnmanagedType.BStr)] string value);
        string CurrentValue { get; }
    }

    [ComImport, Guid("94CF8058-9B8D-4AB9-8BFD-4CD0A33C8C70"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationTogglePattern
    {
        [PreserveSig] int Toggle();
    }

    [ComImport, Guid("A8EFA66A-0FDA-421A-9194-38021F3578EA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationSelectionItemPattern
    {
        [PreserveSig] int Select();
    }

    [ComImport, Guid("619BE086-1F4E-4EE4-BAFA-210128738730"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationExpandCollapsePattern
    {
        [PreserveSig] int Expand();
        [PreserveSig] int Collapse();
    }

    [ComImport, Guid("B488300F-D015-4F19-9C29-BB595E3645EF"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationScrollItemPattern
    {
        [PreserveSig] int ScrollIntoView();
    }

    [ComImport, Guid("0FAEF453-9208-43EF-BBB2-3B485177864F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationWindowPattern
    {
        [PreserveSig] int Close();
        // Positional filler: SetWindowVisualState is the third slot, so this one has to
        // be declared even though nothing calls it.
        [PreserveSig] int WaitForInputIdle(int milliseconds, out int ready);
        [PreserveSig] int SetWindowVisualState(int state);
    }

    [ComImport, Guid("32EBA289-3583-42C9-9C59-3B6D9A1E9B6A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationTextPattern
    {
        // The first four are positional filler: GetDocumentRange is the fifth slot.
        [PreserveSig] int RangeFromPoint(POINT pt, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange range);
        [PreserveSig] int RangeFromChild(IUIAutomationElement child, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange range);
        [PreserveSig] int GetSelection([MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRangeArray ranges);
        [PreserveSig] int GetVisibleRanges([MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRangeArray ranges);
        [PreserveSig] int GetDocumentRange([MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange range);
    }

    // TextPattern2 *inherits* TextPattern, so its vtable is the six TextPattern slots
    // followed by its own two. Declaring only the two put RangeFromAnnotation at slot 0
    // -- which is RangeFromPoint, with a completely different signature -- and calling
    // GetCaretRange took the whole worker down with an access violation.
    [ComImport, Guid("506A921A-FCC9-409F-B23B-37EB74106872"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationTextPattern2
    {
        [PreserveSig] int RangeFromPoint(POINT pt, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange range);
        [PreserveSig] int RangeFromChild(IUIAutomationElement child, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange range);
        [PreserveSig] int GetSelection([MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRangeArray ranges);
        [PreserveSig] int GetVisibleRanges([MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRangeArray ranges);
        [PreserveSig] int GetDocumentRange([MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange range);
        int SupportedTextSelection { get; }
        [PreserveSig] int RangeFromAnnotation(IUIAutomationElement annotation, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange range);
        [PreserveSig] int GetCaretRange(out int isActive, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange range);
    }

    [ComImport, Guid("A543CC6A-F4AE-494B-8239-C814481187A8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationTextRange
    {
        [PreserveSig] int Clone([MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange range);
        [PreserveSig] int Compare(IUIAutomationTextRange range, out int areSame);
        [PreserveSig] int CompareEndpoints(int endpoint, IUIAutomationTextRange range, int targetEndpoint, out int comparison);
        [PreserveSig] int ExpandToEnclosingUnit(int unit);
        [PreserveSig] int FindAttribute(int attributeId, [MarshalAs(UnmanagedType.Struct)] object value, int backward, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange found);
        [PreserveSig] int FindText([MarshalAs(UnmanagedType.BStr)] string text, int backward, int ignoreCase, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange found);
        [PreserveSig] int GetAttributeValue(int attributeId, [MarshalAs(UnmanagedType.Struct)] out object value);
        // SAFEARRAY(double)*, not VARIANT*: marshalling this as a struct produced an
        // invalid OLE variable and, on the caret path, an access violation.
        [PreserveSig] int GetBoundingRectangles([MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_R8)] out double[] rectangles);
        [PreserveSig] int GetEnclosingElement([MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement element);
        [PreserveSig] int GetText(int maxLength, [MarshalAs(UnmanagedType.BStr)] out string text);
        // Move and MoveEndpointByUnit both carry an [out, retval] count in the IDL. A
        // declaration without it is not merely incomplete: the callee writes that int
        // through a pointer the caller never supplied.
        [PreserveSig] int Move(int unit, int count, out int moved);
        [PreserveSig] int MoveEndpointByUnit(int endpoint, int unit, int count, out int moved);
        [PreserveSig] int MoveEndpointByRange(int endpoint, IUIAutomationTextRange range, int targetEndpoint);
        [PreserveSig] int Select();
    }

    [ComImport, Guid("CE4AE76A-E717-4C98-81EA-47371D028EB6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationTextRangeArray
    {
        [PreserveSig] int get_Length(out int length);
        [PreserveSig] int GetElement(int index, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange element);
    }

    [ComImport, Guid("828055AD-355B-4435-86D5-3B51C14A9B1B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationLegacyIAccessiblePattern
    {
        // Select and SetValue are positional filler: DoDefaultAction is the second slot
        // and the read-only properties start at the fourth.
        [PreserveSig] int Select(int childId);
        [PreserveSig] int DoDefaultAction();
        [PreserveSig] int SetValue([MarshalAs(UnmanagedType.BStr)] string value);
        int CurrentChildId { get; }
        string CurrentName { get; }
        string CurrentValue { get; }
        string CurrentDescription { get; }
    }

    /// The engine. C# owns every COM object; PowerShell passes primitives in and gets
    /// dictionaries out, because a COM interface cannot cross that boundary at all.
    public static class Engine
    {
        public const int TreeScope_Element = 1;
        public const int TreeScope_Children = 2;
        public const int TreeScope_Descendants = 4;
        public const int TreeScope_Subtree = 7;

        public const int Mode_Full = 0;
        public const int Mode_None = 1;

        public const int WindowVisualState_Normal = 0;
        public const int WindowVisualState_Maximized = 1;
        public const int WindowVisualState_Minimized = 2;

        public const int TextPatternRangeEndpoint_Start = 0;
        public const int TextPatternRangeEndpoint_End = 1;
        public const int TextUnit_Character = 0;
        public const int TextUnit_Line = 3;

        public const int UIA_BoundingRectanglePropertyId = 30001;
        public const int UIA_ProcessIdPropertyId = 30002;
        public const int UIA_ControlTypePropertyId = 30003;
        public const int UIA_NamePropertyId = 30005;
        public const int UIA_HasKeyboardFocusPropertyId = 30008;
        public const int UIA_IsKeyboardFocusablePropertyId = 30009;
        public const int UIA_IsEnabledPropertyId = 30010;
        public const int UIA_AutomationIdPropertyId = 30011;
        public const int UIA_ClassNamePropertyId = 30012;
        public const int UIA_NativeWindowHandlePropertyId = 30020;
        public const int UIA_IsOffscreenPropertyId = 30022;

        public const int UIA_InvokePatternId = 10000;
        public const int UIA_ValuePatternId = 10002;
        public const int UIA_ExpandCollapsePatternId = 10005;
        public const int UIA_WindowPatternId = 10009;
        public const int UIA_SelectionItemPatternId = 10010;
        public const int UIA_TextPatternId = 10014;
        public const int UIA_TogglePatternId = 10015;
        public const int UIA_ScrollItemPatternId = 10017;
        public const int UIA_LegacyIAccessiblePatternId = 10018;
        public const int UIA_TextPattern2Id = 10024;

        private static readonly int[] CachedProperties = new int[] {
            UIA_NamePropertyId, UIA_ControlTypePropertyId, UIA_AutomationIdPropertyId,
            UIA_ClassNamePropertyId, UIA_IsEnabledPropertyId, UIA_IsOffscreenPropertyId,
            UIA_BoundingRectanglePropertyId, UIA_NativeWindowHandlePropertyId,
            UIA_ProcessIdPropertyId, UIA_HasKeyboardFocusPropertyId,
            UIA_IsKeyboardFocusablePropertyId,
        };

        private static readonly int[] CachedPatternIds = new int[] {
            UIA_InvokePatternId, UIA_ValuePatternId, UIA_TextPatternId,
            UIA_SelectionItemPatternId, UIA_TogglePatternId,
            UIA_ExpandCollapsePatternId, UIA_ScrollItemPatternId,
            UIA_WindowPatternId,
        };

        private static readonly string[] CachedPatternNames = new string[] {
            "invoke", "value", "text", "select", "toggle", "expand", "scroll_item",
            "window",
        };

        private static IUIAutomation automation;
        private static string lastError = "";

        // §7.4 item 7: measure before releasing. Every short-lived COM object this engine hands
        // out is counted, and the ones with a clear scope are released where that scope ends.
        // The point of counting first is that the alternative -- calling ReleaseComObject on
        // everything in sight -- can release an element the ref registry is still holding and
        // turn a working reference into a crash. The counters say whether anything is actually
        // accumulating, and `Reset()` remains the deliberate, wholesale teardown.
        private static int elementsHandedOut = 0;
        private static int arraysCreated = 0;
        private static int arraysReleased = 0;
        private static int resets = 0;

        /// A census of the COM objects this engine has created: what was handed out, what had a
        /// scope and was released at the end of it, and how often the client was rebuilt.
        public static string Census()
        {
            return "{\"elements\":" + elementsHandedOut
                + ",\"arrays\":" + arraysCreated
                + ",\"arraysReleased\":" + arraysReleased
                + ",\"arraysLive\":" + (arraysCreated - arraysReleased)
                + ",\"resets\":" + resets + "}";
        }

        /// Release a transient COM array whose scope ends here.
        ///
        /// Only for objects this engine created for its own use inside one call -- never for an
        /// element handed to the ref registry, which is why the census counts them apart.
        private static void ReleaseTransient(object comObject)
        {
            if (comObject == null) return;
            try
            {
                Marshal.ReleaseComObject(comObject);
                arraysReleased++;
            }
            catch (Exception) { }
        }

        public static string LastError() { return lastError; }

        public static bool Available()
        {
            if (automation != null) return true;
            try
            {
                Init();
                return automation != null;
            }
            catch (Exception error)
            {
                lastError = error.GetType().Name + ": " + error.Message;
                return false;
            }
        }

        public static void Init()
        {
            if (automation != null) return;
            Guid clsid = new Guid("FF48DBA4-60EF-4201-AA87-54103EEF594E");
            object created = Activator.CreateInstance(Type.GetTypeFromCLSID(clsid));
            automation = (IUIAutomation)created;
        }

        /// Drop the UI Automation client and build a new one.
        ///
        /// The client is created once and shared by every call, and it can end up in a state
        /// where every property read comes back with a non-zero HRESULT -- a provider that
        /// stopped answering, or a COM error that leaves the client object unusable. Because
        /// `Property` turns a failed read into "no value", that state is *invisible* in the
        /// output: every row simply comes back anonymous, `skipEmpty` drops it, and the caller
        /// receives a plausible-looking tree with a handful of rows instead of an error.
        ///
        /// Measured: on a long repeated run the probe window's tree went from 16 rows to 6 and
        /// stayed that way for the rest of the process, while a freshly started worker read the
        /// same window fine. That is a client-side state, so the fix is to notice it and start
        /// over rather than to blame the window.
        public static void Reset()
        {
            try { if (automation != null) Marshal.ReleaseComObject(automation); } catch (Exception) { }
            automation = null;
            resets++;
            Init();
        }

        /// Whether the client can still read a window's own properties.
        ///
        /// A window always has a control type, so an anonymous root is a client problem and not
        /// a property of the window. One cached read, called once per tree request.
        public static bool ClientHealthy(long hwnd)
        {
            try
            {
                Init();
                IUIAutomationCacheRequest cache = NewCacheRequest(false, TreeScope_Element, false);
                IUIAutomationElement root = Root(hwnd, cache);
                object controlType = Property(root, UIA_ControlTypePropertyId, false);
                return controlType != null;
            }
            catch (Exception) { return false; }
        }

        private static IUIAutomationCacheRequest NewCacheRequest(bool withPatterns, int treeScope, bool live)
        {
            IUIAutomationCacheRequest request;
            Marshal.ThrowExceptionForHR(automation.CreateCacheRequest(out request));
            foreach (int propertyId in CachedProperties) request.AddProperty(propertyId);
            if (withPatterns)
            {
                foreach (int patternId in CachedPatternIds) request.AddPattern(patternId);
            }
            request.put_TreeScope(treeScope);
            // Mode_None means the element carries no live reference: a cached walk is
            // then one bulk fetch instead of one cross-process call per property.
            request.put_AutomationElementMode(live ? Mode_Full : Mode_None);
            return request;
        }

        private static object Property(IUIAutomationElement element, int propertyId, bool live)
        {
            object value;
            int hr = live ? element.GetCurrentPropertyValue(propertyId, out value) : element.GetCachedPropertyValue(propertyId, out value);
            if (hr != 0) return null;
            if (value == null) return null;
            if (value is int && (int)value == int.MinValue) return null;
            return value;
        }

        private static object Property(IUIAutomationElement element, int propertyId)
        {
            return Property(element, propertyId, false);
        }

        private static string Text(IUIAutomationElement element, int propertyId, bool live)
        {
            return Property(element, propertyId, live) as string ?? string.Empty;
        }

        private static string Text(IUIAutomationElement element, int propertyId)
        {
            return Text(element, propertyId, false);
        }

        private static bool Flag(IUIAutomationElement element, int propertyId, bool live)
        {
            object value = Property(element, propertyId, live);
            if (value is bool) return (bool)value;
            if (value is int) return (int)value != 0;
            return false;
        }

        private static bool Flag(IUIAutomationElement element, int propertyId)
        {
            return Flag(element, propertyId, false);
        }

        private static int Number(IUIAutomationElement element, int propertyId, bool live)
        {
            object value = Property(element, propertyId, live);
            if (value is int) return (int)value;
            if (value is double) return (int)(double)value;
            return 0;
        }

        private static int Number(IUIAutomationElement element, int propertyId)
        {
            return Number(element, propertyId, false);
        }

        private static string[] Patterns(IUIAutomationElement element, bool live)
        {
            List<string> found = new List<string>();
            for (int i = 0; i < CachedPatternIds.Length; i++)
            {
                object pattern;
                int hr = live
                    ? element.GetCurrentPattern(CachedPatternIds[i], out pattern)
                    : element.GetCachedPattern(CachedPatternIds[i], out pattern);
                if (hr == 0 && pattern != null) found.Add(CachedPatternNames[i]);
            }
            return found.ToArray();
        }

        private static string[] Patterns(IUIAutomationElement element)
        {
            return Patterns(element, false);
        }

        /// The programmatic name the tool reports. COM hands out the integer id; the
        /// managed wrapper is what used to turn it into ControlType.Button, so the
        /// mapping has to live here now.
        public static string ControlTypeName(int id)
        {
            switch (id)
            {
                case 50000: return "ControlType.Button";
                case 50001: return "ControlType.Calendar";
                case 50002: return "ControlType.CheckBox";
                case 50003: return "ControlType.ComboBox";
                case 50004: return "ControlType.Edit";
                case 50005: return "ControlType.Hyperlink";
                case 50006: return "ControlType.Image";
                case 50007: return "ControlType.ListItem";
                case 50008: return "ControlType.List";
                case 50009: return "ControlType.Menu";
                case 50010: return "ControlType.MenuBar";
                case 50011: return "ControlType.MenuItem";
                case 50012: return "ControlType.ProgressBar";
                case 50013: return "ControlType.RadioButton";
                case 50014: return "ControlType.ScrollBar";
                case 50015: return "ControlType.Slider";
                case 50016: return "ControlType.Spinner";
                case 50017: return "ControlType.StatusBar";
                case 50018: return "ControlType.Tab";
                case 50019: return "ControlType.TabItem";
                case 50020: return "ControlType.Text";
                case 50021: return "ControlType.ToolBar";
                case 50022: return "ControlType.ToolTip";
                case 50023: return "ControlType.Tree";
                case 50024: return "ControlType.TreeItem";
                case 50025: return "ControlType.Custom";
                case 50026: return "ControlType.Group";
                case 50027: return "ControlType.Thumb";
                case 50028: return "ControlType.DataGrid";
                case 50029: return "ControlType.DataItem";
                case 50030: return "ControlType.Document";
                case 50031: return "ControlType.SplitButton";
                case 50032: return "ControlType.Window";
                case 50033: return "ControlType.Pane";
                case 50034: return "ControlType.Header";
                case 50035: return "ControlType.HeaderItem";
                case 50036: return "ControlType.Table";
                case 50037: return "ControlType.TitleBar";
                case 50038: return "ControlType.Separator";
                case 50039: return "ControlType.SemanticZoom";
                case 50040: return "ControlType.AppBar";
                default: return "ControlType.Unknown";
            }
        }

        private static int Clamp(double value)
        {
            if (double.IsNaN(value)) return 0;
            if (value > 2147483647d) return 2147483647;
            if (value < -2147483648d) return -2147483648;
            return (int)Math.Round(value);
        }

        /// A rectangle as the tool reports it: NaN and infinities collapse to an empty
        /// rectangle and mark the node offscreen, everything else is clamped into
        /// int32 -- an offscreen D3D swap-chain window legitimately reports
        /// coordinates far outside the desktop.
        private static bool SetRect(Dictionary<string, object> row, object bounds)
        {
            double left = 0, top = 0, width = 0, height = 0;
            double[] four = bounds as double[];
            if (four != null && four.Length == 4)
            {
                left = four[0]; top = four[1]; width = four[2]; height = four[3];
            }
            bool finite = !(double.IsNaN(left) || double.IsInfinity(left)
                         || double.IsNaN(top) || double.IsInfinity(top)
                         || double.IsNaN(width) || double.IsInfinity(width)
                         || double.IsNaN(height) || double.IsInfinity(height));
            if (!finite) { left = 0; top = 0; width = 0; height = 0; }
            row["x"] = Clamp(left);
            row["y"] = Clamp(top);
            row["width"] = Clamp(width);
            row["height"] = Clamp(height);
            return finite;
        }

        /// One row per node.
        ///
        /// `live` selects which side of UI Automation the row is read from, and it is
        /// not cosmetic: an element resolved through a cache request has no live
        /// reference and answers only cached reads, while an element resolved with a
        /// plain FindAll has no cache and answers only live reads. Reading the wrong
        /// side yields defaults -- which is how an action receipt reported its matched
        /// window as ControlType.Unknown.
        private static Dictionary<string, object> Row(IUIAutomationElement element, int depth, bool withPatterns, bool live)
        {
            Dictionary<string, object> row = new Dictionary<string, object>();
            row["depth"] = depth;
            row["name"] = Text(element, UIA_NamePropertyId, live);
            row["controlType"] = ControlTypeName(Number(element, UIA_ControlTypePropertyId, live));
            row["automationId"] = Text(element, UIA_AutomationIdPropertyId, live);
            row["className"] = Text(element, UIA_ClassNamePropertyId, live);
            row["enabled"] = Flag(element, UIA_IsEnabledPropertyId, live);
            bool finite = SetRect(row, Property(element, UIA_BoundingRectanglePropertyId, live));
            row["offscreen"] = !finite || Flag(element, UIA_IsOffscreenPropertyId, live);
            row["patterns"] = withPatterns ? Patterns(element, live) : new string[0];
            return row;
        }

        private static Dictionary<string, object> Row(IUIAutomationElement element, int depth, bool withPatterns)
        {
            return Row(element, depth, withPatterns, false);
        }

        /// The identity test the walk uses, unchanged from the managed path: no name,
        /// no automation id and no pattern means the node is scaffolding. A rectangle
        /// or a class name does not qualify a node to be reported.
        private static bool HasIdentity(Dictionary<string, object> row)
        {
            if (((string)row["name"]).Length > 0) return true;
            if (((string)row["automationId"]).Length > 0) return true;
            return ((string[])row["patterns"]).Length > 0;
        }

        private static IUIAutomationElement Root(long hwnd, IUIAutomationCacheRequest cache)
        {
            IUIAutomationElement root;
            int hr = automation.ElementFromHandleBuildCache(new IntPtr(hwnd), cache, out root);
            if (hr != 0 || root == null)
            {
                Marshal.ThrowExceptionForHR(hr != 0 ? hr : unchecked((int)0x80004005));
            }
            elementsHandedOut++;
            return root;
        }

        /// Breadth-first walk over a cached subtree.
        ///
        /// The cache request is Element-scoped and each node costs one
        /// FindAllBuildCache, rather than one Subtree-scoped request up front. That
        /// looks like the slower design and is not: on a Chromium window the
        /// Subtree-scoped walk measured 85 ms against 21 ms for this one, because a
        /// Subtree request makes the provider materialise the whole tree eagerly.
        public static void Walk(long hwnd, int maxDepth, int maxNodes, bool withPatterns, bool skipEmpty,
                                int maxVisited, out object[] outRows, out int outWalked, out int outSkipped,
                                out bool outTruncated, out int outMaxQueue, out bool outTraversalTruncated)
        {
            Init();
            IUIAutomationCacheRequest cache = NewCacheRequest(withPatterns, TreeScope_Element, false);
            IUIAutomationElement root = Root(hwnd, cache);
            IUIAutomationCondition trueCondition;
            Marshal.ThrowExceptionForHR(automation.CreateTrueCondition(out trueCondition));

            List<object> rows = new List<object>();
            Queue<object[]> queue = new Queue<object[]>();
            queue.Enqueue(new object[] { root, 0 });
            int walked = 0, skipped = 0;
            int maxQueue = 1;
            bool truncated = false;
            bool traversalTruncated = false;

            while (queue.Count > 0)
            {
                // §7.4 item 2: the output budget and the traversal budget are separate questions.
                // `rows.Count >= maxNodes` only counts rows that were *kept*, so a tree of
                // anonymous nodes -- dropped by skipEmpty, never counted -- used to be walked
                // with no bound of its own. The visit budget is checked here, before a node is
                // visited, and it says so in the reply (`traversalTruncated`) rather than
                // silently returning a short tree; 0 means "no limit" and is what keeps the
                // default behaviour unchanged for every realistic window.
                if (maxVisited > 0 && walked >= maxVisited) { truncated = true; traversalTruncated = true; break; }
                if (rows.Count >= maxNodes) { truncated = true; break; }
                object[] item = queue.Dequeue();
                IUIAutomationElement element = (IUIAutomationElement)item[0];
                int depth = (int)item[1];
                walked++;
                Dictionary<string, object> row = Row(element, depth, withPatterns);
                if (skipEmpty && !HasIdentity(row)) skipped++;
                else rows.Add(row);

                if (depth >= maxDepth) continue;
                IUIAutomationElementArray children;
                if (element.FindAllBuildCache(TreeScope_Children, trueCondition, cache, out children) != 0 || children == null) continue;
                arraysCreated++;
                int count;
                if (children.get_Length(out count) != 0)
                {
                    // The array's scope ends here: its children have been read out and enqueued
                    // (each of those is an element the walk still owns, not this array).
                    ReleaseTransient(children);
                    continue;
                }
                for (int i = 0; i < count; i++)
                {
                    IUIAutomationElement child;
                    if (children.GetElement(i, out child) == 0 && child != null)
                    {
                        elementsHandedOut++;
                        queue.Enqueue(new object[] { child, depth + 1 });
                    }
                }
                // One array per visited node is what a walk of a large window allocates; without
                // this it stays alive until the client is rebuilt (§7.4 item 7).
                ReleaseTransient(children);
                if (queue.Count > maxQueue) maxQueue = queue.Count;
            }

            outRows = rows.ToArray();
            outWalked = walked;
            outSkipped = skipped;
            outTruncated = truncated;
            outMaxQueue = maxQueue;
            outTraversalTruncated = traversalTruncated;
        }

        /// Whether a control-type argument names exactly one UIA control type.
        ///
        /// §7.4 item 3: the tool's matching for a control type is a substring test, so only a
        /// *fully named* type (`ControlType.Button`) may be pushed down as a provider filter;
        /// `Button` -- which the substring test matches -- must not be, because an exact
        /// condition would drop rows the caller would otherwise have got.
        public static bool IsExactControlType(string wantType)
        {
            if (wantType == null) return false;
            string trimmed = wantType.Trim();
            const string prefix = "ControlType.";
            if (trimmed.Length <= prefix.Length) return false;
            if (!trimmed.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return false;
            int id = ControlTypeIdFor(trimmed);
            return id != 0;
        }

        /// The UIA control-type id a fully named control type stands for, or 0 when unknown.
        public static int ControlTypeIdFor(string wantType)
        {
            if (wantType == null) return 0;
            string name = wantType.Trim();
            const string prefix = "ControlType.";
            if (name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) name = name.Substring(prefix.Length);
            switch (name.ToLowerInvariant())
            {
                case "button": return 50000;
                case "calendar": return 50001;
                case "checkbox": return 50002;
                case "combobox": return 50003;
                case "edit": return 50004;
                case "hyperlink": return 50005;
                case "image": return 50006;
                case "listitem": return 50007;
                case "list": return 50008;
                case "menu": return 50009;
                case "menubar": return 50010;
                case "menuitem": return 50011;
                case "progressbar": return 50012;
                case "radiobutton": return 50013;
                case "scrollbar": return 50014;
                case "slider": return 50015;
                case "spinner": return 50016;
                case "statusbar": return 50017;
                case "tab": return 50018;
                case "tabitem": return 50019;
                case "text": return 50020;
                case "toolbar": return 50021;
                case "tooltip": return 50022;
                case "tree": return 50023;
                case "treeitem": return 50024;
                case "custom": return 50025;
                case "group": return 50026;
                case "thumb": return 50027;
                case "datagrid": return 50028;
                case "dataitem": return 50029;
                case "document": return 50030;
                case "splitbutton": return 50031;
                case "window": return 50032;
                case "pane": return 50033;
                case "header": return 50034;
                case "headeritem": return 50035;
                case "table": return 50036;
                case "titlebar": return 50037;
                case "separator": return 50038;
                case "semanticzoom": return 50039;
                case "appbar": return 50040;
                default: return 0;
            }
        }

        /// Locate mode: one server-side query, then filter on cached properties only,
        /// so no per-node cross-process read happens while filtering.
        public static void Find(long hwnd, int maxNodes, bool withPatterns,
                                string wantName, string wantType, string wantId, string wantFilter,
                                out object[] outRows, out bool outTruncated)        {            Init();
            IUIAutomationCacheRequest cache = NewCacheRequest(withPatterns, TreeScope_Element, false);
            IUIAutomationElement root = Root(hwnd, cache);

            IUIAutomationCondition condition;
            // §7.4 item 3: only conditions that are *equivalent* when pushed down go to the
            // provider, so the enumeration itself is smaller. `automationId` is exact by
            // definition. A control type is pushed down only when the caller named one in full
            // (`ControlType.Button`); the tool's matching for a partial name is a substring
            // test, and turning that into an exact condition would change what the caller gets
            // -- exactly what the review warns against. The partial case keeps the true
            // condition and filters afterwards, as before.
            if (wantId.Length > 0)
            {
                Marshal.ThrowExceptionForHR(automation.CreatePropertyCondition(UIA_AutomationIdPropertyId, wantId, out condition));
            }
            else if (IsExactControlType(wantType))
            {
                Marshal.ThrowExceptionForHR(automation.CreatePropertyCondition(UIA_ControlTypePropertyId, ControlTypeIdFor(wantType), out condition));
            }
            else
            {
                Marshal.ThrowExceptionForHR(automation.CreateTrueCondition(out condition));
            }

            // The fast path is taken only for a *unique* match, and that restriction is the
            // whole proof: with exactly one node the row list has one element whatever order
            // the provider would have used, so any index resolves to the same element the
            // enumeration would have produced.
            //
            // More than one match falls through deliberately. Measured on Notepad: a shared
            // id (`MenuBar`, twice) is a case where the order of the rows is part of the
            // contract, because `index` picks by it -- and a fast path that reorders the same
            // rows is not a faster answer, it is a different one.
            //
            // A provider that fails the query falls through too, and that is the same rule as
            // the rest of this file: the PowerShell layer around this call already knows how
            // to notice a degraded client, re-create it and read again. A new failure mode
            // invented here (this path throwing on a window the walk reads fine) would be a
            // worse trade than the milliseconds it saves, so the failure is swallowed and the
            // enumeration below takes over.
            if (wantId.Length > 0 && wantName.Length == 0 && wantType.Length == 0 && wantFilter.Length == 0)
            {
                IUIAutomationElement first = TryFindUnique(root, condition);
                if (first != null)
                {
                    // Row(..., live: true): this element came from a plain FindFirst, so it
                    // carries no cache -- reading its *cached* properties yields defaults
                    // (an anonymous ControlType.Unknown row), which is exactly the failure
                    // mode that makes a "faster" path worse than no path.
                    outRows = new object[] { Row(first, 0, withPatterns, true) };
                    outTruncated = false;
                    return;
                }
            }

            IUIAutomationElementArray all;
            int hr = root.FindAllBuildCache(TreeScope_Descendants, condition, cache, out all);
            List<object> rows = new List<object>();
            bool truncated = false;
            if (hr == 0 && all != null)
            {
                int count;
                all.get_Length(out count);
                for (int i = 0; i < count; i++)
                {
                    if (rows.Count >= maxNodes) { truncated = true; break; }
                    IUIAutomationElement element;
                    if (all.GetElement(i, out element) != 0 || element == null) continue;
                    // Row(..., live: false) reads the *cached* properties the FindAll was
                    // asked to fetch -- the whole point of this path is that no per-node
                    // cross-process read happens after the query.
                    Dictionary<string, object> row = Row(element, 0, withPatterns, false);
                    string name = (string)row["name"];
                    string type = (string)row["controlType"];
                    string id = (string)row["automationId"];
                    if (wantName.Length > 0 && name.IndexOf(wantName, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    if (wantType.Length > 0 && type.IndexOf(wantType, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    if (wantFilter.Length > 0)
                    {
                        string hay = name + " " + id + " " + type;
                        if (hay.IndexOf(wantFilter, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    }
                    rows.Add(row);
                }
            }
            outRows = rows.ToArray();
            outTruncated = truncated;
        }

        /// Resolve one element by selector, with the same semantics for every action:
        /// Subtree so the root is a candidate, the same three failure sentences the host
        /// maps to stable codes, and -- the part that matters for latency -- the selector
        /// pushed *into* the UI Automation query instead of applied to a list afterwards.
        ///
        /// This used to be a single FindAll(Subtree, TRUE) over every node of the window
        /// followed by live property reads for the filter, which is one cross-process
        /// call per candidate plus one per property per candidate. It is now staged, and
        /// each stage asks the provider the narrowest question that can answer it:
        ///
        ///   1. an exact AutomationId or ClassName becomes a property condition (ORed
        ///      when both are given), scoped to Descendants -- the root is only a
        ///      candidate when it is the *only* thing that can match;
        ///   2. when one node carries that identity, FindFirst answers and nothing is
        ///      enumerated at all; uniqueness is proved by asking for a second match
        ///      rather than by collecting them;
        ///   3. the name/type substrings, which no property condition can express, are
        ///      then applied to that handful of candidates;
        ///   4. only a selector with no exact property (a bare name substring, say) still
        ///      enumerates a subtree, and then it enumerates Descendants plus the root
        ///      separately instead of a Scope_Subtree FindAll.
        ///
        /// The failure shapes are unchanged on purpose: "matched", "out of range" and
        /// "no element" are what the host turns into its stable codes.
        private static IUIAutomationElement Resolve(long hwnd, string wantId, string wantName, string wantType, string wantClass,
                                                   int index, out object[] matched, out string error)
        {
            matched = new object[0];
            error = "";
            try
            {
                // No cache request on this path, deliberately.
                //
                // FindAllBuildCache fails with E_FAIL for a live element reference
                // (AutomationElementMode_Full) on every provider and every tree scope -- it
                // was measured across six scope/mode combinations, and only Mode_None ever
                // succeeded. An action needs the opposite: a Mode_None element carries no
                // reference to act through. So an action resolves a live element, and the
                // only lever is how few of them it asks for.
                IUIAutomationElement root;
                Marshal.ThrowExceptionForHR(automation.ElementFromHandle(new IntPtr(hwnd), out root));

                List<IUIAutomationElement> found = new List<IUIAutomationElement>();

                if (wantId.Length > 0 || wantClass.Length > 0)
                {
                    IUIAutomationCondition exact = AnyProperty(new string[][] {
                        new string[] { "id", wantId },
                        new string[] { "class", wantClass }
                    });
                    // Stage 1: does exactly one node carry that identity? One
                    // FindFirst answers unless the window has no such node at all,
                    // in which case the count below is zero and the answer is "did
                    // not match" -- the same verdict the old walk produced.
                    IUIAutomationElement first = FindOne(root, TreeScope_Descendants, exact);
                    if (first != null && CountMatches(root, exact) == 1)
                    {
                        if (Qualifies(first, wantId, wantName, wantType, wantClass))
                        {
                            // Stage 2: nothing to disambiguate, so the walk the old code
                            // would have performed produced exactly this answer.
                            matched = new object[] { Row(first, 0, false, true) };
                            return first;
                        }
                    }
                    else
                    {
                        // Several nodes share the identity (real applications do -- Notepad
                        // gives six status-bar cells the same automation id) or none does.
                        // These are the collection stage, and the caller's index picks.
                        IUIAutomationElementArray all;
                        int hr = root.FindAll(TreeScope_Descendants, exact, out all);
                        if (hr == 0 && all != null)
                        {
                            int count;
                            all.get_Length(out count);
                            for (int i = 0; i < count; i++)
                            {
                                IUIAutomationElement element;
                                if (all.GetElement(i, out element) != 0 || element == null) continue;
                                if (Qualifies(element, wantId, wantName, wantType, wantClass)) found.Add(element);
                            }
                        }
                        else
                        {
                            // The narrowing query itself failed. Retrying the broad form once
                            // is what keeps this compatible: a provider that refuses a
                            // property condition but answers a plain enumeration is still
                            // usable, and the caller sees the same three verdicts.
                            EnumerateEverything(root, wantId, wantName, wantType, wantClass, found);
                        }
                        CollectRoot(root, wantId, wantName, wantType, wantClass, found);
                    }
                }
                else
                {
                    // No exact property to ask for: the substrings are evaluated here, on
                    // rows the enumeration already produced.
                    EnumerateEverything(root, wantId, wantName, wantType, wantClass, found);
                }
                // The root is a candidate in every path, and it goes first -- one
                // FindAll(TreeScope_Subtree) produced exactly that order and callers rely on
                // it (see CollectRoot). The `else` path already put it there, so this only
                // has to cover the paths that enumerate without it.
                if (!found.Contains(root)) CollectRoot(root, wantId, wantName, wantType, wantClass, found);

                if (found.Count == 0)
                {
                    error = "no UI Automation element matched (automationId='" + wantId + "' name~='" + wantName + "' controlType='" + wantType + "')";
                    return null;
                }
                TraceResolve(hwnd, wantId, wantName, wantType, wantClass, index, root, found);
                if (index < 0 || index >= found.Count)
                {
                    error = "index " + index + " is out of range; " + found.Count + " element(s) matched";
                    return null;
                }
                IUIAutomationElement target = found[index];
                matched = new object[] { Row(target, 0, false, true) };
                return target;
            }
            catch (Exception failure)
            {
                error = failure.Message;
                return null;
            }
        }

        /// How many nodes the exact condition matches. The second query is only paid when
        /// the first one found something: a window with no such node answers zero, and the
        /// stroll down the whole subtree the old code took is not needed to learn that.
        ///
        /// The count comes from FindAll rather than from a second FindFirst with a "not
        /// this one" condition, because building that condition needs either a runtime-id
        /// comparison (a SAFEARRAY of integers per candidate) or a CompareElements call per
        /// candidate -- both more work than asking for the (already narrow) list once.
        private static int CountMatches(IUIAutomationElement root, IUIAutomationCondition condition)
        {
            IUIAutomationElementArray all;
            if (root.FindAll(TreeScope_Descendants, condition, out all) != 0 || all == null) return 0;
            int count;
            if (all.get_Length(out count) != 0) return 0;
            return count;
        }

        /// The one node the condition matches, or null for "not exactly one" *or* "the
        /// provider would not answer". The caller cannot tell those apart, deliberately:
        /// both mean the enumeration below has to decide.
        private static IUIAutomationElement TryFindUnique(IUIAutomationElement root, IUIAutomationCondition condition)
        {
            try
            {
                IUIAutomationElement first;
                if (root.FindFirst(TreeScope_Descendants, condition, out first) != 0 || first == null) return null;
                IUIAutomationElementArray all;
                if (root.FindAll(TreeScope_Descendants, condition, out all) != 0 || all == null) return null;
                int count;
                if (all.get_Length(out count) != 0) return null;
                return count == 1 ? first : null;
            }
            catch (Exception)
            {
                // A provider in a bad state is exactly when this must not become a new
                // failure: the walk below has the client-health recovery this call does not.
                return null;
            }
        }

        /// One FindFirst, or null. A provider that refuses the query is reported as "no
        /// match" rather than as an exception: the caller falls through to the next stage,
        /// which is where the compatibility lives.
        private static IUIAutomationElement FindOne(IUIAutomationElement root, int scope, IUIAutomationCondition condition)
        {
            IUIAutomationElement found;
            if (root == null || condition == null) return null;
            if (root.FindFirst(scope, condition, out found) != 0) return null;
            return found;
        }

        /// Everything under the root, filtered on identity, silently skipping anything the
        /// provider won't answer for.
        private static void EnumerateEverything(IUIAutomationElement root, string wantId, string wantName, string wantType,
                                                string wantClass, List<IUIAutomationElement> found)
        {
            IUIAutomationCondition everything;
            Marshal.ThrowExceptionForHR(automation.CreateTrueCondition(out everything));
            IUIAutomationElementArray all;
            if (root.FindAll(TreeScope_Descendants, everything, out all) != 0 || all == null) return;
            int count;
            all.get_Length(out count);
            for (int i = 0; i < count; i++)
            {
                IUIAutomationElement element;
                if (all.GetElement(i, out element) != 0 || element == null) continue;
                if (Qualifies(element, wantId, wantName, wantType, wantClass)) found.Add(element);
            }
        }

        /// The root element, checked against the selector like every other candidate and
        /// placed first.
        ///
        /// It has to be a candidate: a window's own element is where the WindowPattern
        /// (close / minimize / maximize / restore) lives, and `controlType: 'Window'` is
        /// exactly how a caller asks for it. One FindAll(TreeScope_Subtree) put the root
        /// first, and callers rely on that order -- a version that "optimised" the root away
        /// made `close the window` close a child pane named Window instead, which is how
        /// this rule ended up written down.
        private static void CollectRoot(IUIAutomationElement root, string wantId, string wantName,
                                        string wantType, string wantClass, List<IUIAutomationElement> found)
        {
            if (root == null) return;
            if (Qualifies(root, wantId, wantName, wantType, wantClass)) found.Insert(0, root);
        }

        /// The selector test, unchanged from the enumeration this replaced: substring on
        /// the name and the control type, exact on the id and the class. The live read is
        /// what decides in every case -- the condition stage only narrows what is asked for.
        private static bool Qualifies(IUIAutomationElement element, string wantId, string wantName, string wantType, string wantClass)
        {
            if (element == null) return false;
            if (wantId.Length > 0 && Text(element, UIA_AutomationIdPropertyId, true) != wantId) return false;
            if (wantClass.Length > 0 && Text(element, UIA_ClassNamePropertyId, true) != wantClass) return false;
            if (wantName.Length > 0 && Text(element, UIA_NamePropertyId, true).IndexOf(wantName, StringComparison.OrdinalIgnoreCase) < 0) return false;
            if (wantType.Length > 0 && ControlTypeName(Number(element, UIA_ControlTypePropertyId, true)).IndexOf(wantType, StringComparison.OrdinalIgnoreCase) < 0) return false;
            return true;
        }

        /// OR over the given exact properties, so one query can carry both an
        /// AutomationId and a ClassName without either turning into a full scan.
        private static IUIAutomationCondition AnyProperty(string[][] pairs)
        {
            IUIAutomationCondition union = null;
            List<IUIAutomationCondition> parts = new List<IUIAutomationCondition>();
            foreach (string[] pair in pairs)
            {
                if (pair == null || pair.Length < 2 || pair[1] == null || pair[1].Length == 0) continue;
                int propertyId = pair[0] == "id" ? UIA_AutomationIdPropertyId : UIA_ClassNamePropertyId;
                IUIAutomationCondition part;
                if (automation.CreatePropertyCondition(propertyId, pair[1], out part) != 0 || part == null) continue;
                parts.Add(part);
            }
            if (parts.Count == 0)
            {
                Marshal.ThrowExceptionForHR(automation.CreateTrueCondition(out union));
                return union;
            }
            if (parts.Count == 1) return parts[0];
            IUIAutomationCondition current = parts[0];
            for (int i = 1; i < parts.Count; i++)
            {
                IUIAutomationCondition next;
                Marshal.ThrowExceptionForHR(automation.CreateOrCondition(current, parts[i], out next));
                current = next;
            }
            return current;
        }

        /// Which element a selector resolved to, when DSH_COMPUTER_USE_DEBUG_RESOLVE=1.
        ///
        /// Off by default, and it writes to a file rather than to stderr because the
        /// worker's stderr belongs to the host and a line there has nowhere to land. The
        /// question this answers is the one a failure sentence cannot -- "close the
        /// window" and "the close went to something else" produce the same sentence, and
        /// the difference is this list, in order, with the root shown separately.
        private static void TraceResolve(long hwnd, string wantId, string wantName, string wantType, string wantClass,
                                         int index, IUIAutomationElement root, List<IUIAutomationElement> found)
        {
            if (Environment.GetEnvironmentVariable("DSH_COMPUTER_USE_DEBUG_RESOLVE") != "1") return;
            try
            {
                StringBuilder trace = new StringBuilder();
                trace.Append(DateTime.Now.ToString("HH:mm:ss.fff"));
                trace.Append(" resolve hwnd=" + hwnd + " id='" + wantId + "' name~='" + wantName + "' type~='" + wantType
                    + "' class='" + wantClass + "' index=" + index + " candidates=" + found.Count);
                for (int i = 0; i < found.Count && i < 16; i++)
                {
                    IUIAutomationElement probe = found[i];
                    trace.Append(" | " + i + ":" + Describe(probe));
                }
                trace.Append(" | root:" + Describe(root));
                System.IO.File.AppendAllText(System.IO.Path.Combine(System.IO.Path.GetTempPath(), "dsh-computer-use-resolve-trace.log"),
                    trace.ToString() + Environment.NewLine);
            }
            catch (Exception)
            {
                // A diagnostic that can fail a call is worse than no diagnostic.
            }
        }

        /// One line of an element's identity, for the trace above.
        private static string Describe(IUIAutomationElement element)
        {
            if (element == null) return "(none)";
            return ControlTypeName(Number(element, UIA_ControlTypePropertyId, true))
                + " '" + Text(element, UIA_NamePropertyId, true) + "' #" + Text(element, UIA_AutomationIdPropertyId, true);
        }

        /// A control type name as its UIA number, from any spelling the caller may use:
        /// the tool's own "Button", the tree's "ControlType.Button", or the raw value.
        /// Kept for the stages that want a numeric type -- the selector test itself reads
        /// the live property, because that read is what decides.
        private static int ControlTypeValue(string wantType)
        {
            if (wantType == null || wantType.Length == 0) return 0;
            string text = wantType.Trim();
            if (text.StartsWith("ControlType.", StringComparison.OrdinalIgnoreCase)) text = text.Substring("ControlType.".Length);
            int number;
            if (int.TryParse(text, out number)) return number;
            return ControlTypeId(text);
        }

        /// The reverse of ControlTypeName, for the property condition.
        private static int ControlTypeId(string name)
        {
            for (int i = 50000; i <= 50040; i++)
            {
                if (ControlTypeName(i).EndsWith("." + name, StringComparison.OrdinalIgnoreCase)) return i;
            }
            return 0;
        }

        /// Find the range that holds `text`, honouring prefix/suffix context.
        ///
        /// Positioning by character offset is deliberately not offered: walking to an
        /// offset costs one cross-process call per character. Finding the text and then
        /// verifying the context around the hit costs a handful of calls at any offset.
        private static IUIAutomationTextRange FindRange(IUIAutomationTextPattern pattern, string text, string prefix, string suffix,
                                                        int attempts, out string error)
        {
            error = "";
            IUIAutomationTextRange search;
            Marshal.ThrowExceptionForHR(pattern.GetDocumentRange(out search));
            for (int attempt = 0; attempt < attempts; attempt++)
            {
                IUIAutomationTextRange candidate;
                int hr = search.FindText(text, 0, 0, out candidate);
                if (hr != 0 || candidate == null) break;
                if (prefix.Length == 0 && suffix.Length == 0) return candidate;

                // Read a context window around the hit and compare it. The move returns
                // how far it actually moved, which is how much context exists there.
                IUIAutomationTextRange probe;
                Marshal.ThrowExceptionForHR(candidate.Clone(out probe));
                int moved = 0;
                if (prefix.Length > 0)
                {
                    try { probe.MoveEndpointByUnit(TextPatternRangeEndpoint_Start, TextUnit_Character, -prefix.Length, out moved); } catch { }
                }
                if (suffix.Length > 0)
                {
                    try { probe.MoveEndpointByUnit(TextPatternRangeEndpoint_End, TextUnit_Character, suffix.Length, out moved); } catch { }
                }
                string context;
                try { probe.GetText(-1, out context); } catch { context = ""; }
                context = context ?? "";
                bool okPrefix = prefix.Length == 0 || context.StartsWith(prefix, StringComparison.Ordinal);
                bool okSuffix = suffix.Length == 0 || context.EndsWith(suffix, StringComparison.Ordinal);
                if (okPrefix && okSuffix) return candidate;

                // Not the right occurrence: restart the search just past this hit.
                Marshal.ThrowExceptionForHR(pattern.GetDocumentRange(out search));
                Marshal.ThrowExceptionForHR(search.Clone(out search));
                Marshal.ThrowExceptionForHR(search.MoveEndpointByRange(TextPatternRangeEndpoint_Start, candidate, TextPatternRangeEndpoint_End));
            }
            // A context that never matches has more than one cause, and the caller's next
            // move depends on which. The one worth naming: a provider may count characters
            // where this code counts UTF-16 code units, and for anything outside the Basic
            // Multilingual Plane -- an emoji, a rare han character -- moving by
            // String.Length lands the boundary between the halves of a surrogate pair.
            // Reporting that as "not found" sends the caller hunting for a text that is
            // right there.
            bool nonBmp = HasSurrogate(text) || HasSurrogate(prefix) || HasSurrogate(suffix);
            if (nonBmp) {
                error = "the text '" + text + "' was not found with the given prefix/suffix in this element, and one of them contains a character outside the Basic Multilingual Plane (a surrogate pair): this provider's character arithmetic may differ from UTF-16 code units, so the range boundary would fall inside a character. Retry without prefix/suffix, or with a prefix that is plain text; nothing was selected";
            } else {
                error = (prefix.Length > 0 || suffix.Length > 0)
                    ? "the text '" + text + "' was not found with the given prefix/suffix in this element; nothing was selected"
                    : "the text '" + text + "' was not found in this element";
            }
            return null;
        }

        /// Whether a string carries a UTF-16 surrogate pair, i.e. a character outside the
        /// Basic Multilingual Plane.
        private static bool HasSurrogate(string value)
        {
            if (string.IsNullOrEmpty(value)) return false;
            for (int i = 0; i < value.Length; i++)
            {
                if (char.IsSurrogate(value[i])) return true;
            }
            return false;
        }

        /// The first rectangle of a range, in screen coordinates. A range spanning
        /// several lines reports one quadruple per line; the first one is where the
        /// text starts, which is what a click wants.
        private static bool RangeRect(IUIAutomationTextRange range, out int x, out int y, out int width, out int height)
        {
            x = 0; y = 0; width = 0; height = 0;
            double[] rects;
            if (range.GetBoundingRectangles(out rects) != 0) return false;
            if (rects == null || rects.Length < 4) return false;
            x = Clamp(rects[0]);
            y = Clamp(rects[1]);
            width = Clamp(rects[2]);
            height = Clamp(rects[3]);
            return width > 0 && height > 0;
        }

        /// The bounding box of every line the range covers, plus how many lines that is.
        /// Where a wrapped paragraph sits is its extent, not its first line.
        private static bool RangeUnionRect(IUIAutomationTextRange range, out int x, out int y, out int width, out int height, out int lines)
        {
            x = 0; y = 0; width = 0; height = 0; lines = 0;
            double[] rects;
            if (range.GetBoundingRectangles(out rects) != 0) return false;
            if (rects == null || rects.Length < 4) return false;
            int left = int.MaxValue, top = int.MaxValue, right = int.MinValue, bottom = int.MinValue;
            for (int i = 0; i + 3 < rects.Length; i += 4)
            {
                double rectWidth = rects[i + 2];
                double rectHeight = rects[i + 3];
                if (rectWidth <= 0 || rectHeight <= 0) continue;
                int lineLeft = Clamp(rects[i]);
                int lineTop = Clamp(rects[i + 1]);
                int lineRight = Clamp(rects[i] + rectWidth);
                int lineBottom = Clamp(rects[i + 1] + rectHeight);
                if (lineLeft < left) left = lineLeft;
                if (lineTop < top) top = lineTop;
                if (lineRight > right) right = lineRight;
                if (lineBottom > bottom) bottom = lineBottom;
                lines++;
            }
            if (lines == 0) return false;
            x = left; y = top; width = right - left; height = bottom - top;
            return width > 0 && height > 0;
        }

        /// Locate a string inside a text element and report where it is on screen.
        /// This is what lets a caller address something by its text instead of by
        /// coordinates.
        public static void LocateText(long hwnd, string wantId, string wantName, string wantType, string wantClass, int index,
                                      string text, string prefix, string suffix, int attempts,
                                      out int outX, out int outY, out int outWidth, out int outHeight,
                                      out string outFound, out object[] outMatched, out string outError)
        {
            outX = 0; outY = 0; outWidth = 0; outHeight = 0;
            outFound = "";
            outMatched = new object[0];
            outError = "";
            try
            {
                Init();
                if (text == null || text.Length == 0)
                {
                    outError = "click_text requires the text to locate";
                    return;
                }
                prefix = prefix ?? "";
                suffix = suffix ?? "";
                IUIAutomationElement target = Resolve(hwnd, wantId, wantName, wantType, wantClass, index, out outMatched, out outError);
                if (target == null) return;
                IUIAutomationTextPattern pattern = Pattern<IUIAutomationTextPattern>(target, UIA_TextPatternId,
                    "TextPattern, so its text cannot be located (try ValuePattern through get_value instead)");
                string error;
                IUIAutomationTextRange hit = FindRange(pattern, text, prefix, suffix, attempts, out error);
                if (hit == null) { outError = error; return; }
                string found;
                try { hit.GetText(-1, out found); } catch { found = text; }
                outFound = found ?? text;
                if (!RangeRect(hit, out outX, out outY, out outWidth, out outHeight))
                {
                    outError = "the matched text reported no on-screen rectangle, so there is nothing to click: this provider does not support text geometry";
                }
            }
            catch (Exception error)
            {
                outError = error.Message;
            }
        }

        /// Where the caret is, and which line it sits on.
        ///
        /// TextPattern2 is the only way to ask this: TextPattern has no caret accessor
        /// at all, and the managed wrapper does not expose TextPattern2 either. A caret
        /// range is degenerate, so its own rectangle is usually empty -- the enclosing
        /// line is what carries geometry.
        public static void ReadCaret(long hwnd, string wantId, string wantName, string wantType, string wantClass, int index,
                                     out bool outActive, out string outLine, out int outX, out int outY, out int outWidth, out int outHeight,
                                     out object[] outMatched, out string outError)
        {
            outActive = false;
            outLine = "";
            outX = 0; outY = 0; outWidth = 0; outHeight = 0;
            outMatched = new object[0];
            outError = "";
            try
            {
                Init();
                IUIAutomationElement target = Resolve(hwnd, wantId, wantName, wantType, wantClass, index, out outMatched, out outError);
                if (target == null) return;
                IUIAutomationTextPattern2 pattern = Pattern<IUIAutomationTextPattern2>(target, UIA_TextPattern2Id,
                    "TextPattern2, so the caret position cannot be read (get_text still works through TextPattern)");
                int active;
                IUIAutomationTextRange caret;
                Marshal.ThrowExceptionForHR(pattern.GetCaretRange(out active, out caret));
                outActive = active != 0;
                if (caret == null) return;

                // Geometry: the caret's own rectangle when the provider gives one, the
                // enclosing line otherwise.
                if (!RangeRect(caret, out outX, out outY, out outWidth, out outHeight))
                {
                    IUIAutomationTextRange line;
                    Marshal.ThrowExceptionForHR(caret.Clone(out line));
                    Marshal.ThrowExceptionForHR(line.ExpandToEnclosingUnit(TextUnit_Line));
                    RangeRect(line, out outX, out outY, out outWidth, out outHeight);
                    string lineText;
                    try { line.GetText(-1, out lineText); } catch { lineText = ""; }
                    outLine = Trim(lineText ?? "");
                }
                else
                {
                    IUIAutomationTextRange line;
                    Marshal.ThrowExceptionForHR(caret.Clone(out line));
                    Marshal.ThrowExceptionForHR(line.ExpandToEnclosingUnit(TextUnit_Line));
                    string lineText;
                    try { line.GetText(-1, out lineText); } catch { lineText = ""; }
                    outLine = Trim(lineText ?? "");
                }
            }
            catch (Exception error)
            {
                outError = error.Message;
            }
        }

        /// Collapse whitespace and cap the length: this ends up in a receipt.
        private static string Trim(string value)
        {
            string collapsed = value.Replace("\r", " ").Replace("\n", " ").Trim();
            while (collapsed.Contains("  ")) collapsed = collapsed.Replace("  ", " ");
            return collapsed.Length > 120 ? collapsed.Substring(0, 120) : collapsed;
        }

        /// What an older control offers through the MSAA bridge: value, then name,
        /// then description. Empty when it offers none of them.
        private static string LegacyText(IUIAutomationElement element)
        {
            object raw;
            if (element.GetCurrentPattern(UIA_LegacyIAccessiblePatternId, out raw) != 0 || raw == null) return "";
            IUIAutomationLegacyIAccessiblePattern legacy = raw as IUIAutomationLegacyIAccessiblePattern;
            if (legacy == null) return "";
            string value = legacy.CurrentValue ?? "";
            if (value.Length > 0) return value;
            string name = legacy.CurrentName ?? "";
            if (name.Length > 0) return name;
            return legacy.CurrentDescription ?? "";
        }

        /// B1 (8.txt §5): the text a read can carry, read through the client that read the
        // tree.
        ///
        /// It lives here rather than in the managed wrapper because of a measured
        /// difference on the same window: the COM client answered 11 rows with their
        /// automation ids while the managed client answered 2 anonymous rows (a WinForms
        /// window served through the MSAA bridge). A text target resolved through the
        /// managed API therefore reports `target_required` on a window the caller is
        /// plainly looking at. §5 asks for both engines; the managed implementation stays
        /// as the fallback for a host where COM is unavailable.
        ///
        /// Everything is live-read: an element resolved through a plain FindAll has no
        /// cache behind it, and a cached read would answer with defaults.
        public static Dictionary<string, object> ReadTextObservation(long hwnd, string wantId, string wantName, string wantType,
                                                                    string wantClass, int index, bool useFocused,
                                                                    bool wantFocused, bool wantSelection, bool wantDocument,
                                                                    int maxChars)
        {
            Dictionary<string, object> result = new Dictionary<string, object>();
            result["status"] = "";
            result["note"] = "";
            result["error"] = "";
            result["autoId"] = "";
            result["name"] = "";
            result["controlType"] = "";
            result["cx"] = 0;
            result["cy"] = 0;
            result["pid"] = 0L;
            result["focusedSummary"] = "";
            result["selection"] = "";
            result["selectionStatus"] = "";
            result["selectionTruncated"] = false;
            result["document"] = "";
            result["documentStatus"] = "";
            result["documentTruncated"] = false;
            result["hasTextPattern"] = false;
            try
            {
                Init();
                IUIAutomationElement target = null;
                if (useFocused)
                {
                    IUIAutomationElement focusedElement;
                    if (automation.GetFocusedElement(out focusedElement) != 0 || focusedElement == null)
                    {
                        result["status"] = "unavailable";
                        result["note"] = "no element currently holds the focus";
                        return result;
                    }
                    target = focusedElement;
                }
                else
                {
                    object[] matched;
                    string resolveError;
                    target = Resolve(hwnd, wantId, wantName, wantType, wantClass, index, out matched, out resolveError);
                    if (target == null)
                    {
                        result["status"] = "unavailable";
                        result["note"] = resolveError;
                        return result;
                    }
                }
                result["status"] = "ok";
                string automationId = Text(target, UIA_AutomationIdPropertyId, true);
                string elementName = Text(target, UIA_NamePropertyId, true);
                string controlType = ControlTypeName(Number(target, UIA_ControlTypePropertyId, true));
                result["autoId"] = automationId;
                result["name"] = elementName;
                result["controlType"] = controlType;
                result["pid"] = Number(target, UIA_ProcessIdPropertyId, true);
                object bounds = Property(target, UIA_BoundingRectanglePropertyId, true);
                double[] four = bounds as double[];
                if (four != null && four.Length == 4)
                {
                    result["cx"] = Clamp(four[0] + four[2] / 2.0);
                    result["cy"] = Clamp(four[1] + four[3] / 2.0);
                }
                if (wantFocused)
                {
                    string summary = controlType.Replace("ControlType.", "");
                    if (elementName.Length > 0) summary += " \u00b7 " + elementName;
                    object rawValue;
                    if (target.GetCurrentPattern(UIA_ValuePatternId, out rawValue) == 0 && rawValue != null)
                    {
                        IUIAutomationValuePattern valuePattern = rawValue as IUIAutomationValuePattern;
                        if (valuePattern != null)
                        {
                            string value = valuePattern.CurrentValue ?? "";
                            if (value.Length > 0) summary += " \u00b7 value: " + value;
                        }
                    }
                    result["focusedSummary"] = summary;
                }

                object rawText;
                bool hasText = target.GetCurrentPattern(UIA_TextPatternId, out rawText) == 0 && rawText != null;
                IUIAutomationTextPattern textPattern = hasText ? rawText as IUIAutomationTextPattern : null;
                if (textPattern == null) hasText = false;
                result["hasTextPattern"] = hasText;

                if (wantSelection)
                {
                    if (!hasText)
                    {
                        result["selectionStatus"] = "unsupported";
                    }
                    else
                    {
                        try
                        {
                            IUIAutomationTextRangeArray ranges;
                            Marshal.ThrowExceptionForHR(textPattern.GetSelection(out ranges));
                            StringBuilder joined = new StringBuilder();
                            int pieces = 0;
                            if (ranges != null)
                            {
                                int length;
                                if (ranges.get_Length(out length) == 0)
                                {
                                    for (int i = 0; i < length; i++)
                                    {
                                        IUIAutomationTextRange range;
                                        if (ranges.GetElement(i, out range) != 0 || range == null) continue;
                                        string piece;
                                        try { range.GetText(maxChars + 1, out piece); } catch { piece = ""; }
                                        if (string.IsNullOrEmpty(piece)) continue;
                                        if (joined.Length > 0) joined.Append('\n');
                                        joined.Append(piece);
                                        pieces++;
                                        if (joined.Length > maxChars) break;
                                    }
                                }
                            }
                            string selection = joined.ToString();
                            if (selection.Length > maxChars)
                            {
                                selection = CutAt(maxChars, selection);
                                result["selectionTruncated"] = true;
                            }
                            result["selection"] = selection;
                            result["selectionStatus"] = "ok";
                        }
                        catch (Exception selectionError)
                        {
                            result["selectionStatus"] = "failed";
                            result["note"] = selectionError.Message;
                        }
                    }
                }

                if (wantDocument)
                {
                    if (!hasText)
                    {
                        result["documentStatus"] = "unsupported";
                    }
                    else
                    {
                        try
                        {
                            IUIAutomationTextRange document;
                            Marshal.ThrowExceptionForHR(textPattern.GetDocumentRange(out document));
                            string documentText = "";
                            if (document != null)
                            {
                                try { document.GetText(maxChars + 1, out documentText); } catch { documentText = ""; }
                            }
                            documentText = documentText ?? "";
                            if (documentText.Length > maxChars)
                            {
                                documentText = CutAt(maxChars, documentText);
                                result["documentTruncated"] = true;
                            }
                            result["document"] = documentText;
                            result["documentStatus"] = "ok";
                        }
                        catch (Exception documentError)
                        {
                            result["documentStatus"] = "failed";
                            result["note"] = documentError.Message;
                        }
                    }
                }
            }
            catch (Exception error)
            {
                result["error"] = error.Message;
                if (string.IsNullOrEmpty((string)result["status"])) result["status"] = "failed";
            }
            return result;
        }

        /// A cut that never lands between the halves of a character outside the BMP.
        private static string CutAt(int limit, string value)
        {
            if (value == null) return "";
            if (limit <= 0) return "";
            if (value.Length <= limit) return value;
            int cut = limit;
            if (char.IsHighSurrogate(value[cut - 1])) cut--;
            return value.Substring(0, cut);
        }

        /// Read an element's document text. The 4000-character ceiling and the
        /// truncated flag match the managed path exactly: the model gets the same
        /// answer whichever engine produced it.
        public static void ReadText(long hwnd, string wantId, string wantName, string wantType, string wantClass, int index,
                                    out string outText, out bool outTruncated, out object[] outMatched, out string outError)
        {
            outText = "";
            outTruncated = false;
            outMatched = new object[0];
            outError = "";
            try
            {
                Init();
                IUIAutomationElement target = Resolve(hwnd, wantId, wantName, wantType, wantClass, index, out outMatched, out outError);
                if (target == null) return;
                object rawPattern;
                if (target.GetCurrentPattern(UIA_TextPatternId, out rawPattern) != 0 || !(rawPattern is IUIAutomationTextPattern))
                {
                    // No text provider. Older controls still carry their content in the
                    // MSAA bridge, and a read the caller asked for is worth answering
                    // from there rather than failing.
                    outText = LegacyText(target);
                    if (outText.Length == 0)
                    {
                        outError = "the matched element does not support TextPattern, so its text cannot be read or selected (try ValuePattern through get_value instead)";
                    }
                    return;
                }
                IUIAutomationTextPattern pattern = (IUIAutomationTextPattern)rawPattern;
                IUIAutomationTextRange document;
                Marshal.ThrowExceptionForHR(pattern.GetDocumentRange(out document));
                string text;
                Marshal.ThrowExceptionForHR(document.GetText(4001, out text));
                text = text ?? "";
                if (text.Length > 4000)
                {
                    outText = text.Substring(0, 4000);
                    outTruncated = true;
                }
                else
                {
                    outText = text;
                }
            }
            catch (Exception error)
            {
                outError = error.Message;
            }
        }

        /// Locate a string inside a text element and select it -- or collapse onto one
        /// of its edges to place the caret.
        ///
        /// Positioning by character offset is deliberately not offered: walking to an
        /// offset costs one cross-process call per character. Finding the text and then
        /// verifying the context around the hit costs a handful of calls at any offset.
        public static void SelectText(long hwnd, string wantId, string wantName, string wantType, string wantClass, int index,
                                      string text, string prefix, string suffix, string selectionType, int attempts,
                                      out string outSelected, out object[] outMatched, out string outError)
        {
            outSelected = "";
            outMatched = new object[0];
            outError = "";
            try
            {
                Init();
                if (text == null || text.Length == 0)
                {
                    outError = "select_text requires the text to locate";
                    return;
                }
                prefix = prefix ?? "";
                suffix = suffix ?? "";
                IUIAutomationElement target = Resolve(hwnd, wantId, wantName, wantType, wantClass, index, out outMatched, out outError);
                if (target == null) return;
                IUIAutomationTextPattern pattern = Pattern<IUIAutomationTextPattern>(target, UIA_TextPatternId,
                    "TextPattern, so its text cannot be read or selected (try ValuePattern through get_value instead)");

                string rangeError;
                IUIAutomationTextRange hit = FindRange(pattern, text, prefix, suffix, attempts, out rangeError);
                if (hit == null) { outError = rangeError; return; }

                if (selectionType == "cursor_before")
                {
                    Marshal.ThrowExceptionForHR(hit.MoveEndpointByRange(TextPatternRangeEndpoint_End, hit, TextPatternRangeEndpoint_Start));
                }
                else if (selectionType == "cursor_after")
                {
                    Marshal.ThrowExceptionForHR(hit.MoveEndpointByRange(TextPatternRangeEndpoint_Start, hit, TextPatternRangeEndpoint_End));
                }
                Marshal.ThrowExceptionForHR(hit.Select());
                string selected;
                try { hit.GetText(-1, out selected); } catch { selected = ""; }
                outSelected = selected ?? "";
            }
            catch (Exception error)
            {
                outError = error.Message;
            }
        }

        /// Resolve one element and perform an action on it.
        ///
        /// The error strings deliberately reuse the wording the managed path uses:
        /// the host maps a failure to its stable code by matching those phrases, so a
        /// different sentence here would silently turn ELEMENT_UNAVAILABLE into an
        /// uncoded error.
        public static void Act(long hwnd, string action,
                               string wantId, string wantName, string wantType, string wantClass, int index,
                               string value, out object[] outMatched, out string outValue, out bool outWrote, out string outError)
        {
            outMatched = new object[0];
            outValue = "";
            outWrote = true;
            outError = "";
            try
            {
                Init();
                IUIAutomationElement target = Resolve(hwnd, wantId, wantName, wantType, wantClass, index, out outMatched, out outError);
                if (target == null) return;

                bool reading = action == "get_value";
                if (!reading && !Flag(target, UIA_IsEnabledPropertyId, true))
                {
                    Dictionary<string, object> matchedRow = (Dictionary<string, object>)outMatched[0];
                    outError = "the matched element is disabled (" + Label(matchedRow) + "), so it would ignore the action; nothing was sent";
                    return;
                }

                switch (action)
                {
                    case "invoke":
                    {
                        IUIAutomationInvokePattern pattern = Pattern<IUIAutomationInvokePattern>(target, UIA_InvokePatternId, "Invoke");
                        Marshal.ThrowExceptionForHR(pattern.Invoke());
                        break;
                    }
                    case "set_value":
                    {
                        IUIAutomationValuePattern pattern = Pattern<IUIAutomationValuePattern>(target, UIA_ValuePatternId, "ValuePattern.SetValue");
                        Marshal.ThrowExceptionForHR(pattern.SetValue(value));
                        outValue = value;
                        break;
                    }
                    case "get_value":
                    {
                        outWrote = false;
                        object raw;
                        if (target.GetCurrentPattern(UIA_ValuePatternId, out raw) == 0 && raw != null)
                        {
                            IUIAutomationValuePattern pattern = raw as IUIAutomationValuePattern;
                            if (pattern != null) { outValue = pattern.CurrentValue ?? ""; break; }
                        }
                        // Older controls carry their value in the MSAA bridge instead.
                        // Reading it is safe, so a missing ValuePattern falls back
                        // rather than failing a read the user asked for.
                        string legacyValue = LegacyText(target);
                        if (legacyValue.Length > 0) { outValue = legacyValue; break; }
                        outError = "the matched element does not support ValuePattern";
                        break;
                    }
                    case "toggle":
                    {
                        IUIAutomationTogglePattern pattern = Pattern<IUIAutomationTogglePattern>(target, UIA_TogglePatternId, "Toggle");
                        Marshal.ThrowExceptionForHR(pattern.Toggle());
                        break;
                    }
                    case "select":
                    {
                        IUIAutomationSelectionItemPattern pattern = Pattern<IUIAutomationSelectionItemPattern>(target, UIA_SelectionItemPatternId, "SelectionItem");
                        Marshal.ThrowExceptionForHR(pattern.Select());
                        break;
                    }
                    case "expand":
                    case "collapse":
                    {
                        IUIAutomationExpandCollapsePattern pattern = Pattern<IUIAutomationExpandCollapsePattern>(target, UIA_ExpandCollapsePatternId, "ExpandCollapse");
                        Marshal.ThrowExceptionForHR(action == "expand" ? pattern.Expand() : pattern.Collapse());
                        break;
                    }
                    case "scroll_into_view":
                    {
                        IUIAutomationScrollItemPattern pattern = Pattern<IUIAutomationScrollItemPattern>(target, UIA_ScrollItemPatternId, "ScrollItemPattern.ScrollIntoView (it is not inside a scrollable container)");
                        Marshal.ThrowExceptionForHR(pattern.ScrollIntoView());
                        break;
                    }
                    case "focus":
                    {
                        Marshal.ThrowExceptionForHR(target.SetFocus());
                        break;
                    }
                    case "close":
                    {
                        // What alt+f4 does, minus the requirement that the window hold
                        // the foreground and minus any synthesized input.
                        IUIAutomationWindowPattern pattern = Pattern<IUIAutomationWindowPattern>(target, UIA_WindowPatternId, "WindowPattern (close/minimize/maximize/restore)");
                        Marshal.ThrowExceptionForHR(pattern.Close());
                        break;
                    }
                    case "minimize":
                    case "maximize":
                    case "restore":
                    {
                        IUIAutomationWindowPattern pattern = Pattern<IUIAutomationWindowPattern>(target, UIA_WindowPatternId, "WindowPattern (close/minimize/maximize/restore)");
                        int state = action == "minimize" ? WindowVisualState_Minimized : (action == "maximize" ? WindowVisualState_Maximized : WindowVisualState_Normal);
                        Marshal.ThrowExceptionForHR(pattern.SetWindowVisualState(state));
                        break;
                    }
                    case "legacy_action":
                    {
                        IUIAutomationLegacyIAccessiblePattern pattern = Pattern<IUIAutomationLegacyIAccessiblePattern>(target, UIA_LegacyIAccessiblePatternId, "LegacyIAccessiblePattern.DoDefaultAction");
                        Marshal.ThrowExceptionForHR(pattern.DoDefaultAction());
                        break;
                    }
                    default:
                        outError = "unknown UI Automation action '" + action + "'";
                        break;
                }
            }
            catch (Exception error)
            {
                outError = error.Message;
            }
        }

        /// Fetch one pattern and hand it back as its interface, or fail with the
        /// sentence the host maps to ACTION_UNAVAILABLE.
        private static T Pattern<T>(IUIAutomationElement element, int patternId, string label) where T : class
        {
            object raw;
            int hr = element.GetCurrentPattern(patternId, out raw);
            if (hr != 0 || raw == null)
            {
                throw new InvalidOperationException("the matched element does not support " + label);
            }
            T typed = raw as T;
            if (typed == null)
            {
                throw new InvalidOperationException("the matched element does not support " + label);
            }
            return typed;
        }

        /// The label the receipt uses for a matched element.
        private static string Label(Dictionary<string, object> row)
        {
            string type = ((string)row["controlType"]).Replace("ControlType.", "");
            string name = (string)row["name"];
            string id = (string)row["automationId"];
            string label = "(" + type + ")";
            if (name.Length > 0) label = type + " \"" + name + "\"";
            if (id.Length > 0) label = label + " #" + id;
            return label;
        }
    }
}
'@

$script:ComUiaReady = $false
try {
    Add-Type -TypeDefinition $uiaComSource -Language CSharp | Out-Null
    $script:ComUiaReady = [DshUia.Engine]::Available()
    if (-not $script:ComUiaReady) {
        $script:ComUiaError = [DshUia.Engine]::LastError()
    }
} catch {
    $script:ComUiaReady = $false
    $script:ComUiaError = $_.Exception.Message
}

$dpiMode = [DshNative]::EnableDpiAwareness()
# What it actually is, which is what decides whether coordinates are real pixels.
$dpiActual = [DshNative]::ActualDpiAwareness()
if ($dpiActual -ne 'per-monitor' -and $dpiActual -ne 'per-monitor-v2') {
    # Not fatal -- the plugin still works -- but every coordinate on a scaled display may
    # be virtualized, so it is worth saying out loud rather than discovering as "clicks
    # land slightly off".
    [Console]::Error.WriteLine("dsh-computer-use: DPI awareness is '$dpiActual' (asked for '$dpiMode'); on a scaled display screen coordinates may be virtualized")
}

# ------------------------------------------------------------------ utilities

$VK = @{}
for ($c = [int][char]'A'; $c -le [int][char]'Z'; $c++) { $VK[[string][char]$c] = $c }
for ($c = [int][char]'0'; $c -le [int][char]'9'; $c++) { $VK[[string][char]$c] = $c }
for ($i = 1; $i -le 24; $i++) { $VK["f$i"] = 0x6F + $i }
$VK['backspace'] = 0x08; $VK['tab'] = 0x09; $VK['enter'] = 0x0D; $VK['return'] = 0x0D
$VK['shift'] = 0x10; $VK['ctrl'] = 0x11; $VK['control'] = 0x11; $VK['alt'] = 0x12
$VK['pause'] = 0x13; $VK['capslock'] = 0x14; $VK['esc'] = 0x1B; $VK['escape'] = 0x1B
$VK['space'] = 0x20; $VK['pageup'] = 0x21; $VK['pagedown'] = 0x22; $VK['end'] = 0x23
$VK['home'] = 0x24; $VK['left'] = 0x25; $VK['up'] = 0x26; $VK['right'] = 0x27; $VK['down'] = 0x28
$VK['printscreen'] = 0x2C; $VK['insert'] = 0x2D; $VK['delete'] = 0x2E; $VK['del'] = 0x2E
$VK['win'] = 0x5B; $VK['lwin'] = 0x5B; $VK['meta'] = 0x5B; $VK['super'] = 0x5B; $VK['rwin'] = 0x5C
# Cross-platform spellings of the same modifiers. A model that learned "cmd+a" or
# "option+tab" elsewhere should not have to unlearn it here, so the aliases follow the
# obvious mapping (super/meta/command -> the Windows key, alt/option -> Alt, control
# -> Ctrl).
$VK['cmd'] = 0x5B; $VK['command'] = 0x5B; $VK['opt'] = 0x12; $VK['option'] = 0x12
$VK['numlock'] = 0x90; $VK['scrolllock'] = 0x91
$VK[';'] = 0xBA; $VK['='] = 0xBB; $VK[','] = 0xBC; $VK['-'] = 0xBD; $VK['.'] = 0xBE; $VK['/'] = 0xBF
$VK['`'] = 0xC0; $VK['['] = 0xDB; $VK['\'] = 0xDC; $VK[']'] = 0xDD; $VK["'"] = 0xDE

# Keys that must carry KEYEVENTF_EXTENDEDKEY or the target app sees the wrong key.
$EXTENDED = @(0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2C, 0x2D, 0x2E, 0x5B, 0x5C, 0x90)

# ------------------------------------------------------------------- input state
#
# Every synthetic press is remembered until its matching release has actually been
# sent. A drag that dies between LEFTDOWN and LEFTUP, or a worker killed mid-hold,
# would otherwise leave the user's desktop with a mouse button stuck down -- a
# failure the user has to fix by hand. `release` (and process exit) unwinds it.

$script:HeldKeys = New-Object System.Collections.Generic.List[int]
$script:HeldButtons = New-Object System.Collections.Generic.List[int]
# Where the held-input state is mirrored for the host's independent release path (§6 ④).
# Empty means "do not mirror", which is what a worker started by hand gets.
$script:HeldStateFile = ''
if ($env:DSH_COMPUTER_USE_HELD_FILE) { $script:HeldStateFile = "$($env:DSH_COMPUTER_USE_HELD_FILE)" }

# Two waits can sit between a write and the frame that reports it, and they answer
# two different questions.
#
#   settle     -- "has the compositor had time to put the action on screen?"  A floor on
#                 the *age* of the last write (300 ms), so the frame returned is not the
#                 one from before the click. Costs nothing when the action itself, the
#                 transport or the model's own turn already spent that long.
#   stability  -- "has the screen stopped changing?"  A poll, which can only answer that
#                 by finding two of its samples identical -- and a live window is never
#                 reliably equal to itself: a caret, a clock, a spinner, a video, a
#                 scrolling list or a streaming reply keeps repainting. Measured on a real
#                 desktop this ran its whole ceiling (18 polls, 5.0 s) and came back
#                 `stable: false`: five seconds spent to learn nothing.
#
# So the poll is opt-in and its default budget is 0. An observation right after a write
# waits out the compositor and takes the frame. A caller that knows what it is waiting for
# -- a long layout, a splash that has to go away -- asks for a budget explicitly
# (`stability_ms`, or `stable: true` for the default budget), and the reply names which of
# these happened: `stable`, `timeout`, `disabled`, `none`, `other-target`, `target-changed`,
# `target-lost`, `capture-failed`. The observation both waits and reports honestly, which
# is the thing the old loop could not do.
#
# The write stamp carries what was written, where, and when, because a poll is only
# meaningful for the window the write went to and only while "just after the action" is
# still true. An observation issued two seconds later is no longer the observation of that
# action, and polling for it would be waiting for something that has already happened.
#
# A deployment can put the old behaviour back without editing this file:
#   DSH_COMPUTER_USE_STABILITY_MS=5000   (the default budget: 0 = off)
#   DSH_COMPUTER_USE_SETTLE_MS=300       (the settle floor)
#   DSH_COMPUTER_USE_STABLE_MS=1500      (what `stable: true` means)
#   DSH_COMPUTER_USE_STABILITY_POLL_MS=250
#   DSH_COMPUTER_USE_WRITE_TTL_MS=2000   (how long a write counts as "the last action")

function Get-PacingEnvInt([string]$name, [int]$fallback, [int]$minimum, [int]$maximum) {
    $raw = [Environment]::GetEnvironmentVariable($name)
    if ([string]::IsNullOrWhiteSpace($raw)) { return $fallback }
    $parsed = 0
    if (-not [int]::TryParse($raw.Trim(), [ref]$parsed)) { return $fallback }
    return [Math]::Max($minimum, [Math]::Min($maximum, $parsed))
}

# A relative clock, so a system time adjustment (NTP, DST, a manual change) cannot
# lengthen, shorten or invert a wait that is being measured. Stopwatch is QPC-based.
$script:Clock = [System.Diagnostics.Stopwatch]::StartNew()
$script:PostActionMs = Get-PacingEnvInt 'DSH_COMPUTER_USE_SETTLE_MS' 300 0 5000
$script:StabilityPollMs = Get-PacingEnvInt 'DSH_COMPUTER_USE_STABILITY_POLL_MS' 250 20 2000
$script:StabilityCeilingMs = Get-PacingEnvInt 'DSH_COMPUTER_USE_STABILITY_MS' 0 0 30000
$script:StabilityStableMs = Get-PacingEnvInt 'DSH_COMPUTER_USE_STABLE_MS' 1500 1 30000
$script:StabilityMaxMs = 30000
$script:WriteStampTtlMs = Get-PacingEnvInt 'DSH_COMPUTER_USE_WRITE_TTL_MS' 2000 100 60000
# How often a condition wait looks, and the ceiling on its budget. The poll is the same
# shape as the stability poll -- start immediately, sample, compare, sleep the
# remainder -- so a condition that is already true costs one check and no sleep.
$script:WaitPollMs = Get-PacingEnvInt 'DSH_COMPUTER_USE_WAIT_POLL_MS' 120 20 2000
# 方案 §6.2: "低成本窗口或文件检查可较高频轮询；大范围 UIA 和视觉判断应降低频率、缩小范围，
# 并考虑退避." A UIA tree walk or a screenshot fingerprint costs real work, so those conditions
# start slower and back off to a lower ceiling than a window's existence or a file's state.
$script:WaitHeavyPollMs = Get-PacingEnvInt 'DSH_COMPUTER_USE_WAIT_HEAVY_POLL_MS' 300 20 2000
$script:WaitMaxMs = Get-PacingEnvInt 'DSH_COMPUTER_USE_WAIT_MAX_MS' 30000 100 120000
# A read-only UI Automation call used to sit for a flat 120 ms after answering. That
# is 1.2 s per ten reads, on a path that produced no change to wait for. The write
# paths keep their own pacing (the settle floor and the write stamp), so the read
# default is 0; an app that genuinely needs the beat can ask for it back with the
# environment variable.
$script:ReadSettleMs = Get-PacingEnvInt 'DSH_COMPUTER_USE_READ_SETTLE_MS' 0 0 1000

# How old a frame has to be before a coordinate taken from it is checked against what the
# surface looks like *now* (方案 §3.2：滚动、导航、应用自行改变内容都要让旧定位失效).
#
# Geometry cannot see any of those: the rectangle is identical and the pixels are not. So a
# frame carries a fingerprint of the surface it was captured from, and a frame that has been
# sitting around for longer than this is compared against a fresh reading of the same surface
# before its coordinate is used. Nothing is checked while the frame is fresh -- the caller has
# just looked, and charging every click for a second screenshot would slow down the case that
# is already correct. 0 turns the check off.
$script:FrameVerifyAfterMs = Get-PacingEnvInt 'DSH_COMPUTER_USE_FRAME_VERIFY_MS' 2500 0 600000

# The last write: @{ atMs; seq; hwnd; what }, or $null. `hwnd` is what received it (the
# foreground at that moment, unless the caller named a window), and `seq` is the write
# ordinal every capture is compared against.
$script:LastWrite = $null

# The last drag this session performed: @{ id; x; y; hwnd; generation; atMs }, or $null.
#
# 8.txt §8 后半：一次拖拽的落点要能被下一次调用接着用（"从刚才那里再画一段"），省掉重新定位起点的往返。
# 与 $script:LastWrite 同一套做法：后端持有、带有效期、过期即置空 —— 而且**绝不返回旧值**，
# 调用方拿到的是明确拒绝（DRAG_HANDLE_STALE），不是"大概还在那儿"的猜测。
$script:LastDrag = $null
$script:DragTtlMs = Get-PacingEnvInt 'DSH_COMPUTER_USE_DRAG_TTL_MS' 8000 100 120000
$script:DragGeneration = 0

function Set-DragHandle([int]$x, [int]$y, [object]$Hwnd = $null) {
    # Called at the end of a completed drag. `generation` lets a caller tell one session's
    # handles from another's after a reset; `hwnd` is the window the gesture ended over, so a
    # continuation into a different window can be refused instead of silently landing there.
    $script:DragGeneration += 1
    $hwndValue = 0
    if ($null -ne $Hwnd) { $hwndValue = [int64]$Hwnd }
    $script:LastDrag = [ordered]@{
        id         = "d$($script:BootGen).$($script:DragGeneration)"
        x          = [int]$x
        y          = [int]$y
        hwnd       = $hwndValue
        generation = $script:DragGeneration
        atMs       = [int64]([DateTime]::UtcNow - (Get-Date '1970-01-01Z').ToUniversalTime()).TotalMilliseconds
    }
    return $script:LastDrag
}

function Get-DragHandle([string]$Id = '') {
    # Returns the handle, or $null with a reason why not. Expiry is a refusal, not a stale value:
    # "the point you dragged to two minutes ago" is not a place this plugin will draw from.
    $handle = $script:LastDrag
    if ($null -eq $handle) { return @{ ok = $false; code = 'DRAG_HANDLE_MISSING'; note = 'no drag has been performed in this session yet' } }
    $nowMs = [int64]([DateTime]::UtcNow - (Get-Date '1970-01-01Z').ToUniversalTime()).TotalMilliseconds
    $ageMs = $nowMs - [int64]$handle.atMs
    if ($ageMs -gt $script:DragTtlMs) {
        $script:LastDrag = $null
        return @{ ok = $false; code = 'DRAG_HANDLE_STALE'; note = "the last drag ended $([int]($ageMs / 1000)) s ago, past the $([int]($script:DragTtlMs / 1000)) s a continuation is allowed to trust (DSH_COMPUTER_USE_DRAG_TTL_MS)" }
    }
    if ($Id -ne '' -and $Id -ne "$($handle.id)") {
        return @{ ok = $false; code = 'DRAG_HANDLE_MISSING'; note = "that drag handle ($Id) is not the most recent one ($($handle.id)); the newest one is what a continuation continues from" }
    }
    return @{ ok = $true; code = ''; note = ''; handle = $handle; ageMs = $ageMs }
}

function Clear-DragHandle([string]$why = '') {
    # A cancelled stop must not leave a point for the next call to draw from.
    $script:LastDrag = $null
    if ($why -ne '') { return "drag handle cleared: $why" }
    return 'drag handle cleared'
}
# Region-condition baselines: rectangle key -> @{ digest; at }. Kept here rather than inside the
# predicate so a wait that samples every 120 ms still remembers what the region looked like when
# the wait began (see Test-ConditionRegion).
$script:RegionBaselines = @{}
$script:WriteSeq = [int64]0

# The last capture: @{ atMs; seq; writeSeq; x; y; width; height; window; source }, or $null.
#
# Written by Do-Screenshot *before* the pixels are copied, which is the conservative
# choice: a frame annotated with an earlier instant can never be mistaken for a frame
# taken after an action that happened while it was being taken. The batch uses it to
# answer one question -- "is the picture I already have on the right side of the last
# write?" -- instead of re-taking a frame it is already holding.
$script:LastCapture = $null
$script:CaptureSeq = 0

function Record-Capture([object]$Rect, [object]$Hwnd, [string]$Source, [string]$SpecKey = '') {
    $script:CaptureSeq++
    $script:LastCapture = [ordered]@{
        atMs     = [int64]$script:Clock.ElapsedMilliseconds
        seq      = [int]$script:CaptureSeq
        # Which write this frame stands to the right of. See Test-CaptureAfterWrite.
        writeSeq = [int64]$script:WriteSeq
        # Which observation boundary it stands on the right side of. See
        # Test-CaptureReusable: a frame taken before a wait cannot answer for the state
        # after that wait, however recent it is.
        epoch    = [int64]$script:ObservationEpoch
        specKey  = "$SpecKey"
        x        = [int]$Rect.x
        y        = [int]$Rect.y
        width    = [int]$Rect.width
        height   = [int]$Rect.height
        window   = [int64]$Hwnd
        source   = "$Source"
    }
    return $script:LastCapture
}

function Advance-ObservationEpoch {
    # A wait boundary. The counter is monotonic and per-worker, and it exists so "is this
    # frame newer than the thing I just waited for" can be answered without subtracting
    # clocks that were never comparable across processes.
    $script:ObservationEpoch = [int64]$script:ObservationEpoch + 1
    return $script:ObservationEpoch
}

function Get-CaptureStampInfo {
    # The live capture stamp, or $null. Unlike the write stamp this one has no TTL: the
    # question it answers is about ordering ("was this frame taken after that write?"),
    # and the ordering is still decidable however long ago it was.
    $stamp = $script:LastCapture
    if ($null -eq $stamp) { return $null }
    $age = [int64]$script:Clock.ElapsedMilliseconds - [int64]$stamp.atMs
    return [ordered]@{
        atMs     = [int64]$stamp.atMs
        ageMs    = [int]$age
        seq      = [int]$stamp.seq
        writeSeq = [int64]$stamp.writeSeq
        epoch    = [int64]$stamp.epoch
        specKey  = "$($stamp.specKey)"
        x        = [int]$stamp.x
        y        = [int]$stamp.y
        width    = [int]$stamp.width
        height   = [int]$stamp.height
        window   = [int64]$stamp.window
        source   = "$($stamp.source)"
    }
}

function Set-PayloadField([object]$Record, [string]$Name, $Value) {
    # Write one field of a reply record, whether that record is an ordered hashtable
    # (PowerShell 5.1, where a new key is a dictionary entry) or a plain object (the
    # internal batch paths). Dotting an ordered hashtable with a key it does not have yet
    # throws "does not contain a method named ...", which is how a batch's capture
    # provenance used to vanish on the way to the caller.
    if ($null -eq $Record) { return }
    if ($Record -is [System.Collections.IDictionary]) { $Record[$Name] = $Value; return }
    $Record | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
}

function Remove-PayloadField([object]$Record, [string]$Name) {
    # The mirror of Set-PayloadField, for the same reason: an ordered hashtable keeps its
    # fields as dictionary entries and a plain object keeps them as properties, and the
    # remove method is named differently for each.
    if ($null -eq $Record) { return }
    if ($Record -is [System.Collections.IDictionary]) {
        if ($Record.Contains($Name)) { $Record.Remove($Name) }
        return
    }
    $Record.PSObject.Properties.Remove($Name)
}

function Test-CaptureAfterWrite([object]$Capture) {
    # Whether a frame this call already took can stand in for the state after the last
    # write.
    #
    # Ordering is the whole point: a frame taken before the last write is a picture of the
    # world that write had not yet changed, and handing it back as "the result" is the one
    # failure a caller cannot see.
    #
    # The comparison is between write *ordinals*, not between clocks. Every write stamps an
    # ordinal and every capture records the ordinal that was current when it was taken, so
    # the answer does not depend on clock granularity, and a step that writes without
    # looking like one (a `focus`) is counted while a `type` with no text is counted too --
    # the safe direction, since the only cost of "yes, a write happened" is a frame that
    # was going to be captured anyway.
    if ($null -eq $Capture) { return $false }
    return ([int64]$Capture.writeSeq -ge [int64]$script:WriteSeq)
}

function Test-CaptureReusable([object]$Capture, [string]$SpecKey = '') {
    # Whether a frame this call already took may be *the answer* -- not merely "a picture
    # from the right side of the last write", but a picture of the moment the caller asked
    # about. Three facts have to agree, and each one has a failure it prevents:
    #
    #   writeSeq  the frame is on the right side of the last write (state after the steps)
    #   epoch     no wait boundary happened after it (state after the wait the caller asked
    #             for -- the case where the app updated the UI by itself while the wait ran)
    #   specKey   it came from the same capture request (same target, surface, region,
    #             output shape), so its coordinates and size are the ones being asked about
    if ($null -eq $Capture) { return $false }
    if (-not (Test-CaptureAfterWrite $Capture)) { return $false }
    if ([int64]$Capture.epoch -ne [int64]$script:ObservationEpoch) { return $false }
    if ("$SpecKey" -ne '' -and "$($Capture.specKey)" -ne '' -and "$($Capture.specKey)" -ne "$SpecKey") { return $false }
    return $true
}

function Set-WriteStamp([string]$What = '', [object]$Hwnd = $null) {
    $target = [int64]0
    if ($null -ne $Hwnd -and [int64]$Hwnd -ne 0) {
        $target = [int64]$Hwnd
    } else {
        $fg = [DshNative]::GetForegroundWindow()
        if ($fg -ne [IntPtr]::Zero) { $target = [int64]$fg }
    }
    $script:WriteSeq++
    $script:LastWrite = [ordered]@{
        atMs = [int64]$script:Clock.ElapsedMilliseconds
        seq  = [int64]$script:WriteSeq
        hwnd = $target
        what = $What
    }
}

function Get-WriteStampInfo {
    # The live stamp, or $null. An expired one is dropped here rather than handed on:
    # "the last write was four seconds ago" is not a reason to start a poll, and treating
    # it as one is how an observation taken long after an action used to pay the whole
    # ceiling again.
    $stamp = $script:LastWrite
    if ($null -eq $stamp) { return $null }
    $age = [int64]$script:Clock.ElapsedMilliseconds - [int64]$stamp.atMs
    if ($age -gt $script:WriteStampTtlMs) {
        $script:LastWrite = $null
        return $null
    }
    return [ordered]@{
        atMs  = [int64]$stamp.atMs
        ageMs = [int]$age
        hwnd  = [int64]$stamp.hwnd
        what  = "$($stamp.what)"
    }
}

function Complete-WriteStamp {
    # Called by an observation that actually produced a reading. A capture that failed
    # leaves the stamp alone on purpose: the retry is still the observation of that write,
    # and dropping the stamp first would make the retry the one that no longer waits.
    $script:LastWrite = $null
}

function Wait-ForSettle([object]$override) {
    # A floor on the age of the last write, not a fixed sleep in front of every capture:
    # time already spent by the action, the transport or the caller's own turn counts
    # towards it, so the common "click then look" costs only what is left of the floor.
    $ms = $script:PostActionMs
    if ($null -ne $override) { $ms = [Math]::Max(0, [Math]::Min(5000, [int]$override)) }
    if ($ms -le 0) { return 0 }
    $stamp = Get-WriteStampInfo
    if ($null -eq $stamp) { return 0 }
    if ([int]$stamp.ageMs -ge $ms) { return 0 }
    $rest = [int]($ms - [int]$stamp.ageMs)
    # Cancellable: the caller that stopped this request should not have to wait out the
    # rest of a floor it no longer wants.
    Wait-Cancellable $rest
    return $rest
}

function Resolve-StabilityBudget([object]$budget, [object]$flag) {
    # Three inputs can disagree about how long to wait, so the winner is decided in one
    # place and reported back (`resolvedBy`), including when two of them conflict. An
    # explicit number beats the boolean; `stable: false` beats a non-zero number; silence
    # means the worker default, which is off.
    $hasBudget = $null -ne $budget -and "$budget" -ne ''
    $hasFlag = $null -ne $flag -and "$flag" -ne ''
    $ceiling = [Math]::Max(0, [Math]::Min($script:StabilityMaxMs, [int]$script:StabilityCeilingMs))
    $resolvedBy = 'default'
    $conflict = ''
    if ($hasBudget) {
        $ceiling = [Math]::Max(0, [Math]::Min($script:StabilityMaxMs, [int]$budget))
        $resolvedBy = 'stability_ms'
    }
    if ($hasFlag -and "$flag" -eq 'False') {
        $ceiling = 0
        $resolvedBy = 'stable=false'
        if ($hasBudget -and [int]$budget -gt 0) { $conflict = "stable: false overrides stability_ms=$([int]$budget)" }
    } elseif ($hasFlag -and "$flag" -eq 'True') {
        if ($hasBudget -and [int]$budget -eq 0) {
            $conflict = 'stable: true with stability_ms: 0: the explicit budget wins, so nothing was polled'
        } elseif (-not $hasBudget) {
            $ceiling = [Math]::Max(1, [int]$script:StabilityStableMs)
            $resolvedBy = 'stable=true'
        }
    }
    return [ordered]@{ ceilingMs = $ceiling; resolvedBy = $resolvedBy; conflict = $conflict }
}

function New-StabilityResult([string]$state, [object]$target, [int]$budget, [string]$resolvedBy, [string]$note, [string]$conflict = '') {
    # One shape for every outcome, so a caller never has to guess which fields a given
    # "no wait happened" path left out. `note` explains why a wait stopped on the target;
    # `conflict` is a different fact -- two pacing arguments disagreed and one of them won --
    # and it is carried in its own field because the two are read for different reasons.
    return [ordered]@{
        state      = $state
        stable     = $null
        polls      = 0
        waitedMs   = 0
        budgetMs   = $budget
        pollMs     = $script:StabilityPollMs
        sampled    = ''
        target     = $target
        resolvedBy = $resolvedBy
        width      = 0
        height     = 0
        note       = $note
        conflict   = $conflict
    }
}

function New-StabilityTarget([object]$Arg, [IntPtr]$windowHwnd, [object]$captureRect) {
    # What the poll watches. It used to be "whatever window is in front", which is not
    # necessarily what the call is about: a window capture, a region capture and a display
    # capture can each be aimed somewhere else, and watching the foreground then measures
    # a window nobody asked about -- and a window that is guaranteed to still be changing,
    # because it is the one the action just touched.
    if ($windowHwnd -ne [IntPtr]::Zero) { return [ordered]@{ kind = 'window'; hwnd = [int64]$windowHwnd; x = 0; y = 0; width = 0; height = 0 } }
    if ($null -ne $captureRect) {
        return [ordered]@{
            kind   = 'region'
            hwnd   = 0
            x      = [int]$captureRect.x
            y      = [int]$captureRect.y
            width  = [int]$captureRect.width
            height = [int]$captureRect.height
        }
    }
    return [ordered]@{ kind = 'foreground'; hwnd = 0; x = 0; y = 0; width = 0; height = 0 }
}

function Wait-ForStable([object]$ceiling, [object]$target, [string]$resolvedBy = 'default', [string]$conflict = '') {
    # A single fixed sleep cannot be right for both a list that repaints instantly and a
    # page that takes two seconds to lay out: one wastes time, the other captures a
    # half-drawn window. Looking twice and waiting until the picture stops changing is
    # right for both -- when it is asked for. What it is *not* is free, and a poll that
    # cannot succeed must not be able to spend its whole ceiling silently.
    $budget = [Math]::Max(0, [Math]::Min($script:StabilityMaxMs, [int]$ceiling))
    if ($budget -le 0) {
        return (New-StabilityResult 'disabled' $target 0 $resolvedBy '' $conflict)
    }
    $kind = 'screen'
    $hwnd = [IntPtr]::Zero
    if ($null -ne $target -and "$($target.kind)" -eq 'window' -and [int64]$target.hwnd -ne 0) {
        $kind = 'window'
        $hwnd = [IntPtr][int64]$target.hwnd
    }
    $sampled = 'screen'
    if ($kind -eq 'window') { $sampled = 'window' }
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $state = 'timeout'
    $stable = $false
    $polls = 0
    $note = ''
    $prev = ''
    $width = 0
    $height = 0
    $firstHwnd = [int64]0
    if ($null -ne $target) { $firstHwnd = [int64]$target.hwnd }
    while ($true) {
        Assert-NotCancelled 'while waiting for the picture to stop changing'
        # The budget is a ceiling on the whole wait, so what is left of it -- not a fresh
        # poll interval -- is what a sample and a sleep are allowed to spend. The old loop
        # sampled on the deadline and then slept a full interval after its last sample, so
        # its advertised ceiling was not one.
        if ([int]$sw.ElapsedMilliseconds -ge $budget) { $state = 'timeout'; break }
        $rect = $null
        $digest = ''
        if ($kind -eq 'window') {
            if (-not [DshNative]::IsWindow($hwnd)) {
                $state = 'target-lost'
                $note = "hwnd $([int64]$hwnd) is not a window any more"
                break
            }
            $rect = Get-WindowRectInfo $hwnd
            if ($null -eq $rect) {
                $state = 'target-lost'
                $note = "hwnd $([int64]$hwnd) has no usable rectangle"
                break
            }
            # The window's own pixels, which is what a window capture will return: a screen
            # copy of the same rectangle would judge a covered window by whatever is on top
            # of it, the exact case a window capture exists to avoid.
            try { $digest = Get-WindowDigest $hwnd 320 } catch { $digest = '' }
            if ($digest -eq '') {
                $sampled = 'screen-fallback'
                try { $digest = Get-RegionDigest $rect.x $rect.y $rect.width $rect.height 320 } catch { $digest = '' }
            }
        } else {
            if ($null -ne $target -and "$($target.kind)" -eq 'region') {
                $rect = [ordered]@{ x = [int]$target.x; y = [int]$target.y; width = [int]$target.width; height = [int]$target.height }
            } else {
                # A foreground capture is about whatever is in front, so a change of
                # foreground ends the wait instead of being averaged over: the frame about
                # to be taken would be about a different window than the one this write
                # went to, and that is worth saying rather than sleeping through.
                $fg = [DshNative]::GetForegroundWindow()
                if ($fg -eq [IntPtr]::Zero) {
                    $state = 'target-lost'
                    $note = 'no window holds the foreground any more'
                    break
                }
                if ($firstHwnd -eq 0) {
                    $firstHwnd = [int64]$fg
                } elseif ([int64]$fg -ne $firstHwnd) {
                    $state = 'target-changed'
                    $note = "the foreground moved from hwnd $firstHwnd to hwnd $([int64]$fg) (`"$([DshNative]::WindowText($fg))`") while this observation was waiting"
                    break
                }
                $rect = Get-WindowRectInfo $fg
            }
            if ($null -eq $rect) {
                $state = 'target-lost'
                $note = 'the region to watch has no usable rectangle'
                break
            }
            try { $digest = Get-RegionDigest $rect.x $rect.y $rect.width $rect.height 320 } catch { $digest = '' }
        }
        if ($digest -eq '') {
            $state = 'capture-failed'
            $note = 'the region could not be read while waiting'
            break
        }
        $width = [int]$rect.width
        $height = [int]$rect.height
        $polls += 1
        # Two samples are the least this can be decided with: the first one is the
        # baseline, and there is nothing to compare it against yet.
        if ($prev -ne '' -and $digest -eq $prev) { $stable = $true; $state = 'stable'; break }
        $prev = $digest
        $left = $budget - [int]$sw.ElapsedMilliseconds
        if ($left -le 0) { $state = 'timeout'; break }
        Wait-Cancellable ([Math]::Min([int]$script:StabilityPollMs, [int]$left))
    }
    return [ordered]@{
        state      = $state
        stable     = $stable
        polls      = $polls
        waitedMs   = [int]$sw.ElapsedMilliseconds
        budgetMs   = $budget
        pollMs     = $script:StabilityPollMs
        sampled    = $sampled
        target     = $target
        resolvedBy = $resolvedBy
        width      = $width
        height     = $height
        note       = $note
        conflict   = $conflict
    }
}

function Get-PacingConfig {
    return [ordered]@{
        settleMs        = [int]$script:PostActionMs
        stabilityMs     = [int]$script:StabilityCeilingMs
        stableMs        = [int]$script:StabilityStableMs
        stabilityPollMs = [int]$script:StabilityPollMs
        stabilityMaxMs  = [int]$script:StabilityMaxMs
        writeTtlMs      = [int]$script:WriteStampTtlMs
        waitPollMs      = [int]$script:WaitPollMs
        waitMaxMs       = [int]$script:WaitMaxMs
        clockMs         = [int64]$script:Clock.ElapsedMilliseconds
    }
}


function Add-HeldKey([int]$vk) {
    if (-not $script:HeldKeys.Contains($vk)) { [void]$script:HeldKeys.Add($vk) }
    Save-HeldState
}

function Remove-HeldKey([int]$vk) {
    [void]$script:HeldKeys.Remove($vk)
    Save-HeldState
}

function Add-HeldButton([uint32]$downFlag) {
    if (-not $script:HeldButtons.Contains([int]$downFlag)) { [void]$script:HeldButtons.Add([int]$downFlag) }
    Save-HeldState
}

function Remove-HeldButton([uint32]$downFlag) {
    [void]$script:HeldButtons.Remove([int]$downFlag)
    Save-HeldState
}

function Save-HeldState {
    # §6 ④: what this worker currently believes is held is written where *another process* can
    # read it, because the last-resort release cannot run inside a worker that is being killed.
    #
    # A worker holding a button is the one case where killing it is not enough: the release
    # lives in an unwinding `finally` that a kill never reaches. The host therefore needs an
    # independent path -- `backend/release-input.ps1` -- and this file is what it reads. It is
    # written on every change and removed when nothing is held, so a stale file cannot make the
    # independent path press keys nobody is holding (a release is idempotent, but a release of
    # something that was never held is still a lie about the desktop).
    if ($script:HeldStateFile -eq '') { return }
    try {
        if ($script:HeldKeys.Count -eq 0 -and $script:HeldButtons.Count -eq 0) {
            Remove-Item -LiteralPath $script:HeldStateFile -Force -ErrorAction SilentlyContinue
            return
        }
        $state = [ordered]@{
            pid       = $PID
            bootGen   = $script:BootGen
            at        = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
            keys      = @($script:HeldKeys.ToArray() | ForEach-Object { [int]$_ })
            buttons   = @($script:HeldButtons.ToArray() | ForEach-Object { [int]$_ })
        }
        [System.IO.File]::WriteAllText($script:HeldStateFile, ($state | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
    } catch {
        # Failing to record held state must never break the action that changed it; the
        # independent release simply has less to go on, and it says so when it runs.
    }
}

function Get-UpFlag([uint32]$downFlag) {
    # The DOWN/UP pairs are laid out so UP is always DOWN * 2 on the low nibbles
    # (LEFTDOWN 0x0002 -> LEFTUP 0x0004, RIGHTDOWN 0x0008 -> RIGHTUP 0x0010,
    # MIDDLEDOWN 0x0020 -> MIDDLEUP 0x0040).
    return [uint32]($downFlag * 2)
}

function Release-HeldInput {
    # Sends the release for everything still believed to be down and reports what
    # was actually unwound, so the caller can say "nothing was stuck" or name it.
    #
    # Records are dropped only for releases that were really delivered. A release is
    # idempotent -- an extra key-up or button-up is a no-op -- so keeping a record
    # whose release failed costs nothing, while dropping one whose release never
    # arrived is how a desktop ends up holding a button nothing knows about.
    $released = @()
    $events = New-Object System.Collections.Generic.List[DshNative+INPUT]
    $records = New-Object System.Collections.Generic.List[object]
    foreach ($vk in @($script:HeldKeys.ToArray())) {
        $f = [DshNative]::KEYEVENTF_KEYUP
        if ($EXTENDED -contains $vk) { $f = $f -bor [DshNative]::KEYEVENTF_EXTENDEDKEY }
        $events.Add([DshNative]::Key([uint16]$vk, 0, [uint32]$f))
        $records.Add([ordered]@{ kind = 'key'; value = $vk; label = "key:$vk" })
    }
    foreach ($down in @($script:HeldButtons.ToArray())) {
        $events.Add([DshNative]::Mouse(0, 0, 0, (Get-UpFlag ([uint32]$down))))
        $label = "mouse:$down"
        if ($down -eq [DshNative]::MOUSEEVENTF_LEFTDOWN) { $label = 'mouse:left' }
        elseif ($down -eq [DshNative]::MOUSEEVENTF_RIGHTDOWN) { $label = 'mouse:right' }
        elseif ($down -eq [DshNative]::MOUSEEVENTF_MIDDLEDOWN) { $label = 'mouse:middle' }
        $records.Add([ordered]@{ kind = 'button'; value = $down; label = $label })
    }
    if ($events.Count -eq 0) { return $released }
    $sent = 0
    try { $sent = [int][DshNative]::Send($events.ToArray()) } catch { $sent = 0 }
    for ($i = 0; $i -lt $records.Count; $i++) {
        if ($i -ge $sent) { break }
        $record = $records[$i]
        $released += $record.label
        if ($record.kind -eq 'key') { [void]$script:HeldKeys.Remove([int]$record.value) }
        else { [void]$script:HeldButtons.Remove([uint32]$record.value) }
    }
    return $released
}

function Get-WindowInfoForHwnd([IntPtr]$hwnd) {
    # The identity block every observation carries. Reading a tree without knowing
    # *which* window it came from is how a modal dialog gets mistaken for the window
    # the last action went to.
    if ($hwnd -eq [IntPtr]::Zero) { return [ordered]@{ hwnd = 0; title = ''; process = ''; pid = 0 } }
    $procId = 0
    [void][DshNative]::GetWindowThreadProcessId($hwnd, [ref]$procId)
    $procName = ''
    try { $procName = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { $procName = '' }
    return [ordered]@{ hwnd = [int64]$hwnd; title = [DshNative]::WindowText($hwnd); process = $procName; pid = $procId }
}

function Get-WindowRectInfo([IntPtr]$hwnd) {
    $rect = New-Object DshNative+RECT
    if (-not [DshNative]::WindowBounds($hwnd, [ref]$rect)) { return $null }
    $w = $rect.Right - $rect.Left
    $h = $rect.Bottom - $rect.Top
    if ($w -le 0 -or $h -le 0) { return $null }
    return [ordered]@{ x = $rect.Left; y = $rect.Top; width = $w; height = $h }
}

function Get-BitmapDigest($bmp) {
    $rect = New-Object System.Drawing.Rectangle(0, 0, $bmp.Width, $bmp.Height)
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $len = [Math]::Abs($data.Stride) * $bmp.Height
        $buf = New-Object byte[] $len
        [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $buf, 0, $len)
    } finally { $bmp.UnlockBits($data) }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hex = [BitConverter]::ToString($sha.ComputeHash($buf)).Replace('-', '')
        return $hex.Substring(0, 16).ToLowerInvariant()
    } finally { $sha.Dispose() }
}

function Get-BitmapDigestScaled($bmp, [int]$maxSide) {
    # One raster and one hash, shared by every fingerprint this worker takes: the poll
    # compares two of these, and an evidence digest is the same function over a frame that
    # was already captured -- which is what makes a comparison against an earlier reading
    # mean something.
    $w = $bmp.Width
    $h = $bmp.Height
    if ($w -le 0 -or $h -le 0) { return '' }
    $scale = 1.0
    $long = [Math]::Max($w, $h)
    if ($maxSide -gt 0 -and $long -gt $maxSide) { $scale = $maxSide / $long }
    $iw = [Math]::Max(1, [int][Math]::Round($w * $scale))
    $ih = [Math]::Max(1, [int][Math]::Round($h * $scale))
    if ($iw -eq $w -and $ih -eq $h) { return Get-BitmapDigest $bmp }
    $small = New-Object System.Drawing.Bitmap($iw, $ih, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $g2 = [System.Drawing.Graphics]::FromImage($small)
        try {
            $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::Low
            $g2.DrawImage($bmp, 0, 0, $iw, $ih)
        } finally { $g2.Dispose() }
        return Get-BitmapDigest $small
    } finally { $small.Dispose() }
}

function Get-RegionDigest([int]$x, [int]$y, [int]$w, [int]$h, [int]$maxSide) {
    # A cheap visual fingerprint: capture the region, shrink it to a bounded raster,
    # hash the pixels. This is what turns "the click was delivered" into "the screen
    # actually changed", which is the one thing a synthesized pointer event cannot
    # tell you -- some apps act on wherever the real pointer sits and ignore the
    # position the event carries, so the same coordinate silently does nothing.
    if ($w -le 0 -or $h -le 0) { return '' }
    $full = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $g = [System.Drawing.Graphics]::FromImage($full)
        try { $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size($w, $h)), [System.Drawing.CopyPixelOperation]::SourceCopy) } finally { $g.Dispose() }
        return Get-BitmapDigestScaled $full $maxSide
    } finally { $full.Dispose() }
}

function Get-WindowDigest([IntPtr]$hwnd, [int]$maxSide) {
    # The fingerprint of what a *window* capture will return: the window drawing itself.
    # A screen copy of the same rectangle is the right reading for a screen capture and the
    # wrong one for a window capture -- it would judge a covered window by whatever covers
    # it. An empty string means "could not read it", which the caller falls back from.
    $rect = Get-WindowRectInfo $hwnd
    if ($null -eq $rect) { return '' }
    if (($rect.width * $rect.height) -gt $MAX_CAPTURE_PIXELS) { return '' }
    $bmp = New-Object System.Drawing.Bitmap($rect.width, $rect.height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            $hdc = $g.GetHdc()
            $drew = $false
            try {
                # 0x2 = PW_RENDERFULLCONTENT, the same flag the capture path uses.
                $drew = [DshNative]::PrintWindow($hwnd, $hdc, 2)
            } finally { $g.ReleaseHdc($hdc) }
            if (-not $drew) { return '' }
        } finally { $g.Dispose() }
        return Get-BitmapDigestScaled $bmp $maxSide
    } finally { $bmp.Dispose() }
}

function Get-ForegroundRect {
    $fg = [DshNative]::GetForegroundWindow()
    $r = $null
    if ($fg -ne [IntPtr]::Zero) { $r = Get-WindowRectInfo $fg }
    if ($null -eq $r) { return Get-VirtualBounds }
    return $r
}

function Get-InjectableForeground {
    # Synthesized keyboard input is only worth sending when some real window holds the
    # foreground. Without being told which app is intended, the part that can be checked
    # is "is a real window holding the foreground at all" -- the foreground is
    # momentarily empty while one window closes and another takes over, so it retries
    # briefly first. Deliberately permissive about *which* window:
    # a floating find bar or a tool palette can legitimately hold focus.
    for ($attempt = 0; $attempt -lt 4; $attempt++) {
        $fg = [DshNative]::GetForegroundWindow()
        if ($fg -ne [IntPtr]::Zero -and [DshNative]::IsWindowVisible($fg) -and $null -ne (Get-WindowRectInfo $fg)) {
            return (Get-WindowInfoForHwnd $fg)
        }
        Start-Sleep -Milliseconds 25
    }
    return $null
}

function Assert-ExpectedForeground($expected, [string]$what) {
    # The foreground is reported on every input receipt, but a report is read *after* the
    # text has already gone somewhere. When the caller says which window it means, the
    # mismatch can be caught before anything is sent -- and a window that popped up
    # between the click and the typing is exactly the case where it matters.
    if ($null -eq $expected -or [int64]$expected -eq 0) { return }
    $want = [int64]$expected
    $info = Get-InjectableForeground
    if ($null -eq $info) {
        throw "$what would go nowhere: no window holds the foreground. (action_sent=false)"
    }
    if ([int64]$info.hwnd -ne $want) {
        $who = if ($info.title -ne '') { "`"$($info.title)`" [$($info.process)]" } else { "[$($info.process)]" }
        throw "[FRONT_NOT_TARGET] $what was aimed at hwnd $want but the foreground is hwnd $($info.hwnd) $who, which is what would receive it. Bring the target forward first (computer_windows with focus_hwnd, or a click inside it) and retry. (action_sent=false, recovery=computer_windows)"
    }
}

function Assert-InjectableForeground([string]$what) {
    $info = Get-InjectableForeground
    if ($null -ne $info) { return $info }
    $raw = [DshNative]::GetForegroundWindow()
    $detail = 'no window holds the foreground'
    if ($raw -ne [IntPtr]::Zero) { $detail = "the foreground is hwnd=$([int64]$raw), which is not a visible window" }
    throw "$what would go nowhere: $detail. Bring the target window forward first (computer_windows with focus_hwnd, computer_launch, or a click inside it) and retry."
}

function Get-ScreenList {
    $list = @()
    $i = 0
    foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
        $list += [ordered]@{
            index      = $i
            deviceName = $s.DeviceName
            primary    = [bool]$s.Primary
            x          = $s.Bounds.X
            y          = $s.Bounds.Y
            width      = $s.Bounds.Width
            height     = $s.Bounds.Height
        }
        $i++
    }
    return $list
}

function Get-VirtualBounds {
    $x0 = [DshNative]::GetSystemMetrics([DshNative]::SM_XVIRTUALSCREEN)
    $y0 = [DshNative]::GetSystemMetrics([DshNative]::SM_YVIRTUALSCREEN)
    $w = [DshNative]::GetSystemMetrics([DshNative]::SM_CXVIRTUALSCREEN)
    $h = [DshNative]::GetSystemMetrics([DshNative]::SM_CYVIRTUALSCREEN)
    return [ordered]@{ x = $x0; y = $y0; width = $w; height = $h }
}

function Get-ForegroundInfo {
    # Reported alongside every synthetic input so a UIPI block - which Windows
    # signals by doing nothing at all, with no error and no return value - shows
    # up as "the event went to that window" instead of a mysterious no-op.
    $fg = [DshNative]::GetForegroundWindow()
    if ($fg -eq [IntPtr]::Zero) { return [ordered]@{ hwnd = 0; title = ''; process = '' } }
    $procId = 0
    [void][DshNative]::GetWindowThreadProcessId($fg, [ref]$procId)
    $procName = ''
    try { $procName = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { $procName = '' }
    return [ordered]@{ hwnd = [int64]$fg; title = [DshNative]::WindowText($fg); process = $procName }
}

# Hard caps on a capture. Without them a region that was computed from a scaled image
# can ask for a bitmap the process cannot allocate, and the worker dies instead of
# answering.
$MAX_CAPTURE_PIXELS = 33554432
$MAX_CAPTURE_EDGE = 16384

function Resolve-Target([object]$Arg) {
    # @() is required: a one-monitor machine otherwise collapses the list into the
    # single ordered dictionary and $screens[0] would index that dictionary by key.
    $screens = @(Get-ScreenList)
    if ($null -ne $Arg.region) {
        $r = $Arg.region
        $rx = [int]$r.x; $ry = [int]$r.y; $rw = [int]$r.width; $rh = [int]$r.height
        if ($rw -le 0 -or $rh -le 0) { throw "a capture region needs a positive width and height; got ${rw}x${rh}" }
        if ($rw -gt $MAX_CAPTURE_EDGE -or $rh -gt $MAX_CAPTURE_EDGE) {
            throw "a capture region may be at most ${MAX_CAPTURE_EDGE}x${MAX_CAPTURE_EDGE}; got ${rw}x${rh}"
        }
        # Clip to the virtual desktop instead of trusting the caller. A region taken
        # from a downscaled image, or one that spans a monitor that has since been
        # unplugged, otherwise asks GDI for pixels that do not exist.
        $vb = Get-VirtualBounds
        $x0 = [Math]::Max($rx, $vb.x)
        $y0 = [Math]::Max($ry, $vb.y)
        $x1 = [Math]::Min($rx + $rw, $vb.x + $vb.width)
        $y1 = [Math]::Min($ry + $rh, $vb.y + $vb.height)
        if ($x1 -le $x0 -or $y1 -le $y0) {
            throw "the capture region (${rx},${ry}) ${rw}x${rh} does not overlap the virtual desktop (x=$($vb.x)..$($vb.x + $vb.width - 1), y=$($vb.y)..$($vb.y + $vb.height - 1))"
        }
        $cw = $x1 - $x0
        $ch = $y1 - $y0
        if (($cw * $ch) -gt $MAX_CAPTURE_PIXELS) {
            throw "the capture region covers $($cw * $ch) pixels, over the $MAX_CAPTURE_PIXELS limit; capture one display, or pass a smaller region or a scale"
        }
        $clipped = ($x0 -ne $rx) -or ($y0 -ne $ry) -or ($cw -ne $rw) -or ($ch -ne $rh)
        return [ordered]@{ x = $x0; y = $y0; width = $cw; height = $ch; clipped = $clipped }
    }
    $display = $Arg.display
    if ($null -eq $display) { $display = 0 }
    if ("$display" -eq 'all') { return Get-VirtualBounds }
    $idx = 0
    if (-not [int]::TryParse("$display", [ref]$idx)) { $idx = 0 }
    if ($idx -lt 0 -or $idx -ge $screens.Count) { throw "display $idx is out of range (0..$($screens.Count - 1), or 'all')" }
    $s = $screens[$idx]
    return [ordered]@{ x = [int]$s.x; y = [int]$s.y; width = [int]$s.width; height = [int]$s.height }
}

# Get-WindowRegionCrop used to live here. It answered "give me this part of that window"
# by writing the whole window to disk, reading the file back, cropping it with coordinates
# taken from the window space (wrong as soon as the image had been scaled), scaling it a
# second time and re-encoding -- three avoidable round trips and one real mis-crop.
#
# Window regions are now cropped inside Do-Screenshot, on the raw pixels of the source
# bitmap, before the single scale and the single encode, and the result is registered as a
# FrameRecord v2 that keeps the window rectangle, the surface, the crop and the encoded
# size as separate facts (see New-CaptureFrame). Nothing calls into a second crop path, so
# there is no longer a way for the two to disagree about the same pixel.

# JPEG needs a codec + quality parameter; PNG is the built-in encoder.
$script:JpegCodec = $null

function Test-BitmapHasContent($bmp) {
    # A grid sample, not a full scan: enough to tell "the window drew something" from
    # "the window drew nothing", and cheap enough to run on every window capture.
    $w = $bmp.Width
    $h = $bmp.Height
    if ($w -le 0 -or $h -le 0) { return $false }
    $cols = 24
    $rows = 16
    if ($w -lt $cols) { $cols = $w }
    if ($h -lt $rows) { $rows = $h }
    $minLum = 255
    $maxLum = 0
    for ($i = 0; $i -lt $cols; $i++) {
        for ($j = 0; $j -lt $rows; $j++) {
            $x = [int]($i * ($w - 1) / [Math]::Max(1, $cols - 1))
            $y = [int]($j * ($h - 1) / [Math]::Max(1, $rows - 1))
            $c = $bmp.GetPixel($x, $y)
            $lum = [int](($c.R * 30 + $c.G * 59 + $c.B * 11) / 100)
            if ($lum -lt $minLum) { $minLum = $lum }
            if ($lum -gt $maxLum) { $maxLum = $lum }
        }
    }
    return (($maxLum - $minLum) -gt 8)
}

function Save-BitmapToFile($bmp, [string]$path, [string]$format, [int]$quality) {
    if ($format -eq 'jpeg' -or $format -eq 'jpg') {
        if ($null -eq $script:JpegCodec) {
            $script:JpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
        }
        $q = [Math]::Max(1, [Math]::Min(100, $quality))
        $ps = New-Object System.Drawing.Imaging.EncoderParameters(1)
        $ps.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]$q)
        try { $bmp.Save($path, $script:JpegCodec, $ps) } finally { $ps.Dispose() }
        return
    }
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

# ---------------------------------------------------------------------------
# Related windows and multi-frame capture (8.txt §7)
#
# A popup or a menu is its own window, and a single frame of the window underneath cannot
# say that it is there. §7 splits the answer in two: the *relationship* of the windows
# around the target (who owns whom) and the *real z-order* (what is actually in front) are
# two different facts, and a frame per window is an explicit request rather than a new
# default.

$script:ZOrderCache = $null

function Get-TopLevelZOrder {
    # Every top-level window in the order the shell keeps them: index 0 is the topmost.
    # This is the real z-order, which §7 keeps apart from the ownership chain -- a popup
    # owned by the target can still sit under it, and reporting the chain as if it were the
    # order would say the opposite.
    $cached = $script:ZOrderCache
    if ($null -ne $cached -and ([DateTime]::UtcNow - $cached.at).TotalMilliseconds -lt 200) { return $cached.list }
    $list = New-Object System.Collections.Generic.List[int64]
    $callback = [DshNative+EnumWindowsProc] {
        param($hwnd, $param)
        if ($hwnd -ne [IntPtr]::Zero) { $list.Add([int64]$hwnd) }
        return $true
    }
    [void][DshNative]::EnumWindows($callback, [IntPtr]::Zero)
    $script:ZOrderCache = @{ at = [DateTime]::UtcNow; list = $list }
    return $list
}

function Get-RelatedWindowList([int64]$hwnd) {
    # The target and the windows that belong to it, each with the metadata §7 lists.
    #
    # A window belongs to the target when the ownership chain from it reaches the target:
    # that is what a dialog, a popup menu or a tool window of the same application looks
    # like, and it is a different question from "is it in front".
    $observedAt = [DateTime]::UtcNow
    $zOrder = Get-TopLevelZOrder
    $candidates = New-Object System.Collections.Generic.List[int64]
    if ($hwnd -ne 0) { $candidates.Add($hwnd) }
    foreach ($candidate in $zOrder) {
        if ($candidate -eq $hwnd) { continue }
        $owner = [int64][DshNative]::GetWindow([IntPtr]$candidate, [DshNative]::GW_OWNER)
        if ($owner -eq 0) { continue }
        $walk = $owner
        $hops = 0
        $related = $false
        while ($walk -ne 0 -and $hops -lt 16) {
            if ($walk -eq $hwnd) { $related = $true; break }
            $walk = [int64][DshNative]::GetWindow([IntPtr]$walk, [DshNative]::GW_OWNER)
            $hops++
        }
        if ($related) { $candidates.Add($candidate) }
    }
    $rows = New-Object System.Collections.Generic.List[object]
    foreach ($candidate in $candidates) {
        $handle = [IntPtr]$candidate
        $rect = Get-WindowRectInfo $handle
        $owner = [int64][DshNative]::GetWindow($handle, [DshNative]::GW_OWNER)
        $rank = -1
        for ($i = 0; $i -lt $zOrder.Count; $i++) {
            if ($zOrder[$i] -eq $candidate) { $rank = $i; break }
        }
        $relation = 'self'
        if ($candidate -ne $hwnd) { $relation = 'owned-popup' }
        $info = Get-WindowInfoForHwnd $handle
        $rows.Add([ordered]@{
            hwnd        = [int64]$candidate
            owner_hwnd  = $owner
            relation    = $relation
            rect        = $rect
            visible     = [bool][DshNative]::IsWindowVisible($handle)
            minimized   = [bool][DshNative]::IsIconic($handle)
            z_rank      = $rank
            z_rank_known = ($rank -ge 0)
            title       = "$($info.title)"
            process     = "$($info.process)"
            pid         = [int]$info.pid
            observed_at = $observedAt.ToString('o')
        })
    }
    # Front to back, so the caller reads what it should look at first. Unknown ranks last.
    $sorted = @($rows.ToArray() | Sort-Object -Property @{ Expression = { if ([int]$_['z_rank'] -lt 0) { 1000000 } else { [int]$_['z_rank'] } } })
    return $sorted
}

function Do-ScreenshotRelated([object]$Arg) {
    # §7 step two: one frame per related window, each through the ordinary single-window
    # capture path -- so every frame is encoded, registered under its own frame id and
    # reports its own geometry exactly like a single capture does.
    #
    # Default is still one frame: this only runs when the caller asked for `captures:
    # 'related'`, and the budget (§7) is two frames by default, three at most.
    $hwnd = 0
    if ($null -ne $Arg.window) { $hwnd = [int64]$Arg.window }
    if ($hwnd -eq 0) { throw "[BAD_REQUEST] captures: 'related' needs a window: it captures that window and the windows that belong to it" }
    $max = 2
    if ($null -ne $Arg.maxCaptures -and "$($Arg.maxCaptures)" -ne '') { $max = [int]$Arg.maxCaptures }
    if ($max -lt 1) { $max = 1 }
    if ($max -gt 3) { $max = 3 }
    $related = Get-RelatedWindowList $hwnd
    # Priority: the popups first (they are the reason this exists), then the window itself.
    $ordered = @($related | Where-Object { "$($_['relation'])" -ne 'self' })
    $target = @($related | Where-Object { "$($_['relation'])" -eq 'self' })
    if ($target.Count -gt 0) { $ordered += $target[0] }
    $captures = New-Object System.Collections.Generic.List[object]
    $omitted = New-Object System.Collections.Generic.List[object]
    foreach ($row in $ordered) {
        if ($captures.Count -ge $max) {
            $omitted.Add([ordered]@{ hwnd = [int64]$row['hwnd']; relation = "$($row['relation'])"; reason = "over max_captures ($max)" })
            continue
        }
        if ([bool]$row['minimized']) {
            # PrintWindow on a minimized window returns the shell's placeholder sliver --
            # a few dozen pixels that look like content. Skipping it and saying so beats
            # handing back a frame nobody can use (§7).
            $omitted.Add([ordered]@{ hwnd = [int64]$row['hwnd']; relation = "$($row['relation'])"; reason = 'minimized: a window capture would return the shell placeholder, not the window' })
            continue
        }
        $single = [ordered]@{ window = [int64]$row['hwnd'] }
        foreach ($pair in @(@('scale', 'scale'), @('format', 'format'), @('quality', 'quality'), @('clip', 'clip'), @('regionSpace', 'regionSpace'), @('surface', 'surface'), @('settleMs', 'settleMs'), @('stabilityMs', 'stabilityMs'), @('path', 'path'))) {
            $value = Get-ArgMember $Arg $pair[1]
            if ($null -ne $value) { $single[$pair[0]] = $value }
        }
        # Each frame needs its own file (§5.5). The caller's `path` names *the* capture; a loop
        # that wrote every related window to it left one file holding whichever frame finished
        # last, while the reply listed several -- and nothing downstream can recover the ones
        # that were overwritten on the way. So every derived frame gets a name of its own: the
        # caller's path (when there is one) plus the window and its place in the list, or a
        # per-request temporary name when there is not.
        $index = $captures.Count + 1
        $ext = 'png'
        if ("$($single['format'])" -eq 'jpeg' -or "$($single['format'])" -eq 'jpg') { $ext = 'jpg' }
        $base = "$($Arg.path)"
        if ($base -ne '') {
            $dir = [System.IO.Path]::GetDirectoryName($base)
            $leaf = [System.IO.Path]::GetFileNameWithoutExtension($base)
            if ([string]::IsNullOrWhiteSpace($leaf)) { $leaf = 'capture' }
            $suffix = "related-$index-$([int64]$row['hwnd'])"
            if ([string]::IsNullOrWhiteSpace($dir)) { $derived = "$leaf.$suffix.$ext" }
            else { $derived = [System.IO.Path]::Combine($dir, "$leaf.$suffix.$ext") }
        } else {
            $derived = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "dsh-frame-$PID-$($script:RequestSeq)-$index-$([int64]$row['hwnd']).$ext")
        }
        $single['path'] = $derived
        try {
            $shot = Do-Screenshot $single
        } catch {
            $omitted.Add([ordered]@{ hwnd = [int64]$row['hwnd']; relation = "$($row['relation'])"; reason = "$($_.Exception.Message)" })
            continue
        }
        # The path each frame *actually* went to, so the caller can tell the files apart
        # without having to infer the naming rule.
        Set-PayloadField $shot 'path' $derived
        $shot['relation'] = "$($row['relation'])"
        $shot['windowHwnd'] = [int64]$row['hwnd']
        $shot['ownerHwnd'] = [int64]$row['owner_hwnd']
        $shot['zRank'] = [int]$row['z_rank']
        $shot['zRankKnown'] = [bool]$row['z_rank_known']
        $shot['windowTitle'] = "$($row['title'])"
        $captures.Add($shot)
    }
    return [ordered]@{
        captures = @($captures.ToArray())
        omitted  = @($omitted.ToArray())
        related  = @($related)
    }
}

function Do-Screenshot([object]$Arg) {
    # An observation taken right after a write waits out the compositor, so the frame
    # returned is the one the action produced and not the one before it. What it does
    # *not* do any more is poll for a still picture it was never asked to wait for.
    $shotClock = [System.Diagnostics.Stopwatch]::StartNew()
    # Two ways to get pixels, and the difference matters when something covers the
    # target. The screen path copies what is *visible at those coordinates*, which may be
    # another window entirely; the window path asks the window to draw itself, so what is
    # in front of it is irrelevant.
    $windowHwnd = [IntPtr]::Zero
    if ($null -ne $Arg.window -and [int64]$Arg.window -ne 0) { $windowHwnd = [IntPtr][int64]$Arg.window }
    $captureSource = 'screen'
    $windowInfo = $null
    if ($windowHwnd -ne [IntPtr]::Zero) {
        if (-not [DshNative]::IsWindow($windowHwnd)) {
            throw "hwnd $([int64]$windowHwnd) is not a window any more; list windows with computer_windows and use a current handle"
        }
        # A minimized window still answers PrintWindow, and what it draws is the ~150x23
        # placeholder the shell keeps for it, at -32000,-32000. Handing that back as "the
        # window" is worse than refusing: it looks like content, and the caller has no way
        # to tell it is a sliver of nothing. The fix is one call away, so name it.
        if ([DshNative]::IsIconic($windowHwnd)) {
            throw "[WINDOW_MINIMIZED] hwnd $([int64]$windowHwnd) is minimized: what it would render is the placeholder the shell keeps for it (a few dozen pixels wide, off the top-left of the virtual desktop), not the window's content. Restore it first (computer_ui_action with control_type Window and action restore), or capture the screen instead. (action_sent=false, recovery=computer_ui_action)"
        }
        $windowInfo = Get-WindowInfoForHwnd $windowHwnd
        $r = Get-WindowRectInfo $windowHwnd
        if ($null -eq $r) { throw "hwnd $([int64]$windowHwnd) has no usable rectangle" }
        $captureSource = 'window'
    } else {
        $r = Resolve-Target $Arg
    }
    if ($r.width -le 0 -or $r.height -le 0) { throw "empty capture region $($r.width)x$($r.height)" }
    if (($r.width * $r.height) -gt $MAX_CAPTURE_PIXELS) {
        throw "the capture covers $($r.width * $r.height) pixels, over the $MAX_CAPTURE_PIXELS limit; pass a smaller region, a scale, or a smaller window"
    }
    $format = 'png'
    if ($null -ne $Arg.format -and "$($Arg.format)" -ne '') { $format = "$($Arg.format)".ToLowerInvariant() }
    if ($format -ne 'png' -and $format -ne 'jpeg' -and $format -ne 'jpg') { throw "unsupported image format '$format' (use png or jpeg)" }
    $quality = 85
    if ($null -ne $Arg.quality) { $quality = [int]$Arg.quality }
    # Scale: a request above 1 used to be silently truncated to 1, so a caller that asked
    # for a magnified frame got an unmagnified one and no way to tell. Both numbers are now
    # reported (`requestedScale` / `effectiveScale`), and the note says which one happened.
    # Interpolated magnification adds no information, so it is still not performed -- it is
    # just no longer a secret.
    $requestedScale = 1.0
    if ($null -ne $Arg.scale) { $requestedScale = [double]$Arg.scale }
    if ($requestedScale -le 0) { $requestedScale = 1.0 }
    $effectiveScale = [Math]::Min(1.0, $requestedScale)
    $scaleNote = ''
    if ($requestedScale -gt 1.0) {
        $scaleNote = "scale $requestedScale was asked for and this backend only downscales, so the frame is 1:1 (effectiveScale=1): interpolation would not add detail, and pretending it had would misstate what the pixels are"
    }
    $scale = $effectiveScale

    # ------------------------------------------------ what this frame is *of*
    #
    # Five spaces, kept apart on purpose. A single x/y/width/height used to stand in for all
    # of them, which is how a cropped frame was later compared against the whole window's
    # geometry, and how an image point could be projected with arithmetic that only held
    # while nothing had been cropped or scaled:
    #
    #   desktop   absolute physical pixels (what input is sent in)
    #   surface   the source bitmap: the window's own pixels, or a region of the screen
    #   crop      the sub-rectangle of the surface this frame holds
    #   encoded   the file written to disk
    #   attached  what the host delivered to the model (reported back to us when it differs)
    $clipRequested = ($Arg.clip -eq $true)
    $cropRect = $null
    $regionClipped = $false
    $deliverX = [int]$r.x
    $deliverY = [int]$r.y
    $deliverW = [int]$r.width
    $deliverH = [int]$r.height
    if ($windowHwnd -ne [IntPtr]::Zero) {
        $surfaceKind = 'wholeWindow'
        # A client-area capture: the window still renders itself (PrintWindow gives the whole
        # window), and the part that is not the application -- title bar, borders, resize grips --
        # is cropped away. The offset comes from the client origin in screen coordinates against
        # the window's own origin, so it holds for any theme, border width or DPI rather than
        # being guessed from a fixed title-bar height (方案 §2.2 "明确整个窗口、客户区或显示器").
        if ("$($Arg.surface)" -eq 'client' -and $null -eq $Arg.region) {
            $clientRect = New-Object DshNative+RECT
            $clientOrigin = New-Object DshNative+POINT
            if ([DshNative]::GetClientRect($windowHwnd, [ref]$clientRect) -and [DshNative]::ClientToScreen($windowHwnd, [ref]$clientOrigin)) {
                $cx = [int]$clientOrigin.X - [int]$r.x
                $cy = [int]$clientOrigin.Y - [int]$r.y
                $cw = [int]$clientRect.Right - [int]$clientRect.Left
                $ch = [int]$clientRect.Bottom - [int]$clientRect.Top
                if ($cw -gt 0 -and $ch -gt 0) {
                    $cropRect = [ordered]@{ x = $cx; y = $cy; width = $cw; height = $ch }
                    $deliverX = [int]$r.x + $cx
                    $deliverY = [int]$r.y + $cy
                    $deliverW = $cw
                    $deliverH = $ch
                    $surfaceKind = 'clientArea'
                } else {
                    throw "[BAD_REQUEST] surface: 'client' was asked for but hwnd $([int64]$windowHwnd) reports a client area of ${cw}x${ch}, which is not a rectangle anything can be captured from. Use surface: 'window' (the default) instead. (action_sent=false)"
                }
            } else {
                throw "[CAPTURE_SURFACE_UNAVAILABLE] surface: 'client' was asked for but the client rectangle of hwnd $([int64]$windowHwnd) could not be read, so there is nothing to crop to. Use surface: 'window' (the default), or read a screen region instead. (action_sent=false, recovery=computer_screenshot)"
            }
        }
        if ($null -ne $Arg.region) {
            # A region written next to `window` keeps its existing meaning -- *screen*
            # coordinates, exactly what the batch has always accepted -- unless the caller
            # says `regionSpace: 'window'`, in which case the numbers are pixels of that
            # window's own bitmap. The two are never told apart by their size, and the
            # default is the compatible one.
            $reg = $Arg.region
            $rx = [int]$reg.x
            $ry = [int]$reg.y
            $rw = [int]$reg.width
            $rh = [int]$reg.height
            if ($rw -le 0 -or $rh -le 0) { throw "[BAD_REQUEST] the capture region needs a positive width and height (got ${rw}x${rh}). (action_sent=false)" }
            $regionSpace = "$($Arg.regionSpace)"
            if ($regionSpace -eq 'window') {
                $cx = $rx
                $cy = $ry
            } else {
                # Screen pixels -> this window's own pixels. This is the conversion the old
                # batch crop path did with `$rx - $Shot.x`, kept as one named step.
                $cx = $rx - [int]$r.x
                $cy = $ry - [int]$r.y
            }
            $inside = ($cx -ge 0) -and ($cy -ge 0) -and (($cx + $rw) -le [int]$r.width) -and (($cy + $rh) -le [int]$r.height)
            if (-not $inside -and -not $clipRequested) {
                $how = "the region ($rx,$ry) ${rw}x${rh} in window pixels"
                if ($regionSpace -ne 'window') { $how = "the region ($rx,$ry) ${rw}x${rh} (screen pixels)" }
                throw "[BAD_REQUEST] $how is not inside the captured window, whose own bitmap is $($r.width)x$($r.height) with its origin at (0,0) in screen pixels $($r.x),$($r.y). A region passed together with window: is a rectangle of the screen (region_space: 'screen', the default) or of that window (region_space: 'window') -- pass clip: true to take the part of it that exists, drop window: to read those screen pixels on their own, or fix the rectangle. (action_sent=false)"
            }
            $cx0 = [Math]::Max(0, $cx)
            $cy0 = [Math]::Max(0, $cy)
            $cx1 = [Math]::Min([int]$r.width, $cx + $rw)
            $cy1 = [Math]::Min([int]$r.height, $cy + $rh)
            if ($cx1 -le $cx0 -or $cy1 -le $cy0) {
                throw "[BAD_REQUEST] the region ($rx,$ry) ${rw}x${rh} does not overlap the captured window at all, so there is nothing to clip to. (action_sent=false)"
            }
            $regionClipped = -not $inside
            $cropRect = [ordered]@{ x = $cx0; y = $cy0; width = $cx1 - $cx0; height = $cy1 - $cy0 }
            $deliverX = [int]$r.x + $cx0
            $deliverY = [int]$r.y + $cy0
            $deliverW = $cx1 - $cx0
            $deliverH = $cy1 - $cy0
        }
        $surfaceRect = [ordered]@{ kind = 'wholeWindow'; x = [int]$r.x; y = [int]$r.y; width = [int]$r.width; height = [int]$r.height }
    } else {
        if ($null -ne $Arg.region) { $surfaceKind = 'screenRegion' }
        elseif ("$($Arg.display)" -eq 'all') { $surfaceKind = 'virtualDesktop' }
        else { $surfaceKind = 'display' }
        $surfaceRect = [ordered]@{ kind = $surfaceKind; x = [int]$r.x; y = [int]$r.y; width = [int]$r.width; height = [int]$r.height }
    }
    if ($null -eq $cropRect) {
        $cropRect = [ordered]@{ x = 0; y = 0; width = [int]$r.width; height = [int]$r.height }
    }
    $displayKey = "$($Arg.display)"
    if ($null -eq $Arg.display -or "$($Arg.display)" -eq '') { $displayKey = 'primary' }
    $specKey = Get-CaptureSpecKey ([ordered]@{
        targetHwnd    = [int64]$windowHwnd
        surfaceKind   = $surfaceKind
        cropRectSurface = "$($cropRect.x),$($cropRect.y),$($cropRect.width),$($cropRect.height)"
        displayKey    = $displayKey
        effectiveScale = $effectiveScale
        format        = $format
    })

    # What this capture is of, recorded before the pixels are copied: the batch asks
    # this stamp whether a frame it already has came after its last write. Conservative
    # on purpose -- the instant recorded is the one just *before* the copy, so a frame
    # can never be stamped as newer than it is.
    [void](Record-Capture ([ordered]@{ x = $deliverX; y = $deliverY; width = $deliverW; height = $deliverH }) $windowHwnd $captureSource $specKey)

    # The wait comes after the rectangle is known, because the wait is *about* that
    # rectangle: what it watches is the thing it is about to encode, not whatever window
    # happens to be in front. And it comes after the target was validated, so a capture
    # that was never going to work does not spend a budget before saying so.
    $stamp = Get-WriteStampInfo
    $budget = Resolve-StabilityBudget $Arg.stabilityMs $Arg.stable
    $stabilityTarget = New-StabilityTarget $Arg $windowHwnd $r
    $settled = 0
    # The settle floor applies whenever there *was* a recent write, even when the poll is
    # off: the floor is what keeps the frame from being the one from before the click, and
    # it is the cheap half of the pacing.
    if ($null -ne $stamp) { $settled = Wait-ForSettle $Arg.settleMs }
    $stability = $null
    if ($null -eq $stamp) {
        $stability = New-StabilityResult 'none' $stabilityTarget $budget.ceilingMs $budget.resolvedBy ''
    } elseif ($budget.ceilingMs -le 0) {
        $stability = New-StabilityResult 'disabled' $stabilityTarget 0 $budget.resolvedBy '' $budget.conflict
    } elseif ($windowHwnd -ne [IntPtr]::Zero -and [int64]$stamp.hwnd -ne 0 -and [int64]$stamp.hwnd -ne [int64]$windowHwnd) {
        # The stamp says which window the write went to, so "wait for this window to stop
        # changing" can be recognised as a question about a different window than the one
        # the action touched -- and answered instead of slept through.
        $note = "the last write"
        if ("$($stamp.what)" -ne '') { $note = "the last write ($($stamp.what))" }
        $note = "$note went to hwnd $([int64]$stamp.hwnd), not to the hwnd $([int64]$windowHwnd) this capture is of, so waiting for this window to stop changing says nothing about that action"
        $stability = New-StabilityResult 'other-target' $stabilityTarget $budget.ceilingMs $budget.resolvedBy $note
    } else {
        $stability = Wait-ForStable $budget.ceilingMs $stabilityTarget $budget.resolvedBy $budget.conflict
    }
    $bmp = New-Object System.Drawing.Bitmap($r.width, $r.height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $out = $null
    $frameBmp = $null
    $encodedWidth = [int]$r.width
    $encodedHeight = [int]$r.height
    $surfaceDigest = ''
    $verification = New-Object System.Collections.Generic.List[string]
    # Measured inside the capture block, while the bitmap is alive: reading a disposed
    # Bitmap throws, and a swallowed throw here reads as "the frame is blank" -- which is
    # how a healthy window capture reported that it had no contrast at all.
    $hasContent = $null
    try {
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            if ($captureSource -eq 'window') {
                $hdc = $g.GetHdc()
                $drew = $false
                try {
                    # 0x2 = PW_RENDERFULLCONTENT. Without it a DirectComposition window
                    # (Chromium, Electron) hands back an empty frame instead of its content.
                    $drew = [DshNative]::PrintWindow($windowHwnd, $hdc, 2)
                } finally { $g.ReleaseHdc($hdc) }
                if (-not $drew) { $verification.Add('PrintWindow reported failure') }
                # A window that drew nothing is indistinguishable from a black window, and
                # handing that back as "here is your window" is worse than admitting the
                # window path did not work.
                $hasContent = Test-BitmapHasContent $bmp
                if (-not $hasContent) {
                    $verification.Add('the window rendered a uniform frame')
                    $g.CopyFromScreen($r.x, $r.y, 0, 0, (New-Object System.Drawing.Size($r.width, $r.height)), [System.Drawing.CopyPixelOperation]::SourceCopy)
                    $captureSource = 'screen'
                    $verification.Add('fell back to the screen, which shows whatever covers the window')
                } else {
                    $verification.Add('the window rendered its own pixels')
                }
            } else {
                $g.CopyFromScreen($r.x, $r.y, 0, 0, (New-Object System.Drawing.Size($r.width, $r.height)), [System.Drawing.CopyPixelOperation]::SourceCopy)
                $hasContent = Test-BitmapHasContent $bmp
            }
        } finally { $g.Dispose() }
        # Evidence, taken from the pixels that are already in hand. A batch fingerprints the
        # screen before and after its steps, and when the frame being encoded *contains* that
        # rectangle, that frame holds the "after" reading: copying the same rectangle off the
        # screen again would be a second reading of pixels this call already has. The
        # conditions are the ones that make the two readings comparable -- the evidence
        # rectangle inside the frame, pixels from the screen rather than from the window
        # drawing itself, and the same raster and hash -- and when any of them does not hold,
        # the caller falls back to taking the extra reading.
        $evidenceDigest = ''
        if ($null -ne $Arg.evidenceRect -and $captureSource -eq 'screen') {
            $er = $Arg.evidenceRect
            $ex = [int]$er.x; $ey = [int]$er.y; $ew = [int]$er.width; $eh = [int]$er.height
            $maxSide = 320
            if ($null -ne $er.maxSide) { $maxSide = [int]$er.maxSide }
            # The evidence rectangle has to be *inside* the frame for the frame to contain a
            # reading of it. A full-display capture of a window-sized evidence rectangle is
            # the common case, and the crop is the same pixels the separate reading would
            # have copied off the screen.
            $inside = ($ew -gt 0) -and ($eh -gt 0) -and
                      ($ex -ge $r.x) -and ($ey -ge $r.y) -and
                      (($ex + $ew) -le ($r.x + $r.width)) -and (($ey + $eh) -le ($r.y + $r.height))
            if ($inside) {
                $crop = $null
                try {
                    $clip = New-Object System.Drawing.Rectangle(($ex - $r.x), ($ey - $r.y), $ew, $eh)
                    $crop = $bmp.Clone($clip, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
                    $evidenceDigest = Get-BitmapDigestScaled $crop $maxSide
                } catch { $evidenceDigest = '' } finally { if ($null -ne $crop) { $crop.Dispose() } }
            }
        }
        # A fingerprint of the whole captured surface, taken from the pixels that are about to
        # be cropped and encoded. Read here, while the untouched bitmap is still in hand: the
        # frame's later re-check has to compare like with like, and what is delivered may be a
        # crop of this surface.
        try { $surfaceDigest = Get-BitmapDigestScaled $bmp 320 } catch { $surfaceDigest = '' }
        $path = [string]$Arg.path
        if ([string]::IsNullOrWhiteSpace($path)) { throw "screenshot requires a path" }
        $dir = Split-Path -Parent $path
        if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        # Crop on the raw pixels first, then scale once, then encode once. The order used to
        # be the other way round for a window region: the whole window was written to disk,
        # read back, cropped with coordinates from *another* space and scaled a second time
        # -- which both mis-cropped a scaled image and paid two extra encode/decode rounds.
        $cropOnly = ([int]$cropRect.x -ne 0) -or ([int]$cropRect.y -ne 0) -or
                    ([int]$cropRect.width -ne $bmp.Width) -or ([int]$cropRect.height -ne $bmp.Height)
        if ($cropOnly) {
            $clipRect = New-Object System.Drawing.Rectangle([int]$cropRect.x, [int]$cropRect.y, [int]$cropRect.width, [int]$cropRect.height)
            $frameBmp = $bmp.Clone($clipRect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        } else {
            $frameBmp = $bmp
        }
        $sourceW = $frameBmp.Width
        $sourceH = $frameBmp.Height
        # The size of the file, from the encoder rather than from width x scale: the two
        # agree only when the rounding happens to agree as well, and the number that reaches
        # the model has to be the one that describes what is actually on disk.
        $encodedWidth = [Math]::Max(1, [int][Math]::Round($sourceW * $scale))
        $encodedHeight = [Math]::Max(1, [int][Math]::Round($sourceH * $scale))
        if ($encodedWidth -ne $sourceW -or $encodedHeight -ne $sourceH) {
            # Scaling here rather than downstream: the bytes that reach the model are
            # the bytes we encode, so a half-size capture is both a faster encode and
            # a smaller upload. Bilinear keeps text legible at a fraction of bicubic's
            # cost on a 2560x1440 surface.
            $out = New-Object System.Drawing.Bitmap($encodedWidth, $encodedHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            $g2 = [System.Drawing.Graphics]::FromImage($out)
            try {
                $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
                $g2.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $g2.DrawImage($frameBmp, 0, 0, $encodedWidth, $encodedHeight)
            } finally { $g2.Dispose() }
            Save-BitmapToFile $out $path $format $quality
        } else {
            Save-BitmapToFile $frameBmp $path $format $quality
        }
    } finally {
        if ($null -ne $frameBmp -and -not [Object]::ReferenceEquals($frameBmp, $bmp)) { $frameBmp.Dispose() }
        $bmp.Dispose()
        if ($null -ne $out) { $out.Dispose() }
    }
    $cursor = New-Object DshNative+POINT
    [void][DshNative]::GetCursorPos([ref]$cursor)
    $fg = [DshNative]::GetForegroundWindow()
    $fileInfo = Get-Item -LiteralPath $path
    if ($captureSource -eq 'window') {
        # The handle could have been recycled while the frame was being taken, which would
        # make this a picture of a different process's window. Checked after the fact
        # because that is when it can have happened.
        $after = Get-WindowInfoForHwnd $windowHwnd
        if ([int]$after.pid -ne [int]$windowInfo.pid) {
            $verification.Add("the window changed owner during the capture (pid $($windowInfo.pid) -> $($after.pid)); this frame may not be the window you asked for")
        } else {
            $verification.Add('the window still belonged to the same process afterwards')
        }
        if ($hasContent -eq $false) {
            $verification.Add('the frame carries no contrast at all')
        }
        # The window can move or resize while the pixels are being read. The frame is still
        # an image of that window, but the origin recorded with it is the earlier one, so a
        # coordinate measured off the image would map to the wrong screen point.
        $rectAfter = Get-WindowRectInfo $windowHwnd
        if ($null -ne $rectAfter -and ($rectAfter.x -ne $r.x -or $rectAfter.y -ne $r.y -or $rectAfter.width -ne $r.width -or $rectAfter.height -ne $r.height)) {
            $verification.Add("the window changed geometry while the frame was being taken (was $($r.x),$($r.y) $($r.width)x$($r.height), is now $($rectAfter.x),$($rectAfter.y) $($rectAfter.width)x$($rectAfter.height)); the origin recorded with this frame is the earlier one")
        }
    }
    # Two refusals the capture path was missing.
    #
    # A frame with no contrast at all is not an observation: every pixel the same means
    # either the window drew nothing or the desktop would not give up its pixels, and
    # handing that back as "here is the window" invites the caller to reason about a blank
    # page as if it were content.
    #
    # Only for a window request. A uniform region of the screen is a fact about the
    # screen -- "this area is one flat colour" is a legitimate observation, and refusing
    # it would deny the caller something it can see for itself. A uniform *window* is
    # different: it means the window did not render, so there is no window in the frame.
    if ($hasContent -eq $false -and $windowHwnd -ne [IntPtr]::Zero) {
        $why = @($verification.ToArray()) -join '; '
        $detail = ''
        if ($why -ne '') { $detail = " Checked: $why." }
        throw "[CAPTURE_SURFACE_UNAVAILABLE] hwnd $([int64]$windowHwnd) came back with no contrast at all: every sampled pixel was the same, so the frame holds no window. $detail Try a region capture of the same area instead, or bring the window on screen and retry. (action_sent=false, recovery=computer_screenshot)"
    }
    # And when the caller needs the window's own pixels -- the whole point of a window
    # capture is that it is that window even while something covers it -- a fallback to the
    # screen is a silent downgrade of the guarantee it asked for. Saying so beats handing
    # back a picture of whatever happened to be on top.
    if ($Arg.requireWindow -eq $true -and $captureSource -ne 'window') {
        $why = @($verification.ToArray()) -join '; '
        throw "[CAPTURE_SURFACE_UNAVAILABLE] require=window was asked for and this window could not render itself, so the capture would have fallen back to the screen (which shows whatever covers it). Why: $why. Retry without require, or capture the screen deliberately with a region. (action_sent=false, recovery=computer_screenshot)"
    }
    $payload = [ordered]@{
        path     = $path
        # The rectangle of the screen this frame *is*: the crop placed at the surface's own
        # origin. Everything that reads x/y/width/height as "where on the desktop this image
        # came from" keeps working, now with the cropped frame's real geometry instead of
        # the whole window's.
        x        = $deliverX
        y        = $deliverY
        width    = $deliverW
        height   = $deliverH
        scale    = $scale
        requestedScale = $requestedScale
        effectiveScale = $effectiveScale
        format   = $format
        bytes    = [int64]$fileInfo.Length
        settledMs = $settled
        stability = $stability
        clipped  = (($null -ne $r.clipped) -and ($r.clipped -eq $true)) -or $regionClipped
        source   = $captureSource
        # The spaces this frame spans, each named (see the block above): the surface the
        # pixels came from, the crop of it that this image holds, and the size of the file.
        surfaceKind = $surfaceKind
        # The coordinate space of every number in this receipt (方案 §3.1 第 6 条: "插件返回实际尺寸、
        # 实际区域、捕获面、frameId 和坐标单位"). Stated as a field rather than left to prose, because
        # a caller reading `x`/`width` off the receipt needs to know they are physical desktop
        # pixels and not virtualized logical ones.
        units = 'physicalPixels'
        surface  = $surfaceRect
        cropRectSurface = $cropRect
        encodedWidth = $encodedWidth
        encodedHeight = $encodedHeight
        specKey  = $specKey
        # What the captured surface looked like, so a coordinate taken from this frame later can
        # be checked against what is there then (see Test-FrameContentUnchanged).
        surfaceDigest = $surfaceDigest
        verification = @($verification.ToArray())
        screens  = @(Get-ScreenList)
        virtual  = Get-VirtualBounds
        cursor   = [ordered]@{ x = $cursor.X; y = $cursor.Y }
        foreground = [ordered]@{ hwnd = [int64]$fg; title = [DshNative]::WindowText($fg) }
        window   = $windowInfo
    }
    if ($surfaceKind -eq 'wholeWindow') {
        # The whole window's rectangle, kept apart from the frame's own geometry: it is what
        # window identity and "has it been resized since" are judged against, and comparing
        # those questions against a crop was how a normal region frame reported a resize.
        $payload.windowRect = [ordered]@{ x = [int]$r.x; y = [int]$r.y; width = [int]$r.width; height = [int]$r.height }
    }
    if ($effectiveScale -ne $requestedScale) { $payload.scaleClamped = $true }
    if ($scaleNote -ne '') { $payload.scaleNote = $scaleNote }
    # Evidence the caller can use without taking the reading again (see above).
    if ($evidenceDigest -ne '') { $payload.evidenceDigest = $evidenceDigest }
    # Where the time went, in the one place that can measure it: the whole call inside the
    # worker, the settle floor it spent, the poll it spent (with how many samples and how
    # much of the budget), and what is left is capture plus encode. Without the split the
    # only visible number is the whole call.
    $payload.timing = [ordered]@{
        totalMs     = [int64]$shotClock.ElapsedMilliseconds
        settleMs    = [int]$settled
        pollMs      = 0
        polls       = 0
        stabilityMs = 0
    }
    if ($null -ne $stability) {
        $payload.timing.polls = [int]$stability.polls
        $payload.timing.pollMs = [int]$stability.waitedMs
        $payload.timing.stabilityMs = [int]$stability.budgetMs
    }
    # A capture is recorded as a frame so its pixels can be cited later. The span (how long the
    # whole capture took, measured inside this worker) travels with it: it is the one duration
    # that means the same thing on both sides of the pipe, unlike the monotonic instants, which
    # are not comparable across processes.
    $payload.captureSpanMs = [int64]$shotClock.ElapsedMilliseconds
    $payload.frame = New-CaptureFrame $payload
    Set-FrameCompleted $payload.frame
    # This observation really happened, so the write before it has been observed: the next
    # capture in the same burst does not have to wait for that write again. A failure above
    # leaves the stamp in place on purpose -- the retry is still the observation of it.
    Complete-WriteStamp
    return $payload
}

function Test-PointOnDesktop([int]$x, [int]$y) {
    $vx = [DshNative]::GetSystemMetrics([DshNative]::SM_XVIRTUALSCREEN)
    $vy = [DshNative]::GetSystemMetrics([DshNative]::SM_YVIRTUALSCREEN)
    $vw = [DshNative]::GetSystemMetrics([DshNative]::SM_CXVIRTUALSCREEN)
    $vh = [DshNative]::GetSystemMetrics([DshNative]::SM_CYVIRTUALSCREEN)
    if ($vw -le 0 -or $vh -le 0) { return $true }
    return ($x -ge $vx) -and ($x -lt ($vx + $vw)) -and ($y -ge $vy) -and ($y -lt ($vy + $vh))
}

function Assert-PointOnDesktop([int]$x, [int]$y) {
    # Normalized absolute coordinates wrap rather than clamp, so a point outside the
    # virtual desktop would silently land somewhere unrelated. Refusing is the only
    # honest answer -- and it catches the common mistake of reading a coordinate off
    # a downscaled capture without converting it back to screen pixels.
    if (Test-PointOnDesktop $x $y) { return }
    $vx = [DshNative]::GetSystemMetrics([DshNative]::SM_XVIRTUALSCREEN)
    $vy = [DshNative]::GetSystemMetrics([DshNative]::SM_YVIRTUALSCREEN)
    $vw = [DshNative]::GetSystemMetrics([DshNative]::SM_CXVIRTUALSCREEN)
    $vh = [DshNative]::GetSystemMetrics([DshNative]::SM_CYVIRTUALSCREEN)
    throw "($x,$y) is outside the virtual desktop, which spans x=$vx..$($vx + $vw - 1) and y=$vy..$($vy + $vh - 1); nothing was sent"
}

function Wait-ForCursorToSettle([int]$x, [int]$y, [int]$timeoutMs) {
    # The pointer does not arrive the instant SendInput returns. Clicking on the
    # assumption that it did is how a click lands on the wrong control; waiting for
    # the reported position to actually match is both safer and usually faster than
    # a fixed sleep.
    $deadline = (Get-Date).AddMilliseconds($timeoutMs)
    while ((Get-Date) -lt $deadline) {
        $cursor = New-Object DshNative+POINT
        if ([DshNative]::GetCursorPos([ref]$cursor)) {
            if ([Math]::Abs($cursor.X - $x) -le 1 -and [Math]::Abs($cursor.Y - $y) -le 1) { return $true }
        }
        Start-Sleep -Milliseconds 10
    }
    return $false
}

function Do-MouseMoveRelative([int]$dx, [int]$dy) {
    # A move is input: if the call's budget is already spent, the pointer stays where it is and
    # the caller is told why (§5.7).
    Assert-CanSend 'before a relative move'
    # A relative move is the only kind that reaches a target whose pointer is locked,
    # hidden or recentred (a canvas, a 3-D viewport, some games): there the absolute
    # position means nothing and the application consumes the *delta* (8.txt §9).
    #
    # It goes out as a plain MOUSEEVENTF_MOVE rather than through SetCursorPos, and that is
    # the whole point: SetCursorPos is a warp the application may ignore or undo, while the
    # relative event is the same thing the hardware sends.
    if ($dx -lt -32767 -or $dx -gt 32767 -or $dy -lt -32767 -or $dy -gt 32767) {
        throw "[BAD_REQUEST] a relative move is limited to ±32767 on each axis (got dx=$dx, dy=$dy)"
    }
    if ($dx -eq 0 -and $dy -eq 0) { throw "[BAD_REQUEST] a relative move needs a non-zero dx or dy" }
    Assert-NotCancelled 'before the relative move'
    $before = New-Object DshNative+POINT
    [void][DshNative]::GetCursorPos([ref]$before)
    $sent = [DshNative]::Send(@([DshNative]::Mouse($dx, $dy, 0, [DshNative]::MOUSEEVENTF_MOVE)))
    if ($sent -eq 0) { throw "SendInput delivered no mouse events (the desktop may be locked or the target is at a higher integrity level)" }
    $after = New-Object DshNative+POINT
    [void][DshNative]::GetCursorPos([ref]$after)
    $observedX = [int]$after.X - [int]$before.X
    $observedY = [int]$after.Y - [int]$before.Y
    $receipt = [ordered]@{
        requested      = [ordered]@{ dx = $dx; dy = $dy }
        cursorBefore   = [ordered]@{ x = [int]$before.X; y = [int]$before.Y }
        cursorAfter    = [ordered]@{ x = [int]$after.X; y = [int]$after.Y }
        observedDelta  = [ordered]@{ dx = $observedX; dy = $observedY }
        events         = $sent
    }
    # Pointer acceleration is on by default, so the observed delta is routinely larger than
    # what was asked for -- and a window that locks or recentres the pointer reports none at
    # all while still receiving every event. Neither is a failure, and the reply says which
    # of the two happened instead of leaving the caller to guess (§9).
    if ($observedX -eq 0 -and $observedY -eq 0) {
        $receipt['note'] = 'the pointer did not move on screen. The events were delivered, so either the target consumes relative motion without moving the cursor (a locked or recentred pointer, which is what this action exists for), or the desktop is discarding synthesized input. Check whether the target reacted before retrying.'
    } elseif ($observedX -ne $dx -or $observedY -ne $dy) {
        $receipt['note'] = "the pointer moved ($observedX,$observedY) for a requested ($dx,$dy): pointer acceleration and desktop scaling apply to relative moves, so this is not an error."
    }
    return $receipt
}

function Do-MouseMove([int]$x, [int]$y, [bool]$wait = $false) {
    # The lowest-level sender there is, so the budget check belongs here as well: a click or a
    # drag checks before it starts, and this one covers the moves it makes while it runs (§5.7).
    Assert-CanSend 'before moving the pointer'
    # Deliberately returns NOTHING. A PowerShell function's return value is its
    # whole pipeline output, so a stray `1` here would prepend itself to every
    # caller's result -- the command would answer `[1, {...}]` and the host, which
    # reads named fields off the reply, would see nothing where the fields should be.
    Assert-PointOnDesktop $x $y
    # Where the pointer was before the move, so a failure can tell "it did not move at
    # all" from "it moved and stopped short".
    $start = New-Object DshNative+POINT
    [void][DshNative]::GetCursorPos([ref]$start)
    $startX = $start.X
    $startY = $start.Y
    $abs = [DshNative]::Mouse([DshNative]::ToAbsoluteX($x), [DshNative]::ToAbsoluteY($y), 0, ([DshNative]::MOUSEEVENTF_MOVE -bor [DshNative]::MOUSEEVENTF_ABSOLUTE -bor [DshNative]::MOUSEEVENTF_VIRTUALDESK))
    $sent = [DshNative]::Send(@($abs))
    if ($sent -eq 0) { throw "SendInput delivered no mouse events (the desktop may be locked or the target is at a higher integrity level)" }
    if ($wait) {
        # SendInput returns success for events the desktop then throws away, and a
        # detached or locked session is exactly that: every call reports success and
        # the pointer never moves. Reading the pointer back is the only local proof
        # that input is reaching this desktop at all, and it turns a silent no-op
        # into a failure the caller can act on.
        if (-not (Wait-ForCursorToSettle $x $y 150)) {
            $cursor = New-Object DshNative+POINT
            [void][DshNative]::GetCursorPos([ref]$cursor)
            # Two different conditions, and only one of them means the desktop is
            # discarding input. A pointer that did not move at all is a desktop that will
            # not accept synthesized input; a pointer that moved *most* of the way and
            # stopped is a desktop that is slow to get there, and calling that "input is
            # being discarded" sends the caller looking for a lock screen that is not
            # there. The move is re-issued once before either verdict is reached.
            $moved = [Math]::Abs($cursor.X - $startX) + [Math]::Abs($cursor.Y - $startY)
            if ($moved -gt 2) {
                $abs2 = [DshNative]::Mouse([DshNative]::ToAbsoluteX($x), [DshNative]::ToAbsoluteY($y), 0, ([DshNative]::MOUSEEVENTF_MOVE -bor [DshNative]::MOUSEEVENTF_ABSOLUTE -bor [DshNative]::MOUSEEVENTF_VIRTUALDESK))
                [void][DshNative]::Send(@($abs2))
                if (Wait-ForCursorToSettle $x $y 400) { return }
                [void][DshNative]::GetCursorPos([ref]$cursor)
                throw "[POINTER_NOT_SETTLED] the pointer was moved to ($x,$y) and is still at $($cursor.X),$($cursor.Y) after being sent twice. Input is reaching this desktop -- the pointer did travel -- so this is a slow or contended desktop rather than a locked one. Retry the action, or raise the wait. (action_sent=true, dispatch_status=possibly_sent)"
            }
            # action_sent is true and the dispatch status is only *possibly* sent: the
            # call was accepted, so the caller must treat the UI as touched. Claiming
            # nothing was sent would be the dangerous direction to be wrong in.
            throw "the pointer did not reach ($x,$y): SendInput was accepted but nothing moved (it is still at $($cursor.X),$($cursor.Y)). This is what a locked workstation, a secure desktop, or a session that is not attached to the console looks like -- synthesized input is being discarded by Windows. (action_sent=true, dispatch_status=possibly_sent)"
        }
    }
}

function Get-ButtonFlags([string]$button) {
    switch ("$button".ToLowerInvariant()) {
        'right'  { return @([DshNative]::MOUSEEVENTF_RIGHTDOWN, [DshNative]::MOUSEEVENTF_RIGHTUP) }
        'middle' { return @([DshNative]::MOUSEEVENTF_MIDDLEDOWN, [DshNative]::MOUSEEVENTF_MIDDLEUP) }
        default  { return @([DshNative]::MOUSEEVENTF_LEFTDOWN, [DshNative]::MOUSEEVENTF_LEFTUP) }
    }
}

function Get-PressableElementAtPoint([int]$x, [int]$y) {
    # The `auto` strategy: a coordinate click still tries accessibility first and only
    # falls back to a synthesized click when nothing pressable is under the point. Two
    # things make that worth doing -- the a11y press
    # is more reliable than a raw click (it survives occlusion and off-screen
    # position), and it needs no foreground window at all, so it works on a window the
    # desktop refuses to raise.
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $el = $null
    try {
        $point = New-Object System.Windows.Point($x, $y)
        $el = [System.Windows.Automation.AutomationElement]::FromPoint($point)
    } catch { $el = $null }
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    for ($hop = 0; $hop -lt 4 -and $null -ne $el; $hop++) {
        try {
            $info = $el.Current
            if ($info.IsEnabled) {
                $p = $null
                if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {
                    return [ordered]@{
                        element      = $el
                        name         = [string]$info.Name
                        controlType  = [string]$info.ControlType.ProgrammaticName
                        automationId = [string]$info.AutomationId
                    }
                }
            }
            $el = $walker.GetParent($el)
        } catch { break }
    }
    return $null
}

function Get-HitIdentity([int]$x, [int]$y) {
    # What is actually under a screen point right now, for the rule that a frame whose
    # window has moved must be re-projected *and* checked before anything is dispatched.
    #
    # "The projected point is still inside the window's rectangle" is not that check:
    # a window that moved 40 px keeps its own points inside itself, so the click lands
    # on a different control while the receipt says the target was verified. The
    # element that would receive the input is what has to be read back.
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $el = $null
    try { $el = [System.Windows.Automation.AutomationElement]::FromPoint((New-Object System.Windows.Point($x, $y))) } catch { $el = $null }
    if ($null -eq $el) { return $null }
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $hitHwnd = 0
    $hitPid = 0
    $hitName = ''
    $hitType = ''
    $node = $el
    for ($hop = 0; $hop -lt 6 -and $null -ne $node; $hop++) {
        try {
            $info = $node.Current
            if ($hop -eq 0) {
                $hitName = [string]$info.Name
                $hitType = [string]$info.ControlType.ProgrammaticName
                $hitPid = [int]$info.ProcessId
            }
            if ($hitHwnd -eq 0 -and [int64]$info.NativeWindowHandle -ne 0) { $hitHwnd = [int64]$info.NativeWindowHandle }
            $node = $walker.GetParent($node)
        } catch { break }
    }
    return [ordered]@{ hwnd = $hitHwnd; pid = $hitPid; name = $hitName; controlType = $hitType }
}

# ---------------------------------------------------------------------------
# Frames: the provenance of a pixel.
#
# The most expensive mistake in this loop is not a failed call, it is a *successful*
# one against the wrong target -- and the most common way to make it is arithmetic:
# the model reads a coordinate off a capture, forgets to add the capture origin, or
# forgets that the image it was shown was downscaled, and clicks a pixel that means
# something else on screen.
#
# So a capture is recorded as a frame: its origin, its size, the scale its image was
# delivered at, and -- when it came from a window -- which window. A caller can then
# give coordinates *in that image* and let this worker project them, which removes the
# arithmetic entirely, and the frame is checked before anything is dispatched.
# ---------------------------------------------------------------------------
$script:FrameRegistry = @{}
$script:FrameSeq = 0
$script:FrameKeep = 32
# How long a merged run's text may get before it is cut and marked.
$MAX_MERGED_NAME = 240

# The observation epoch: a monotonic counter advanced by every *wait boundary* the worker
# completes (a duration wait, a condition wait, the stability poll of a capture).
#
# Why a counter and not a timestamp: "is this frame on the right side of the thing I just
# waited for" is an ordering question, and it has to be answerable without subtracting
# clocks. A frame taken before a wait that changed the screen is a picture of the world
# the caller was not asking about, and handing it back as "the state after your wait" is
# the failure nobody can see. A frame is reusable as a *final* result only when it was
# taken in the current epoch, after the last write, and with the same capture request.
$script:ObservationEpoch = [int64]0
$script:FrameProtocol = 2

function Get-CaptureSpecKey([object]$payload) {
    # "The same screenshot request" as one comparable string: which target, which
    # surface, which region, which output shape. A cached frame may only stand in for a
    # new request when every one of these agrees -- otherwise the caller is handed a
    # picture of something it did not ask for, at a size it cannot project from.
    if ($null -eq $payload) { return '' }
    $hwnd = [int64]0
    if ($null -ne $payload.window -and $null -ne $payload.window.hwnd) { $hwnd = [int64]$payload.window.hwnd }
    elseif ($null -ne $payload.targetHwnd) { $hwnd = [int64]$payload.targetHwnd }
    $surface = "$($payload.surfaceKind)"
    $crop = "$($payload.cropRectSurface)"
    $display = ''
    if ($null -ne $payload.displayKey) { $display = "$($payload.displayKey)" }
    $scale = '1'
    if ($null -ne $payload.effectiveScale) { $scale = ([double]$payload.effectiveScale).ToString('0.####', [System.Globalization.CultureInfo]::InvariantCulture) }
    return "hwnd=$hwnd;surface=$surface;crop=$crop;display=$display;scale=$scale;format=$($payload.format)"
}

function New-CaptureFrame($payload) {
    # FrameRecord v2. The old record kept one rectangle and one scale, and those two
    # numbers stood in for four different things -- which is how a *cropped* frame ended up
    # being compared against the whole window's geometry, and how an image point could be
    # projected with arithmetic that was only correct while nothing had been cropped.
    #
    # The four things are recorded separately now, because each one has its own consumer:
    #
    #   windowRect   the whole window at capture time -- identity and geometry validation.
    #   surface      the bitmap the pixels came out of, and where it sits on the desktop.
    #   crop         the sub-rectangle of that bitmap this frame actually holds.
    #   encoded      the image as written to disk, with requested vs effective scale.
    #   attached     what the host delivered to the model, once it has told us.
    $script:FrameSeq++
    # The id carries the worker's boot generation, for the same reason a snapshot id does: the
    # counter restarts at 1 in every worker, so "f3" from a worker that has since been replaced
    # would name a *different* image here. With the generation folded in, an id from before a
    # restart is recognisably old rather than accidentally valid.
    $id = "f$($script:BootGen)$($script:FrameSeq)"
    $hwnd = 0
    $ownerPid = 0
    if ($null -ne $payload.window) {
        $hwnd = [int64]$payload.window.hwnd
        $ownerPid = [int]$payload.window.pid
    }
    # Two more facts that make "the same window" checkable later: the DPI its pixels are being
    # rendered at (a window can be dragged to a monitor with another scale factor without its
    # rectangle changing at all), and the identity of the process behind the handle (a pid can
    # be reused by a different process).
    $dpi = Get-WindowDpi $hwnd
    $procStart = Get-ProcessStartTicks $ownerPid
    # The root of the window this frame is of, recorded rather than recomputed later: it is part
    # of what "the same window" means, and a receipt that names it lets a caller tell a dialog
    # from a separate window of the same application.
    $rootHwnd = Get-WindowRootHwnd $hwnd
    $virtual = $payload.virtual
    if ($null -eq $virtual) { $virtual = Get-VirtualBounds }
    $windowRect = $null
    if ($null -ne $payload.windowRect) { $windowRect = $payload.windowRect }
    elseif ($hwnd -ne 0) {
        $windowRect = [ordered]@{ x = [int]$payload.x; y = [int]$payload.y; width = [int]$payload.width; height = [int]$payload.height }
    }
    $surface = $payload.surface
    if ($null -eq $surface) {
        $surface = [ordered]@{ kind = 'screen'; x = [int]$payload.x; y = [int]$payload.y; width = [int]$payload.width; height = [int]$payload.height }
    }
    $crop = $payload.cropRectSurface
    if ($null -eq $crop) {
        $crop = [ordered]@{ x = 0; y = 0; width = [int]$surface.width; height = [int]$surface.height }
    }
    # The size of the image on disk: taken from the encoder when the capture reports it,
    # and only *derived* from the crop and the scale when an older path did not say.
    $encWidth = [int]$payload.encodedWidth
    $encHeight = [int]$payload.encodedHeight
    if ($encWidth -le 0 -or $encHeight -le 0) {
        $eff = 1.0
        if ($null -ne $payload.effectiveScale) { $eff = [double]$payload.effectiveScale }
        $encWidth = [int][Math]::Max(1, [int][Math]::Round([int]$crop.width * $eff))
        $encHeight = [int][Math]::Max(1, [int][Math]::Round([int]$crop.height * $eff))
    }
    $attached = [ordered]@{
        width          = [int]$payload.attachedWidth
        height         = [int]$payload.attachedHeight
        transformKnown = $false
        reported       = $false
    }
    if ($attached.width -gt 0 -and $attached.height -gt 0) { $attached.transformKnown = $true }
    $record = [ordered]@{
        id            = $id
        schemaVersion = 2
        hwnd          = $hwnd
        pid           = $ownerPid
        windowRect    = $windowRect
        surface       = $surface
        crop          = $crop
        encoded       = [ordered]@{ width = $encWidth; height = $encHeight }
        attached      = $attached
        requestedScale = $(if ($null -ne $payload.requestedScale) { [double]$payload.requestedScale } else { 1.0 })
        effectiveScale = $(if ($null -ne $payload.effectiveScale) { [double]$payload.effectiveScale } else { 1.0 })
        source        = "$($payload.source)"
        surfaceKind   = "$($surface.kind)"
        epoch         = [int64]$script:ObservationEpoch
        writeSeq      = [int64]$script:WriteSeq
        specKey       = "$($payload.specKey)"
        seq           = [int]$script:FrameSeq
        dpi           = [int]$dpi
        processStart  = [int64]$procStart
        rootHwnd      = [int64]$rootHwnd
        surfaceDigest = "$($payload.surfaceDigest)"
        captureStartedMonoMs = [int64]$script:Clock.ElapsedMilliseconds
        # Filled in when the pixels are actually on disk; the pair of instants is what tells a
        # slow copy from a slow encode.
        captureCompletedMonoMs = [int64]0
        width         = [int]$payload.width
        height        = [int]$payload.height
        x             = [int]$payload.x
        y             = [int]$payload.y
        # Compatibility surface: the v1 fields callers already read, pointing at the same
        # facts (the *delivered* image's size, and the mapping origin of the frame).
        imageWidth    = $encWidth
        imageHeight   = $encHeight
        scale         = $(if ($null -ne $payload.effectiveScale) { [double]$payload.effectiveScale } else { 1.0 })
        vx            = [int]$virtual.x
        vy            = [int]$virtual.y
        vwidth        = [int]$virtual.width
        vheight       = [int]$virtual.height
    }
    $script:FrameRegistry[$id] = $record
    $floor = $script:FrameSeq - $script:FrameKeep
    if ($floor -gt 0) {
        foreach ($key in @($script:FrameRegistry.Keys)) {
            $entry = $script:FrameRegistry[$key]
            # Aged out by the sequence recorded *in* the entry: the id carries the boot
            # generation now, so its digits are no longer the sequence on its own.
            if ($null -ne $entry -and [int]$entry.seq -le $floor) { $script:FrameRegistry.Remove($key) }
        }
    }
    return $id
}

function Set-FrameCompleted([string]$frameId) {
    # When the pixels finished, as opposed to when the capture started. Recorded separately
    # because the two answer different questions: a frame that spent 800 ms copying and 20 ms
    # encoding is a different problem from one that spent 20 ms copying and 800 ms encoding.
    $frame = $script:FrameRegistry[$frameId]
    if ($null -eq $frame) { return }
    $frame['captureCompletedMonoMs'] = [int64]$script:Clock.ElapsedMilliseconds
}

function Test-FrameContentUnchanged($frame) {
    # Whether the surface this frame was taken from still looks the same -- asked only when the
    # frame is old enough for the question to be worth its cost.
    #
    # This is the check geometry cannot make. A window whose contents scrolled, a list that
    # refreshed itself while the caller was reading, a page that navigated away: the rectangle
    # is identical, the identity checks all pass, and a coordinate measured off the old image
    # lands on whatever is there now. The frame carries a fingerprint of the surface it was
    # captured from, and the same fingerprint is taken again here.
    #
    # Three deliberate refusals to guess:
    #   * a fresh frame is not checked at all (the caller just looked);
    #   * a surface that cannot be read again reports "not checked", not "changed";
    #   * a frame captured from the screen is re-read from the screen, and one captured from the
    #     window's own drawing is re-read the same way -- comparing the two would report every
    #     window as changed the moment anything covers it.
    if ($script:FrameVerifyAfterMs -le 0) { return @{ checked = $false; changed = $false } }
    $stored = "$($frame.surfaceDigest)"
    if ($stored -eq '') { return @{ checked = $false; changed = $false } }
    $ageMs = [int64]0
    if ([int64]$frame.captureCompletedMonoMs -gt 0) {
        $ageMs = [int64]$script:Clock.ElapsedMilliseconds - [int64]$frame.captureCompletedMonoMs
    } elseif ($null -ne $frame.frameAgeMs -and [int64]$frame.frameAgeMs -gt 0) {
        # A synthetic frame (frameproject) states its own age, so the rule itself is testable
        # without waiting for time to pass.
        $ageMs = [int64]$frame.frameAgeMs
    }
    if ($ageMs -lt [int64]$script:FrameVerifyAfterMs) { return @{ checked = $false; changed = $false; ageMs = $ageMs } }
    $live = ''
    try {
        if ([int64]$frame.hwnd -ne 0 -and "$($frame.source)" -eq 'window') {
            $live = Get-WindowDigest ([IntPtr][int64]$frame.hwnd) 320
        } else {
            $surface = $frame.surface
            $live = Get-RegionDigest ([int]$surface.x) ([int]$surface.y) ([int]$surface.width) ([int]$surface.height) 320
        }
    } catch { $live = '' }
    if ($live -eq '') {
        return @{ checked = $false; changed = $false; ageMs = $ageMs; note = 'the surface could not be read again, so nothing was compared' }
    }
    return @{ checked = $true; changed = ($live -ne $stored); ageMs = $ageMs }
}

function Get-LandingWindow([int]$x, [int]$y) {
    # Cheap landing identity: which window owns this pixel, and its root. WindowFromPoint
    # is one user32 call with no accessibility client behind it, so the guard can afford to
    # run on *every* coordinate write instead of only when a window is known to have moved.
    # A null answer means "nothing is there / could not be read", which is reported as an
    # unverified landing rather than silently as a good one.
    $pt = New-Object DshNative+POINT
    $pt.X = $x
    $pt.Y = $y
    $hit = [IntPtr]::Zero
    try { $hit = [DshNative]::WindowFromPoint($pt) } catch { $hit = [IntPtr]::Zero }
    if ($hit -eq [IntPtr]::Zero) { return $null }
    $procId = 0
    [void][DshNative]::GetWindowThreadProcessId($hit, [ref]$procId)
    $root = [IntPtr]::Zero
    try { $root = [DshNative]::GetAncestor($hit, [DshNative]::GA_ROOT) } catch { $root = $hit }
    if ($root -eq [IntPtr]::Zero) { $root = $hit }
    return [ordered]@{ hwnd = [int64]$hit; root = [int64]$root; pid = [int]$procId }
}

function Get-WindowRootHwnd([int64]$hwnd) {
    if ($hwnd -eq 0) { return 0 }
    $root = [IntPtr]::Zero
    try { $root = [DshNative]::GetAncestor([IntPtr]$hwnd, [DshNative]::GA_ROOT) } catch { $root = [IntPtr]::Zero }
    if ($root -eq [IntPtr]::Zero) { return $hwnd }
    return [int64]$root
}

function Get-WindowOwnerHwnd([int64]$hwnd) {
    # The window that owns this one, when there is one. An owned window (a dialog, a popup
    # menu, a tool palette) is the legitimate case where the thing under a point belongs to
    # the target's process but is not the target's root -- and knowing the owner is what
    # separates "a dialog of the window I am driving" from "another window of the same
    # application that happens to be here".
    if ($hwnd -eq 0) { return 0 }
    try {
        $owner = [DshNative]::GetWindow([IntPtr]$hwnd, [DshNative]::GW_OWNER)
        if ($owner -eq [IntPtr]::Zero) { return 0 }
        return [int64]$owner
    } catch { return 0 }
}

function Get-ProcessStartTicks([int]$procId) {
    # The identity of a *process*, not of a handle. Two different processes can occupy the
    # same pid over time, and a recycled hwnd whose new owner reuses that pid would otherwise
    # pass every check this file makes. Zero means "could not be read", which is treated as
    # unknown and never as a match.
    if ($procId -le 0) { return [int64]0 }
    try {
        $proc = Get-Process -Id $procId -ErrorAction Stop
        return [int64]$proc.StartTime.Ticks
    } catch { return [int64]0 }
}

function Get-WindowDpi([int64]$hwnd) {
    # 0 means "this Windows will not say", which the projection treats as unknown.
    try {
        if ($hwnd -ne 0) { return [int][DshNative]::DpiForWindowOrZero([IntPtr]$hwnd) }
        return [int][DshNative]::SystemDpiOrZero()
    } catch { return 0 }
}

function Test-LandingGuard([int64]$targetHwnd, [int]$targetPid, [int]$x, [int]$y, [object]$allowWindows = $null) {
    # What receives a synthesized coordinate is whatever is *under the point*, so that is
    # what gets read -- for every coordinate write, whether or not the window moved. The
    # old check lived inside the "the window moved" branch, which meant a still window that
    # had been covered by something else passed the guard and took the input.
    #
    # A pid is not an identity (方案 §3.3 第 3 条: 相同 PID 不足以证明相同窗口): "same process"
    # does not make it the same window, and a second top-level window of the same application
    # sitting over the target would take the input while the receipt said the target had been
    # verified. The outcomes are therefore:
    #
    #   ok           the target window itself (or a child of it) is under the point.
    #   ok+note      the caller named that window as an expected transition (allow_windows),
    #                or it is an *owned* window of the target -- a dialog, a popup menu or a
    #                tool palette belonging to the window being driven.
    #   refuse       anything else, *including another window of the same process*: the input
    #                would go somewhere this frame does not describe.
    if ($targetHwnd -eq 0) {
        return [ordered]@{ ok = $true; how = 'no-target'; note = 'this frame has no window identity (a screen capture), so the landing point was not compared against a target' }
    }
    $hit = Get-LandingWindow $x $y
    if ($null -eq $hit) {
        return [ordered]@{ ok = $true; how = 'unavailable'; note = "nothing could be read under ($x,$y), so the landing point was not verified" }
    }
    $targetRoot = Get-WindowRootHwnd $targetHwnd
    if ([int64]$hit.root -eq $targetRoot -or [int64]$hit.hwnd -eq $targetHwnd) {
        return [ordered]@{ ok = $true; how = 'root'; hit = $hit }
    }
    # An explicit declaration is the most specific thing a caller can say about what it expects
    # to be under the point, so it is answered first (方案 §3.3 第 3 条: a transition the caller
    # named is followed rather than refused).
    $allowed = $false
    if ($null -ne $allowWindows) {
        foreach ($candidate in @($allowWindows)) {
            if ([int64]$candidate -eq [int64]$hit.hwnd -or [int64]$candidate -eq [int64]$hit.root) { $allowed = $true }
        }
    }
    if ($allowed) {
        return [ordered]@{ ok = $true; how = 'allowed-transition'; hit = $hit; note = "hwnd $($hit.hwnd) is in this call's expected window transitions, so the point was allowed" }
    }
    if ($targetPid -gt 0 -and [int]$hit.pid -eq $targetPid) {
        # Same process, another top-level window. The legitimate version of that is an owned
        # window -- a dialog, a popup menu, a tool palette -- whose owner leads back to the
        # window being driven; the owner chain is followed to its root so that a popup owned
        # by a *child* of the target is recognised as well. Anything else is a different
        # window of the same application (its main window, a second document), and a shared
        # pid does not make it the window this frame is of.
        $owner = Get-WindowOwnerHwnd ([int64]$hit.hwnd)
        if ($owner -ne 0 -and ($owner -eq $targetHwnd -or $owner -eq $targetRoot -or (Get-WindowRootHwnd $owner) -eq $targetRoot)) {
            return [ordered]@{
                ok   = $true
                how  = 'owned-by-target'
                hit  = $hit
                note = "the window under ($x,$y) is hwnd $($hit.hwnd), owned by the target window $targetHwnd -- a dialog or popup that belongs to it"
            }
        }
        return [ordered]@{
            ok     = $false
            how    = 'same-process-other-window'
            hit    = $hit
            reason = "[TARGET_OCCLUDED] ($x,$y) is over hwnd $($hit.hwnd) (root $($hit.root)), a different window of the *same* process (pid $targetPid) as the target hwnd $targetHwnd, and it is not a window owned by the target. A shared pid does not make it the same window, so nothing was sent. Bring the target forward, aim the action at a control instead, capture that window's own frame and act on it, or name hwnd $($hit.hwnd) in allow_windows when this window is the transition you expect. (action_sent=false, recovery=computer_screenshot, auto_reresolve=false)"
        }
    }
    # A second opinion before refusing: WindowFromPoint sees the top-level window under the
    # pixel, and for a layered or transparent overlay that can disagree with what an
    # accessibility client reports as the element receiving input.
    $uia = $null
    try { $uia = Get-HitIdentity $x $y } catch { $uia = $null }
    # The element under the point has to belong to the *target window* (or to a window of the
    # same root), not merely to the same process: otherwise this rescue -- which exists for a
    # layered or transparent overlay whose hit test disagrees with WindowFromPoint -- would
    # also wave through a different window of the target's own application.
    $uiaHwnd = [int64]0
    if ($null -ne $uia) { $uiaHwnd = [int64]$uia.hwnd }
    if ($uiaHwnd -ne 0 -and ($uiaHwnd -eq $targetHwnd -or (Get-WindowRootHwnd $uiaHwnd) -eq $targetRoot) -and ($targetPid -le 0 -or [int]$uia.pid -eq $targetPid)) {
        return [ordered]@{ ok = $true; how = 'uia-agrees'; hit = $hit; note = "WindowFromPoint named pid $($hit.pid) under ($x,$y), but the element there belongs to the target window ($uiaHwnd, pid $($uia.pid)); the accessibility answer was taken as the deciding one" }
    }
    $who = ''
    if ($null -ne $uia -and "$($uia.name)" -ne '') {
        # The element's own process is worth naming when it differs from the window
        # WindowFromPoint named -- that difference is the interesting fact -- but not repeated
        # when it is the same pid, which would read like two different targets.
        $who = " ('$($uia.name)' $($uia.controlType)"
        if ([int]$uia.pid -gt 0 -and [int]$uia.pid -ne [int]$hit.pid) { $who = "$who in pid $($uia.pid)" }
        $who = "$who)"
    }
    return [ordered]@{
        ok     = $false
        how    = 'occluded'
        hit    = $hit
        reason = "[TARGET_OCCLUDED] ($x,$y) is over hwnd $($hit.hwnd)$who -- pid $($hit.pid), while the target is hwnd $targetHwnd (pid $targetPid). A coordinate sent there would go to that other window, so nothing was sent. Observe what is on screen (computer_screenshot or computer_windows), bring the target forward, or aim the action at a control instead. (action_sent=false, recovery=computer_screenshot, auto_reresolve=false)"
    }
}

function Get-FrameTransform($frame, [double]$ax, [double]$ay) {
    # The transform as a pure function of the record: attached image -> encoded image ->
    # surface -> desktop.
    #
    # Image coordinates are pixel indices with the origin at the image's top-left corner. The
    # index is carried through each stage as a real number and rounded exactly once, at the
    # end, so a chain of ratios cannot accumulate a rounding drift. Nothing here assumes that
    # the delivered image is the encoded one, or that the frame is the whole surface.
    $ex = $ax
    $ey = $ay
    $mapping = 'encoded-1:1'
    $note = ''
    $attached = $frame.attached
    if ($null -ne $attached -and $attached.reported -eq $true) {
        $aw = [int]$attached.width
        $ah = [int]$attached.height
        if ($attached.transformKnown -ne $true -or $aw -le 0 -or $ah -le 0) {
            return @{ ok = $false; error = "[COORDINATE_MAPPING_UNKNOWN] the image the host delivered for frame $($frame.id) has an unknown transform (the attachment layer did not report its size), so a point in that image cannot be mapped to the screen. Take a new capture of what you need, or act on a control instead of a coordinate. (action_sent=false, recovery=computer_screenshot)" }
        }
        if ($aw -ne [int]$frame.encoded.width -or $ah -ne [int]$frame.encoded.height) {
            # The host resized (or re-encoded) the image on its way to the model, so the
            # inverse is applied -- but only when the numbers are a *plausible* rescale of
            # this frame. A delivered image is a downscale, never a bigger one (upscaling on
            # the way to the model adds bytes and no detail), and a ratio of a few percent
            # would mean the two sizes describe different things entirely.
            #
            # Why the check exists at all: a host whose attachment layer reports a fixed
            # placeholder size (a test double reporting 2560x1440 for everything is exactly
            # that) would otherwise drag every projected point by the ratio between the
            # placeholder and this capture -- turning a correct coordinate into a wrong click,
            # silently, which is the failure this whole chain exists to prevent.
            $plausible = ($aw -le ([int]$frame.encoded.width + 2)) -and ($ah -le ([int]$frame.encoded.height + 2)) -and
                         (($aw / [double]$frame.encoded.width) -ge 0.05) -and (($ah / [double]$frame.encoded.height) -ge 0.05)
            if ($plausible) {
                $ex = $ax * ([double]$frame.encoded.width / [double]$aw)
                $ey = $ay * ([double]$frame.encoded.height / [double]$ah)
                $mapping = "attached-rescaled(${aw}x${ah}->$([int]$frame.encoded.width)x$([int]$frame.encoded.height))"
            } else {
                $mapping = "attached-ignored(${aw}x${ah} for a $([int]$frame.encoded.width)x$([int]$frame.encoded.height) frame)"
                $note = "the attachment layer reported a ${aw}x${ah} image for a $([int]$frame.encoded.width)x$([int]$frame.encoded.height) frame, which is not a rescale of this capture, so it was ignored and the projection stayed 1:1"
            }
        }
    }
    $crop = $frame.crop
    $encodedWidth = [int]$frame.encoded.width
    $encodedHeight = [int]$frame.encoded.height
    if ($encodedWidth -le 0 -or $encodedHeight -le 0) {
        return @{ ok = $false; error = "[COORDINATE_MAPPING_UNKNOWN] frame $($frame.id) records an image of $encodedWidth x $encodedHeight pixels, which is not a size anything can be mapped from. Take a new capture. (action_sent=false, recovery=computer_screenshot)" }
    }
    $ratioX = [double]$crop.width / [double]$encodedWidth
    $ratioY = [double]$crop.height / [double]$encodedHeight
    # Integer pixel indices, nearest neighbour, one rounding per axis at the very end of the
    # chain: image pixel i stands for the source pixels around source pixel i × ratio, and the
    # nearest one is what it is. This keeps a 1:1 frame exact (i × 1 is i), keeps a half-scale
    # frame's pixel i in the block of source pixels it came from, and -- unlike adding half a
    # pixel before multiplying -- does not drift by one on every ratio above 1.
    $sx = [double]$crop.x + [Math]::Round(($ex * $ratioX), [System.MidpointRounding]::AwayFromZero)
    $sy = [double]$crop.y + [Math]::Round(($ey * $ratioY), [System.MidpointRounding]::AwayFromZero)
    $surface = $frame.surface
    $dx = [double]$surface.x + $sx
    $dy = [double]$surface.y + $sy
    return @{
        ok      = $true
        desktopX = [double]$dx
        desktopY = [double]$dy
        surfaceX = [double]$sx
        surfaceY = [double]$sy
        mapping = $mapping
        note    = $note
    }
}

function Assert-FrameContentFresh($frame, [bool]$verify) {
    # The content check as a refusal string, or $null when there is nothing to say. Kept next to
    # the check itself so the two call sites (a window frame and a screen frame) cannot drift.
    if (-not $verify) { return $null }
    $content = Test-FrameContentUnchanged $frame
    if ($content.checked -ne $true -or $content.changed -ne $true) { return $null }
    return "[FRAME_CONTENT_CHANGED] frame $($frame.id) was taken $($content.ageMs) ms ago and the surface it came from does not look the same any more: its rectangle is unchanged but the pixels are not, which is what a scroll, a refresh or a navigation looks like. A coordinate from that image would land on whatever is there now. Take a new capture and read the panel again, act on a control by ref (a ref is re-resolved before it is used), or pass verify_content: false when this surface is simply animated. (action_sent=false, recovery=computer_screenshot)"
}

function Test-FrameLive([string]$frameId, [object]$Options = $null) {
    # Is this frame still the thing it was? -- asked with no point involved.
    #
    # Split out of Resolve-FramePoint (§5.3). Once a gesture's points have been projected they
    # are *desktop* coordinates, so an in-flight check cannot go through a function whose input
    # is an image pixel: the drag used to hand desktop waypoints back to Resolve-FramePoint,
    # which projected them a second time. A perfectly usable frame then failed a bounds test and
    # was reported as stale, while a frame that had really changed could still pass, because the
    # second projection had moved the point somewhere that existed. Every input point is
    # projected exactly once, before the button goes down; from then on only the frame, the
    # window, its geometry and its content are checked.
    # @returns @{ ok; error; frame; screen; rect; windowRect; drift }.
    $frame = $script:FrameRegistry[$frameId]
    if ($null -eq $frame) {
        return @{ ok = $false; error = "[EXPIRED_FRAME] frame '$frameId' is not in this worker's registry: it was taken before the worker restarted, or it has been retired. Take a new capture. (action_sent=false, element_lookup=n/a, recovery=computer_screenshot, auto_reresolve=false)" }
    }
    $verifyContent = $true
    if ($null -ne $Options -and $Options.verifyContent -eq $false) { $verifyContent = $false }
    if ([int64]$frame.hwnd -eq 0) {
        # A screen frame is a window onto the desktop: its origin only means something
        # while the desktop has the shape it had. Unplugging a monitor, changing a
        # resolution or a scale factor re-letters the same pixel.
        $vb = Get-VirtualBounds
        if ($vb.x -ne [int]$frame.vx -or $vb.y -ne [int]$frame.vy -or $vb.width -ne [int]$frame.vwidth -or $vb.height -ne [int]$frame.vheight) {
            return @{ ok = $false; error = "[DISPLAY_TOPOLOGY_CHANGED] the display layout changed since frame $frameId was taken: the virtual desktop was ($($frame.vx),$($frame.vy)) $($frame.vwidth)x$($frame.vheight) then and is ($($vb.x),$($vb.y)) $($vb.width)x$($vb.height) now, so this frame's pixels no longer map to those screen coordinates. Take a new capture. (action_sent=false, recovery=computer_screenshot)" }
        }
        # A screen frame's pixels are physical pixels of the desktop, so a change of the
        # system's scale factor re-letters them even when the layout's rectangle is identical.
        if ([int]$frame.dpi -gt 0) {
            $liveDpi = Get-WindowDpi 0
            if ($liveDpi -gt 0 -and $liveDpi -ne [int]$frame.dpi) {
                return @{ ok = $false; error = "[DPI_CHANGED] the system is at $liveDpi dpi now and was at $([int]$frame.dpi) dpi when frame $frameId was taken, so this frame's pixels map to a different scale. Take a new capture. (action_sent=false, recovery=computer_screenshot)" }
            }
        }
        # A screen frame can go stale in a way geometry cannot see: the desktop under those
        # coordinates can have scrolled, refreshed or navigated away since the capture.
        $stale = Assert-FrameContentFresh $frame $verifyContent
        if ($null -ne $stale) { return @{ ok = $false; error = $stale } }
        return @{ ok = $true; frame = $frame; screen = $true; rect = $null; windowRect = $null; drift = 0 }
    }
    # The frame was a window: check the window is still the one that was captured.
    $hwnd = [IntPtr][int64]$frame.hwnd
    if (-not [DshNative]::IsWindow($hwnd)) {
        return @{ ok = $false; error = "[EXPIRED_FRAME] the window frame $frameId was taken from (hwnd $($frame.hwnd)) is gone. Take a new capture. (action_sent=false, recovery=computer_screenshot)" }
    }
    $live = Get-WindowInfoForHwnd $hwnd
    if ([int]$frame.pid -gt 0 -and [int]$live.pid -ne [int]$frame.pid) {
        return @{ ok = $false; error = "[TARGET_CHANGED] hwnd $($frame.hwnd) belonged to pid $($frame.pid) when frame $frameId was taken and belongs to pid $($live.pid) now -- the handle was reused. Take a new capture. (action_sent=false, recovery=computer_screenshot)" }
    }
    # The handle still answers with the same pid -- but a pid is not a process. A recycled handle
    # whose new owner happens to reuse the pid passes that check, so the process's *creation
    # time* is compared as well. And a window can be dragged to a monitor with another scale
    # factor without its rectangle changing at all: the DPI says whether its pixels still mean
    # what they meant.
    if ([int64]$frame.processStart -gt 0) {
        $liveStart = Get-ProcessStartTicks ([int]$frame.pid)
        if ($liveStart -gt 0 -and $liveStart -ne [int64]$frame.processStart) {
            return @{ ok = $false; error = "[TARGET_CHANGED] hwnd $($frame.hwnd) still reports pid $($frame.pid), but that pid now belongs to a different process (it started at another time than the one frame $frameId was taken from), so the handle was recycled. Take a new capture. (action_sent=false, recovery=computer_screenshot)" }
        }
    }
    if ([int]$frame.dpi -gt 0) {
        $liveDpi = Get-WindowDpi ([int64]$frame.hwnd)
        if ($liveDpi -gt 0 -and $liveDpi -ne [int]$frame.dpi) {
            return @{ ok = $false; error = "[DPI_CHANGED] hwnd $($frame.hwnd) is being rendered at $liveDpi dpi now and was at $([int]$frame.dpi) dpi when frame $frameId was taken, so the pixels in that image sit at a different scale even though the window's rectangle is unchanged (this is what dragging a window onto a monitor with another scale factor looks like). Take a new capture. (action_sent=false, recovery=computer_screenshot)" }
        }
    }
    $rect = Get-WindowRectInfo $hwnd
    if ($null -eq $rect) {
        return @{ ok = $false; error = "[EXPIRED_FRAME] hwnd $($frame.hwnd) has no usable rectangle any more, so frame $frameId cannot be projected. Take a new capture. (action_sent=false, recovery=computer_screenshot)" }
    }
    $frameRect = $frame.windowRect
    if ($null -eq $frameRect) { $frameRect = [ordered]@{ x = [int]$frame.x; y = [int]$frame.y; width = [int]$frame.width; height = [int]$frame.height } }
    $drift = [int][Math]::Max([Math]::Abs([int]$rect.x - [int]$frameRect.x), [Math]::Abs([int]$rect.y - [int]$frameRect.y))
    # Geometry change, case 1: the window was resized. The content reflowed, so no
    # arithmetic recovers what used to be at that pixel -- the honest answer is a new
    # observation, not a click at a point that happens to be inside.
    if ([int]$rect.width -ne [int]$frameRect.width -or [int]$rect.height -ne [int]$frameRect.height) {
        return @{ ok = $false; error = "[FRAME_STALE] the window was resized since frame $frameId was taken ($($frameRect.width)x$($frameRect.height) then, $($rect.width)x$($rect.height) now), so the pixels in that image no longer sit where they did. Take a new capture. (action_sent=false, recovery=computer_screenshot)" }
    }
    # A window can change its contents without moving, resizing or changing DPI: scrolling
    # inside it, a list that refreshes itself, a page that navigates. The frame carries what the
    # surface looked like, and an old frame is compared against what it looks like now.
    $stale = Assert-FrameContentFresh $frame $verifyContent
    if ($null -ne $stale) { return @{ ok = $false; error = $stale } }
    return @{ ok = $true; frame = $frame; screen = $false; rect = $rect; windowRect = $frameRect; drift = $drift }
}

function Resolve-FramePoint([string]$frameId, [int]$px, [int]$py, [object]$Options = $null) {
    # Image pixels in, screen pixels out -- projected, then *guarded*: the frame and the window
    # it came from are checked once by Test-FrameLive, and what is actually under the projected
    # point is read before anything is dispatched. Returns a refusal rather than a coordinate
    # whenever the frame can no longer be trusted.
    $frame = $script:FrameRegistry[$frameId]
    if ($null -eq $frame) {
        return @{ ok = $false; error = "[EXPIRED_FRAME] frame '$frameId' is not in this worker's registry: it was taken before the worker restarted, or it has been retired. Take a new capture. (action_sent=false, element_lookup=n/a, recovery=computer_screenshot, auto_reresolve=false)" }
    }
    # Which image is the caller measuring in: the one the host delivered when that is known,
    # otherwise the one this worker encoded (the two are the same unless the attachment
    # layer resized it, and it says so when it does).
    $boundW = [int]$frame.encoded.width
    $boundH = [int]$frame.encoded.height
    if ($null -ne $frame.attached -and $frame.attached.reported -eq $true) {
        if ([int]$frame.attached.width -gt 0) { $boundW = [int]$frame.attached.width }
        if ([int]$frame.attached.height -gt 0) { $boundH = [int]$frame.attached.height }
    }
    # A request that names a window may allow specific transitions (a dialog it is willing
    # to land on), may allow one bounded attempt at bringing the target forward, and may ask
    # for the content check to be skipped (a surface that is simply animated).
    $allowWindows = $null
    $allowActivate = $false
    $verifyContent = $true
    if ($null -ne $Options) {
        if ($null -ne $Options.allowWindows) { $allowWindows = $Options.allowWindows }
        if ($Options.allowActivate -eq $true) { $allowActivate = $true }
        if ($Options.verifyContent -eq $false) { $verifyContent = $false }
    }
    if ($px -lt 0 -or $py -lt 0 -or $px -ge $boundW -or $py -ge $boundH) {
        return @{ ok = $false; error = "[BAD_REQUEST] ($px,$py) is outside frame $frameId, whose image is ${boundW}x${boundH} px. Note the origin: this is a boundary coordinate in the image you were shown, not a screen coordinate. (action_sent=false)" }
    }
    $projected = Get-FrameTransform $frame ([double]$px) ([double]$py)
    if ($projected.ok -ne $true) { return @{ ok = $false; error = "$($projected.error)" } }
    $x = [int][Math]::Floor($projected.desktopX)
    $y = [int][Math]::Floor($projected.desktopY)
    $mapping = "$($projected.mapping)"
    $drift = 0
    $note = "$($projected.note)"
    $guard = $null
    # The frame and the window it came from, checked once, without involving this point
    # (§5.3): the projection above is the only conversion this coordinate ever gets.
    $live = Test-FrameLive $frameId $Options
    if ($live.ok -ne $true) { return @{ ok = $false; error = "$($live.error)" } }
    if ($live.screen -eq $true) {
        # No window identity: the landing point is reported but nothing is compared against
        # a target, because this frame never named one.
        $guard = Test-LandingGuard 0 0 $x $y $null
        return @{ ok = $true; x = $x; y = $y; drift = 0; note = $note; guard = $guard; mapping = $mapping; activated = $false; frame = $frame }
    }
    $rect = $live.rect
    $frameRect = $live.windowRect
    $drift = [int]$live.drift
    if ($drift -gt 0) {
        # Geometry change, case 2: the window moved. Its content moved with it, so the
        # correct projection is the same offset from the window's new origin -- and then the
        # point is checked against what is actually there.
        $x = $x + ([int]$rect.x - [int]$frameRect.x)
        $y = $y + ([int]$rect.y - [int]$frameRect.y)
        $note = "the window moved ${drift}px since this frame was taken; the point was re-projected to the window's new position"
    } elseif (-not (($x -ge $rect.x) -and ($x -lt ($rect.x + $rect.width)) -and ($y -ge $rect.y) -and ($y -lt ($rect.y + $rect.height)))) {
        # No movement, yet the point falls outside: the frame's rectangle and the window's
        # no longer describe the same thing, so the projection is wrong for a reason this
        # code cannot see.
        return @{ ok = $false; error = "[FRAME_STALE] ($x,$y) -- the projection of image point ($px,$py) -- is not inside hwnd $($frame.hwnd) (now at $($rect.x),$($rect.y) $($rect.width)x$($rect.height)), although the window has not moved. Take a new capture. (action_sent=false, recovery=computer_screenshot)" }
    }
    # The landing guard runs for every coordinate write (A05): a still window that has been
    # covered by another application used to take the input, because the check lived inside
    # the "the window moved" branch.
    $guard = Test-LandingGuard ([int64]$frame.hwnd) ([int]$frame.pid) $x $y $allowWindows
    $activated = $false
    if ($guard.ok -ne $true -and $allowActivate) {
        # One bounded attempt at recovery (方案 §3.3 第 5 条): bring the target forward and then
        # *look again* rather than assuming the activation worked -- SetForegroundWindow is
        # subject to the system's own rules and can quietly do nothing. Exactly one attempt: a
        # recovery that keeps trying is a recovery that hides the problem, and the receipt says
        # whether the point was allowed after it.
        $brought = $false
        try { $brought = [DshNative]::ForceForeground([IntPtr][int64]$frame.hwnd) } catch { $brought = $false }
        if ($brought) {
            Start-Sleep -Milliseconds 120
            $second = Test-LandingGuard ([int64]$frame.hwnd) ([int]$frame.pid) $x $y $allowWindows
            if ($second.ok -eq $true) {
                $guard = $second
                $activated = $true
                $note = "$note; the target window was brought forward once (allow_activate) and the landing point was checked again".TrimStart(';', ' ')
            } else {
                $note = "$note; the target window was brought forward once (allow_activate) and ($x,$y) was still over hwnd $($second.hit.hwnd), pid $($second.hit.pid)".TrimStart(';', ' ')
            }
        }
    }
    if ($guard.ok -ne $true) {
        return @{ ok = $false; error = "$($guard.reason)" }
    }
    if ("$($guard.note)" -ne '') {
        $note = "$note; $($guard.note)".TrimStart(';', ' ')
    }
    return @{ ok = $true; x = $x; y = $y; drift = $drift; note = $note; guard = $guard; mapping = $mapping; activated = $activated; frame = $frame }
}

function Get-FrameReceipt($frame, [int]$px, [int]$py, [int]$x, [int]$y, [int]$drift, [string]$note, [object]$guard = $null, [string]$mapping = '', [bool]$activated = $false) {
    $receipt = [ordered]@{
        id        = "$($frame.id)"
        fromImage = [ordered]@{ x = $px; y = $py }
        projected = [ordered]@{ x = $x; y = $y }
        scale     = [double]$frame.effectiveScale
        source    = "$($frame.source)"
    }
    if ([double]$frame.requestedScale -ne [double]$frame.effectiveScale) { $receipt.scaleRequested = [double]$frame.requestedScale }
    if ($mapping -ne '') { $receipt.mapping = $mapping }
    if ($drift -gt 0) { $receipt.drift = $drift }
    if ($activated) { $receipt.recovered = $true }
    if ($note -ne '') { $receipt.note = $note }
    if ($null -ne $guard) {
        $receipt.guard = "$($guard.how)"
        if ($null -ne $guard.hit) {
            $receipt.landing = [ordered]@{ hwnd = [int64]$guard.hit.hwnd; root = [int64]$guard.hit.root; pid = [int]$guard.hit.pid }
        }
    }
    return $receipt
}
function Do-Click([object]$Arg) {
    # Nothing is sent to the desktop once the call's budget is gone (§5.7): the refusal lands
    # before the button goes down, so a spent call cannot still move the pointer or click.
    Assert-CanSend 'before the click'
    $x = [int]$Arg.x
    $y = [int]$Arg.y
    $frameReceipt = $null
    if ($null -ne $Arg.fromFrame -and "$($Arg.fromFrame)" -ne '') {
        $resolved = Resolve-FramePoint ([string]$Arg.fromFrame) $x $y ([ordered]@{ allowActivate = ($Arg.allowActivate -eq $true); verifyContent = $Arg.verifyContent; allowWindows = $Arg.allowWindows })
        if (-not $resolved.ok) { throw $resolved.error }
        $frameReceipt = Get-FrameReceipt $resolved.frame $x $y $resolved.x $resolved.y $resolved.drift $resolved.note $resolved.guard $resolved.mapping $resolved.activated
        $x = [int]$resolved.x
        $y = [int]$resolved.y
    }
    $clicks = 1
    if ($null -ne $Arg.clicks) { $clicks = [int]$Arg.clicks }
    if ($clicks -lt 1) { $clicks = 1 }
    if ($clicks -gt 3) { $clicks = 3 }
    $button = "$($Arg.button)"
    if ([string]::IsNullOrWhiteSpace($button)) { $button = 'left' }
    $modifierChord = "$($Arg.modifiers)"
    $modifierVks = @()
    if ($modifierChord -ne '') { $modifierVks = Get-KeyVkList $modifierChord }
    $preferA11y = ($Arg.preferA11y -ne $false)

    # a11y-first covers the plain single left click only. A chorded click or a double
    # click is a pointer gesture by definition, and there is no accessibility
    # equivalent to fall back on.
    if ($preferA11y -and $clicks -eq 1 -and $button -eq 'left' -and $modifierVks.Count -eq 0) {
        $target = $null
        try { $target = Get-PressableElementAtPoint $x $y } catch { $target = $null }
        if ($null -ne $target) {
            $p = $null
            if ($target.element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {
                ([System.Windows.Automation.InvokePattern]$p).Invoke()
                Set-WriteStamp -What 'click (a11y)'
                Start-Sleep -Milliseconds 60
                $a11yValue = [ordered]@{
                    x      = $x
                    y      = $y
                    clicks = 1
                    button = 'left'
                    events = 0
                    via    = 'a11y'
                    element = [ordered]@{
                        name         = $target.name
                        controlType  = $target.controlType
                        automationId = $target.automationId
                    }
                }
                if ($null -ne $frameReceipt) { $a11yValue.frame = $frameReceipt }
                return $a11yValue
            }
        }
    }

    if ($modifierVks.Count -gt 0) { [void](Send-Modifiers $modifierVks $true) }
    try {
        Do-MouseMove $x $y $true
        $flags = Get-ButtonFlags $button
        $events = @()
        for ($i = 0; $i -lt $clicks; $i++) {
            $events += [DshNative]::Mouse(0, 0, 0, $flags[0])
            $events += [DshNative]::Mouse(0, 0, 0, $flags[1])
        }
        $sent = [DshNative]::Send($events)
        $delivery = Assert-InputDelivered $sent $events.Count "the click ($clicks press/release pair(s))" 'the click'
    } finally {
        # Released in a finally: a modifier left down because the click threw would
        # change the meaning of everything the caller does next.
        if ($modifierVks.Count -gt 0) { [void](Send-Modifiers $modifierVks $false) }
    }
    Set-WriteStamp -What 'click'
    $value = [ordered]@{ x = $x; y = $y; clicks = $clicks; button = $button; events = $sent; via = 'mouse' }
    if ($modifierChord -ne '') { $value.modifiers = $modifierChord }
    if ($null -ne $frameReceipt) { $value.frame = $frameReceipt }
    return $value
}

function Do-Drag([object]$Arg) {
    # A drag is the longest input there is, and the deadline is checked before the button goes
    # down *and* at every waypoint -- a gesture that is stopped half way always lets go (§5.7).
    Assert-CanSend 'before the drag'
    $sx = [int]$Arg.fromX
    $sy = [int]$Arg.fromY
    $ex = [int]$Arg.toX
    $ey = [int]$Arg.toY

    # ---------------------------------------------------------------- continuation (§8 后半)
    #
    # "从刚才那里再画一段"：起点取上一次拖拽的落点，省掉重新定位的往返。句柄由后端持有、带有效期，
    # 过期或不匹配时**明确拒绝**（DRAG_HANDLE_MISSING / DRAG_HANDLE_STALE），绝不猜一个附近的点接着画；
    # 拒绝发生在任何输入发出之前（action_sent=false）。
    $fromLast = ($null -ne $Arg.fromLast) -and ($Arg.fromLast -eq $true -or "$($Arg.fromLast)" -eq 'true')
    $continueFrom = ''
    if ($null -ne $Arg.continueFrom) { $continueFrom = "$($Arg.continueFrom)" }
    if ($fromLast -or $continueFrom -ne '') {
        $handle = Get-DragHandle $continueFrom
        if (-not $handle.ok) {
            throw "[$($handle.code)] cannot continue from the last drag: $($handle.note). (action_sent=false, recovery=computer_screenshot, auto_reresolve=false)"
        }
        $sx = [int]$handle.handle.x
        $sy = [int]$handle.handle.y
    }

    # ---------------------------------------------------------------- path form (§8)
    #
    # A path is a shape, not a straight line: drawing, walking around an obstacle, or a
    # selection that has to pass through a particular cell. It is normalised before anything
    # moves -- duplicates dropped, count capped -- because every point has to be projected
    # and guarded *before the button goes down*: a gesture that discovers a bad point half
    # way through has already dragged something somewhere.
    $path = @()
    if ($null -ne $Arg.path) {
        foreach ($point in @($Arg.path)) {
            $px = Get-ArgMember $point 'x'
            $py = Get-ArgMember $point 'y'
            if ($null -eq $px -or $null -eq $py) { throw "[BAD_REQUEST] every point of a drag path needs x and y" }
            $path += [ordered]@{ x = [int]$px; y = [int]$py }
        }
        if ($path.Count -lt 2) { throw "[BAD_REQUEST] a drag path needs at least two points (got $($path.Count))" }
        if ($path.Count -gt 64) { throw "[BAD_REQUEST] a drag path takes at most 64 points (got $($path.Count)); simplify it -- a path is sampled smoothly, so vertices every few pixels are not needed" }
        $deduped = @()
        foreach ($point in $path) {
            if ($deduped.Count -gt 0 -and [int]$deduped[$deduped.Count - 1].x -eq [int]$point.x -and [int]$deduped[$deduped.Count - 1].y -eq [int]$point.y) { continue }
            $deduped += $point
        }
        if ($deduped.Count -lt 2) { throw "[BAD_REQUEST] the drag path collapses to one point once consecutive duplicates are removed, so there is nothing to drag" }
        $path = $deduped
    }
    $durationMs = 400
    if ($null -ne $Arg.durationMs -and "$($Arg.durationMs)" -ne '') {
        $durationMs = [int]$Arg.durationMs
        if ($durationMs -lt 100) { $durationMs = 100 }
        if ($durationMs -gt 5000) { $durationMs = 5000 }
    }

    # Both ends of a gesture can be given in the image coordinates of a capture, on the
    # same terms as a click. Both are projected before anything moves, so a stale or
    # resized frame refuses the whole gesture instead of half-executing it -- and for a
    # path, every point is projected with the frame checked once for the whole gesture.
    $frameReceipt = $null
    $frameId = ''
    if ($path.Count -gt 0 -and $null -ne $Arg.fromFrame -and "$($Arg.fromFrame)" -ne '') {
        $projected = @()
        foreach ($point in $path) {
            $resolved = Resolve-FramePoint ([string]$Arg.fromFrame) ([int]$point.x) ([int]$point.y) ([ordered]@{ allowActivate = ($Arg.allowActivate -eq $true); verifyContent = $Arg.verifyContent; allowWindows = $Arg.allowWindows })
            if (-not $resolved.ok) { throw $resolved.error }
            if ($null -eq $frameReceipt) {
                $frameReceipt = Get-FrameReceipt $resolved.frame ([int]$point.x) ([int]$point.y) ([int]$resolved.x) ([int]$resolved.y) ([int]$resolved.drift) "$($resolved.note)" $resolved.guard "$($resolved.mapping)" ([bool]$resolved.activated)
                $frameId = [string]$resolved.frame.id
            }
            $projected += [ordered]@{ x = [int]$resolved.x; y = [int]$resolved.y }
        }
        $path = $projected
    } elseif ($null -ne $Arg.fromFrame -and "$($Arg.fromFrame)" -ne '') {
        $start = Resolve-FramePoint ([string]$Arg.fromFrame) $sx $sy ([ordered]@{ allowActivate = ($Arg.allowActivate -eq $true); verifyContent = $Arg.verifyContent; allowWindows = $Arg.allowWindows })
        if (-not $start.ok) { throw $start.error }
        $finish = Resolve-FramePoint ([string]$Arg.fromFrame) $ex $ey ([ordered]@{ allowActivate = ($Arg.allowActivate -eq $true); verifyContent = $Arg.verifyContent; allowWindows = $Arg.allowWindows })
        if (-not $finish.ok) { throw $finish.error }
        $frameReceipt = Get-FrameReceipt $start.frame $sx $sy $start.x $start.y $start.drift $start.note $start.guard $start.mapping $start.activated
        $frameId = [string]$start.frame.id
        $sx = [int]$start.x
        $sy = [int]$start.y
        $ex = [int]$finish.x
        $ey = [int]$finish.y
    }

    $steps = 12
    if ($null -ne $Arg.steps) { $steps = [Math]::Max(2, [int]$Arg.steps) }
    # A drag has no accessibility equivalent (the reference says the same), so a
    # modifier held across the gesture is the only way to express things like
    # shift-drag or ctrl-drag.
    $modifierChord = "$($Arg.modifiers)"
    $modifierVks = @()
    if ($modifierChord -ne '') { $modifierVks = Get-KeyVkList $modifierChord }

    # What the gesture walks once the button is down, and how long it spends between
    # waypoints. The straight line keeps its old `steps` interpolation; a path is sampled by
    # arc length over its whole duration, so a long segment and a short one both get the
    # motion they need instead of each segment paying the same fixed wait (§8).
    $waypoints = @()
    $paceMs = 12
    $sampleCount = 0
    if ($path.Count -gt 1) {
        $lengths = @()
        $total = 0.0
        for ($i = 1; $i -lt $path.Count; $i++) {
            $segmentLength = [Math]::Sqrt([Math]::Pow([int]$path[$i].x - [int]$path[$i - 1].x, 2) + [Math]::Pow([int]$path[$i].y - [int]$path[$i - 1].y, 2))
            $lengths += $segmentLength
            $total += $segmentLength
        }
        # One sample about every 4 px, never fewer than the vertices themselves, never more
        # than 240: beyond that the extra events buy nothing an application can see.
        $sampleCount = [int][Math]::Ceiling($total / 4.0)
        if ($sampleCount -lt ($path.Count - 1)) { $sampleCount = $path.Count - 1 }
        if ($sampleCount -gt 240) { $sampleCount = 240 }
        if ($sampleCount -lt 2) { $sampleCount = 2 }
        $stepDistance = 0.0
        if ($sampleCount -gt 0) { $stepDistance = $total / $sampleCount }
        $samples = @($path[0])
        $segment = 0
        $walked = 0.0
        for ($i = 1; $i -le $sampleCount; $i++) {
            $target = $stepDistance * $i
            while ($segment -lt ($path.Count - 1) -and ($walked + $lengths[$segment]) -lt $target) {
                $walked += $lengths[$segment]
                $segment++
            }
            if ($segment -ge ($path.Count - 1)) {
                $samples += $path[$path.Count - 1]
                continue
            }
            $into = $target - $walked
            $ratio = 0.0
            if ($lengths[$segment] -gt 0) { $ratio = $into / $lengths[$segment] }
            $sampleX = [int][Math]::Round([int]$path[$segment].x + ([int]$path[$segment + 1].x - [int]$path[$segment].x) * $ratio)
            $sampleY = [int][Math]::Round([int]$path[$segment].y + ([int]$path[$segment + 1].y - [int]$path[$segment].y) * $ratio)
            $samples += [ordered]@{ x = $sampleX; y = $sampleY }
        }
        $waypoints = @($samples | Select-Object -Skip 1)
        $paceMs = [int][Math]::Max(1, [Math]::Round($durationMs / [Math]::Max(1, $samples.Count)))
        $sx = [int]$path[0].x
        $sy = [int]$path[0].y
        $ex = [int]$path[$path.Count - 1].x
        $ey = [int]$path[$path.Count - 1].y
    } else {
        for ($i = 1; $i -le $steps; $i++) {
            $waypoints += [ordered]@{ x = [int]($sx + (($ex - $sx) * $i / $steps)); y = [int]($sy + (($ey - $sy) * $i / $steps)) }
        }
    }

    if ($modifierVks.Count -gt 0) { [void](Send-Modifiers $modifierVks $true) }
    try {
        Do-MouseMove $sx $sy $true
        [void][DshNative]::Send(@([DshNative]::Mouse(0, 0, 0, [DshNative]::MOUSEEVENTF_LEFTDOWN)))
        # Registered before the move loop so that any failure below -- or a worker
        # killed mid-drag -- is unwound by Release-HeldInput instead of leaving the
        # user with a mouse button the system still believes is down.
        Add-HeldButton ([uint32][DshNative]::MOUSEEVENTF_LEFTDOWN)
        try {
            Start-Sleep -Milliseconds 40
            $travelled = 0
            foreach ($waypoint in $waypoints) {
                $travelled++
                # A drag is the one gesture where cancelling half way matters most:
                # stopping it leaves the button down unless the release below runs.
                Assert-NotCancelled "during the drag (step $travelled of $($waypoints.Count))"
                # The window the gesture was projected against has to still be there: a
                # window that closed mid-drag turns the rest of the path into coordinates on
                # whatever is behind it (§8 asks for the target to be checked while it runs).
                #
                # What is checked here is the *frame*, not a point (§5.3): `$waypoint` is
                # already a desktop coordinate, so it must not go back through the image-space
                # resolver -- that projected it a second time, and a live frame on a scaled or
                # offset window was refused as stale while a changed frame could slip through.
                if ($frameId -ne '' -and ($travelled % 12) -eq 0) {
                    $liveCheck = $null
                    try { $liveCheck = Test-FrameLive $frameId ([ordered]@{ verifyContent = $false; allowWindows = $Arg.allowWindows }) } catch { $liveCheck = $null }
                    if ($null -eq $liveCheck -or -not $liveCheck.ok) {
                        $why = 'the frame the drag was projected against is no longer usable'
                        if ($null -ne $liveCheck) { $why = "$($liveCheck.error)" }
                        throw "[FRAME_STALE] $why -- the drag was stopped at waypoint $travelled of $($waypoints.Count) rather than continuing onto whatever is behind it. (action_sent=true)"
                    }
                }
                Do-MouseMove ([int]$waypoint.x) ([int]$waypoint.y)
                Start-Sleep -Milliseconds $paceMs
            }
        } finally {
            # The release belongs in the finally, not after the loop. When a move step
            # threw, the old code jumped straight to forgetting the button was held --
            # so the mouse stayed down with nothing left that knew to lift it, and the
            # user had to click to shake it off. The record is dropped only once the
            # release has actually been sent, so a failed release can still be retried
            # by `release` or by process exit.
            $released = $false
            try { $released = ([DshNative]::Send(@([DshNative]::Mouse(0, 0, 0, [DshNative]::MOUSEEVENTF_LEFTUP))) -gt 0) } catch { $released = $false }
            if ($released) { Remove-HeldButton ([uint32][DshNative]::MOUSEEVENTF_LEFTDOWN) }
        }
    } finally {
        if ($modifierVks.Count -gt 0) { [void](Send-Modifiers $modifierVks $false) }
    }
    Set-WriteStamp -What 'drag'
# 8.txt §8 后半：把这次拖拽的落点记进句柄，供下一次用 continue_from/from_last 接着画（过期即失效）。
# 窗口暂时不记（0 = 未知）：句柄的"换窗口要拒绝"要等续画侧的读取实现后一起接上，见台账 §4.1。
[void]($script:LastDrag = Set-DragHandle -x $ex -y $ey)
    $value = [ordered]@{ from = [ordered]@{ x = $sx; y = $sy }; to = [ordered]@{ x = $ex; y = $ey }; steps = $steps }
    if ($path.Count -gt 1) {
        $value['path'] = [ordered]@{ points = $path.Count; samples = $sampleCount; durationMs = $durationMs; paceMs = $paceMs }
    }
    if ($modifierChord -ne '') { $value.modifiers = $modifierChord }
    if ($null -ne $frameReceipt) { $value.frame = $frameReceipt }
    # 8.txt §8 后半：把句柄 id 交给调用方 —— 下一次要"接着画"就引用它（或直接 from_last）。
    if ($null -ne $script:LastDrag) { $value['handle'] = "$($script:LastDrag.id)" }
    return $value
}

function Do-Scroll([object]$Arg) {
    Assert-CanSend 'before the scroll'
    $horizontal = $false
    if ($null -ne $Arg.horizontal) { $horizontal = [bool]$Arg.horizontal }
    $clicks = 3
    if ($null -ne $Arg.clicks) { $clicks = [int]$Arg.clicks }
    if ($clicks -lt 0) { $clicks = 0 }
    # 100 notches is the reference range; each notch is the hardware's one wheel
    # detent (120 units), not a page or a percentage.
    if ($clicks -gt 100) { $clicks = 100 }
    if ($clicks -eq 0) { return [ordered]@{ direction = "$($Arg.direction)"; clicks = 0; horizontal = $false; delta = 0; events = 0 } }
    $dir = "$($Arg.direction)"
    $sign = 1
    if ($dir -eq 'down' -or $dir -eq 'right' -or $dir -eq 'forward') { $sign = -1 }
    # The wheel goes to whatever is under the pointer, so a scroll that names a frame
    # takes its pointer position from that image on exactly the same terms as a click.
    # One coordinate protocol for click, drag and scroll, rather than a different one
    # per tool.
    $mx = $Arg.x
    $my = $Arg.y
    $frameReceipt = $null
    if ($null -ne $Arg.fromFrame -and "$($Arg.fromFrame)" -ne '') {
        if ($null -eq $mx -or $null -eq $my) { throw "[BAD_REQUEST] a scroll with from_frame needs x and y as image pixels of that frame" }
        $resolved = Resolve-FramePoint ([string]$Arg.fromFrame) ([int]$mx) ([int]$my) ([ordered]@{ allowActivate = ($Arg.allowActivate -eq $true); verifyContent = $Arg.verifyContent; allowWindows = $Arg.allowWindows })
        if (-not $resolved.ok) { throw $resolved.error }
        $frameReceipt = Get-FrameReceipt $resolved.frame ([int]$mx) ([int]$my) $resolved.x $resolved.y $resolved.drift $resolved.note $resolved.guard $resolved.mapping $resolved.activated
        $mx = [int]$resolved.x
        $my = [int]$resolved.y
    }
    if ($null -ne $mx -and $null -ne $my) { Do-MouseMove ([int]$mx) ([int]$my) $true }
    $delta = [int](120 * $clicks * $sign)
    $flag = [DshNative]::MOUSEEVENTF_WHEEL
    if ($horizontal) { $flag = [DshNative]::MOUSEEVENTF_HWHEEL }
    $events = @()
    for ($i = 0; $i -lt $clicks; $i++) { $events += [DshNative]::Mouse(0, 0, [uint32]([int64](120 * $sign) -band 0xFFFFFFFFL), $flag) }
    $sent = [DshNative]::Send($events)
    $delivery = Assert-InputDelivered $sent $events.Count "the scroll ($clicks wheel step(s))" 'the scroll'
    Set-WriteStamp -What 'scroll'
    $value = [ordered]@{ direction = $dir; clicks = $clicks; horizontal = $horizontal; delta = $delta; events = $sent }
    if ($null -ne $frameReceipt) { $value.frame = $frameReceipt }
    return $value
}

function Do-Type([object]$Arg) {
    Assert-CanSend 'before typing'
    $text = [string]$Arg.text
    if ([string]::IsNullOrEmpty($text)) { return [ordered]@{ typed = 0; skipped = @() } }
    Assert-ExpectedForeground $Arg.intoHwnd 'typing'
    $foreground = Assert-InjectableForeground 'typing'
    $delay = 0
    if ($null -ne $Arg.delayMs) { $delay = [int]$Arg.delayMs }
    $events = New-Object System.Collections.Generic.List[DshNative+INPUT]
    $count = 0
    $skipped = @()
    foreach ($ch in $text.ToCharArray()) {
        $code = [int][char]$ch
        if ($code -eq 13) { continue }
        if ($code -eq 10 -or $code -eq 9) {
            $vk = 0x0D
            if ($code -eq 9) { $vk = 0x09 }
            $events.Add([DshNative]::Key([uint16]$vk, 0, 0))
            $events.Add([DshNative]::Key([uint16]$vk, 0, [DshNative]::KEYEVENTF_KEYUP))
            $count++
            continue
        }
        $events.Add([DshNative]::Key(0, [uint16]$code, [DshNative]::KEYEVENTF_UNICODE))
        $events.Add([DshNative]::Key(0, [uint16]$code, ([DshNative]::KEYEVENTF_UNICODE -bor [DshNative]::KEYEVENTF_KEYUP)))
        $count++
    }
    if ($count -eq 0) { return [ordered]@{ typed = 0; skipped = $skipped } }
    # SendInput is atomic per call but a very large array can be refused, so chunk.
    $chunk = 240
    $all = $events.ToArray()
    $sent = 0
    $expectedEvents = $all.Length
    for ($i = 0; $i -lt $all.Length; $i += $chunk) {
        # One check per chunk, not per character: the point is that a cancel stops a
        # long paste within a few milliseconds, without paying a file stat per key.
        Assert-NotCancelled "while typing (character $i of $($all.Length / 2))"
        Assert-WithinDeadline "while typing (character $i of $($all.Length / 2))"
        $len = [Math]::Min($chunk, $all.Length - $i)
        $slice = New-Object DshNative+INPUT[] $len
        [Array]::Copy($all, $i, $slice, 0, $len)
        $sent += [DshNative]::Send($slice)
        if ($delay -gt 0) { Start-Sleep -Milliseconds $delay }
    }
    # Counted, not floored: a string that lost a chunk is a partial action, and the caller is
    # told how much of it arrived rather than being told "typed" (§6).
    $delivery = Assert-InputDelivered $sent $expectedEvents "typing $count character(s)" 'the typed text'
    Set-WriteStamp -What 'type' -Hwnd $Arg.intoHwnd
    return [ordered]@{ typed = $count; events = $sent; expectedEvents = $expectedEvents; skipped = $skipped; foreground = (Get-ForegroundInfo) }
}

function Get-KeyVkList([string]$chord) {
    # One chord parser, used by the key tool and by the modifiers a click can hold.
    if ([string]::IsNullOrWhiteSpace($chord)) { throw "a key chord such as 'ctrl+c' is required" }
    $parts = @($chord -split '\+' | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ -ne '' })
    $vks = @()
    foreach ($p in $parts) {
        if ($VK.ContainsKey($p)) { $vks += [int]$VK[$p]; continue }
        if ($p.Length -eq 1) { $vks += [int][char]([char]::ToUpperInvariant($p[0])); continue }
        throw "unknown key name '$p'"
    }
    if ($vks.Count -gt 8) { throw "a chord holds at most 8 keys; got $($vks.Count) in '$chord'" }
    return ,$vks
}

function Send-Modifiers([int[]]$vks, [bool]$down) {
    if ($null -eq $vks -or $vks.Count -eq 0) { return 0 }
    $events = New-Object System.Collections.Generic.List[DshNative+INPUT]
    $order = @($vks)
    if (-not $down) { [array]::Reverse($order) }
    foreach ($vk in $order) {
        $f = 0
        if (-not $down) { $f = [DshNative]::KEYEVENTF_KEYUP }
        if ($EXTENDED -contains $vk) { $f = $f -bor [DshNative]::KEYEVENTF_EXTENDEDKEY }
        $events.Add([DshNative]::Key([uint16]$vk, 0, [uint32]$f))
        if ($down) { Add-HeldKey $vk } else { Remove-HeldKey $vk }
    }
    $sent = [DshNative]::Send($events)
    # A modifier that only half goes down (or only half comes back up) is the worst partial
    # send there is: the next action would run with shift or ctrl silently held (§6).
    [void](Assert-InputDelivered $sent $events.Count "the modifier chord $(if ($down) { 'down' } else { 'up' })" 'the modifier')
    return $sent
}

function Do-Key([object]$Arg) {
    Assert-CanSend 'before the key press'
    $chord = [string]$Arg.keys
    $vks = Get-KeyVkList $chord
    Assert-ExpectedForeground $Arg.intoHwnd "the key press '$chord'"
    [void](Assert-InjectableForeground "the key press '$chord'")
    $repeat = 1
    # 1..100, the reference range: a repeat loop is a synchronous burst of SendInput
    # calls, so an unbounded count is a way to wedge the backend for minutes.
    if ($null -ne $Arg.repeat) { $repeat = [Math]::Min(100, [Math]::Max(1, [int]$Arg.repeat)) }
    $holdMs = 0
    if ($null -ne $Arg.holdMs) { $holdMs = [Math]::Min(10000, [Math]::Max(0, [int]$Arg.holdMs)) }
    if ($holdMs -gt 0) {
        # Hold: every key goes down, stays down for the requested time, then comes
        # up in reverse order. This is the only way to express "hold shift while
        # doing something else" or a long key repeat that the target app must see
        # as one continuous press.
        #
        # The 10 s cap is not arbitrary: it is what keeps the backend's longest
        # blocking operation shorter than the transport's default timeout, so a
        # direct backend caller can never have its request killed mid-hold.
        $down = New-Object System.Collections.Generic.List[DshNative+INPUT]
        foreach ($vk in $vks) {
            $f = 0
            if ($EXTENDED -contains $vk) { $f = [DshNative]::KEYEVENTF_EXTENDEDKEY }
            $down.Add([DshNative]::Key([uint16]$vk, 0, [uint32]$f))
        }
        $up = New-Object System.Collections.Generic.List[DshNative+INPUT]
        for ($i = $vks.Count - 1; $i -ge 0; $i--) {
            $f = [DshNative]::KEYEVENTF_KEYUP
            if ($EXTENDED -contains $vks[$i]) { $f = $f -bor [DshNative]::KEYEVENTF_EXTENDEDKEY }
            $up.Add([DshNative]::Key([uint16]$vks[$i], 0, [uint32]$f))
        }
        $sentDown = [DshNative]::Send($down.ToArray())
        # Half a chord held down is not "a key that was pressed": the caller is told how much
        # of it went down, and the release below still runs (§6).
        $deliveryDown = Assert-InputDelivered $sentDown $down.Count "the held key chord '$chord' (down)" 'the key hold'
        foreach ($vk in $vks) { Add-HeldKey $vk }
        try {
            # Sliced rather than one sleep: a cancel during a held key has to come up
            # through the finally, and a 10 s uninterruptible sleep would postpone it
            # for the whole hold.
            Wait-Cancellable $holdMs
        } finally {
            # Released even if the sleep is interrupted, because a key left down is
            # the one input state a user cannot recover from without a reboot. The
            # record is dropped only once the release was actually delivered.
            $sentUp = [DshNative]::Send($up.ToArray())
            if ($sentUp -gt 0) { foreach ($vk in $vks) { Remove-HeldKey $vk } }
        }
        $deliveryUp = Assert-InputDelivered $sentUp $up.Count "the held key chord '$chord' (release)" 'the key release'
        Set-WriteStamp -What 'key' -Hwnd $Arg.intoHwnd
        return [ordered]@{ keys = $chord; repeat = 1; heldMs = $holdMs; events = ($sentDown + $sentUp); foreground = (Get-ForegroundInfo) }
    }
    $events = New-Object System.Collections.Generic.List[DshNative+INPUT]
    for ($r = 0; $r -lt $repeat; $r++) {
        for ($i = 0; $i -lt $vks.Count - 1; $i++) {
            $f = 0
            if ($EXTENDED -contains $vks[$i]) { $f = [DshNative]::KEYEVENTF_EXTENDEDKEY }
            $events.Add([DshNative]::Key([uint16]$vks[$i], 0, [uint32]$f))
        }
        $last = $vks[$vks.Count - 1]
        $lf = 0
        if ($EXTENDED -contains $last) { $lf = [DshNative]::KEYEVENTF_EXTENDEDKEY }
        $events.Add([DshNative]::Key([uint16]$last, 0, [uint32]$lf))
        $events.Add([DshNative]::Key([uint16]$last, 0, [uint32]($lf -bor [DshNative]::KEYEVENTF_KEYUP)))
        for ($i = $vks.Count - 2; $i -ge 0; $i--) {
            $f = [DshNative]::KEYEVENTF_KEYUP
            if ($EXTENDED -contains $vks[$i]) { $f = $f -bor [DshNative]::KEYEVENTF_EXTENDEDKEY }
            $events.Add([DshNative]::Key([uint16]$vks[$i], 0, [uint32]$f))
        }
    }
    $sent = [DshNative]::Send($events.ToArray())
    $delivery = Assert-InputDelivered $sent $events.Count "the key press '$chord'" 'the key press'
    Set-WriteStamp -What 'key' -Hwnd $Arg.intoHwnd
    return [ordered]@{ keys = $chord; repeat = $repeat; heldMs = 0; events = $sent; foreground = (Get-ForegroundInfo) }
}

# The clipboard is a single global object guarded by a lock the whole desktop
# shares, so any other process holding it open makes these calls fail with
# "cannot open clipboard" -- an ordinary, transient condition, not an error.
$CLIPBOARD_ATTEMPTS = 6
$CLIPBOARD_RETRY_MS = 40
$CLIPBOARD_MAX_CHARS = 200000

function Get-ClipboardText {
    $last = $null
    for ($i = 0; $i -lt $CLIPBOARD_ATTEMPTS; $i++) {
        try { return [string](Get-Clipboard -Raw -ErrorAction Stop) } catch { $last = $_ }
        Start-Sleep -Milliseconds $CLIPBOARD_RETRY_MS
    }
    throw "the clipboard is held open by another application and could not be read ($($last.Exception.Message))"
}

function Set-ClipboardText([string]$text) {
    $last = $null
    for ($i = 0; $i -lt $CLIPBOARD_ATTEMPTS; $i++) {
        try {
            # Set-Clipboard refuses an empty string ("value cannot be null"), so
            # clearing goes through the same WinForms call the cmdlet wraps.
            if ([string]::IsNullOrEmpty($text)) {
                [System.Windows.Forms.Clipboard]::Clear()
            } else {
                Set-Clipboard -Value $text -ErrorAction Stop
            }
            return
        } catch { $last = $_ }
        Start-Sleep -Milliseconds $CLIPBOARD_RETRY_MS
    }
    throw "the clipboard is held open by another application and could not be written ($($last.Exception.Message))"
}

function Do-Clipboard([object]$Arg) {
    $op = "$($Arg.op)"
    if ($op -eq 'set') {
        $text = [string]$Arg.text
        Set-ClipboardText $text
        return [ordered]@{ op = 'set'; length = $text.Length; foreground = (Get-ForegroundInfo) }
    }
    if ($op -eq 'get') {
        $v = Get-ClipboardText
        $truncated = $false
        if ($v.Length -gt $CLIPBOARD_MAX_CHARS) { $v = $v.Substring(0, $CLIPBOARD_MAX_CHARS); $truncated = $true }
        return [ordered]@{ op = 'get'; text = $v; length = $v.Length; truncated = $truncated }
    }
    if ($op -eq 'clear') {
        Set-ClipboardText ''
        return [ordered]@{ op = 'clear'; length = 0 }
    }
    throw "clipboard op must be 'get', 'set' or 'clear'"
}

function Send-CtrlV {
    $events = @(
        [DshNative]::Key(0x11, 0, 0),
        [DshNative]::Key(0x56, 0, 0),
        [DshNative]::Key(0x56, 0, [DshNative]::KEYEVENTF_KEYUP),
        [DshNative]::Key(0x11, 0, [DshNative]::KEYEVENTF_KEYUP)
    )
    $sent = [DshNative]::Send($events)
    $delivery = Assert-InputDelivered $sent $events.Count 'the paste (ctrl+v)' 'the paste'
    return $sent
}

function Get-TextFingerprint([string]$text) {
    # An auxiliary check only. §6 is explicit that a fingerprint must not be used to decide
    # *who* changed the clipboard -- the sequence number answers "did it change", and that is
    # the question a borrow needs answered.
    if ([string]::IsNullOrEmpty($text)) { return '' }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
        return [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').Substring(0, 16).ToLowerInvariant()
    } finally { $sha.Dispose() }
}

function Get-ClipboardShape {
    # What the clipboard holds right now: its text (when it has any), every format it
    # advertises, and the sequence number that makes a later change detectable.
    #
    # The formats matter as much as the text. "The text was read back" is not "the clipboard
    # was saved": an image, a file list or rich markup survives no round trip through this
    # path, and a caller told "saved" would lose it without ever knowing (8.txt §6).
    $last = $null
    for ($i = 0; $i -lt $CLIPBOARD_ATTEMPTS; $i++) {
        try {
            $data = [System.Windows.Forms.Clipboard]::GetDataObject()
            $formats = @()
            $isText = $false
            $text = ''
            $present = $null -ne $data
            if ($present) {
                $formats = @($data.GetFormats() | ForEach-Object { [string]$_ })
                $isText = [System.Windows.Forms.Clipboard]::ContainsText()
                if ($isText) { $text = [string][System.Windows.Forms.Clipboard]::GetText() }
            }
            return [ordered]@{
                ok         = $true
                present    = $present
                # An empty clipboard and "content whose text is empty" are different facts and
                # are kept apart here on purpose (8.txt §6).
                empty      = (-not $present) -or (@($formats).Count -eq 0)
                isText     = $isText
                text       = $text
                length     = $text.Length
                fingerprint = (Get-TextFingerprint $text)
                formats    = $formats
                unsaveable = @($formats | Where-Object { $_ -ne 'Text' -and $_ -ne 'UnicodeText' -and $_ -ne 'System.String' -and $_ -ne 'Locale' })
                seq        = [int64][DshNative]::GetClipboardSequenceNumber()
            }
        } catch { $last = $_ }
        Start-Sleep -Milliseconds $CLIPBOARD_RETRY_MS
    }
    return [ordered]@{
        ok = $false
        present = $false
        empty = $false
        isText = $false
        text = ''
        length = 0
        fingerprint = ''
        formats = @()
        unsaveable = @()
        seq = [int64]-1
        note = "the clipboard is held open by another application and could not be read ($($last.Exception.Message))"
    }
}

function Get-PasteVerification([object]$Arg, [string]$text) {
    # A postcondition for a paste, when the caller can name a readable control (§6): a fixed
    # wait is a fallback, never a proof, but "the text is in that control" is a proof. $null
    # when the caller asked for no verification.
    $verify = Get-ArgMember $Arg 'verify'
    if ($null -eq $verify) { return $null }
    $hwnd = Get-ArgMember $verify 'hwnd'
    if ($null -eq $hwnd -or [int64]$hwnd -eq 0) {
        $intoHwnd = Get-ArgMember $Arg 'intoHwnd'
        if ($null -ne $intoHwnd -and [int64]$intoHwnd -ne 0) { $hwnd = [int64]$intoHwnd } else { $hwnd = 0 }
    }
    $ref = Get-ArgMember $verify 'ref'
    $selector = [ordered]@{ automationId = ''; name = ''; controlType = ''; className = ''; index = 0 }
    if ($null -ne $ref -and "$ref" -ne '') {
        $resolved = Resolve-ElementRef "$ref"
        if (-not $resolved.ok) {
            return [ordered]@{ status = 'unknown'; note = "$($resolved.error)" }
        }
        if ($null -ne $resolved.selector.hwnd) { $hwnd = [int64]$resolved.selector.hwnd }
        $selector['automationId'] = "$($resolved.selector.automationId)"
        $selector['name'] = "$($resolved.selector.name)"
        $selector['controlType'] = "$($resolved.selector.controlType)"
        $selector['className'] = "$($resolved.selector.className)"
        if ($null -ne $resolved.selector.index) { $selector['index'] = [int]$resolved.selector.index }
    } else {
        foreach ($pair in @(@('automationId', 'automation_id'), @('name', 'name'), @('controlType', 'control_type'), @('className', 'class_name'), @('index', 'index'))) {
            $value = Get-ArgMember $verify $pair[0]
            if ($null -eq $value) { $value = Get-ArgMember $verify $pair[1] }
            if ($null -ne $value -and "$value" -ne '') { $selector[$pair[0]] = $value }
        }
    }
    if ($hwnd -eq 0) {
        return [ordered]@{ status = 'unknown'; note = 'no window to verify against: pass verify.hwnd (or into_hwnd) with the control to read back' }
    }
    $budget = [Math]::Max(400, $text.Length + 128)
    $record = $null
    try {
        $record = [DshUia.Engine]::ReadTextObservation([int64]$hwnd, "$($selector['automationId'])", "$($selector['name'])", "$($selector['controlType'])", "$($selector['className'])", [int]([int]$selector['index']), $false, $true, $false, $true, $budget)
    } catch {
        return [ordered]@{ status = 'unknown'; note = "the control could not be read back to verify the paste: $($_.Exception.Message)" }
    }
    if ("$($record['status'])" -ne 'ok') {
        $note = "$($record['note'])"
        if ($note -eq '') { $note = "$($record['error'])" }
        return [ordered]@{ status = 'unknown'; note = "the control could not be read back to verify the paste: $note" }
    }
    $document = "$($record['document'])"
    if ("$($record['documentStatus'])" -eq 'ok' -and $document -ne '') {
        if ($document.IndexOf($text, [System.StringComparison]::Ordinal) -ge 0) {
            return [ordered]@{ status = 'verified'; source = 'document'; note = 'the pasted text is in the control' }
        }
        return [ordered]@{ status = 'absent'; source = 'document'; note = 'the control was read and the pasted text was not in it' }
    }
    $summary = "$($record['focusedSummary'])"
    if ($summary.IndexOf($text, [System.StringComparison]::Ordinal) -ge 0) {
        return [ordered]@{ status = 'verified'; source = 'value'; note = 'the pasted text is in the control value' }
    }
    return [ordered]@{
        status = 'unknown'
        note = 'the control exposes neither a document nor a readable value, so the paste could not be verified: check the result another way'
    }
}

function Do-Paste([object]$Arg) {
    # The clipboard is touched by a paste, so it is input like any other: refused before the
    # borrow starts rather than half way through restoring it (§5.7).
    Assert-CanSend 'before the paste'
    # Typing goes through SendInput one character at a time, which some editors and
    # every IME-hostile app mangle; a paste is one atomic gesture and is the only
    # reliable way to move a long or non-ASCII string into a control. The user's own
    # clipboard is borrowed first and put back afterwards (8.txt §6):
    #
    #   verify the receiver -> read the clipboard's formats and the content that can be
    #   restored -> record the sequence number -> write the text -> record the sequence
    #   number after that write -> confirm the receiver again and send the paste -> wait for
    #   whatever condition the caller could name -> restore conditionally in a finally.
    #
    # "Conditionally" is the part that matters: the clipboard is only put back when it still
    # holds what we borrowed. Anything else there was written by somebody else after us, and
    # restoring would delete their content to undo a borrow that is already over.
    $text = [string]$Arg.text
    if ([string]::IsNullOrEmpty($text)) { throw "paste requires text" }
    # Checked before the clipboard is touched: refusing after writing would leave the
    # caller's text on the user's clipboard with nothing pasted.
    Assert-ExpectedForeground $Arg.intoHwnd 'a paste'
    [void](Assert-InjectableForeground 'a paste')
    $restore = $true
    if ($Arg.restore -eq $false) { $restore = $false }
    $requireRestore = $false
    if ($Arg.requireRestore -eq $true) { $requireRestore = $true }

    $before = Get-ClipboardShape
    $unsaveable = @($before.unsaveable)
    if ($restore -and -not $before.ok -and $requireRestore) {
        throw "[CLIPBOARD_BUSY] the clipboard is held open by another application, so its current content could not be saved, and require_restore was set: nothing was pasted. Retry in a moment, or leave require_restore out to accept that the clipboard will hold the pasted text afterwards."
    }
    if ($restore -and $before.ok -and -not $before.empty -and -not $before.isText -and $unsaveable.Count -gt 0 -and $requireRestore) {
        throw "[RESTORE_UNSUPPORTED] the clipboard holds $($unsaveable -join ', ') and nothing readable as text, so it cannot be put back through this path, and require_restore was set: nothing was pasted. Pass require_restore: false to overwrite it deliberately, type the text with computer_type, or set the control's value with computer_ui_action set_value."
    }

    $seqAfterWrite = [int64]-1
    $restoreStatus = 'not_requested'
    $restoreNote = ''
    $sent = 0
    $verification = $null
    try {
        Set-ClipboardText $text
        $seqAfterWrite = [int64][DshNative]::GetClipboardSequenceNumber()
        Start-Sleep -Milliseconds 40
        $sent = Send-CtrlV
        # Give the target a moment to service WM_PASTE before the clipboard changes
        # under it; Windows delivers the paste request asynchronously. This wait is a
        # fallback and is not evidence that the paste arrived -- a caller that can name a
        # readable control gets a postcondition in `paste_verification` instead.
        Start-Sleep -Milliseconds 180
        $verification = Get-PasteVerification $Arg $text
    } finally {
        # Everything above -- a refused SendInput, a cancelled request, a throw in the
        # verification -- has to give the user their clipboard back, which is what this
        # finally is for.
        if (-not $restore) {
            $restoreStatus = 'not_requested'
        } elseif (-not $before.ok) {
            $restoreStatus = 'failed_busy'
            $restoreNote = "$($before.note)"
        } else {
            $now = Get-ClipboardShape
            if (-not $now.ok) {
                $restoreStatus = 'failed_busy'
                $restoreNote = "$($now.note)"
            } elseif ([int64]$now.seq -ne $seqAfterWrite) {
                # Somebody wrote to the clipboard after we did: their content is newer than the
                # state we borrowed, so putting ours back would delete theirs.
                if ($before.isText -and -not $before.empty -and $unsaveable.Count -eq 0) {
                    $restoreNote = "the clipboard changed after this paste (sequence $($seqAfterWrite) -> $([int64]$now.seq)), so the newer content was left in place instead of restoring what was borrowed"
                } else {
                    $restoreNote = "the clipboard changed after this paste (sequence $($seqAfterWrite) -> $([int64]$now.seq)), and what was there before could not have been restored in full anyway ($($unsaveable -join ', ')); the newer content was left in place"
                }
                $restoreStatus = 'skipped_external_change'
            } elseif (-not $before.isText -and $unsaveable.Count -gt 0) {
                # Nothing of the original can be written back: clearing the clipboard here would
                # not be a restore, so the borrowed text is left in place and said out loud.
                $restoreStatus = 'unsupported_original_format'
                $restoreNote = "the clipboard held $($unsaveable -join ', ') before this paste and none of it can be written back through this path; the pasted text is there now (pass require_restore: true to have this refused before anything is written)"
            } else {
                try {
                    if ($before.empty) { Set-ClipboardText '' } else { Set-ClipboardText $before.text }
                    if ($unsaveable.Count -gt 0) {
                        $restoreStatus = 'unsupported_original_format'
                        $restoreNote = "the text that was on the clipboard is back, but these formats could not be saved or restored through this path and are gone: $($unsaveable -join ', ')"
                    } else {
                        $restoreStatus = 'restored'
                    }
                } catch {
                    $restoreStatus = 'failed_other'
                    $restoreNote = "$($_.Exception.Message)"
                }
            }
        }
    }
    Set-WriteStamp -What 'paste' -Hwnd $Arg.intoHwnd
    $receipt = [ordered]@{
        pasted        = $text.Length
        restored      = ($restoreStatus -eq 'restored')
        savedUser     = ($restore -and $before.ok -and $before.isText -and -not $before.empty)
        restoreStatus = $restoreStatus
        eventsSent    = $sent
        foreground    = (Get-ForegroundInfo)
        clipboard     = [ordered]@{
            formatsBefore = @($before.formats)
            seqBefore     = [int64]$before.seq
            seqAfterWrite = [int64]$seqAfterWrite
        }
    }
    if ($restoreNote -ne '') { $receipt['restoreNote'] = $restoreNote }
    if ($null -ne $verification) { $receipt['pasteVerification'] = $verification }
    return $receipt
}

# ---------------------------------------------------------------- app discovery (§9)
#
# Naming an application is fuzzy by nature ("the chat app"), and the signals that make a
# guess good are expensive to collect per call: a recursive Start-menu scan, the shell's own
# app table, a process snapshot and a registry read. They are collected once, kept for a
# bounded time, and refreshed on request -- never per candidate, and never with one
# `Get-ItemProperty` per item (which §9 names as the way to spend more on the interpreter
# than the answer is worth).

$script:AppDiscovery = @{
    startMenu    = $null
    startMenuAt  = [DateTime]::MinValue
    startApps    = $null
    startAppsAt  = [DateTime]::MinValue
    usage        = $null
    usageKnown   = $false
    usageAt      = [DateTime]::MinValue
    processes    = $null
    processesAt  = [DateTime]::MinValue
}

function Get-AppDiscovery([bool]$refresh = $false) {
    $now = [DateTime]::UtcNow
    $state = $script:AppDiscovery
    if ($refresh -or $null -eq $state.startMenu -or ($now - $state.startMenuAt).TotalSeconds -gt 60) {
        $entries = @()
        foreach ($root in @(
                (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'),
                (Join-Path $env:AppData 'Microsoft\Windows\Start Menu\Programs'))) {
            if (-not (Test-Path -LiteralPath $root)) { continue }
            try { $entries += @(Get-ChildItem -LiteralPath $root -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue) } catch { }
        }
        $state.startMenu = @($entries | ForEach-Object { [ordered]@{ name = "$($_.BaseName)"; path = "$($_.FullName)" } })
        $state.startMenuAt = $now
    }
    if ($refresh -or $null -eq $state.startApps -or ($now - $state.startAppsAt).TotalSeconds -gt 60) {
        $apps = @()
        try { $apps = @(Get-StartApps -ErrorAction Stop) } catch { $apps = @() }
        $state.startApps = @($apps | ForEach-Object { [ordered]@{ name = "$($_.Name)"; appId = "$($_.AppID)" } })
        $state.startAppsAt = $now
    }
    if ($refresh -or $null -eq $state.usage -or ($now - $state.usageAt).TotalSeconds -gt 120) {
        # One batched read of the whole key. The values are per-application switch counts the
        # shell keeps; a value that is not a number is left out rather than counted as zero
        # (§9: missing must read as unknown, not as "never used").
        $usage = @{}
        $known = $false
        try {
            $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FeatureUsage\AppSwitched'
            if (Test-Path -LiteralPath $key) {
                $item = Get-ItemProperty -LiteralPath $key -ErrorAction Stop
                foreach ($property in $item.PSObject.Properties) {
                    if ("$($property.Name)" -like 'PS*') { continue }
                    $count = 0
                    if ([int]::TryParse("$($property.Value)", [ref]$count)) {
                        $usage["$($property.Name)"] = $count
                        $known = $true
                    }
                }
            }
        } catch { $known = $false }
        $state.usage = $usage
        $state.usageKnown = $known
        $state.usageAt = $now
    }
    return $state
}

function Get-RunningProcessMap {
    # name (lower-case, no extension) -> pids. Cached for a couple of seconds: `isRunning` is
    # worth having, and one Get-Process per candidate is the per-item cost §9 warns about.
    $now = [DateTime]::UtcNow
    $state = $script:AppDiscovery
    if ($null -ne $state.processes -and ($now - $state.processesAt).TotalSeconds -lt 2.5) { return $state.processes }
    $map = @{}
    try {
        foreach ($process in @(Get-Process -ErrorAction SilentlyContinue)) {
            $name = "$($process.ProcessName)".ToLowerInvariant()
            if ($name -eq '') { continue }
            if (-not $map.ContainsKey($name)) { $map[$name] = @() }
            $map[$name] = @($map[$name]) + @([int]$process.Id)
        }
    } catch { }
    $state.processes = $map
    $state.processesAt = $now
    return $map
}

function Get-NameMatchScore([string]$name, [string]$target) {
    # How well a candidate name answers what was asked for. Exact first, then prefix, then
    # substring -- and the score falls off with how much the candidate adds, so "Chat" beats
    # "Chat (work)" beats "App called Chat something".
    if ($name -eq $target) { return 100 }
    $lowerName = $name.ToLowerInvariant()
    $lowerTarget = $target.ToLowerInvariant()
    if ($lowerName -eq $lowerTarget) { return 99 }
    if ($lowerTarget -eq '') { return 0 }
    $extra = [Math]::Max(0, $name.Length - $target.Length)
    if ($lowerName.StartsWith($lowerTarget)) { return 80 - [Math]::Min(30, $extra) }
    if ($lowerName.IndexOf($lowerTarget) -ge 0) { return 55 - [Math]::Min(25, $extra) }
    return 0
}

function Get-AppUsageCountFor([string]$exeName, [string]$label, $discovery) {
    # The switch count the shell keeps for this application, when it keeps one. "Unknown" is
    # returned as unknown: the registry may not have the key, may not have this app, or may
    # hold a value this build cannot read, and none of those mean "never used" (§9).
    $result = @{ count = 0; known = $false }
    if ($null -eq $discovery.usage -or -not $discovery.usageKnown) { return $result }
    $keys = @()
    if ($exeName -ne '') { $keys += "$exeName.exe"; $keys += $exeName }
    if ($label -ne '') { $keys += "$label.exe"; $keys += $label }
    foreach ($key in $keys) {
        if ($key -eq '' -or $key -eq '.exe') { continue }
        if ($discovery.usage.ContainsKey($key)) {
            $result.count = [int]$discovery.usage[$key]
            $result.known = $true
            return $result
        }
    }
    return $result
}

function Add-LaunchSignals($resolution, [string]$basis, [bool]$refresh = $false) {
    # What §9 asks a candidate to carry: the true source type (kept, not flattened away), the
    # current running state, the usage history when there is one, and how it matched.
    $discovery = Get-AppDiscovery $refresh
    $processes = Get-RunningProcessMap
    $exe = ''
    try { $exe = [System.IO.Path]::GetFileNameWithoutExtension("$($resolution.file)") } catch { $exe = '' }
    $label = "$($resolution.label)"
    if ($exe -eq '' -and $label -ne '') { $exe = $label }
    $running = $false
    if ($exe -ne '') {
        $key = $exe.ToLowerInvariant()
        if ($processes.ContainsKey($key) -and @($processes[$key]).Count -gt 0) { $running = $true }
        if (-not $running -and $label -ne '') {
            $labelKey = $label.ToLowerInvariant()
            if ($processes.ContainsKey($labelKey) -and @($processes[$labelKey]).Count -gt 0) { $running = $true }
        }
    }
    $usage = Get-AppUsageCountFor $exe $label $discovery
    $resolution['source'] = "$($resolution.kind)"
    $resolution['isRunning'] = $running
    $resolution['useCount'] = [int]$usage.count
    $resolution['useCountKnown'] = [bool]$usage.known
    if ($basis -ne '') { $resolution['matchBasis'] = $basis }
    return $resolution
}

function Resolve-LaunchTarget([string]$target, [bool]$refresh = $false) {
    # An app is named in whatever way the user knows it: a path, an executable on PATH, a
    # Start-menu entry's display name, or an installed (Store/UWP) app.
    #
    # The order is §9's: an explicit path or an exact name first, then name relevance, and
    # only then whether it is running and what the shell remembers being used -- those two
    # break ties, they never make the decision on their own.
    if (Test-Path -LiteralPath $target) {
        return Add-LaunchSignals ([ordered]@{ kind = 'path'; file = (Resolve-Path -LiteralPath $target).Path; label = $target }) 'explicit path' $refresh
    }
    if ($target.IndexOf('\') -ge 0 -or $target.IndexOf('/') -ge 0 -or $target -match '\.(exe|bat|cmd|com|lnk|url)$') {
        return Add-LaunchSignals ([ordered]@{ kind = 'command'; file = $target; label = $target }) 'explicit command' $refresh
    }
    # An executable reachable through PATH, App Paths or the current directory.
    $cmd = Get-Command -Name $target -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $cmd) {
        return Add-LaunchSignals ([ordered]@{ kind = 'command'; file = $cmd.Source; label = $target }) 'on PATH' $refresh
    }

    $discovery = Get-AppDiscovery $refresh
    $processes = Get-RunningProcessMap
    # Every candidate that is worth considering, from the two tables the Start menu itself is
    # built from. Both are cached: nothing below touches the disk or the registry again.
    $scored = New-Object System.Collections.Generic.List[object]
    foreach ($entry in @($discovery.startMenu)) {
        $score = Get-NameMatchScore "$($entry.name)" $target
        if ($score -le 0) { continue }
        $scored.Add([ordered]@{ score = $score; kind = 'shortcut'; file = "$($entry.path)"; label = "$($entry.name)"; exe = "$($entry.name)" })
    }
    foreach ($entry in @($discovery.startApps)) {
        $score = Get-NameMatchScore "$($entry.name)" $target
        if ($score -le 0) { continue }
        $scored.Add([ordered]@{ score = $score; kind = 'start-app'; file = "$($entry.appId)"; label = "$($entry.name)"; exe = '' })
    }
    if ($scored.Count -eq 0) {
        throw "could not find an application named '$target' (tried a path, PATH, the Start menu, and installed apps)"
    }
    $ranked = @($scored.ToArray() | ForEach-Object {
        $running = $false
        if ("$($_.exe)" -ne '') {
            $key = "$($_.exe)".ToLowerInvariant()
            if ($processes.ContainsKey($key)) { $running = @($processes[$key]).Count -gt 0 }
        }
        $usage = Get-AppUsageCountFor "$($_.exe)" "$($_.label)" $discovery
        $_.isRunning = $running
        $_.useCount = [int]$usage.count
        $_.useCountKnown = [bool]$usage.known
        $_
    } | Sort-Object -Property @{ Expression = { [int]$_['score'] }; Descending = $true },
                              @{ Expression = { [bool]$_['isRunning'] }; Descending = $true },
                              @{ Expression = { [int]$_['useCount'] }; Descending = $true },
                              @{ Expression = { "$($_.label)" }; Descending = $false })
    $best = $ranked[0]
    # A name tie the signals could not break is reported, not guessed. "'Chat' matching both
    # 'Chat' and 'Chat (work)'" is exactly the case where picking the usually-busy one is how
    # the wrong application gets launched (§9: never assume the most used app is the intent).
    $tied = @($ranked | Where-Object {
        [int]$_['score'] -eq [int]$best['score'] -and
        [bool]$_['isRunning'] -eq [bool]$best['isRunning'] -and
        [int]$_['useCount'] -eq [int]$best['useCount']
    })
    if ($tied.Count -gt 1) {
        $listed = ($tied | Select-Object -First 4 | ForEach-Object { "'$($_.label)' ($($_.kind))" }) -join ', '
        throw "[AMBIGUOUS_MATCH] '$target' matches $($tied.Count) applications equally well: $listed. Pass the exact display name, an executable path, or a command line instead -- the plugin will not guess between them, and the one that has been used most is not the same thing as the one that was meant. (action_sent=false, recovery=computer_launch, auto_reresolve=false)"
    }

    # A Start-menu shortcut is what a display name actually resolves to on disk; an installed
    # (packaged) app has no path of its own and is started through the shell.
    $resolution = [ordered]@{ kind = "$($best.kind)"; file = "$($best.file)"; label = "$($best.label)" }
    if ($resolution.kind -eq 'shortcut') { $resolution = [ordered]@{ kind = 'shortcut'; file = "$($best.file)"; label = "$($best.label)" } }
    if ($resolution.kind -eq 'start-app') {
        $appId = "$($best.file)"
        # Two shapes live in that table. A packaged app has a real AUMID
        # ("Package_hash!App") and can only be started through the shell. A classic app is
        # listed as "{known-folder-guid}\vendor\app.exe", which is a path once the guid is
        # resolved.
        if ($appId -match '^(\{[0-9A-Fa-f\-]+\})\\(.+)$') {
            $folder = [DshNative]::KnownFolderPath($Matches[1])
            if (-not [string]::IsNullOrEmpty($folder)) {
                $resolution = [ordered]@{ kind = 'start-app-path'; file = (Join-Path $folder $Matches[2]); label = "$($best.label)" }
            } else {
                $resolution = [ordered]@{ kind = 'store'; file = "shell:AppsFolder\$appId"; label = "$($best.label)" }
            }
        } else {
            $resolution = [ordered]@{ kind = 'store'; file = "shell:AppsFolder\$appId"; label = "$($best.label)" }
        }
    }
    $basis = 'name match'
    if ("$($best.label)" -eq $target) { $basis = 'exact name' }
    $resolution = Add-LaunchSignals $resolution $basis $refresh
    $runnersUp = @($ranked | Where-Object { "$($_.label)" -ne "$($best.label)" } | Select-Object -First 3 | ForEach-Object {
        [ordered]@{
            label        = "$($_.label)"
            source       = "$($_.kind)"
            matchBasis   = "name match (score $($_['score']))"
            isRunning    = [bool]$_['isRunning']
            useCount     = [int]$_['useCount']
            useCountKnown = [bool]$_['useCountKnown']
        }
    })
    if ($runnersUp.Count -gt 0) { $resolution['candidates'] = $runnersUp }
    return $resolution
}

function Get-VisibleWindows {
    # Every visible top-level window with a title: hwnd -> identity. Used both to
    # diff "what appeared while we waited" and to exclude the window we were on.
    $state = @{ rows = (New-Object System.Collections.Generic.List[object]) }
    $callback = [DshNative+EnumWindowsProc] {
        param([IntPtr]$hwnd, [IntPtr]$lParam)
        if (-not [DshNative]::IsWindowVisible($hwnd)) { return $true }
        $rect = New-Object DshNative+RECT
        if (-not [DshNative]::WindowBounds($hwnd, [ref]$rect)) { return $true }
        $w = $rect.Right - $rect.Left
        $h = $rect.Bottom - $rect.Top
        if ($w -lt 40 -or $h -lt 40) { return $true }
        $owner = 0
        [void][DshNative]::GetWindowThreadProcessId($hwnd, [ref]$owner)
        $name = ''
        try { $name = (Get-Process -Id $owner -ErrorAction Stop).ProcessName } catch { $name = '' }
        $state.rows.Add([ordered]@{
            hwnd    = [int64]$hwnd
            pid     = $owner
            process = $name
            title   = [DshNative]::WindowText($hwnd)
            area    = [int64]$w * [int64]$h
        })
        return $true
    }
    [void][DshNative]::EnumWindows($callback, [IntPtr]::Zero)
    return @($state.rows.ToArray())
}

function Find-WindowForPid([int]$procId, [IntPtr]$exclude) {
    # The largest visible top-level window belonging to the process, ignoring the
    # window we were already on. A freshly launched app often shows a splash window
    # first; the caller polls until this returns something usable.
    #
    # The accumulator is a hashtable, not a plain variable: a scriptblock used as a
    # delegate runs in its own scope, so `$best = $hwnd` inside it would write a
    # local and vanish. Objects passed in by reference survive.
    $state = @{ best = [IntPtr]::Zero; area = [int64](-1) }
    $callback = [DshNative+EnumWindowsProc] {
        param([IntPtr]$hwnd, [IntPtr]$lParam)
        if (-not [DshNative]::IsWindowVisible($hwnd)) { return $true }
        if ($hwnd -eq $exclude) { return $true }
        $owner = 0
        [void][DshNative]::GetWindowThreadProcessId($hwnd, [ref]$owner)
        if ($owner -ne $procId) { return $true }
        $rect = New-Object DshNative+RECT
        if (-not [DshNative]::WindowBounds($hwnd, [ref]$rect)) { return $true }
        $area = [int64]($rect.Right - $rect.Left) * [int64]($rect.Bottom - $rect.Top)
        if ($area -gt $state.area) { $state.area = $area; $state.best = $hwnd }
        return $true
    }
    [void][DshNative]::EnumWindows($callback, [IntPtr]::Zero)
    return $state.best
}

function Do-Launch([object]$Arg) {
    $target = [string]$Arg.target
    if ([string]::IsNullOrWhiteSpace($target)) { throw "launch requires a target" }
    $waitSeconds = 8.0
    if ($null -ne $Arg.waitSeconds) { $waitSeconds = [Math]::Max(0, [Math]::Min(30, [double]$Arg.waitSeconds)) }
    $resolved = Resolve-LaunchTarget $target ($Arg.refresh -eq $true)
    $argumentList = @()
    if ($null -ne $Arg.arguments) { $argumentList = @($Arg.arguments | ForEach-Object { [string]$_ }) }

    # The window set before the launch, so "what appeared" can be answered without
    # guessing: launchers hand off to an already-running process, Store apps go
    # through explorer, and the process Start-Process returns is then not the one
    # that owns the window.
    $before = @{}
    foreach ($row in (Get-VisibleWindows)) { $before[[int64]$row.hwnd] = $true }
    # The shell's own desktop window belongs to explorer and is the largest thing on
    # screen; without this it wins every "what is new" comparison.
    $shellWindow = [DshNative]::GetShellWindow()
    if ($shellWindow -ne [IntPtr]::Zero) { $before[[int64]$shellWindow] = $true }
    $foreground = [DshNative]::GetForegroundWindow()

    $started = Get-Date
    $proc = $null
    # 启动前把「会让 Electron 变成 Node」的变量从本进程环境里临时摘掉：worker 由 Agent 会话
    # 派生，环境里带着 ELECTRON_RUN_AS_NODE=1，照抄给子进程就会让聊天客户端/编辑器这类
    # Electron 应用静默退出（exit 0、无窗口）——表现成「启动成功了但什么都没出现」。
    # 启动完立刻恢复，不影响 worker 自己的后续行为。
    $launchEnvSaved = @{}
    foreach ($envName in @('ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ASAR', 'ELECTRON_NO_ATTACH_CONSOLE',
                           'ELECTRON_FORCE_WINDOW_MENU_BAR', 'NODE_OPTIONS', 'NODE_REPL_EXTERNAL_MODULE')) {
        foreach ($key in @([System.Environment]::GetEnvironmentVariables().Keys)) {
            if ($key -and ($key.ToUpper() -eq $envName.ToUpper())) {
                $launchEnvSaved[$key] = [System.Environment]::GetEnvironmentVariable($key)
                [System.Environment]::SetEnvironmentVariable($key, $null)
            }
        }
    }
    try {
        if ($resolved.kind -eq 'store') {
            # A packaged app has no executable path of its own: shell activation is
            # the only way in, and explorer is what performs it. The window will
            # therefore belong to the app, not to the process we get back.
            $proc = Start-Process -FilePath 'explorer.exe' -ArgumentList @($resolved.file) -PassThru -ErrorAction Stop
        } elseif ($argumentList.Count -gt 0) {
            $proc = Start-Process -FilePath $resolved.file -ArgumentList $argumentList -PassThru -ErrorAction Stop
        } else {
            $proc = Start-Process -FilePath $resolved.file -PassThru -ErrorAction Stop
        }
    } catch {
        throw "could not start '$target' (resolved as $($resolved.kind): $($resolved.file)): $($_.Exception.Message)"
    } finally {
        foreach ($key in $launchEnvSaved.Keys) {
            [System.Environment]::SetEnvironmentVariable($key, $launchEnvSaved[$key])
        }
    }
    if ($null -eq $proc) { throw "launching '$target' returned no process (resolved as $($resolved.kind): $($resolved.file))" }
    $procId = $proc.Id
    $procName = ''
    try { $procName = $proc.ProcessName } catch { $procName = '' }

    $deadline = (Get-Date).AddSeconds($waitSeconds)
    $hwnd = [IntPtr]::Zero
    $how = ''
    # Shell activation tells us nothing: the process we got back is explorer. Only
    # the before/after window diff can answer for those, so skip straight to it.
    if ($resolved.kind -ne 'store') {
        while ((Get-Date) -lt $deadline) {
            # 1. the process Start-Process handed us
            $hwnd = Find-WindowForPid $procId $foreground
            if ($hwnd -ne [IntPtr]::Zero) { $how = 'process'; break }
            # 2. a sibling with the same image name: what a single-instance app looks
            #    like after the second launch hands off to the first.
            if ($procName -ne '') {
                foreach ($sibling in @(Get-Process -Name $procName -ErrorAction SilentlyContinue)) {
                    if ($sibling.Id -eq $procId) { continue }
                    $found = Find-WindowForPid $sibling.Id $foreground
                    if ($found -ne [IntPtr]::Zero) { $hwnd = $found; $procId = $sibling.Id; $procName = $sibling.ProcessName; $how = 'sibling'; break }
                }
                if ($hwnd -ne [IntPtr]::Zero) { break }
            }
            Start-Sleep -Milliseconds 120
        }
    }

    # 3. nothing matched by identity: take the largest window that did not exist
    #    before the launch. Reported as a guess, with its real process named, so the
    #    caller can see what it actually got instead of trusting a pid.
    if ($hwnd -eq [IntPtr]::Zero) {
        while ((Get-Date) -lt $deadline) {
            $fresh = @(Get-VisibleWindows | Where-Object { -not $before.ContainsKey([int64]$_.hwnd) } | Sort-Object -Property area -Descending)
            if ($fresh.Count -gt 0) {
                $hwnd = [IntPtr][int64]$fresh[0].hwnd
                $procId = $fresh[0].pid
                $procName = $fresh[0].process
                $how = 'new-window'
                break
            }
            Start-Sleep -Milliseconds 120
        }
    }

    $title = ''
    $note = ''
    if ($hwnd -eq [IntPtr]::Zero) {
        $note = 'the process started but showed no visible top-level window within the wait; it may be a tray-only app, or it handed control to a process that was already running'
    } else {
        $title = [DshNative]::WindowText($hwnd)
        if ($how -eq 'new-window') { $note = 'matched by comparing visible windows before and after the launch, because no window belonged to the launched process itself' }
        if ($how -eq 'sibling') { $note = 'the launch handed off to an already-running instance of the same application' }
    }
    Set-WriteStamp -What 'launch' -Hwnd $hwnd
    $reply = [ordered]@{
        resolvedAs = $resolved.kind
        file       = $resolved.file
        pid        = $procId
        process    = $procName
        hwnd       = [int64]$hwnd
        title      = $title
        waitedMs   = [int]((Get-Date) - $started).TotalMilliseconds
        matchedBy  = $how
        note       = $note
    }
    # B4 (§9): which way the target was found, whether it was already running, what the shell
    # remembers about how often it has been used, and the candidates that lost. None of these
    # decides the launch -- they are what lets the caller see that the fuzzy match it got is
    # the one it meant.
    $reply['label'] = "$($resolved.label)"
    $reply['source'] = "$($resolved.source)"
    if ($null -ne $resolved.matchBasis) { $reply['matchBasis'] = "$($resolved.matchBasis)" }
    $reply['wasRunning'] = ($resolved.isRunning -eq $true)
    $reply['useCount'] = [int]$resolved.useCount
    $reply['useCountKnown'] = ($resolved.useCountKnown -eq $true)
    if ($null -ne $resolved.candidates) { $reply['candidates'] = @($resolved.candidates) }
    return $reply
}

function Do-Release {
    $released = @(Release-HeldInput)
    $note = 'held input was released'
    if ($released.Count -eq 0) { $note = 'nothing was held down' }
    return [ordered]@{
        released = $released
        count    = $released.Count
        note     = $note
    }
}

function Do-Digest([object]$Arg) {
    $rect = $null
    if ($null -ne $Arg.hwnd -and [int64]$Arg.hwnd -ne 0) {
        $rect = Get-WindowRectInfo ([IntPtr][int64]$Arg.hwnd)
    } elseif ($null -ne $Arg.region) {
        $r = $Arg.region
        $rect = [ordered]@{ x = [int]$r.x; y = [int]$r.y; width = [int]$r.width; height = [int]$r.height }
    } else {
        $rect = Get-ForegroundRect
    }
    if ($null -eq $rect) { throw "could not resolve a region to fingerprint" }
    $maxSide = 320
    if ($null -ne $Arg.maxSide) { $maxSide = [Math]::Max(16, [int]$Arg.maxSide) }
    $digest = Get-RegionDigest $rect.x $rect.y $rect.width $rect.height $maxSide
    return [ordered]@{
        digest  = $digest
        x       = $rect.x
        y       = $rect.y
        width   = $rect.width
        height  = $rect.height
        maxSide = $maxSide
    }
}

function Do-Windows([object]$Arg) {
    $needle = [string]$Arg.filter
    $rows = New-Object System.Collections.Generic.List[object]
    $fg = [DshNative]::GetForegroundWindow()
    $callback = [DshNative+EnumWindowsProc] {
        param([IntPtr]$hwnd, [IntPtr]$lParam)
        if (-not [DshNative]::IsWindowVisible($hwnd)) { return $true }
        # Two filters that matter more than they look. IsWindowVisible is true for a
        # suspended UWP surface the DWM has cloaked, and for floating tool windows;
        # both are unusable targets that would otherwise fill the list with rows the
        # model cannot act on.
        if ([DshNative]::IsCloaked($hwnd)) { return $true }
        if ([DshNative]::IsToolWindow($hwnd)) { return $true }
        if ([DshNative]::IsIconic($hwnd)) { return $true }
        $title = [DshNative]::WindowText($hwnd)
        if ([string]::IsNullOrWhiteSpace($title)) { return $true }
        $rect = New-Object DshNative+RECT
        # Visual bounds, not GetWindowRect: the latter includes the invisible resize
        # border Windows 10+ puts around every frame, so it over-reports by ~7 px per
        # side and a region built from it sits offset from what the user sees.
        if (-not [DshNative]::WindowBounds($hwnd, [ref]$rect)) { return $true }
        $w = $rect.Right - $rect.Left
        $h = $rect.Bottom - $rect.Top
        if ($w -lt 40 -or $h -lt 40) { return $true }
        $procId = 0
        [void][DshNative]::GetWindowThreadProcessId($hwnd, [ref]$procId)
        $procName = ''
        try { $procName = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { $procName = '' }
        if ($needle -and $title -notmatch [regex]::Escape($needle) -and $procName -notmatch [regex]::Escape($needle)) { return $true }
        $rows.Add([ordered]@{
            hwnd       = [int64]$hwnd
            title      = $title
            process    = $procName
            pid        = $procId
            className  = [DshNative]::WindowClass($hwnd)
            x          = $rect.Left
            y          = $rect.Top
            width      = $w
            height     = $h
            foreground = ($hwnd -eq $fg)
        })
        return $true
    }
    [void][DshNative]::EnumWindows($callback, [IntPtr]::Zero)
    return [ordered]@{ windows = @($rows.ToArray()) }
}

function Do-Focus([object]$Arg) {
    Assert-CanSend 'before bringing a window forward'
    $hwnd = [IntPtr][int64]$Arg.hwnd
    if ($hwnd -eq [IntPtr]::Zero) { throw "focus requires a hwnd" }
    if (-not [DshNative]::IsWindow($hwnd)) { throw "hwnd $($Arg.hwnd) is not a window" }
    $visibleBefore = [DshNative]::IsWindowVisible($hwnd)
    $ok = [DshNative]::ForceForeground($hwnd)
    Start-Sleep -Milliseconds 120
    $visibleAfter = [DshNative]::IsWindowVisible($hwnd)
    $result = [ordered]@{ hwnd = [int64]$hwnd; focused = $ok; title = [DshNative]::WindowText($hwnd); visible = $visibleAfter }
    # Reported rather than assumed: focusing must not change whether the window is on screen,
    # and a caller that gets `visible: false` back needs to know that before it clicks into
    # coordinates it can no longer see. (The show-state substitution that used to make this
    # call hide the window is fixed in ForceForeground; this field is how it would be caught.)
    if ($visibleBefore -and -not $visibleAfter) {
        $result.note = 'the window was visible before this call and is not visible now; ForceForeground is supposed to leave that unchanged, so treat this as a bug report'
    }
    # When this fails the caller needs to know who has the foreground instead: the
    # usual cause is another process holding it, and the next useful move is to say
    # so rather than to click into a window that never came forward.
    if (-not $ok) {
        $fg = [DshNative]::GetForegroundWindow()
        $info = Get-WindowInfoForHwnd $fg
        $result.foreground = [ordered]@{ hwnd = $info.hwnd; title = $info.title; process = $info.process }
    }
    Set-WriteStamp -What 'focus' -Hwnd $Arg.hwnd
    return $result
}

function Do-Cursor {
    $cursor = New-Object DshNative+POINT
    [void][DshNative]::GetCursorPos([ref]$cursor)
    return [ordered]@{ x = $cursor.X; y = $cursor.Y }
}

function Test-Pattern($element, $pattern) {
    # TryGetCurrentPattern needs a real [ref] holder; PowerShell cannot pass [ref]$null.
    $holder = $null
    try { return [bool]$element.TryGetCurrentPattern($pattern, [ref]$holder) } catch { return $false }
}

function ConvertTo-SafeInt([double]$value) {
    # UI Automation reports a non-finite BoundingRectangle for virtualized and
    # off-screen elements. Casting that to Int32 throws, and because the walk runs
    # in one try block a single such element would abort the whole dump - which is
    # exactly how the tree collapsed to one node before this guard existed.
    if ([double]::IsNaN($value) -or [double]::IsInfinity($value)) { return 0 }
    if ($value -gt 2147483647) { return 2147483647 }
    if ($value -lt -2147483648) { return -2147483648 }
    return [int][Math]::Round($value)
}

function Test-RectFinite($rect) {
    foreach ($v in @($rect.X, $rect.Y, $rect.Width, $rect.Height)) {
        if ([double]::IsNaN($v) -or [double]::IsInfinity($v)) { return $false }
    }
    return $true
}

function ConvertFrom-ComRows($rows) {
    # The C# engine returns Dictionary<string, object>; the rest of the worker, and
    # the tool's output schema, expect the ordered hashtables the managed path builds.
    $nodes = New-Object System.Collections.Generic.List[object]
    foreach ($row in $rows) {
        $nodes.Add([ordered]@{
            depth        = [int]$row['depth']
            name         = [string]$row['name']
            controlType  = [string]$row['controlType']
            automationId = [string]$row['automationId']
            className    = [string]$row['className']
            enabled      = [bool]$row['enabled']
            offscreen    = [bool]$row['offscreen']
            x            = [int]$row['x']
            y            = [int]$row['y']
            width        = [int]$row['width']
            height       = [int]$row['height']
            patterns     = @($row['patterns'])
        })
    }
    return $nodes.ToArray()
}

function Get-ComUiTree([int64]$hwnd, [int]$maxDepth, [int]$maxNodes, [bool]$probePatterns, [bool]$skipEmpty, [object]$Arg) {
    $wantName = [string]$Arg.name
    $wantType = [string]$Arg.controlType
    $wantId = [string]$Arg.automationId
    $wantFilter = [string]$Arg.filter
    $findMode = ($wantName -ne '') -or ($wantType -ne '') -or ($wantId -ne '') -or ($wantFilter -ne '')
    # The client is checked before every read and replaced if it has gone bad. Without this a
    # degraded client answers every property read with nothing, which the walk reports as a
    # tree of anonymous rows -- a shape that looks like a real answer and is not.
    $reinit = $false
    if ($null -eq $script:WalkLedger) { Reset-WalkCounters }
    $ledger = $script:WalkLedger
    Add-HealthProbe $ledger
    if (-not [DshUia.Engine]::ClientHealthy($hwnd)) {
        [DshUia.Engine]::Reset()
        Add-ClientReset $ledger
        $reinit = $true
    }
    if ($findMode) {
        $rows = $null; $truncated = $false
        Add-WalkHit $ledger
        [DshUia.Engine]::Find($hwnd, $maxNodes, $probePatterns, $wantName, $wantType, $wantId, $wantFilter, [ref]$rows, [ref]$truncated)
        # A search that finds nothing and a client that cannot answer look the same from here,
        # so the client is asked again before the empty answer is believed -- if the read has
        # budget left for another traversal (§7.4 第 5 条).
        if ((@($rows)).Count -eq 0 -and (Test-WalkAllowed $ledger)) {
            Add-HealthProbe $ledger
            if (-not [DshUia.Engine]::ClientHealthy($hwnd)) {
                [DshUia.Engine]::Reset()
                Add-ClientReset $ledger
                $reinit = $true
                Add-WalkHit $ledger
                [DshUia.Engine]::Find($hwnd, $maxNodes, $probePatterns, $wantName, $wantType, $wantId, $wantFilter, [ref]$rows, [ref]$truncated)
            }
        }
        return [ordered]@{
            nodes     = @(ConvertFrom-ComRows $rows)
            truncated = $truncated
            walked    = 0
            skipped   = 0
            mode      = 'find'
            reinit    = $reinit
            # §7.4 第 3 条: which conditions the C# find handed to the provider. Computed from
            # the same inputs and with the same helper the C# uses, so the report cannot drift
            # from what actually happened.
            pushdown  = @(
                if ($wantId -ne '') { 'automationId' }
                elseif ([DshUia.Engine]::IsExactControlType($wantType)) { 'controlType' }
            )
            # A search enumerates on the provider's side, so there is no client-side walk to
            # count -- said out loud rather than reported as "visited nothing" (§7.4 第 2 条).
            traversal = [ordered]@{
                visited = 0; maxQueue = 0; visitBudget = 0; traversalTruncated = $false; elapsedMs = 0; providerSide = $true
                walks = [int]$ledger.Walks; healthProbes = [int]$ledger.HealthProbes; resets = [int]$ledger.Resets; walkCap = [int]$ledger.Cap
            }
        }
    }
    $rows = $null; $walked = 0; $skipped = 0; $truncated = $false
    $visitBudget = Get-VisitBudget $maxNodes $Arg.maxVisited
    $traverseTruncated = $false; $maxQueue = 0; $traverseWatch = [System.Diagnostics.Stopwatch]::StartNew()
    Add-WalkHit $ledger
    [DshUia.Engine]::Walk($hwnd, $maxDepth, $maxNodes, $probePatterns, $skipEmpty, $visitBudget, [ref]$rows, [ref]$walked, [ref]$skipped, [ref]$truncated, [ref]$maxQueue, [ref]$traverseTruncated)
    # The same symptom on the walk path: it walked nodes but could not name one of them.
    if ((@($rows)).Count -eq 0 -and $walked -gt 0 -and (Test-WalkAllowed $ledger)) {
        [DshUia.Engine]::Reset()
        Add-ClientReset $ledger
        $reinit = $true
        $rows = $null; $walked = 0; $skipped = 0; $truncated = $false
        $traverseTruncated = $false; $maxQueue = 0
        Add-WalkHit $ledger
        [DshUia.Engine]::Walk($hwnd, $maxDepth, $maxNodes, $probePatterns, $skipEmpty, $visitBudget, [ref]$rows, [ref]$walked, [ref]$skipped, [ref]$truncated, [ref]$maxQueue, [ref]$traverseTruncated)
    }
    # And the third shape of the same problem: the client answers through the MSAA-to-UIA bridge
    # instead of the application's own provider, so every control comes back as a generic `Pane`
    # with a numeric automation id -- the window's real control types, ids and patterns are gone.
    # It is not a property of the window: the same window reads natively from a fresh client, and
    # it is what a long repeated run eventually produced (measured: 16 rows -> 6, and it stayed
    # that way). Re-created once and re-walked, because the client is the part that is wrong.
    $legacy = Test-LegacyBridgeRows $rows
    if ($legacy -and (Test-WalkAllowed $ledger)) {
        [DshUia.Engine]::Reset()
        Add-ClientReset $ledger
        $reinit = $true
        $rows = $null; $walked = 0; $skipped = 0; $truncated = $false
        $traverseTruncated = $false; $maxQueue = 0
        Add-WalkHit $ledger
        [DshUia.Engine]::Walk($hwnd, $maxDepth, $maxNodes, $probePatterns, $skipEmpty, $visitBudget, [ref]$rows, [ref]$walked, [ref]$skipped, [ref]$truncated, [ref]$maxQueue, [ref]$traverseTruncated)
        $legacy = Test-LegacyBridgeRows $rows
    }
    $traverseWatch.Stop()
    return [ordered]@{
        nodes     = @(ConvertFrom-ComRows $rows)
        truncated = $truncated
        walked    = $walked
        skipped   = $skipped
        mode      = 'tree'
        reinit    = $reinit
        legacy    = $legacy
        # §7.4 第 2 条: what the walk cost, separately from what it returned.
        # §7.4 第 5 条: and how many traversals this one read took in total, so a retry chain
        # cannot become invisible work.
        traversal = [ordered]@{
            visited           = [int]$walked
            maxQueue          = [int]$maxQueue
            visitBudget       = [int]$visitBudget
            traversalTruncated = [bool]$traverseTruncated
            elapsedMs         = [int]$traverseWatch.ElapsedMilliseconds
            walks             = [int]$ledger.Walks
            walkCap           = [int]$ledger.Cap
            healthProbes      = [int]$ledger.HealthProbes
            resets            = [int]$ledger.Resets
        }
    }
}

function Test-LegacyBridgeRows($rows) {
    # The MSAA bridge's signature: generic panes carrying numeric automation ids, and *no
    # patterns anywhere* -- a window's own provider reports the patterns its controls support,
    # while the bridge reports none. (Measured: the real provider's rows carry
    # `window`/`value`/`invoke`/`selectionitem`..., the bridge's rows carry `0p` for every
    # control while the window row itself keeps its one pattern.)
    #
    # The rows here are the C# engine's `Dictionary<string, object>`, so they are read by key:
    # `$row.controlType` on a dictionary silently yields nothing, which is how the first version
    # of this check managed to never fire.
    if ((@($rows)).Count -lt 3) { return $false }
    $panes = 0
    $withPatterns = 0
    foreach ($row in @($rows)) {
        $type = "$($row['controlType'])"
        $id = "$($row['automationId'])"
        $patterns = @($row['patterns'])
        if ($patterns.Count -gt 0) { $withPatterns++ }
        if ($type -eq 'ControlType.Pane' -and $id -match '^[0-9]+$') { $panes++ }
    }
    return ($panes -ge 2 -and $withPatterns -le 1)
}

function Get-VisitBudget([int]$maxNodes, $explicit) {
    # How many nodes the traversal may *visit* (§7.4 第 2 条), which is a different question
    # from how many rows it may return.
    #
    # A caller that names `max_visited` gets exactly that, with 0 meaning "no limit". Without
    # it the budget is derived generously from the output budget: the point is to bound a
    # pathological walk (a tree of anonymous containers that `skip_empty` drops one by one,
    # where the output cap never falls) without truncating any window a person is really
    # looking at. Any truncation it causes is reported (`traversalTruncated`), never silent.
    if ($null -ne $explicit -and "$explicit" -ne '') {
        $asked = 0
        if ([int]::TryParse("$explicit", [ref]$asked)) {
            if ($asked -lt 0) { return 0 }
            return $asked
        }
    }
    return [Math]::Max(20 * $maxNodes, 5000)
}

function New-WalkLedger {
    # One read used to be able to traverse the same window several times over: the walk itself,
    # a re-walk after an in-process client re-creation, a second re-walk when the bridge rows
    # looked legacy, plus two client-health probes -- and then the *host* may restart the whole
    # worker and repeat the read on top of that (§7.4 第 5 条: 控制重试总量). Each of those is
    # a full traversal of a window that may be large, so they are counted in one place and
    # bounded, instead of being added one at a time by whoever needs another retry.
    return [pscustomobject]@{
        Walks        = 0
        Cap          = 3
        HealthProbes = 0
        Resets       = 0
    }
}

function Test-WalkAllowed($ledger) {
    if ($null -eq $ledger) { return $true }
    return ($ledger.Walks -lt $ledger.Cap)
}

function Add-WalkHit($ledger) {
    if ($null -ne $ledger) { $ledger.Walks++ }
}

function Add-HealthProbe($ledger) {
    if ($null -ne $ledger) { $ledger.HealthProbes++ }
}

function Add-ClientReset($ledger) {
    if ($null -ne $ledger) { $ledger.Resets++ }
}

function Reset-WalkCounters {
    # Per request, not per worker: the budget is about how much one *read* may cost, and a long
    # session is allowed many reads.
    $script:WalkLedger = New-WalkLedger
}

$script:WalkLedger = $null

# ---------------------------------------------------------------------------
# Element refs: the identity layer.#
# Name/type/index addressing has one failure mode that is worse than a refusal:
# when the tree changes under the caller, the same index can land on a different
# control and the action succeeds against the wrong target. A ref pins what was
# read: it names a node in a snapshot, and it carries enough identity -- the
# ancestor path, the automation id, the control type, the rectangle -- to find
# that node again after the tree has moved.
#
# The registry is per worker process. A ref from before a worker restart is not
# silently re-guessed: it is refused with a code that says to read the tree again.
# ---------------------------------------------------------------------------
$script:ElementRegistry = @{}
$script:SnapshotSeq = 0
# Refs are cheap; the cap only exists so a long session cannot grow unbounded.
$script:ElementRegistryCap = 4000
# How many snapshots back the registry keeps.
#
# Enforced on every snapshot, not only when the capacity is hit. Dropping old
# observations only at the cap made the age meaningless -- a session could hold a
# hundred snapshots and then lose most of them in one read -- and it made the
# documented lifetime ("the most recent N") untrue.
$script:SnapshotKeep = 64

function Get-NodeToken($node) {
    # One path segment: the automation id when there is one (it is the stable name
    # a provider gives), otherwise the control type plus the label.
    #
    # A node with no id and no label contributes nothing. That matters: the ref is
    # registered from a filtered read and re-resolved from an unfiltered one, and an
    # anonymous ancestor is present in one and absent from the other. Leaving it out
    # of the path is what makes the two reads agree on where an element sits.
    $id = "$($node['automationId'])"
    if ($id -ne '') { return 'i:' + $id }
    $label = "$($node['name'])"
    if ($label -eq '') { return '' }
    if ($label.Length -gt 24) { $label = $label.Substring(0, 24) }
    return 't:' + "$($node['controlType'])" + '/' + $label
}

function Get-RowKey($row, [string]$path) {
    # What makes two reads describe "the same node".
    #
    # The automation id when the provider gives one -- that is the stable name. Otherwise
    # the path plus the type and the class, and deliberately *not* the label: a control
    # whose text changed is the same control with new text, and reporting it as one
    # removal plus one addition would hide that.
    # The id alone is not enough: Notepad's status bar gives all six of its cells the same
    # automation id, and keying on it made five of them compare against the wrong node --
    # an immediate repeat read reported fourteen elements "moved". The caller appends the
    # ordinal among same-key siblings, which is what makes the key unique within a read.
    $id = "$($row['automationId'])"
    if ($id -ne '') { return 'id:' + $id }
    return 'p:' + $path + '|' + "$($row['controlType'])" + '|' + "$($row['className'])"
}

function New-ElementSnapshot($nodes, [int64]$hwnd, [int]$ownerPid) {
    # Stamp every node with a ref and register what it takes to find that node
    # again. Returns the snapshot id.
    #
    # The id carries this worker's random startup generation ("s7k2q12"): refs are
    # handed out in a per-worker counter, so without the generation a ref minted
    # before a restart could be a *well-formed ref of this worker* that names a
    # different element which happens to sit in the same slot now. That is precisely
    # the wrong-target action refs exist to prevent, so the generation is part of the
    # identity and a mismatch is reported as its own case.
    $script:SnapshotSeq++
    $snapshot = "s$($script:BootGen)$($script:SnapshotSeq)"
    $chain = New-Object System.Collections.Generic.List[string]
    $keyCounts = @{}
    for ($i = 0; $i -lt $nodes.Count; $i++) {
        $node = $nodes[$i]
        $depth = [int]$node['depth']
        while ($chain.Count -gt $depth) { $chain.RemoveAt($chain.Count - 1) }
        # Depth is the node's real depth in the tree, and a skipped ancestor leaves a
        # hole in it. Without this padding, $chain[$depth] would be an out-of-range
        # write on the first tree that has one.
        while ($chain.Count -lt $depth) { $chain.Add('') }
        $path = (($chain | Where-Object { $_ -ne '' }) -join '>')
        $ref = "$snapshot.$i"
        # Two siblings can carry the same identity -- six status-bar cells with one
        # automation id -- so the key carries the ordinal among them.
        $baseKey = Get-RowKey $node $path
        $ordinal = 0
        if ($keyCounts.ContainsKey($baseKey)) { $ordinal = $keyCounts[$baseKey] }
        $keyCounts[$baseKey] = $ordinal + 1
        $script:ElementRegistry[$ref] = [ordered]@{
            snapshot     = $snapshot
            # Kept explicitly rather than parsed back out of the id, because the id now
            # carries a generation and pruning must not depend on its spelling.
            seq          = $script:SnapshotSeq
            hwnd         = $hwnd
            pid          = $ownerPid
            depth        = $depth
            path         = $path
            key          = ($baseKey + '#' + $ordinal)
            automationId = "$($node['automationId'])"
            name         = "$($node['name'])"
            controlType  = "$($node['controlType'])"
            className    = "$($node['className'])"
            enabled      = [bool]$node['enabled']
            offscreen    = [bool]$node['offscreen']
            patterns     = @($node['patterns'])
            x            = [int]$node['x']
            y            = [int]$node['y']
            width        = [int]$node['width']
            height       = [int]$node['height']
        }
        $node['ref'] = $ref
        $token = Get-NodeToken $node
        if ($chain.Count -eq $depth) { $chain.Add($token) } else { $chain[$depth] = $token }
    }
    $floor = $script:SnapshotSeq - $script:SnapshotKeep
    if ($floor -gt 0) {
        foreach ($key in @($script:ElementRegistry.Keys)) {
            $entry = $script:ElementRegistry[$key]
            if ($null -ne $entry -and [int]$entry.seq -le $floor) { $script:ElementRegistry.Remove($key) }
        }
    }
    return $snapshot
}

# ---------------------------------------------------------------------------
# What the model has to read.
#
# A walk reports what the provider exposes, and providers expose a great deal that
# nobody can use: layout scaffolding with no name, no automation id and no size;
# forty consecutive chapter timestamps; a wall of anonymous images. On a real
# browser window that is what the node budget gets spent on, and the control the
# caller wanted never makes it into the answer.
#
# Three shape-preserving passes fix that. Shape-preserving is the constraint that
# matters: the tree is rendered with indentation, so a pass that deletes a node
# without dealing with its children turns the indentation into a lie.
#
#   1. anonymous zero-area scaffolding is dropped, and its children are re-parented
#      (their depth is decremented, so the tree still renders correctly);
#   2. a run of similar siblings collapses into one row that says how many it stands
#      for -- anonymous runs of the same type/class/size, and runs of plain numeric
#      text (timestamps, dates, counts);
#   3. if the result still exceeds the budget, the highest-priority rows win, and the
#      ancestors of every survivor are kept so no row floats free of its context.
#
# Invariants, asserted in the live suite: a node with an automation id is never
# dropped, a node with a pattern is never dropped, and no named node is ever
# swallowed by a collapse that does not say how many rows it stands for.
# ---------------------------------------------------------------------------
function Test-RowAnonymous($row) {
    return ("$($row['name'])" -eq '') -and ("$($row['automationId'])" -eq '') -and (@($row['patterns']).Count -eq 0)
}

function Test-RowNumericName([string]$name) {
    # Timestamps, dates, plain counts: content that carries no meaning as a label.
    if ($name -eq '' -or $name.Length -gt 24) { return $false }
    return ($name -match '^[0-9][0-9:.\-/ %]*$')
}

function Get-RowPriority($row, [int]$maxDepth) {
    $score = 0.0
    if ("$($row['automationId'])" -ne '') { $score += 1000 }
    if (@($row['patterns']).Count -gt 0) { $score += 800 }
    $type = "$($row['controlType'])"
    if ($type -match 'Button|Edit|ListItem|MenuItem|CheckBox|ComboBox|Hyperlink|Tab|Slider|TreeItem|RadioButton|Spinner|SplitButton') { $score += 600 }
    if ("$($row['name'])" -ne '') { $score += 300 }
    if ($row['enabled'] -eq $true -and $row['offscreen'] -ne $true) { $score += 100 }
    $area = [double]$row['width'] * [double]$row['height']
    if ($area -gt 0) { $score += [Math]::Min(200, $area / 5000) }
    $score -= 60 * [int]$row['depth']
    return $score
}

function Get-RowLeafFlags($rows) {
    # A row is a leaf when nothing after it is deeper than it is. Shared by every pass
    # that needs to tell "a run of siblings" from "a run of subtrees".
    $count = $rows.Count
    $leaf = New-Object 'bool[]' $count
    $deepestAfter = -1
    for ($i = $count - 1; $i -ge 0; $i--) {
        $d = [int]$rows[$i]['depth']
        $leaf[$i] = ($deepestAfter -le $d)
        if ($d -gt $deepestAfter) { $deepestAfter = $d }
    }
    return $leaf
}

function Test-RowTextOnly($row, [bool]$leaf) {
    # A leaf whose entire content is its text: nothing to click, nothing below it.
    if (-not $leaf) { return $false }
    if (@($row['patterns']).Count -gt 0) { return $false }
    if ("$($row['controlType'])" -notmatch 'Text$') { return $false }
    return ("$($row['name'])" -ne '')
}

function Get-TextRunSeparator() {
    # What separates the pieces once a run is one row.
    #
    # The reference pipeline has three separators here because it also absorbs nameless
    # interactive fragments into runs -- a choice list joins with '; '. This plugin does
    # not absorb those (a control with a pattern is never dropped, so that the caller can
    # still click it), which leaves exactly one reachable case: static text, joined with a
    # space. The parameter went with the other two rather than staying as a branch that
    # nothing can take.
    return ' '
}

function Merge-UiTextRuns($rows) {
    # Consecutive text-only siblings become one row whose name is their text joined.
    #
    # The reason is worth stating: a status bar, a table row, a form's label column are
    # not thirty things to act on, they are one line to read -- and thirty rows of it
    # costs the caller both tokens and attention. Merging keeps the text (unlike
    # collapsing a run into "x30"), so nothing is hidden: it is one row that says what
    # all thirty said.
    #
    # Deliberately narrower than the reference: a nameless but clickable control is left
    # alone. An unnamed icon button inside a text run is noise, but it is also something
    # the caller may need to click, and this plugin's pruning never drops a node that
    # carries a pattern.
    $count = $rows.Count
    if ($count -lt 2) { return @($rows) }
    $leaf = Get-RowLeafFlags $rows
    $out = New-Object System.Collections.Generic.List[object]
    $i = 0
    while ($i -lt $count) {
        if (Test-RowTextOnly $rows[$i] $leaf[$i]) {
            $depth = [int]$rows[$i]['depth']
            $end = $i
            while ($end + 1 -lt $count -and $leaf[$end + 1] -and
                   [int]$rows[$end + 1]['depth'] -eq $depth -and
                   (Test-RowTextOnly $rows[$end + 1] $leaf[$end + 1])) { $end++ }
            $run = $end - $i + 1
            if ($run -ge 2) {
                $separator = Get-TextRunSeparator
                $parts = New-Object System.Collections.Generic.List[string]
                for ($k = $i; $k -le $end; $k++) { $parts.Add("$($rows[$k]['name'])") }
                $row = $rows[$i]
                $joined = ($parts -join $separator)
                # A single row's name has no other bound, and a long list of labels would
                # otherwise become one enormous row. The cut is marked and the count stays
                # on the row, so what was dropped is stated rather than hidden; the caller
                # can still read any one of them with get_text.
                if ($joined.Length -gt $MAX_MERGED_NAME) {
                    $row['name'] = $joined.Substring(0, $MAX_MERGED_NAME) + ' ...'
                    # Named for what it is. A bare `truncated` on a row would read as the
                    # state-level `truncated` (the node budget ran out) sitting in the same
                    # payload, which means something else entirely.
                    $row['mergedTruncated'] = $true
                } else {
                    $row['name'] = $joined
                }
                $row['merged'] = $run
                $out.Add($row)
                $i = $end + 1
                continue
            }
        }
        $out.Add($rows[$i])
        $i++
    }
    return $out
}

function Test-RowPassThrough($row) {
    # Nothing to name it, nothing to address it by, nothing to click: whatever it wraps,
    # it is a wrapper.
    if ("$($row['name'])" -ne '') { return $false }
    if ("$($row['automationId'])" -ne '') { return $false }
    if (@($row['patterns']).Count -gt 0) { return $false }
    return $true
}

function Collapse-UiPassThroughChains($rows) {
    # A pass-through with exactly one child is a level of nesting that says nothing, and
    # these come in chains -- a pane inside a group inside a custom control, each with a
    # single child, is four rows of indentation before anything the caller can use. The
    # Flattening them removes that, and depth is re-derived so the tree that comes out
    # is still a tree.
    $current = $rows
    for ($round = 0; $round -lt 16; $round++) {
        $count = $current.Count
        if ($count -lt 2) { break }
        $drop = New-Object 'bool[]' $count
        $changed = $false
        for ($i = 0; $i -lt $count; $i++) {
            if (-not (Test-RowPassThrough $current[$i])) { continue }
            $d = [int]$current[$i]['depth']
            $children = 0
            for ($j = $i + 1; $j -lt $count -and [int]$current[$j]['depth'] -gt $d; $j++) {
                if ([int]$current[$j]['depth'] -eq ($d + 1)) { $children++ }
            }
            if ($children -eq 1) { $drop[$i] = $true; $changed = $true }
        }
        if (-not $changed) { break }
        $next = New-Object System.Collections.Generic.List[object]
        $dropped = New-Object System.Collections.Generic.List[int]
        for ($i = 0; $i -lt $count; $i++) {
            $d = [int]$current[$i]['depth']
            while ($dropped.Count -gt 0 -and $dropped[$dropped.Count - 1] -ge $d) { $dropped.RemoveAt($dropped.Count - 1) }
            if ($drop[$i]) { $dropped.Add($d); continue }
            $current[$i]['depth'] = $d - $dropped.Count
            $next.Add($current[$i])
        }
        $current = $next
    }
    return $current
}
function Optimize-UiRows($rows, [int]$maxNodes) {
    $count = $rows.Count
    if ($count -le 1) { return @{ nodes = @($rows); pruned = 0 } }

    # Leaves in the reported tree, in one backward pass: a row is a leaf when nothing
    # after it is deeper than it is.
    $leaf = New-Object 'bool[]' $count
    $deepestAfter = -1
    for ($i = $count - 1; $i -ge 0; $i--) {
        $d = [int]$rows[$i]['depth']
        $leaf[$i] = ($deepestAfter -le $d)
        if ($d -gt $deepestAfter) { $deepestAfter = $d }
    }

    $drop = New-Object 'bool[]' $count
    for ($i = 1; $i -lt $count; $i++) {
        if ((Test-RowAnonymous $rows[$i]) -and ([int]$rows[$i]['width'] -le 0 -or [int]$rows[$i]['height'] -le 0)) { $drop[$i] = $true }
    }

    # Rebuild with re-parented depths.
    $kept = New-Object System.Collections.Generic.List[object]
    $flags = New-Object System.Collections.Generic.List[int]
    for ($i = 0; $i -lt $count; $i++) {
        $d = [int]$rows[$i]['depth']
        while ($flags.Count -gt $d) { $flags.RemoveAt($flags.Count - 1) }
        while ($flags.Count -lt $d) { $flags.Add(0) }
        $lost = 0
        for ($k = 0; $k -lt $flags.Count; $k++) { $lost += $flags[$k] }
        if ($drop[$i]) {
            if ($flags.Count -eq $d) { $flags.Add(1) } else { $flags[$d] = 1 }
            continue
        }
        if ($flags.Count -eq $d) { $flags.Add(0) } else { $flags[$d] = 0 }
        $rows[$i]['depth'] = $d - $lost
        $kept.Add($rows[$i])
    }

    # The two shaping passes the reference pipeline runs here, in its order: merge runs of
    # text-only siblings into one row that keeps their text, then collapse pass-through
    # wrappers. Both are pure functions over the row list, so the prune hook can test them.
    $kept = Merge-UiTextRuns $kept
    $kept = Collapse-UiPassThroughChains $kept

    # Leaves of the rebuilt list, for the collapse rules.
    $keptCount = $kept.Count
    $keptLeaf = New-Object 'bool[]' $keptCount
    $deepestAfter = -1
    for ($i = $keptCount - 1; $i -ge 0; $i--) {
        $d = [int]$kept[$i]['depth']
        $keptLeaf[$i] = ($deepestAfter -le $d)
        if ($d -gt $deepestAfter) { $deepestAfter = $d }
    }

    $collapsed = New-Object System.Collections.Generic.List[object]
    $i = 0
    while ($i -lt $keptCount) {
        $row = $kept[$i]
        $depth = [int]$row['depth']
        $type = "$($row['controlType'])"
        $class = "$($row['className'])"
        $w = [int]$row['width']; $h = [int]$row['height']
        $end = $i
        while ($end + 1 -lt $keptCount -and $keptLeaf[$end + 1] -and
               [int]$kept[$end + 1]['depth'] -eq $depth -and
               "$($kept[$end + 1]['controlType'])" -eq $type -and
               "$($kept[$end + 1]['className'])" -eq $class -and
               [int]$kept[$end + 1]['width'] -eq $w -and [int]$kept[$end + 1]['height'] -eq $h) { $end++ }
        $run = $end - $i + 1

        $collapse = $false
        if ($run -ge 4) {
            $allAnonymous = $true
            for ($k = $i; $k -le $end; $k++) { if (-not (Test-RowAnonymous $kept[$k])) { $allAnonymous = $false; break } }
            if ($allAnonymous) { $collapse = $true }
        }
        if (-not $collapse -and $run -ge 6) {
            # Plain numeric runs only: a menu of six different labels must survive.
            $allNumeric = $true
            for ($k = $i; $k -le $end; $k++) { if (-not (Test-RowNumericName "$($kept[$k]['name'])")) { $allNumeric = $false; break } }
            if ($allNumeric) { $collapse = $true }
        }

        if ($collapse) {
            $row['repeated'] = $run
            $collapsed.Add($row)
            $i = $end + 1
        } else {
            $collapsed.Add($row)
            $i++
        }
    }

    $final = $collapsed
    if ($collapsed.Count -gt $maxNodes) {
        # Rank, keep the ancestors of every survivor, then emit in tree order.
        $scored = New-Object System.Collections.Generic.List[object]
        for ($k = 0; $k -lt $collapsed.Count; $k++) {
            $scored.Add([pscustomobject]@{ index = $k; score = (Get-RowPriority $collapsed[$k] 6) })
        }
        $ranked = @($scored | Sort-Object -Property score -Descending | Select-Object -First $maxNodes)
        $keep = New-Object 'bool[]' $collapsed.Count
        foreach ($entry in $ranked) { $keep[$entry.index] = $true }
        # Ancestors: walk back from each survivor to the nearest row with a smaller depth.
        for ($k = 0; $k -lt $collapsed.Count; $k++) {
            if (-not $keep[$k]) { continue }
            $need = [int]$collapsed[$k]['depth']
            for ($j = $k - 1; $j -ge 0 -and $need -gt 0; $j--) {
                $jd = [int]$collapsed[$j]['depth']
                if ($jd -lt $need) { $keep[$j] = $true; $need = $jd }
            }
        }
        $final = New-Object System.Collections.Generic.List[object]
        for ($k = 0; $k -lt $collapsed.Count; $k++) { if ($keep[$k]) { $final.Add($collapsed[$k]) } }
    }

    return @{ nodes = @($final.ToArray()); pruned = ($count - $final.Count) }
}

function Get-SnapshotEntries([string]$snapshot, [int64]$hwnd) {
    # Everything the registry still holds for one snapshot of one window.
    $entries = New-Object System.Collections.Generic.List[object]
    $prefix = "$snapshot."
    foreach ($key in $script:ElementRegistry.Keys) {
        if (-not $key.StartsWith($prefix, [System.StringComparison]::Ordinal)) { continue }
        $entry = $script:ElementRegistry[$key]
        if ($hwnd -ne 0 -and [int64]$entry.hwnd -ne $hwnd) { continue }
        $entries.Add($entry)
    }
    return $entries
}

function New-TreeDelta($nodes, $entries, [string]$base) {
    # What changed since the snapshot the caller read.
    #
    # "Same" is decided on identity, then on what a caller can actually act on: the
    # rectangle, whether it is enabled, whether it is on screen, and the patterns it
    # offers. A node that is there with a different label is *changed*, not replaced --
    # that is the difference between "the button was renamed" and "a different button
    # is here now", and only the second one should make a caller re-plan.
    $byKey = @{}
    foreach ($entry in $entries) {
        if (-not $byKey.ContainsKey($entry.key)) { $byKey[$entry.key] = $entry }
    }
    $seen = @{}
    $changed = New-Object System.Collections.Generic.List[object]
    $same = 0
    foreach ($node in $nodes) {
        # The key the registration just minted, so the two sides of the comparison are
        # built by exactly the same rule. A supplied reading may carry the key itself,
        # which is what makes this function testable on trees that never came from a
        # window (see Do-Delta).
        $key = ''
        if ("$($node['key'])" -ne '') { $key = "$($node['key'])" }
        elseif ("$($node['ref'])" -ne '') {
            $entry = $script:ElementRegistry["$($node['ref'])"]
            if ($null -ne $entry) { $key = "$($entry.key)" }
        }
        if ($key -eq '') { continue }
        $seen[$key] = $true
        $before = $null
        if ($byKey.ContainsKey($key)) { $before = $byKey[$key] }
        if ($null -eq $before) { $node['delta'] = 'added'; $changed.Add($node); continue }
        $moved = ([int]$before.x -ne [int]$node['x']) -or ([int]$before.y -ne [int]$node['y']) -or
                 ([int]$before.width -ne [int]$node['width']) -or ([int]$before.height -ne [int]$node['height'])
        # "Changed" has to cover everything a caller acts on, not just the label. A
        # button that became disabled, a row that scrolled off screen, a control that
        # gained or lost a pattern -- those are the changes that decide whether the
        # next action is allowed, and a delta that reported them as "unchanged" was
        # telling the model to go ahead on stale state.
        $altered = ("$($before.name)" -ne "$($node['name'])") -or ("$($before.className)" -ne "$($node['className'])") -or
                   ([bool]$before.enabled -ne [bool]$node['enabled']) -or ([bool]$before.offscreen -ne [bool]$node['offscreen']) -or
                   ((@($before.patterns) -join ',') -ne (@($node['patterns']) -join ','))
        if ($moved) { $node['delta'] = 'moved'; $changed.Add($node) }
        elseif ($altered) { $node['delta'] = 'changed'; $changed.Add($node) }
        else { $same++ }
    }
    # Second pass for the leftovers.
    #
    # A node with no automation id is keyed partly by the labels of its ancestors, so a
    # change high up -- a window title, say -- re-keys its whole subtree and every
    # untouched button below it would read as one removal plus one addition. That is the
    # kind of noise that makes a delta useless. So whatever the keys failed to pair is
    # paired again on what a caller would recognise: the type, the class and the label.
    $pendingAdded = New-Object System.Collections.Generic.List[object]
    $keptRows = New-Object System.Collections.Generic.List[object]
    foreach ($node in $changed) {
        if ("$($node['delta'])" -eq 'added') { $pendingAdded.Add($node) } else { $keptRows.Add($node) }
    }
    $bySig = @{}
    foreach ($entry in $entries) {
        if ($seen.ContainsKey($entry.key)) { continue }
        $sig = "$($entry.controlType)|$($entry.className)|$($entry.name)"
        if (-not $bySig.ContainsKey($sig)) { $bySig[$sig] = New-Object System.Collections.Generic.List[object] }
        $bySig[$sig].Add($entry)
    }
    $stillAdded = New-Object System.Collections.Generic.List[object]
    foreach ($node in $pendingAdded) {
        $sig = "$($node['controlType'])|$($node['className'])|$($node['name'])"
        if (-not $bySig.ContainsKey($sig) -or $bySig[$sig].Count -eq 0) { $stillAdded.Add($node); continue }
        $before = $bySig[$sig][0]
        $bySig[$sig].RemoveAt(0)
        $moved = ([int]$before.x -ne [int]$node['x']) -or ([int]$before.y -ne [int]$node['y']) -or
                 ([int]$before.width -ne [int]$node['width']) -or ([int]$before.height -ne [int]$node['height'])
        $altered = ([bool]$before.enabled -ne [bool]$node['enabled']) -or ([bool]$before.offscreen -ne [bool]$node['offscreen']) -or
                   ((@($before.patterns) -join ',') -ne (@($node['patterns']) -join ','))
        if ($moved) { $node['delta'] = 'moved'; $keptRows.Add($node) }
        elseif ($altered) { $node['delta'] = 'changed'; $keptRows.Add($node) }
        else { $same++ }
    }
    $changed = $keptRows
    foreach ($node in $stillAdded) { $changed.Add($node) }

    $removed = New-Object System.Collections.Generic.List[object]
    foreach ($entry in $entries) {
        if ($seen.ContainsKey($entry.key)) { continue }
        $sig = "$($entry.controlType)|$($entry.className)|$($entry.name)"
        if ($bySig.ContainsKey($sig) -and $bySig[$sig].Count -gt 0) { continue }
        $removed.Add([ordered]@{ ref = "$($entry.snapshot).?"; name = $entry.name; controlType = $entry.controlType })
    }
    $counts = [ordered]@{
        base    = $base
        known   = $true
        added   = @($changed | Where-Object { "$($_['delta'])" -eq 'added' }).Count
        moved   = @($changed | Where-Object { "$($_['delta'])" -eq 'moved' }).Count
        altered = @($changed | Where-Object { "$($_['delta'])" -eq 'changed' }).Count
        removed = $removed.Count
        same    = $same
    }
    if ($removed.Count -gt 0) { $counts.removedNodes = @($removed | Select-Object -First 20) }
    return @{ counts = $counts; nodes = @($changed.ToArray()) }
}

function Complete-UiTree($payload, [bool]$register, [bool]$prune = $true, [string]$since = '') {
    if ($prune -and "$($payload.mode)" -eq 'tree' -and @($payload.nodes).Count -gt 1) {
        $optimized = Optimize-UiRows @($payload.nodes) ([int]$payload.maxNodes)
        $payload.nodes = @($optimized.nodes)
        if ($optimized.pruned -gt 0) { $payload.pruned = [int]$optimized.pruned }
    }
    if ($register) {
        $hwnd = 0
        if ($null -ne $payload.window) { $hwnd = [int64]$payload.window.hwnd }
        # Not $pid: that name is a read-only automatic variable in PowerShell (the current
        # process id), and variable names are case-insensitive.
        $ownerPid = 0
        if ($null -ne $payload.window) { $ownerPid = [int]$payload.window.pid }
        $payload.snapshot = New-ElementSnapshot @($payload.nodes) $hwnd $ownerPid
        if ($since -ne '') {
            # A delta is expressed against a snapshot this worker still holds. An older
            # one -- minted before a restart, or pruned -- is not guessed at: the full
            # tree comes back and the delta says it did not know the base.
            $entries = Get-SnapshotEntries $since $hwnd
            if ($entries.Count -gt 0) {
                $delta = New-TreeDelta @($payload.nodes) $entries $since
                $payload.delta = $delta.counts
                $payload.nodes = @($delta.nodes)
            } else {
                $payload.delta = [ordered]@{ base = $since; known = $false; added = 0; moved = 0; altered = 0; removed = 0; same = 0 }
            }
        }
    }
    return $payload
}

# ---------------------------------------------------------------------------
# Text observation (8.txt §5 / B1)
#
# One state read can carry the text a caller would otherwise spend a second call on:
# what the focused control says, what is selected inside it, and -- only when asked
# for -- the document behind it. Every field shares ONE character budget, because
# "one call fewer" only pays off while the reply does not grow by a whole context
# window instead.
#
# Everything below is opt-in. With no `text` in the request none of it runs: no UI
# Automation client assembly is loaded, no provider is asked for a pattern, and the
# reply is byte-for-byte the one this read produced before.
#
# Failure is reported, never laundered into an empty string: a field that could not be
# read says `unsupported` / `unavailable` / `target_required` / `budget_exhausted`, and
# an empty selection says that nothing is selected. "We could not read it" and "it is
# empty" are different facts, and only one of them is worth retrying.

$script:TextBudgetDefault = 2000
$script:TextBudgetMax = 16000
$script:FocusedSummaryDefault = 256
$script:FocusedSummaryMax = 1024
$script:SelectedItemsDefault = 20
$script:SelectedItemsMax = 100

function Get-ArgMember($Object, [string]$Name) {
    # JSON arrives as a PSCustomObject, the batch dispatcher builds hashtables, and both
    # spellings have to answer "is this member there, and what is it" the same way.
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) { return $Object[$Name] }
        return $null
    }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-TextObservationConfig($spec) {
    # $null means "text was not asked for"; anything else is read as the four flags.
    if ($null -eq $spec) { return $null }
    $base = $spec
    if ($base -is [System.Management.Automation.PSObject]) { $base = $base.PSObject.BaseObject }
    $config = [ordered]@{ focused = $false; selection = $false; document = $false; selected = $false }
    $stated = 0
    if ($base -is [bool]) {
        # `text: true` is the cheap pair: the two fields that answer "what am I about to
        # type into, and what is selected there". Reading the whole document is a read of
        # its own and stays behind an explicit flag.
        if ([bool]$base) { $config['focused'] = $true; $config['selection'] = $true }
        return $config
    }
    if ($base -is [string]) {
        foreach ($name in @('focused', 'selection', 'document', 'selected')) {
            if ("$base".ToLowerInvariant() -eq $name) { $config[$name] = $true }
        }
        return $config
    }
    foreach ($name in @('focused', 'selection', 'document', 'selected')) {
        $value = Get-ArgMember $spec $name
        if ($null -eq $value) { continue }
        $stated++
        $config[$name] = [bool]$value
    }
    if ($stated -eq 0) {
        # `text: {}` is the documented "cheap pair": the caller asked for text without saying
        # which fields, and the focused control plus its selection is what answers the next
        # question. An explicitly stated `false` is respected, which is why this is counted
        # rather than inferred from the resulting flags.
        $config['focused'] = $true
        $config['selection'] = $true
    }
    return $config
}

function New-TextBudget($Arg) {
    # One budget for every text field in this read. Defaults are the engineering values of
    # §5; the cap is what keeps a caller from asking for a 100 000-character document one
    # call at a time.
    $max = $script:TextBudgetDefault
    $requested = Get-ArgMember $Arg 'maxTextChars'
    if ($null -ne $requested) {
        $parsed = 0
        if ([int]::TryParse("$requested", [ref]$parsed) -and $parsed -gt 0) { $max = $parsed }
    }
    if ($max -gt $script:TextBudgetMax) { $max = $script:TextBudgetMax }
    return [ordered]@{ max = $max; used = 0; truncated = $false }
}

function Get-BudgetRemaining($budget) {
    $left = [int]$budget['max'] - [int]$budget['used']
    if ($left -lt 0) { return 0 }
    return $left
}

function Split-TextAtBudget([string]$Text, [int]$Limit) {
    # Two rules in one place: a field is clipped to what the budget still has, and the cut
    # never lands between the halves of a character outside the Basic Multilingual Plane --
    # a lone surrogate is not text anybody can read back.
    $result = [ordered]@{ text = ''; truncated = $false }
    if ($null -eq $Text) { return $result }
    if ($Limit -le 0) {
        $result['truncated'] = ($Text.Length -gt 0)
        return $result
    }
    if ($Text.Length -le $Limit) {
        $result['text'] = $Text
        return $result
    }
    $cut = $Limit
    if ([char]::IsHighSurrogate($Text[$cut - 1])) { $cut = $cut - 1 }
    $result['text'] = $Text.Substring(0, $cut)
    $result['truncated'] = $true
    return $result
}

function Add-BudgetedText($entry, [string]$Text, $budget) {
    # Put one text field into a receipt entry, spending the shared budget. An exhausted
    # budget is reported as its own status rather than as an empty value, so the caller can
    # tell "there was nothing to read" from "this call had already spent its allowance".
    $remaining = Get-BudgetRemaining $budget
    if ($remaining -le 0 -and $Text.Length -gt 0) {
        $entry['status'] = 'budget_exhausted'
        $entry['note'] = "the shared text budget ($($budget['max']) chars) was already spent by the fields before this one"
        $budget['truncated'] = $true
        return $entry
    }
    $clip = Split-TextAtBudget $Text $remaining
    $entry['value'] = $clip['text']
    if ($clip['truncated']) {
        $entry['truncated'] = $true
        $budget['truncated'] = $true
    }
    $budget['used'] = [int]$budget['used'] + $clip['text'].Length
    return $entry
}

function Read-UiaRangeText($range, $budget) {
    # GetText(limit + 1) is how "is there more" is answered without pulling the whole
    # document across the process boundary first and truncating afterwards.
    $remaining = Get-BudgetRemaining $budget
    $entry = [ordered]@{ status = 'ok'; value = '' }
    if ($remaining -le 0) {
        $entry['status'] = 'budget_exhausted'
        $entry['note'] = "the shared text budget ($($budget['max']) chars) was already spent by the fields before this one"
        $budget['truncated'] = $true
        return $entry
    }
    $raw = ''
    try { $raw = [string]$range.GetText($remaining + 1) } catch {
        $entry['status'] = 'failed'
        $entry['note'] = $_.Exception.Message
        return $entry
    }
    return Add-BudgetedText $entry $raw $budget
}

function Test-UiaCurrentPattern($el, $Pattern) {
    $probe = $null
    try { return $el.TryGetCurrentPattern($Pattern, [ref]$probe) } catch { return $false }
}

function Get-UiaCurrentPattern($el, $Pattern) {
    # A cached pattern object is not a licence to read cached properties: the two caches are
    # separate, so this asks for the pattern and then reads Current on purpose.
    $probe = $null
    try { if ($el.TryGetCurrentPattern($Pattern, [ref]$probe)) { return $probe } } catch { }
    return $null
}

function Get-UiaElementWindowHwnd($el) {
    # Which top-level window this element belongs to. The focused element can be anywhere on
    # the desktop, and folding another window's caret into this read would be a silent
    # wrong-window answer, so the caller compares this against the window it read.
    try {
        $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
        $node = $el
        for ($hop = 0; $hop -lt 64; $hop++) {
            $parent = $walker.GetParent($node)
            if ($null -eq $parent) { break }
            $node = $parent
        }
        return [int64]$node.Current.NativeWindowHandle
    } catch { return [int64]0 }
}

function Get-UiaElementValueText($el) {
    # The value a control holds, when it has one. $null means "this control has no value to
    # report", which is not the same answer as "the value is empty".
    $pattern = Get-UiaCurrentPattern $el ([System.Windows.Automation.ValuePattern]::Pattern)
    if ($null -eq $pattern) { return $null }
    try { return [string]([System.Windows.Automation.ValuePattern]$pattern).Current.Value } catch { return $null }
}

function Format-UiaElementLine($el) {
    # The same "Type · Name" line the tree rows read as, so a focused control named in the
    # text block is recognisably the same row the caller saw in the tree.
    try {
        $info = $el.Current
        $type = "$($info.ControlType.ProgrammaticName)".Replace('ControlType.', '')
        $name = "$($info.Name)"
        if ($name -eq '') { return $type }
        return "$type · $name"
    } catch { return '' }
}

function Get-UiaSelectionSummaries($el, [int]$Max) {
    # SelectionPattern.GetSelection() is bounded by definition: a list hands back the items
    # it has selected, not its whole contents. That is what makes "what is selected here"
    # cheap enough to fold into a read.
    $out = [ordered]@{ status = 'unsupported'; items = @(); count = 0; truncated = $false; note = '' }
    $pattern = Get-UiaCurrentPattern $el ([System.Windows.Automation.SelectionPattern]::Pattern)
    if ($null -eq $pattern) {
        $out['note'] = 'this control does not implement SelectionPattern, so it has no selected items to list'
        return $out
    }
    $items = $null
    try { $items = ([System.Windows.Automation.SelectionPattern]$pattern).Current.GetSelection() } catch {
        $out['status'] = 'failed'
        $out['note'] = $_.Exception.Message
        return $out
    }
    $out['status'] = 'ok'
    if ($null -eq $items) { return $out }
    $all = @($items)
    $out['count'] = $all.Count
    if ($all.Count -gt $Max) { $out['truncated'] = $true }
    $lines = @()
    foreach ($item in @($all | Select-Object -First $Max)) { $lines += (Format-UiaElementLine $item) }
    $out['items'] = $lines
    return $out
}

function Test-UiaElementMatchesRow($el, $row) {
    # A row-derived candidate is only used once the element it resolved to is verified to be
    # that row: the row and the element are found by different enumerations, and reading a
    # look-alike would report one control's text as another's.
    try {
        $info = $el.Current
        if ("$($info.ControlType.ProgrammaticName)" -ne "$($row['controlType'])") { return $false }
        $rowId = "$($row['automationId'])"
        if ($rowId -ne '' -and "$($info.AutomationId)" -ne $rowId) { return $false }
        $rowName = "$($row['name'])"
        if ($rowName -ne '' -and "$($info.Name)" -ne $rowName) { return $false }
    } catch { return $false }
    return $true
}

function Find-TreeRowForElement($el, $Rows) {
    # Which row of THIS read the element is. That is what lets the reply carry a ref the next
    # call can act on, instead of making the caller match the text to a row by hand.
    if ($null -eq $Rows) { return $null }
    $rows = @($Rows)
    if ($rows.Count -eq 0) { return $null }
    $automationId = ''; $name = ''; $type = ''
    $cx = 0; $cy = 0
    try {
        $info = $el.Current
        $automationId = "$($info.AutomationId)"
        $name = "$($info.Name)"
        $type = "$($info.ControlType.ProgrammaticName)"
        $rect = $info.BoundingRectangle
        $cx = [int]($rect.X + $rect.Width / 2)
        $cy = [int]($rect.Y + $rect.Height / 2)
    } catch { return $null }
    if ($automationId -ne '') {
        foreach ($row in $rows) {
            if ("$($row['automationId'])" -eq $automationId -and "$($row['controlType'])" -eq $type) { return $row }
        }
    }
    if ($name -ne '') {
        foreach ($row in $rows) {
            if ("$($row['name'])" -eq $name -and "$($row['controlType'])" -eq $type) { return $row }
        }
    }
    foreach ($row in $rows) {
        if ([int]$row['width'] -le 0 -or [int]$row['height'] -le 0) { continue }
        $rx = [int]$row['x'] + [int](([int]$row['width']) / 2)
        $ry = [int]$row['y'] + [int](([int]$row['height']) / 2)
        if ([Math]::Abs($rx - $cx) -le 3 -and [Math]::Abs($ry - $cy) -le 3) { return $row }
    }
    return $null
}

function Resolve-TextTarget($Arg, [int64]$Hwnd, $Rows) {
    # A target only ever comes from something the caller named, or from what this read
    # itself already resolved. There is deliberately no scan for "some element with text":
    # that is the unbounded read the budget exists to avoid, and it would answer with a
    # control nobody chose. When nothing certain is available the answer is
    # `target_required`, which says what to pass next time.
    $result = [ordered]@{ ok = $false; status = 'target_required'; el = $null; source = ''; ref = ''; note = '' }
    $target = Get-ArgMember $Arg 'textTarget'
    $ref = ''
    if ($null -ne $target) {
        $value = Get-ArgMember $target 'ref'
        if ($null -ne $value) { $ref = "$value".Trim() }
    }
    $selector = $null
    if ($null -ne $target) {
        $candidate = [ordered]@{}
        foreach ($pair in @(@('automationId', 'automation_id'), @('name', 'name'), @('controlType', 'control_type'), @('className', 'class_name'), @('index', 'index'))) {
            $value = Get-ArgMember $target $pair[0]
            if ($null -eq $value) { $value = Get-ArgMember $target $pair[1] }
            if ($null -ne $value -and "$value" -ne '') { $candidate[$pair[0]] = $value }
        }
        if ($candidate.Count -gt 0) { $selector = $candidate }
    }
    if ($ref -ne '' -and $null -ne $selector) {
        $result['note'] = 'both a ref and a selector were given; the ref is used, because it names one element this session actually read'
    }
    if ($ref -ne '') {
        $resolved = Resolve-ElementRef $ref
        if (-not $resolved.ok) {
            $result['status'] = 'unavailable'
            $result['ref'] = $ref
            $result['note'] = "$($resolved.error)"
            return $result
        }
        $selector = $resolved.selector
    }
    if ($null -ne $selector) {
        $findArg = [ordered]@{}
        foreach ($key in @('automationId', 'name', 'controlType', 'className', 'index')) {
            $value = Get-ArgMember $selector $key
            if ($null -ne $value) { $findArg[$key] = $value }
        }
        $namedHwnd = Get-ArgMember $target 'hwnd'
        if ($null -ne $namedHwnd -and [int64]$namedHwnd -ne 0) { $findArg['hwnd'] = [int64]$namedHwnd } else { $findArg['hwnd'] = $Hwnd }
        $el = $null
        $failure = ''
        try { $el = Find-UiaMatch (Get-UiaRoot $findArg) $findArg } catch { $el = $null; $failure = $_.Exception.Message }
        if ($null -eq $el) {
            $result['status'] = 'unavailable'
            $result['ref'] = $ref
            if ($failure -ne '') {
                $result['note'] = "the target named by this request could not be resolved in hwnd $($findArg['hwnd']): $failure"
            } else {
                $result['note'] = "the target named by this request could not be resolved in hwnd $($findArg['hwnd'])"
            }
            return $result
        }
        $result['ok'] = $true
        $result['el'] = $el
        if ($ref -ne '') { $result['source'] = 'ref' } else { $result['source'] = 'selector' }
        $result['ref'] = $ref
        return $result
    }

    # Nothing named: the focused control, but only when it belongs to this window.
    $focused = $null
    try { $focused = [System.Windows.Automation.AutomationElement]::FocusedElement } catch { $focused = $null }
    if ($null -ne $focused) {
        $ownerHwnd = Get-UiaElementWindowHwnd $focused
        if ($ownerHwnd -ne 0 -and $ownerHwnd -eq $Hwnd) {
            $result['ok'] = $true
            $result['el'] = $focused
            $result['source'] = 'focused'
            return $result
        }
        $result['note'] = "the focused control belongs to hwnd $ownerHwnd, not to this read's window (hwnd $Hwnd), so it was left out"
    }

    # Otherwise: the text providers this read actually returned. Bounded by the read's own
    # node budget, and only rows the caller has already seen.
    $candidates = @()
    foreach ($row in @($Rows)) {
        if ($null -eq $row) { continue }
        if ([bool]$row['offscreen']) { continue }
        if (@($row['patterns']) -contains 'text') { $candidates += $row }
    }
    if ($candidates.Count -gt 0) {
        $chosen = $candidates[0]
        $findArg = [ordered]@{ hwnd = $Hwnd }
        if ("$($chosen['automationId'])" -ne '') {
            $findArg['automationId'] = "$($chosen['automationId'])"
        } else {
            $findArg['controlType'] = "$($chosen['controlType'])"
            if ("$($chosen['className'])" -ne '') { $findArg['className'] = "$($chosen['className'])" }
            if ("$($chosen['name'])" -ne '') { $findArg['name'] = "$($chosen['name'])" }
            $index = 0
            foreach ($row in @($Rows)) {
                if ("$($row['ref'])" -eq "$($chosen['ref'])") { break }
                if ("$($row['controlType'])" -eq "$($chosen['controlType'])" -and "$($row['className'])" -eq "$($chosen['className'])" -and "$($row['name'])" -eq "$($chosen['name'])") { $index++ }
            }
            if ($index -gt 0) { $findArg['index'] = $index }
        }
        $el = $null
        try { $el = Find-UiaMatch (Get-UiaRoot $findArg) $findArg } catch { $el = $null }
        if ($null -ne $el -and (Test-UiaElementMatchesRow $el $chosen)) {
            $result['ok'] = $true
            $result['el'] = $el
            $result['source'] = 'read-row'
            $result['ref'] = "$($chosen['ref'])"
            if ($candidates.Count -gt 1) {
                $result['note'] = "$($candidates.Count) rows of this read expose text; the first one was read - pass text_target to say which control you meant"
            }
            return $result
        }
        if ($result['note'] -eq '') {
            $result['note'] = 'the text-providing row of this read could not be re-resolved to the same element, so nothing was read from it'
        }
    }

    $result['status'] = 'target_required'
    if ($result['note'] -eq '') {
        $result['note'] = 'no text provider could be resolved without scanning the window; pass text_target with a ref from this read (or an exact selector) to say which control to read'
    }
    return $result
}

function Get-UiaTextObservationManaged($Arg, [int64]$Hwnd, $Rows, $config) {
    # The managed implementation of the same block (§5 asks for both engines). It is the
    # fallback for a host where the COM client is unavailable: on the windows the COM client
    # reads natively the managed one can answer through the MSAA bridge instead, which is a
    # different tree and not a substitute for it.
    $budget = New-TextBudget $Arg
    $observation = [ordered]@{}
    $target = Resolve-TextTarget $Arg $Hwnd $Rows
    $targetLine = [ordered]@{ ok = [bool]$target['ok']; source = "$($target['source'])" }
    if ("$($target['status'])" -eq 'target_required' -or "$($target['status'])" -eq 'unavailable') { $targetLine['status'] = "$($target['status'])" }
    if ("$($target['ref'])" -ne '') { $targetLine['ref'] = "$($target['ref'])" }
    if ("$($target['note'])" -ne '') { $targetLine['note'] = "$($target['note'])" }
    $observation['target'] = $targetLine

    if (-not $target['ok']) {
        foreach ($name in @('focused', 'selection', 'document', 'selected')) {
            if (-not $config[$name]) { continue }
            $field = [ordered]@{ status = "$($target['status'])" }
            if ("$($target['note'])" -ne '') { $field['note'] = "$($target['note'])" }
            $observation[$name] = $field
        }
        $observation['budget'] = [ordered]@{ max_chars = [int]$budget['max']; returned_chars = 0; truncated = $false }
        return $observation
    }

    $el = $target['el']
    if ("$($target['ref'])" -eq '') {
        $row = Find-TreeRowForElement $el $Rows
        if ($null -ne $row) {
            $rowRef = "$($row['ref'])"
            if ($rowRef -ne '') { $observation['target']['ref'] = $rowRef }
        }
    }

    if ($config['focused']) {
        $entry = [ordered]@{ status = 'ok'; summary = '' }
        if ("$($observation['target']['ref'])" -ne '') { $entry['ref'] = "$($observation['target']['ref'])" }
        $summary = Format-UiaElementLine $el
        $value = Get-UiaElementValueText $el
        if ($null -ne $value -and $value -ne '') { $summary = "$summary · 值: $value" }
        if ($summary -eq '') { $summary = 'the focused control reports no accessible name' }
        $cap = $script:FocusedSummaryDefault
        if ($script:FocusedSummaryMax -lt $cap) { $cap = $script:FocusedSummaryMax }
        $remaining = Get-BudgetRemaining $budget
        if ($remaining -lt $cap) { $cap = $remaining }
        $clip = Split-TextAtBudget $summary $cap
        $entry['summary'] = $clip['text']
        if ($clip['truncated']) {
            $entry['truncated'] = $true
            $budget['truncated'] = $true
        }
        $budget['used'] = [int]$budget['used'] + $clip['text'].Length
        $observation['focused'] = $entry
    }

    if ($config['selection']) {
        $entry = [ordered]@{ status = 'ok'; value = '' }
        $pattern = Get-UiaCurrentPattern $el ([System.Windows.Automation.TextPattern]::Pattern)
        if ($null -eq $pattern) {
            $entry['status'] = 'unsupported'
            $entry['note'] = 'this control does not implement TextPattern, so it cannot report a selection; its value (when it has one) is in `focused`, and get_value reads it directly'
            $observation['selection'] = $entry
        } else {
            $segments = @()
            $failure = ''
            try {
                $ranges = ([System.Windows.Automation.TextPattern]$pattern).GetSelection()
                if ($null -ne $ranges) {
                    foreach ($range in @($ranges)) {
                        $piece = ''
                        try { $piece = [string]$range.GetText(-1) } catch { $piece = '' }
                        if ($piece -ne '') { $segments += $piece }
                    }
                }
            } catch { $failure = $_.Exception.Message }
            if ($failure -ne '') {
                $entry['status'] = 'failed'
                $entry['note'] = $failure
            } elseif ($segments.Count -eq 0) {
                $entry['note'] = 'nothing is selected in this control (an empty selection is an answer, not a failed read)'
            } else {
                [void](Add-BudgetedText $entry (($segments -join "`n")) $budget)
            }
            $observation['selection'] = $entry
        }
    }

    if ($config['document']) {
        $pattern = Get-UiaCurrentPattern $el ([System.Windows.Automation.TextPattern]::Pattern)
        if ($null -eq $pattern) {
            $observation['document'] = [ordered]@{
                status = 'unsupported'
                note = 'this control does not implement TextPattern, so its document text cannot be read here; computer_ui_action get_text reads the same control when its provider supports it'
            }
        } else {
            $range = $null
            try { $range = ([System.Windows.Automation.TextPattern]$pattern).DocumentRange } catch { $range = $null }
            if ($null -eq $range) {
                $observation['document'] = [ordered]@{ status = 'failed'; note = 'the control reported no document range' }
            } else {
                $observation['document'] = Read-UiaRangeText $range $budget
            }
        }
    }

    if ($config['selected']) {
        $max = $script:SelectedItemsDefault
        $requested = Get-ArgMember $Arg 'maxSelected'
        if ($null -ne $requested) {
            $parsed = 0
            if ([int]::TryParse("$requested", [ref]$parsed) -and $parsed -gt 0) { $max = $parsed }
        }
        if ($max -gt $script:SelectedItemsMax) { $max = $script:SelectedItemsMax }
        $items = Get-UiaSelectionSummaries $el $max
        $entry = [ordered]@{ status = "$($items['status'])" }
        if ("$($items['note'])" -ne '') { $entry['note'] = "$($items['note'])" }
        if ("$($items['status'])" -eq 'ok') {
            $entry['count'] = [int]$items['count']
            if ([bool]$items['truncated']) { $entry['truncated'] = $true }
            $lines = @()
            foreach ($line in @($items['items'])) {
                $remaining = Get-BudgetRemaining $budget
                if ($remaining -le 0) {
                    $budget['truncated'] = $true
                    $entry['budget_exhausted'] = $true
                    break
                }
                $clip = Split-TextAtBudget "$line" $remaining
                $lines += $clip['text']
                $budget['used'] = [int]$budget['used'] + $clip['text'].Length
                if ($clip['truncated']) {
                    $budget['truncated'] = $true
                    $entry['truncated'] = $true
                    break
                }
            }
            $entry['items'] = $lines
        }
        $observation['selected'] = $entry
    }

    $observation['budget'] = [ordered]@{
        max_chars      = [int]$budget['max']
        returned_chars = [int]$budget['used']
        truncated      = [bool]$budget['truncated']
    }
    return $observation
}

function Find-RowForIdentity($Rows, $autoId, $name, $controlType, [int]$cx, [int]$cy) {
    # Match an element the COM client read back onto a row of this read, so the reply can
    # carry a ref the next call can act on. Identity first, position second.
    if ($null -eq $Rows) { return $null }
    $rows = @($Rows)
    if ($rows.Count -eq 0) { return $null }
    if ("$autoId" -ne '') {
        foreach ($row in $rows) {
            if ("$($row['automationId'])" -eq "$autoId" -and "$($row['controlType'])" -eq "$controlType") { return $row }
        }
    }
    if ("$name" -ne '') {
        foreach ($row in $rows) {
            if ("$($row['name'])" -eq "$name" -and "$($row['controlType'])" -eq "$controlType") { return $row }
        }
    }
    foreach ($row in $rows) {
        if ([int]$row['width'] -le 0 -or [int]$row['height'] -le 0) { continue }
        $rx = [int]$row['x'] + [int](([int]$row['width']) / 2)
        $ry = [int]$row['y'] + [int](([int]$row['height']) / 2)
        if ([Math]::Abs($rx - $cx) -le 3 -and [Math]::Abs($ry - $cy) -le 3) { return $row }
    }
    return $null
}

function Resolve-TextTargetCom($Arg, [int64]$Hwnd, $Rows, [bool]$skipFocused = $false) {
    # Which element the COM observation should read, decided before anything is read.
    #
    # Same rule as the managed path: only what the caller named, or what this read already
    # resolved. The focused element is a candidate because it is usually the control the
    # caller means, but its owner is checked afterwards -- folding another application's
    # caret into this window's read would be a silent wrong-window answer.
    $plan = [ordered]@{ ok = $false; status = 'target_required'; source = ''; ref = ''; note = ''; useFocused = $false; selector = $null }
    $target = Get-ArgMember $Arg 'textTarget'
    $ref = ''
    if ($null -ne $target) {
        $value = Get-ArgMember $target 'ref'
        if ($null -ne $value) { $ref = "$value".Trim() }
    }
    $selector = [ordered]@{}
    if ($null -ne $target) {
        foreach ($pair in @(@('automationId', 'automation_id'), @('name', 'name'), @('controlType', 'control_type'), @('className', 'class_name'), @('index', 'index'))) {
            $value = Get-ArgMember $target $pair[0]
            if ($null -eq $value) { $value = Get-ArgMember $target $pair[1] }
            if ($null -ne $value -and "$value" -ne '') { $selector[$pair[0]] = $value }
        }
    }
    $hasSelector = $selector.Count -gt 0
    if ($ref -ne '' -and $hasSelector) {
        $plan['note'] = 'both a ref and a selector were given; the ref is used, because it names one element this session actually read'
    }
    if ($ref -ne '') {
        $resolved = Resolve-ElementRef $ref
        if (-not $resolved.ok) {
            $plan['status'] = 'unavailable'
            $plan['ref'] = $ref
            $plan['note'] = "$($resolved.error)"
            return $plan
        }
        $selector = [ordered]@{}
        foreach ($key in @('automationId', 'name', 'controlType', 'className', 'index')) {
            $value = Get-ArgMember $resolved.selector $key
            if ($null -ne $value -and "$value" -ne '') { $selector[$key] = $value }
        }
        $plan['ok'] = $true
        $plan['source'] = 'ref'
        $plan['ref'] = $ref
        $plan['selector'] = $selector
        return $plan
    }
    if ($hasSelector) {
        $plan['ok'] = $true
        $plan['source'] = 'selector'
        $plan['selector'] = $selector
        return $plan
    }
    if (-not $skipFocused) {
        $plan['ok'] = $true
        $plan['source'] = 'focused'
        $plan['useFocused'] = $true
        return $plan
    }
    $candidates = @()
    foreach ($row in @($Rows)) {
        if ($null -eq $row) { continue }
        if ([bool]$row['offscreen']) { continue }
        if (@($row['patterns']) -contains 'text') { $candidates += $row }
    }
    if ($candidates.Count -gt 0) {
        $chosen = $candidates[0]
        $rowSelector = [ordered]@{}
        if ("$($chosen['automationId'])" -ne '') {
            $rowSelector['automationId'] = "$($chosen['automationId'])"
        } else {
            $rowSelector['controlType'] = "$($chosen['controlType'])"
            if ("$($chosen['className'])" -ne '') { $rowSelector['className'] = "$($chosen['className'])" }
            if ("$($chosen['name'])" -ne '') { $rowSelector['name'] = "$($chosen['name'])" }
            $index = 0
            foreach ($row in @($Rows)) {
                if ("$($row['ref'])" -eq "$($chosen['ref'])") { break }
                if ("$($row['controlType'])" -eq "$($chosen['controlType'])" -and "$($row['className'])" -eq "$($chosen['className'])" -and "$($row['name'])" -eq "$($chosen['name'])") { $index++ }
            }
            if ($index -gt 0) { $rowSelector['index'] = $index }
        }
        $plan['ok'] = $true
        $plan['source'] = 'read-row'
        $plan['ref'] = "$($chosen['ref'])"
        $plan['selector'] = $rowSelector
        if ($candidates.Count -gt 1) {
            $plan['note'] = "$($candidates.Count) rows of this read expose text; the first one was read - pass text_target to say which control you meant"
        }
        return $plan
    }
    $plan['note'] = 'no text provider could be resolved without scanning the window; pass text_target with a ref from this read (or an exact selector) to say which control to read'
    return $plan
}

function New-TextFieldEntry($name, $record, $budget, [string]$valueKey, [string]$statusKey, [string]$truncatedKey) {
    # Shape one range-shaped text field (selection / document) out of the COM record, on the
    # shared budget. Statuses come through unchanged: `unsupported` and `failed` are answers
    # about the control, and turning either into an empty string would invent an observation.
    $entry = [ordered]@{ status = "$($record[$statusKey])"; value = '' }
    $status = "$($record[$statusKey])"
    if ($status -eq '' ) { $entry['status'] = 'failed' }
    if ($status -eq 'unsupported') {
        $kind = 'TextPattern'
        $entry['note'] = "this control does not implement $kind, so it cannot report $name; its value (when it has one) is in `focused`, and get_value reads it directly"
        if ("$($record['note'])" -ne '' -and "$($record['note'])" -notmatch 'TextPattern') { $entry['note'] = "$($record['note'])" }
        return $entry
    }
    if ($status -eq 'failed') {
        $entry['note'] = $(if ("$($record['note'])" -ne '') { "$($record['note'])" } else { 'the provider refused the read' })
        return $entry
    }
    $text = "$($record[$valueKey])"
    # The account is kept here, not in the engine: the engine caps each field so a read cannot
    # pull a whole document across the process boundary, but only the caller knows what the
    # fields before this one already spent. Clipping to what is left is what makes the budget
    # shared rather than per field.
    [void](Add-BudgetedText $entry $text $budget)
    if ("$($record[$truncatedKey])" -eq 'True') {
        $entry['truncated'] = $true
        $budget['truncated'] = $true
    }
    if ($name -eq 'selection' -and $entry['value'] -eq '' -and "$($entry['status'])" -eq 'ok') {
        $entry['note'] = 'nothing is selected in this control (an empty selection is an answer, not a failed read)'
    }
    return $entry
}

function Get-UiaTextObservationCom($Arg, [int64]$Hwnd, $Rows, $config, [int]$windowPid) {
    # The COM implementation: the primary one, because it reads the same tree the caller just
    # saw. One call reads the identity and every requested field; the only reason for a
    # second is a focused element that turns out to belong to another application.
    $budget = New-TextBudget $Arg
    $maxChars = [int]$budget['max']
    $wantFocused = [bool]$config['focused']
    $wantSelection = [bool]$config['selection']
    $wantDocument = [bool]$config['document']
    $observation = [ordered]@{}
    $plan = Resolve-TextTargetCom $Arg $Hwnd $Rows $false
    $record = $null
    $planNote = "$($plan['note'])"
    if ($plan['ok'] -and $plan['useFocused']) {
        $record = [DshUia.Engine]::ReadTextObservation($Hwnd, '', '', '', '', 0, $true, $wantFocused, $wantSelection, $wantDocument, $maxChars)
        $recordPid = [int]$record['pid']
        if ($recordPid -ne 0 -and $windowPid -ne 0 -and $recordPid -ne $windowPid) {
            # Another application holds the focus. Reading its caret here would answer a
            # question about a different window with this window's name on it, so the
            # focused element is dropped and the read falls back to its own rows.
            $planNote = "the focused control belongs to pid $recordPid, not to this read's window (pid $windowPid), so it was left out"
            $plan = Resolve-TextTargetCom $Arg $Hwnd $Rows $true
            $record = $null
        }
    }
    if ($null -eq $record) {
        if (-not $plan['ok']) {
            $status = "$($plan['status'])"
            $note = "$($plan['note'])"
            $observation['target'] = [ordered]@{ ok = $false; source = "$($plan['source'])"; status = $status; note = $note }
            foreach ($name in @('focused', 'selection', 'document', 'selected')) {
                if (-not $config[$name]) { continue }
                $observation[$name] = [ordered]@{ status = $status; note = $note }
            }
            $observation['budget'] = [ordered]@{ max_chars = [int]$budget['max']; returned_chars = 0; truncated = $false }
            return $observation
        }
        $selector = $plan['selector']
        $selectorId = ''; $selectorName = ''; $selectorType = ''; $selectorClass = ''; $selectorIndex = 0
        foreach ($key in @('automationId', 'name', 'controlType', 'className', 'index')) {
            $value = Get-ArgMember $selector $key
            if ($null -eq $value) { continue }
            if ($key -eq 'automationId') { $selectorId = "$value" }
            elseif ($key -eq 'name') { $selectorName = "$value" }
            elseif ($key -eq 'controlType') { $selectorType = "$value" }
            elseif ($key -eq 'className') { $selectorClass = "$value" }
            elseif ($key -eq 'index') { $selectorIndex = [int]$value }
        }
        $record = [DshUia.Engine]::ReadTextObservation($Hwnd, $selectorId, $selectorName, $selectorType, $selectorClass, $selectorIndex, $false, $wantFocused, $wantSelection, $wantDocument, $maxChars)
    }
    if ("$($record['status'])" -ne 'ok') {
        $status = "$($record['status'])"
        if ($status -eq '') { $status = 'failed' }
        $note = "$($record['note'])"
        if ($note -eq '') { $note = "$($record['error'])" }
        if ($status -eq 'unavailable' -and $planNote -ne '') { $note = $planNote }
        $targetLine = [ordered]@{ ok = $false; source = "$($plan['source'])"; status = $status }
        if ("$($plan['ref'])" -ne '') { $targetLine['ref'] = "$($plan['ref'])" }
        if ($note -ne '') { $targetLine['note'] = $note }
        $observation['target'] = $targetLine
        foreach ($name in @('focused', 'selection', 'document', 'selected')) {
            if (-not $config[$name]) { continue }
            $field = [ordered]@{ status = $status }
            if ($note -ne '') { $field['note'] = $note }
            $observation[$name] = $field
        }
        $observation['budget'] = [ordered]@{ max_chars = [int]$budget['max']; returned_chars = 0; truncated = $false }
        return $observation
    }

    $row = Find-RowForIdentity $Rows "$($record['autoId'])" "$($record['name'])" "$($record['controlType'])" ([int]$record['cx']) ([int]$record['cy'])
    $targetRef = "$($plan['ref'])"
    if ($targetRef -eq '' -and $null -ne $row) { $targetRef = "$($row['ref'])" }
    $targetLine = [ordered]@{ ok = $true; source = "$($plan['source'])" }
    if ($targetRef -ne '') { $targetLine['ref'] = $targetRef }
    if ($planNote -ne '') { $targetLine['note'] = $planNote }
    $observation['target'] = $targetLine

    if ($wantFocused) {
        $entry = [ordered]@{ status = 'ok'; summary = '' }
        if ($targetRef -ne '') { $entry['ref'] = $targetRef }
        $summary = "$($record['focusedSummary'])"
        if ($summary -eq '') { $summary = 'the control reports no accessible name' }
        $cap = $script:FocusedSummaryDefault
        if ($script:FocusedSummaryMax -lt $cap) { $cap = $script:FocusedSummaryMax }
        $remaining = Get-BudgetRemaining $budget
        if ($remaining -lt $cap) { $cap = $remaining }
        $clip = Split-TextAtBudget $summary $cap
        $entry['summary'] = $clip['text']
        if ($clip['truncated']) {
            $entry['truncated'] = $true
            $budget['truncated'] = $true
        }
        $budget['used'] = [int]$budget['used'] + $clip['text'].Length
        if ($planNote -ne '') { $entry['note'] = $planNote }
        $observation['focused'] = $entry
    }
    if ($wantSelection) { $observation['selection'] = New-TextFieldEntry 'selection' $record $budget 'selection' 'selectionStatus' 'selectionTruncated' }
    if ($wantDocument) { $observation['document'] = New-TextFieldEntry 'document' $record $budget 'document' 'documentStatus' 'documentTruncated' }
    if ($config['selected']) {
        # The selected *items* of a list are read through SelectionPattern, which only the
        # managed path implements so far; saying so beats answering "none" from a control
        # whose selection was never asked about.
        $observation['selected'] = [ordered]@{
            status = 'unsupported'
            note = 'the selected-items list is not read on the COM path yet; read the window with the managed engine (DSH_COMPUTER_UI_ENGINE=managed), or name the list item directly and read it with text_target'
        }
    }
    $observation['budget'] = [ordered]@{
        max_chars      = [int]$budget['max']
        returned_chars = [int]$budget['used']
        truncated      = [bool]$budget['truncated']
    }
    return $observation
}

function Get-UiaTextObservation($Arg, [int64]$Hwnd, $Rows, [string]$engine, [int]$windowPid) {
    # The whole text block of one read. $null when text was not asked for -- that is the
    # contract that keeps this free for every caller who does not use it.
    $config = Get-TextObservationConfig (Get-ArgMember $Arg 'text')
    if ($null -eq $config) { return $null }
    if ($engine -eq 'com') { return Get-UiaTextObservationCom $Arg $Hwnd $Rows $config $windowPid }
    return Get-UiaTextObservationManaged $Arg $Hwnd $Rows $config
}

function Add-TextObservation($reply, $Arg, [int64]$Hwnd, [string]$engine, [int]$windowPid) {
    # Attached *after* the payload was registered, on purpose: the text block cites the ref
    # of the row it read, and refs are minted while the payload is registered. A read that
    # did not ask for text gets nothing bolted on -- the shape of the reply is unchanged.
    #
    # The engine that read the tree is passed in because the text has to be read the same
    # way: on a window the COM client reads natively, the managed client answers through
    # the MSAA bridge with a different (and poorer) tree, so a target resolved with the
    # other engine reports "not found" on a window the caller is looking at.
    if ($null -eq $reply) { return $reply }
    $observation = Get-UiaTextObservation $Arg $Hwnd @($reply.nodes) $engine $windowPid
    if ($null -ne $observation) { $reply['text'] = $observation }
    return $reply
}

function Get-UiTreeSpec($Arg) {
    # One normalization entry for a read (§9: `Do-UiTree` 内重复参数初始化，合并为一个规范化入口).
    #
    # The defaults used to be spelled out twice inside `Do-UiTree` -- once before the COM branch
    # and once inside the managed one -- so a change to a default had to be made in two places
    # and the two engines could quietly disagree about what "the same read" means. They are
    # resolved here once and both branches use this.
    #
    # @returns the resolved spec: depths, budgets, flags and the `since` argument.
    $spec = [ordered]@{
        maxDepth      = 6
        maxNodes      = 400
        probePatterns = $true
        skipEmpty     = $true
        pruneRows     = $true
        sinceArg      = ''
    }
    if ($null -ne $Arg.maxDepth) { $spec.maxDepth = [Math]::Max(1, [int]$Arg.maxDepth) }
    if ($null -ne $Arg.maxNodes) { $spec.maxNodes = [Math]::Max(10, [int]$Arg.maxNodes) }
    # Pattern probing is the most expensive part of a walk on some providers, and a
    # caller that only wants names and rectangles should not pay for it.
    if ($Arg.patterns -eq $false) { $spec.probePatterns = $false }
    # A tree walk spends its node budget in breadth-first order, which for a large
    # window means the budget is gone before any actual control is reached: what
    # comes back is a wall of anonymous Panes. Dropping nodes that carry no identity
    # at all -- no name, no automation id, no pattern -- keeps the structure that
    # matters and keeps the scaffolding out of the model's context. A search never
    # skips: there the caller has already said exactly what it wants.
    if ($Arg.skipEmpty -eq $false) { $spec.skipEmpty = $false }
    # The pruning pass is on by default; a caller that wants the raw provider output
    # (or an internal read whose indices must line up with the unpruned enumeration)
    # turns it off.
    if ($Arg.prune -eq $false) { $spec.pruneRows = $false }
    # When the caller names a snapshot, only what changed since then comes back.
    if ($null -ne $Arg.since) { $spec.sinceArg = "$($Arg.since)" }
    return $spec
}

function Do-UiTree([object]$Arg, [bool]$register = $true) {
    $settled = Wait-ForSettle $Arg.settleMs
    $spec = Get-UiTreeSpec $Arg
    $maxDepth = [int]$spec.maxDepth
    $maxNodes = [int]$spec.maxNodes
    $probePatterns = [bool]$spec.probePatterns
    $skipEmpty = [bool]$spec.skipEmpty
    $pruneRows = [bool]$spec.pruneRows
    $sinceArg = [string]$spec.sinceArg

    # Which engine reads the tree. The COM engine is the default; the managed wrapper
    # stays as the fallback and as an escape hatch, because a provider that COM
    # mishandles should not leave the tool with no way to read a window at all.
    #   $env:DSH_COMPUTER_UI_ENGINE = 'managed'  -> force the managed wrapper
    #   $Arg.engine                              -> per call, when the caller can send it
    $engine = 'com'
    if ($env:DSH_COMPUTER_UI_ENGINE -eq 'managed') { $engine = 'managed' }
    if ($null -ne $Arg.engine -and [string]$Arg.engine -ne '') { $engine = [string]$Arg.engine }
    if ($engine -eq 'com' -and -not $script:ComUiaReady) { $engine = 'managed' }

    # The target window handle, resolved without touching the managed wrapper so the
    # COM path never pays for loading it.
    $targetHwnd = [IntPtr]::Zero
    if ($null -ne $Arg.hwnd -and [int64]$Arg.hwnd -ne 0) {
        $targetHwnd = [IntPtr][int64]$Arg.hwnd
    } else {
        $fgProbe = [DshNative]::GetForegroundWindow()
        if ($fgProbe -ne [IntPtr]::Zero) { $targetHwnd = $fgProbe }
    }

    if ($engine -eq 'com' -and $targetHwnd -ne [IntPtr]::Zero) {
        $windowInfo = Get-WindowInfoForHwnd $targetHwnd
        $result = Get-ComUiTree ([int64]$targetHwnd) $maxDepth $maxNodes $probePatterns $skipEmpty $Arg
        $comReply = Complete-UiTree ([ordered]@{
            nodes     = @($result.nodes)
            truncated = [bool]$result.truncated
            mode      = [string]$result.mode
            maxDepth  = $maxDepth
            maxNodes  = $maxNodes
            window    = $windowInfo
            settledMs = $settled
            walked    = [int]$result.walked
            skipped   = [int]$result.skipped
            # Carried through, not dropped: the caller has to be able to tell a tree that came
            # from the window's own provider from one the legacy bridge served, and whether the
            # client had to be re-created to get it. (This is where they were being lost.)
            legacy    = [bool]$result.legacy
            reinit    = [bool]$result.reinit
            # §7.4 第 1 条: how many pattern properties the COM cache request asked for. The
            # COM engine builds its own cache request, so the number comes from the same
            # pattern table this plugin asks the provider to fill.
            cachePatterns = $(if ($probePatterns) { [int]@(Get-UiaPatternSpecs).Count } else { 0 })
            # §7.4 第 3 条: the conditions the search pushed down, carried through from the
            # engine so "this was a smaller enumeration" is a fact in the reply.
            pushdown  = @($result.pushdown)
            # §7.4 第 2 条: what the walk cost, told apart from what it returned.
            traversal = $result.traversal
        }) $register $pruneRows $sinceArg
        return (Add-TextObservation $comReply $Arg ([int64]$targetHwnd) 'com' ([int]$windowInfo.pid))
    }

    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $root = $null
    $rootHwnd = [IntPtr]::Zero
    if ($null -ne $Arg.hwnd -and [int64]$Arg.hwnd -ne 0) {
        $rootHwnd = [IntPtr][int64]$Arg.hwnd
        $root = Get-UiaRootForHwnd ([int64]$Arg.hwnd)
    } else {
        $fg = [DshNative]::GetForegroundWindow()
        if ($fg -ne [IntPtr]::Zero) {
            $rootHwnd = $fg
            $root = Get-UiaRootForHwnd ([int64]$fg)
        } else {
            $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
            if ($null -ne $focused) { $root = $focused.CachedParent }
            if ($null -eq $root) { $root = [System.Windows.Automation.AutomationElement]::RootElement }
        }
    }
    if ($null -eq $root) { throw "could not resolve a UI Automation root element" }
    # Which window this tree actually came from. Without it, a modal that appeared
    # since the last observation reads as "my element vanished" rather than "I am
    # looking at a different window".
    if ($rootHwnd -eq [IntPtr]::Zero) {
        try {
            $native = [int64]$root.Current.NativeWindowHandle
            if ($native -ne 0) { $rootHwnd = [IntPtr]$native }
        } catch { }
    }
    $windowInfo = Get-WindowInfoForHwnd $rootHwnd
    $scope = [System.Windows.Automation.TreeScope]::Children
    $nodes = New-Object System.Collections.Generic.List[object]
    $truncated = $false

    $wantName = [string]$Arg.name
    $wantType = [string]$Arg.controlType
    $wantId = [string]$Arg.automationId
    $wantFilter = [string]$Arg.filter
    $findMode = ($wantName -ne '') -or ($wantType -ne '') -or ($wantId -ne '') -or ($wantFilter -ne '')
    # The read's flags and budgets come from the single normalization entry above, so the
    # managed branch cannot drift from the COM one (§9).
    $walked = 0
    $skipped = 0

    # §7.4 第 1 条: the cache request asks for pattern properties only when this read wants
    # patterns, so `patterns: false` is cheaper and not merely shorter.
    $cache = New-UiaCacheRequest $probePatterns
    if ($probePatterns) { $specs = Get-UiaPatternSpecs } else { $specs = @() }
    $cache.Push()
    try {
        if ($findMode) {
            # Locate mode: one server-side query, then filter on cached properties.
            # Returning only the matches is both faster and far smaller than dumping
            # a whole tree for the model to read.
            #
            # §7.4 第 3 条: a condition is pushed down only when the push-down is *equivalent*.
            # `AutomationId` is exact by definition. A control type is pushed down only when the
            # caller named one in full -- the line below still matches a partial type with a
            # substring test, and an exact provider condition would drop rows that test accepts.
            $cond = [System.Windows.Automation.Condition]::TrueCondition
            $pushedDown = @()
            if ($wantId -ne '') {
                $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $wantId)
                $pushedDown += 'automationId'
            } elseif ([DshUia.Engine]::IsExactControlType($wantType)) {
                # The managed API is not the native one here: `ControlTypeProperty` wants the
                # `ControlType` *object*, not the numeric id the C# engine receives.
                #
                # That object is reached by member access rather than reflection: this class
                # exposes its control types in a way `GetProperties()` reports as empty, so the
                # reflection lookup silently found nothing and the push-down never happened
                # (caught by the probe run, not by the code). Anything unexpected still falls
                # back to the true condition and the substring filter below, because a provider
                # query that throws would break a read that works today.
                try {
                    $shortName = $wantType.Trim()
                    if ($shortName.StartsWith('ControlType.')) { $shortName = $shortName.Substring('ControlType.'.Length) }
                    $controlTypeObject = [System.Windows.Automation.ControlType]::$shortName
                    if ($null -ne $controlTypeObject) {
                        $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $controlTypeObject)
                        $pushedDown += 'controlType'
                    }
                } catch {
                    $cond = [System.Windows.Automation.Condition]::TrueCondition
                }
            }
            $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
            foreach ($el in $all) {
                if ($nodes.Count -ge $maxNodes) { $truncated = $true; break }
                try {
                    $info = $el.Cached
                    if ($wantName -ne '' -and ([string]$info.Name).IndexOf($wantName, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
                    if ($wantType -ne '' -and ([string]$info.ControlType.ProgrammaticName) -notmatch [regex]::Escape($wantType)) { continue }
                    if ($wantFilter -ne '') {
                        # Generic substring filter, evaluated on cached data only: the
                        # whole point of the find path is that no per-node cross-process
                        # read happens while filtering.
                        $hay = ([string]$info.Name) + ' ' + ([string]$info.AutomationId) + ' ' + ([string]$info.ControlType.ProgrammaticName)
                        if ($hay.IndexOf($wantFilter, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
                    }
                    $rect = $info.BoundingRectangle
                    # Inlined on purpose: ConvertTo-SafeInt/Test-RectFinite are five
                    # PowerShell calls per node, and at 400 nodes their interpreter
                    # overhead alone rivalled the UI Automation reads themselves.
                    $rx = $rect.X; $ry = $rect.Y; $rw = $rect.Width; $rh = $rect.Height
                    $finite = -not ([double]::IsNaN($rx) -or [double]::IsInfinity($rx) -or [double]::IsNaN($ry) -or [double]::IsInfinity($ry) -or [double]::IsNaN($rw) -or [double]::IsInfinity($rw) -or [double]::IsNaN($rh) -or [double]::IsInfinity($rh))
                    if (-not $finite) { $rx = 0; $ry = 0; $rw = 0; $rh = 0 }
                    else {
                        if ($rx -gt 2147483647) { $rx = 2147483647 } elseif ($rx -lt -2147483648) { $rx = -2147483648 } else { $rx = [int][Math]::Round($rx) }
                        if ($ry -gt 2147483647) { $ry = 2147483647 } elseif ($ry -lt -2147483648) { $ry = -2147483648 } else { $ry = [int][Math]::Round($ry) }
                        if ($rw -gt 2147483647) { $rw = 2147483647 } elseif ($rw -lt -2147483648) { $rw = -2147483648 } else { $rw = [int][Math]::Round($rw) }
                        if ($rh -gt 2147483647) { $rh = 2147483647 } elseif ($rh -lt -2147483648) { $rh = -2147483648 } else { $rh = [int][Math]::Round($rh) }
                    }
                    $patterns = @()
                    foreach ($spec in $specs) {
                        $obj = $null
                        if ($el.TryGetCachedPattern($spec[1], [ref]$obj)) { $patterns += $spec[0] }
                    }
                    $nodes.Add([ordered]@{
                        depth        = 0
                        name         = [string]$info.Name
                        controlType  = [string]$info.ControlType.ProgrammaticName
                        automationId = [string]$info.AutomationId
                        className    = [string]$info.ClassName
                        enabled      = [bool]$info.IsEnabled
                        offscreen    = (-not $finite) -or [bool]$info.IsOffscreen
                        x            = $rx
                        y            = $ry
                        width        = $rw
                        height       = $rh
                        patterns     = $patterns
                    })
                } catch { continue }
            }
            # The find path finishes exactly like the tree path and like the COM engine (§6: the
            # managed lookup used to return its payload straight from here, so a managed *search*
            # produced no registered refs, no pruning, no delta against `since`, and no text
            # observation -- the same request answered differently depending on which engine
            # happened to serve it). One completion, one shape, whichever branch produced the
            # rows.
            $findReply = Complete-UiTree ([ordered]@{
                nodes     = @($nodes.ToArray())
                truncated = [bool]$truncated
                mode      = 'find'
                maxDepth  = $maxDepth
                maxNodes  = $maxNodes
                window    = $windowInfo
                settledMs = $settled
                walked    = [int]$walked
                skipped   = [int]$skipped
                legacy    = $false
                reinit    = $false
                # §7.4 第 1 条: what the traversal actually asked the provider for: 0 when the
                # caller said `patterns: false`, so the saving is a fact in the reply rather
                # than something a reader has to trust.
                cachePatterns = [int]$script:UiaCachePatterns
                # §7.4 第 3 条: which conditions went to the provider instead of being filtered
                # by hand afterwards, so "the search is a smaller enumeration" is verifiable.
                pushdown = @($pushedDown)
                # §7.4 第 2 条: the cost of the search, told apart from what it returned.
                traversal = [ordered]@{ visited = [int]$walked; maxQueue = [int]$maxQueue; visitBudget = [int]$visitBudget; traversalTruncated = [bool]$traverseTruncated; elapsedMs = 0; providerSide = $true }
            }) $register $pruneRows $sinceArg
            return (Add-TextObservation $findReply $Arg ([int64]$rootHwnd) 'managed' ([int]$windowInfo.pid))
        }

        # The walk is deliberately one flat loop with no per-node helper calls:
        # PowerShell's own call overhead is comparable to a cross-process UIA read,
        # and 300 helper calls measurably cancelled out the cache win.
        #
        # The root element is the one node that is NOT in the cache (it was resolved
        # before the request was pushed), so it is read live; everything a FindAll
        # returns inside the pushed request arrives cached.
        $cached = $true
        $debugTrace = New-Object System.Collections.Generic.List[string]
        $queue = New-Object System.Collections.Queue
        # §7.4 第 2 条: the output budget and the traversal budget are counted apart. The loop
        # stops on `$nodes.Count -ge $maxNodes` (rows kept) *or* on the visit budget (nodes
        # looked at), and says which one it was.
        $visitBudget = Get-VisitBudget $maxNodes $Arg.maxVisited
        $maxQueue = 1
        $traverseTruncated = $false
        $traverseWatch = [System.Diagnostics.Stopwatch]::StartNew()
        $rootPair = New-Object object[] 2
        $rootPair[0] = $root
        $rootPair[1] = 0
        $queue.Enqueue($rootPair)
        while ($queue.Count -gt 0) {
            if ($visitBudget -gt 0 -and $walked -ge $visitBudget) { $truncated = $true; $traverseTruncated = $true; break }
            $item = $queue.Dequeue()
            $el = $item[0]
            $depth = [int]$item[1]
            if ($nodes.Count -ge $maxNodes) { $truncated = $true; break }
            $walked++
            $info = $null
            $useCache = $cached -and $depth -gt 0
            try {
                if ($useCache) { $info = $el.Cached } else { $info = $el.Current }
            } catch {
                # A provider can refuse a cached read; fall back to live reads.
                try { $cached = $false; $info = $el.Current } catch { $info = $null }
            }
            if ($null -eq $info) {
                # One unreadable element must not discard the nodes already collected.
                $nodes.Add([ordered]@{
                    depth        = $depth
                    name         = ''
                    controlType  = 'ControlType.Unknown'
                    automationId = ''
                    className    = ''
                    enabled      = $false
                    offscreen    = $true
                    x            = 0
                    y            = 0
                    width        = 0
                    height       = 0
                    patterns     = @()
                })
            } else {
                # A provider that answers a cached read with nothing at all would
                # silently produce an empty tree; detect it on the first child and
                # fall back to live reads for the rest of the walk.
                if ($useCache -and $nodes.Count -eq 1) {
                    if (([string]$info.ControlType) -eq '' -and ([string]$info.Name) -eq '' -and ([string]$info.AutomationId) -eq '') {
                        $cached = $false
                        try { $info = $el.Current } catch { }
                    }
                }
                $rect = $info.BoundingRectangle
                # Inlined on purpose - see the note in the find branch above.
                $rx = $rect.X; $ry = $rect.Y; $rw = $rect.Width; $rh = $rect.Height
                $finite = -not ([double]::IsNaN($rx) -or [double]::IsInfinity($rx) -or [double]::IsNaN($ry) -or [double]::IsInfinity($ry) -or [double]::IsNaN($rw) -or [double]::IsInfinity($rw) -or [double]::IsNaN($rh) -or [double]::IsInfinity($rh))
                if (-not $finite) { $rx = 0; $ry = 0; $rw = 0; $rh = 0 }
                else {
                    if ($rx -gt 2147483647) { $rx = 2147483647 } elseif ($rx -lt -2147483648) { $rx = -2147483648 } else { $rx = [int][Math]::Round($rx) }
                    if ($ry -gt 2147483647) { $ry = 2147483647 } elseif ($ry -lt -2147483648) { $ry = -2147483648 } else { $ry = [int][Math]::Round($ry) }
                    if ($rw -gt 2147483647) { $rw = 2147483647 } elseif ($rw -lt -2147483648) { $rw = -2147483648 } else { $rw = [int][Math]::Round($rw) }
                    if ($rh -gt 2147483647) { $rh = 2147483647 } elseif ($rh -lt -2147483648) { $rh = -2147483648 } else { $rh = [int][Math]::Round($rh) }
                }
                $patterns = @()
                foreach ($spec in $specs) {
                    $obj = $null
                    try {
                        if ($cached -and $depth -gt 0) {
                            if ($el.TryGetCachedPattern($spec[1], [ref]$obj)) { $patterns += $spec[0] }
                        } else {
                            if ($el.TryGetCurrentPattern($spec[1], [ref]$obj)) { $patterns += $spec[0] }
                        }
                    } catch { }
                }
                $hasIdentity = (([string]$info.Name) -ne '') -or (([string]$info.AutomationId) -ne '') -or ($patterns.Count -gt 0)
                if ($hasIdentity -or (-not $skipEmpty)) {
                    $nodes.Add([ordered]@{
                        depth        = $depth
                        name         = [string]$info.Name
                        controlType  = [string]$info.ControlType.ProgrammaticName
                        automationId = [string]$info.AutomationId
                        className    = [string]$info.ClassName
                        enabled      = [bool]$info.IsEnabled
                        offscreen    = (-not $finite) -or [bool]$info.IsOffscreen
                        x            = $rx
                        y            = $ry
                        width        = $rw
                        height       = $rh
                        patterns     = $patterns
                    })
                } else {
                    $skipped++
                }
            }
            if ($depth -ge $maxDepth) { continue }
            try {
                $children = $el.FindAll($scope, [System.Windows.Automation.Condition]::TrueCondition)
                foreach ($child in $children) {
                    # NOT `@($child, $depth + 1)`: an AutomationElement is enumerated by
                    # PowerShell's array subexpression, so that literal silently became a
                    # three-element array and every node reported depth 0. An explicitly
                    # sized array holds exactly the pair.
                    $pair = New-Object object[] 2
                    $pair[0] = $child
                    $pair[1] = $depth + 1
                    $queue.Enqueue($pair)
                }
            } catch { }
            if ($queue.Count -gt $maxQueue) { $maxQueue = $queue.Count }
        }
    } finally { $cache.Pop() }
    $traverseWatch.Stop()
    $traversal = [ordered]@{
        visited            = [int]$walked
        maxQueue           = [int]$maxQueue
        visitBudget        = [int]$visitBudget
        traversalTruncated = [bool]$traverseTruncated
        elapsedMs          = [int]$traverseWatch.ElapsedMilliseconds
    }
    $treeReply = Complete-UiTree ([ordered]@{ nodes = @($nodes.ToArray()); truncated = $truncated; mode = 'tree'; maxDepth = $maxDepth; maxNodes = $maxNodes; window = $windowInfo; settledMs = $settled; walked = $walked; skipped = $skipped; cachePatterns = [int]$script:UiaCachePatterns; traversal = $traversal }) $register $pruneRows $sinceArg
    return (Add-TextObservation $treeReply $Arg ([int64]$rootHwnd) 'managed' ([int]$windowInfo.pid))
}

function Do-Health {
    # OpenInputDesktop fails when the interactive desktop is not the input desktop,
    # which is what a locked workstation or a UAC secure prompt looks like from
    # here. SendInput in that state is silently dropped by Windows, so this check
    # is the difference between "the click did nothing" and a usable error.
    $desk = [DshNative]::OpenInputDesktop(0, $false, [DshNative]::DESKTOP_READOBJECTS)
    $interactive = $desk -ne [IntPtr]::Zero
    if ($interactive) { [void][DshNative]::CloseDesktop($desk) }
    $fg = [DshNative]::GetForegroundWindow()
    $title = ''
    if ($fg -ne [IntPtr]::Zero) { $title = [DshNative]::WindowText($fg) }
    $note = 'the interactive desktop is reachable'
    if (-not $interactive) { $note = 'the workstation is locked or a secure (UAC) prompt owns the input desktop; SendInput is silently dropped until it is dismissed' }
    elseif ($fg -eq [IntPtr]::Zero) { $note = 'no window currently has the foreground' }
    # Which engine reads UI Automation, and why it is not COM when it is not. A failed
    # compile of the COM layer used to downgrade every call silently, which is how a
    # missing overload went unnoticed for a whole round of work.
    $engine = 'com'
    if ($env:DSH_COMPUTER_UI_ENGINE -eq 'managed') { $engine = 'managed' }
    elseif (-not $script:ComUiaReady) { $engine = 'managed' }
    $engineError = ''
    if ($script:ComUiaReady -ne $true) { $engineError = "$($script:ComUiaError)" }
    # The pacing policy and whether a write is still pending an observation, reported here
    # because both change what a capture will do and neither is visible from the host.
    $pacing = Get-PacingConfig
    $pendingWrite = Get-WriteStampInfo
    # §7.4 item 7: what the COM boundary has created and released, so "does a long session
    # accumulate objects?" is answered by a number instead of by a guess. Only meaningful for
    # the COM engine; the managed one has no such objects to count.
    $comObjects = $null
    if ($engine -eq 'com' -and $script:ComUiaReady -eq $true) {
        try { $comObjects = [DshUia.Engine]::Census() | ConvertFrom-Json } catch { $comObjects = $null }
    }
    return [ordered]@{
        interactive     = $interactive
        foregroundHwnd  = [int64]$fg
        foregroundTitle = $title
        note            = $note
        engine          = $engine
        engineError     = $engineError
        comObjects      = $comObjects
        pacing          = $pacing
        pendingWrite    = $pendingWrite
    }
}

function Do-Pacing([object]$Arg) {
    # The pacing policy is readable and writable at runtime, because "how long may an
    # observation wait" is the knob an experiment has to move: a benchmark that compares
    # budgets sets them here instead of editing this file, or setting an environment
    # variable and restarting the worker. A write is reported back with what it changed.
    $before = Get-PacingConfig
    $changed = [ordered]@{}
    if ($null -ne $Arg) {
        if ($null -ne $Arg.settleMs) {
            $script:PostActionMs = [Math]::Max(0, [Math]::Min(5000, [int]$Arg.settleMs))
            $changed.settleMs = [int]$script:PostActionMs
        }
        if ($null -ne $Arg.stabilityMs) {
            $script:StabilityCeilingMs = [Math]::Max(0, [Math]::Min($script:StabilityMaxMs, [int]$Arg.stabilityMs))
            $changed.stabilityMs = [int]$script:StabilityCeilingMs
        }
        if ($null -ne $Arg.stableMs) {
            $script:StabilityStableMs = [Math]::Max(1, [Math]::Min($script:StabilityMaxMs, [int]$Arg.stableMs))
            $changed.stableMs = [int]$script:StabilityStableMs
        }
        if ($null -ne $Arg.stabilityPollMs) {
            $script:StabilityPollMs = [Math]::Max(20, [Math]::Min(2000, [int]$Arg.stabilityPollMs))
            $changed.stabilityPollMs = [int]$script:StabilityPollMs
        }
        if ($null -ne $Arg.writeTtlMs) {
            $script:WriteStampTtlMs = [Math]::Max(100, [Math]::Min(60000, [int]$Arg.writeTtlMs))
            $changed.writeTtlMs = [int]$script:WriteStampTtlMs
        }
    }
    return [ordered]@{ before = $before; after = (Get-PacingConfig); changed = $changed }
}

function Get-UiaRootForHwnd([int64]$hwnd) {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $el = $null
    # A window that just appeared frequently answers with no children for a moment
    # while its provider builds the tree. ONE retry is the right amount: it covers the
    # common case, and a window that is still empty after it gets an answer that says
    # so (the render tells the caller to retry), rather than every later read paying
    # for a window that is never going to have a tree.
    for ($attempt = 0; $attempt -lt 2; $attempt++) {
        try { $el = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$hwnd) } catch { $el = $null }
        if ($null -ne $el) {
            try {
                $kids = $el.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
                if ($kids.Count -gt 0) { return $el }
            } catch { }
        }
        if ($attempt -eq 0) { Start-Sleep -Milliseconds 250 }
    }
    # Several providers expose nothing through the window handle while the desktop
    # root still finds the same window by native handle. Without this fallback a
    # classic dialog such as Character Map answers with a single-node tree.
    try {
        $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NativeWindowHandleProperty, [int]$hwnd)
        $alt = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
        if ($null -ne $alt) {
            $kids = $alt.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
            if ($kids.Count -gt 0) { return $alt }
            if ($null -ne $el) { return $el }
            return $alt
        }
    } catch { }
    if ($null -ne $el) { return $el }
    throw "hwnd $hwnd has no usable UI Automation element"
}

function Get-UiaRoot([object]$Arg) {
    if ($null -ne $Arg.hwnd -and [int64]$Arg.hwnd -ne 0) {
        return Get-UiaRootForHwnd ([int64]$Arg.hwnd)
    }
    $fg = [DshNative]::GetForegroundWindow()
    if ($fg -eq [IntPtr]::Zero) { throw "no window currently has the foreground; pass hwnd explicitly" }
    return Get-UiaRootForHwnd ([int64]$fg)
}

# The patterns worth reporting, paired with the label the tool returns. Reported
# per node so the model can see what an element can actually do instead of guessing
# an action and reading the refusal — the tree says what is possible, and the caller
# finds out by looking rather than by trying.
#
# `text` is TextPattern: with it an element's contents can be read as text and a
# range inside it selected, which is how a document is read without OCR.
# Built lazily: the UIAutomationClient assembly is only loaded when a UI Automation
# command actually runs, so a session that never reads a tree never pays for it.
$script:UiaPatternSpecs = $null
function Get-UiaPatternSpecs {
    if ($null -eq $script:UiaPatternSpecs) {
        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes
        $script:UiaPatternSpecs = @(
            ,@('invoke', [System.Windows.Automation.InvokePattern]::Pattern)
            ,@('value', [System.Windows.Automation.ValuePattern]::Pattern)
            ,@('text', [System.Windows.Automation.TextPattern]::Pattern)
            ,@('select', [System.Windows.Automation.SelectionItemPattern]::Pattern)
            ,@('toggle', [System.Windows.Automation.TogglePattern]::Pattern)
            ,@('expand', [System.Windows.Automation.ExpandCollapsePattern]::Pattern)
            ,@('scroll_item', [System.Windows.Automation.ScrollItemPattern]::Pattern)
        )
    }
    return $script:UiaPatternSpecs
}

function New-UiaCacheRequest([bool]$withPatterns = $true) {
    # Without a cache request every property and every pattern probe is its own
    # cross-process call: a 300-node walk costs ~2000 of them and takes 500-650 ms.
    # A cache request turns that into one bulk fetch per node (~190 ms measured).
    #
    # The pattern properties are only asked for when the caller wants patterns (§7.4 第 1 条):
    # every cached pattern is a cross-process fetch per node that a caller who asked for
    # `patterns: false` never sees, so requesting them "just in case" pays the whole cost of
    # the feature and keeps none of the benefit. The COM engine has taken `$withPatterns` all
    # along; this is the managed wrapper catching up with it.
    $specs = if ($withPatterns) { @(Get-UiaPatternSpecs) } else { @() }
    $script:UiaCachePatterns = $specs.Count
    $cache = New-Object System.Windows.Automation.CacheRequest
    foreach ($p in @(
            [System.Windows.Automation.AutomationElement]::NameProperty,
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
            [System.Windows.Automation.AutomationElement]::ClassNameProperty,
            [System.Windows.Automation.AutomationElement]::IsEnabledProperty,
            [System.Windows.Automation.AutomationElement]::IsOffscreenProperty,
            [System.Windows.Automation.AutomationElement]::BoundingRectangleProperty)) {
        [void]$cache.Add($p)
    }
    foreach ($spec in $specs) { [void]$cache.Add($spec[1]) }
    # Element scope: every element a FindAll returns arrives with the data above
    # already attached, which is exactly what the breadth-first walk needs.
    $cache.TreeScope = [System.Windows.Automation.TreeScope]::Element
    return $cache
}

function Get-UiaPatterns($el, [bool]$cached) {
    $patterns = @()
    foreach ($spec in (Get-UiaPatternSpecs)) {
        $hit = $false
        try {
            if ($cached) {
                $obj = $null
                $hit = $el.TryGetCachedPattern($spec[1], [ref]$obj)
            } else {
                $obj = $null
                $hit = $el.TryGetCurrentPattern($spec[1], [ref]$obj)
            }
        } catch { $hit = $false }
        if ($hit) { $patterns += $spec[0] }
    }
    return $patterns
}

function Read-UiaNode($el, [int]$depth, [bool]$cached) {
    $info = $null
    if ($cached) { $info = $el.Cached } else { $info = $el.Current }
    $rect = $info.BoundingRectangle
    return [ordered]@{
        depth        = $depth
        name         = [string]$info.Name
        controlType  = [string]$info.ControlType.ProgrammaticName
        automationId = [string]$info.AutomationId
        className    = [string]$info.ClassName
        enabled      = [bool]$info.IsEnabled
        offscreen    = (-not (Test-RectFinite $rect)) -or [bool]$info.IsOffscreen
        x            = ConvertTo-SafeInt $rect.X
        y            = ConvertTo-SafeInt $rect.Y
        width        = ConvertTo-SafeInt $rect.Width
        height       = ConvertTo-SafeInt $rect.Height
        patterns     = Get-UiaPatterns $el $cached
    }
}

function ConvertTo-Node($el, [int]$depth) {
    # Live read, used where the element must stay actionable (uiact's before/after).
    return Read-UiaNode $el $depth $false
}

function Find-UiaMatch($root, [object]$Arg) {
    # Substring matching on the name is what makes this usable: automation ids are
    # frequently empty on Win32/UWP surfaces while the accessible name is stable.
    #
    # Subtree rather than Descendants, so the root element itself is a candidate: the
    # window pattern (close/minimize/maximize/restore) lives on the window element, and
    # a selector for it would otherwise match a child window that supports nothing.
    #
    # The accumulator is NOT called $matches: PowerShell variable names are
    # case-insensitive, so that would be the automatic $Matches hashtable, and the
    # -notmatch below would silently overwrite the array with a hashtable - which
    # then fails on the next += with "cannot add a hashtable to another hashtable".
    $scope = [System.Windows.Automation.TreeScope]::Subtree
    $all = $root.FindAll($scope, [System.Windows.Automation.Condition]::TrueCondition)
    $wantId = [string]$Arg.automationId
    $wantName = [string]$Arg.name
    $wantType = [string]$Arg.controlType
    $wantClass = [string]$Arg.className
    $index = 0
    if ($null -ne $Arg.index) { $index = [int]$Arg.index }
    $found = @()
    foreach ($el in $all) {
        $cur = $el.Current
        if ($wantId -and [string]$cur.AutomationId -ne $wantId) { continue }
        if ($wantClass -and [string]$cur.ClassName -ne $wantClass) { continue }
        if ($wantName -and ([string]$cur.Name).IndexOf($wantName, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
        if ($wantType -and ([string]$cur.ControlType.ProgrammaticName) -notmatch [regex]::Escape($wantType)) { continue }
        $found += $el
    }
    if ($found.Count -eq 0) {
        throw "no UI Automation element matched (automationId='$wantId' name~='$wantName' controlType='$wantType')"
    }
    if ($index -lt 0 -or $index -ge $found.Count) {
        throw "index $index is out of range; $($found.Count) element(s) matched"
    }
    return $found[$index]
}

function Get-UiaTextPattern($el) {
    $p = $null
    if (-not $el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$p)) {
        throw "the matched element does not support TextPattern, so its text cannot be read or selected (try ValuePattern through get_value instead)"
    }
    return $p
}

# The range API lives under System.Windows.Automation.Text, NOT directly under
# System.Windows.Automation: TextPatternRangeEndpoint (and TextUnit) are exported by
# UIAutomationTypes in that namespace, and a type literal with the wrong namespace
# fails at run time with "unable to find type" rather than at parse time.
#
# Resolved lazily because the type literal is evaluated where it is written: at
# script scope it would run before the UIAutomationTypes assembly is loaded and take
# the whole worker down at startup.
$script:UiaRangeStart = $null
$script:UiaRangeEnd = $null
$script:UiaTextUnit = $null

function Initialize-UiaTextRangeTypes {
    if ($null -ne $script:UiaRangeStart) { return }
    Add-Type -AssemblyName UIAutomationTypes
    $script:UiaRangeStart = [System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start
    $script:UiaRangeEnd = [System.Windows.Automation.Text.TextPatternRangeEndpoint]::End
    $script:UiaTextUnit = [System.Windows.Automation.Text.TextUnit]::Character
}

function Find-UiaTextRange($el, [string]$text, [string]$prefix, [string]$suffix, [int]$attempts) {
    # Locate a string inside a text element, honouring prefix/suffix context.
    #
    # Positioning by character offset is deliberately not offered: the only way to
    # walk to an offset through this API is one cross-process call per character, so
    # it degrades to seconds on a real document. Finding the text and then verifying
    # the context around the hit costs a handful of calls at any offset.
    if ([string]::IsNullOrEmpty($text)) { throw "the text to locate is required" }
    $tp = Get-UiaTextPattern $el
    Initialize-UiaTextRangeTypes
    $search = $tp.DocumentRange
    for ($i = 0; $i -lt $attempts; $i++) {
        $hit = $null
        try { $hit = $search.FindText($text, $false, $false) } catch { $hit = $null }
        if ($null -eq $hit) { break }
        if ($prefix -eq '' -and $suffix -eq '') { return $hit }
        # Read a context window around the hit and compare it. MoveEndpointByUnit
        # returns how far it actually moved, which is how much context exists.
        $probe = $hit.Clone()
        $before = 0
        $after = 0
        if ($prefix -ne '') { try { $before = [Math]::Abs($probe.MoveEndpointByUnit($script:UiaRangeStart, $script:UiaTextUnit, -1 * $prefix.Length)) } catch { $before = 0 } }
        if ($suffix -ne '') { try { $after = [Math]::Abs($probe.MoveEndpointByUnit($script:UiaRangeEnd, $script:UiaTextUnit, $suffix.Length)) } catch { $after = 0 } }
        $context = ''
        try { $context = [string]$probe.GetText(-1) } catch { $context = '' }
        $okPrefix = $true
        if ($prefix -ne '') { $okPrefix = $context.StartsWith($prefix) }
        $okSuffix = $true
        if ($suffix -ne '') { $okSuffix = $context.EndsWith($suffix) }
        if ($okPrefix -and $okSuffix) { return $hit }
        # Not the right occurrence: restart the search just past this hit.
        $search = $tp.DocumentRange.Clone()
        [void]$search.MoveEndpointByRange($script:UiaRangeStart, $hit, $script:UiaRangeEnd)
    }
    if ($prefix -ne '' -or $suffix -ne '') {
        if ((Test-HasSurrogate $text) -or (Test-HasSurrogate $prefix) -or (Test-HasSurrogate $suffix)) {
            throw "the text '$text' was not found with the given prefix/suffix in this element, and one of them contains a character outside the Basic Multilingual Plane (a surrogate pair): this provider's character arithmetic may differ from UTF-16 code units, so the range boundary would fall inside a character. Retry without prefix/suffix, or with a prefix that is plain text; nothing was selected"
        }
        throw "the text '$text' was not found with the given prefix/suffix in this element; nothing was selected"
    }
    throw "the text '$text' was not found in this element"
}

function Test-HasSurrogate([string]$value) {
    # A character outside the Basic Multilingual Plane is two UTF-16 code units, and a
    # provider that counts characters will move half a character too far.
    if ([string]::IsNullOrEmpty($value)) { return $false }
    foreach ($ch in $value.ToCharArray()) { if ([char]::IsSurrogate($ch)) { return $true } }
    return $false
}

function Select-UiaText($el, [object]$Arg) {
    # Select the located text -- or collapse onto one of its edges to place the caret.
    $text = [string]$Arg.text
    $prefix = ''
    if ($null -ne $Arg.prefix) { $prefix = [string]$Arg.prefix }
    $suffix = ''
    if ($null -ne $Arg.suffix) { $suffix = [string]$Arg.suffix }
    $selectionType = 'text'
    if ($null -ne $Arg.selectionType) { $selectionType = "$($Arg.selectionType)" }
    $attempts = 8
    if ($null -ne $Arg.attempts) { $attempts = [Math]::Max(1, [Math]::Min(50, [int]$Arg.attempts)) }

    $found = Find-UiaTextRange $el $text $prefix $suffix $attempts
    if ($selectionType -eq 'cursor_before') {
        [void]$found.MoveEndpointByRange($script:UiaRangeEnd, $found, $script:UiaRangeStart)
    } elseif ($selectionType -eq 'cursor_after') {
        [void]$found.MoveEndpointByRange($script:UiaRangeStart, $found, $script:UiaRangeEnd)
    }
    $found.Select()
    $selected = ''
    try { $selected = [string]$found.GetText(-1) } catch { $selected = '' }
    return $selected
}

function Get-UiaTextRect($el, [object]$Arg, [bool]$union = $false) {
    # Where the located text sits on screen. The managed API hands back one
    # System.Windows.Rect per line while COM hands back a flat double[] of quadruples --
    # same method name, different shape, so the two are read differently here.
    #
    # $union picks the bounding box of every line (for "where is this text") over the
    # first line (for "what should a click hit").
    $text = [string]$Arg.text
    $prefix = ''
    if ($null -ne $Arg.prefix) { $prefix = [string]$Arg.prefix }
    $suffix = ''
    if ($null -ne $Arg.suffix) { $suffix = [string]$Arg.suffix }
    $attempts = 8
    if ($null -ne $Arg.attempts) { $attempts = [Math]::Max(1, [Math]::Min(50, [int]$Arg.attempts)) }
    $found = Find-UiaTextRange $el $text $prefix $suffix $attempts
    $rects = $null
    try { $rects = $found.GetBoundingRectangles() } catch { $rects = $null }
    $usable = @()
    if ($null -ne $rects) {
        foreach ($candidate in @($rects)) {
            if ($null -ne $candidate -and [double]$candidate.Width -gt 0 -and [double]$candidate.Height -gt 0) { $usable += $candidate }
        }
    }
    if ($usable.Count -eq 0) {
        throw "the matched text reported no on-screen rectangle, so there is nothing to click: this provider does not support text geometry"
    }
    $x = [double]$usable[0].X
    $y = [double]$usable[0].Y
    $width = [double]$usable[0].Width
    $height = [double]$usable[0].Height
    if ($union -and $usable.Count -gt 1) {
        $left = ($usable | ForEach-Object { [double]$_.X } | Measure-Object -Minimum).Minimum
        $top = ($usable | ForEach-Object { [double]$_.Y } | Measure-Object -Minimum).Minimum
        $right = ($usable | ForEach-Object { [double]$_.X + [double]$_.Width } | Measure-Object -Maximum).Maximum
        $bottom = ($usable | ForEach-Object { [double]$_.Y + [double]$_.Height } | Measure-Object -Maximum).Maximum
        $x = $left; $y = $top; $width = $right - $left; $height = $bottom - $top
    }
    $selected = ''
    try { $selected = [string]$found.GetText(-1) } catch { $selected = $text }
    return [ordered]@{
        text   = $selected
        x      = [int][Math]::Round($x)
        y      = [int][Math]::Round($y)
        width  = [int][Math]::Round($width)
        height = [int][Math]::Round($height)
    }
}

function Get-UiaCaret() {
    # The managed wrapper has no TextPattern2, so there is no managed way to ask this.
    # Refusing beats reporting a caret position that was never read.
    throw "the caret position needs TextPattern2, which the managed UI Automation wrapper does not expose; the COM engine (the default) can read it"
}

function Read-UiaText($el) {
    # No MSAA fallback here: the managed wrapper has no LegacyIAccessiblePattern type at
    # all (enumerating UIAutomationClient's exported types turns up TextPattern and the
    # Text namespace, nothing else), so the legacy read is a COM-engine capability.
    $tp = Get-UiaTextPattern $el
    $doc = $tp.DocumentRange
    $limit = 4000
    $text = [string]$doc.GetText($limit + 1)
    $truncated = $false
    if ($text.Length -gt $limit) { $text = $text.Substring(0, $limit); $truncated = $true }
    return [ordered]@{ text = $text; truncated = $truncated }
}

function Get-ComUiTextAction([int64]$hwnd, [object]$Arg) {
    # get_text / select_text through the text pattern. Same limits and the same
    # refusal sentences as the managed path, so the host's error codes are unchanged.
    $action = "$($Arg.action)".ToLowerInvariant()
    $index = 0
    if ($null -ne $Arg.index) { $index = [int]$Arg.index }
    $matched = $null; $errorText = ''
    $text = ''; $truncated = $false
    if ($action -eq 'get_text') {
        [DshUia.Engine]::ReadText($hwnd, [string]$Arg.automationId, [string]$Arg.name, [string]$Arg.controlType, [string]$Arg.className, $index,
            [ref]$text, [ref]$truncated, [ref]$matched, [ref]$errorText)
    } else {
        $attempts = 8
        if ($null -ne $Arg.attempts) { $attempts = [Math]::Max(1, [Math]::Min(50, [int]$Arg.attempts)) }
        $selectionType = 'text'
        if ($null -ne $Arg.selectionType) { $selectionType = "$($Arg.selectionType)" }
        [DshUia.Engine]::SelectText($hwnd, [string]$Arg.automationId, [string]$Arg.name, [string]$Arg.controlType, [string]$Arg.className, $index,
            [string]$Arg.text, [string]$Arg.prefix, [string]$Arg.suffix, $selectionType, $attempts,
            [ref]$text, [ref]$matched, [ref]$errorText)
    }
    if ($errorText -ne '') { throw $errorText }
    $node = $null
    if ($null -ne $matched -and $matched.Count -gt 0) { $node = @(ConvertFrom-ComRows $matched)[0] }
    return [ordered]@{ action = $action; value = $text; truncated = $truncated; wrote = $false; matched = $node }
}

function Get-ComUiAct([int64]$hwnd, [object]$Arg) {
    $action = "$($Arg.action)".ToLowerInvariant()
    $index = 0
    if ($null -ne $Arg.index) { $index = [int]$Arg.index }
    $matched = $null; $value = ''; $wrote = $true; $errorText = ''
    [DshUia.Engine]::Act($hwnd, $action,
        [string]$Arg.automationId, [string]$Arg.name, [string]$Arg.controlType, [string]$Arg.className, $index,
        [string]$Arg.value, [ref]$matched, [ref]$value, [ref]$wrote, [ref]$errorText)
    if ($errorText -ne '') { throw $errorText }
    $node = $null
    if ($null -ne $matched -and $matched.Count -gt 0) { $node = @(ConvertFrom-ComRows $matched)[0] }
    return [ordered]@{ action = $action; value = $value; truncated = $false; wrote = $wrote; matched = $node }
}

function Do-UiAct([object]$Arg) {
    $action = "$($Arg.action)".ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($action)) { throw "uiact requires an action" }
    # Without a selector this would silently address the root's first descendant --
    # a control nobody asked for, reported as a success. Refuse instead: a wrong
    # target that looks like one is worse than no answer.
    $hasSelector = ($null -ne $Arg.automationId -and "$($Arg.automationId)" -ne '') -or
                   ($null -ne $Arg.name -and "$($Arg.name)" -ne '') -or
                   ($null -ne $Arg.controlType -and "$($Arg.controlType)" -ne '') -or
                   ($null -ne $Arg.className -and "$($Arg.className)" -ne '')
    if (-not $hasSelector) { throw "uiact needs at least one selector: automationId, name, controlType or className" }

    # Every action is a pattern call now, including the text ones: the COM engine owns
    # the text range machinery as well.
    $engine = 'com'
    if ($env:DSH_COMPUTER_UI_ENGINE -eq 'managed') { $engine = 'managed' }
    if ($engine -eq 'com' -and -not $script:ComUiaReady) { $engine = 'managed' }
    $textAction = ($action -eq 'get_text') -or ($action -eq 'select_text')
    $targetHwnd = [IntPtr]::Zero
    if ($null -ne $Arg.hwnd -and [int64]$Arg.hwnd -ne 0) {
        $targetHwnd = [IntPtr][int64]$Arg.hwnd
    } else {
        $fgProbe = [DshNative]::GetForegroundWindow()
        if ($fgProbe -ne [IntPtr]::Zero) { $targetHwnd = $fgProbe }
    }
    if ($engine -eq 'com' -and $targetHwnd -ne [IntPtr]::Zero) {
        if ($action -eq 'get_caret') {            $active = $false; $line = ''; $matched = $null; $errorText = ''
            $caretX = 0; $caretY = 0; $caretW = 0; $caretH = 0
            [DshUia.Engine]::ReadCaret([int64]$targetHwnd,
                [string]$Arg.automationId, [string]$Arg.name, [string]$Arg.controlType, [string]$Arg.className, $index,
                [ref]$active, [ref]$line, [ref]$caretX, [ref]$caretY, [ref]$caretW, [ref]$caretH, [ref]$matched, [ref]$errorText)
            if ($errorText -ne '') { throw $errorText }
            $node = $null
            if ($null -ne $matched -and $matched.Count -gt 0) { $node = @(ConvertFrom-ComRows $matched)[0] }
            $receipt = [ordered]@{
                action     = 'get_caret'
                value      = $line
                truncated  = $false
                wrote      = $false
                matched    = $node
                foreground = (Get-ForegroundInfo)
            }
            if ($caretW -gt 0 -and $caretH -gt 0) {
                $receipt.rect = [ordered]@{ x = $caretX; y = $caretY; width = $caretW; height = $caretH }
            }
            if (-not $active) { $receipt.note = 'the element reports no active caret' }
            return $receipt
        }
        if ($action -eq 'click_text' -or $action -eq 'locate_text') {
            # Locate the text through COM; click_text then clicks through the ordinary
            # click path so the a11y-first rule and the SendInput guard apply unchanged.
            # locate_text exists so a caller that only wants the geometry never has to
            # click anything.
            $attempts = 8
            if ($null -ne $Arg.attempts) { $attempts = [Math]::Max(1, [Math]::Min(50, [int]$Arg.attempts)) }
            $rectX = 0; $rectY = 0; $rectW = 0; $rectH = 0; $foundText = ''; $matched = $null; $errorText = ''
            [DshUia.Engine]::LocateText([int64]$targetHwnd,
                [string]$Arg.automationId, [string]$Arg.name, [string]$Arg.controlType, [string]$Arg.className, $index,
                [string]$Arg.text, [string]$Arg.prefix, [string]$Arg.suffix, $attempts,
                [ref]$rectX, [ref]$rectY, [ref]$rectW, [ref]$rectH, [ref]$foundText, [ref]$matched, [ref]$errorText)
            if ($errorText -ne '') { throw $errorText }
            $node = $null
            if ($null -ne $matched -and $matched.Count -gt 0) { $node = @(ConvertFrom-ComRows $matched)[0] }
            $centreX = $rectX + [int]($rectW / 2)
            $centreY = $rectY + [int]($rectH / 2)
            if ($action -eq 'click_text') {
                try {
                    [void](Do-Click @{ x = $centreX; y = $centreY; button = 'left'; clicks = 1 })
                } catch {
                    # The locate half always works; the click half depends on the desktop
                    # accepting input. Losing the rectangle when the click is refused would
                    # throw away the half that succeeded, so it goes into the failure.
                    throw "$($_.Exception.Message) -- the text was located at $centreX,$centreY ($($rectW)x$($rectH)); click that point with computer_click once input is available"
                }
            }
            # click_text clicks, so it is a write and keeps the pace; locate_text only
            # looked, and sleeping after a look is the cost this build removes.
            if ($action -eq 'click_text' -and $script:ReadSettleMs -gt 0) { Wait-Cancellable $script:ReadSettleMs }
            return [ordered]@{
                action     = $action
                value      = $foundText
                truncated  = $false
                wrote      = ($action -eq 'click_text')
                matched    = $node
                foreground = (Get-ForegroundInfo)
                rect       = [ordered]@{ x = $rectX; y = $rectY; width = $rectW; height = $rectH }
            }
        }
        if ($textAction) { $result = Get-ComUiTextAction ([int64]$targetHwnd) $Arg }
        else { $result = Get-ComUiAct ([int64]$targetHwnd) $Arg }
        if ($result.wrote) { Set-WriteStamp -What 'uiact' -Hwnd $targetHwnd }
        # Same rule as the managed path below: a read does not sleep, a write keeps the
        # beat. get_value and get_text are the two calls a caller makes most often, and
        # they are the two that used to pay 120 ms each for nothing.
        if ($result.wrote -and $script:ReadSettleMs -gt 0) { Wait-Cancellable $script:ReadSettleMs }
        return [ordered]@{
            action     = $result.action
            value      = $result.value
            truncated  = $result.truncated
            wrote      = $result.wrote
            matched    = $result.matched
            foreground = (Get-ForegroundInfo)
        }
    }

    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $root = Get-UiaRoot $Arg
    $el = Find-UiaMatch $root $Arg
    $before = ConvertTo-Node $el 0
    # A disabled control silently ignores actuation on most providers, so refusing is
    # the difference between "the action did nothing" and a usable answer. Reading is
    # still allowed: a disabled field's value is worth seeing.
    $reading = ($action -eq 'get_value') -or ($action -eq 'get_text') -or ($action -eq 'locate_text') -or ($action -eq 'get_caret')
    if ((-not $reading) -and ($before.enabled -ne $true)) {
        throw "the matched element is disabled ($(Get-NodeLabel $before)), so it would ignore the action; nothing was sent"
    }
    $value = ''
    $truncated = $false
    $wrote = $true
    $rect = $null
    switch ($action) {
        'invoke' {
            $p = $null
            if (-not $el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { throw "the matched element does not support Invoke" }
            ([System.Windows.Automation.InvokePattern]$p).Invoke()
        }
        'set_value' {
            $p = $null
            if (-not $el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { throw "the matched element does not support ValuePattern.SetValue" }
            $vp = [System.Windows.Automation.ValuePattern]$p
            $vp.SetValue([string]$Arg.value)
            # Read it back: accepting the write and keeping the old text is a thing a
            # read-only or masked control does, and "it was set" is a claim the caller
            # acts on.
            try { $value = [string]$vp.Current.Value } catch { $value = '' }
        }
        'get_value' {
            $wrote = $false
            $p = $null
            if (-not $el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { throw "the matched element does not support ValuePattern" }
            $value = [string]([System.Windows.Automation.ValuePattern]$p).Current.Value
        }
        'get_text' {
            $wrote = $false
            $read = Read-UiaText $el
            $value = $read.text
            $truncated = $read.truncated
        }
        'select_text' {
            $value = Select-UiaText $el $Arg
        }
        'scroll_into_view' {
            $p = $null
            if (-not $el.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern, [ref]$p)) { throw "the matched element does not support ScrollItemPattern.ScrollIntoView (it is not inside a scrollable container)" }
            ([System.Windows.Automation.ScrollItemPattern]$p).ScrollIntoView()
        }
        'focus' { $el.SetFocus() }
        'toggle' {
            $p = $null
            if (-not $el.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) { throw "the matched element does not support Toggle" }
            ([System.Windows.Automation.TogglePattern]$p).Toggle()
        }
        'select' {
            $p = $null
            if (-not $el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) { throw "the matched element does not support SelectionItem" }
            ([System.Windows.Automation.SelectionItemPattern]$p).Select()
        }
        'expand' {
            $p = $null
            if (-not $el.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$p)) { throw "the matched element does not support ExpandCollapse" }
            ([System.Windows.Automation.ExpandCollapsePattern]$p).Expand()
        }
        'collapse' {
            $p = $null
            if (-not $el.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$p)) { throw "the matched element does not support ExpandCollapse" }
            ([System.Windows.Automation.ExpandCollapsePattern]$p).Collapse()
        }
        'close' {
            # What alt+f4 does, minus the requirement that the window hold the
            # foreground and minus any synthesized input.
            $p = $null
            if (-not $el.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$p)) { throw "the matched element does not support WindowPattern (close/minimize/maximize/restore)" }
            ([System.Windows.Automation.WindowPattern]$p).Close()
        }
        'minimize' {
            $p = $null
            if (-not $el.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$p)) { throw "the matched element does not support WindowPattern (close/minimize/maximize/restore)" }
            ([System.Windows.Automation.WindowPattern]$p).SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Minimized)
        }
        'maximize' {
            $p = $null
            if (-not $el.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$p)) { throw "the matched element does not support WindowPattern (close/minimize/maximize/restore)" }
            ([System.Windows.Automation.WindowPattern]$p).SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Maximized)
        }
        'restore' {
            $p = $null
            if (-not $el.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$p)) { throw "the matched element does not support WindowPattern (close/minimize/maximize/restore)" }
            ([System.Windows.Automation.WindowPattern]$p).SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Normal)
        }
        'legacy_action' {
            $p = $null
            if (-not $el.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$p)) { throw "the matched element does not support LegacyIAccessiblePattern.DoDefaultAction" }
            ([System.Windows.Automation.LegacyIAccessiblePattern]$p).DoDefaultAction()
        }
        'locate_text' {
            # Read-only: where is this text on screen. Kept separate from click_text so
            # a caller that only wants the geometry never has to click anything. The
            # rectangle is the bounding box of every line the match covers, because
            # "where is this paragraph" is its extent, not its first line.
            $located = Get-UiaTextRect $el $Arg $true
            $value = $located.text
            $rect = [ordered]@{ x = $located.x; y = $located.y; width = $located.width; height = $located.height }
            $wrote = $false
        }
        'click_text' {
            # Address something by its text instead of by coordinates. The click goes
            # through the same path computer_click uses, so the a11y-first rule and the
            # SendInput guard apply here too.
            $located = Get-UiaTextRect $el $Arg
            $value = $located.text
            $rect = [ordered]@{ x = $located.x; y = $located.y; width = $located.width; height = $located.height }
            $centreX = $located.x + [int]($located.width / 2)
            $centreY = $located.y + [int]($located.height / 2)
            try {
                [void](Do-Click @{ x = $centreX; y = $centreY; button = 'left'; clicks = 1 })
            } catch {
                # The locate half always works; the click half depends on the desktop
                # accepting input. Losing the rectangle when the click is refused would
                # throw away the half that succeeded, so it goes into the failure.
                throw "$($_.Exception.Message) -- the text was located at $centreX,$centreY ($($located.width)x$($located.height)); click that point with computer_click once input is available"
            }
        }
        'get_caret' { [void](Get-UiaCaret) }
        default { throw "unknown UI Automation action '$action'" }
    }
    if ($wrote) { Set-WriteStamp -What $action -Hwnd $targetHwnd }
    # Only a write has something to wait for. A read that slept here spent 120 ms
    # answering "what does this field say" for no reason at all -- ten reads is 1.2 s
    # of a caller's budget, on a path that produced no change. The write paths keep
    # their own pacing: the write stamp above is what the settle floor is measured
    # against, so nothing is lost by not sleeping in the read path.
    if ($wrote -and $script:ReadSettleMs -gt 0) { Wait-Cancellable $script:ReadSettleMs }
    $receipt = [ordered]@{ action = $action; value = $value; truncated = $truncated; wrote = $wrote; matched = $before; foreground = (Get-ForegroundInfo) }
    if ($null -ne $rect) { $receipt.rect = $rect }
    return $receipt
}

function Do-Wait([object]$Arg) {
    $seconds = 0.0
    if ($null -ne $Arg.seconds) { $seconds = [double]$Arg.seconds }
    if ($seconds -lt 0) { $seconds = 0 }
    if ($seconds -gt 30) { $seconds = 30 }
    # Sliced, so a cancel lands during the wait instead of after it: a 30 s wait is
    # the longest single step a caller ever asks for, and the one it is most likely
    # to be cancelling when it changes its mind.
    if ($seconds -gt 0) {
        Wait-Cancellable ([int]($seconds * 1000))
        # A wait is an observation boundary: a frame taken before it is a picture of a moment
        # the caller has just declared to be in the past. `wait: 0` (or a request that rounds
        # to nothing) is not a boundary, and this is the same rule the batch's wait step uses.
        [void](Advance-ObservationEpoch)
    }
    return [ordered]@{ seconds = $seconds }
}

# ------------------------------------------------------- waiting for a condition
#
# A fixed sleep is a guess about how slow an application is, made before anyone could
# know. When the caller knows *what* it is waiting for -- a dialog, an enabled button,
# a field that now holds the text that was typed -- the wait can end as soon as it is
# true, and the answer can say whether it ever was. These functions are that wait:
# the worker polls, the model gets one answer, and the "click / read / not yet / sleep
# / read again" loop collapses into a single call.

function Get-ConditionField($spec, [string]$name, $fallback = $null) {
    # The same field arrives as a hashtable from a batch step and as a PSCustomObject
    # from the JSON protocol. Read both without assuming which.
    if ($null -eq $spec) { return $fallback }
    if ($spec -is [System.Collections.IDictionary]) {
        if ($spec.Contains($name) -and $null -ne $spec[$name]) { return $spec[$name] }
        return $fallback
    }
    $property = $spec.PSObject.Properties[$name]
    if ($null -ne $property -and $null -ne $property.Value) { return $property.Value }
    return $fallback
}

function Get-WaitConditionSpec([object]$Arg) {
    # Accepts either a step (`{ action = 'wait_for'; condition = {...} }`) or the
    # waitFor parameter, where the condition is the object itself.
    $spec = $Arg
    $nested = Get-ConditionField $Arg 'condition'
    if ($null -ne $nested) { $spec = $nested }
    $timeout = Get-ConditionField $Arg 'timeout_ms'
    if ($null -eq $timeout) { $timeout = Get-ConditionField $spec 'timeout_ms' }
    if ($null -eq $timeout) { $timeout = Get-ConditionField $Arg 'timeoutMs' }
    if ($null -eq $timeout) { $timeout = Get-ConditionField $spec 'timeoutMs' }
    $ms = $script:WaitMaxMs
    if ($null -ne $timeout -and "$timeout" -ne '') { $ms = [int]$timeout }
    $ms = [Math]::Max(0, [Math]::Min($script:WaitMaxMs, $ms))
    $source = 'explicit'
    if ($null -eq $timeout -or "$timeout" -eq '') { $source = 'default' }
    $poll = Get-ConditionField $Arg 'poll_ms'
    if ($null -eq $poll) { $poll = Get-ConditionField $spec 'poll_ms' }
    $pollMs = $script:WaitPollMs
    if ((Get-WaitConditionWeight $spec) -eq 'heavy') { $pollMs = $script:WaitHeavyPollMs }
    if ($null -ne $poll -and "$poll" -ne '') { $pollMs = [int]$poll }
    $pollMs = [Math]::Max(20, [Math]::Min(2000, $pollMs))
    return [ordered]@{ condition = $spec; timeoutMs = $ms; timeoutFrom = $source; pollMs = $pollMs; weight = (Get-WaitConditionWeight $spec) }
}

function Get-WaitConditionWeight([object]$Predicate) {
    # 'light' or 'heavy', for the polling plan (§6.2). A window's existence or a file's state is a
    # cheap check that can be asked often; a control/value/text condition walks a UI Automation
    # tree, and a region condition reads and fingerprints pixels -- those start slower and back off
    # to a lower ceiling. A group inherits the heaviest leg, because the group is only as cheap as
    # its most expensive member.
    if ($null -eq $Predicate) { return 'light' }
    $kind = "$(Get-ConditionField $Predicate 'kind' '')".ToLowerInvariant()
    if ($kind -eq '') {
        if ($null -ne (Get-ConditionField $Predicate 'every') -and "$(Get-ConditionField $Predicate 'every')" -ne '') { $kind = 'every' }
        elseif ($null -ne (Get-ConditionField $Predicate 'any') -and "$(Get-ConditionField $Predicate 'any')" -ne '') { $kind = 'any' }
        elseif ($null -ne (Get-ConditionField $Predicate 'rect') -and "$(Get-ConditionField $Predicate 'rect')" -ne '') { $kind = 'region' }
        elseif (-not [string]::IsNullOrEmpty("$(Get-ConditionField $Predicate 'path' '')")) { $kind = 'file' }
        elseif ("$(Get-ConditionField $Predicate 'type' '')".ToLowerInvariant() -eq 'value') { $kind = 'value' }
        elseif (-not [string]::IsNullOrEmpty("$(Get-ConditionField $Predicate 'expected' '')")) { $kind = 'value' }
        elseif (-not [string]::IsNullOrEmpty("$(Get-ConditionField $Predicate 'contains' '')")) { $kind = 'text' }
        elseif (-not [string]::IsNullOrEmpty("$(Get-ConditionField $Predicate 'name' '')") -or
                -not [string]::IsNullOrEmpty("$(Get-ConditionField $Predicate 'automation_id' '')") -or
                -not [string]::IsNullOrEmpty("$(Get-ConditionField $Predicate 'automationId' '')") -or
                -not [string]::IsNullOrEmpty("$(Get-ConditionField $Predicate 'control_type' '')") -or
                -not [string]::IsNullOrEmpty("$(Get-ConditionField $Predicate 'className' '')")) { $kind = 'control' }
        else { $kind = 'window' }
    }
    if ($kind -eq 'window' -or $kind -eq 'file') { return 'light' }
    if ($kind -eq 'every' -or $kind -eq 'any') {
        $legs = @()
        $list = Get-ConditionField $Predicate $kind
        if ($null -ne $list) { $legs = @($list) }
        foreach ($leg in $legs) {
            if ((Get-WaitConditionWeight $leg) -eq 'heavy') { return 'heavy' }
        }
        return 'light'
    }
    # control, value, text, region and anything unknown: the expensive ones.
    return 'heavy'
}

function New-PredicateResult {
    # Three-valued on purpose (C05). "The condition is false" and "the condition could not
    # be observed" are different answers, and a wait that reports the second as the first
    # tells the caller a dialog does not exist when in fact nobody managed to look.
    #
    # `status` is the value: 'true', 'false' or 'unknown'. `satisfied` is kept because it is
    # what the existing callers and receipts read, and it is exactly `status -eq 'true'`.
    return [ordered]@{
        what       = ''
        satisfied  = $false
        status     = 'false'
        observed   = ''
        window     = $null
        control    = $null
        error      = ''
        stableMs   = 0
    }
}

function Set-PredicateStatus($result, [string]$status) {
    if ($null -eq $result) { return $result }
    $result.status = "$status"
    $result.satisfied = ("$status" -eq 'true')
    return $result
}

function Get-CompositeStatus([object[]]$statuses) {
    # Three-valued logic for `every` and `any`, stated once so the two cannot drift:
    #
    #   every: one definite false makes the whole false; otherwise one unknown makes it
    #          unknown; only all-true is true.
    #   any:   one definite true makes the whole true; otherwise one unknown makes it
    #          unknown; only all-false is false.
    #
    # The point of the asymmetry is that a missing answer never silently becomes a verdict.
    $anyTrue = $false
    $anyFalse = $false
    $anyUnknown = $false
    foreach ($status in @($statuses)) {
        if ("$status" -eq 'true') { $anyTrue = $true }
        elseif ("$status" -eq 'false') { $anyFalse = $true }
        else { $anyUnknown = $true }
    }
    return [ordered]@{ anyTrue = $anyTrue; anyFalse = $anyFalse; anyUnknown = $anyUnknown }
}

function Get-EnabledWindowInfo([object]$Predicate) {
    # The window a condition is about: the named handle, or whatever holds the
    # foreground when none is named. A window that has gone away answers $null, which
    # is a legitimate observation for a wait ("the dialog closed") rather than a fault.
    $hwnd = [int64](Get-ConditionField $Predicate 'hwnd' 0)
    if ($hwnd -eq 0) {
        $fg = [DshNative]::GetForegroundWindow()
        if ($fg -eq [IntPtr]::Zero) { return $null }
        $hwnd = [int64]$fg
    }
    if (-not [DshNative]::IsWindow([IntPtr]$hwnd)) { return $null }
    $info = Get-WindowInfoForHwnd ([IntPtr]$hwnd)
    if ($null -eq $info) { return $null }
    $pid = [int64](Get-ConditionField $Predicate 'pid' 0)
    if ($pid -ne 0 -and [int64]$info.pid -ne $pid) { return $null }
    return $info
}

function Test-ConditionValue($Predicate) {
    # "the field now holds this". The comparison reads a value the same way the
    # get_value action does, so what a wait concludes and what a read reports cannot
    # disagree about the same control.
    $result = New-PredicateResult
    $want = "$(Get-ConditionField $Predicate 'expected' '')"
    $mode = "$(Get-ConditionField $Predicate 'is' '')"
    $isNot = ($mode -eq 'not')
    $match = 'contains'
    if ($isNot) { $match = 'contains' }
    $explicitMatch = Get-ConditionField $Predicate 'match'
    if ($null -ne $explicitMatch -and "$explicitMatch" -ne '') { $match = "$explicitMatch" }
    $name = "$(Get-ConditionField $Predicate 'name' '')"
    $controlType = "$(Get-ConditionField $Predicate 'control_type' "$(Get-ConditionField $Predicate 'controlType' '')")"
    $id = "$(Get-ConditionField $Predicate 'automation_id' "$(Get-ConditionField $Predicate 'automationId' '')")"
    $arguments = @{
        action       = 'get_value'
        hwnd         = (Get-ConditionField $Predicate 'hwnd' 0)
        automationId = $id
        name         = $name
        controlType  = $controlType
        index        = [int](Get-ConditionField $Predicate 'index' 0)
    }
    $read = $null
    try { $read = Do-UiAct $arguments } catch {
        # `unknown`, not `false`: failing to read a value is not the statement "the value is
        # something else", and conflating them lets a wait conclude that a field never
        # reached its target when it was simply unreadable at that moment.
        $result.what = 'value'
        $result.error = "the value could not be read yet: $($_.Exception.Message)"
        $result.observed = $result.error
        return (Set-PredicateStatus $result 'unknown')
    }
    $current = "$($read.value)"
    $hit = $false
    switch ($match) {
        'exact'    { $hit = ($current -ceq $want) }
        'equals'   { $hit = ($current -eq $want) }
        'matches'  { $hit = ($current -match $want) }
        'empty'    { $hit = ($current -eq '') }
        default    { $hit = ($current.IndexOf($want, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) }
    }
    if ($isNot) { $hit = -not $hit }
    $result.what = "value of $(if ($name -ne '') { "the control named '$name'" } else { 'the control' })"
    $result.control = $read.matched
    $result.observed = "it holds '$current'"
    return (Set-PredicateStatus $result $(if ($hit) { 'true' } else { 'false' }))
}

function Test-ConditionControl([object]$Predicate) {
    # "this control is there" (and, when asked, that it is enabled and on screen).
    $result = New-PredicateResult
    $hwnd = [int64](Get-ConditionField $Predicate 'hwnd' 0)
    $name = "$(Get-ConditionField $Predicate 'name' '')"
    $controlType = "$(Get-ConditionField $Predicate 'control_type' "$(Get-ConditionField $Predicate 'controlType' '')")"
    $id = "$(Get-ConditionField $Predicate 'automation_id' "$(Get-ConditionField $Predicate 'automationId' '')")"
    $cls = "$(Get-ConditionField $Predicate 'class_name' "$(Get-ConditionField $Predicate 'className' '')")"
    $wantEnabled = Get-ConditionField $Predicate 'enabled'
    $wantVisible = Get-ConditionField $Predicate 'visible'
    $hidden = ("$(Get-ConditionField $Predicate 'is' '')" -eq 'absent')
    $label = @()
    if ($name -ne '') { $label += "name~'$name'" }
    if ($id -ne '') { $label += "#$id" }
    if ($controlType -ne '') { $label += "type '$controlType'" }
    if ($cls -ne '') { $label += "class '$cls'" }
    if ($label.Count -eq 0) { $label = @('any control') }
    $result.what = "a control matching $($label -join ' ')"
    $tree = $null
    try {
        $tree = Do-UiTree ([ordered]@{
            hwnd         = $hwnd
            name         = $name
            controlType  = $controlType
            automationId = $id
            className    = $cls
            maxDepth     = 10
            maxNodes     = 1500
            patterns     = $false
            skipEmpty    = $false
            prune        = $false
        }) $false
    } catch {
        # A provider that cannot answer is not a control that is absent. That distinction is
        # the whole reason the result carries a status: it decides whether the caller keeps
        # waiting or is told to look somewhere else.
        $result.error = "the tree could not be read: $($_.Exception.Message)"
        $result.observed = $result.error
        return (Set-PredicateStatus $result 'unknown')
    }
    $rows = @($tree.nodes)
    # A truncated read covered the first max_nodes of the tree and no more: "I did not find
    # it" is then not a statement about the window, and must not be reported as one.
    $truncated = ($tree.truncated -eq $true)
    $windowInfo = $null
    if ($null -ne $tree.window) { $windowInfo = $tree.window }
    $result.window = $windowInfo
    if ($hidden) {
        if ($rows.Count -eq 0 -and $truncated) {
            $result.observed = 'the read was truncated before it covered the whole tree, so "it is gone" cannot be concluded from it'
            return (Set-PredicateStatus $result 'unknown')
        }
        $result.observed = $(if ($rows.Count -eq 0) { 'it is not in the tree' } else { "it is still there ($($rows.Count) node(s))" })
        return (Set-PredicateStatus $result $(if ($rows.Count -eq 0) { 'true' } else { 'false' }))
    }
    if ($rows.Count -eq 0) {
        if ($truncated) {
            $result.observed = 'the read was truncated before it covered the whole tree, so nothing matched *yet* is not the same as nothing is there'
            return (Set-PredicateStatus $result 'unknown')
        }
        $result.observed = 'no node matched yet'
        return (Set-PredicateStatus $result 'false')
    }
    $node = $rows[0]
    $result.control = $node
    $problems = @()
    if ($wantEnabled -eq $true -and $node.enabled -ne $true) { $problems += 'it is disabled' }
    if ($wantVisible -eq $true -and $node.offscreen -eq $true) { $problems += 'it is offscreen' }
    $result.observed = $(if ($problems.Count -eq 0) { 'it is there and usable' } else { "it is there but $($problems -join ' and ')" })
    return (Set-PredicateStatus $result $(if ($problems.Count -eq 0) { 'true' } else { 'false' }))
}

function Test-ConditionText([object]$Predicate) {
    # "somewhere in this window there is now this text". The tree is rendered to one
    # string and searched, which is the same material computer_ui puts in front of a
    # caller -- so a wait and a read agree about what "the text is there" means.
    #
    # UIA text conditions only ever cover the text the accessible tree actually exposes: a
    # self-drawn "downloaded" label that no provider publishes is not findable here, and the
    # right answer is a visual or file condition rather than a longer wait.
    $result = New-PredicateResult
    $want = "$(Get-ConditionField $Predicate 'contains' "$(Get-ConditionField $Predicate 'text' '')")"
    $hwnd = [int64](Get-ConditionField $Predicate 'hwnd' 0)
    $result.what = "the window to contain '$want'"
    $tree = $null
    try {
        $tree = Do-UiTree ([ordered]@{
            hwnd      = $hwnd
            maxDepth  = 10
            maxNodes  = 1500
            patterns  = $false
            skipEmpty = $true
            prune     = $false
        }) $false
    } catch {
        $result.error = "the window could not be read: $($_.Exception.Message)"
        $result.observed = $result.error
        return (Set-PredicateStatus $result 'unknown')
    }
    $rows = @($tree.nodes)
    $haystack = ''
    foreach ($row in $rows) {
        $haystack += "$($row.name)`n$($row.automationId)`n"
    }
    $result.window = $tree.window
    $hit = $haystack.IndexOf($want, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    if (-not $hit -and $tree.truncated -eq $true) {
        $result.observed = "$($rows.Count) node(s) read and none carries that text, but the read was truncated, so its absence is not established"
        return (Set-PredicateStatus $result 'unknown')
    }
    $result.observed = $(if ($hit) { 'the text is there' } else { "$($rows.Count) node(s) read, and none of them carries that text" })
    return (Set-PredicateStatus $result $(if ($hit) { 'true' } else { 'false' }))
}

function Test-FileParseable([string]$path, [object]$item) {
    # Only the formats this backend can actually check are checked. Anything else is reported
    # as "not verifiable" rather than as a pass: a condition that says `true` about a file
    # nobody read is worse than one that says it cannot tell (方案 §6.2 的"保留证据等级").
    $ext = ''
    try { $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant() } catch { $ext = '' }
    $size = [int64]$item.Length
    switch ($ext) {
        '.json' {
            if ($size -gt 8MB) { return @{ status = 'unknown'; note = "it is too large to parse here ($size bytes)" } }
            try {
                [void](Get-Content -LiteralPath $path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop)
                return @{ status = 'true'; note = 'it parses as JSON' }
            } catch { return @{ status = 'false'; note = 'it does not parse as JSON yet' } }
        }
        '.zip' {
            try {
                Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
                $archive = [System.IO.Compression.ZipFile]::OpenRead($path)
                try {
                    $count = @($archive.Entries).Count
                    if ($count -le 0) { return @{ status = 'false'; note = 'the archive opens but holds no entries' } }
                    return @{ status = 'true'; note = "it opens as a ZIP with $count entries" }
                } finally { $archive.Dispose() }
            } catch { return @{ status = 'false'; note = 'it does not open as a ZIP yet' } }
        }
        default {
            if (@('.csv', '.txt', '.log', '.md', '.tsv', '') -contains $ext) {
                try {
                    $reader = [System.IO.File]::OpenText($path)
                    try {
                        $line = $reader.ReadLine()
                        if ([string]::IsNullOrWhiteSpace($line)) { return @{ status = 'false'; note = 'its first line is empty' } }
                        return @{ status = 'true'; note = 'its first line reads' }
                    } finally { $reader.Dispose() }
                } catch { return @{ status = 'unknown'; note = 'it could not be read' } }
            }
            return @{ status = 'unknown'; note = "this backend cannot verify a '$ext' file" }
        }
    }
}

function Test-ConditionFile([object]$Predicate) {
    # "The artefact this task is about has appeared and is finished."
    #
    # A file condition is the one completion signal that does not depend on the application
    # telling anyone anything: the export wrote it, the download wrote it, and the disk knows.
    # What it must not do is mistake "a file with that name exists" for "the file is complete"
    # -- a half-written download, a leftover from the previous run and a file still being
    # appended to all look the same from the name alone.
    #
    # So the predicate has three parts, each optional on top of the first:
    #
    #   present        the path exists (and, when asked, is at least min_bytes)
    #   stable_for_ms  its size and last-write time stopped moving that long ago
    #   parse          it reads as what its extension claims
    #
    # A path that cannot even be looked at -- access denied, a share that went away -- is
    # `unknown`: nobody looked, so nothing was learned, and that is a different answer from
    # "the file is not there".
    $result = New-PredicateResult
    $path = "$(Get-ConditionField $Predicate 'path' '')"
    if ($path -eq '') { throw "[BAD_REQUEST] a file condition needs a path" }
    $mode = "$(Get-ConditionField $Predicate 'is' '')"
    $absent = ($mode -eq 'absent') -or ($mode -eq 'closed')
    $minBytes = [int64](Get-ConditionField $Predicate 'min_bytes' 0)
    $stableFor = [int64](Get-ConditionField $Predicate 'stable_for_ms' 0)
    $wantParse = ((Get-ConditionField $Predicate 'parse' $false) -eq $true)
    $wanted = "the file '$path'"
    if ($minBytes -gt 0) { $wanted = "$wanted to hold at least $minBytes byte(s)" }
    if ($stableFor -gt 0) { $wanted = "$wanted, unchanged for ${stableFor} ms" }
    if ($wantParse) { $wanted = "$wanted, readable as its own format" }
    $result.what = $wanted
    $exists = $false
    try { $exists = Test-Path -LiteralPath $path -ErrorAction Stop } catch {
        $result.observed = "the path could not be looked at: $($_.Exception.Message)"
        return (Set-PredicateStatus $result 'unknown')
    }
    if (-not $exists) {
        if ($absent) {
            $result.observed = 'it is not there'
            return (Set-PredicateStatus $result 'true')
        }
        $result.observed = 'it is not there yet'
        return (Set-PredicateStatus $result 'false')
    }
    if ($absent) {
        $result.observed = 'it is still there'
        return (Set-PredicateStatus $result 'false')
    }
    $item = $null
    try { $item = Get-Item -LiteralPath $path -ErrorAction Stop } catch {
        $result.observed = "it is there but could not be read: $($_.Exception.Message)"
        return (Set-PredicateStatus $result 'unknown')
    }
    $size = [int64]$item.Length
    if ($minBytes -gt 0 -and $size -lt $minBytes) {
        $result.observed = "it is there with $size byte(s), under the $minBytes byte floor"
        return (Set-PredicateStatus $result 'false')
    }
    if ($stableFor -gt 0) {
        $ageMs = [int64](([DateTime]::UtcNow - $item.LastWriteTimeUtc).TotalMilliseconds)
        if ($ageMs -lt $stableFor) {
            $result.observed = "it was written to $ageMs ms ago, less than the ${stableFor} ms of stillness asked for"
            return (Set-PredicateStatus $result 'false')
        }
    }
    if ($wantParse) {
        $verdict = Test-FileParseable $path $item
        $result.observed = "$size byte(s), and $($verdict.note)"
        return (Set-PredicateStatus $result "$($verdict.status)")
    }
    $written = $item.LastWriteTimeUtc.ToString('yyyy-MM-dd HH:mm:ssZ')
    $result.observed = "$size byte(s), last written $written"
    return (Set-PredicateStatus $result 'true')
}

function Test-ConditionWindow([object]$Predicate) {
    # "a window like this exists now". Enumerated live rather than remembered: the point of
    # the wait is that the caller has not looked since starting whatever produces the window.
    #
    # Every condition that was given is applied, and they are applied together. The old
    # shape filtered the list by whichever of `title`/`process` was written first and then
    # applied the other one only if the first was empty -- so `{ title: 'Save As',
    # process: 'notepad' }` matched a "Save As" dialog belonging to *any* process, which is
    # exactly the pair a caller writes when it wants to be sure it has the right one (C03).
    $result = New-PredicateResult
    $wantTitle = "$(Get-ConditionField $Predicate 'title' '')"
    $wantTitleExact = "$(Get-ConditionField $Predicate 'title_exact' '')"
    $wantProcess = "$(Get-ConditionField $Predicate 'process' '')"
    $wantProcessExact = "$(Get-ConditionField $Predicate 'process_exact' '')"
    $wantPid = [int64](Get-ConditionField $Predicate 'pid' 0)
    $wantHwnd = [int64](Get-ConditionField $Predicate 'hwnd' 0)
    $mode = "$(Get-ConditionField $Predicate 'is' '')"
    $isGone = ($mode -eq 'absent') -or ($mode -eq 'closed')
    $list = $null
    try {
        # No filter in the enumeration: the conditions are applied here so that all of them
        # are applied, and so the answer does not depend on which one was used as a filter.
        $list = Do-Windows @{ filter = '' }
    } catch {
        $result.what = 'a window'
        $result.error = "the window list could not be enumerated: $($_.Exception.Message)"
        $result.observed = $result.error
        return (Set-PredicateStatus $result 'unknown')
    }
    $rows = @($list.windows)
    $matched = New-Object System.Collections.Generic.List[object]
    foreach ($row in $rows) {
        if ($wantHwnd -ne 0 -and [int64]$row['hwnd'] -ne $wantHwnd) { continue }
        if ($wantPid -ne 0 -and [int64]$row['pid'] -ne $wantPid) { continue }
        $title = "$($row['title'])"
        $procName = "$($row['process'])"
        if ($wantTitle -ne '' -and $title.IndexOf($wantTitle, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
        if ($wantTitleExact -ne '' -and -not $title.Trim().Equals($wantTitleExact.Trim(), [System.StringComparison]::OrdinalIgnoreCase)) { continue }
        if ($wantProcess -ne '' -and $procName.IndexOf($wantProcess, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
        if ($wantProcessExact -ne '') {
            $wantName = $wantProcessExact
            if ($wantName.EndsWith('.exe', [System.StringComparison]::OrdinalIgnoreCase)) { $wantName = $wantName.Substring(0, $wantName.Length - 4) }
            if (-not $procName.Equals($wantName, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
        }
        $matched.Add($row)
    }
    $described = @()
    if ($wantHwnd -ne 0) { $described += "hwnd $wantHwnd" }
    if ($wantTitle -ne '') { $described += "title~'$wantTitle'" }
    if ($wantTitleExact -ne '') { $described += "title='$wantTitleExact'" }
    if ($wantProcess -ne '') { $described += "process~'$wantProcess'" }
    if ($wantProcessExact -ne '') { $described += "process='$wantProcessExact'" }
    if ($wantPid -ne 0) { $described += "pid $wantPid" }
    if ($described.Count -eq 0) { $described = @('any visible window') }
    $result.what = "a window with $($described -join ' ')"
    if ($matched.Count -gt 0) { $result.window = $matched[0] }
    if ($isGone) {
        $result.observed = $(if ($matched.Count -eq 0) { 'no such window is open now' } else { "$($matched.Count) matching window(s) are still open" })
        return (Set-PredicateStatus $result $(if ($matched.Count -eq 0) { 'true' } else { 'false' }))
    }
    $result.observed = $(if ($matched.Count -gt 0) { "it is open: '$($matched[0]['title'])' hwnd $($matched[0]['hwnd'])" } else { 'no such window is open yet' })
    return (Set-PredicateStatus $result $(if ($matched.Count -gt 0) { 'true' } else { 'false' }))
}

function Test-ConditionGroup([object]$Predicate, [string]$mode) {
    # `every` / `any` as three-valued logic, stated once so the two cannot drift (C05):
    #
    #   every: one definite false decides; otherwise one unknown makes the group unknown;
    #          only an all-true list is true.
    #   any:   one definite true decides; otherwise one unknown makes the group unknown;
    #          only an all-false list is false.
    #
    # "The wait ran out of budget" is a different fact from "the group is false", and it is
    # reported by the wait itself rather than folded in here.
    $result = New-PredicateResult
    $result.what = $(if ($mode -eq 'any') { 'any one of its conditions' } else { 'every one of its conditions' })
    $parts = @(Get-ConditionField $Predicate $mode @())
    if ($parts.Count -eq 0 -and $mode -eq 'every') { $parts = @(Get-ConditionField $Predicate 'of' @()) }
    if ($parts.Count -eq 0) {
        $result.observed = "the $mode group carries no conditions, so there is nothing to observe"
        return (Set-PredicateStatus $result 'unknown')
    }
    $rows = New-Object System.Collections.Generic.List[object]
    foreach ($part in $parts) {
        $one = Test-ConditionPredicate $part
        $rows.Add($one)
        if ($null -eq $result.window -and $null -ne $one.window) { $result.window = $one.window }
        if ($null -eq $result.control -and $null -ne $one.control) { $result.control = $one.control }
    }
    $summary = Get-CompositeStatus @($rows | ForEach-Object { "$($_.status)" })
    $status = 'false'
    if ($mode -eq 'any') {
        if ($summary.anyTrue) { $status = 'true' }
        elseif ($summary.anyUnknown) { $status = 'unknown' }
        else { $status = 'false' }
    } else {
        if ($summary.anyFalse) { $status = 'false' }
        elseif ($summary.anyUnknown) { $status = 'unknown' }
        else { $status = 'true' }
    }
    $result.observed = (@($rows | ForEach-Object { "$($_.what): $($_.observed)" }) -join '; ')
    return (Set-PredicateStatus $result $status)
}

function Test-ConditionRegion([object]$Predicate) {
    # A visual condition over a rectangle of the desktop (§6.2 "自绘界面" row: 目标区域语义变化、
    # 视觉标识). It is the one completion condition that needs no cooperation from the application
    # at all -- it reads pixels.
    #
    # Three modes, each the weakest claim that answers the question:
    #   * `stable`  -- the region looks the same as on the previous sample. The caller's stable_ms
    #     is what turns that into "it stopped changing"; this only answers "same or not".
    #   * `changed` -- the region differs from the *first* sample this wait took. That is what
    #     "the list refreshed", "the spinner went away", "the panel redrew" look like from outside.
    #   * `matches` -- the region equals a fingerprint the caller already has (from `digest`, which
    #     returns the same kind of value).
    #
    # A region that cannot be read at all is `unknown`, never false: a locked session or a
    # rectangle that left the desktop is not evidence that the interface did not change.
    $rect = $Predicate.rect
    if ($null -eq $rect) { return @{ status = 'unknown'; note = 'the region condition has no rect' } }
    $x = [int]$rect.x
    $y = [int]$rect.y
    $w = [int]$rect.width
    $h = [int]$rect.height
    if ($w -le 0 -or $h -le 0) { return @{ status = 'unknown'; note = 'the region condition has an empty rect' } }
    $mode = "$($Predicate.mode)"
    if ($mode -eq '') { $mode = 'stable' }
    # A rectangle that is not on the desktop at all cannot be watched, and "the pixels never
    # changed" would be a lie: there are no pixels. Checked before sampling so the answer is
    # `unknown` rather than a fingerprint of nothing.
    $virtual = Get-VirtualBounds
    if ($x -lt [int]$virtual.x -or $y -lt [int]$virtual.y -or ($x + $w) -gt ([int]$virtual.x + [int]$virtual.width) -or ($y + $h) -gt ([int]$virtual.y + [int]$virtual.height)) {
        return @{ status = 'unknown'; what = "the region ($x,$y) ${w}x${h}"; note = "the region ($x,$y) ${w}x${h} is not inside the desktop ($($virtual.x),$($virtual.y)) $($virtual.width)x$($virtual.height), so it cannot be watched" }
    }
    $maxSide = 160
    if ($null -ne $Predicate.max_side -and [int]$Predicate.max_side -gt 0) { $maxSide = [int]$Predicate.max_side }
    $digest = ''
    try { $digest = Get-RegionDigest $x $y $w $h $maxSide } catch { $digest = '' }
    if ($digest -eq '') {
        return @{ status = 'unknown'; note = "the region ($x,$y) ${w}x${h} could not be read" }
    }
    if ($mode -eq 'matches') {
        $expected = "$($Predicate.expected_digest)"
        if ($expected -eq '') { return @{ status = 'unknown'; note = 'mode matches needs expected_digest' } }
        return @{ status = ($digest -eq $expected); digest = $digest; note = "region fingerprint $digest" }
    }
    # Baselines live in this worker, keyed by the rectangle: a wait that samples every 120 ms must
    # not re-establish "what it looked like first" on every sample, and two waits over different
    # rectangles must not share one. A baseline older than ten minutes is not a baseline.
    $key = "$x,$y,$w,$h,$maxSide"
    $now = [int64]$script:Clock.ElapsedMilliseconds
    if ($mode -eq 'changed') {
        $baseline = $script:RegionBaselines[$key]
        if ($null -eq $baseline -or ($now - [int64]$baseline.at) -gt 600000) {
            $script:RegionBaselines[$key] = @{ digest = $digest; at = $now }
            return @{ status = $false; digest = $digest; note = 'baseline taken from this sample; a later sample says whether it changed' }
        }
        return @{ status = ($digest -ne [string]$baseline.digest); digest = $digest; note = "region fingerprint $digest (baseline $($baseline.digest))" }
    }
    # mode stable: compare against the previous sample of this same rectangle.
    $previous = $script:RegionBaselines[$key]
    $script:RegionBaselines[$key] = @{ digest = $digest; at = $now }
    if ($null -eq $previous) {
        return @{ status = $false; digest = $digest; note = 'first sample of this region; the next one decides stability' }
    }
    return @{ status = ($digest -eq [string]$previous.digest); digest = $digest; note = "region fingerprint $digest" }
}

function Test-ConditionPredicate([object]$Predicate) {
    # One predicate, evaluated once. Anything unrecognised is refused loudly rather
    # than treated as satisfied: a wait that answers "yes" to a condition nobody
    # wrote is worse than no wait at all.
    $kind = "$(Get-ConditionField $Predicate 'kind' '')".ToLowerInvariant()
    if ($kind -eq '' ) {
        # A shorthand: the fields present decide what was meant, so the common case
        # ("wait until the name field says Done") needs no kind at all.
        $every = Get-ConditionField $Predicate 'every'
        $any = Get-ConditionField $Predicate 'any'
        if ($null -ne $every -and "$every" -ne '') { $kind = 'every' }
        elseif ($null -ne $any -and "$any" -ne '') { $kind = 'any' }
        elseif ("$(Get-ConditionField $Predicate 'type' '')".ToLowerInvariant() -eq 'value') { $kind = 'value' }
        elseif (-not [string]::IsNullOrEmpty("$(Get-ConditionField $Predicate 'expected' '')")) { $kind = 'value' }
        elseif (-not [string]::IsNullOrEmpty("$(Get-ConditionField $Predicate 'contains' '')")) { $kind = 'text' }
        elseif (-not [string]::IsNullOrEmpty("$(Get-ConditionField $Predicate 'path' '')")) { $kind = 'file' }
        elseif ($null -ne (Get-ConditionField $Predicate 'rect') -and "$(Get-ConditionField $Predicate 'rect')" -ne '') { $kind = 'region' }
        elseif ("$(Get-ConditionField $Predicate 'control' '')" -eq 'present') { $kind = 'control' }
        elseif ("$(Get-ConditionField $Predicate 'control' '')" -eq 'absent') { $kind = 'control' }
        elseif (-not [string]::IsNullOrEmpty("$(Get-ConditionField $Predicate 'name' '')") -or
                -not [string]::IsNullOrEmpty("$(Get-ConditionField $Predicate 'automation_id' '')") -or
                -not [string]::IsNullOrEmpty("$(Get-ConditionField $Predicate 'automationId' '')") -or
                -not [string]::IsNullOrEmpty("$(Get-ConditionField $Predicate 'control_type' '')") -or
                -not [string]::IsNullOrEmpty("$(Get-ConditionField $Predicate 'controlType' '')") -or
                -not [string]::IsNullOrEmpty("$(Get-ConditionField $Predicate 'class_name' '')") -or
                -not [string]::IsNullOrEmpty("$(Get-ConditionField $Predicate 'className' '')")) { $kind = 'control' }
        else { $kind = 'window' }
    }
    switch ($kind) {
        'idle'    {
            # A lazily-asked-for pause is a contradiction, so it is refused rather than
            # answered: polling a sleep would make the *whole* condition forever pending,
            # and the caller would wait out a budget to learn nothing. A call that wants
            # time to pass uses the `wait` step, which says so in its name.
            throw "[BAD_REQUEST] 'idle' is not a condition: it is a duration, and a duration is what the `wait` step is for. A condition is something that can become true: window, control, value, text, or an `every` list of those"
        }
        'text'    { return (Test-ConditionText $Predicate) }
        'file'    { return (Test-ConditionFile $Predicate) }
        'control' { return (Test-ConditionControl $Predicate) }
        'value'   { return (Test-ConditionValue $Predicate) }
        'window'  { return (Test-ConditionWindow $Predicate) }
        'region'  { return (Test-ConditionRegion $Predicate) }
        'every'   { return (Test-ConditionGroup $Predicate 'every') }
        'any'     { return (Test-ConditionGroup $Predicate 'any') }
        default { throw "[BAD_REQUEST] unknown wait condition kind '$kind'; known kinds: window, control, value, text, file, region, every, any" }
    }
}

function Get-WaitDeadlineMs([object]$Arg, [object]$Spec) {
    # A wait is bounded from two directions: its own timeout, and the deadline of the call it
    # is part of (C04). The smaller one wins and the rest of the batch's budget is what a
    # step actually gets -- otherwise five steps of "30 s each" claim two and a half minutes
    # while the caller sits under one transport budget, and the batch is cut off from the
    # outside with no report at all.
    $budget = [int64]$Spec.timeoutMs
    $deadlineAt = $null
    $raw = Get-ConditionField $Arg 'deadlineAtMs'
    if ($null -ne $raw -and "$raw" -ne '') { $deadlineAt = [int64]$raw }
    if ($null -ne $deadlineAt) {
        $left = [int64]$deadlineAt - [int64]$script:Clock.ElapsedMilliseconds
        if ($left -lt 0) { $left = 0 }
        if ($left -lt $budget) { $budget = $left }
    }
    return $budget
}

function Wait-ForCondition([object]$Arg) {
    # Polls until the condition holds or the budget runs out, then reports what it concluded
    # instead of throwing: "it never became true" is a fact about the application, and the
    # caller's next decision depends on it.
    #
    # Three answers this report has to keep apart, and used to run together (C01/C05):
    #
    #   satisfied   the condition was true *and stayed true* for stable_ms when that was asked
    #   timeout     it was false throughout the budget -- a real observation of "not yet"
    #   unavailable it could not be observed at all (a provider that would not answer, a
    #               truncated read), which is not the statement "it is not there"
    #
    # The old loop reported `satisfied: true` whenever the last sample happened to be true,
    # so a 200 ms "and it stays that way" condition reported success after 45 ms because the
    # budget ended first. The exit reason and the continuous hold are what decide now.
    $spec = Get-WaitConditionSpec $Arg
    $condition = $spec.condition
    if ($null -eq $condition) { throw "[BAD_REQUEST] waiting for a condition needs a condition" }
    $budgetMs = Get-WaitDeadlineMs $Arg $spec
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    $polls = 0
    $last = $null
    $trueSince = [int64]-1
    $heldMs = [int64]0
    $stableMs = [int64](Get-ConditionField $condition 'stable_ms' 0)
    $outcome = 'timeout'
    $timeoutKind = ''
    $pollMs = [int]$spec.pollMs
    # Bounded backoff (B05): a light check while the condition is likely to turn true soon,
    # backing off towards a second for one that takes a while. The ceiling is what keeps a
    # slow condition from becoming a busy loop; the floor is what keeps a fast one from
    # paying a long poll for nothing.
    # The backoff ceiling follows the same rule as the starting interval: a cheap check may climb
    # to 500 ms, an expensive one is allowed to climb further (up to 1200 ms) before it settles,
    # because each of its samples costs the application real work.
    $maxPollMs = [int][Math]::Min(1000, [Math]::Max($pollMs * 4, 500))
    if ("$($spec.weight)" -eq 'heavy') { $maxPollMs = [int][Math]::Min(1200, [Math]::Max($pollMs * 4, 800)) }
    $currentPollMs = $pollMs
    while ($true) {
        Assert-NotCancelled 'during a condition wait'
        # The budget is asked *before* the sample, not after it (§5.7). Sampling first meant a
        # wait whose budget was already spent still made one observation -- and a satisfying
        # one reported `satisfied: true` for a call that had no time left to have observed it
        # (PS07). Nothing was watched in that case, and the report says so rather than claiming
        # the condition was false.
        $left = [int64]$budgetMs - [int64]$clock.ElapsedMilliseconds
        if ($left -le 0) {
            $outcome = 'timeout'
            if ($polls -eq 0) {
                # Nothing was ever watched: the budget was spent before the wait started.
                $timeoutKind = 'budget-spent'
                break
            }
            # A check *was* made and the budget has since run out: the exit reason is what that
            # check said, classified exactly as the post-sample branch below does it. Without
            # this distinction every exhausted wait would report 'budget-spent' and stop saying
            # whether the condition was observed false or could not be observed at all.
            if ("$($last.status)" -eq 'unknown') { $timeoutKind = 'unavailable' }
            elseif ($stableMs -gt 0 -and $trueSince -ge 0) { $timeoutKind = 'not-held' }
            break
        }
        $polls++
        $last = Test-ConditionPredicate $condition
        $now = [int64]$clock.ElapsedMilliseconds
        if ("$($last.status)" -eq 'true') {
            if ($stableMs -le 0) {
                $heldMs = [int64]0
                $outcome = 'satisfied'
                break
            }
            if ($trueSince -lt 0) { $trueSince = $now }
            $heldMs = $now - $trueSince
            if ($heldMs -ge $stableMs) { $outcome = 'satisfied'; break }
        } else {
            $trueSince = [int64]-1
            $heldMs = [int64]0
        }
        $left = [int64]$budgetMs - [int64]$clock.ElapsedMilliseconds
        if ($left -le 0) {
            $outcome = 'timeout'
            if ("$($last.status)" -eq 'unknown') { $timeoutKind = 'unavailable' }
            elseif ($stableMs -gt 0 -and $trueSince -ge 0) { $timeoutKind = 'not-held' }
            break
        }
        $sleep = [int][Math]::Min([int]$currentPollMs, [int]$left)
        Wait-Cancellable $sleep
        $currentPollMs = [int][Math]::Min($maxPollMs, [int][Math]::Max($pollMs, [int]($currentPollMs * 2)))
    }
    $waited = [int64]$clock.ElapsedMilliseconds
    # A wait boundary. Whatever this worker is asked next happens after this wait, and a
    # frame taken before it may not stand in for the state after it (see Test-CaptureReusable).
    [void](Advance-ObservationEpoch)
    $status = 'false'
    if ($null -ne $last) { $status = "$($last.status)" }
    # Nothing was watched at all: the call had no budget left to watch with. That is not the
    # statement "the condition is false", so it is reported as the third answer (§5.7/PS07).
    $watched = $null -ne $last
    if (-not $watched) { $status = 'unknown' }
    $budgetFrom = "$($spec.timeoutFrom)"
    if ($budgetMs -ne [int64]$spec.timeoutMs) { $budgetFrom = 'deadline' }
    $report = [ordered]@{
        # What was watched, in the words of the condition itself. A condition that did not name
        # itself still gets a truthful label here rather than an empty string: the report is read
        # by a model deciding what to do next, and "" tells it nothing about what it waited for.
        what        = $(if ("$($last.what)" -ne '') { "$($last.what)" } elseif ("$($last.kind)" -eq 'region') { 'a region of the screen' } else { "$($last.kind)" })
        satisfied   = ($outcome -eq 'satisfied')
        status      = $status
        outcome     = $outcome
        waitedMs    = [int]$waited
        polls       = [int]$polls
        timeoutMs   = [int]$budgetMs
        timeoutFrom = $budgetFrom
        pollMs      = [int]$pollMs
        observed    = "$($last.observed)"
    }
    if ($maxPollMs -gt $pollMs) { $report.pollBackoffTo = [int]$maxPollMs }
    if ($timeoutKind -ne '') { $report.timeoutKind = $timeoutKind }
    if ($stableMs -gt 0) {
        $report.stableMs = [int]$stableMs
        $report.heldMs = [int]$heldMs
        if ($outcome -eq 'satisfied') { $report.observed = "$($last.observed); it held for the whole $($stableMs) ms asked for" }
        elseif ($trueSince -ge 0) { $report.observed = "$($last.observed); it was true for $($heldMs) ms of the $($stableMs) ms asked for before the budget ran out, so it did not stay true" }
    }
    if ($outcome -eq 'timeout' -and "$timeoutKind" -eq 'unavailable') {
        $report.observed = "$($report.observed); the condition could not be observed at all inside the budget, which is not the same statement as its being false"
    }
    if ($null -ne $last.window) { $report.window = $last.window }
    if ($null -ne $last.control) { $report.control = $last.control }
    if (-not $watched) {
        $report.what = 'nothing was watched: this call had no budget left when the wait started'
        $report.observed = 'the budget of this call was already spent, so no check was made -- this is not the answer "the condition is false". Give the next call more time (deadline_ms / timeout_ms) and ask again.'
        $report.timeoutKind = 'budget-spent'
    }
    if ($outcome -ne 'satisfied' -and "$($last.error)" -ne '') { $report.error = "$($last.error)" }
    return $report
}

# ------------------------------------------------------------------ batching

function Get-NodeLabel($node) {
    if ($null -eq $node) { return '(unknown element)' }
    $type = ([string]$node.controlType).Replace('ControlType.', '')
    $name = [string]$node.name
    $id = [string]$node.automationId
    $label = "($type)"
    if ($name -ne '') { $label = "$type `"$name`"" }
    if ($id -ne '') { $label = "$label #$id" }
    return $label
}

function Invoke-UiaStep([object]$step) {
    # A UI Automation action writes to the application just as a click does, so a *write* step
    # is refused once the call's budget is spent -- and a read step is not, because a read
    # inside the budget is exactly what §5.7 asks to keep working while it lasts (§5.7, item 4).
    $stepAction = "$($step.action)".ToLowerInvariant()
    if ($WRITE_STEP_ACTIONS -contains $stepAction) { Assert-CanSend "before the '$stepAction' step" }
    # Maps a batch step onto the same code path computer_ui_action uses, so a whole
    # deterministic sequence (click, type, invoke, read the value back) costs one
    # model round trip instead of four.
    $a = @{}
    if ($null -ne $step.ref -and "$($step.ref)" -ne '') { $a.ref = "$($step.ref)" }
    if ($null -ne $step.hwnd) { $a.hwnd = $step.hwnd }
    if ($null -ne $step.automation_id) { $a.automationId = $step.automation_id }
    if ($null -ne $step.name) { $a.name = $step.name }
    if ($null -ne $step.control_type) { $a.controlType = $step.control_type }
    if ($null -ne $step.class_name) { $a.className = $step.class_name }
    if ($null -ne $step.element_index) { $a.index = $step.element_index }
    if ($null -ne $step.value) { $a.value = $step.value }
    if ($null -ne $step.text) { $a.text = $step.text }
    if ($null -ne $step.prefix) { $a.prefix = $step.prefix }
    if ($null -ne $step.suffix) { $a.suffix = $step.suffix }
    if ($null -ne $step.selection_type) { $a.selectionType = $step.selection_type }
    $a.action = "$($step.action)"
    # `ref` is a pre-resolution layer, so a step carrying one takes the ref-aware
    # path and inherits the same stale-ref refusal the single-step tool has.
    if ($null -ne $a.ref) { return Do-UiActByRef $a }
    return Do-UiAct $a
}

# The single-step tool, the batch dispatcher and the host's schema all describe the
# same set of actions, and they have to agree in both directions:
#
#   * an action the schema accepts needs a branch here, otherwise a caller that used
#     only documented parameters gets "unknown step action" -- which is what used to
#     happen to click_text, get_caret, legacy_action, locate_text and the four window
#     actions (29 declared, 21 implemented);
#   * the host refuses to talk to a worker whose list differs from its own, so a
#     half-applied upgrade fails loudly at startup instead of on the model's third
#     action.
#
# Order is part of the contract and is checked, so it is written once, here.
$UIA_STEP_ACTIONS = @(
    'invoke', 'set_value', 'get_value', 'get_text', 'select_text', 'scroll_into_view',
    'toggle', 'select', 'expand', 'collapse',
    'close', 'minimize', 'maximize', 'restore', 'legacy_action',
    'click_text', 'locate_text', 'get_caret'
)
$STEP_ACTIONS = @('click', 'move', 'drag', 'scroll', 'type', 'key', 'wait', 'wait_for', 'screenshot', 'paste', 'focus', 'clipboard') + $UIA_STEP_ACTIONS

function Get-UiaStepLine([string]$action, $receipt) {
    # One line per step, in the shape the host renders. Read-only steps report what
    # they read; window actions report the element they acted on.
    $label = Get-NodeLabel $receipt.matched
    switch ($action) {
        'get_value'        { return "get_value $label -> $($receipt.value)" }
        'get_text'         {
            $shown = "$($receipt.value)"
            if ($shown.Length -gt 2000) { $shown = $shown.Substring(0, 2000) }
            return "get_text $label -> $shown"
        }
        'set_value'        { return "set_value $label = $($receipt.value)" }
        'select_text'      { return "select_text $label -> '$($receipt.value)'" }
        'click_text'       { return "click_text '$($receipt.value)' $label" }
        'locate_text'      { return "locate_text '$($receipt.value)' $label" }
        'get_caret'        { return "get_caret line='$($receipt.value)'" }
        'legacy_action'    { return "legacy_action $label" }
        default            { return "$action $label" }
    }
}

$WRITE_STEP_ACTIONS = @(
    # `move` is in here because it is a write: it changes what is under the cursor (hover,
    # tooltip, focus ring), the batch stamps a write ordinal for it, and $FOREGROUND_STEP_ACTIONS
    # has always listed it. Leaving it out meant a batch whose only write was a move answered
    # `evidence: null` -- a request for evidence silently dropped -- and, worse, let the
    # evidence comparison reuse a frame taken *before* that write.
    'move', 'click', 'drag', 'scroll', 'type', 'key', 'paste', 'focus',
    'invoke', 'set_value', 'select_text', 'toggle', 'select', 'expand', 'collapse', 'scroll_into_view',
    'close', 'minimize', 'maximize', 'restore', 'legacy_action', 'click_text'
)

# Steps that send synthesized input to *whatever happens to be in front*, as opposed to
# addressing a window or an element explicitly. Only these are affected by the
# window-change guard: a step that names its window (into_hwnd, a frame, a UIA handle)
# already checks its own target, and re-baselining on it is the caller's intent.
$FOREGROUND_STEP_ACTIONS = @('click', 'move', 'drag', 'scroll', 'type', 'key', 'paste', 'click_text')

function Test-ExpectedTransition($declared, [object]$live) {
    # Whether the window that just came forward is one the caller said it expects (B06).
    # Matching is by handle, by title substring, by process name or by pid, and the answer
    # names the rule that matched so the receipt can say *why* the batch was allowed to
    # continue into a window it did not start in. `any` / `*` accepts whatever appears.
    if ($null -eq $declared) { return $null }
    foreach ($entry in @($declared)) {
        if ($null -eq $entry) { continue }
        if ("$entry" -eq 'any' -or "$entry" -eq '*') { return [ordered]@{ matchedBy = 'any' } }
        $toRaw = Get-ConditionField $entry 'to'
        if ($null -ne $toRaw -and "$toRaw" -ne '' -and [int64]$toRaw -ne 0 -and [int64]$live.hwnd -eq [int64]$toRaw) {
            return [ordered]@{ matchedBy = "hwnd $toRaw" }
        }
        $title = "$(Get-ConditionField $entry 'title' '')"
        if ($title -ne '' -and "$($live.title)".IndexOf($title, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
            return [ordered]@{ matchedBy = "title~'$title'" }
        }
        $proc = "$(Get-ConditionField $entry 'process' '')"
        if ($proc -ne '' -and "$($live.process)".IndexOf($proc, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
            return [ordered]@{ matchedBy = "process~'$proc'" }
        }
        $pidRaw = Get-ConditionField $entry 'pid'
        if ($null -ne $pidRaw -and "$pidRaw" -ne '' -and [int64]$pidRaw -ne 0) {
            $livePid = 0
            try { $livePid = [int](Get-WindowInfoForHwnd ([IntPtr][int64]$live.hwnd)).pid } catch { $livePid = 0 }
            if ($livePid -ne 0 -and [int64]$livePid -eq [int64]$pidRaw) { return [ordered]@{ matchedBy = "pid $pidRaw" } }
        }
    }
    return $null
}

function New-CaptureArgs([hashtable]$Base, [object]$Step = $null, [hashtable]$Extra = $null) {
    # One place where a capture request is assembled (§5.4).
    #
    # A batch builds these hashtables in two places -- a step's capture and the trailing one --
    # and the two had already drifted: a step's capture never carried `regionSpace` or `clip`
    # (so `region_space: 'window'` and `clip: true` silently meant nothing inside a batch), and
    # the trailing capture dropped those *and* `surface` (so a batch asked for the client area
    # delivered the whole window as its result while its own steps delivered the client area).
    # The same request has to mean one thing wherever it is taken.
    #
    # Resolution order, stated once: the step's own argument, then the batch-level one, then
    # the default that was resolved before the batch started.
    $capture = @{}
    if ($null -ne $Base) { foreach ($key in $Base.Keys) { $capture[$key] = $Base[$key] } }
    if ($null -ne $Step) {
        $stepPath = "$($Step.path)"
        if ($stepPath -ne '') { $capture['path'] = $stepPath }
        if ($null -ne $Step.scale) { $capture['scale'] = [double]$Step.scale }
        if ($null -ne $Step.surface -and "$($Step.surface)" -ne '') { $capture['surface'] = "$($Step.surface)" }
        # Both spellings: the host writes regionSpace, a step written by hand may say
        # region_space, and a capture that quietly ignored one of them would be the same bug
        # in a new place.
        if ($null -ne $Step.regionSpace -and "$($Step.regionSpace)" -ne '') { $capture['regionSpace'] = "$($Step.regionSpace)" }
        elseif ($null -ne $Step.region_space -and "$($Step.region_space)" -ne '') { $capture['regionSpace'] = "$($Step.region_space)" }
        if ($null -ne $Step.clip) { $capture['clip'] = ($Step.clip -eq $true) }
        if ($null -ne $Step.region) { $capture['region'] = $Step.region }
        if ($null -ne $Step.window -and "$($Step.window)" -ne '' -and "$($Step.window)" -ne '0') {
            $capture['window'] = [int64]$Step.window
            $capture['requireWindow'] = $true
        }
        if ($null -ne $Step.display -and "$($Step.display)" -ne '') { $capture['display'] = $Step.display }
        if ($null -ne $Step.format -and "$($Step.format)" -ne '') { $capture['format'] = "$($Step.format)".ToLowerInvariant() }
        if ($null -ne $Step.quality) { $capture['quality'] = [int]$Step.quality }
        if ($null -ne $Step.settle_ms) { $capture['settleMs'] = [Math]::Max(0, [Math]::Min(5000, [int]$Step.settle_ms)) }
        if ($null -ne $Step.stability_ms) { $capture['stabilityMs'] = [Math]::Max(0, [Math]::Min($script:StabilityMaxMs, [int]$Step.stability_ms)) }
        if ($null -ne $Step.stable) { $capture['stable'] = $Step.stable }
    }
    if ($null -ne $Extra) { foreach ($key in $Extra.Keys) { $capture[$key] = $Extra[$key] } }
    return $capture
}

function Test-SameCaptureSpec([hashtable]$A, [hashtable]$B) {
    # Whether two capture requests are the same *picture* request (§7.3): the reuse rule is
    # "this frame may stand in for the one this call was asked for", and a different rectangle,
    # scale, surface, space or clip is a different picture even when the moment is the same.
    if ($null -eq $A -or $null -eq $B) { return $false }
    foreach ($key in @('display', 'regionSpace', 'surface', 'clip', 'scale', 'format', 'quality', 'window', 'requireWindow')) {
        $left = if ($A.ContainsKey($key)) { "$($A[$key])" } else { '' }
        $right = if ($B.ContainsKey($key)) { "$($B[$key])" } else { '' }
        if ($left -ne $right) { return $false }
    }
    $leftRegion = if ($A.ContainsKey('region')) { $A['region'] } else { $null }
    $rightRegion = if ($B.ContainsKey('region')) { $B['region'] } else { $null }
    if (($null -eq $leftRegion) -ne ($null -eq $rightRegion)) { return $false }
    if ($null -ne $leftRegion) {
        foreach ($axis in @('x', 'y', 'width', 'height')) {
            if ("$(Get-ArgMember $leftRegion $axis)" -ne "$(Get-ArgMember $rightRegion $axis)") { return $false }
        }
    }
    return $true
}

function New-BatchProgress($steps, [int]$failedAt, [string]$failedState) {
    # What happened to every step, in the states a step can be in (§5.2).
    #
    # The loop stops at the first failure, so the shape follows from where it stopped: every
    # step before it completed (the loop only ever advances past a step that returned), the
    # one it stopped at is named by `failedState`, and the ones after it never started. That
    # last distinction is the point -- "not-sent" means the caller's step was refused, while
    # "not-run" means it was never reached, and a caller deciding whether to send anything
    # again has to be able to tell them apart.
    $list = New-Object 'System.Collections.Generic.List[object]'
    for ($i = 0; $i -lt $steps.Count; $i++) {
        $action = "$($steps[$i].action)".ToLowerInvariant()
        $state = 'completed'
        if ($failedAt -ge 0) {
            if ($i -gt $failedAt) { $state = 'not-run' }
            elseif ($i -eq $failedAt) { $state = $failedState }
        }
        $list.Add([ordered]@{ step = [int]$i; action = $action; state = $state })
    }
    # Returned as a plain array and always taken back through `@(...)`: PowerShell unrolls a
    # collection on the way out of a function, so a one-step batch would otherwise arrive as
    # the step itself and the caller's `.ToArray()` would fail on it (found by
    # batch-progress-test).
    return $list.ToArray()
}

function Do-Batch([object]$Arg) {
    # One round trip for a whole gesture. The transport floor here is 1-3 ms, so
    # batching is not about the pipe: it is about the model only having to make one
    # decision-and-observe cycle instead of one per action. Any agent that drives a
    # desktop spends its budget the same way — the round trips dominate, not the bytes.
    $steps = @($Arg.steps)
    if ($steps.Count -eq 0) { throw "batch requires at least one step" }
    # One deadline for the whole call (C04). Every wait inside the batch -- a step's own
    # `wait`, a `wait_for` condition step, the batch-level condition, the pacing of the
    # trailing capture -- is bounded by what is left of it, so a batch cannot exceed the
    # budget it was given by adding up per-step timeouts. Without this, five steps of
    # "30 s each" claim two and a half minutes while the caller sits under one transport
    # budget, and the batch is cut off from outside with nothing in the reply to show it.
    $deadlineMs = [int64]0
    if ($null -ne $Arg.deadlineMs -and "$($Arg.deadlineMs)" -ne '') { $deadlineMs = [int64]$Arg.deadlineMs }
    $deadlineAtMs = [int64]0
    if ($deadlineMs -gt 0) { $deadlineAtMs = [int64]$script:Clock.ElapsedMilliseconds + $deadlineMs }
    # Published for the input functions this batch calls (§5.7): a step that starts before the
    # deadline can still run past it, and the refusal has to land before the *send*, not after
    # the batch has already typed into a call whose time was spent.
    Set-DeadlineAt $deadlineAtMs
    # The windows this batch is allowed to end up in, when the caller says so (B06): a
    # dialog it is going to open, an "export complete" box it is waiting for.
    $expectedTransitions = $Arg.expectedTransitions
    $transitions = New-Object System.Collections.Generic.List[object]
    $outcome = 'ok'
    $nextStep = -1
    # Which steps actually put something into the desktop, in order. This is the fact behind
    # `action_sent`: it is not the same question as "did the batch succeed", and it is the
    # one a caller needs before deciding whether to retry (B07).
    $wroteSteps = New-Object System.Collections.Generic.List[int]
    # The settle floor and the stability budget are resolved once for the whole call and
    # handed to every capture in it, including a batch-level default the steps can override:
    # before this, a capture inside a batch could only ever use the worker default, so the
    # "0 disables the poll" knob the single-step tool had did not reach it.
    $settleMs = $script:PostActionMs
    if ($null -ne $Arg.settleMs) { $settleMs = [Math]::Max(0, [Math]::Min(5000, [int]$Arg.settleMs)) }
    $stabilityMs = $null
    if ($null -ne $Arg.stabilityMs) { $stabilityMs = [Math]::Max(0, [Math]::Min($script:StabilityMaxMs, [int]$Arg.stabilityMs)) }
    $stableFlag = $null
    if ($null -ne $Arg.stable) { $stableFlag = $Arg.stable }
    $defaultPath = [string]$Arg.path
    $display = $Arg.display
    $region = $Arg.region
    # What the batch's captures are *of*, when the caller says so. Without these a
    # trailing capture could only ever be the whole screen: "do these steps, then show me
    # the panel" cost a second round trip, because the frame could not be aimed at the
    # panel the batch had just produced.
    $captureWindow = [int64]0
    if ($null -ne $Arg.window) { $captureWindow = [int64]$Arg.window }
    # The bridge spells it requireWindow; the host's schema uses require_window. Both
    # reach here, and a capture that silently gave up the window's own pixels because the
    # spelling differed would be a guarantee quietly downgraded.
    $requireWindow = ($Arg.requireWindow -eq $true) -or ($Arg.require_window -eq $true)
    if ($null -ne $Arg.display) { $display = $Arg.display }
    if ($null -ne $Arg.region) { $region = $Arg.region }
    $format = 'png'
    if ($null -ne $Arg.format -and "$($Arg.format)" -ne '') { $format = "$($Arg.format)".ToLowerInvariant() }
    $quality = 85
    if ($null -ne $Arg.quality) { $quality = [int]$Arg.quality }
    $scale = 1.0
    if ($null -ne $Arg.scale) { $scale = [double]$Arg.scale }
    # The batch-level capture request, resolved once (§5.4). Every capture this call takes --
    # a step's, the trailing one -- starts from this and changes only what that capture is
    # about. `regionSpace` and `clip` belong here: the host has always sent them at the
    # batch level, and until they were read here a batch that asked for a window-local
    # rectangle (or for the part of it that exists) silently captured something else.
    $captureBase = @{
        path = $defaultPath
        display = $display
        region = $region
        regionSpace = "$($Arg.regionSpace)"
        surface = "$($Arg.surface)"
        clip = ($Arg.clip -eq $true)
        format = $format
        quality = $quality
        scale = $scale
        settleMs = $settleMs
        stabilityMs = $stabilityMs
        stable = $stableFlag
    }
    if ($captureWindow -ne 0) {
        $captureBase['window'] = $captureWindow
        $captureBase['requireWindow'] = $requireWindow
    }

    $performed = New-Object System.Collections.Generic.List[string]
    $shot = $null
    # One report per `wait_for` step, in step order: what was waited for, whether it
    # became true, how long that took, and what the final observation saw.
    $waitReports = New-Object 'System.Collections.Generic.List[object]'
    $usefulCapture = $null
    $index = 0
    # Where the time goes, in the only place that can measure it: the steps, the trailing
    # capture and the encode all happen in here, and the caller otherwise sees one number
    # for the whole call with no way to tell which part is slow.
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

    # The window the batch believes it is driving, and the guard around it.
    #
    # A batch is the one call where the model is *not* looking: it handed over a sequence
    # and is waiting for the result. If a dialog appears or the app navigates in the middle
    # of that sequence, every remaining step would be typed or clicked into a window the
    # caller never chose -- the most expensive failure in this whole loop, because it looks
    # like success. So the foreground is compared against the window this batch started in
    # before each step that would send input to whatever is in front, and a change stops the
    # batch there: the steps that ran are reported, the ones that did not are named, and the
    # caller is told to observe before continuing. `focus` steps (and steps that name a
    # window) move the baseline, because naming the window *is* the caller's decision, and
    # `stopOnWindowChange: false` turns the whole guard off for a sequence that deliberately
    # walks through a window it expects to appear.
    $guardWindows = $Arg.stopOnWindowChange -ne $false
    $baselineHwnd = [int64]0
    if ($guardWindows) {
        $baselineProbe = Get-ForegroundInfo
        $baselineHwnd = [int64]$baselineProbe.hwnd
    }

    # Visual evidence: the one thing a synthesized event cannot report is whether
    # anything actually happened. Fingerprint the same rectangle before and after,
    # so "the click was delivered" and "the screen changed" stay separate facts.
    $evidence = $null
    $digestRect = $null
    $digestBefore = ''
    if ($Arg.evidence -ne $false) {
        foreach ($step in $steps) {
            if ($WRITE_STEP_ACTIONS -contains "$($step.action)".ToLowerInvariant()) {
                $digestRect = Get-ForegroundRect
                $digestBefore = Get-RegionDigest $digestRect.x $digestRect.y $digestRect.width $digestRect.height 320
                break
            }
        }
    }
    # The last step that writes, and whether any capture can stand in for the "after"
    # reading. A capture doubles as evidence only when it covers the same rectangle *and*
    # happens after the last write: a frame from the wrong region, or from before the
    # action, would make the comparison say something false. When no capture qualifies,
    # the reading is taken separately exactly as before.
    $lastWriteIndex = -1
    for ($writeScan = 0; $writeScan -lt $steps.Count; $writeScan++) {
        if ($WRITE_STEP_ACTIONS -contains "$($steps[$writeScan].action)".ToLowerInvariant()) { $lastWriteIndex = $writeScan }
    }
    # ...and *when* it happened. The index alone answers "did any capture step come
    # after it", which is the wrong question for the trailing capture: that one is
    # reported as soon as a mid-batch step took a picture, so a batch that shot the
    # screen at step 2 and clicked at step 5 handed back the step-2 frame as "the
    # result of this call". What settles it is the write ordinal the frame was taken
    # against (see Test-CaptureAfterWrite), not the step index.
    # Which step produced the frame this reply returns, kept *with* the frame (§5.6). -1 means
    # "no screenshot step produced this frame" (it came from the trailing capture, or from none
    # at all).
    $frameStepIndex = -1
    $evidenceRect = $null
    $evidenceDigest = ''
    if ($null -ne $digestRect) {
        $evidenceRect = [ordered]@{
            x       = [int]$digestRect.x
            y       = [int]$digestRect.y
            width   = [int]$digestRect.width
            height  = [int]$digestRect.height
            maxSide = 320
        }
    }

    function Get-BatchRemainingMs {
        # What is left of this call's deadline, or "unbounded" when it was given none. The
        # steps use it so the batch's waits share one budget instead of each claiming its
        # own (C04).
        if ($deadlineAtMs -le 0) { return [int]::MaxValue }
        $left = [int64]$deadlineAtMs - [int64]$script:Clock.ElapsedMilliseconds
        if ($left -lt 0) { $left = 0 }
        return [int]$left
    }

    function Complete-Evidence {
        if ($null -eq $digestRect) { return $null }
        $after = ''
        $reused = $false
        if ("$evidenceDigest" -ne '') {
            # Already fingerprints of exactly this rectangle, taken while the frame was in
            # the capture path's hands. Nothing is re-grabbed for them.
            $after = "$evidenceDigest"
            $reused = $true
        } else {
            $after = Get-RegionDigest $digestRect.x $digestRect.y $digestRect.width $digestRect.height 320
        }
        return [ordered]@{
            changed = ($after -ne $digestBefore)
            before  = $digestBefore
            after   = $after
            reused  = $reused
            x       = $digestRect.x
            y       = $digestRect.y
            width   = $digestRect.width
            height  = $digestRect.height
        }
    }

    function Settle-Before-Capture {
        # Intentionally empty, and the reason has changed with the pacing: the capture itself
        # waits. Do-Screenshot applies the settle floor to the write stamp and runs the
        # stability poll with the budget this batch resolved, so a second wait here would be
        # a second sleep in front of the same capture -- with a *different* budget than the
        # one the caller asked for, which is how a batch's captures used to end up on the
        # worker default no matter what the call said.
    }

    # Every step is validated before the first one runs. A batch is one call, so a
    # step 6 that could never work -- a typo'd action, a drag missing its end point --
    # used to be discovered after steps 1-5 had already moved the desktop, and the
    # caller had no way to tell how far it got without reading the log. Refusing the
    # whole call up front costs nothing and is the only version a caller can recover
    # from by fixing its arguments.
    $stepIndex = 0
    foreach ($candidate in $steps) {
        $candidateAction = "$($candidate.action)".ToLowerInvariant()
        if ([string]::IsNullOrWhiteSpace($candidateAction)) { throw "[BAD_REQUEST] step $stepIndex has no action" }
        if (-not ($STEP_ACTIONS -contains $candidateAction)) {
            throw "[BAD_REQUEST] unknown step action '$candidateAction' at step $stepIndex; known actions: $($STEP_ACTIONS -join ', ')"
        }
        switch ($candidateAction) {
            'move'      {
                # Three ways to move, and a step names exactly one: a destination point, a
                # delta (§9), or an image point through a frame.
                $hasDelta = ($null -ne $candidate.dx) -or ($null -ne $candidate.dy)
                $hasPoint = ($null -ne $candidate.x) -and ($null -ne $candidate.y)
                $hasFrame = -not [string]::IsNullOrEmpty("$($candidate.from_frame)")
                if ($hasDelta -and ($hasPoint -or $hasFrame)) {
                    throw "[BAD_REQUEST] step $stepIndex is a relative move (dx/dy) that also names a point: pass either a delta or a destination"
                }
                if (-not $hasDelta -and -not $hasPoint -and -not $hasFrame) {
                    throw "[BAD_REQUEST] step $stepIndex is a move without x and y (or dx/dy for a relative move)"
                }
            }
            'click'     { if ($null -eq $candidate.x -and [string]::IsNullOrEmpty("$($candidate.from_frame)")) { throw "[BAD_REQUEST] step $stepIndex is a click with neither x/y nor from_frame" } }
            'drag'      {
                # §8 后半：续画的起点来自上次落点，这时 from_x/from_y 不是必需的（只要终点）。
                $continues = ($null -ne $candidate.fromLast -and "$($candidate.fromLast)" -eq 'true') -or -not [string]::IsNullOrEmpty("$($candidate.continueFrom)")
                if ($null -eq $candidate.to_x -or $null -eq $candidate.to_y) { throw "[BAD_REQUEST] step $stepIndex is a drag without to_x and to_y" }
                if (-not $continues -and ($null -eq $candidate.from_x -or $null -eq $candidate.from_y)) { throw "[BAD_REQUEST] step $stepIndex is a drag without from_x, from_y, to_x and to_y (or from_last/continue_from for a continued stroke)" }
            }
            'scroll'    { if ([string]::IsNullOrWhiteSpace("$($candidate.direction)")) { throw "[BAD_REQUEST] step $stepIndex is a scroll without a direction" } }
            'type'      { if ($null -eq $candidate.text) { throw "[BAD_REQUEST] step $stepIndex is a type without text" } }
            'paste'     { if ([string]::IsNullOrEmpty("$($candidate.text)")) { throw "[BAD_REQUEST] step $stepIndex is a paste without text" } }
            'key'       { if ([string]::IsNullOrWhiteSpace("$($candidate.keys)")) { throw "[BAD_REQUEST] step $stepIndex is a key press without keys" } }
            'focus'     { if ($null -eq $candidate.hwnd) { throw "[BAD_REQUEST] step $stepIndex is a focus without hwnd" } }
            'wait'      { if ($null -eq $candidate.seconds) { throw "[BAD_REQUEST] step $stepIndex is a wait without seconds" } }
            'wait_for'  {
                # A condition step carries its predicate either inline or under
                # `condition`; both spellings reach Wait-ForCondition, and the refusal
                # is stated once so a caller learns a single rule.
                $cond = $candidate.condition
                if ($null -eq $cond) { $cond = $candidate }
                $hasPredicate = ($null -ne $cond.kind -and "$($cond.kind)" -ne '') -or
                                ($null -ne $cond.every -and "$($cond.every)" -ne '') -or
                                ($null -ne $cond.any -and "$($cond.any)" -ne '') -or
                                ($null -ne $cond.hwnd -and [int64]$cond.hwnd -ne 0) -or
                                ($null -ne $cond.title -and "$($cond.title)" -ne '') -or
                                ($null -ne $cond.control -and "$($cond.control)" -ne '') -or
                                ($null -ne $cond.path -and "$($cond.path)" -ne '') -or
                                ("$($cond.type)" -eq 'value' -and -not [string]::IsNullOrEmpty("$($cond.expected)"))
                if (-not $hasPredicate) {
                    throw "[BAD_REQUEST] step $stepIndex is a wait_for with no condition: give it a kind (window/control/value/text/every), or a hwnd/title/control/control_type selector, plus timeout_ms"
                }
            }
            'clipboard' { if ("$($candidate.op)" -eq 'set' -and $null -eq $candidate.text) { throw "[BAD_REQUEST] step $stepIndex sets the clipboard without text" } }
            'screenshot' {
                if ([string]::IsNullOrWhiteSpace("$($candidate.path)") -and [string]::IsNullOrWhiteSpace($defaultPath)) {
                    throw "[BAD_REQUEST] step $stepIndex is a screenshot and neither it nor the call carries a path"
                }
            }
            default {
                $hasSelector = ($null -ne $candidate.ref -and "$($candidate.ref)" -ne '') -or
                               ($null -ne $candidate.automation_id -and "$($candidate.automation_id)" -ne '') -or
                               ($null -ne $candidate.name -and "$($candidate.name)" -ne '') -or
                               ($null -ne $candidate.control_type -and "$($candidate.control_type)" -ne '') -or
                               ($null -ne $candidate.class_name -and "$($candidate.class_name)" -ne '')
                if (-not $hasSelector) {
                    throw "[BAD_REQUEST] step $stepIndex ($candidateAction) needs at least one selector: ref, automation_id, name, control_type, or class_name"
                }
                if ($candidateAction -eq 'set_value' -and $null -eq $candidate.value) { throw "[BAD_REQUEST] step $stepIndex is a set_value without a value" }
                if (@('select_text', 'click_text', 'locate_text') -contains $candidateAction -and [string]::IsNullOrEmpty("$($candidate.text)")) {
                    throw "[BAD_REQUEST] step $stepIndex ($candidateAction) needs the text to locate"
                }
            }
        }
        $stepIndex += 1
    }

    foreach ($step in $steps) {
        $action = "$($step.action)".ToLowerInvariant()
        if ([string]::IsNullOrWhiteSpace($action)) { throw "step $index has no action" }
        try {
            # The budget, before the step and not only inside the waits (§5.7). A step that
            # starts after the deadline is the failure this whole check exists for: the batch
            # reports how far it got, and the steps that did not run are named rather than
            # typed into a call whose time was already spent.
            $leftForStep = Get-BatchRemainingMs
            if ($leftForStep -le 0) {
                $outcome = 'deadline'
                $nextStep = [int]$index
                throw "[DEADLINE_EXHAUSTED] this call's deadline ran out before step $index ('$action'); the $($performed.Count) step(s) before it did run and nothing after it was started. Observe the result (computer_screenshot, computer_ui, or a `state` step in a new call) before deciding anything else, and give the next call a larger deadline_ms if this sequence needs longer."
            }
            # Cancellation is checked per step, not per call: the point of cancelling a
            # batch is that the *rest* of it does not happen. It is inside the try so
            # the caller still gets the steps that did run, plus the index it stopped at.
            Assert-NotCancelled "before step $index of $($steps.Count) ('$action')"
            if ($guardWindows -and ($FOREGROUND_STEP_ACTIONS -contains $action)) {
                $namesWindow = ($null -ne $step.into_hwnd) -or ($null -ne $step.from_frame -and "$($step.from_frame)" -ne '')
                if (-not $namesWindow) {
                    $live = Get-ForegroundInfo
                    if ([int64]$live.hwnd -eq 0) {
                        # Nothing holds the foreground: the step's own preflight will say so
                        # with a better message than "the window changed".
                    } elseif ($baselineHwnd -eq 0) {
                        $baselineHwnd = [int64]$live.hwnd
                    } elseif ([int64]$live.hwnd -ne $baselineHwnd) {
                        # A transition the caller declared is followed rather than stopped
                        # (B06) -- and what appears is identified and reported, because "the
                        # window changed" is not by itself a reason to keep typing into
                        # whatever is now in front. An undeclared one still stops the batch
                        # where it is.
                        $declared = Test-ExpectedTransition $expectedTransitions $live
                        if ($null -ne $declared) {
                            $transitions.Add([ordered]@{
                                atStep    = [int]$index
                                from      = [int64]$baselineHwnd
                                to        = [int64]$live.hwnd
                                title     = "$($live.title)"
                                process   = "$($live.process)"
                                matchedBy = "$($declared.matchedBy)"
                                note      = 'declared in expectedTransitions, so the batch continued into this window'
                            })
                            $baselineHwnd = [int64]$live.hwnd
                        } else {
                            $nowTitle = "$($live.title)"
                            if ($nowTitle -eq '') { $nowTitle = '(untitled)' }
                            $outcome = 'reobserve-required'
                            $nextStep = [int]$index
                            throw "the window in front changed during this batch: it was hwnd $baselineHwnd when the batch started and is hwnd $($live.hwnd) [$($live.process)] `"$nowTitle`" before step $index ('$action'). A dialog, a menu or a navigation appeared, so the remaining $($steps.Count - $index) step(s) would go to this window instead of the one you meant. Nothing after step $($index - 1) was run: observe again (computer_windows for the window list, computer_ui for the new window's controls), then continue from step $index -- pass expected_transitions to declare a window change this sequence is supposed to make, or stop_on_window_change: false to accept that the rest follows whatever is in front. (action_sent=false for this step; the steps listed as performed did happen)"
                        }
                    }
                }
            }
            switch ($action) {
                'click' {
                    $r = Do-Click @{ x = $step.x; y = $step.y; fromFrame = $step.from_frame; button = $step.button; clicks = $step.clicks; modifiers = $step.modifiers; preferA11y = $step.prefer_a11y; allowActivate = $step.allow_activate; verifyContent = $step.verify_content; allowWindows = $step.allow_windows }
                    $via = ''
                    if ("$($r.via)" -eq 'a11y') { $via = ' [a11y]' }
                    $performed.Add("click ($($r.x),$($r.y)) x$($r.clicks) $($r.button)$via")
                }
                'move' {
                    # A relative move (dx/dy) is its own branch, not a coordinate write: it
                    # names no point, so there is nothing to project, nothing to guard and no
                    # frame to check -- and it is the only form that works where the pointer
                    # is locked or recentred (8.txt §9).
                    if ($null -ne $step.dx -or $null -ne $step.dy) {
                        $dx = 0
                        if ($null -ne $step.dx) { $dx = [int]$step.dx }
                        $dy = 0
                        if ($null -ne $step.dy) { $dy = [int]$step.dy }
                        $rel = Do-MouseMoveRelative $dx $dy
                        Set-WriteStamp -What 'move'
                        $performed.Add("move relative dx=$dx dy=$dy (observed $($rel.observedDelta.dx),$($rel.observedDelta.dy))")
                    } else {
                    # A move may be aimed with a frame's image pixels too, and then it is a
                    # coordinate write like any other: projected, checked against the window's
                    # identity and geometry, and put through the landing guard (A05) *before* the
                    # pointer moves. Without this the step took the image point as a desktop point
                    # -- silently, and with no guard at all, which is the one coordinate write the
                    # guard never saw. A hover lands on whatever is under the point just as a click
                    # does: hover menus, tooltips and drag targets all read it.
                    if (-not [string]::IsNullOrEmpty("$($step.from_frame)")) {
                        $resolved = Resolve-FramePoint ([string]$step.from_frame) ([int]$step.x) ([int]$step.y) ([ordered]@{ allowActivate = ($step.allow_activate -eq $true); verifyContent = $step.verify_content; allowWindows = $step.allow_windows })
                        if ($resolved.ok -ne $true) { throw "$($resolved.error)" }
                        $r = [ordered]@{
                            x     = [int]$resolved.x
                            y     = [int]$resolved.y
                            frame = (Get-FrameReceipt $resolved.frame ([int]$step.x) ([int]$step.y) ([int]$resolved.x) ([int]$resolved.y) ([int]$resolved.drift) "$($resolved.note)" $resolved.guard "$($resolved.mapping)" ([bool]$resolved.activated))
                        }
                    } else {
                        $r = [ordered]@{ x = [int]$step.x; y = [int]$step.y }
                    }
                    Do-MouseMove ([int]$r.x) ([int]$r.y)
                    $performed.Add("move ($($r.x),$($r.y))")
                    # Moving the pointer is a write: it changes what is under the cursor
                    # (hover, tooltip, focus), and this file already treats it as one
                    # everywhere else -- WRITE_STEP_ACTIONS includes it, and the evidence
                    # fingerprint is taken before it. Without a stamp here the other write
                    # bookkeeping disagreed with the evidence path about the same step.
                    Set-WriteStamp -What 'move'
                    }
                }
                'drag' {
                    $r = Do-Drag @{ fromX = $step.from_x; fromY = $step.from_y; toX = $step.to_x; toY = $step.to_y; path = $step.path; durationMs = $step.duration_ms; fromFrame = $step.from_frame; modifiers = $step.modifiers; allowActivate = $step.allow_activate; verifyContent = $step.verify_content; allowWindows = $step.allow_windows }
                    if ($null -ne $r['path']) {
                        $performed.Add("drag a $($r.path.points)-point path ($($r.path.samples) moves, $($r.path.durationMs) ms) ($($r.from.x),$($r.from.y))->($($r.to.x),$($r.to.y))")
                    } else {
                        $performed.Add("drag ($($r.from.x),$($r.from.y))->($($r.to.x),$($r.to.y))")
                    }
                }
                'scroll' {
                    $r = Do-Scroll @{ direction = $step.direction; clicks = $step.clicks; x = $step.x; y = $step.y; fromFrame = $step.from_frame; allowActivate = $step.allow_activate; verifyContent = $step.verify_content; allowWindows = $step.allow_windows }
                    $performed.Add("scroll $($r.direction) x$($r.clicks)")
                }
                'type' {
                    $r = Do-Type @{ text = $step.text; delayMs = $step.delay_ms; intoHwnd = $step.into_hwnd }
                    $performed.Add("type $($r.typed) char(s)")
                }
                'paste' {
                    $r = Do-Paste @{ text = $step.text; restore = $step.restore; requireRestore = $step.require_restore; intoHwnd = $step.into_hwnd; verify = $step.verify }
                    # The restore outcome is six-valued now (§6), so the step line says which one
                    # happened instead of collapsing five of them into "could not be restored".
                    $restoreWord = switch ("$($r.restoreStatus)") {
                        'restored'                    { 'the previous clipboard content is back' }
                        'not_requested'               { 'the pasted text was left on the clipboard' }
                        'skipped_external_change'     { 'the clipboard was NOT restored: something else wrote to it after this paste' }
                        'unsupported_original_format' { 'the previous clipboard content could not be fully restored' }
                        'failed_busy'                 { 'the previous clipboard content could NOT be restored (it was held open)' }
                        'failed_other'                { 'the previous clipboard content could NOT be restored' }
                        default                       { "$($r.restoreStatus)" }
                    }
                    $verifiedWord = ''
                    if ($null -ne $r.pasteVerification) {
                        if ("$($r.pasteVerification.status)" -eq 'verified') { $verifiedWord = '; verified in the control' }
                        elseif ("$($r.pasteVerification.status)" -eq 'absent') { $verifiedWord = '; NOT verified: the text is not in the control it was read back from' }
                        else { $verifiedWord = '; the paste could not be verified' }
                    }
                    $performed.Add("paste $($r.pasted) char(s) ($restoreWord$verifiedWord)")
                }
                'key' {
                    $holdMs = 0
                    if ($null -ne $step.hold_seconds) { $holdMs = [int]([Math]::Min(10, [Math]::Max(0, [double]$step.hold_seconds)) * 1000) }
                    $r = Do-Key @{ keys = $step.keys; repeat = $step.repeat; holdMs = $holdMs; intoHwnd = $step.into_hwnd }
                    $performed.Add("key $($r.keys) x$($r.repeat)")
                }
                'focus' {
                    if ($null -eq $step.hwnd) { throw "a focus step needs hwnd" }
                    $r = Do-Focus @{ hwnd = $step.hwnd }
                    $performed.Add("focus hwnd=$($r.hwnd) '$($r.title)'")
                }
                'clipboard' {
                    $op = 'get'
                    if ($null -ne $step.op) { $op = "$($step.op)" }
                    $r = Do-Clipboard @{ op = $op; text = $step.text }
                    if ($op -eq 'get') {
                        $shown = $r.text
                        if ($shown.Length -gt 2000) { $shown = $shown.Substring(0, 2000) }
                        $performed.Add("clipboard get -> $($shown.Length) char(s): $shown")
                    } else {
                        $performed.Add("clipboard $op $($r.length) char(s)")
                    }
                }
                'wait' {
                    $seconds = [double]$step.seconds
                    if ($seconds -lt 0) { $seconds = 0 }
                    if ($seconds -gt 30) { $seconds = 30 }
                    $wanted = [int]($seconds * 1000)
                    # The step's duration is a request, not a licence to overrun the call's
                    # deadline: what is left of the batch budget is the ceiling (C04).
                    $left = Get-BatchRemainingMs
                    $spent = $wanted
                    if ($left -ne [int]::MaxValue -and $left -lt $wanted) { $spent = [int]$left }
                    if ($spent -gt 0) {
                        Wait-Cancellable $spent
                        # A wait is an observation boundary wherever it happens -- but only when
                        # time actually passed. A `wait: 0` step is not a boundary: it produces
                        # no new state, so the frame taken a moment ago is still the freshest
                        # thing this call has, and invalidating it would make the call pay for
                        # a second capture of a screen nobody looked away from.
                        [void](Advance-ObservationEpoch)
                    }
                    if ($spent -lt $wanted) {
                        $performed.Add("wait $([Math]::Round($spent / 1000.0, 2))s of the $([Math]::Round($seconds, 2))s asked for (this call's deadline is closer)")
                        $outcome = 'deadline-partial'
                        if ($nextStep -lt 0) { $nextStep = [int]$index }
                    } else {
                        $performed.Add("wait $([Math]::Round($seconds, 2))s")
                    }
                }
                'wait_for' {
                    # Waiting for a *condition* rather than for a duration. The worker
                    # polls, so the model does not have to: one call replaces the
                    # click / read / "not yet" / sleep / read again loop, and it returns
                    # as soon as the condition holds instead of at the end of a sleep
                    # chosen before anyone knew how fast the app would be.
                    $waitSpec = $step
                    if ($null -eq $waitSpec.condition) { $waitSpec = @{ condition = $step; timeout_ms = $step.timeout_ms } }
                    # The call's own deadline bounds this wait too (C04). A step that carries its
                    # own `condition` arrives as a JSON object, and a JSON object cannot have a
                    # property added to it: assigning `deadlineAtMs` on one threw "no such
                    # property" and the step failed instead of waiting (found by deadline-test,
                    # fixed here). The spec is rebuilt as something that can hold the deadline.
                    if ($deadlineAtMs -gt 0) {
                        if ($waitSpec -is [hashtable]) {
                            $waitSpec['deadlineAtMs'] = $deadlineAtMs
                        } else {
                            $waitSpec = @{
                                condition = (Get-ConditionField $waitSpec 'condition')
                                timeout_ms = (Get-ConditionField $waitSpec 'timeout_ms')
                                poll_ms = (Get-ConditionField $waitSpec 'poll_ms')
                                deadlineAtMs = $deadlineAtMs
                            }
                        }
                    }
                    $r = Wait-ForCondition $waitSpec
                    $line = "wait_for $($r.what) -> $(if ($r.satisfied) { 'satisfied' } else { 'not satisfied' }) after $($r.waitedMs) ms in $($r.polls) check(s)"
                    if (-not $r.satisfied) { $line = "$line; the condition was never true inside the budget" }
                    $performed.Add($line)
                    # The condition report is attached to the step log line, not sent as a
                    # failure: a wait that timed out leaves the caller with a real
                    # observation ("still nothing") that is worth acting on.
                    # `+=` grows a *fixed-size array*, and an array cannot be extended
                    # with the + operator unless both sides are collections.
                    $waitReports.Add($r)
                    if (-not $r.satisfied) {
                        # A condition that did not become true stops the steps that depend on
                        # it (C02). Carrying on was the old behaviour, and it is the shape of
                        # failure nobody notices: the click after a failed "wait for the
                        # dialog" goes into whatever window is there, and the batch reports
                        # success. `on_timeout: 'continue'` is the explicit way to ask for the
                        # old behaviour.
                        $onTimeout = 'stop'
                        if ("$($step.on_timeout)" -ne '') { $onTimeout = "$($step.on_timeout)".ToLowerInvariant() }
                        if ($onTimeout -eq 'continue') {
                            $performed.Add("continuing past the wait_for step because on_timeout is 'continue'")
                        } else {
                            $observedStatus = "$($r.status)"
                            $outcome = 'condition-timeout'
                            if ($observedStatus -eq 'unknown') { $outcome = 'condition-unobservable' }
                            $nextStep = [int]$index
                            $how = "the condition was not satisfied: $($r.what) -- $($r.observed)"
                            if ($observedStatus -eq 'unknown') {
                                $how = "the condition could not be observed at all: $($r.what) -- $($r.observed)"
                            }
                            throw "[CONDITION_TIMEOUT] step $index ('wait_for') stopped this batch: $how ($($r.polls) check(s) over $($r.waitedMs) ms of a $($r.timeoutMs) ms budget). Nothing after step $index was run -- the steps before it did run, and the steps after it were the ones that would have needed this condition to hold. Decide whether to wait longer (raise timeout_ms), look at the window yourself (computer_ui or computer_screenshot), or continue deliberately by putting on_timeout: 'continue' on this step. (action_sent=false for this step; the steps listed as performed did happen)"
                        }
                    }
                }
                'screenshot' {
                    Settle-Before-Capture
                    # One normalisation for every capture this batch takes (§5.4): the step's
                    # own arguments win over the batch-level ones, and `regionSpace`/`clip`
                    # reach the capture now instead of being dropped between the host and the
                    # worker. The pacing arguments are the step's own where it asked for them,
                    # because the reason to wait is a property of *this* capture: the step
                    # that follows a step opening a slow dialog is the one that needs a
                    # budget, and the step that just wants the pixels should not pay for it.
                    $shotArgs = New-CaptureArgs $captureBase $step
                    if ([string]::IsNullOrWhiteSpace("$($shotArgs.path)")) { throw "a screenshot step needs a path" }
                    # A capture after the last write can stand in for the batch's "after"
                    # evidence reading instead of a second grab of the same rectangle.
                    if ($null -ne $evidenceRect -and $index -gt $lastWriteIndex) { $shotArgs.evidenceRect = $evidenceRect }
                    $shot = Do-Screenshot $shotArgs
                    if ($null -ne $shot.evidenceDigest -and "$($shot.evidenceDigest)" -ne '') { $evidenceDigest = "$($shot.evidenceDigest)" }
                    $stepCapture = Get-CaptureStampInfo
                    if ($null -ne $stepCapture) {
                        # Every screenshot step makes its frame the current candidate.
                        # Whether it may *be* the answer is decided at the end, against the
                        # write ordinal -- keeping only "fresh so far" frames here was a bug:
                        # a batch with no earlier write kept nothing, and then paid for a
                        # second capture of a screen it already had.
                        $usefulCapture = [ordered]@{
                            shot = $shot
                            capture = $stepCapture
                            # The *shape* of the request that produced this frame, kept whole
                            # so the trailing capture can be compared against it field by field
                            # (§7.3). A frame may stand in for the trailing capture only if it
                            # is the same picture: another scale, surface, region or clip is
                            # another picture, even when the rectangle and the moment are the
                            # same (A06).
                            spec = $shotArgs
                            # Which step produced it, carried *with* the frame (§5.6). The
                            # index used to be recorded once, for the first screenshot step,
                            # while the frame itself was replaced by every later one -- so a
                            # reply that returned the frame of step 5 said step 2.
                            stepIndex = [int]$index
                        }
                    }
                    $performed.Add("screenshot $($shot.width)x$($shot.height)@$($shot.scale)")
                }
                { $UIA_STEP_ACTIONS -contains $action } {
                    # One branch for every UI Automation step, taken from the same list
                    # the single-step tool and the host's schema use, so the three can
                    # no longer drift apart.
                    $r = Invoke-UiaStep $step
                    if ("$($r.canceled)" -eq 'True') { throw "$($r.error)" }
                    $performed.Add((Get-UiaStepLine $action $r))
                }
                default { throw "unknown step action '$action'; known actions: $($STEP_ACTIONS -join ', ')" }
            }
        } catch {
            $phrase = $_.Exception.Message
            $cancelled = $phrase.StartsWith('[CANCELED]', [System.StringComparison]::Ordinal)
            # Running out of budget is an outcome of its own, not a failed step: the step that
            # refused did so *because* the call was over, and the caller's next move is a new
            # call with a larger deadline (or an observation), not a fix to the arguments (§5.7).
            $outOfTime = $phrase.StartsWith('[DEADLINE_EXHAUSTED]', [System.StringComparison]::Ordinal)
            # A step whose input only partly landed is its own outcome (§6): some of it is in
            # the application, so it is neither "failed" (nothing happened) nor "completed".
            $partialSend = $phrase.StartsWith('[PARTIAL_INPUT]', [System.StringComparison]::Ordinal)
            $evidence = Complete-Evidence
            # A failed batch still returns the frame it has, but says which one it is: a
            # screenshot step that ran before the step that failed produced a real picture
            # of a real moment, and the caller has to be able to tell it from a frame of
            # the state after the failure (which nobody took).
            if ($wantedShot -and [string]::IsNullOrWhiteSpace($defaultPath) -and $Arg.screenshot -eq $true) { throw "a trailing screenshot needs a path" }
            if ($wantedShot -and $null -eq $shot -and $null -ne $usefulCapture) {
                $fresher = Test-CaptureReusable $usefulCapture.capture
                $shot = $usefulCapture.shot
                Set-PayloadField $shot 'stepIndex' ([int]$usefulCapture.stepIndex)
                Set-PayloadField $shot 'afterLastWrite' $fresher
                if (-not $fresher) {
                    Set-PayloadField $shot 'note' "this frame is from before the step that failed (step $($usefulCapture.stepIndex)), so it shows the state the batch started from"
                }
            } elseif ($wantedShot -and $null -ne $shot -and $null -eq $shot.afterLastWrite) {
                Set-PayloadField $shot 'afterLastWrite' $false
            }
            if ($cancelled) { $outcome = 'cancelled' }
            elseif ($outOfTime) { $outcome = 'deadline' }
            elseif ($partialSend) { $outcome = 'partial' }
            elseif ($outcome -eq 'ok') { $outcome = 'step-failed' }
            # The state of the step that stopped the batch, read off the evidence rather than
            # guessed: it ran out of budget before sending, it sent part of itself, it sent and
            # the outcome is unknown (the message says so), or it was refused before sending.
            $stepState = 'not-sent'
            if ($outOfTime) { $stepState = 'not-run' }
            elseif ($partialSend) { $stepState = 'partial' }
            elseif ($phrase -match 'action_sent=true') { $stepState = 'dispatched' }
            $progress = @(New-BatchProgress $steps $index $stepState)
            $failure = [ordered]@{
                performed = @($performed.ToArray())
                count     = $performed.Count
                failedAt  = $index
                error     = $phrase
                canceled  = $cancelled
                outOfBudget = $outOfTime
                partial     = $partialSend
                progress    = @($progress)
                partialSteps = @($progress | Where-Object { "$($_.state)" -eq 'partial' } | ForEach-Object { [int]$_.step })
                elapsedMs = [int]$stopwatch.ElapsedMilliseconds
                # ActionReceipt (B07): what was put into the desktop, what happened, and
                # where the sequence can be picked up again are three different facts, and
                # the reply used to leave two of them to be inferred.
                outcome     = "$outcome"
                action_sent = ($wroteSteps.Count -gt 0)
                wroteSteps  = @($wroteSteps.ToArray() | ForEach-Object { [int]$_ })
                shot      = $shot
                evidence  = $evidence
                state     = $null
                waits     = @($waitReports.ToArray())
            }
            if ($nextStep -ge 0) { $failure['nextStep'] = [int]$nextStep }
            # The deadline numbers belong to a failed call as much as to a successful one: this
            # is exactly the case ("it stopped on budget") they were added for (§5.7).
            if ($deadlineMs -gt 0) {
                $over = [int64]$script:Clock.ElapsedMilliseconds - [int64]$deadlineAtMs
                $failure['deadlineMs'] = [int]$deadlineMs
                $failure['overDeadlineMs'] = [int]([Math]::Max(0, $over))
                $failure['deadlineMet'] = ($over -le 0)
            }
            if ($transitions.Count -gt 0) { $failure['transitions'] = @($transitions | ForEach-Object { $_ }) }
            return $failure
        }
        # A step that named its window has moved the batch on purpose, so the guard's
        # baseline follows it. Without this, "focus the dialog, then type" -- the correct
        # way to handle a window the batch itself raised -- would trip the guard.
        if ($WRITE_STEP_ACTIONS -contains $action) { $wroteSteps.Add([int]$index) }
        if ($guardWindows) {
            if ($null -ne $step.into_hwnd) { $baselineHwnd = [int64]$step.into_hwnd }
            elseif ($action -eq 'focus' -and $null -ne $step.hwnd) { $baselineHwnd = [int64]$step.hwnd }
            elseif (($UIA_STEP_ACTIONS -contains $action) -and $null -ne $step.hwnd) { $baselineHwnd = [int64]$step.hwnd }
        }
        # The write itself already stamped its ordinal inside the action that performed it,
        # which is why there is nothing to record here.
        $index += 1
    }

    # A condition the caller wants true before the batch is judged. It runs after the
    # steps and before any trailing capture or read, so what comes back is the state the
    # caller was waiting for -- which is the whole point of asking for it here rather
    # than spending another round trip to look, decide "not yet", and look again.
    if ($null -ne $Arg.waitFor) {
        Assert-NotCancelled 'before the batch-level condition wait'
        # Copied into a fresh table rather than mutated in place: the argument may be a
        # PSCustomObject straight off the JSON line, and the deadline has to be carried into
        # it so this wait is bounded by the same budget as the steps before it (C04).
        $batchWait = $Arg.waitFor
        $waitSpec = @{}
        if ($batchWait -is [System.Collections.IDictionary]) {
            foreach ($key in $batchWait.Keys) { $waitSpec[$key] = $batchWait[$key] }
        } else {
            foreach ($property in $batchWait.PSObject.Properties) { $waitSpec[$property.Name] = $property.Value }
        }
        if ($deadlineAtMs -gt 0) { $waitSpec['deadlineAtMs'] = $deadlineAtMs }
        $batchReport = Wait-ForCondition $waitSpec
        $waitReports.Add($batchReport)
        if (-not $batchReport.satisfied -and $outcome -eq 'ok') {
            $outcome = 'condition-timeout'
            if ("$($batchReport.status)" -eq 'unknown') { $outcome = 'condition-unobservable' }
        }
    }

    $shotReuse = ''
    $wantedShot = ($Arg.screenshot -eq $true)
    # Set when one of the trailing *observations* fails (the capture, the accessibility read):
    # it is attached to the reply rather than replacing it, because the steps already ran (§5.2).
    $observation = $null
    # The trailing capture's request, built here by the same rules a step's capture uses
    # (§5.4) -- and built unconditionally, so the comparison below is against exactly the
    # request the trailing capture would send.
    $trailingArgs = New-CaptureArgs $captureBase
    if ($wantedShot -and $null -ne $usefulCapture) {
        # A step already took the picture this call was asked for. Whether that frame *is*
        # the answer is an ordering question, and it is asked of the write ordinals *and* the
        # observation epoch (a frame from before a wait may not stand in for the state after
        # it): a batch that shot the screen at step 2 and clicked at step 5 has a frame from
        # before its own last write, and reporting it as the result is the one failure the
        # caller cannot see. No write and no wait after it means it is the answer, and the
        # trailing capture that used to be taken anyway is skipped.
        # The trailing capture's request, by the same rules as a step's (§5.4): the comparison
        # below is against exactly the request the trailing capture would send.
        $sameRequest = Test-SameCaptureSpec $usefulCapture.spec $trailingArgs
        if ($sameRequest -and (Test-CaptureReusable $usefulCapture.capture)) {
            $shotReuse = 'step'
            $shot = $usefulCapture.shot
            Set-PayloadField $shot 'stepIndex' ([int]$usefulCapture.stepIndex)
            Set-PayloadField $shot 'afterLastWrite' $true
        } elseif ([string]::IsNullOrWhiteSpace($defaultPath)) {
            # Nothing to reuse and no path for a new frame: the step's frame is returned
            # rather than a capture that could not be written anyway.
            $shotReuse = 'step-stale'
            $shot = $usefulCapture.shot
            Set-PayloadField $shot 'afterLastWrite' $false
            Set-PayloadField $shot 'stepIndex' ([int]$usefulCapture.stepIndex)
            Set-PayloadField $shot 'note' 'the only capture this call took came before its last write, so this frame shows the state before the steps finished; pass screenshot: true with a save_path (or add a screenshot step) to get a frame of the state after them'
        } else {
            $shotReuse = 'retaken'
        }
    }
    # `step-stale` is a *decision*, not a reason to ask for a path: the frame it refers to is
    # the one already on disk, so a call without a save_path still has an answer to give.
    # Testing only `-ne 'step'` here made that state unreachable -- the branch above was
    # followed by the throw below, so the reply was always the refusal instead.
    if ($wantedShot -and $shotReuse -ne 'step' -and $shotReuse -ne 'step-stale') {
        if ([string]::IsNullOrWhiteSpace($defaultPath)) { throw "a trailing screenshot needs a path" }
        # The steps all ran, but the capture is still something the caller may not want
        # any more: a batch that takes two seconds to lay out is exactly when "stop" is
        # pressed, and a frame nobody asked for is real cost.
        Assert-NotCancelled 'before the trailing screenshot'
        Settle-Before-Capture
        # Every step is behind it, so it is always on the right side of the last write.
        if ($null -ne $evidenceRect) { $trailingArgs.evidenceRect = $evidenceRect }
        try {
            $shot = Do-Screenshot $trailingArgs
        } catch {
            # The capture is the trailing *observation*, not the call: a screen that refuses to
            # be read (a locked desktop, a surface with no usable rectangle) must not replace
            # the record of the steps that already ran (§5.2). The failure is attached, and the
            # caller is told to take the picture itself.
            $shot = $null
            $shotReuse = ''
            $observation = [ordered]@{
                failed = $true
                what   = 'capture'
                error  = "$($_.Exception.Message)"
                note   = 'the steps in this call did run; it is the capture at the end that failed, so take it yourself with computer_screenshot and read the window again'
            }
        }
        if ($null -ne $shot) {
            if ($null -ne $shot.evidenceDigest -and "$($shot.evidenceDigest)" -ne '') { $evidenceDigest = "$($shot.evidenceDigest)" }
            # A window capture with a region is cropped inside the capture itself now (raw
            # pixels, one scale, one encode): the old path wrote the whole window, read it back
            # from disk, cropped it with coordinates from the wrong space and scaled it again.
            Set-PayloadField $shot 'afterLastWrite' $true
            if ($shotReuse -eq 'retaken') {
                Set-PayloadField $shot 'note' 'a screenshot step earlier in this batch had already produced a frame, but a write came after it, so this capture was taken to return the state after the last step rather than a picture of the state before it'
            }
        }
    }
    if ($null -ne $shot -and $null -eq $shot.afterLastWrite) {
        $fresh = $true
        $liveStamp = Get-CaptureStampInfo
        if ($null -ne $liveStamp) { $fresh = Test-CaptureAfterWrite $liveStamp }
        Set-PayloadField $shot 'afterLastWrite' $fresh
        if (-not $fresh) {
            Set-PayloadField $shot 'note' 'this frame was taken before the last write in this call, so it shows the state before the steps finished'
        }
    }

    $evidence = Complete-Evidence
    $state = $null
    if ($null -ne $Arg.state) {
        # The same call can end with an observation instead of (or as well as) a
        # picture: an accessibility read is far smaller than a frame and answers
        # "did my batch do what I meant" more precisely than pixels do.
        Assert-NotCancelled 'before the trailing accessibility read'
        $s = $Arg.state
        try {
            $state = Do-UiTree @{
                hwnd         = $s.hwnd
                filter       = $s.filter
                name         = $s.name
                controlType  = $s.control_type
                automationId = $s.automation_id
                patterns     = $s.patterns
                maxDepth     = $s.max_depth
                maxNodes     = $s.max_nodes
                prune        = $s.prune
                since        = $s.since
                settleMs     = $settleMs
                # The trailing observation takes the same text configuration as a standalone
                # read, so "put the form in, then show me what it says" stays one call.
                text         = $s.text
                textTarget   = $s.text_target
                maxTextChars = $s.max_text_chars
                maxSelected  = $s.max_selected
            }
        } catch {
            # The observation is a *second* thing this call does, and its failure does not undo
            # the first (§5.2): the steps ran, so their receipt is returned with the read's
            # failure attached rather than the whole reply being replaced by an error.
            $observation = [ordered]@{
                failed = $true
                what   = 'state'
                error  = "$($_.Exception.Message)"
                note   = 'the steps in this call did run; it is the read at the end that failed, so read that window again before deciding anything else'
            }
        }
    }

    # NOT $result: within a function, assigning an undeclared variable named `$result`
    # shadows the caller's `$result` that contains this function's return value, and the
    # command handler then returns an array of two things -- which the parent reports as
    # an unrelated concat error. (`$matches` was learned the same way in Find-UiaMatch.)
    $reply = [ordered]@{
        performed = @($performed.ToArray())
        count     = $performed.Count
        failedAt  = -1
        error     = ''
        canceled  = $false
        elapsedMs = [int]$stopwatch.ElapsedMilliseconds
        outcome    = "$outcome"
        action_sent = ($wroteSteps.Count -gt 0)
        wroteSteps = @($wroteSteps.ToArray() | ForEach-Object { [int]$_ })
        shot      = $shot
        evidence  = $evidence
        state     = $state
        progress  = @(New-BatchProgress $steps -1 '')
        partialSteps = @()
    }
    if ($null -ne $observation) { $reply['observation'] = $observation }
    if ($nextStep -ge 0) { $reply['nextStep'] = [int]$nextStep }
    # How much of the call's own deadline was left (or how far past it the call ran). The
    # numbers are measured, never clamped to the budget: a blocking system call inside this
    # worker cannot be interrupted from here, and reporting the budget instead of the real
    # elapsed time is how a timeout came to look like it fitted (§5.7, item 6).
    if ($deadlineMs -gt 0) {
        $over = [int64]$script:Clock.ElapsedMilliseconds - [int64]$deadlineAtMs
        $reply['deadlineMs'] = [int]$deadlineMs
        $reply['overDeadlineMs'] = [int]([Math]::Max(0, $over))
        $reply['deadlineMet'] = ($over -le 0)
    }
    if ($transitions.Count -gt 0) { $reply['transitions'] = @($transitions | ForEach-Object { $_ }) }
    if ($waitReports.Count -gt 0) { $reply['waits'] = @($waitReports | ForEach-Object { $_ }) }
    if ($shotReuse -ne '') {
        $captureUsed = [ordered]@{
            from           = "$shotReuse"
            stepIndex      = [int]$frameStepIndex
            afterLastWrite = $true
        }
        if ($null -ne $shot -and $null -ne $shot.afterLastWrite) { $captureUsed['afterLastWrite'] = [bool]$shot.afterLastWrite }
        if ($null -ne $shot -and $null -ne $shot.stepIndex) { $captureUsed['stepIndex'] = [int]$shot.stepIndex }
        $captureUsed['note'] = switch ($shotReuse) {
            'step'        { 'returned the frame a screenshot step in this batch already took, because it is newer than the last write; no second capture was taken' }
            'step-stale'  { 'returned the frame a screenshot step took, although it predates the last write, because this call has no path to write a new one to' }
            'retaken'     { 'a screenshot step earlier in the batch had already taken a frame, but a write came after it, so a fresh capture was taken to return the state after the last step' }
            default       { '' }
        }
        $reply['captureUsed'] = $captureUsed
    }
    if ($env:DSH_COMPUTER_USE_DEBUG -eq '1') {
        # Off by default. When a capture-provenance question is being chased, this is what
        # says whether the frame was reused or retaken and which write ordinals decided it.
        $facts = [ordered]@{
            writeSeq      = [int64]$script:WriteSeq
            shotReuse     = "$shotReuse"
            shotStepIndex = [int]$frameStepIndex
            afterLastWrite = $(if ($null -ne $shot -and $null -ne $shot.afterLastWrite) { "$($shot.afterLastWrite)" } else { 'n/a' })
        }
        if ($null -ne $shot) {
            $live = Get-CaptureStampInfo
            if ($null -ne $live) {
                $facts.shotAgeMs = [int]$live.ageMs
                $facts.shotWriteSeq = [int64]$live.writeSeq
            }
        }
        $facts.writeStamp = Get-WriteStampInfo
        if ($null -ne $usefulCapture -and $null -ne $usefulCapture.capture) {
            $facts.stepCaptureSeq = [int]$usefulCapture.capture.seq
            $facts.stepCaptureWriteSeq = [int64]$usefulCapture.capture.writeSeq
            $facts.stepCaptureAtMs = [int64]$usefulCapture.capture.atMs
        }
        $reply['debug'] = $facts
    }
    # The batch is over: the next request must not inherit this call's deadline. (The main loop
    # clears it as well, so a throw cannot leave it behind either way.)
    Clear-Deadline
    return $reply
}

# ------------------------------------------------------------------ main loop

function Resolve-ElementRef([string]$ref) {
    # Turn a ref back into something addressable, in the *current* tree.
    #
    # This is not a lookup: the point of a ref is that the tree may have moved since
    # it was minted. So the window is read again, the recorded identity is matched
    # against what is there now, and the caller is told whether the match is the same
    # element in the same place (`reresolved` false) or the same element somewhere
    # else (`reresolved` true, with how far it moved).
    $entry = $script:ElementRegistry[$ref]
    if ($null -eq $entry) {
        # Which kind of "not found" this is decides what the caller should do, so the
        # three causes are named separately rather than lumped into one sentence. And
        # none of them means the element disappeared: an observation being retired is a
        # bookkeeping fact about this worker, not a fact about the UI.
        $number = 0
        $generation = ''
        $parsed = $false
        $legacy = $false
        if ($ref -match '^s([0-9a-z]{4})(\d+)\.') { $generation = "$($Matches[1])"; $number = [int]$Matches[2]; $parsed = $true }
        elseif ($ref -match '^s(\d+)\.') { $number = [int]$Matches[1]; $legacy = $true }
        # A ref in the pre-generation spelling is still judged by its number, because that
        # is the part a caller can act on: a number past everything this worker has ever
        # issued was never issued at all, while one inside the range belonged to a read this
        # worker has since forgotten (or to an older build that had no generation at all).
        $cause = 'not in this registry'
        if (-not $parsed -and -not $legacy) { $cause = 'malformed' }
        elseif ($parsed -and $generation -ne $script:BootGen) { $cause = "minted by a previous worker generation ($generation; this worker is $($script:BootGen)) -- the per-worker counter restarts at 1, so this ref could otherwise hit an unrelated element that now sits in the same slot" }
        elseif ($number -gt $script:SnapshotSeq) { $cause = 'never issued in this session' }
        elseif ($legacy) { $cause = 'minted by an older worker build, before refs carried a worker generation' }
        elseif ($number -le ($script:SnapshotSeq - $script:SnapshotKeep)) { $cause = 'retired when older observations were pruned' }
        return @{ ok = $false; error = "[STALE_REF] ref '$ref' ($cause). This does not mean the element disappeared. Read the tree again with computer_ui and use a ref from that fresh read. (action_sent=false, element_lookup=not_found, recovery=computer_ui, auto_reresolve=false)" }
    }

    # The handle could have been recycled: Windows reuses HWNDs, so "the window with this
    # handle" is not the same claim as "the window this ref was read from". Acting on a
    # recycled handle would be a silent wrong-target action, so the owner is checked
    # before anything is dispatched.
    $live = Get-WindowInfoForHwnd ([IntPtr][int64]$entry.hwnd)
    if ($null -ne $live -and [int]$entry.pid -gt 0 -and [int]$live.pid -ne [int]$entry.pid) {
        return @{ ok = $false; error = "[TARGET_CHANGED] hwnd $($entry.hwnd) belonged to pid $($entry.pid) when the ref was read and belongs to pid $($live.pid) now: the handle has been recycled, so this ref does not name the window it was read from. Read the tree again with computer_ui. (action_sent=false, element_lookup=not_found, recovery=computer_ui, auto_reresolve=false)" }
    }

    # Fast path first: when the ref recorded an automation id, ask the provider for that id
    # directly instead of walking the whole tree and filtering afterwards.
    #
    # The full walk exists so a ref can be re-found when nothing is left to go on but a
    # label, a class and the provider's anonymous ancestors -- and it is the expensive half
    # of a ref action (one cross-process call per node). An id turns the same question into
    # one server-side query: how many nodes carry it, and where is that node now? Unique
    # means there is nothing to disambiguate, so the walk would have produced exactly this
    # answer for far more work. Several matches (real apps do share an id -- Notepad gives
    # six status-bar cells the same one) or none falls through to the walk, because that is
    # precisely the case where the walk's extra information is what decides.
    if ($entry.automationId -ne '') {
        $probe = Do-UiTree ([ordered]@{ hwnd = $entry.hwnd; automationId = $entry.automationId; maxDepth = 1; maxNodes = 40; patterns = $false; skipEmpty = $false; prune = $false }) $false
        $probeRows = @($probe.nodes)
        if ($probeRows.Count -eq 0) {
            return @{ ok = $false; error = "[ELEMENT_UNAVAILABLE] the element the ref named (#$($entry.automationId)) is no longer in hwnd $($entry.hwnd). (action_sent=false, element_lookup=not_found, recovery=computer_ui, auto_reresolve=false)" }
        }
        if ($probeRows.Count -eq 1) {
            $only = $probeRows[0]
            $cx = [int]$only['x'] + [int]([int]$only['width'] / 2)
            $cy = [int]$only['y'] + [int]([int]$only['height'] / 2)
            $wantX = $entry.x + [int]($entry.width / 2)
            $wantY = $entry.y + [int]($entry.height / 2)
            $drift = [int][Math]::Round([Math]::Sqrt([Math]::Pow($cx - $wantX, 2) + [Math]::Pow($cy - $wantY, 2)))
            # Same verdict rule as the walk below, minus the path signal: the id is what
            # selected this row, so only the position and the label can have changed.
            $reresolved = ($drift -gt 2) -or ("$($only['name'])" -ne $entry.name)
            return @{
                ok         = $true
                selector   = [ordered]@{ hwnd = [int64]$entry.hwnd; automationId = "$($only['automationId'])"; index = 0 }
                reresolved = $reresolved
                drift      = $drift
                entry      = $entry
                node       = $only
                path       = ''
                via        = 'automation-id'
            }
        }
    }

    # The full walk: no depth cut and no scaffolding filter, because the candidates
    # have to line up with what the action path will itself resolve.
    # prune off, deliberately: the selector index this computes has to line up with the
    # enumeration the action path itself performs, and that one sees the raw tree.
    # patterns off as well: nothing below compares or returns them (the action path reads
    # them for its own receipt), and probing them costs one cross-process call per node.
    $tree = Do-UiTree ([ordered]@{ hwnd = $entry.hwnd; maxDepth = 12; maxNodes = 1500; patterns = $false; skipEmpty = $false; prune = $false }) $false
    $nodes = @($tree.nodes)
    if ($nodes.Count -eq 0) {
        return @{ ok = $false; error = "[ELEMENT_UNAVAILABLE] the window the ref was read from (hwnd $($entry.hwnd)) has no readable UI Automation tree any more. (action_sent=false, element_lookup=not_found, recovery=computer_ui, auto_reresolve=false)" }
    }

    $candidates = @()
    if ($entry.automationId -ne '') {
        $candidates = @($nodes | Where-Object { "$($_['automationId'])" -eq $entry.automationId })
    }
    if ($candidates.Count -eq 0 -and $entry.name -ne '') {
        $candidates = @($nodes | Where-Object { "$($_['controlType'])" -eq $entry.controlType -and "$($_['name'])" -eq $entry.name })
    }
    if ($candidates.Count -eq 0 -and $entry.className -ne '') {
        $candidates = @($nodes | Where-Object { "$($_['controlType'])" -eq $entry.controlType -and "$($_['className'])" -eq $entry.className })
    }
    if ($candidates.Count -eq 0) {
        $label = $entry.automationId
        if ($label -eq '') { $label = $entry.controlType + ' ' + $entry.name }
        return @{ ok = $false; error = "[ELEMENT_UNAVAILABLE] the element the ref named ($label) is no longer in hwnd $($entry.hwnd). (action_sent=false, element_lookup=not_found, recovery=computer_ui, auto_reresolve=false)" }
    }

    # Same path first (the ref was read from this exact branch of the tree), then
    # whichever candidate sits nearest where it used to be.
    $wantX = $entry.x + [int]($entry.width / 2)
    $wantY = $entry.y + [int]($entry.height / 2)
    $best = $null
    $bestScore = [double]::MaxValue
    $bestPath = ''
    foreach ($candidate in $candidates) {
        $candidateEntry = $script:ElementRegistry["$($candidate['ref'])"]
        $path = ''
        if ($null -ne $candidateEntry) { $path = $candidateEntry.path }
        $score = 0.0
        if ($path -ne $entry.path) { $score += 100000 }
        $cx = [int]$candidate['x'] + [int]([int]$candidate['width'] / 2)
        $cy = [int]$candidate['y'] + [int]([int]$candidate['height'] / 2)
        $score += [Math]::Sqrt([Math]::Pow($cx - $wantX, 2) + [Math]::Pow($cy - $wantY, 2))
        if ($score -lt $bestScore) { $bestScore = $score; $best = $candidate; $bestPath = $path }
    }

    # Address the match through the ordinary selectors. The automation id when the
    # provider gives one is exact; otherwise the label triple plus the index of this
    # candidate among the nodes that same triple matches.
    $selector = [ordered]@{ hwnd = [int64]$entry.hwnd; index = 0 }
    if ("$($best['automationId'])" -ne '') {
        $selector.automationId = "$($best['automationId'])"
        $same = @($nodes | Where-Object { "$($_['automationId'])" -eq $selector.automationId })
    } else {
        $selector.controlType = "$($best['controlType'])"
        if ("$($best['className'])" -ne '') { $selector.className = "$($best['className'])" }
        if ("$($best['name'])" -ne '') { $selector.name = "$($best['name'])" }
        $same = @($nodes | Where-Object {
            "$($_['controlType'])" -eq $selector.controlType -and
            ("$($selector.className)" -eq '' -or "$($_['className'])" -eq $selector.className) -and
            ("$($selector.name)" -eq '' -or "$($_['name'])" -eq $selector.name)
        })
    }
    for ($i = 0; $i -lt $same.Count; $i++) {
        if ([object]::ReferenceEquals($same[$i], $best)) { $selector.index = $i; break }
    }

    $cx2 = [int]$best['x'] + [int]([int]$best['width'] / 2)
    $cy2 = [int]$best['y'] + [int]([int]$best['height'] / 2)
    $drift = [int][Math]::Round([Math]::Sqrt([Math]::Pow($cx2 - $wantX, 2) + [Math]::Pow($cy2 - $wantY, 2)))
    # Whether this is "the same element in the same place". Position decides, and
    # identity breaks the tie: an element that did not move and still has the same
    # automation id and label is the element the ref named. The path is a scoring
    # signal, not the verdict -- it is built from whichever read reported the
    # ancestors, and a filtered read and a full read disagree about anonymous ones.
    $reresolved = ($drift -gt 2) -or ("$($best['automationId'])" -ne $entry.automationId) -or ("$($best['name'])" -ne $entry.name)

    return @{
        ok         = $true
        selector   = $selector
        reresolved = $reresolved
        drift      = $drift
        entry      = $entry
        node       = $best
        path       = $bestPath
        via        = 'tree-walk'
    }
}

function Do-UiActByRef([object]$Arg) {
    # `ref` is a pre-resolution layer, not a second action path: it turns a pinned
    # identity into the selectors the action code already understands, so every
    # action keeps exactly one implementation.
    if ($null -eq $Arg.ref -or "$($Arg.ref)" -eq '') { return Do-UiAct $Arg }
    $resolved = Resolve-ElementRef ([string]$Arg.ref)
    if (-not $resolved.ok) { throw $resolved.error }

    $merged = [ordered]@{}
    # Two shapes arrive here: a hashtable from the batch dispatcher (which builds the step's
    # arguments itself) and a PSCustomObject from the JSON protocol. Copying only
    # `PSObject.Properties` silently produced an *empty* argument set for the hashtable --
    # which is how every batch step carrying a `ref` failed with "uiact requires an action"
    # while the single-step tool worked. Found by the task-evaluation harness, which is the
    # only place a ref step had ever been run for real.
    if ($Arg -is [System.Collections.IDictionary]) {
        foreach ($key in @($Arg.Keys)) { $merged[[string]$key] = $Arg[$key] }
    } else {
        foreach ($property in $Arg.PSObject.Properties) { $merged[$property.Name] = $property.Value }
    }
    foreach ($key in @('hwnd', 'automationId', 'name', 'controlType', 'className', 'index')) {
        if ($null -ne $resolved.selector[$key]) { $merged[$key] = $resolved.selector[$key] }
    }

    $receipt = Do-UiAct $merged
    $receipt.ref = [string]$Arg.ref
    $receipt.reresolved = [bool]$resolved.reresolved
    $receipt.drift = [int]$resolved.drift
    # How the ref was re-found, so a caller (or a benchmark) can see whether it paid for a
    # tree walk or answered from one provider query.
    $receipt.resolvedVia = [string]$resolved.via
    return $receipt
}

function Do-Prune([object]$Arg) {
    # The optimization pass as a pure function over a supplied tree.
    #
    # It exists so the pass can be tested against trees that are actually messy. The
    # windows on a given desktop may all be tidy -- on the machine this was written on,
    # every window but a browser was -- and a pass that only ever sees tidy input is a
    # pass that breaks silently the first time it meets a wall of anonymous panes.
    $rows = New-Object System.Collections.Generic.List[object]
    foreach ($node in @($Arg.nodes)) {
        $rows.Add([ordered]@{
            depth        = [int]$node.depth
            name         = [string]$node.name
            controlType  = [string]$node.controlType
            automationId = [string]$node.automationId
            className    = [string]$node.className
            enabled      = [bool]$node.enabled
            offscreen    = [bool]$node.offscreen
            x            = [int]$node.x
            y            = [int]$node.y
            width        = [int]$node.width
            height       = [int]$node.height
            patterns     = @($node.patterns)
        })
    }
    $maxNodes = 250
    if ($null -ne $Arg.maxNodes) { $maxNodes = [Math]::Max(1, [int]$Arg.maxNodes) }
    $optimized = Optimize-UiRows $rows $maxNodes
    return [ordered]@{ nodes = @($optimized.nodes); pruned = [int]$optimized.pruned; input = $rows.Count }
}

function Do-Delta([object]$Arg) {
    # The tree comparison as a pure function over two supplied readings, for the same
    # reason `prune` is one: in practice a delta only ever compared tidy trees that had
    # not changed, and the fields it forgot to compare -- enabled, offscreen, patterns --
    # are exactly the ones a caller acts on. Two readings written by hand are how that
    # gets tested without needing a window that changes a button's enabled state on cue.
    $nodes = New-Object System.Collections.Generic.List[object]
    foreach ($node in @($Arg.nodes)) {
        $nodes.Add([ordered]@{
            key          = "$($node.key)"
            ref          = "$($node.ref)"
            name         = [string]$node.name
            controlType  = [string]$node.controlType
            className    = [string]$node.className
            enabled      = [bool]$node.enabled
            offscreen    = [bool]$node.offscreen
            patterns     = @($node.patterns)
            x            = [int]$node.x
            y            = [int]$node.y
            width        = [int]$node.width
            height       = [int]$node.height
        })
    }
    $entries = New-Object System.Collections.Generic.List[object]
    foreach ($entry in @($Arg.entries)) {
        $entries.Add([ordered]@{
            key         = "$($entry.key)"
            snapshot    = "$($entry.snapshot)"
            name        = [string]$entry.name
            controlType = [string]$entry.controlType
            className   = [string]$entry.className
            enabled     = [bool]$entry.enabled
            offscreen   = [bool]$entry.offscreen
            patterns    = @($entry.patterns)
            x           = [int]$entry.x
            y           = [int]$entry.y
            width       = [int]$entry.width
            height      = [int]$entry.height
        })
    }
    $result = New-TreeDelta $nodes $entries "$($Arg.base)"
    return [ordered]@{ counts = $result.counts; nodes = @($result.nodes) }
}

function ConvertTo-FrameRecord([object]$spec) {
    # A frame spec (from JSON) -> the internal FrameRecord shape. Only the fields a
    # projection needs are read, and each one has a stated default, so a caller (or a test)
    # can hand in exactly the geometry it is about and nothing else.
    $surfaceIn = Get-ConditionField $spec 'surface'
    $cropIn = Get-ConditionField $spec 'crop'
    $encodedIn = Get-ConditionField $spec 'encoded'
    $attachedIn = Get-ConditionField $spec 'attached'
    $windowIn = Get-ConditionField $spec 'windowRect'
    $hwnd = [int64](Get-ConditionField $spec 'hwnd' 0)
    $ownerPid = [int](Get-ConditionField $spec 'pid' 0)
    $virtual = Get-VirtualBounds
    $surface = [ordered]@{
        kind   = "$(Get-ConditionField $surfaceIn 'kind' 'screen')"
        x      = [int](Get-ConditionField $surfaceIn 'x' 0)
        y      = [int](Get-ConditionField $surfaceIn 'y' 0)
        width  = [int](Get-ConditionField $surfaceIn 'width' 1)
        height = [int](Get-ConditionField $surfaceIn 'height' 1)
    }
    $crop = [ordered]@{
        x      = [int](Get-ConditionField $cropIn 'x' 0)
        y      = [int](Get-ConditionField $cropIn 'y' 0)
        width  = [int](Get-ConditionField $cropIn 'width' $surface.width)
        height = [int](Get-ConditionField $cropIn 'height' $surface.height)
    }
    $encoded = [ordered]@{
        width  = [int](Get-ConditionField $encodedIn 'width' $crop.width)
        height = [int](Get-ConditionField $encodedIn 'height' $crop.height)
    }
    $attached = [ordered]@{
        width          = [int](Get-ConditionField $attachedIn 'width' 0)
        height         = [int](Get-ConditionField $attachedIn 'height' 0)
        transformKnown = ($null -ne $attachedIn -and (Get-ConditionField $attachedIn 'transformKnown' $false) -eq $true)
        reported       = ($null -ne $attachedIn)
    }
    $windowRect = $null
    if ($null -ne $windowIn) {
        $windowRect = [ordered]@{
            x      = [int](Get-ConditionField $windowIn 'x' 0)
            y      = [int](Get-ConditionField $windowIn 'y' 0)
            width  = [int](Get-ConditionField $windowIn 'width' 0)
            height = [int](Get-ConditionField $windowIn 'height' 0)
        }
    }
    if ($null -eq $windowRect -and $hwnd -ne 0) {
        $windowRect = [ordered]@{ x = $surface.x; y = $surface.y; width = $surface.width; height = $surface.height }
    }
    $scale = [double](Get-ConditionField $spec 'effectiveScale' 1.0)
    return [ordered]@{
        id             = '__probe__'
        schemaVersion  = 2
        hwnd           = $hwnd
        pid            = $ownerPid
        # Read from the spec when a caller supplies them, so the two identity checks (the
        # process's creation time and the window's DPI) can be driven from a test the same way
        # every other part of the projection is.
        dpi            = [int](Get-ConditionField $spec 'dpi' 0)
        processStart   = [int64](Get-ConditionField $spec 'processStart' 0)
        rootHwnd       = [int64](Get-ConditionField $spec 'rootHwnd' 0)
        # A synthetic frame may state what its surface looked like and how old it is, so the
        # content check can be driven from a test without waiting for time to pass.
        surfaceDigest  = "$(Get-ConditionField $spec 'surfaceDigest' '')"
        frameAgeMs     = [int64](Get-ConditionField $spec 'ageMs' 0)
        windowRect     = $windowRect
        surface        = $surface
        crop           = $crop
        encoded        = $encoded
        attached       = $attached
        requestedScale = [double](Get-ConditionField $spec 'requestedScale' 1.0)
        effectiveScale = $scale
        source         = 'probe'
        surfaceKind    = "$($surface.kind)"
        epoch          = [int64]$script:ObservationEpoch
        writeSeq       = [int64]$script:WriteSeq
        specKey        = ''
        width          = $surface.width
        height         = $surface.height
        x              = $surface.x
        y              = $surface.y
        imageWidth     = $encoded.width
        imageHeight    = $encoded.height
        scale          = $scale
        vx             = [int]$virtual.x
        vy             = [int]$virtual.y
        vwidth         = [int]$virtual.width
        vheight        = [int]$virtual.height
    }
}

function Do-FrameAttach([object]$Arg) {
    # The host reports what it actually delivered to the model for a frame (A04): its real
    # pixel size, or that the transform is unknown. Until a frame is reported on, the worker
    # assumes the delivered image is the one it encoded -- which is how essentially every
    # capture travels -- but the receipt *says* which of the two it is rather than presenting
    # an assumption as verified arithmetic. When the sizes differ, the inverse is recorded and
    # used; when the transform is unknown, projecting from that image is refused instead of
    # guessed.
    $id = "$($Arg.frame)"
    $frame = $script:FrameRegistry[$id]
    if ($null -eq $frame) {
        return [ordered]@{ ok = $false; frame = $id; known = $false; error = "frame '$id' is not in this worker's registry any more" }
    }
    $width = 0
    $height = 0
    if ($null -ne $Arg.width) { $width = [int]$Arg.width }
    if ($null -ne $Arg.height) { $height = [int]$Arg.height }
    $knownFlag = ($Arg.transformKnown -ne $false)
    $frame.attached = [ordered]@{
        width          = $width
        height         = $height
        transformKnown = ($knownFlag -and $width -gt 0 -and $height -gt 0)
        reported       = $true
    }
    $note = ''
    if ($frame.attached.transformKnown -ne $true) {
        $note = 'the delivered image has an unknown transform, so coordinates measured in it will be refused rather than projected'
    } elseif ($width -ne [int]$frame.encoded.width -or $height -ne [int]$frame.encoded.height) {
        $note = "the host delivered a ${width}x${height} image for a $([int]$frame.encoded.width)x$([int]$frame.encoded.height) frame; the inverse scale is recorded and will be applied when projecting"
    } else {
        $note = 'the delivered image is the encoded one, pixel for pixel'
    }
    return [ordered]@{
        ok       = $true
        frame    = $id
        known    = [bool]$frame.attached.transformKnown
        encoded  = [ordered]@{ width = [int]$frame.encoded.width; height = [int]$frame.encoded.height }
        attached = [ordered]@{ width = $width; height = $height }
        note     = $note
    }
}

function Do-FrameProject([object]$Arg) {
    # The coordinate transform as a *pure function* a test can drive without a desktop: hand
    # it a frame spec and an image point, get the desktop point or the refusal. That is what
    # makes "the arithmetic is right" checkable against synthetic bitmaps and synthetic window
    # metadata, instead of by clicking at a real control and seeing whether the right thing
    # happened.
    #
    # The spec is written into the same registry the real path uses, so the code under test is
    # the code that runs, and it is removed again in `finally`.
    $spec = $Arg.frame
    if ($null -eq $spec) { throw "[BAD_REQUEST] frameproject needs a frame spec" }
    $record = ConvertTo-FrameRecord $spec
    $id = "$($record.id)"
    $script:FrameRegistry[$id] = $record
    try {
        $px = 0
        $py = 0
        if ($null -ne $Arg.x) { $px = [int]$Arg.x }
        if ($null -ne $Arg.y) { $py = [int]$Arg.y }
        # The two request-level switches travel the same way they do from a real action, so a
        # test drives the same decisions a caller does.
        $resolved = Resolve-FramePoint $id $px $py ([ordered]@{
            verifyContent = $Arg.verifyContent
            allowActivate = ($Arg.allowActivate -eq $true)
            allowWindows = $Arg.allowWindows
        })
        $transform = Get-FrameTransform $record ([double]$px) ([double]$py)
        if ($resolved.ok -ne $true) {
            return [ordered]@{
                ok        = $false
                error     = "$($resolved.error)"
                transform = $transform
            }
        }
        return [ordered]@{
            ok      = $true
            x       = [int]$resolved.x
            y       = [int]$resolved.y
            drift   = [int]$resolved.drift
            mapping = "$($resolved.mapping)"
            guard   = "$($resolved.guard.how)"
            recovered = ($resolved.activated -eq $true)
        }
    } finally {
        $script:FrameRegistry.Remove($id)
    }
}

$handler = @{
    'ping'       = { param($a) [ordered]@{ ready = $true; dpi = $dpiMode; dpiActual = $dpiActual; screens = @(Get-ScreenList); virtual = Get-VirtualBounds; cursor = (Do-Cursor) } }
    'screenshot' = { param($a) if ("$($a.captures)" -eq 'related') { Do-ScreenshotRelated $a } else { Do-Screenshot $a } }
    'batch'      = { param($a) Do-Batch $a }
    'cursor'     = { param($a) Do-Cursor }
    'click'      = { param($a) Do-Click $a }
    'wait'       = { param($a) Do-Wait $a }
    'wait_for'   = { param($a) Wait-ForCondition $a }
    'drag'       = { param($a) Do-Drag $a }
    'scroll'     = { param($a) Do-Scroll $a }
    'type'       = { param($a) Do-Type $a }
    'key'        = { param($a) Do-Key $a }
    'clipboard'  = { param($a) Do-Clipboard $a }
    'paste'      = { param($a) Do-Paste $a }
    'launch'     = { param($a) Do-Launch $a }
    'release'    = { param($a) Do-Release }
    'digest'     = { param($a) Do-Digest $a }
    'windows'    = { param($a) Do-Windows $a }
    'focus'      = { param($a) Do-Focus $a }
    'uireset'    = { param($a) [DshUia.Engine]::Reset(); return [ordered]@{ reset = $true } }
    'uitree'     = { param($a) Reset-WalkCounters; Do-UiTree $a }
    'uiact'      = { param($a) Do-UiActByRef $a }
    'health'     = { param($a) Do-Health }
    'pacing'     = { param($a) Do-Pacing $a }
    'prune'      = { param($a) Do-Prune $a }
    'delta'      = { param($a) Do-Delta $a }
    'frameproject' = { param($a) Do-FrameProject $a }
    'frameattach' = { param($a) Do-FrameAttach $a }
    'shutdown'   = { param($a) [ordered]@{ bye = $true } }
}

function Write-Line([object]$payload) {
    $json = $payload | ConvertTo-Json -Compress -Depth 12
    $stdout.WriteLine($json)
}

# The build identity: the content hash of this script. The host hashes the same file and
# compares the two at startup, so a half-applied upgrade -- a new index.js talking to an old
# worker.ps1, or the other way round -- is named at the first call instead of turning up
# later as a mystery refusal on the model's third action (A09). A hash that cannot be taken
# is reported as empty, and the host treats that as "cannot verify" rather than as a match.
$script:BuildId = ''
try {
    if (-not [string]::IsNullOrWhiteSpace($PSCommandPath) -and (Test-Path -LiteralPath $PSCommandPath)) {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            $bytes = [System.IO.File]::ReadAllBytes($PSCommandPath)
            $script:BuildId = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').Substring(0, 16).ToLowerInvariant()
        } finally { $sha.Dispose() }
    }
} catch { $script:BuildId = '' }

# The build identity has to cover the code that actually runs (§13.5). The independent release
# path is a second script the host executes when this worker is force-killed, so its hash is
# published here too and verified by the host the same way: a release script from another install
# would be a release that presses keys this build never recorded.
$script:ReleaseBuildId = ''
try {
    $releasePath = Join-Path (Split-Path -Parent $PSCommandPath) 'release-input.ps1'
    if (Test-Path -LiteralPath $releasePath) {
        $shaRelease = [System.Security.Cryptography.SHA256]::Create()
        try {
            $releaseBytes = [System.IO.File]::ReadAllBytes($releasePath)
            $script:ReleaseBuildId = [BitConverter]::ToString($shaRelease.ComputeHash($releaseBytes)).Replace('-', '').Substring(0, 16).ToLowerInvariant()
        } finally { $shaRelease.Dispose() }
    }
} catch { $script:ReleaseBuildId = '' }

$script:Capabilities = @(
    'capture.spec',            # one normalisation for single and batch captures
    'capture.crop',            # regions are cropped on the raw pixels, before scaling
    'frame.v2',                # window / surface / crop / encoded / attached, kept apart
    'guard.landing',           # every coordinate write checks what is under the point
    'wait.three-valued',       # true / false / unknown, with an exit reason
    'wait.held',               # stable_ms means "held for this long", measured
    'batch.deadline',          # one deadline shared by every wait in a batch
    'batch.expected-transitions',
    'observe.epoch'            # a wait boundary invalidates a frame as a final result
    ,'text.observe'            # a read can carry the focused/selected/document text, on one shared budget
    # Added by the 9.txt work. The host *requires* these (§13.7): a half-applied rollback -- a new
    # host talking to the 1.39.1 worker -- would otherwise be accepted, because the file on disk
    # still matches the process that read it, and the two halves would silently disagree about the
    # reply shape instead of saying so.
    ,'reply.traversal'         # reads report visited / queued / budget / how many traversals
    ,'reply.pushdown'          # a search says which conditions the provider filtered
    ,'input.partial'           # a partially delivered input is its own outcome, never a success
    ,'deadline.enforced'       # a spent budget stops the call before it starts another step
    ,'release.independent'     # held input is mirrored, so a killed worker can still be released
)

Write-Line @{ ready = $true; info = @{ dpi = $dpiMode; dpiActual = $dpiActual; screens = @(Get-ScreenList); virtual = Get-VirtualBounds; pid = $PID; version = $PSVersionTable.PSVersion.ToString(); generation = $script:BootGen; protocol = 2; frameProtocol = $script:FrameProtocol; build = $script:BuildId; releaseBuild = $script:ReleaseBuildId; capabilities = @($script:Capabilities); actions = @($STEP_ACTIONS); uiaActions = @($UIA_STEP_ACTIONS); cancelFile = $script:CancelFile; pacing = (Get-PacingConfig) } }

while ($true) {
    $line = $stdin.ReadLine()
    if ($null -eq $line) { break }
    $line = $line.Trim()
    if ($line -eq '') { continue }
    $id = 0
    try {
        $req = $line | ConvertFrom-Json
        $id = $req.id
        $script:RequestSeq = [int]$script:RequestSeq + 1
        $cmd = [string]$req.cmd
        if (-not $handler.ContainsKey($cmd)) { throw "unknown command '$cmd'" }
        # `& $handler[$cmd] $req.args` runs the handler in *this* script's scope: a script
        # block is not a closure, so a variable a handler assigns while a variable of the
        # same name exists here lands here -- and outlives the command. That is how a
        # previous reply once became the value of a later `+=` inside a handler. The name
        # `$outcome` is distinct from anything a handler uses, and the two accumulators the
        # batch builds are typed lists rather than arrays, so neither can be re-resolved
        # into something that does not support `.Add`.
        $outcome = & $handler[$cmd] $req.args
        Write-Line @{ id = $id; ok = $true; result = $outcome }
        if ($cmd -eq 'shutdown') { break }
    } catch {
        $msg = $_.Exception.Message
        # A cancelled request is reported as a cancellation, not as a failed action: the
        # caller asked for the stop, and the two need different reactions (nothing to
        # fix vs. something to fix).
        $cancelled = $msg.StartsWith('[CANCELED]', [System.StringComparison]::Ordinal)
        Write-Line @{ id = $id; ok = $false; error = $msg; canceled = $cancelled }
    } finally {
        # The marker belongs to the command it was set for. Clearing it here -- and the
        # parent clearing it before every write -- is what keeps a cancel from leaking
        # into the next request and stopping something nobody cancelled. The deadline is
        # the same kind of per-request state, and is cleared here for the same reason.
        Clear-CancelRequest
        Clear-Deadline
    }
}

# Unwind anything still believed to be pressed. The parent kills this process on a
# timeout, and a die-off between a mouse-down and its release would otherwise leave
# the user's desktop holding a button the system never got told to let go of.
try { [void](Release-HeldInput) } catch { }
