# Jarvis on your Mac

Talk to Jarvis out loud on macOS. The client captures your voice, transcribes it
locally with Whisper, sends it to the Jarvis brain, and speaks the reply back
with the built-in macOS `say` voice.

```
🎙  you speak  ─▶  Whisper (on-device)  ─▶  Jarvis brain  ─▶  macOS `say`  ─▶  🔊 reply
```

The brain is the Cloudflare Worker in this repo, so the persona and conversation
memory are the same ones the glasses use. You don't have to deploy anything —
running the Worker locally is enough.

## Quick start

From the repo root, start the Worker locally (this is the brain — it runs Claude
and the D1 memory on your Mac):

```bash
npm install
npx wrangler secret put ANTHROPIC_API_KEY   # once; or rely on the Workers AI fallback
npm run dev                                  # serves http://localhost:8787
```

Then, in a second terminal, start the voice client:

```bash
cd mac
./jarvis            # first run sets up a venv and installs deps automatically
```

Press **Enter** to talk, Enter again to stop. Jarvis answers out loud. Press
**Ctrl-C** to quit. Say **"Jarvis, start over"** to wipe the conversation memory.

> First launch downloads a small Whisper model (~150 MB for `base.en`) and, if
> the venv is new, installs the Python dependencies. Subsequent starts are quick.

## Modes

| Command | What it does |
| --- | --- |
| `./jarvis` | Push-to-talk against the local Worker (default). |
| `./jarvis --auto` | Hands-free — starts on speech, stops after a short silence. |
| `./jarvis --direct` | Skip the Worker; talk straight to Claude (needs `pip install anthropic` and `ANTHROPIC_API_KEY`). Memory is per-run only. |
| `./jarvis --text "what time is it in Tokyo?"` | Type one message instead of speaking — good for testing without a mic. |
| `./jarvis --list-voices` | List the macOS voices you can pass to `--voice`. |

## Pointing at a deployed Worker

To use your deployed Worker instead of the local one:

```bash
JARVIS_URL="https://<your-worker>.workers.dev/jarvis" ./jarvis
```

## Configuration

All optional; set as environment variables or pass the matching flag.

| Variable | Flag | Default | Notes |
| --- | --- | --- | --- |
| `JARVIS_URL` | `--url` | `http://localhost:8787/jarvis` | Worker endpoint. |
| `JARVIS_VOICE` | `--voice` | `Daniel` | Any installed macOS voice. Falls back to the system default if absent. |
| `WHISPER_MODEL` | `--model` | `base.en` | `tiny.en` is faster, `small.en`/`medium.en` are more accurate. |
| `JARVIS_SESSION` | `--session` | `mac` | Memory bucket — change it to keep separate conversations. |
| `JARVIS_MODEL` | `--claude-model` | `claude-opus-4-8` | Used only in `--direct` mode. |

## Requirements & permissions

- macOS with Python 3.9+ (`python3`).
- On first use, macOS will ask for **Microphone** permission for your terminal
  (Terminal or iTerm) — grant it under System Settings → Privacy & Security →
  Microphone.
- No `brew install` needed: `sounddevice` bundles PortAudio in its macOS wheel.

## Manual install (instead of `./jarvis`)

```bash
cd mac
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3 jarvis_mac.py
```

## A nice touch

`Daniel` (British) is the default voice for that J.A.R.V.I.S. feel. Try
`./jarvis --list-voices` and pick your favourite — e.g. `./jarvis --voice Oliver`.
