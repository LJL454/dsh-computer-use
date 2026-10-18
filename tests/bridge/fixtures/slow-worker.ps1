# A worker that takes its time becoming ready.
#
# `start()` is a promise somebody awaits, and a backend that is disposed while that promise is
# still open has to settle it: before this was fixed, the readiness promise was dropped on the
# floor and the caller waited for a worker that would never be announced (9.txt §5.12).

Start-Sleep -Seconds 30
[Console]::Out.WriteLine('{"ready":true,"info":{"generation":"slow","stub":true}}')
[Console]::Out.Flush()
Start-Sleep -Seconds 30
