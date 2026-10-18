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
