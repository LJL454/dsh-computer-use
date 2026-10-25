@echo off
rem Double-click repair for a profile that carries its own @deepseek-ai/dsh-tools.
rem
rem When that copy does not match the installed DeepSeek Harness, the host disables its
rem `tools` row and the app refuses to start:
rem     The application could not start or stopped unexpectedly.
rem     agent-loop (required)  tools ...
rem
rem 1.40.3: repair only, no install. The real logic lives in setup.mjs, which understands
rem the official app.asar layout (nothing to repair there — the loader resolves peers
rem itself) and refuses to build junctions into a virtual archive directory.
rem
rem   fix-profile-links.cmd              repair the desktop profile
rem   fix-profile-links.cmd web          repair another profile
rem   fix-profile-links.cmd -CheckOnly   report only
setlocal
chcp 65001 >nul
set "HERE=%~dp0"
set "HERE=%HERE:~0,-1%"

if not exist "%HERE%\setup.mjs" (
  echo [X] setup.mjs is missing next to this file. Unzip the whole package first.
  pause
  exit /b 2
)

set "ARGS=--repair-only"
if /I "%~1"=="-CheckOnly" (
  set "ARGS=--check"
) else if not "%~1"=="" (
  set "ARGS=--repair-only --profile %~1"
)

node "%HERE%\setup.mjs" %ARGS%
set RC=%errorlevel%
echo.
if "%RC%"=="0" (
  echo [OK] Fully quit DeepSeek Harness, then start it again.
) else (
  echo [!] Nothing was repaired. Read the lines above.
)
pause
exit /b %RC%
