@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [Flovart] Node.js 20+ is required: https://nodejs.org
  pause
  exit /b 1
)

if "%~1"=="" (
  node tools\flovart\cli.js tui
) else (
  node tools\flovart\cli.js %*
)

if errorlevel 1 (
  echo.
  echo [Flovart] Command failed. Check the logs above.
  pause
)
endlocal