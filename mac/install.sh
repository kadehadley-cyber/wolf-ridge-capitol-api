#!/usr/bin/env bash
# One-shot setup for the standalone Jarvis Mac assistant.
#   1. Creates a Python virtualenv and installs dependencies.
#   2. Saves your Anthropic API key to ~/.jarvis/anthropic_api_key (so the
#      double-click app works without a shell environment).
#   3. Builds Jarvis.app into ~/Applications.
#
# Run it once:  cd mac && ./install.sh
set -euo pipefail

cd "$(dirname "$0")"

echo "→ Setting up the Python environment…"
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
echo "  done."

# --- API key -------------------------------------------------------------- #
STATE_DIR="$HOME/.jarvis"
KEY_FILE="$STATE_DIR/anthropic_api_key"
mkdir -p "$STATE_DIR"

if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  printf '%s' "$ANTHROPIC_API_KEY" > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  echo "→ Saved your ANTHROPIC_API_KEY from the environment."
elif [[ -s "$KEY_FILE" ]]; then
  echo "→ Using the API key already saved at $KEY_FILE."
else
  echo "→ Jarvis talks to Claude. Paste your Anthropic API key (input hidden),"
  echo "  or press Enter to skip and set ANTHROPIC_API_KEY later."
  read -rs -p "  API key: " key
  echo
  if [[ -n "$key" ]]; then
    printf '%s' "$key" > "$KEY_FILE"
    chmod 600 "$KEY_FILE"
    echo "  saved to $KEY_FILE."
  else
    echo "  skipped — set ANTHROPIC_API_KEY before launching."
  fi
fi

# --- App bundle ----------------------------------------------------------- #
echo "→ Building Jarvis.app…"
./make-app.sh >/dev/null
echo "  installed to ~/Applications/Jarvis.app"

cat <<'DONE'

✅ All set. Three ways to start Jarvis:
   • Open Jarvis.app from Spotlight / your Dock
   • Double-click mac/Jarvis.command in Finder
   • Run ./jarvis --direct in this folder

First launch only: if macOS says "Jarvis can't be opened because the developer
cannot be verified", right-click Jarvis.app -> Open, then click Open. Once.

Press Enter to speak, Enter again to stop, Ctrl-C to quit.
Say "Jarvis, start over" to wipe its memory.
DONE
