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

