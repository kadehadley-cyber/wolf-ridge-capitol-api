# Jarvis on Windows

Talk to Jarvis out loud on Windows. It captures your voice, transcribes it
locally with Whisper, asks Claude, and speaks the reply back with a built-in
Windows voice — remembering your conversation across launches.

```
[mic] you speak  ->  Whisper (on-device)  ->  Claude  ->  Windows SAPI voice  ->  [spk] reply
```

There are two ways to run it: **standalone** (a desktop shortcut that talks
straight to Claude — recommended, nothing else to run) or **paired with the
Worker** (shares the exact brain + memory the glasses use).

---

## Standalone (recommended)

One-time setup from PowerShell. It creates the environment, saves your Anthropic
API key, and puts a **Jarvis** shortcut on your Desktop:

```powershell
cd windows
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Then start Jarvis any of these ways:

- Double-click the **Jarvis** shortcut on your Desktop
- Run **`.\jarvis.bat --direct`** in this folder

Press **Enter** to talk, Enter again to stop. Jarvis answers out loud. Press
**Ctrl-C** to quit. Say **"Jarvis, start over"** to wipe its memory. History is
kept at `%USERPROFILE%\.jarvis\` so it remembers you between sessions.

> First launch downloads a small Whisper model (~150 MB for `base.en`). Windows
> may ask for microphone access the first time — allow it.

---

## Paired with the Worker

Use this to share one brain and memory with the glasses build. Start the Worker
locally from the repo root (runs Claude + the D1 memory on your PC — no deploy):

```powershell
npm install
npx wrangler secret put ANTHROPIC_API_KEY
npm run dev                       # serves http://localhost:8787
```

Then run the client pointed at it (the default when you omit `--direct`):

```powershell
cd windows
.\jarvis.bat
```

To use a deployed Worker instead: set `JARVIS_URL` to `https://<you>.workers.dev/jarvis`.

---

## Modes & flags

| Command | What it does |
| --- | --- |
| `jarvis.bat --control` | **Operate the PC by voice** — open apps, search, type, media/volume, lock/sleep. Implies `--direct`. |
| `jarvis.bat --control --allow-shell` | As above, plus run PowerShell and shutdown/restart (power-user). |
| `jarvis.bat --direct` | Standalone — talk straight to Claude (the shortcut uses this). |
| `jarvis.bat` | Paired — push-to-talk against the local/your Worker. |
| `jarvis.bat --auto` | Hands-free — starts on speech, stops after a short silence. |
| `jarvis.bat --text "what's the time in Tokyo?"` | Type one message instead of speaking (no mic). |
| `jarvis.bat --list-voices` | List the Windows voices you can pass to `--voice`. |

## Control your PC by voice

Run `jarvis.bat --control` and Jarvis can actually drive the machine — say the
word and it does it, hands-free:

- **"Open Chrome"**, "launch Notepad", "start Spotify" — opens apps
- **"Pull up the weather radar"**, "search for flights to Tokyo" — opens the browser
- **"Go to github.com"** — opens a URL
- **"Type out: thanks, I'll review it tomorrow"** — types into the focused window
- **"Turn it up"**, "mute", "pause", "next track" — media and volume
- **"Lock the computer"**, "go to sleep"
- It still **answers questions** and **searches the web** out loud, too.

It confirms each action in a short line ("Opening Chrome."). Everyday actions run
without asking. To also let it run arbitrary PowerShell and shut down/restart,
add **`--allow-shell`** — only do that if you're comfortable letting your voice
execute commands on the PC. Those are off by default so a stray sentence can't
wipe your work.

## Configuration

All optional; set as environment variables or pass the matching flag.

| Variable | Flag | Default | Notes |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | — | Standalone mode. `install.ps1` saves it under `%USERPROFILE%\.jarvis`. |
| `JARVIS_VOICE` | `--voice` | `Microsoft David Desktop` | Any installed SAPI voice; falls back to the system default. |
| `WHISPER_MODEL` | `--model` | `base.en` | `tiny.en` is faster; `small.en`/`medium.en` are more accurate. |
| `JARVIS_SESSION` | `--session` | `windows` | Memory bucket — change it to keep separate conversations. |
| `JARVIS_MODEL` | `--claude-model` | `claude-opus-4-8` | Claude model for standalone mode. |
| `JARVIS_TOOLS` | — | (on) | Set to `off` to disable web search in standalone mode. |
| `JARVIS_URL` | `--url` | `http://localhost:8787/jarvis` | Worker endpoint (paired mode). |

In standalone (`--direct`) mode Jarvis knows the current time and can **search the
web** for live questions (weather, news, facts) — set `JARVIS_TOOLS=off` to turn
search off.

## Requirements

- Windows 10/11 with Python 3.9+ on PATH (`python --version`).
- An Anthropic API key for standalone mode.
- No extra audio install — `sounddevice` bundles PortAudio in its Windows wheel,
  and text-to-speech uses the built-in Windows SAPI voices via PowerShell.

## Files

| File | Purpose |
| --- | --- |
| `jarvis_win.py` | The voice client (capture, transcribe, brain, speak). |
| `jarvis.bat` | Launcher that creates a venv, installs deps, and runs the client. |
| `install.ps1` | One-time setup: venv + API key + Desktop shortcut. |
| `requirements.txt` | Python dependencies. |
