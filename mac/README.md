# Jarvis on your Mac

Talk to Jarvis out loud on macOS. It captures your voice, transcribes it locally
with Whisper, asks Claude, and speaks the reply back with the built-in macOS
`say` voice — remembering your conversation across launches.

```
🎙  you speak  ─▶  Whisper (on-device)  ─▶  Claude  ─▶  macOS `say`  ─▶  🔊 reply
```

There are two ways to run it: **standalone** (a double-click Mac app that talks
straight to Claude — recommended, nothing else to run) or **paired with the
Worker** (shares the exact brain + memory the glasses use).

---

## Standalone — the Mac app (recommended)

One-time setup. It creates the environment, saves your Anthropic API key, and
builds a `Jarvis.app` you can keep in your Dock:

```bash
cd mac
./install.sh         # asks for your Anthropic API key, builds ~/Applications/Jarvis.app
```

Then start Jarvis any of these ways:

- Open **Jarvis.app** from Spotlight or your Dock
- Double-click **`mac/Jarvis.command`** in Finder
- Run **`./jarvis --direct`** in this folder

Press **Enter** to talk, Enter again to stop. Jarvis answers out loud. Press
**Ctrl-C** to quit. Say **"Jarvis, start over"** to wipe its memory. Conversation
history is kept on disk at `~/.jarvis/` so it remembers you between sessions.

> First launch downloads a small Whisper model (~150 MB for `base.en`). The app
> opens a Terminal window to run in — that's also what macOS asks for microphone
> permission, so grant it when prompted.

---

## Paired with the Worker

Use this if you want Jarvis on the Mac to share one brain and memory with the
glasses build. Start the Worker locally from the repo root (it runs Claude + the
D1 memory on your Mac — no deploy needed):

```bash
npm install
npx wrangler secret put ANTHROPIC_API_KEY
npm run dev                       # serves http://localhost:8787
```

Then run the client pointed at it (this is the default when you omit `--direct`):

```bash
cd mac && ./jarvis
```

To use a deployed Worker instead: `JARVIS_URL="https://<you>.workers.dev/jarvis" ./jarvis`.

---

## Modes & flags

| Command | What it does |
| --- | --- |
| `./jarvis --direct` | Standalone — talk straight to Claude (the app uses this). |
| `./jarvis` | Paired — push-to-talk against the local/your Worker. |
| `./jarvis --auto` | Hands-free — starts on speech, stops after a short silence. |
| `./jarvis --text "what's the time in Tokyo?"` | Type one message instead of speaking (no mic). |
| `./jarvis --list-voices` | List the macOS voices you can pass to `--voice`. |

## Configuration

All optional; set as environment variables or pass the matching flag.

| Variable | Flag | Default | Notes |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | — | Standalone mode. `install.sh` saves it to `~/.jarvis/anthropic_api_key`. |
| `JARVIS_VOICE` | `--voice` | `Daniel` | Any installed macOS voice; falls back to the system default. |
| `WHISPER_MODEL` | `--model` | `base.en` | `tiny.en` is faster; `small.en`/`medium.en` are more accurate. |
| `JARVIS_SESSION` | `--session` | `mac` | Memory bucket — change it to keep separate conversations. |
| `JARVIS_MODEL` | `--claude-model` | `claude-opus-4-8` | Claude model for standalone mode. |
| `JARVIS_TOOLS` | — | (on) | Set to `off` to disable web search in standalone mode. |
| `JARVIS_URL` | `--url` | `http://localhost:8787/jarvis` | Worker endpoint (paired mode). |

In standalone (`--direct`) mode Jarvis knows the current time and can **search the
web** for live questions (weather, news, facts) — set `JARVIS_TOOLS=off` to turn
search off.

## Requirements

- macOS with Python 3.9+ (`python3`).
- An Anthropic API key for standalone mode.
- No `brew install` needed — `sounddevice` bundles PortAudio in its macOS wheel.
- Grant **Microphone** permission to Terminal (or iTerm) when first prompted:
  System Settings → Privacy & Security → Microphone.

## Files

| File | Purpose |
| --- | --- |
| `jarvis_mac.py` | The voice client (capture, transcribe, brain, speak). |
| `jarvis` | Launcher that creates a venv, installs deps, and runs the client. |
| `install.sh` | One-time setup: venv + API key + builds `Jarvis.app`. |
| `make-app.sh` | Builds just the `Jarvis.app` bundle. |
| `Jarvis.command` | Double-click launcher for Finder. |
| `requirements.txt` | Python dependencies. |
