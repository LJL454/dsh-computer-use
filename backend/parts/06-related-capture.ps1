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

