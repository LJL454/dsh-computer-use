# A worker that answers the protocol without touching the desktop.
#
# The bridge is a transport, and the failures it has to survive are transport failures:
# arguments that cannot be serialized, a request that never answers, a start that is disposed
# while it waits. None of those needs a real Win32 worker, and a test that used one would be
# pressing keys on somebody's desktop to check a queue.
#
#   ping      -> { pong = true }
#   hang      -> sleeps past any deadline this test sets
#   shutdown  -> exits
#
# It writes one JSON line per request to stdout, the same shape worker.ps1 writes.

$ready = @{ ready = $true; info = @{ generation = 'stub-' + [Guid]::NewGuid().ToString('N').Substring(0, 8); pid = $PID; stub = $true } } | ConvertTo-Json -Compress
[Console]::Out.WriteLine($ready)
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim() -eq '') { continue }
  try { $request = $line | ConvertFrom-Json } catch { continue }

  $cmd = [string]$request.cmd
  if ($cmd -eq 'shutdown') { break }
  if ($cmd -eq 'hang') {
    Start-Sleep -Seconds 30
    continue
  }

  $answer = @{ id = $request.id; ok = $true; result = @{ pong = $true; cmd = $cmd } } | ConvertTo-Json -Compress -Depth 6
  [Console]::Out.WriteLine($answer)
  [Console]::Out.Flush()
}
