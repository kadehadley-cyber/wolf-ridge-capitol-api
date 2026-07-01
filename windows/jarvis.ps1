# Jarvis launcher for Windows. Creates a virtualenv on first run, installs the
# dependencies, then starts the voice client. Any arguments are passed through.
#
#   powershell -ExecutionPolicy Bypass -File .\jarvis.ps1            # push-to-talk
#   powershell -ExecutionPolicy Bypass -File .\jarvis.ps1 --auto     # hands-free
#   powershell -ExecutionPolicy Bypass -File .\jarvis.ps1 --list-voices
#
# Set these first (this session), pointing at your deployed Worker:
#   $env:JARVIS_URL     = "https://<you>.workers.dev/jarvis"
#   $env:JARVIS_API_KEY = "<your key>"

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

# Find a Python launcher.
$py = if (Get-Command py -ErrorAction SilentlyContinue) { "py -3" }
      elseif (Get-Command python -ErrorAction SilentlyContinue) { "python" }
      else { Write-Error "Python 3 not found. Install it from https://python.org (tick 'Add to PATH')."; exit 1 }

$venv = Join-Path $PSScriptRoot ".venv"
if (-not (Test-Path $venv)) {
    Write-Host "Creating virtual environment..."
    Invoke-Expression "$py -m venv `"$venv`""
    & "$venv\Scripts\python.exe" -m pip install --upgrade pip | Out-Null
    Write-Host "Installing dependencies (first run only, this takes a minute)..."
    & "$venv\Scripts\python.exe" -m pip install -r (Join-Path $PSScriptRoot "requirements.txt")
}

& "$venv\Scripts\python.exe" (Join-Path $PSScriptRoot "jarvis_windows.py") @args
