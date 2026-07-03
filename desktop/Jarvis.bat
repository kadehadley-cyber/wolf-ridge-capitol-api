@echo off
rem Jarvis Desktop launcher (Windows). Double-click me.
rem Creates a venv on first run, installs dependencies, then starts the app.
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (set PYCMD=py -3) else (set PYCMD=python)

if not exist .venv (
    echo Creating virtual environment ^(first run only^)...
    %PYCMD% -m venv .venv
    .venv\Scripts\python.exe -m pip install --upgrade pip >nul
    echo Installing dependencies ^(this takes a minute^)...
    .venv\Scripts\python.exe -m pip install -r requirements.txt
)

.venv\Scripts\python.exe jarvis_desktop.py %*
pause
