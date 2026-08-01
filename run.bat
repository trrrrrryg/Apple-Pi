@echo off
REM ============================================================
REM  Pi Desktop Agent - Launcher
REM  Double-click to start the desktop Agent (Electron + SDK)
REM ============================================================
setlocal EnableDelayedExpansion
title Pi Desktop Agent

set "ROOT=%~dp0"
set "APP_DIR=%ROOT%app"

echo.
echo  ==========================================
echo   Pi Desktop Agent starting...
echo  ==========================================
echo.

REM ---------- 1. Check Node.js ----------
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js LTS first:
    echo         https://nodejs.org/
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node --version') do set "NODE_VER=%%v"
echo [OK] Node.js %NODE_VER%

REM ---------- 2. Check app directory ----------
if not exist "%APP_DIR%\" (
    echo [ERROR] app directory not found: %APP_DIR%
    pause
    exit /b 1
)

pushd "%APP_DIR%"

REM ---------- 3. Check / install dependencies ----------
if not exist "node_modules\@earendil-works\pi-coding-agent\" (
    echo [*] First run, installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed. Check your network and retry.
        popd
        pause
        exit /b 1
    )
)
echo [OK] Dependencies ready

REM ---------- 4. Check / download Electron binary ----------
if not exist "node_modules\electron\dist\electron.exe" (
    echo [*] Downloading Electron binary...
    set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
    node node_modules\electron\install.js
    if not exist "node_modules\electron\dist\electron.exe" (
        echo [ERROR] Electron binary download failed. Check network and retry.
        popd
        pause
        exit /b 1
    )
)
echo [OK] Electron ready

REM ---------- 5. Remind model credential ----------
echo.
echo  Note: make sure at least one LLM credential is configured
echo        (e.g. OPENAI_API_KEY / ANTHROPIC_API_KEY / DeepSeek env var,
echo         or existing login state under ~/.pi/agent/)
echo.

REM ---------- 6. Launch ----------
echo [OK] Launching Pi Desktop Agent ...
echo.
"node_modules\electron\dist\electron.exe" .

set "EXIT_CODE=%ERRORLEVEL%"
popd

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [INFO] App exited with code: %EXIT_CODE%
    pause
)
endlocal
