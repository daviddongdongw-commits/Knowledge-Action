@echo off
chcp 65001 >nul
cd /d "%~dp0"
title ZhiXing

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo First run: installing dependencies, please wait...
  call npm ci --registry=https://registry.npmmirror.com
  if errorlevel 1 (
    echo.
    echo [ERROR] Dependency installation failed. Please check your network.
    pause
    exit /b 1
  )
  echo Dependencies installed.
  echo.
)

echo Cleaning up leftover service processes...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 :3001" ^| findstr LISTENING') do (
  taskkill /F /T /PID %%a >nul 2>&1
)
ping -n 3 127.0.0.1 >nul

node dev.mjs
pause
