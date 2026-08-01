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

### Run your PC by voice (local, instant, offline)

These are handled on-device — no round-trip to the brain — so they're
immediate, and they work even offline:

| You say | What happens |
| --- | --- |
| "open Chrome" / "open Notepad" / "open Spotify" / "open weather.com" | Launches the app or site. |
| "search the web for the F1 standings" | Opens the search in your browser. |
| "take a screenshot" | Saves a PNG to your Pictures folder. |
| "volume up / down", "mute", "pause", "next track" | Media & volume keys. |
| "lock the computer" | Locks Windows. |

Anything not in that short list still goes to the brain, so "open the mask"
reaches Home Assistant while "open Notepad" opens Notepad.

**Conversation window.** After Jarvis answers, it keeps listening for a few
seconds so you can follow up **without** saying "Hey Jarvis" again — ask a
question, then just say "and tomorrow?". Tune with `JARVIS_FOLLOWUP` (seconds;
`0` disables).

### Google Home / Nest speakers

Jarvis can talk **through** your Google Home and Nest speakers — in his own
voice — over your local network. No Google account, no keys; the PC just needs
to be on the same Wi-Fi (`pychromecast` is installed with the app).

| You say | What happens |
| --- | --- |
| "broadcast dinner is ready" / "announce the car is here" | Plays on **every** speaker, in Jarvis's voice. |
| "announce ten minutes on the kitchen speaker" | Targets one speaker by name. |
| "list speakers" | Names the Cast devices it can see. |

**Controlling Google Home *devices* (lights, plugs, TVs).** Google has no
simple personal API for these, so the clean route is the one Jarvis already
speaks — **Home Assistant**. Point Home Assistant at the brands in your Google
Home app (most integrate directly: Kasa, Hue, Govee, Tuya, …), set
`HOME_ASSISTANT_URL` + `HOME_ASSISTANT_TOKEN` on the Worker, and Jarvis's
`control_home` tool runs them from *every* surface — "turn off the bedroom
lights", "open the blinds". For anything only Google can do (some routines /
devices), Home Assistant's *Google Assistant SDK* integration relays a
command to Google as if you'd said "Hey Google…", still through the same
`control_home` pipe.

## The dashboard

The pop-up window is a J.A.R.V.I.S. dashboard: the arc-reactor centrepiece
(voice status, live mic/wake meter), plus three live panels —

- **Weather** — current conditions and today's high/low for your city
  (keyless [Open-Meteo](https://open-meteo.com/)). Set `JARVIS_WEATHER_LOCATION`.
- **Markets** — last price and day change for your tickers, green/red
  (keyless). Set `JARVIS_STOCKS` (e.g. `AAPL,MSFT,NVDA,BTC-USD`).
- **Direct Line** — type to Jarvis and read the reply, sharing the **same
  brain, memory, and tools** as the voice. Voice turns show up here too.
- **System telemetry** (bottom-right) — your machine's real CPU, memory, disk,
  network throughput and uptime, plus battery and silicon temperature where
  the platform reports them. Hover memory or disk for used/free detail.

**First run asks for your city and tickers** and saves them to
`~/.jarvis/desktop.json` — nothing to set by hand. (Upgrading from an older
build? It asks once, the next time you start from a terminal.) Leave the city
blank to skip the weather panel; the environment variables below still
override, and the panels are fed by the app's own local server, so the page
holds no API key and there's no network setup. (The Raspberry Pi kiosk HUD
doesn't serve these, so it looks exactly as before.)

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
| `JARVIS_VOICE` | see below | A neural voice (`en-GB-RyanNeural`, `en-GB-SoniaNeural`, `en-US-GuyNeural`…) on any platform; macOS also takes `say` voices (`Allison (Enhanced)`); Windows also takes SAPI names. |
| `JARVIS_TTS` | auto | `sapi` / `espeak` / `say` forces the classic offline engine. |

**Voices.** On Windows and Linux, Jarvis speaks with **Microsoft neural
voices** by default (`en-GB-RyanNeural` — calm, British, very J.A.R.V.I.S.) —
keyless, but they need internet; offline it falls back to the classic system
voice automatically. List every neural voice with
`.venv\Scripts\edge-tts --list-voices` (or pick another British one:
`en-GB-ThomasNeural`, `en-GB-SoniaNeural`). macOS keeps its natural `say`
voices by default; set an `…Neural` name to use the neural engine there too.

### Your own J.A.R.V.I.S. voice (cloning)

A custom voice sample lives at **`voices/jarvis_voice.wav`** (override with
`JARVIS_VOICE_SAMPLE=<path>`). When the local cloning stack is installed,
**every reply is synthesized in that voice, on-device**:

```bat
.venv\Scripts\pip install -r requirements-voice.txt
```

Fair warning: it installs PyTorch (~2 GB), the first reply downloads the
~2 GB XTTS model, and each sentence takes a few seconds to synthesize on a
CPU. Without the install (or if anything fails), Jarvis automatically speaks
with the closest stock voice instead — for the bundled Australian sample
that's `en-AU-WilliamNeural` — so it never goes silent. An explicit
`JARVIS_VOICE` still overrides everything.
| `WHISPER_MODEL` | `base.en` | `tiny.en` faster / `small.en` more accurate. |
| `JARVIS_HUD_PORT` | `8090` | Local port for the HUD + `/state`. |
| `JARVIS_WAKE_THRESHOLD` | `0.5` | Lower = more sensitive wake word. |
| `JARVIS_FOLLOWUP` | `6` | Seconds to keep listening after a reply for a wake-word-free follow-up; `0` disables. |
| `JARVIS_INPUT_DEVICE` | system default | Microphone, by index or name substring (e.g. `MacBook`). |
| `JARVIS_WAKE_DEBUG` | off | `1` prints a once-a-second wake score + mic level readout. |
| `JARVIS_WEATHER_LOCATION` | `St. George, Utah` | City for the dashboard weather panel. Setup offers this default; answer `-` there for no weather panel. |
| `JARVIS_STOCKS` | `AAPL,MSFT,NVDA,BTC-USD` | Tickers for the dashboard markets panel. |

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

**Windows: the window flashes open and closes immediately.** That's almost
always Python: a fresh Windows ships a Microsoft Store *stub* for `python`
that isn't a real interpreter. `Jarvis.bat` now detects this and stays open
with instructions, but to fix it: install real Python from
[python.org](https://www.python.org/downloads/) (tick **Add python.exe to
PATH**), and turn **off** the stub via *Settings → search "app execution
aliases" → switch off `python.exe` and `python3.exe`*. To see any launcher
error directly, open **Command Prompt**, `cd` into the `desktop` folder, and
run `Jarvis.bat` from there — the window won't close.

## Talking to it

After every reply Jarvis keeps listening for about six seconds, so you can
answer back **without saying "Hey Jarvis" again** — a real back-and-forth.
Tune or disable with `JARVIS_FOLLOWUP` (seconds; `0` = off).

## PC voice commands (instant, offline)

These are handled on the machine itself — no round-trip, immediate:

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
- The telemetry readouts come from `psutil`. Without it (or on a display with
  no host to ask) the HUD falls back to stylised placeholder numbers rather
  than showing nothing.
- Wake word needs `openwakeword`; without it the app falls back to push-to-talk.
- Screen identification sends a **downscaled JPEG of your screen to the Worker →
  Anthropic** — same trust as anything else you tell Jarvis, but worth knowing.
- macOS will ask for **Screen Recording** permission the first time you use
  "what's on my screen".
