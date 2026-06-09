@echo off
rem Launcher for the Jarvis Windows voice client.
rem Creates a local virtualenv on first run, installs deps, then starts Jarvis.
rem Any arguments are passed through, e.g.  jarvis.bat --direct
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Setting up Jarvis ^(one-time^)...
  python -m venv .venv || (echo Could not create venv. Is Python installed and on PATH? & exit /b 1)
  call ".venv\Scripts\activate.bat"
  python -m pip install --quiet --upgrade pip
  python -m pip install --quiet -r requirements.txt
) else (
  call ".venv\Scripts\activate.bat"
)

python jarvis_win.py %*
endlocal
