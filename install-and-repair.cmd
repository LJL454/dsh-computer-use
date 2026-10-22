@echo off
rem One double-click: install this package into the profile, then make sure the profile
rem cannot shadow the host's own @deepseek-ai packages.
rem
rem Use this when DeepSeek Harness refuses to start after an older version of this plugin:
rem
rem     The application could not start or stopped unexpectedly.
rem     agent-loop (required)  tools ...
rem
rem It does exactly what the manual steps do, in order:
rem   1) dsh plugin add <this folder>      (pnpm also removes a leftover dsh-tools copy)
rem   2) tools\fix-profile-links.ps1       (junction repair, idempotent)
rem
rem Optional first argument: profile name (default: desktop).
rem Honours an already-set DSH_HOME, so it can be tested against a scratch profile.
setlocal
chcp 65001 >nul

set "HERE=%~dp0"
set "HERE=%HERE:~0,-1%"
set "PROFILE=%~1"
if "%PROFILE%"=="" set "PROFILE=desktop"

set "APP=%LOCALAPPDATA%\Programs\DeepSeek Harness"
set "EXE=%APP%\DeepSeek Harness.exe"
set "CLI=%APP%\resources\app\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js"

if not exist "%EXE%" (
  echo [X] DeepSeek Harness was not found at "%APP%".
  echo     Install it there first, or edit the APP path at the top of this file.
  pause
  exit /b 2
)
if not exist "%CLI%" (
  echo [X] The DSH host CLI was not found: "%CLI%".
  echo     The application files look incomplete; reinstall DeepSeek Harness.
  pause
  exit /b 2
)
if not exist "%HERE%\package.json" (
  echo [X] Run this file from inside the unzipped plugin folder.
  pause
  exit /b 2
)

set "ELECTRON_RUN_AS_NODE=1"

echo == 1/2  installing "%HERE%" into profile "%PROFILE%" ==
"%EXE%" --expose-internals "%CLI%" plugin --profile "%PROFILE%" add "%HERE%"
set "RC=%errorlevel%"
echo.
if not "%RC%"=="0" (
  echo [!] The install command failed ^(exit %RC%^). Keep the output above.
  echo     Nothing else was changed.
  pause
  exit /b %RC%
)

echo == 2/2  making sure the profile cannot shadow the host packages ==
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%\tools\fix-profile-links.ps1" -Profile "%PROFILE%"
set "RC=%errorlevel%"
echo.
if "%RC%"=="0" (
  echo [OK] Fully quit DeepSeek Harness, then start it again.
) else (
  echo [!] The link repair reported a problem. Read the lines above.
)
echo.
pause
exit /b %RC%
