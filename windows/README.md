# Jarvis on Windows

Talk to Jarvis out loud on Windows. It captures your voice, transcribes it
locally with Whisper, asks your Cloudflare Worker (so it shares the **same brain
and long-term memory** as the Mac, glasses, Pi, and CYD builds), and speaks the
reply back with Windows' built-in speech.

```
[mic] you speak  ->  Whisper (on-device)  ->  Worker (Claude + memory)  ->  System.Speech  ->  reply
```

## Setup

1. Install **Python 3** from [python.org](https://www.python.org/downloads/) — tick
   **"Add python.exe to PATH"** in the installer.
2. Get this repo and open a PowerShell window in the `windows` folder:
   ```powershell
   git clone https://github.com/kadehadley-cyber/wolf-ridge-capitol-api.git
   cd wolf-ridge-capitol-api\windows
   ```
3. Point it at your Worker and run — the launcher makes a virtualenv and installs
   everything on first run:
   ```powershell
   $env:JARVIS_URL     = "https://wolf-ridge-capitol-api.kade-hadley.workers.dev/jarvis"
   $env:JARVIS_API_KEY = "<your JARVIS_API_KEY>"
   powershell -ExecutionPolicy Bypass -File .\jarvis.ps1
   ```

Press **Enter** to talk, Enter again to stop. Jarvis answers out loud. **Ctrl-C**
to quit. Say **"Jarvis, start over"** to wipe the conversation.

> First run downloads a small Whisper model (~150 MB for `base.en`), and Windows
> will ask for **microphone permission** — allow it (Settings ▸ Privacy & security
> ▸ Microphone ▸ *Let desktop apps access your microphone*).

## Modes & flags

| Command | What it does |
| --- | --- |
| `.\jarvis.ps1` | Push-to-talk against your Worker. |
| `.\jarvis.ps1 --auto` | Hands-free — starts on speech, stops after a short silence. |
| `.\jarvis.ps1 --direct` | Standalone — talk straight to Claude (needs `ANTHROPIC_API_KEY`). |
| `.\jarvis.ps1 --text "what's the time in Tokyo?"` | Type one message (no mic). |
| `.\jarvis.ps1 --list-voices` | List the Windows voices you can pass to `--voice`. |

(You can also skip the launcher: `python jarvis_windows.py ...`.)

## Configuration

All optional; set as environment variables or pass the matching flag.

| Variable | Flag | Default | Notes |
| --- | --- | --- | --- |
| `JARVIS_URL` | `--url` | `http://localhost:8787/jarvis` | Your Worker's `/jarvis` endpoint. |
| `JARVIS_API_KEY` | `--api-key` | — | Bearer token, if the Worker has `JARVIS_API_KEY` set. |
| `JARVIS_VOICE` | `--voice` | `auto` | `auto` picks the most natural English voice; or name one, e.g. `"Microsoft Hazel Desktop"`. |
| `JARVIS_TTS_RATE` | — | `0` | Speaking rate, -10 (slow) … 10 (fast). |
| `WHISPER_MODEL` | `--model` | `base.en` | `tiny.en` is faster; `small.en` is more accurate. |
| `JARVIS_SESSION` | `--session` | `windows` | Memory bucket for this device. |
| `ANTHROPIC_API_KEY` | — | — | For `--direct` mode. |

## A more natural voice

Text-to-speech uses Windows' built-in **System.Speech** (SAPI) voices — David
and Zira (US), Hazel (UK), etc. `JARVIS_VOICE=auto` automatically picks the best
English voice it finds (preferring a UK, "Natural", male one for the J.A.R.V.I.S.
character). Add more under **Settings ▸ Time & Language ▸ Speech ▸ Manage voices**;
run `.\jarvis.ps1 --list-voices` to see the exact names.

> Windows' newest ultra-natural "Natural" voices are sometimes only visible to
> newer speech APIs, not classic SAPI. If a downloaded voice doesn't appear in
> `--list-voices`, it isn't reachable here — a UK voice like *Hazel* is the most
> natural of the always-available ones.

## Requirements

- Windows 10/11 with Python 3.9+ and PowerShell (built in).
- A microphone (allow desktop-app mic access in Privacy settings).
- No PortAudio install needed — `sounddevice` ships a Windows wheel.

## Troubleshooting

- **"didn't catch that" / no response:** mic not captured. Check Windows mic
  permission and that the right input device is the default (Sound settings).
- **No voice out:** run `--list-voices`; if empty, PowerShell/System.Speech isn't
  available. Set `--voice "Microsoft David Desktop"` explicitly to test.
- **401 / 403 from the brain:** wrong/missing `JARVIS_API_KEY`, or Cloudflare
  blocked the request — same notes as the Mac client in [`../mac/README.md`](../mac/README.md).
