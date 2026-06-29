#!/usr/bin/env python3
"""
Jarvis Pi — a headless, always-on voice assistant appliance for Raspberry Pi.

The loop:

    "Hey Jarvis"  ─▶  record your command (until you stop talking)
                  ─▶  speech-to-text (local Whisper)
                  ─▶  the Jarvis brain (your Cloudflare Worker, so it shares the
                       same persona + long-term memory as the rest of Jarvis)
                  ─▶  spoken reply (Piper neural voice, or espeak-ng)

It is built to run under systemd on boot, headless — no keyboard or screen.
Configuration comes from the environment (the service loads /etc/jarvis/jarvis.conf).

It degrades gracefully: if the wake-word engine isn't installed it listens
continuously; if Piper isn't installed it falls back to espeak-ng; and a failure
in any single cycle is logged and the loop keeps going rather than crashing the
appliance.

Handy for setup/testing (these don't need the mic or wake word):

    python3 jarvis_pi.py --list-audio          # list input/output devices
    python3 jarvis_pi.py --text "what time is it?"   # one typed turn, spoken back
    python3 jarvis_pi.py --no-wake             # skip the wake word, listen continuously
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

SAMPLE_RATE = 16_000  # what Whisper and the wake-word model expect


def log(message: str) -> None:
    """Timestamped line to stdout — journald captures it under the service."""
    print(message, flush=True)


def _int_or_none(value: str | None):
    try:
        return int(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #


class Config:
    """Everything the appliance needs, drawn from env vars (+ a few CLI flags)."""

    def __init__(self, args: argparse.Namespace):
        self.url = args.url or os.environ.get("JARVIS_URL", "http://localhost:8787/jarvis")
        self.api_key = os.environ.get("JARVIS_API_KEY", "")
        self.session = os.environ.get("JARVIS_SESSION", "pi")

        self.direct = args.direct
        self.anthropic_model = os.environ.get("JARVIS_MODEL", "claude-opus-4-8")

        self.whisper_model = os.environ.get("WHISPER_MODEL", "tiny.en")

        wake = os.environ.get("JARVIS_WAKE_WORD", "hey_jarvis").strip()
        self.wake_model = wake
        self.wake_enabled = (not args.no_wake) and wake.lower() not in ("", "off", "none")
        self.wake_threshold = float(os.environ.get("JARVIS_WAKE_THRESHOLD", "0.5"))
        self.wake_phrase = "Hey Jarvis"

        self.tts = os.environ.get("JARVIS_TTS", "piper").strip().lower()
        self.piper_bin = os.environ.get("PIPER_BIN", "piper")
        self.piper_model = os.environ.get("PIPER_MODEL", "")
        self.espeak_voice = os.environ.get("ESPEAK_VOICE", "en-gb")

        self.input_device = _int_or_none(os.environ.get("JARVIS_INPUT_DEVICE"))
        self.greeting = os.environ.get("JARVIS_GREETING", "Jarvis online.").strip()

        # The on-screen JARVIS HUD (served locally for a kiosk browser).
        self.hud_enabled = os.environ.get("JARVIS_HUD", "on").strip().lower() not in (
            "0", "off", "false", "no",
        )
        self.hud_host = os.environ.get("JARVIS_HUD_HOST", "127.0.0.1")
        self.hud_port = int(os.environ.get("JARVIS_HUD_PORT", "8088"))
        _here = os.path.dirname(os.path.abspath(__file__))
        self.hud_dir = os.environ.get("JARVIS_HUD_DIR", os.path.join(_here, "hud"))


# --------------------------------------------------------------------------- #
# HUD state + local server (drives the on-screen animation)
# --------------------------------------------------------------------------- #


class AppState:
    """Thread-safe snapshot of what the HUD should show right now."""

    def __init__(self):
        self._lock = threading.Lock()
        self._d = {"state": "idle", "you": "", "reply": "", "level": 0.0, "ts": 0}

    def set(self, **kw) -> None:
        with self._lock:
            self._d.update(kw)
            self._d["ts"] = int(time.time() * 1000)

    def snapshot(self) -> dict:
        with self._lock:
            return dict(self._d)


def start_hud_server(cfg: Config, app_state: AppState) -> None:
    """Serve the HUD files + a /state endpoint the page polls, on a daemon thread."""
    hud_dir = cfg.hud_dir

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=hud_dir, **k)

        def log_message(self, *a):  # keep journald quiet
            pass

        def do_GET(self):  # noqa: N802 — http.server naming
            if self.path.split("?")[0] == "/state":
                body = json.dumps(app_state.snapshot()).encode()
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("cache-control", "no-store")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            super().do_GET()

    try:
        server = ThreadingHTTPServer((cfg.hud_host, cfg.hud_port), Handler)
    except OSError as err:
        log(f"HUD server couldn't start ({err}); continuing without the display.")
        return
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log(f"HUD online at http://{cfg.hud_host}:{cfg.hud_port}/")


# --------------------------------------------------------------------------- #
# Brain — where an utterance becomes a reply
# --------------------------------------------------------------------------- #


# A real User-Agent: Cloudflare's bot protection 403s the default urllib one.
_USER_AGENT = "Jarvis-Pi/1.0 (+https://github.com/kadehadley-cyber/wolf-ridge-capitol-api)"


class WorkerBrain:
    """Talks to the Cloudflare Worker's /jarvis endpoint (shared brain + memory).

    On any failure it returns a short *spoken* sentence rather than raising, so
    the appliance tells you what's wrong instead of going silent or crashing.
    """

    def __init__(self, cfg: Config):
        self.url = cfg.url
        self.session = cfg.session
        self.api_key = cfg.api_key

    def ask(self, text: str) -> str:
        payload = json.dumps({"text": text, "sessionId": self.session}).encode()
        headers = {
            "content-type": "application/json",
            "accept": "application/json",
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
                return "I'm not authorised to reach my brain. The A.P.I. key needs checking."
            if err.code == 403:
                return "My connection was blocked before it reached my brain."
            return f"My brain returned an error, code {err.code}."
        except urllib.error.URLError:
            return "I couldn't reach my brain just now. I'll be right here when the connection is back."
        except (ValueError, OSError):
            return "Something went wrong talking to my brain."
        reply = data.get("reply", "")
        return reply if isinstance(reply, str) else ""


class DirectBrain:
    """Standalone fallback: call Claude directly (no Worker, no shared memory)."""

    def __init__(self, cfg: Config):
        try:
            import anthropic
        except ImportError:
            sys.exit("Direct mode needs the Anthropic SDK: pip install anthropic")
        if not os.environ.get("ANTHROPIC_API_KEY"):
            sys.exit("Direct mode needs ANTHROPIC_API_KEY in the environment.")
        self._client = anthropic.Anthropic()
        self.model = cfg.anthropic_model
        self.history: list[dict] = []

    _SYSTEM = (
        "You are Jarvis, a voice assistant modelled on Tony Stark's J.A.R.V.I.S.: "
        "unflappable, quietly witty, economical with words. Everything you say is "
        "read aloud, so reply in plain spoken English — no markdown or lists. Be "
        "brief, one to three sentences, lead with the answer. If you can't do "
        "something, say so plainly; never invent facts."
    )

    def ask(self, text: str) -> str:
        self.history.append({"role": "user", "content": text})
        try:
            resp = self._client.messages.create(
                model=self.model,
                max_tokens=1024,
                thinking={"type": "disabled"},
                system=self._SYSTEM,
                messages=self.history,
            )
        except Exception as err:  # noqa: BLE001 — speak any API error, don't crash
            log(f"Anthropic error: {err}")
            return "I'm having trouble thinking right now."
        reply = " ".join(b.text for b in resp.content if b.type == "text").strip()
        self.history.append({"role": "assistant", "content": reply})
        return reply


def make_brain(cfg: Config):
    return DirectBrain(cfg) if cfg.direct else WorkerBrain(cfg)


# --------------------------------------------------------------------------- #
# Speech out — Piper (neural) with an espeak-ng fallback
# --------------------------------------------------------------------------- #


def speak(text: str, cfg: Config) -> None:
    if not text:
        return
    if cfg.tts == "piper" and cfg.piper_model:
        try:
            wav = "/tmp/jarvis_tts.wav"
            subprocess.run(
                [cfg.piper_bin, "--model", cfg.piper_model, "--output_file", wav],
                input=text.encode(),
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            subprocess.run(["aplay", "-q", wav], check=False)
            return
        except (FileNotFoundError, subprocess.CalledProcessError) as err:
            log(f"Piper TTS failed ({err}); falling back to espeak-ng.")
    try:
        subprocess.run(["espeak-ng", "-v", cfg.espeak_voice, text], check=False)
    except FileNotFoundError:
        log(f"(no text-to-speech available) Jarvis: {text}")


# --------------------------------------------------------------------------- #
# Speech in — wake word + voice capture + transcription
# --------------------------------------------------------------------------- #


class Transcriber:
    """Lazily-loaded local Whisper model (faster-whisper)."""

    def __init__(self, model_name: str):
        self.model_name = model_name
        self._model = None

    def _load(self):
        if self._model is not None:
            return
        from faster_whisper import WhisperModel

        log(f"Loading speech model '{self.model_name}'…")
        # int8 on CPU is the right tradeoff on a Raspberry Pi.
        self._model = WhisperModel(self.model_name, device="cpu", compute_type="int8")

    def transcribe(self, audio) -> str:
        self._load()
        segments, _info = self._model.transcribe(audio, language="en", vad_filter=True)
        return " ".join(seg.text for seg in segments).strip()


class Listener:
    """Waits for the wake word (if enabled), then captures the spoken command."""

    def __init__(self, cfg: Config, app_state: AppState):
        import numpy as np
        import sounddevice as sd

        self.np = np
        self.sd = sd
        self.cfg = cfg
        self.state = app_state
        self.oww = None

        if cfg.wake_enabled:
            try:
                from openwakeword.model import Model

                self.oww = Model(wakeword_models=[cfg.wake_model])
                log(f"Wake word active — say “{cfg.wake_phrase}”.")
            except Exception as err:  # noqa: BLE001 — fall back to always-listening
                log(f"Wake word unavailable ({err}); listening continuously instead.")

    def wait_for_command(self):
        """Block until a command has been spoken; return its audio (float32)."""
        if self.oww is not None:
            self.state.set(state="idle", level=0.0)
            self._await_wake_word()
        return self._record_until_silence()

    def _await_wake_word(self) -> None:
        np, sd = self.np, self.sd
        block = 1280  # 80 ms at 16 kHz — openWakeWord's expected frame size
        self.oww.reset()
        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="int16",
            blocksize=block,
            device=self.cfg.input_device,
        ) as stream:
            while True:
                data, _ = stream.read(block)
                scores = self.oww.predict(data.flatten())
                if scores.get(self.cfg.wake_model, 0.0) >= self.cfg.wake_threshold:
                    return

    def _record_until_silence(
        self, silence_secs: float = 1.0, threshold: float = 0.012, max_secs: float = 15.0
    ):
        np, sd = self.np, self.sd
        log("Listening…")
        self.state.set(state="listening", level=0.0)
        frames: list = []
        block = int(SAMPLE_RATE * 0.1)  # 100 ms blocks
        started = False
        silent_for = 0.0
        start = time.time()

        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="float32",
            blocksize=block,
            device=self.cfg.input_device,
        ) as stream:
            while True:
                data, _ = stream.read(block)
                mono = data.flatten()
                level = float(np.sqrt(np.mean(mono**2))) if mono.size else 0.0
                # Feed the HUD a 0..1 level so its equalizer tracks your voice.
                self.state.set(level=min(1.0, level / 0.15))

                if level >= threshold:
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


def list_audio() -> None:
    try:
        import sounddevice as sd
    except ImportError:
        sys.exit("Audio libraries aren't installed yet. Run pi/install.sh first.")
    print(sd.query_devices())


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #


def main() -> None:
    parser = argparse.ArgumentParser(description="Jarvis voice appliance for Raspberry Pi.")
    parser.add_argument("--direct", action="store_true", help="Call Claude directly instead of the Worker.")
    parser.add_argument("--no-wake", action="store_true", help="Skip the wake word; listen continuously.")
    parser.add_argument("--text", metavar="MSG", help="Send one typed message, speak the reply, and exit.")
    parser.add_argument("--url", help="Worker /jarvis endpoint (overrides JARVIS_URL).")
    parser.add_argument("--list-audio", action="store_true", help="List audio devices and exit.")
    args = parser.parse_args()

    if args.list_audio:
        list_audio()
        return

    cfg = Config(args)
    brain = make_brain(cfg)

    # One-shot text mode: great for confirming the brain + speakers work.
    if args.text:
        reply = brain.ask(args.text)
        log(f"Jarvis: {reply}")
        speak(reply, cfg)
        return

    app_state = AppState()
    if cfg.hud_enabled:
        start_hud_server(cfg, app_state)

    transcriber = Transcriber(cfg.whisper_model)
    listener = Listener(cfg, app_state)

    log(f"Jarvis Pi online (brain: {'Claude direct' if cfg.direct else cfg.url}).")
    if cfg.greeting:
        app_state.set(state="speaking", reply=cfg.greeting)
        speak(cfg.greeting, cfg)
    app_state.set(state="idle", reply="")

    while True:
        try:
            audio = listener.wait_for_command()  # sets listening + mic level
            if audio is None or audio.size == 0:
                app_state.set(state="idle")
                continue
            app_state.set(state="thinking")
            you = transcriber.transcribe(audio)
            if not you:
                app_state.set(state="idle")
                continue
            log(f"You: {you}")
            app_state.set(you=you)
            reply = brain.ask(you)
            log(f"Jarvis: {reply}")
            app_state.set(state="speaking", reply=reply)
            speak(reply, cfg)
            app_state.set(state="idle")
        except KeyboardInterrupt:
            log("Shutting down.")
            break
        except Exception as err:  # noqa: BLE001 — one bad cycle must not kill the daemon
            log(f"Cycle error: {err}")
            app_state.set(state="idle")
            time.sleep(1)


if __name__ == "__main__":
    main()
