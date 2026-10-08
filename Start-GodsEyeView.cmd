@echo off
rem One-click start for Windows: double-click this file (or the desktop icon).
rem Installs what is missing, starts the server and opens the app.
title God's Eye View
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js 24 is required. Opening the download page...
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)
node scripts\launch.mjs %*
if errorlevel 1 pause
