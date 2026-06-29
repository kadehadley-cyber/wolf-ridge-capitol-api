#!/usr/bin/env bash
# Quick check that the microphone and speaker work before blaming Jarvis.
set -euo pipefail

echo "Recording 3 seconds — say something now…"
arecord -d 3 -f cd /tmp/jarvis_mic_test.wav
echo "Playing it back…"
aplay /tmp/jarvis_mic_test.wav
echo "Now a synthesised voice line…"
espeak-ng "Jarvis audio test complete." 2>/dev/null || echo "(espeak-ng not installed)"
echo
echo "Heard your recording played back + the voice line? Audio is good."
echo "If not: check  System ▸ alsamixer  levels, and  python3 jarvis_pi.py --list-audio"
