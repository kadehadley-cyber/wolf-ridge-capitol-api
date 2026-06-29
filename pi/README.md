# Jarvis Pi — a "Hey Jarvis" appliance with the arc-reactor HUD

Turn a Raspberry Pi + mic + speaker (+ optional screen) into a dedicated,
always-on J.A.R.V.I.S. you just talk to. It shares the **same brain and
long-term memory** as the rest of your Jarvis — it calls the Cloudflare Worker —
so it knows you, your saved location, your reminders, and answers in character.

```
"Hey Jarvis"  ─▶  record  ─▶  Whisper (on-device)  ─▶  your Worker (Claude + memory)
                                                              │
        🔊 spoken reply (Piper)  ◀───────────────────────────┘
                  +  the animated arc-reactor HUD on screen
```

When a display is attached it boots full-screen into the **JARVIS HUD** — a
glowing arc-reactor interface whose rings spin and whose voice equalizer reacts
as it listens, thinks, and speaks. The HUD is `hud/index.html`; you can open it
in any browser to see it (it runs a self-demo when no device is connected).

## Hardware

- Raspberry Pi 4 or 5 (64-bit Raspberry Pi OS). A Pi 3 works but Whisper is slow.
- A USB microphone (or a ReSpeaker HAT). Built-in audio has no mic input.
- A speaker (USB, or 3.5 mm on a Pi 4 / a HAT — the Pi 5 has no headphone jack).
- Optional: any HDMI screen (or the official 7″ touchscreen) for the HUD.

## Flash + first boot

1. In **Raspberry Pi Imager**, choose **Raspberry Pi OS Lite (64-bit)**. Under the
   gear/edit options, set your Wi-Fi, locale, a hostname (e.g. `jarvis`), and
   enable SSH. Flash the SD card and boot the Pi.
2. SSH in (`ssh <user>@jarvis.local`) and get this repo:
   ```bash
   sudo apt-get update && sudo apt-get install -y git
   git clone https://github.com/kadehadley-cyber/wolf-ridge-capitol-api.git
   cd wolf-ridge-capitol-api/pi
   ```
3. Run the installer. It asks for your Worker URL and API key, installs
   everything, downloads the models + voice, and sets up the boot services:
   ```bash
   ./install.sh
   ```
   When it asks for the **Worker URL**, give your `/jarvis` endpoint, e.g.
   `https://wolf-ridge-capitol-api.kade-hadley.workers.dev/jarvis`, and paste your
   `JARVIS_API_KEY`. (Non-interactive: `sudo JARVIS_URL=… JARVIS_API_KEY=… ./install.sh`.)

That's it — Jarvis now starts on every boot. Say **"Hey Jarvis, what's the weather?"**

## What the installer sets up

| Piece | Where |
| --- | --- |
| Voice service (auto-starts on boot, restarts on failure) | `systemd: jarvis.service` |
| Full-screen HUD kiosk (Cage + Chromium) | `systemd: jarvis-hud.service` |
| App + virtualenv + models + Piper voice | `/opt/jarvis/` |
| Settings | `/etc/jarvis/jarvis.conf` |

## Day-to-day

```bash
journalctl -u jarvis -f          # watch the voice loop live
sudo systemctl restart jarvis    # after editing settings
sudo nano /etc/jarvis/jarvis.conf
/opt/jarvis/test-audio.sh        # confirm mic + speaker
# Type a turn instead of speaking (great for testing the brain + voice):
sudo -u <user> /opt/jarvis/venv/bin/python /opt/jarvis/jarvis_pi.py --text "what time is it?"
```

View the HUD from another device on your network: set `JARVIS_HUD_HOST=0.0.0.0`
in the config, restart, then open `http://<pi-ip>:8088`.

## Configuration (`/etc/jarvis/jarvis.conf`)

| Key | Default | Notes |
| --- | --- | --- |
| `JARVIS_URL` | — | Your Worker's `/jarvis` endpoint (the shared brain + memory). |
| `JARVIS_API_KEY` | — | Bearer token, if your Worker has `JARVIS_API_KEY` set. |
| `JARVIS_SESSION` | `pi` | Memory bucket for this device. |
| `WHISPER_MODEL` | `tiny.en` | `base.en` is more accurate but slower on a Pi. |
| `JARVIS_WAKE_WORD` | `hey_jarvis` | Set `off` to listen continuously (not recommended). |
| `JARVIS_WAKE_THRESHOLD` | `0.5` | Lower = more sensitive (more false triggers). |
| `JARVIS_TTS` | `piper` | `piper` (neural) or `espeak`. |
| `JARVIS_HUD` | `on` | `off` for a headless (no screen) box. |
| `JARVIS_HUD_PORT` | `8088` | Where the HUD + `/state` are served. |
| `JARVIS_INPUT_DEVICE` | (default) | Index from `jarvis_pi.py --list-audio` if the wrong mic is picked. |

## Getting the HUD on a screen

The installer offers to set up a **Cage + Chromium** kiosk (works on Raspberry Pi
OS *Lite* — no full desktop needed). If you skipped it or it didn't take:

- **Re-run kiosk setup:** `sudo JARVIS_KIOSK=1 ./install.sh`
- **On Raspberry Pi OS *with Desktop*:** add an autostart entry instead —
  `chromium-browser --kiosk --app=http://127.0.0.1:8088` in
  `~/.config/lxsession/LXDE-pi/autostart` (or `~/.config/wayfire.ini`).
- **Any screen, any time:** just open `http://localhost:8088` in a browser on the Pi.

## How it talks to the rest of Jarvis

The Pi is a thin client: it captures speech and plays replies, but the thinking,
tools (weather, math, reminders), and long-term memory all live in the Cloudflare
Worker. So anything you teach Jarvis here ("remember my home is American Fork") is
the same memory your Mac client and any other device see. Run `--direct` (and set
`ANTHROPIC_API_KEY`) only if you want a standalone Pi with no shared memory.

## Troubleshooting

- **"didn't catch that" / no response:** mic not captured. Run `test-audio.sh`;
  check `alsamixer` capture levels; set `JARVIS_INPUT_DEVICE` from `--list-audio`.
- **Wake word never triggers:** lower `JARVIS_WAKE_THRESHOLD` to `0.35`, or set
  `JARVIS_WAKE_WORD=off` to test with continuous listening.
- **No voice out:** confirm the speaker with `aplay`/`alsamixer`; if Piper failed
  to install, the config falls back to `JARVIS_TTS=espeak`.
- **HUD blank:** check `journalctl -u jarvis` shows "HUD online", and open
  `http://localhost:8088` directly; check `journalctl -u jarvis-hud` for the kiosk.
- **401/403 from the brain:** wrong/missing `JARVIS_API_KEY`, or Cloudflare blocked
  the request — the same notes as the Mac client in [`../mac/README.md`](../mac/README.md).
