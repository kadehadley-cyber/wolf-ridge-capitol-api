#!/usr/bin/env python3
"""
Jarvis — a voice assistant you talk to on Windows.

The loop: microphone -> speech-to-text (local Whisper) -> the Jarvis "brain"
-> spoken reply (Windows' built-in System.Speech via PowerShell). The brain
lives in the Cloudflare Worker in this repo, so persona and long-term memory are
shared with the Mac, glasses, Pi, and CYD builds.

Two ways to point it at a brain:
  * Worker (default) — talk to your deployed Worker's /jarvis endpoint (set
    JARVIS_URL + JARVIS_API_KEY), so it shares one brain and memory with the
    rest of Jarvis. Or run `npm run dev` in the repo root for a local Worker.
  * Direct (--direct) — skip the Worker and call Claude straight from here with
    ANTHROPIC_API_KEY. Standalone; conversation memory kept in %USERPROFILE%\\.jarvis.

Usage (PowerShell or cmd):
    python jarvis_windows.py                 # push-to-talk against your Worker
    python jarvis_windows.py --auto          # hands-free: stops on silence
    python jarvis_windows.py --direct        # talk straight to Claude
    python jarvis_windows.py --text "hello"  # type instead of speak (no mic)
    python jarvis_windows.py --list-voices   # list installed Windows voices

Press Ctrl-C any time to quit. Say "Jarvis, start over" to wipe the memory.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

SAMPLE_RATE = 16_000  # what Whisper expects

# "auto" picks the most natural English voice installed (see resolve_voice).
# Override with JARVIS_VOICE / --voice (e.g. "Microsoft Hazel Desktop").
DEFAULT_VOICE = os.environ.get("JARVIS_VOICE", "auto")
DEFAULT_MODEL = os.environ.get("WHISPER_MODEL", "base.en")
DEFAULT_URL = os.environ.get("JARVIS_URL", "http://localhost:8787/jarvis")
DEFAULT_SESSION = os.environ.get("JARVIS_SESSION", "windows")
DEFAULT_CLAUDE_MODEL = os.environ.get("JARVIS_MODEL", "claude-opus-4-8")
# Bearer token for a deployed Worker that has JARVIS_API_KEY set (paired mode).
DEFAULT_WORKER_KEY = os.environ.get("JARVIS_API_KEY", "")
# SAPI speaking rate, -10 (slow) .. 10 (fast); 0 is natural.
DEFAULT_RATE = os.environ.get("JARVIS_TTS_RATE", "0")

# Where standalone mode keeps its state, so Jarvis remembers across launches.
STATE_DIR = pathlib.Path.home() / ".jarvis"

# Hide the console window PowerShell would otherwise flash up.
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def memory_path(session: str) -> pathlib.Path:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in session)
    return STATE_DIR / f"history-{safe or 'default'}.json"


def ensure_api_key():
    if os.environ.get("ANTHROPIC_API_KEY"):
        return
    key_file = STATE_DIR / "anthropic_api_key"
    if key_file.exists():
        key = key_file.read_text().strip()
        if key:
            os.environ["ANTHROPIC_API_KEY"] = key


# --------------------------------------------------------------------------- #
# Speech in: microphone capture + transcription
# --------------------------------------------------------------------------- #


def _import_audio():
    try:
        import numpy as np  # noqa: F401
        import sounddevice as sd  # noqa: F401
    except ImportError:
        sys.exit(
            "Missing audio dependencies. Install them with:\n"
            "    pip install -r requirements.txt\n"
            "(or: pip install sounddevice numpy faster-whisper)"
        )
    return np, sd


def record_push_to_talk(np, sd):
    """Record from the mic between two Enter presses."""
    input("\n[mic] Press Enter to speak...")
    frames: list = []
    recording = {"on": True}

    def callback(indata, _frames, _time, _status):
        if recording["on"]:
            frames.append(indata.copy())

    with sd.InputStream(
        samplerate=SAMPLE_RATE, channels=1, dtype="float32", callback=callback
    ):
        input("[rec] Recording... press Enter to stop.")
        recording["on"] = False

    if not frames:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(frames, axis=0).flatten()


def record_until_silence(np, sd, silence_secs=1.2, threshold=0.012, max_secs=30):
    """Hands-free capture: start on speech, stop after a beat of silence."""
    import time

    print("\n[mic] Listening... (just start talking)")
    frames: list = []
    block = int(SAMPLE_RATE * 0.1)  # 100 ms blocks
    started = False
    silent_for = 0.0
    start = time.time()

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32") as stream:
        while True:
            data, _ = stream.read(block)
            mono = data.flatten()
            level = float(np.sqrt(np.mean(mono**2))) if mono.size else 0.0

            if level >= threshold:
                if not started:
                    print("[rec] Recording...")
                started = True
                silent_for = 0.0
                frames.append(mono.copy())
            elif started:
                frames.append(mono.copy())
                silent_for += 0.1
                if silent_for >= silence_secs:
                    break

            if time.time() - start > max_secs:
                break

    if not frames:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(frames).flatten()


class Transcriber:
    """Lazily-loaded local Whisper model (faster-whisper)."""

    def __init__(self, model_name: str):
        self.model_name = model_name
        self._model = None

    def _load(self):
        if self._model is not None:
            return
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            sys.exit("Missing faster-whisper. Install it with: pip install faster-whisper")
        print(f"[..] Loading speech model '{self.model_name}' (first run downloads it)...")
        self._model = WhisperModel(self.model_name, device="cpu", compute_type="int8")

    def transcribe(self, audio) -> str:
        self._load()
        segments, _info = self._model.transcribe(audio, language="en", vad_filter=True)
        return " ".join(seg.text for seg in segments).strip()


# --------------------------------------------------------------------------- #
# Speech out: Windows System.Speech via PowerShell (built in, no extra deps)
# --------------------------------------------------------------------------- #


def _powershell(script: str, **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        creationflags=_NO_WINDOW,
        **kwargs,
    )


def speak(text: str, voice: str):
    if not text:
        return
    # Pass the text via a UTF-8 temp file so quotes/unicode can't break the command.
    try:
        with tempfile.NamedTemporaryFile(
            "w", suffix=".txt", delete=False, encoding="utf-8"
        ) as f:
            f.write(text)
            path = f.name
    except OSError:
        print(f"Jarvis: {text}")
        return

    script = (
        "$ErrorActionPreference='SilentlyContinue';"
        "Add-Type -AssemblyName System.Speech;"
        "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;"
        "if($env:JARVIS_TTS_VOICE){try{$s.SelectVoice($env:JARVIS_TTS_VOICE)}catch{}};"
        "if($env:JARVIS_TTS_RATE){$s.Rate=[int]$env:JARVIS_TTS_RATE};"
        f"$t=Get-Content -Raw -Encoding UTF8 -LiteralPath '{path}';"
        "if($t){$s.Speak($t)};"
    )
    env = dict(os.environ)
    if voice and voice.lower() != "auto":
        env["JARVIS_TTS_VOICE"] = voice
    env["JARVIS_TTS_RATE"] = DEFAULT_RATE
    try:
        _powershell(script, env=env, check=False)
    except FileNotFoundError:
        print(f"(text-to-speech unavailable; PowerShell not found)\nJarvis: {text}")
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def _installed_voices() -> list[tuple[str, str]]:
    """Return (name, culture) for each installed SAPI voice."""
    script = (
        "Add-Type -AssemblyName System.Speech;"
        "(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices()|"
        "%{ if($_.Enabled){ $_.VoiceInfo.Name+'|'+$_.VoiceInfo.Culture } }"
    )
    try:
        out = _powershell(script, capture_output=True, text=True, check=False).stdout
    except (FileNotFoundError, OSError):
        return []
    voices = []
    for line in out.splitlines():
        if "|" in line:
            name, _, culture = line.strip().partition("|")
            if name:
                voices.append((name, culture))
    return voices


def list_voices():
    voices = _installed_voices()
    if not voices:
        print("Couldn't list voices (is this Windows with PowerShell?).")
        return
    for name, culture in voices:
        print(f"{name}  [{culture}]")


def resolve_voice(preferred: str) -> str:
    """Pick the most natural English voice installed.

    Honour a named voice; otherwise ("auto") prefer an English (UK) voice, a
    "Natural" one, and a male-sounding name for the J.A.R.V.I.S. character.
    Returns "" to mean "use the system default voice".
    Add more voices via Settings > Time & Language > Speech > Manage voices.
    """
    if preferred and preferred.lower() != "auto":
        return preferred

    voices = _installed_voices()
    if not voices:
        return ""

    male = ("george", "ryan", "guy", "david", "mark", "james", "thomas", "george")

    def score(v):
        name, culture = v
        low = name.lower()
        s = 0
        if culture.lower().startswith("en-gb"):
            s += 4
        elif culture.lower().startswith("en"):
            s += 1
        if "natural" in low:
            s += 3
        if any(m in low for m in male):
            s += 2
        return s

    best = max(voices, key=score)
    return best[0] if score(best) > 0 else ""


# --------------------------------------------------------------------------- #
# The brain
# --------------------------------------------------------------------------- #

_USER_AGENT = "Jarvis-Windows/1.0 (+https://github.com/kadehadley-cyber/wolf-ridge-capitol-api)"


class WorkerBrain:
    """Talks to the Cloudflare Worker's /jarvis endpoint (shared brain + memory)."""

    def __init__(self, url: str, session: str, api_key: str = ""):
        self.url = url
        self.session = session
        self.api_key = api_key

    def ask(self, text: str) -> str:
        payload = json.dumps({"text": text, "sessionId": self.session}).encode()
        headers = {
            "content-type": "application/json",
            "accept": "application/json",
            # Cloudflare bot protection 403s the default urllib User-Agent.
            "user-agent": _USER_AGENT,
        }
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"
        req = urllib.request.Request(self.url, data=payload, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.load(resp)
        except urllib.error.HTTPError as err:
            if err.code == 401:
                raise RuntimeError(
                    "The Jarvis Worker rejected the request (401 Unauthorized). "
                    "It has JARVIS_API_KEY set, so pass the matching key with "
                    "--api-key or the JARVIS_API_KEY environment variable."
                ) from err
            if err.code == 403:
                raise RuntimeError(
                    "The request was blocked before reaching the Worker (403 Forbidden) — "
                    "typically Cloudflare bot protection. This client already sends a normal "
                    "User-Agent; if it persists, check the Worker isn't behind Cloudflare "
                    "Access or Bot Fight Mode."
                ) from err
            raise RuntimeError(
                f"The Jarvis Worker returned an error ({err.code} {err.reason})."
            ) from err
        except urllib.error.URLError as err:
            raise RuntimeError(
                f"Couldn't reach the Jarvis Worker at {self.url} ({err}).\n"
                "Set JARVIS_URL to your deployed Worker, run `npm run dev` in the repo "
                "root for a local one, or use --direct."
            ) from err
        return data.get("reply", "")


SYSTEM_PROMPT = (
    "You are Jarvis, a voice assistant on the user's Windows PC, modelled on Tony "
    "Stark's J.A.R.V.I.S.: unflappable, quietly witty, competent, and economical "
    "with words. Everything you say is read aloud, so reply in plain spoken "
    "English — no markdown, lists, code blocks, or emoji. Be brief: one to three "
    "sentences. Lead with the answer, skip preamble. If you don't know something "
    "or can't do it, say so plainly; don't invent facts. Respond only with what "
    "should be spoken — your final answer, nothing else."
)


class DirectBrain:
    """Calls Claude directly via the Anthropic SDK, with memory persisted to disk."""

    def __init__(self, model: str, session: str = DEFAULT_SESSION, persist: bool = True):
        try:
            import anthropic
        except ImportError:
            sys.exit(
                "Direct mode needs the Anthropic SDK:\n"
                "    pip install anthropic\n"
                "and the ANTHROPIC_API_KEY environment variable set."
            )
        ensure_api_key()
        if not os.environ.get("ANTHROPIC_API_KEY"):
            sys.exit("No Anthropic API key. Set ANTHROPIC_API_KEY, or save one to %USERPROFILE%\\.jarvis\\anthropic_api_key.")
        self._client = anthropic.Anthropic()
        self.model = model
        self._path = memory_path(session) if persist else None
        self.history: list[dict] = self._load()

    def _load(self) -> list[dict]:
        if self._path and self._path.exists():
            try:
                return json.loads(self._path.read_text())
            except (ValueError, OSError):
                return []
        return []

    def _save(self):
        if self._path:
            try:
                self._path.write_text(json.dumps(self.history))
            except OSError:
                pass

    def ask(self, text: str) -> str:
        if text.strip().lower().rstrip(".!") in {
            "jarvis, start over",
            "start over",
            "reset",
            "new conversation",
            "clear memory",
        }:
            self.history.clear()
            self._save()
            return "Done. Clean slate."

        self.history.append({"role": "user", "content": text})
        response = self._client.messages.create(
            model=self.model,
            max_tokens=1024,
            thinking={"type": "disabled"},
            system=SYSTEM_PROMPT,
            messages=self.history,
        )
        reply = " ".join(
            block.text for block in response.content if block.type == "text"
        ).strip()
        self.history.append({"role": "assistant", "content": reply})
        self._save()
        return reply


# --------------------------------------------------------------------------- #
# Main loop
# --------------------------------------------------------------------------- #


def main():
    parser = argparse.ArgumentParser(description="Jarvis voice assistant for Windows.")
    parser.add_argument("--direct", action="store_true", help="Call Claude directly instead of the Worker.")
    parser.add_argument("--auto", action="store_true", help="Hands-free: record until you stop talking.")
    parser.add_argument("--text", metavar="MSG", help="Send one typed message (skip the mic) and exit.")
    parser.add_argument("--voice", default=DEFAULT_VOICE, help=f"Windows voice, or 'auto' (default: {DEFAULT_VOICE}).")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"Whisper model (default: {DEFAULT_MODEL}).")
    parser.add_argument("--url", default=DEFAULT_URL, help="Worker /jarvis endpoint.")
    parser.add_argument("--api-key", default=DEFAULT_WORKER_KEY, help="Bearer token for a Worker with JARVIS_API_KEY set (or set JARVIS_API_KEY).")
    parser.add_argument("--session", default=DEFAULT_SESSION, help="Conversation/session id.")
    parser.add_argument("--claude-model", default=DEFAULT_CLAUDE_MODEL, help="Claude model for --direct mode.")
    parser.add_argument("--list-voices", action="store_true", help="List installed Windows voices and exit.")
    args = parser.parse_args()

    if args.list_voices:
        list_voices()
        return

    voice = resolve_voice(args.voice)

    brain = (
        DirectBrain(args.claude_model, args.session)
        if args.direct
        else WorkerBrain(args.url, args.session, args.api_key)
    )

    # Text-only mode: useful for testing the brain without a microphone.
    if args.text:
        try:
            reply = brain.ask(args.text)
        except RuntimeError as err:
            sys.exit(f"\n[!] {err}\n")
        print(f"\nJarvis: {reply}\n")
        speak(reply, voice)
        return

    np, sd = _import_audio()
    transcriber = Transcriber(args.model)

    where = "Claude directly" if args.direct else args.url
    print(f"Jarvis is online (brain: {where}, voice: {voice or 'system default'}).")
    print("Press Ctrl-C to quit.")

    try:
        while True:
            audio = (
                record_until_silence(np, sd)
                if args.auto
                else record_push_to_talk(np, sd)
            )
            if audio.size == 0:
                continue

            you = transcriber.transcribe(audio)
            if not you:
                print("...didn't catch that.")
                continue
            print(f"You: {you}")

            try:
                reply = brain.ask(you)
            except RuntimeError as err:
                print(f"\n[!] {err}\n")
                continue

            print(f"Jarvis: {reply}")
            speak(reply, voice)
    except KeyboardInterrupt:
        print("\nGoodbye.")


if __name__ == "__main__":
    main()
