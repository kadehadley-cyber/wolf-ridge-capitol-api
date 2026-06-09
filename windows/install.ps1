# One-shot setup for the standalone Jarvis Windows assistant.
#   1. Creates a Python virtualenv and installs dependencies.
#   2. Saves your Anthropic API key to %USERPROFILE%\.jarvis\anthropic_api_key
#      (so the shortcut works without a shell environment).
#   3. Creates a "Jarvis" shortcut on your Desktop.
#
# Run it once from PowerShell:
#   cd windows
#   powershell -ExecutionPolicy Bypass -File .\install.ps1

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Write-Host "-> Setting up the Python environment..."
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    python -m venv .venv
}
& ".venv\Scripts\python.exe" -m pip install --quiet --upgrade pip
& ".venv\Scripts\python.exe" -m pip install --quiet -r requirements.txt
Write-Host "   done."

# --- API key -------------------------------------------------------------- #
$stateDir = Join-Path $env:USERPROFILE ".jarvis"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$keyFile = Join-Path $stateDir "anthropic_api_key"

if ($env:ANTHROPIC_API_KEY) {
    Set-Content -Path $keyFile -Value $env:ANTHROPIC_API_KEY -NoNewline -Encoding ascii
    Write-Host "-> Saved your ANTHROPIC_API_KEY from the environment."
}
elseif ((Test-Path $keyFile) -and ((Get-Item $keyFile).Length -gt 0)) {
    Write-Host "-> Using the API key already saved at $keyFile."
}
else {
    Write-Host "-> Jarvis talks to Claude. Paste your Anthropic API key (hidden),"
    Write-Host "   or press Enter to skip and set ANTHROPIC_API_KEY later."
    $sec = Read-Host "   API key" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    if ($plain) {
        Set-Content -Path $keyFile -Value $plain -NoNewline -Encoding ascii
        Write-Host "   saved to $keyFile."
    }
    else {
        Write-Host "   skipped - set ANTHROPIC_API_KEY before launching."
    }
}

# --- Desktop shortcut ----------------------------------------------------- #
Write-Host "-> Creating a 'Jarvis' shortcut on your Desktop..."
$bat = Join-Path $here "jarvis.bat"
$desktop = [Environment]::GetFolderPath("Desktop")
$lnk = Join-Path $desktop "Jarvis.lnk"
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath = $bat
$sc.Arguments = "--direct"
$sc.WorkingDirectory = $here
$sc.IconLocation = "powershell.exe, 0"
$sc.Description = "Jarvis voice assistant"
$sc.Save()
Write-Host "   done: $lnk"

Write-Host ""
Write-Host "All set. Start Jarvis by:"
Write-Host "  - Double-clicking the Jarvis shortcut on your Desktop"
Write-Host "  - Or running  .\jarvis.bat --direct  in this folder"
Write-Host ""
Write-Host 'Press Enter to speak, Enter again to stop, Ctrl-C to quit.'
Write-Host 'Say "Jarvis, start over" to wipe its memory.'
