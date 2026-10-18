# A worker that is ready after a short, observable delay.
#
# `start()` is time the caller spends before its command is even queued, and the transport
# reports it separately from the time spent waiting behind another command (9.txt §7.5). The
# distinction can only be checked against a start that actually takes a moment: the stub worker
# is ready immediately, and a start that never becomes ready (slow-worker.ps1) fails instead.
#
# The delay is short enough for a test to wait through and long enough that the two timings
# cannot be confused with each other.

Start-Sleep -Milliseconds 500
[Console]::Out.WriteLine('{"ready":true,"info":{"generation":"late","stub":true}}')
[Console]::Out.Flush()

# Answer the protocol the way stub-worker.ps1 does, so a request can be made against it.
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Trim() -eq '') { continue }
    try { $request = $line | ConvertFrom-Json } catch { continue }
    if ($null -eq $request.id) { continue }
    $response = [ordered]@{ id = $request.id; ok = $true; result = [ordered]@{ pong = $true } }
    [Console]::Out.WriteLine(($response | ConvertTo-Json -Depth 6 -Compress))
    [Console]::Out.Flush()
}
