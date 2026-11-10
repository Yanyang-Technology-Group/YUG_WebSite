@echo off
setlocal
title Yanyang Government Portal - LAN
set "PSModulePath=%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0deployment\start.ps1" -Lan %*
if errorlevel 1 pause
