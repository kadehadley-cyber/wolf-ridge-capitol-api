#!/usr/bin/env bash
# Build a double-clickable Jarvis.app you can drop in your Dock or Applications.
#
# The app is a thin launcher: it opens Terminal and runs the standalone voice
# client (Claude direct, no Worker). Running inside Terminal means macOS asks
# Terminal — not a bare binary — for microphone permission, which sidesteps the
# code-signing/entitlement hassle of a raw command-line tool.
#
# Usage:
#   ./make-app.sh                 # installs to ~/Applications/Jarvis.app
#   ./make-app.sh /Applications   # installs there instead
set -euo pipefail

MAC_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="${1:-$HOME/Applications}"
APP="$DEST/Jarvis.app"

mkdir -p "$APP/Contents/MacOS"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>            <string>Jarvis</string>
  <key>CFBundleDisplayName</key>     <string>Jarvis</string>
  <key>CFBundleIdentifier</key>      <string>dev.jarvis.mac</string>
  <key>CFBundleVersion</key>         <string>1.0</string>
  <key>CFBundleShortVersionString</key> <string>1.0</string>
  <key>CFBundlePackageType</key>     <string>APPL</string>
  <key>CFBundleExecutable</key>      <string>Jarvis</string>
  <key>LSMinimumSystemVersion</key>  <string>11.0</string>
</dict>
</plist>
PLIST

# The launcher opens Terminal at the repo's mac/ dir and starts standalone Jarvis.
cat > "$APP/Contents/MacOS/Jarvis" <<LAUNCH
#!/bin/bash
MAC_DIR="$MAC_DIR"
osascript <<OSA
tell application "Terminal"
  activate
  do script "cd " & quoted form of "\$MAC_DIR" & " && ./jarvis --direct"
end tell
OSA
LAUNCH

chmod +x "$APP/Contents/MacOS/Jarvis"

echo "✅ Built $APP"
echo "   Open it from Finder/Spotlight, or drag it into your Dock."
