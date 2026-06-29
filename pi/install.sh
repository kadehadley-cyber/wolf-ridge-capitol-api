#!/usr/bin/env bash
#
# Jarvis Pi installer — run once on a fresh Raspberry Pi OS Lite (64-bit).
#
# It installs system + Python dependencies, downloads the wake-word and speech
# models, sets up the Piper neural voice (falling back to espeak-ng if that
# isn't available for your Pi), writes /etc/jarvis/jarvis.conf, and installs a
# systemd service so Jarvis starts on boot and restarts if it ever crashes.
#
#   cd pi && ./install.sh
#
# Non-interactive (e.g. for imaging): pre-set the env vars and run:
#   sudo JARVIS_URL=https://you.workers.dev/jarvis JARVIS_API_KEY=... ./install.sh
#
set -euo pipefail

# --- Must run as root; re-exec under sudo if not (keeps $SUDO_USER set). ------
if [ "$(id -u)" -ne 0 ]; then
	exec sudo --preserve-env=JARVIS_URL,JARVIS_API_KEY bash "$0" "$@"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_USER="${SUDO_USER:-${JARVIS_USER:-pi}}"
if ! id -u "$TARGET_USER" >/dev/null 2>&1; then
	TARGET_USER="$(id -un)"
fi

APP_DIR="/opt/jarvis"
CONF_DIR="/etc/jarvis"
VOICE="en_GB-alan-medium"
PIPER_VERSION="2023.11.14-2"
TTS_MODE="piper"

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }

say "Installing Jarvis for user '$TARGET_USER'."

# --- 1. System packages ------------------------------------------------------
say "Installing system packages (this can take a few minutes)…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y \
	python3 python3-venv python3-dev \
	libportaudio2 portaudio19-dev libsndfile1 \
	alsa-utils espeak-ng \
	curl ca-certificates

# --- 2. App directory + Python virtualenv ------------------------------------
say "Setting up $APP_DIR and the Python environment…"
mkdir -p "$APP_DIR" "$APP_DIR/voices"
install -m 0644 "$SCRIPT_DIR/jarvis_pi.py" "$APP_DIR/jarvis_pi.py"
install -m 0644 "$SCRIPT_DIR/requirements.txt" "$APP_DIR/requirements.txt"
install -m 0755 "$SCRIPT_DIR/test-audio.sh" "$APP_DIR/test-audio.sh" 2>/dev/null || true
rm -rf "$APP_DIR/hud"
cp -r "$SCRIPT_DIR/hud" "$APP_DIR/hud"
chown -R "$TARGET_USER":"$TARGET_USER" "$APP_DIR"

sudo -u "$TARGET_USER" python3 -m venv "$APP_DIR/venv"
sudo -u "$TARGET_USER" "$APP_DIR/venv/bin/pip" install --upgrade pip wheel
sudo -u "$TARGET_USER" "$APP_DIR/venv/bin/pip" install -r "$APP_DIR/requirements.txt"

# --- 3. Pre-download models (so first boot is fast and works offline) --------
say "Downloading the wake-word models…"
sudo -u "$TARGET_USER" "$APP_DIR/venv/bin/python" - <<'PY' || warn "Wake-word model download failed; it will retry at first run."
import openwakeword.utils as u
u.download_models()
PY

say "Downloading the speech-to-text model (tiny.en)…"
sudo -u "$TARGET_USER" "$APP_DIR/venv/bin/python" - <<'PY' || warn "Whisper model download failed; it will retry at first run."
from faster_whisper import WhisperModel
WhisperModel("tiny.en", device="cpu", compute_type="int8")
PY

# --- 4. Piper neural voice (best-effort; espeak-ng is the fallback) ----------
say "Setting up the Piper voice…"
case "$(uname -m)" in
	aarch64 | arm64) PIPER_ARCH="aarch64" ;;
	armv7l | armhf) PIPER_ARCH="armv7l" ;;
	x86_64) PIPER_ARCH="x86_64" ;;
	*) PIPER_ARCH="" ;;
esac

piper_ok=false
if [ -n "$PIPER_ARCH" ]; then
	PIPER_URL="https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_${PIPER_ARCH}.tar.gz"
	VOICE_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium"
	if curl -fsSL "$PIPER_URL" -o /tmp/piper.tar.gz &&
		tar -xzf /tmp/piper.tar.gz -C "$APP_DIR" &&
		curl -fsSL "$VOICE_BASE/${VOICE}.onnx" -o "$APP_DIR/voices/${VOICE}.onnx" &&
		curl -fsSL "$VOICE_BASE/${VOICE}.onnx.json" -o "$APP_DIR/voices/${VOICE}.onnx.json"; then
		chown -R "$TARGET_USER":"$TARGET_USER" "$APP_DIR/piper" "$APP_DIR/voices"
		piper_ok=true
	fi
