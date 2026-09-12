@echo off
chcp 65001 >nul
title HyperShare - هایپرشیر
cd /d "%~dp0"
echo ========================================================
echo   در حال اجرای هایپرشیر برای کامپیوتر...
echo   HyperShare PC Launcher
echo ========================================================
HyperShare_PC.exe
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ❌ برنامه با خطا مواجه شد.
    pause
)
