@echo off
setlocal
title SB Overlays
cd /d "%~dp0"

echo.
echo   ===============================
echo          SB Overlays launcher
echo   ===============================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [!] Node.js is not installed.
  echo       Download the LTS version from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\ws" (
  echo   Installing dependencies ^(first run only^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   [!] npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
  echo.
)

rem Read PORT from .env if set, otherwise 3000
set "PORT=3000"
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="PORT" if not "%%B"=="" set "PORT=%%B"
  )
)

rem Open the control panel once the server has had a moment to start
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start "" http://localhost:%PORT%/control"

echo   Keep this window open while streaming. Close it to stop the overlay.
echo.
node --env-file-if-exists=.env server.js

echo.
echo   Server stopped.
pause