fi
if [ "$piper_ok" != true ]; then
	warn "Couldn't set up Piper — falling back to the espeak-ng voice."
	TTS_MODE="espeak"
fi

# --- 5. Configuration --------------------------------------------------------
say "Writing $CONF_DIR/jarvis.conf…"
JARVIS_URL="${JARVIS_URL:-}"
JARVIS_API_KEY="${JARVIS_API_KEY:-}"
if [ -z "$JARVIS_URL" ] && [ -r /dev/tty ]; then
	read -r -p "  Worker /jarvis URL (https://…/jarvis): " JARVIS_URL </dev/tty || true
fi
if [ -z "$JARVIS_API_KEY" ] && [ -r /dev/tty ]; then
	read -r -s -p "  JARVIS_API_KEY (blank if the Worker has none): " JARVIS_API_KEY </dev/tty || true
	echo
fi
: "${JARVIS_URL:=https://YOUR-WORKER.workers.dev/jarvis}"

mkdir -p "$CONF_DIR"
cat >"$CONF_DIR/jarvis.conf" <<EOF
# Jarvis Pi configuration (written by install.sh). Edit, then:
#   sudo systemctl restart jarvis
JARVIS_URL=${JARVIS_URL}
JARVIS_API_KEY=${JARVIS_API_KEY}
JARVIS_SESSION=pi

WHISPER_MODEL=tiny.en

JARVIS_WAKE_WORD=hey_jarvis
JARVIS_WAKE_THRESHOLD=0.5

JARVIS_TTS=${TTS_MODE}
PIPER_BIN=${APP_DIR}/piper/piper
PIPER_MODEL=${APP_DIR}/voices/${VOICE}.onnx
ESPEAK_VOICE=en-gb

JARVIS_GREETING=Jarvis online.
JARVIS_INPUT_DEVICE=

JARVIS_HUD=on
JARVIS_HUD_HOST=127.0.0.1
JARVIS_HUD_PORT=8088
EOF
chmod 600 "$CONF_DIR/jarvis.conf"

# --- 6. systemd service ------------------------------------------------------
say "Installing the systemd service…"
sed "s/__USER__/${TARGET_USER}/" "$SCRIPT_DIR/jarvis.service" >/etc/systemd/system/jarvis.service
systemctl daemon-reload
systemctl enable jarvis.service
systemctl restart jarvis.service

# --- 7. Full-screen HUD kiosk (best-effort; the HUD also works in any browser)
setup_kiosk=false
if [ "${JARVIS_KIOSK:-}" = "1" ]; then
	setup_kiosk=true
elif [ "${JARVIS_KIOSK:-}" != "0" ] && [ -r /dev/tty ]; then
	read -r -p "  Launch the full-screen JARVIS HUD on a connected screen at boot? [Y/n] " ans </dev/tty || ans=""
	case "$ans" in [Nn]*) setup_kiosk=false ;; *) setup_kiosk=true ;; esac
fi

if [ "$setup_kiosk" = true ]; then
	say "Setting up the full-screen HUD kiosk (Cage + Chromium)…"
	if apt-get install -y cage chromium-browser; then
		BROWSER="$(command -v chromium-browser || command -v chromium || echo /usr/bin/chromium-browser)"
		sed -e "s/__USER__/${TARGET_USER}/" -e "s#__BROWSER__#${BROWSER}#" \
			"$SCRIPT_DIR/jarvis-hud.service" >/etc/systemd/system/jarvis-hud.service
		usermod -aG video,render,input,tty "$TARGET_USER" 2>/dev/null || true
		systemctl daemon-reload
		systemctl enable jarvis-hud.service
		systemctl restart jarvis-hud.service || warn "HUD kiosk didn't start — check: journalctl -u jarvis-hud"
	else
		warn "Couldn't install cage/chromium. The HUD is still served at http://localhost:8088 — open it in any browser, or see pi/README.md for the desktop-OS kiosk path."
	fi
fi

say "Done. Jarvis is installed and will start on every boot."
cat <<EOF

  Watch it live:     journalctl -u jarvis -f
  HUD (any browser): http://<this-pi-ip>:8088   (set JARVIS_HUD_HOST=0.0.0.0 to view from another device)
  Restart it:        sudo systemctl restart jarvis
  Edit settings:     sudo nano /etc/jarvis/jarvis.conf   (then restart)
  Test audio:        $APP_DIR/test-audio.sh
  Quick brain test:  sudo -u $TARGET_USER $APP_DIR/venv/bin/python $APP_DIR/jarvis_pi.py --text "what time is it?"

  Then just say:  “Hey Jarvis … what's the weather?”
EOF
