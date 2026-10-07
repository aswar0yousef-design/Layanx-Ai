@echo off
rem Double-click to start LayanX. First run installs what is missing.
setlocal
title LayanX
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\start.ps1" %*
endlocal
