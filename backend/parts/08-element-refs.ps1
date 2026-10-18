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

