#!/usr/bin/env python3
"""
Jarvis — a voice assistant you talk to on Windows.

The loop: microphone -> speech-to-text (local Whisper) -> the Jarvis "brain"
-> spoken reply (Windows SAPI voices). The brain is either the Cloudflare Worker
in this repo (shared persona + D1 memory) or Claude directly.

Two ways to point it at a brain:
  * Direct (--direct) — skip the Worker and call Claude straight from here with
    ANTHROPIC_API_KEY. Fully standalone; conversation memory is kept on disk at
    %USERPROFILE%\\.jarvis so Jarvis remembers across launches. This is what the
    Start-menu / desktop shortcut (install.ps1) uses.
  * Worker (default) — run `npm run dev` in the repo root, which serves the
    Worker (and Claude + D1 memory) at http://localhost:8787. No deploy needed.
    Or set JARVIS_URL to your deployed Worker's /jarvis endpoint.

Usage:
    python jarvis_win.py                 # push-to-talk against the local Worker
    python jarvis_win.py --direct        # talk straight to Claude (standalone)
    python jarvis_win.py --auto          # hands-free: stops on silence
    python jarvis_win.py --text "hello"  # type instead of speak (no mic)
    python jarvis_win.py --list-voices   # list installed Windows voices

Press Ctrl-C any time to quit. Say "Jarvis, start over" to wipe the memory.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys
import urllib.error
import urllib.request

SAMPLE_RATE = 16_000  # what Whisper expects

# "Microsoft David" is the stock male English voice on Windows — the most
# J.A.R.V.I.S.-like default. We fall back to the system default if it's missing.
DEFAULT_VOICE = os.environ.get("JARVIS_VOICE", "Microsoft David Desktop")
DEFAULT_MODEL = os.environ.get("WHISPER_MODEL", "base.en")
DEFAULT_URL = os.environ.get("JARVIS_URL", "http://localhost:8787/jarvis")
DEFAULT_SESSION = os.environ.get("JARVIS_SESSION", "windows")
DEFAULT_CLAUDE_MODEL = os.environ.get("JARVIS_MODEL", "claude-opus-4-8")

# Where standalone mode keeps its state (memory + saved API key), so Jarvis
# remembers you across launches and the shortcut works without a shell env.
STATE_DIR = pathlib.Path.home() / ".jarvis"


def memory_path(session: str) -> pathlib.Path:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in session)
    return STATE_DIR / f"history-{safe or 'default'}.json"


def ensure_api_key():
    """A shortcut-launched process may not inherit your shell env, so fall back
    to a key saved at %USERPROFILE%\\.jarvis\\anthropic_api_key (by install.ps1)."""
    if os.environ.get("ANTHROPIC_API_KEY"):
        return
    key_file = STATE_DIR / "anthropic_api_key"
    if key_file.exists():
        key = key_file.read_text(encoding="utf-8").strip()
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
            sys.exit("Missing faster-whisper. Install it with:\n    pip install faster-whisper")
        print(f"[..] Loading speech model '{self.model_name}' (first run downloads it)...")
        # int8 on CPU is plenty fast for the small models.
        self._model = WhisperModel(self.model_name, device="cpu", compute_type="int8")

    def transcribe(self, audio) -> str:
        self._load()
        segments, _info = self._model.transcribe(audio, language="en", vad_filter=True)
        return " ".join(seg.text for seg in segments).strip()


# --------------------------------------------------------------------------- #
# Speech out: Windows SAPI via PowerShell (no extra dependency)
# --------------------------------------------------------------------------- #

# Read the text from stdin so the spoken content never needs quoting/escaping.
_SPEAK_PS = (
    "Add-Type -AssemblyName System.Speech;"
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;"
    "if ($env:JARVIS_TTS_VOICE) { try { $s.SelectVoice($env:JARVIS_TTS_VOICE) } catch { } }"
    "$s.Speak([Console]::In.ReadToEnd())"
)


def speak(text: str, voice: str | None):
    if not text:
        return
    env = dict(os.environ)
    if voice:
        env["JARVIS_TTS_VOICE"] = voice
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-Command", _SPEAK_PS],
            input=text,
            text=True,
            env=env,
            check=False,
        )
    except FileNotFoundError:
        # Not on Windows (no PowerShell) — just print.
        print("(text-to-speech unavailable; PowerShell not found)")


def list_voices():
    ps = (
        "Add-Type -AssemblyName System.Speech;"
        "(New-Object System.Speech.Synthesis.SpeechSynthesizer)."
        "GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }"
    )
    try:
        subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=False)
    except FileNotFoundError:
        print("Listing voices requires Windows PowerShell.")


# --------------------------------------------------------------------------- #
# The brain
# --------------------------------------------------------------------------- #


class WorkerBrain:
    """Talks to the Cloudflare Worker's /jarvis endpoint."""

    def __init__(self, url: str, session: str):
        self.url = url
        self.session = session

    def ask(self, text: str) -> str:
        payload = json.dumps({"text": text, "sessionId": self.session}).encode()
        req = urllib.request.Request(
            self.url, data=payload, headers={"content-type": "application/json"}
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.load(resp)
        except urllib.error.URLError as err:
            raise RuntimeError(
                f"Couldn't reach the Jarvis Worker at {self.url} ({err}).\n"
                "Is it running? Start it with `npm run dev` in the repo root, "
                "or set JARVIS_URL to your deployed Worker, or use --direct."
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
    """Calls Claude directly via the Anthropic Python SDK, with memory persisted
    to disk so Jarvis remembers across launches (the standalone brain — no Worker
    required)."""

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
            sys.exit(
                "No Anthropic API key. Set ANTHROPIC_API_KEY, or run install.ps1 "
                "to save one to %USERPROFILE%\\.jarvis\\anthropic_api_key."
            )
        self._client = anthropic.Anthropic()
        self.model = model
        self._path = memory_path(session) if persist else None
        self.history: list[dict] = self._load()

    def _load(self) -> list[dict]:
        if self._path and self._path.exists():
            try:
                return json.loads(self._path.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                return []
        return []

    def _save(self):
        if self._path:
            try:
                self._path.write_text(json.dumps(self.history), encoding="utf-8")
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
            thinking={"type": "disabled"},  # snappy spoken replies
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
    parser.add_argument("--voice", default=DEFAULT_VOICE, help=f"Windows voice (default: {DEFAULT_VOICE}).")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"Whisper model (default: {DEFAULT_MODEL}).")
    parser.add_argument("--url", default=DEFAULT_URL, help="Worker /jarvis endpoint.")
    parser.add_argument("--session", default=DEFAULT_SESSION, help="Conversation/session id.")
    parser.add_argument("--claude-model", default=DEFAULT_CLAUDE_MODEL, help="Claude model for --direct mode.")
    parser.add_argument("--list-voices", action="store_true", help="List installed Windows voices and exit.")
    args = parser.parse_args()

    if args.list_voices:
        list_voices()
        return

    brain = (
        DirectBrain(args.claude_model, args.session)
        if args.direct
        else WorkerBrain(args.url, args.session)
    )

    # Text-only mode: useful for testing the brain without a microphone.
    if args.text:
        try:
            reply = brain.ask(args.text)
        except RuntimeError as err:
            sys.exit(f"\n[!] {err}\n")
        print(f"\nJarvis: {reply}\n")
        speak(reply, args.voice)
        return

    np, sd = _import_audio()
    transcriber = Transcriber(args.model)

    where = "Claude directly" if args.direct else args.url
    print(f"Jarvis is online (brain: {where}, voice: {args.voice}).")
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
            speak(reply, args.voice)
    except KeyboardInterrupt:
        print("\nGoodbye.")


if __name__ == "__main__":
    main()
