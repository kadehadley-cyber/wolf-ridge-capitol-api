@echo off
rem Jarvis Desktop launcher (Windows). Double-click me.
rem Written without parenthesized blocks on purpose: a paren-block parse error
rem is the classic cause of a .bat that flashes a window and vanishes. Every
rem exit path here pauses, so you always get to read what happened.
setlocal
cd /d "%~dp0"

if not exist jarvis_desktop.py goto lost
if not exist requirements.txt goto lost

set "PYCMD=python"
where py >nul 2>nul && set "PYCMD=py -3"

rem Confirm a REAL Python answers (the Microsoft Store stub does not).
%PYCMD% -c "import sys" >nul 2>nul
if errorlevel 1 goto nopython

rem The stamp is a copy of requirements.txt written only after a successful
rem install: a half-done first run retries, and a changed requirements file
rem (new dependency in an update) reinstalls automatically.
fc /b requirements.txt ".venv\.deps-ok" >nul 2>nul && goto run
if exist ".venv\Scripts\python.exe" goto deps

echo Creating virtual environment (first run only)...
%PYCMD% -m venv .venv
if errorlevel 1 goto failsetup
if not exist ".venv\Scripts\python.exe" goto stub

:deps
".venv\Scripts\python.exe" -m pip install --upgrade pip
echo Installing dependencies. First run downloads a lot; give it a few minutes...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto failsetup
copy /y requirements.txt ".venv\.deps-ok" >nul

:run
".venv\Scripts\python.exe" jarvis_desktop.py %*
echo.
echo Jarvis has exited. Press any key to close this window.
pause >nul
exit /b 0

:nopython
echo.
echo Python 3 was not found, or Windows is intercepting "python" with the
echo Microsoft Store stub.
echo.
echo 1. Install real Python from https://www.python.org/downloads/
echo    and TICK "Add python.exe to PATH" in the installer.
echo 2. Turn off the Store stub: open Settings, search "app execution aliases",
echo    and switch OFF App Installer for "python.exe" and "python3.exe".
echo 3. Then double-click me again.
echo.
pause
exit /b 1

:stub
echo.
echo The virtual environment was not created - "python" is almost certainly the
echo Microsoft Store stub. Fix it the same way:
echo   Settings, search "app execution aliases", switch OFF "python.exe" and
echo   "python3.exe" - then install real Python from https://www.python.org
echo.
pause
exit /b 1

:lost
echo.
echo This launcher must stay next to jarvis_desktop.py and requirements.txt.
echo Extract the WHOLE zip first: right-click the .zip, Extract All. Then open
echo the Jarvis\desktop folder and double-click Jarvis.bat inside it.
echo.
pause
exit /b 1

:failsetup
echo.
echo Setup did not finish - see the messages above. This is usually a network
echo hiccup during the download; just run me again to retry where it left off.
echo.
pause
exit /b 1
