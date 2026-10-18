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

