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

