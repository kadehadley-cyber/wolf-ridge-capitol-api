# Jarvis Desktop — turn your computer into J.A.R.V.I.S.

Double-click to launch: a window opens with the animated **arc-reactor HUD**, and
Jarvis starts listening for **"Hey Jarvis"**. It hears you (local Whisper), thinks
with your Cloudflare Worker (the same brain, tools, and long-term memory as every
other Jarvis surface), speaks the answer, and the HUD reacts through
STANDBY → LISTENING → PROCESSING → SPEAKING as you talk.

```
"Hey Jarvis…" ─▶ Whisper (on-device) ─▶ Worker (Claude + tools + memory) ─▶ spoken reply + HUD
```

## What it can do

Everything the brain can — time, weather, exact math, unit conversions, durable
memory, reminders — plus the newer powers:

| You say | What happens |
| --- | --- |
| "directions to the airport" | Keyless routing: distance + drive time (from your saved home, or any origin). |
| "what's on my screen?" | Screenshot → Claude vision → Jarvis describes/identifies it. |
| "what am I looking at?" | Webcam frame (if OpenCV installed), else the screen. |
| "turn off the lab lights" / "open the mask" | Home Assistant control, when configured on the Worker. |
| "open mask" (named device) | Fires the matching device webhook (`JARVIS_DEVICES`), for DIY hardware. |

## Setup

1. Install **Python 3.9+** ([python.org](https://python.org); on Windows tick *Add to PATH*).
2. Launch **from inside this folder** — the launcher needs its sibling files:
   - **Windows:** double-click **`Jarvis.bat`**. Want it on your Desktop?
     Right-click → *Send to → Desktop (create shortcut)* — don't copy the file out.
   - **macOS / Linux:** run **`./jarvis`** (or double-click it in Finder after `chmod +x jarvis`)
3. First run asks for your Worker URL + `JARVIS_API_KEY` once and saves them to
   `~/.jarvis/desktop.json`. It also downloads the Whisper + wake-word models.
4. Grant **microphone** (and, for `--push` on macOS, screen-recording if you use
   screen identification) permissions when prompted.

## Modes & flags

| Command | What it does |
| --- | --- |
| *(default)* | HUD window + "Hey Jarvis" wake word. |
| `--push` | Push-to-talk in the console (Enter to start/stop) — use from a terminal. |
| `--auto` | Hands-free voice-activity detection (no wake word). |
| `--no-hud` | Voice only; no window. |
| `--text "…"` | One typed turn, spoken back, then exit. |

## Configuration

Environment variables override `~/.jarvis/desktop.json`:

| Variable | Default | Notes |
| --- | --- | --- |
| `JARVIS_URL` | *(saved)* | Your Worker's `/jarvis` endpoint. |
| `JARVIS_API_KEY` | *(saved)* | Bearer token, if the Worker has one set. |
| `JARVIS_SESSION` | `desktop` | Memory bucket for this machine. |
| `JARVIS_VOICE` | platform default | macOS: e.g. `Allison (Enhanced)`; Windows: a SAPI voice name; Linux: use `PIPER_BIN`/`PIPER_MODEL`. |
| `WHISPER_MODEL` | `base.en` | `tiny.en` faster / `small.en` more accurate. |
| `JARVIS_HUD_PORT` | `8090` | Local port for the HUD + `/state`. |
| `JARVIS_WAKE_THRESHOLD` | `0.5` | Lower = more sensitive wake word. |
| `JARVIS_INPUT_DEVICE` | system default | Microphone, by index or name substring (e.g. `MacBook`). |
| `JARVIS_WAKE_DEBUG` | off | `1` prints a once-a-second wake score + mic level readout. |

## Troubleshooting: "Hey Jarvis" doesn't trigger

Run from a terminal with the debug readout on:

```bash
JARVIS_WAKE_DEBUG=1 ./jarvis        # Windows: set JARVIS_WAKE_DEBUG=1 && Jarvis.bat
```

Watch the `[wake]` lines while you say "Hey Jarvis", then read it like this:

- **`mic level` stays near 0.00** — the app is listening to the wrong (or a
  muted) microphone. The startup log prints `Microphone: <name>`; pick the
  right one with `JARVIS_INPUT_DEVICE` (name substring like `MacBook`, or an
  index from `python3 -c "import sounddevice as sd; print(sd.query_devices())"`).
- **level moves but `peak score` stays low (< 0.3)** — the model can't hear
  you well: get closer, speak "Hey Jarvis" as two clear words, or lower the
  bar with `JARVIS_WAKE_THRESHOLD=0.35`.
- **score spikes ≥ threshold but nothing happens** — that's a bug; share the
  terminal output.

Also make sure only **one** copy of the app is running — a second instance
prints `HUD server couldn't start (Address already in use)` and the window
you're looking at belongs to the old one.

## Smart home & the suit

Device control lives on the **Worker** (so every surface shares it):

- **Home Assistant** — set the `HOME_ASSISTANT_URL` (your Nabu Casa or tunnel
  https URL) and `HOME_ASSISTANT_TOKEN` secrets on the Worker, and Jarvis gains
  `control_home`: lights, switches, locks, and covers. A helmet/mask rigged as a
  `cover` entity (ESPHome + a servo) makes *"Jarvis, open the mask"* literal.
- **Named device webhooks** — set `JARVIS_DEVICES` on the Worker, e.g.
  `{"open mask":"https://helmet.example.com/open","close mask":"https://helmet.example.com/close"}`
  and Jarvis gains `trigger_device`. Point each URL at your hardware (an ESP32
  web server). The Worker runs in the cloud, so URLs must be reachable from the
  internet — a **Cloudflare Tunnel** to your LAN is the clean way.

## Notes

- The HUD window needs `pywebview`; without it the HUD opens in your default
  browser instead. Both are fine.
- Wake word needs `openwakeword`; without it the app falls back to push-to-talk.
- Screen identification sends a **downscaled JPEG of your screen to the Worker →
  Anthropic** — same trust as anything else you tell Jarvis, but worth knowing.
- macOS will ask for **Screen Recording** permission the first time you use
  "what's on my screen".
