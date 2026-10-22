@echo off
rem Double-click repair for a profile that carries its own @deepseek-ai/dsh-tools.
rem
rem When that copy does not match the installed DeepSeek Harness, the host disables its
rem `tools` row and the app refuses to start:
rem     The application could not start or stopped unexpectedly.
rem     agent-loop (required)  tools ...
rem
rem 1.40.2 no longer declares that package as a peer, so re-running the ordinary install
rem command already removes the copy (pnpm moves it to node_modules\.ignored). Use this
rem file when the copy is recorded in the profile's own dependency tree, or when you want
rem to check before touching anything:
rem     fix-profile-links.cmd -CheckOnly
setlocal
chcp 65001 >nul
set "PS1=%~dp0tools\fix-profile-links.ps1"
if not exist "%PS1%" (
  echo [X] tools\fix-profile-links.ps1 is missing next to this file.
  echo     Unzip the whole package first, then run this again.
  pause
  exit /b 2
)
echo Repairing the DSH profile ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set RC=%errorlevel%
echo.
if "%RC%"=="0" (
  echo [OK] Fully quit DeepSeek Harness, then start it again.
) else (
  echo [!] Nothing was repaired. Read the lines above.
)
echo.
pause
exit /b %RC%
