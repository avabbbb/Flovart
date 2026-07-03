@echo off
cd /d "%~dp0"
if not exist "FlovartLauncher.exe" (
  echo [Flovart] FlovartLauncher.exe is missing. Building it now...
  powershell -NoProfile -ExecutionPolicy Bypass -File "tools\launcher\build-launcher.ps1"
  if errorlevel 1 (
    echo [Flovart] Failed to build launcher. Check the logs above.
    pause
    exit /b 1
  )
)
start "" "%~dp0FlovartLauncher.exe"