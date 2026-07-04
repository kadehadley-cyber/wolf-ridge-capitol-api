@echo off
rem Jarvis Desktop launcher (Windows). Double-click me.
rem Creates a venv on first run, installs dependencies, then starts the app.
cd /d "%~dp0"

rem This launcher only works next to its app files. A lone copy (dragged to the
rem Desktop, or pulled out of the ZIP without extracting the rest) lands here.
if not exist jarvis_desktop.py goto :lost
if not exist requirements.txt goto :lost

set PYCMD=python
where py >nul 2>nul
if %errorlevel%==0 set PYCMD=py -3

rem A fresh Windows resolves `python` to the Microsoft Store stub, which is not
rem a real interpreter - verify we can actually run Python before going further.
%PYCMD% --version >nul 2>nul
if errorlevel 1 (
    echo Python 3 is required but wasn't found.
    echo Install it from https://python.org ^(tick "Add python.exe to PATH"^),
    echo then double-click me again.
    pause
    exit /b 1
)

rem The stamp file is written only after a *successful* install, so a half-done
rem first run (network hiccup mid-pip) retries instead of wedging forever.
if not exist .venv\.deps-ok (
    if not exist .venv (
        echo Creating virtual environment ^(first run only^)...
        %PYCMD% -m venv .venv
        if errorlevel 1 goto :fail
    )
    .venv\Scripts\python.exe -m pip install --upgrade pip >nul
    echo Installing dependencies ^(this takes a minute^)...
    .venv\Scripts\python.exe -m pip install -r requirements.txt
    if errorlevel 1 goto :fail
    type nul > .venv\.deps-ok
)

.venv\Scripts\python.exe jarvis_desktop.py %*
pause
exit /b 0

:lost
echo This launcher must stay in the repo's desktop folder, next to
echo jarvis_desktop.py and requirements.txt - this copy is on its own.
echo.
echo Get the whole project from GitHub ^(Code ^> Download ZIP, then Extract All^)
echo and double-click Jarvis.bat inside its desktop folder.
echo.
echo To launch from your Desktop, don't copy this file - right-click it and
echo choose "Send to - Desktop (create shortcut)" instead.
pause
exit /b 1

:fail
echo.
echo Setup didn't finish - check the messages above ^(often just a network hiccup^).
echo Double-click me again to retry.
pause
exit /b 1
