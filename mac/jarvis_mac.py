#!/usr/bin/env python3
"""
Jarvis — a voice assistant you talk to on your Mac.

The loop: microphone -> speech-to-text (local Whisper) -> the Jarvis "brain"
-> spoken reply (macOS `say`). The brain lives in the Cloudflare Worker in this
repo, so persona and conversation memory are shared with the glasses build.

Two ways to point it at a brain:
  * Worker (default) — run `npm run dev` in the repo root, which serves the
    Worker (and Claude + D1 memory) at http://localhost:8787. No deploy needed.
    Or set JARVIS_URL to your deployed Worker's /jarvis endpoint.
  * Direct (--direct) — skip the Worker entirely and call Claude straight from
    here with ANTHROPIC_API_KEY. Fully standalone; conversation memory is kept
    on disk at ~/.jarvis so Jarvis remembers across launches. This is what the
    double-click Mac app (mac/install.sh) uses.

Usage:
    python3 jarvis_mac.py                 # push-to-talk against the local Worker
    python3 jarvis_mac.py --auto          # hands-free: stops on silence
    python3 jarvis_mac.py --direct        # talk straight to Claude
    python3 jarvis_mac.py --text "hello"  # type instead of speak (no mic)
    python3 jarvis_mac.py --list-voices   # list installed macOS voices

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

# A British male voice is the most J.A.R.V.I.S.-like default; we fall back to the
# system default voice if it isn't installed.
DEFAULT_VOICE = os.environ.get("JARVIS_VOICE", "Daniel")
DEFAULT_MODEL = os.environ.get("WHISPER_MODEL", "base.en")
DEFAULT_URL = os.environ.get("JARVIS_URL", "http://localhost:8787/jarvis")
DEFAULT_SESSION = os.environ.get("JARVIS_SESSION", "mac")
DEFAULT_CLAUDE_MODEL = os.environ.get("JARVIS_MODEL", "claude-opus-4-8")

# Where standalone mode keeps its state (memory + saved API key), so Jarvis
# remembers you across launches and the double-click app works without a shell
# environment.
STATE_DIR = pathlib.Path.home() / ".jarvis"


def memory_path(session: str) -> pathlib.Path:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in session)
    return STATE_DIR / f"history-{safe or 'default'}.json"


def ensure_api_key():
    """A GUI-launched app doesn't inherit your shell env, so fall back to a key
    saved at ~/.jarvis/anthropic_api_key (written by install.sh)."""
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
            "    pip install -r mac/requirements.txt\n"
            "(or: pip install sounddevice numpy faster-whisper)"
        )
    return np, sd


def record_push_to_talk(np, sd):
    """Record from the mic between two Enter presses."""
    input("\n🎙  Press Enter to speak…")
    frames: list = []
    recording = {"on": True}

    def callback(indata, _frames, _time, _status):
        if recording["on"]:
            frames.append(indata.copy())

    with sd.InputStream(
        samplerate=SAMPLE_RATE, channels=1, dtype="float32", callback=callback
    ):
        input("🔴 Recording… press Enter to stop.")
        recording["on"] = False

    if not frames:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(frames, axis=0).flatten()


def record_until_silence(np, sd, silence_secs=1.2, threshold=0.012, max_secs=30):
    """Hands-free capture: start on speech, stop after a beat of silence."""
    import time

    print("\n🎙  Listening… (just start talking)")
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
                    print("🔴 Recording…")
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
            sys.exit(
                "Missing faster-whisper. Install it with:\n"
                "    pip install faster-whisper"
            )
        print(f"⏳ Loading speech model '{self.model_name}' (first run downloads it)…")
        # int8 on CPU is plenty fast on Apple Silicon for the small models.
        self._model = WhisperModel(self.model_name, device="cpu", compute_type="int8")

    def transcribe(self, audio) -> str:
        self._load()
        segments, _info = self._model.transcribe(audio, language="en", vad_filter=True)
        return " ".join(seg.text for seg in segments).strip()


# --------------------------------------------------------------------------- #
# Speech out: macOS `say`
# --------------------------------------------------------------------------- #


def speak(text: str, voice: str | None):
    if not text:
        return
    if text.startswith("-"):
        # `say` would parse a leading dash as an option flag ("-7 degrees").
        text = " " + text
    cmd = ["say"]
    if voice:
        cmd += ["-v", voice]
    cmd.append(text)
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError:
        # Voice not installed — fall back to the system default.
        subprocess.run(["say", text], check=False)
    except FileNotFoundError:
        # Not on macOS (`say` missing) — just print.
        print("(text-to-speech unavailable; `say` not found)")


def list_voices():
    try:
        subprocess.run(["say", "-v", "?"], check=False)
    except FileNotFoundError:
        print("`say` is only available on macOS.")


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
        except urllib.error.HTTPError as err:
            # The Worker answered, so "is it running?" would be the wrong hint —
            # surface its actual error instead.
            if err.code == 404:
                raise RuntimeError(
                    f"Nothing answers at {self.url} (HTTP 404). JARVIS_URL/--url "
                    "should point at the Worker's /jarvis endpoint."
                ) from err
            try:
                detail = json.load(err).get("error", "")
            except (ValueError, OSError):
                detail = ""
            raise RuntimeError(
                f"The Jarvis Worker at {self.url} answered HTTP {err.code}"
                + (f": {detail}" if detail else ".")
                + "\nThe Worker is up but its brain failed — check that its "
                "ANTHROPIC_API_KEY secret is set and the D1 migration was "
                "applied (npx wrangler d1 migrations apply DB --remote)."
            ) from err
        except urllib.error.URLError as err:
            raise RuntimeError(
                f"Couldn't reach the Jarvis Worker at {self.url} ({err}).\n"
                "Is it running? Start it with `npm run dev` in the repo root, "
                "or set JARVIS_URL to your deployed Worker, or use --direct."
            ) from err
        except TimeoutError as err:
            raise RuntimeError(
                f"The Jarvis Worker at {self.url} took too long to answer."
            ) from err
        except ValueError as err:
            raise RuntimeError(
                f"The reply from {self.url} wasn't JSON — is that URL really "
                "the /jarvis endpoint?"
            ) from err
        return data.get("reply", "")


SYSTEM_PROMPT = (
    "You are Jarvis, a voice assistant on the user's Mac, modelled on Tony "
    "Stark's J.A.R.V.I.S.: unflappable, quietly witty, competent, and economical "
    "with words. Everything you say is read aloud, so reply in plain spoken "
    "English — no markdown, lists, code blocks, or emoji. Be brief: one to three "
    "sentences. Lead with the answer, skip preamble. If you don't know something "
    "or can't do it, say so plainly; don't invent facts. Respond only with what "
    "should be spoken — your final answer, nothing else."
)


class DirectBrain:
    """Calls Claude directly via the Anthropic Python SDK, with memory persisted
    to disk so Jarvis remembers across launches (this is the standalone brain —
    no Worker required)."""

    # How much history to send to the model — matches the Worker's HISTORY_LIMIT.
    MAX_CONTEXT_TURNS = 20

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
                "No Anthropic API key. Set ANTHROPIC_API_KEY, or run mac/install.sh "
                "to save one to ~/.jarvis/anthropic_api_key."
            )
        self._anthropic = anthropic
        self._client = anthropic.Anthropic()
        self.model = model
        self._path = memory_path(session) if persist else None
        self.history: list[dict] = self._load()

    def _load(self) -> list[dict]:
        if not (self._path and self._path.exists()):
            return []
        try:
            raw = json.loads(self._path.read_text())
        except (ValueError, OSError):
            return []
        if not isinstance(raw, list):
            return []
        # Keep only well-formed, non-empty turns. The API rejects empty content
        # blocks, so one bad row saved by an older build would otherwise wedge
        # every future conversation in this session.
        kept = [
            t
            for t in raw
            if isinstance(t, dict)
            and t.get("role") in ("user", "assistant")
            and isinstance(t.get("content"), str)
            and t["content"].strip()
        ]
        # Dropping a turn can leave two of the same role in a row, which the
        # API also rejects. Re-establish strict user/assistant alternation: in
        # a run of user turns keep the latest (the next answer responds to it);
        # in a run of assistant turns keep the first (it answers the question
        # before it).
        turns: list[dict] = []
        for t in kept:
            if turns and turns[-1]["role"] == t["role"]:
                if t["role"] == "user":
                    turns[-1] = t
                continue
            turns.append(t)
        # The conversation must open with a user turn…
        while turns and turns[0]["role"] != "user":
            turns.pop(0)
        # …and a crash mid-exchange can leave a dangling user message at the
        # end; drop it so the next turn starts clean.
        if turns and turns[-1]["role"] == "user":
            turns.pop()
        return turns

    def _save(self):
        if self._path:
            try:
                self._path.write_text(json.dumps(self.history))
            except OSError:
                pass

    def _context(self) -> list[dict]:
        turns = self.history[-self.MAX_CONTEXT_TURNS :]
        # The API requires the conversation to open with a user turn.
        while turns and turns[0]["role"] == "assistant":
            turns.pop(0)
        return turns

    def _explain(self, err) -> str:
        """Translate an Anthropic SDK error into one actionable spoken-world
        sentence (the talk loop prints RuntimeErrors instead of crashing)."""
        a = self._anthropic
        if isinstance(err, a.AuthenticationError):
            return (
                "Anthropic rejected the API key. Re-run mac/install.sh to save "
                "a valid key, or fix the ANTHROPIC_API_KEY environment variable."
            )
        if isinstance(err, a.NotFoundError):
            return (
                f"This API key can't use the model '{self.model}'. Try "
                "--claude-model claude-sonnet-4-6 (or set JARVIS_MODEL)."
            )
        if isinstance(err, a.RateLimitError):
            return (
                "Anthropic is rate-limiting requests — give it a moment and "
                "try again, or check your plan and credits."
            )
        if isinstance(err, a.APIConnectionError):
            return "Couldn't reach the Anthropic API. Check your internet connection."
        if isinstance(err, a.APIStatusError):
            return (
                f"The Anthropic API returned an error "
                f"({err.status_code}): {getattr(err, 'message', err)}"
            )
        return f"The Claude call failed: {err}"

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
        try:
            response = self._client.messages.create(
                model=self.model,
                max_tokens=1024,
                thinking={"type": "disabled"},  # snappy spoken replies
                system=SYSTEM_PROMPT,
                messages=self._context(),
            )
        except self._anthropic.AnthropicError as err:
            # Drop the failed turn so it can't poison the next one, and raise
            # the RuntimeError the talk loop already knows how to show.
            self.history.pop()
            raise RuntimeError(self._explain(err)) from err

        reply = " ".join(
            block.text for block in response.content if block.type == "text"
        ).strip()
        if not reply:
            # Never store an empty turn — the API rejects empty content blocks
            # on the next call, which would wedge the whole session.
            self.history.pop()
            return "Apologies — I didn't catch that. Could you say it again?"
        self.history.append({"role": "assistant", "content": reply})
        self._save()
        return reply


# --------------------------------------------------------------------------- #
# Main loop
# --------------------------------------------------------------------------- #


def main():
    parser = argparse.ArgumentParser(description="Jarvis voice assistant for macOS.")
    parser.add_argument("--direct", action="store_true", help="Call Claude directly instead of the Worker.")
    parser.add_argument("--auto", action="store_true", help="Hands-free: record until you stop talking.")
    parser.add_argument("--text", metavar="MSG", help="Send one typed message (skip the mic) and exit.")
    parser.add_argument("--voice", default=DEFAULT_VOICE, help=f"macOS voice (default: {DEFAULT_VOICE}).")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"Whisper model (default: {DEFAULT_MODEL}).")
    parser.add_argument("--url", default=DEFAULT_URL, help="Worker /jarvis endpoint.")
    parser.add_argument("--session", default=DEFAULT_SESSION, help="Conversation/session id.")
    parser.add_argument("--claude-model", default=DEFAULT_CLAUDE_MODEL, help="Claude model for --direct mode.")
    parser.add_argument("--list-voices", action="store_true", help="List installed macOS voices and exit.")
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
            sys.exit(f"\n⚠️  {err}\n")
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
                print("…didn't catch that.")
                continue
            print(f"You: {you}")

            try:
                reply = brain.ask(you)
            except RuntimeError as err:
                print(f"\n⚠️  {err}\n")
                continue

            print(f"Jarvis: {reply}")
            speak(reply, args.voice)
    except (KeyboardInterrupt, EOFError):
        # Ctrl-C, or Ctrl-D / closed stdin at one of the Enter prompts.
        print("\nGoodbye.")


if __name__ == "__main__":
    main()
