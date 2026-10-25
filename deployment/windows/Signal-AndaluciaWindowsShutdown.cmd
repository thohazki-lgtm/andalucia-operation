@echo off
setlocal
set "PROJECT_ROOT=%~dp0..\.."
set "CONTROL_ROOT=%PROJECT_ROOT%\.backups\.db2\scheduler\control"
set "SIGNAL_PATH=%CONTROL_ROOT%\windows-shutdown.signal"
set "TEMP_PATH=%CONTROL_ROOT%\.windows-shutdown.signal.tmp"

if not exist "%CONTROL_ROOT%" mkdir "%CONTROL_ROOT%" >nul 2>&1
>"%TEMP_PATH%" echo ANDALUCIA_WINDOWS_SHUTDOWN
move /y "%TEMP_PATH%" "%SIGNAL_PATH%" >nul
exit /b %errorlevel%
