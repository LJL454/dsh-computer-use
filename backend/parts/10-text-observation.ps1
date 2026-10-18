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

