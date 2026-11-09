# Compiled desktop backend

`backend/dsh-worker.exe` is a standalone x64 .NET Framework 4.8 program. It uses the Windows desktop runtime, WinForms/Drawing and UI Automation assemblies. End users do not need a compiler or .NET SDK. It does not host PowerShell, extract a script, call `Add-Type`, or compile source at startup.

`nativeSource.cs` and `uiaComSource.cs` preserve the existing Win32 and COM UIA implementations. `Worker.Generated.cs` contains compiled C# implementations of the previous request handlers and state machines. `Runtime.cs` implements their value, collection, argument and .NET invocation compatibility operations. `Program.cs` owns the UTF-8 JSON-lines transport and independent input release mode. There is no general script evaluator in this executable.

The initial migration used the PowerShell parser only as a development tool to produce C# source. The shipped executable and normal build do not consume PowerShell syntax or an AST. `migration-coverage.json` identifies the original source. The 222 migrated functions plus the explicit JSON writer in `Program.cs` cover the original 223 functions; protocol startup, hashing and shutdown are implemented directly in `Program.cs`.

Build from this directory using `node build.mjs`. Development requires a .NET SDK containing Roslyn and the .NET Framework 4.8 reference assemblies. The build is deterministic and does not download dependencies. Rebuild the release manifest after changing the executable.

The standard request/response protocol, capability names and action lists remain at protocol version 2. The executable reports its own hash for both the worker and independent release identities. `--release-input <state-file>` releases only keys/buttons recorded by the worker and reports partial delivery honestly. The normal bridge starts the executable directly and keeps it alive between requests.

Validate with `node native-backend-test.mjs` from the plugin root, the desktop fixture audit, host contract tests and Defender scans under enabled protection with no allowed threats or exclusions. A clean file scan alone does not establish correct runtime behavior or future detection outcomes.
