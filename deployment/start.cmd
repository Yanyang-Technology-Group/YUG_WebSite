@echo off
setlocal
title Yanyang Government Portal
rem Use Windows modules even when launched from PowerShell 7 or bundled tools.
set "PSModulePath=%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0deployment\start.ps1" %*
if errorlevel 1 pause
