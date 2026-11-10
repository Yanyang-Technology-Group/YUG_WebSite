@echo off
setlocal
title Stop Yanyang Government Portal
set "PSModulePath=%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0deployment\stop.ps1" %*
if errorlevel 1 pause
