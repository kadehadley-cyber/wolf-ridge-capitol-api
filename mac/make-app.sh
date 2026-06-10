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
if [ ! -x "\$MAC_DIR/jarvis" ]; then
  # The app is a thin launcher into the repo checkout; if that moved or was
  # deleted, explain instead of flashing a cryptic Terminal error.
  osascript -e "display alert \"Jarvis\" message \"Can't find the Jarvis files at \$MAC_DIR — the repo may have been moved or deleted. Run mac/install.sh (or mac/make-app.sh) from its new location to rebuild this app.\""
  exit 1
fi
osascript <<OSA
tell application "Terminal"
  activate
  do script "cd " & quoted form of "\$MAC_DIR" & " && ./jarvis --direct"
end tell
OSA
LAUNCH

chmod +x "$APP/Contents/MacOS/Jarvis"

# Tell LaunchServices this is a real application bundle.
printf 'APPL????' > "$APP/Contents/PkgInfo"

# A hand-built bundle is unsigned, so Gatekeeper can refuse to open it ("Jarvis
# cannot be opened because the developer cannot be verified") or just bounce it
# in the Dock and quit. We build it locally, so it's safe to strip any inherited
# quarantine flag and give it an ad-hoc signature so the system treats it as a
# valid bundle. Both are best-effort — skip quietly if the tools aren't present.
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
codesign --force --deep --sign - "$APP" 2>/dev/null || true

# Register the bundle so a double-click finds it immediately.
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"
[ -x "$LSREGISTER" ] && "$LSREGISTER" -f "$APP" 2>/dev/null || true

echo "✅ Built $APP"
echo "   Open it from Finder/Spotlight, or drag it into your Dock."
echo "   First launch: if macOS says the developer can't be verified,"
echo "   right-click the app and choose Open, then click Open in the dialog."
