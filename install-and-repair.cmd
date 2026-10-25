@echo off
rem One double-click: install this package into the profile, then make sure the profile
rem cannot shadow the host's own @deepseek-ai packages.
rem
rem 1.40.3: this wrapper no longer re-implements the install. It calls setup.mjs, which
rem knows the three host layouts (official app.asar desktop, unpacked desktop, npm CLI)
rem and decides success from a fresh scan instead of from how many repairs it ran.
rem
rem Optional first argument: profile name (default: desktop).
rem Honours an already-set DSH_HOME, so it can be tested against a scratch profile.
setlocal
chcp 65001 >nul

set "HERE=%~dp0"
set "HERE=%HERE:~0,-1%"
set "PROFILE=%~1"
if "%PROFILE%"=="" set "PROFILE=desktop"

if not exist "%HERE%\package.json" (
  echo [X] Run this file from inside the unzipped plugin folder.
  pause
  exit /b 2
)
if not exist "%HERE%\setup.mjs" (
  echo [X] setup.mjs is missing next to this file. Unzip the whole package first.
  pause
  exit /b 2
)

where node >nul 2>&1
if errorlevel 1 (
  echo [X] node.exe was not found on PATH. Install Node.js 20+, or run setup.mjs with the
  echo     Node that ships with DeepSeek Harness.
  pause
  exit /b 2
)

node "%HERE%\setup.mjs" --profile "%PROFILE%" %2 %3 %4 %5 %6 %7 %8 %9
set "RC=%errorlevel%"
echo.
if "%RC%"=="0" (
  echo [OK] Fully quit DeepSeek Harness, then start it again.
) else (
  echo [!] setup.mjs reported a problem ^(exit %RC%^). Read the lines above.
)
echo.
pause
exit /b %RC%
