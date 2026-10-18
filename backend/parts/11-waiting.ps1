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

