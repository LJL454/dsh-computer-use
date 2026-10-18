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

