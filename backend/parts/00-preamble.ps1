# DSH computer-use backend worker.
#
# A long-lived Windows PowerShell process that speaks one JSON request per line on
# stdin and one JSON response per line on stdout. Compiling the P/Invoke helpers
# costs about a second, so it happens once at startup and every later call is a
# few milliseconds; a one-shot `powershell -Command` per action would pay that
# cost every time.
#
# Protocol
#   request   {"id":1,"cmd":"screenshot","args":{...}}
#   response  {"id":1,"ok":true,"result":{...}} | {"id":1,"ok":false,"error":"..."}
#   startup   {"ready":true,"info":{...}}
#
# ASCII only on purpose: Windows PowerShell reads a .ps1 without a BOM as ANSI,
# so any non-ASCII literal in this file would be mangled. All user text arrives
# through the JSON protocol.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$OutputEncoding = [System.Text.Encoding]::UTF8

# Talk to the parent over explicit UTF-8 streams rather than the console code
# page. Windows PowerShell decodes redirected stdin as ANSI otherwise, which
# turns any non-ASCII argument -- every Chinese control name, for instance --
# into mojibake before the JSON is even parsed.
$utf8 = New-Object System.Text.UTF8Encoding($false)
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)
$stdout = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
$stdout.AutoFlush = $true

