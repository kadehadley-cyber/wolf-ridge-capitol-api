#!/usr/bin/env python3
"""
Jarvis Desktop — turn this computer into J.A.R.V.I.S.

Double-click launch opens a window with the animated arc-reactor HUD and starts
the voice loop: say "Hey Jarvis ..." (wake word), or use push-to-talk. Speech is
transcribed locally with Whisper, thought about by your Cloudflare Worker (the
same brain, tools, and long-term memory as every other Jarvis surface — weather,
math, reminders, directions, smart home, named devices), and spoken back with
your platform's voice.

It can also SEE. Say things like:
    "Jarvis, what's on my screen?"        -> captures a screenshot
    "Jarvis, what am I looking at?"       -> webcam if available, else the screen
and the image is sent along to Claude vision for identification.

Cross-platform: macOS, Windows, Linux. Modes:
    python3 jarvis_desktop.py             # HUD window + wake word (or push-to-talk)
    python3 jarvis_desktop.py --push      # push-to-talk (Enter to start/stop)
    python3 jarvis_desktop.py --auto      # hands-free voice activity detection
    python3 jarvis_desktop.py --no-hud    # voice only, no window
    python3 jarvis_desktop.py --text "…"  # one typed turn (no mic)
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

SAMPLE_RATE = 16_000
STATE_DIR = pathlib.Path.home() / ".jarvis"
CONFIG_PATH = STATE_DIR / "desktop.json"
HUD_DIR = pathlib.Path(__file__).resolve().parent.parent / "pi" / "hud"

_USER_AGENT = "Jarvis-Desktop/1.0 (+https://github.com/kadehadley-cyber/wolf-ridge-capitol-api)"

# Utterances that should carry an image along to the brain.
SCREEN_RE = re.compile(
    r"\b(on my screen|at my screen|see my screen|read my screen|screenshot)\b", re.I
)
CAMERA_RE = re.compile(
    r"\b(what am i looking at|what do you see|through the camera|identify this|what is this)\b",
    re.I,
)


def log(msg: str) -> None:
    print(msg, flush=True)


def _stdin_is_interactive() -> bool:
    """True only when input() can actually read from a person. Guards prompts and
    push-to-talk against GUI/double-click launches with no console, where input()
    raises EOFError immediately."""
    try:
        return bool(sys.stdin) and sys.stdin.isatty()
    except (ValueError, OSError):
        return False


# --------------------------------------------------------------------------- #
# Configuration: env > ~/.jarvis/desktop.json > first-run prompt
# --------------------------------------------------------------------------- #


class Config:
    def __init__(self, args: argparse.Namespace):
        saved: dict = {}
        if CONFIG_PATH.exists():
            try:
                saved = json.loads(CONFIG_PATH.read_text())
            except (ValueError, OSError):
                saved = {}

        self.url = args.url or os.environ.get("JARVIS_URL") or saved.get("url") or ""
        self.api_key = os.environ.get("JARVIS_API_KEY") or saved.get("api_key") or ""
        self.session = os.environ.get("JARVIS_SESSION", saved.get("session", "desktop"))
        self.whisper_model = os.environ.get("WHISPER_MODEL", saved.get("whisper_model", "base.en"))
        self.voice = os.environ.get("JARVIS_VOICE", saved.get("voice", ""))
        self.hud_port = int(os.environ.get("JARVIS_HUD_PORT", saved.get("hud_port", 8090)))
        self.wake_threshold = float(
            os.environ.get("JARVIS_WAKE_THRESHOLD", saved.get("wake_threshold", 0.5))
        )
        # After a reply, keep listening this many seconds for a follow-up (no
        # wake word needed). 0 turns the conversation window off.
        self.followup_secs = float(
            os.environ.get("JARVIS_FOLLOWUP", saved.get("followup_secs", 6))
        )

        # First run: ask once, save, and never ask again. This needs an interactive
        # console — when there's no usable stdin (double-clicked via pythonw, a GUI
        # launcher, systemd) input() would raise EOFError and kill the app before
        # anything appears. Fail with a clear, actionable message instead.
        if not self.url:
            if not _stdin_is_interactive():
                raise SystemExit(
                    "Jarvis isn't configured yet. Run it once from a terminal to set "
                    "your Worker URL, or set the JARVIS_URL environment variable "
                    f"(saved to {CONFIG_PATH})."
                )
            print("First run — point Jarvis at your Worker.")
            self.url = input("  Worker /jarvis URL: ").strip()
            if not self.api_key:
                self.api_key = input("  JARVIS_API_KEY (blank if none): ").strip()
            if not self.url:
                raise SystemExit("No Worker URL given; nothing to point Jarvis at.")
            try:
                STATE_DIR.mkdir(parents=True, exist_ok=True)
                CONFIG_PATH.write_text(
                    json.dumps({"url": self.url, "api_key": self.api_key}, indent=2)
                )
                print(f"  Saved to {CONFIG_PATH}\n")
            except OSError:
                pass


# --------------------------------------------------------------------------- #
# HUD: serve pi/hud + a /state endpoint, show it in a window
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


def start_hud_server(port: int, state: AppState) -> bool:
    if not HUD_DIR.is_dir():
        log(f"HUD assets not found at {HUD_DIR}; running without the display.")
        return False
    hud_dir = str(HUD_DIR)

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=hud_dir, **k)

        def log_message(self, *a):
            pass

        def do_GET(self):  # noqa: N802
            if self.path.split("?")[0] == "/state":
                # default=float: numpy scalars (wake scores, levels) must never
                # be able to crash the HUD poller.
                body = json.dumps(state.snapshot(), default=float).encode()
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("cache-control", "no-store")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            super().do_GET()

    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError as err:
        log(f"HUD server couldn't start ({err}); running without the display.")
        return False
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return True


def open_hud_window(port: int) -> None:
    """Show the HUD. pywebview gives a real app window (and must own the main
    thread); otherwise fall back to the default browser. The broad except
    matters: on Windows a missing WebView2 runtime makes webview.start() throw,
    and that must not take the whole app down with it."""
    url = f"http://127.0.0.1:{port}/"
    try:
        import webview  # pywebview

        webview.create_window("J.A.R.V.I.S.", url, width=1100, height=680, background_color="#02060b")
        webview.start()  # blocks until the window closes
        return
    except Exception as err:  # noqa: BLE001 — ImportError, missing WebView2, GUI trouble
        log(f"HUD window unavailable ({err}); opening in your browser instead.")
    import webbrowser

    webbrowser.open(url)
    # No window to block on — keep the process alive for the voice loop.
    while True:
        time.sleep(3600)


# --------------------------------------------------------------------------- #
# Sight: screenshots and (optionally) the webcam
# --------------------------------------------------------------------------- #

MAX_IMAGE_SIDE = 1568  # Claude vision's sweet spot; keeps uploads small


def _encode_jpeg(pil_image) -> tuple[str, str]:
    buf = io.BytesIO()
    pil_image.convert("RGB").save(buf, format="JPEG", quality=80)
    return base64.b64encode(buf.getvalue()).decode(), "image/jpeg"


def capture_screen() -> tuple[str, str] | None:
    """Grab the primary monitor, downscaled for the wire. Returns (b64, type)."""
    try:
        import mss
        from PIL import Image
    except ImportError:
        log("Screen capture needs the mss + pillow packages.")
        return None
    try:
        with mss.mss() as sct:
            shot = sct.grab(sct.monitors[1])
            img = Image.frombytes("RGB", shot.size, shot.rgb)
        img.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
        return _encode_jpeg(img)
    except Exception as err:  # noqa: BLE001
        log(f"Screen capture failed: {err}")
        return None


def capture_camera() -> tuple[str, str] | None:
    """One webcam frame, if OpenCV is installed. Returns (b64, type) or None."""
    try:
        import cv2
        from PIL import Image
    except ImportError:
        return None
    try:
        cam = cv2.VideoCapture(0)
        ok, frame = cam.read()
        cam.release()
        if not ok:
            return None
        img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        img.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
        return _encode_jpeg(img)
    except Exception:  # noqa: BLE001
        return None


def image_for_utterance(text: str) -> tuple[str, str] | None:
    """Decide whether this utterance should carry an image, and capture it."""
    if SCREEN_RE.search(text):
        return capture_screen()
    if CAMERA_RE.search(text):
        return capture_camera() or capture_screen()
    return None


# --------------------------------------------------------------------------- #
# The brain
# --------------------------------------------------------------------------- #


class WorkerBrain:
    def __init__(self, cfg: Config):
        self.url = cfg.url
        self.session = cfg.session
        self.api_key = cfg.api_key

    def ask(self, text: str, image: tuple[str, str] | None = None) -> str:
        payload: dict = {"text": text, "sessionId": self.session}
        if image:
            payload["imageBase64"], payload["imageType"] = image
        headers = {
            "content-type": "application/json",
            "accept": "application/json",
            "user-agent": _USER_AGENT,
        }
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"
        req = urllib.request.Request(
            self.url, data=json.dumps(payload).encode(), headers=headers
        )
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = json.load(resp)
        except urllib.error.HTTPError as err:
            if err.code == 401:
                return "I'm not authorised to reach my brain — the A.P.I. key needs checking."
            if err.code == 403:
                return "My connection was blocked before it reached my brain."
            if err.code == 413:
                return "That image was too large to send."
            return f"My brain returned an error, code {err.code}."
        except urllib.error.URLError:
            return "I couldn't reach my brain just now. Check the network and my Worker URL."
        except (ValueError, OSError):
            return "Something went wrong talking to my brain."
        reply = data.get("reply", "")
        return reply if isinstance(reply, str) else ""


# --------------------------------------------------------------------------- #
# Speech out — per-platform, no extra services
# --------------------------------------------------------------------------- #


# Microsoft's neural voices (the engine behind Edge's Read Aloud): keyless,
# natural, and a world away from classic SAPI. Ryan is a calm British male —
# the closest stock voice to the J.A.R.V.I.S. of the films.
DEFAULT_EDGE_VOICE = "en-GB-RyanNeural"
EDGE_VOICE_RE = re.compile(r"^[a-z]{2,3}-[A-Za-z]{2,}-\w+Neural$")

# The wearer's own J.A.R.V.I.S. voice: put a clean speech sample at
# voices/jarvis_voice.wav (or point JARVIS_VOICE_SAMPLE at one) and Jarvis
# clones it locally with XTTS for every reply. The cloning stack is an
# optional install (requirements-voice.txt — it pulls PyTorch); without it,
# the closest stock voice steps in so nothing ever goes silent.
VOICES_DIR = pathlib.Path(__file__).resolve().parent / "voices"
DEFAULT_VOICE_SAMPLE = VOICES_DIR / "jarvis_voice.wav"
# The bundled sample is an Australian male, so the stock stand-in is too.
SAMPLE_FALLBACK_EDGE_VOICE = "en-AU-WilliamNeural"

_CLONE = {"tts": None, "dead": False}


def _voice_sample_path():
    override = os.environ.get("JARVIS_VOICE_SAMPLE", "").strip()
    if override:
        p = pathlib.Path(override)
        return p if p.is_file() else None
    return DEFAULT_VOICE_SAMPLE if DEFAULT_VOICE_SAMPLE.is_file() else None


def _default_edge_voice():
    return SAMPLE_FALLBACK_EDGE_VOICE if _voice_sample_path() is not None else DEFAULT_EDGE_VOICE


def _speak_clone(text: str) -> bool:
    """Speak in the cloned voice (local XTTS). Returns False on any failure —
    package not installed, model trouble, playback — so callers fall back."""
    sample = _voice_sample_path()
    if sample is None or _CLONE["dead"]:
        return False
    try:
        if _CLONE["tts"] is None:
            from TTS.api import TTS  # coqui-tts — the optional cloning stack

            log("Loading the cloned Jarvis voice (first use downloads the model)…")
            _CLONE["tts"] = TTS("tts_models/multilingual/multi-dataset/xtts_v2")
            log("Cloned voice ready.")
        wav = os.path.join(tempfile.gettempdir(), "jarvis_clone.wav")
        _CLONE["tts"].tts_to_file(
            text=text, speaker_wav=str(sample), language="en", file_path=wav
        )
        ok = _play_mp3(wav)  # av decodes wav just as happily
        try:
            os.remove(wav)
        except OSError:
            pass
        return ok
    except ImportError:
        log(
            "Custom voice sample found, but the cloning stack isn't installed. "
            "Enable it with: .venv\\Scripts\\pip install -r requirements-voice.txt "
            "— using the closest stock voice meanwhile."
        )
        _CLONE["dead"] = True  # log once, don't retry every reply
        return False
    except Exception as err:  # noqa: BLE001
        log(f"Cloned voice unavailable ({err}); using the stock voice.")
        _CLONE["dead"] = True
        return False


def _wants_edge(voice: str) -> bool:
    """Neural voices are the default wherever the platform voice is worse
    (Windows SAPI, Linux espeak) — unless the wearer forces the classic engine
    with JARVIS_TTS=sapi/espeak/say, or names a non-neural platform voice."""
    if os.environ.get("JARVIS_TTS", "").lower() in ("sapi", "espeak", "say", "off"):
        return False
    return not voice or bool(EDGE_VOICE_RE.match(voice))


def speak(text: str, voice: str) -> None:
    if not text:
        return
    # A reply starting with "-" ("-7 degrees outside, sir.") reads to `say` and
    # espeak-ng as an option flag and is silently never spoken. A leading space
    # keeps it an argument without changing the speech.
    guarded = f" {text}" if text.startswith("-") else text
    try:
        # The wearer's own cloned voice comes first on every platform when a
        # sample is present (and the classic engine isn't forced).
        if _wants_edge(voice) and _speak_clone(text):
            return
        if sys.platform == "darwin":
            # macOS `say` voices are already natural; neural only on request.
            if voice and EDGE_VOICE_RE.match(voice) and _speak_edge(text, voice):
                return
            cmd = ["say"] + (["-v", voice] if voice else [])
            if subprocess.run(cmd + [guarded], check=False).returncode != 0 and voice:
                subprocess.run(["say", guarded], check=False)
        elif sys.platform.startswith("win"):
            # Neural next; classic System.Speech only as the offline fallback.
            if _wants_edge(voice) and _speak_edge(text, voice or _default_edge_voice()):
                return
            _speak_windows(text, voice if not EDGE_VOICE_RE.match(voice or "") else "")
        else:
            piper_bin = os.environ.get("PIPER_BIN")
            piper_model = os.environ.get("PIPER_MODEL")
            if piper_bin and piper_model:
                wav = os.path.join(tempfile.gettempdir(), "jarvis_tts.wav")
                subprocess.run(
                    [piper_bin, "--model", piper_model, "--output_file", wav],
                    input=text.encode(), check=True,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
                subprocess.run(["aplay", "-q", wav], check=False)
            elif _wants_edge(voice) and _speak_edge(text, voice or _default_edge_voice()):
                return
            else:
                subprocess.run(["espeak-ng", "-v", "en-gb", guarded], check=False)
    except (OSError, subprocess.CalledProcessError):
        # OSError covers a missing binary (FileNotFoundError) and permission/spawn
        # failures alike, so a TTS hiccup never kills the turn — Jarvis prints.
        log(f"(no text-to-speech available) Jarvis: {text}")


def _speak_edge(text: str, voice: str) -> bool:
    """Speak with a Microsoft neural voice (keyless, needs network). Returns
    False on ANY failure — offline, package missing, playback trouble — so the
    caller falls back to the platform engine instead of going silent."""
    mp3 = os.path.join(tempfile.gettempdir(), "jarvis_tts.mp3")
    try:
        import asyncio

        import edge_tts

        asyncio.run(edge_tts.Communicate(text, voice).save(mp3))
        return _play_mp3(mp3)
    except Exception:  # noqa: BLE001 — silence here must never mean silence out loud
        return False
    finally:
        try:
            os.remove(mp3)
        except OSError:
            pass


def _play_mp3(path: str) -> bool:
    """Decode with av (already installed for Whisper) and play via sounddevice."""
    try:
        import av
        import numpy as np
        import sounddevice as sd

        rate = 24_000
        pcm = []
        with av.open(path) as container:
            resampler = av.audio.resampler.AudioResampler(
                format="s16", layout="mono", rate=rate
            )
            for frame in container.decode(audio=0):
                for out in resampler.resample(frame):
                    pcm.append(out.to_ndarray())
        if not pcm:
            return False
        audio = np.concatenate(pcm, axis=1).flatten().astype(np.float32) / 32768.0
        sd.play(audio, rate)
        sd.wait()
        return True
    except Exception:  # noqa: BLE001
        return False


def _speak_windows(text: str, voice: str) -> None:
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
        f.write(text)
        path = f.name
    # In a PowerShell single-quoted literal the only escape is a doubled quote —
    # needed when the temp path contains one (e.g. C:\Users\O'Brien\...).
    ps_path = path.replace("'", "''")
    script = (
        "$ErrorActionPreference='SilentlyContinue';"
        "Add-Type -AssemblyName System.Speech;"
        "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;"
        "if($env:JARVIS_TTS_VOICE){try{$s.SelectVoice($env:JARVIS_TTS_VOICE)}catch{}};"
        "if($env:JARVIS_TTS_RATE){try{$s.Rate=[int]$env:JARVIS_TTS_RATE}catch{}};"
        f"$t=Get-Content -Raw -Encoding UTF8 -LiteralPath '{ps_path}';"
        "if($t){$s.Speak($t)};"
    )
    env = dict(os.environ)
    if voice:
        env["JARVIS_TTS_VOICE"] = voice
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
            env=env, check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


# --------------------------------------------------------------------------- #
# Speech in — capture, wake word, transcription
# --------------------------------------------------------------------------- #


class Transcriber:
    def __init__(self, model_name: str):
        self.model_name = model_name
        self._model = None
        self._lock = threading.Lock()

    def _ensure_model(self):
        # Lock so the background warmup and the first real transcription can't
        # both build the model.
        with self._lock:
            if self._model is None:
                from faster_whisper import WhisperModel

                log(f"Loading speech model '{self.model_name}' (first run downloads it)…")
                self._model = WhisperModel(self.model_name, device="cpu", compute_type="int8")
            return self._model

    def warmup(self) -> None:
        """Load the model in the background at startup, so the FIRST command
        doesn't sit in silence while Whisper downloads and initialises."""
        try:
            self._ensure_model()
            log("Speech model ready.")
        except Exception as err:  # noqa: BLE001 — retried on first real use
            log(f"Speech model preload failed ({err}); will retry when needed.")

    def transcribe(self, audio) -> str:
        segments, _ = self._ensure_model().transcribe(audio, language="en", vad_filter=True)
        return " ".join(seg.text for seg in segments).strip()


class Listener:
    """Wake-word / VAD / push-to-talk capture, reporting levels to the HUD."""

    def __init__(self, cfg: Config, state: AppState, mode: str):
        import numpy as np
        import sounddevice as sd

        self.np, self.sd, self.cfg, self.state = np, sd, cfg, state
        self.mode = mode
        # Which microphone: JARVIS_INPUT_DEVICE picks by index or name substring;
        # unset uses the system default. Say which one we're on — a wrong device
        # (continuity mic, an aggregate, a muted interface) hears only silence.
        self.input_device = self._pick_input_device(os.environ.get("JARVIS_INPUT_DEVICE"))
        try:
            dev = sd.query_devices(
                self.input_device if self.input_device is not None else None, "input"
            )
            log(f"Microphone: {dev['name']}")
        except Exception:  # noqa: BLE001 — purely informational
            pass
        self.oww = None
        if mode == "wake":
            try:
                from openwakeword.model import Model

                # The pip package ships no model weights — fetch them once (a no-op
                # if already cached). Without this, Model() raises on a fresh
                # install and the advertised "Hey Jarvis" mode silently never works.
                try:
                    import openwakeword.utils as oww_utils

                    try:
                        oww_utils.download_models(model_names=["hey_jarvis"])
                    except TypeError:  # older signature takes no args
                        oww_utils.download_models()
                except Exception:  # noqa: BLE001 — let Model() surface the real cause
                    pass
                try:
                    self.oww = Model(wakeword_models=["hey_jarvis"])
                except Exception:  # noqa: BLE001
                    # Windows/macOS installs have no tflite runtime (the wheel is
                    # Linux-only); the .onnx models were downloaded alongside, so
                    # retry explicitly on onnxruntime before giving up.
                    self.oww = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")
                log("Wake word active — say “Hey Jarvis”.")
            except Exception as err:  # noqa: BLE001
                # No console (HUD double-click) → push-to-talk's input() can't be
                # reached, so fall back to hands-free VAD instead, which works
                # behind the window. With a console, push-to-talk is the nicer default.
                fallback = "push" if _stdin_is_interactive() else "auto"
                log(f"Wake word unavailable ({err}); falling back to {fallback}.")
                self.mode = fallback

    def _pick_input_device(self, want):
        """None → system default; digits → device index; else name substring."""
        if not want:
            return None
        want = want.strip()
        if want.isdigit():
            return int(want)
        try:
            for i, dev in enumerate(self.sd.query_devices()):
                if dev.get("max_input_channels", 0) > 0 and want.lower() in dev["name"].lower():
                    return i
        except Exception:  # noqa: BLE001
            pass
        log(f'No input device matching "{want}"; using the system default.')
        return None

    def wait_for_command(self):
        if self.mode == "wake" and self.oww is not None:
            self.state.set(state="idle", level=0.0)
            self._await_wake()
            return self._record_until_silence()
        if self.mode == "auto":
            return self._record_until_silence(wait_for_speech=True)
        # Guard before touching input(): with no usable console it raises EOFError
        # (closed stdin) or RuntimeError (pythonw's stdin is None), and the loop's
        # broad `except Exception` would spin on either once a second forever.
        if not _stdin_is_interactive():
            raise SystemExit("Push-to-talk needs a console; none is attached.")
        try:
            input("\n[mic] Press Enter to speak…")
        except (EOFError, RuntimeError) as err:
            raise SystemExit("Push-to-talk needs a console; none is attached.") from err
        return self._record_push()

    # Sustained input this quiet means the app is getting digital silence —
    # denied mic permission (macOS delivers zeros, not an error) or a dead
    # default device (an external monitor's phantom mic, a muted interface).
    SILENCE_LEVEL = 0.003
    SILENCE_SECS = 20

    def _await_wake(self):
        block = 1280  # 80 ms frames, what openWakeWord expects
        # JARVIS_WAKE_DEBUG=1 prints a once-a-second line with the peak wake
        # score and mic level, so "it never triggers" separates cleanly into
        # silent mic (level ~0), low scores (threshold), or a code bug.
        debug = os.environ.get("JARVIS_WAKE_DEBUG", "") not in ("", "0")
        peak = lvl = 0.0
        last_report = start = time.time()
        heard_anything = False
        warned_silent = False
        self.oww.reset()
        with self.sd.InputStream(
            samplerate=SAMPLE_RATE, channels=1, dtype="int16", blocksize=block,
            device=self.input_device,
        ) as stream:
            while True:
                data, _ = stream.read(block)
                mono = data.flatten()
                scores = self.oww.predict(mono)
                # openwakeword keys its scores by the model FILE's stem
                # ("hey_jarvis_v0.1"), not the name we requested — looking up
                # "hey_jarvis" always misses and the wake word never fires.
                # Only our wakeword model is loaded, so take the best score.
                # float() matters: the scores are numpy float32, which the
                # HUD's /state JSON encoder refuses.
                score = float(max(scores.values(), default=0.0))
                level = float(self.np.abs(mono).max()) / 32768.0 if mono.size else 0.0
                heard_anything = heard_anything or level >= self.SILENCE_LEVEL
                peak = max(peak, score)
                lvl = max(lvl, level)
                now = time.time()
                if now - last_report >= 0.25:
                    # Live diagnostics on the HUD: the ring breathes with room
                    # sound in standby, and MIC/WAKE numbers show what's heard.
                    self.state.set(level=min(1.0, lvl / 0.15), miclevel=round(lvl, 3),
                                   wake=round(peak, 3))
                    if debug and now - last_report >= 1.0:
                        log(f"[wake] peak score {peak:.3f} | mic level {lvl:.3f} | threshold {self.cfg.wake_threshold}")
                    peak = lvl = 0.0
                    last_report = now
                if (not heard_anything and not warned_silent
                        and now - start >= self.SILENCE_SECS):
                    warned_silent = True
                    hint = (
                        "I can't hear the microphone at all. On a Mac: System Settings, "
                        "Privacy and Security, Microphone — allow your terminal app, then "
                        "relaunch me. Or pick a mic: JARVIS_INPUT_DEVICE=MacBook, "
                        "or run ./jarvis --mic-test."
                    )
                    log(hint)
                    self.state.set(reply=hint)
                if score >= self.cfg.wake_threshold:
                    log("Wake word heard.")
                    return

    def _record_push(self):
        np, sd = self.np, self.sd
        frames: list = []
        rec = {"on": True}
        self.state.set(state="listening", level=0.4)

        def cb(indata, *_):
            if rec["on"]:
                frames.append(indata.copy())

        with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32", callback=cb,
                            device=self.input_device):
            input("[rec] Recording… press Enter to stop.")
            rec["on"] = False
        return np.concatenate(frames).flatten() if frames else np.zeros(0, dtype=np.float32)

    def capture_followup(self, window_secs: float):
        """A short listening window right after a reply, so the wearer can
        answer back without saying the wake word again. Returns empty audio if
        nobody speaks within the window."""
        return self._record_until_silence(wait_for_speech=True, give_up_secs=window_secs)

    def _record_until_silence(self, silence_secs=1.1, threshold=0.012, max_secs=20,
                              wait_for_speech=False, give_up_secs=None):
        np, sd = self.np, self.sd
        log("Listening…")
        self.state.set(state="listening", level=0.0)
        frames: list = []
        block = int(SAMPLE_RATE * 0.1)
        started = False
        silent = 0.0
        start = time.time()
        with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32",
                            blocksize=block, device=self.input_device) as stream:
            while True:
                data, _ = stream.read(block)
                mono = data.flatten()
                level = float(np.sqrt(np.mean(mono**2))) if mono.size else 0.0
                self.state.set(level=min(1.0, level / 0.15))
                if level >= threshold:
                    started = True
                    silent = 0.0
                    frames.append(mono)  # flatten() already returned a fresh array
                elif started:
                    frames.append(mono)
                    silent += 0.1
                    if silent >= silence_secs:
                        break
                elif give_up_secs is not None and time.time() - start > give_up_secs:
                    break  # nobody spoke inside the follow-up window
                if time.time() - start > max_secs and (started or not wait_for_speech):
                    break
        return np.concatenate(frames).flatten() if frames else np.zeros(0, dtype=np.float32)


# --------------------------------------------------------------------------- #
# Local PC commands — instant, offline, no brain round-trip
# --------------------------------------------------------------------------- #

# Apps and sites Jarvis opens by voice. Only names in this map are handled
# locally — anything else ("open the mask", "open the garage") still goes to
# the brain, which may reach Home Assistant or the device webhooks.
OPEN_TARGETS = {
    "notepad": "notepad",
    "calculator": "calc",
    "paint": "mspaint",
    "file explorer": "explorer",
    "explorer": "explorer",
    "task manager": "taskmgr",
    "settings": "ms-settings:",
    "control panel": "control",
    "terminal": "wt",
    "command prompt": "cmd",
    "chrome": "chrome",
    "edge": "msedge",
    "firefox": "firefox",
    "word": "winword",
    "excel": "excel",
    "powerpoint": "powerpnt",
    "outlook": "outlook",
    "spotify": "spotify:",
    "youtube": "https://www.youtube.com",
    "gmail": "https://mail.google.com",
    "github": "https://github.com",
    "google": "https://www.google.com",
}

# Windows virtual-key codes SendKeys understands for volume/media control.
MEDIA_KEYS = {"mute": 173, "volume down": 174, "volume up": 175,
              "next": 176, "previous": 177, "play/pause": 179}


def _send_media_key(code: int) -> bool:
    if not sys.platform.startswith("win"):
        return False
    script = f"(New-Object -ComObject WScript.Shell).SendKeys([char]{code})"
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-Command", script],
            check=False, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return True
    except OSError:
        return False


def _open_target(name: str):
    """Open a known app/site. Returns spoken confirmation, or None when the
    name isn't ours to handle (so the brain gets a chance at it)."""
    target = OPEN_TARGETS.get(name)
    if target is None and re.match(r"^[\w-]+(\.[a-z]{2,})+$", name):
        target = f"https://{name}"  # "open weather.com"
    if target is None:
        return None
    try:
        if target.startswith("http"):
            import webbrowser

            webbrowser.open(target)
        elif sys.platform.startswith("win"):
            # ShellExecute handles exe names, protocol URIs (ms-settings:,
            # spotify:), and paths — from a curated map, never raw user text.
            os.startfile(target)  # noqa: S606
        else:
            # The app targets are Windows executables; don't fake success on
            # macOS/Linux — let the brain field "open <app>" there.
            return None
        return f"Opening {name}."
    except OSError:
        return f"I couldn't find {name} on this machine."


def _screenshot_to_pictures():
    try:
        import mss

        folder = pathlib.Path.home() / "Pictures"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"jarvis-screenshot-{time.strftime('%Y%m%d-%H%M%S')}.png"
        with mss.mss() as sct:
            sct.shot(mon=1, output=str(path))
        return str(path)
    except Exception:  # noqa: BLE001
        return None


def local_intent(text: str):
    """Handle a small set of PC commands locally — instantly and offline.
    Returns the spoken confirmation, or None to send the utterance to the
    brain as usual. Matching is deliberately conservative: full-utterance
    patterns only, so questions and smart-home commands pass through."""
    t = re.sub(r"[^\w\s./:-]", " ", text.lower())
    t = re.sub(r"^\s*(hey\s+)?jarvis[,\s]+", "", t).strip()
    t = re.sub(r"\s+", " ", t)

    m = re.match(r"^(?:search the web for|web search for|google) (.+)$", t)
    if m:
        import webbrowser
        from urllib.parse import quote

        webbrowser.open(f"https://www.google.com/search?q={quote(m.group(1))}")
        return f"Searching the web for {m.group(1)}."

    m = re.match(r"^open(?: up)? (?:the )?(.+?)\.?$", t)
    if m:
        return _open_target(m.group(1).strip())

    if re.match(r"^lock (?:the )?(?:computer|pc|screen|workstation)$", t):
        if sys.platform.startswith("win"):
            subprocess.run(["rundll32.exe", "user32.dll,LockWorkStation"], check=False)
            return "Locking up. I'll be here."
        return None

    if re.match(r"^(?:take a )?screen ?shot$", t):
        path = _screenshot_to_pictures()
        return "Screenshot saved to your Pictures folder." if path else "I couldn't take a screenshot."

    if t in ("volume up", "turn it up", "louder"):
        return "Louder." if _send_media_key(MEDIA_KEYS["volume up"]) else None
    if t in ("volume down", "turn it down", "quieter"):
        return "Quieter." if _send_media_key(MEDIA_KEYS["volume down"]) else None
    if t in ("mute", "mute the volume", "unmute"):
        return "Done." if _send_media_key(MEDIA_KEYS["mute"]) else None
    if t in ("pause", "pause the music", "play", "play the music", "resume the music"):
        return "Done." if _send_media_key(MEDIA_KEYS["play/pause"]) else None
    if t in ("next track", "next song", "skip this song", "skip"):
        return "Skipping." if _send_media_key(MEDIA_KEYS["next"]) else None
    if t in ("previous track", "previous song", "go back a song"):
        return "Going back." if _send_media_key(MEDIA_KEYS["previous"]) else None

    return None


# --------------------------------------------------------------------------- #
# The loop
# --------------------------------------------------------------------------- #


def mic_test() -> None:
    """One-shot diagnosis: list mics, sample the chosen one, score the wake
    word, and print a verdict. Needs no Worker URL or saved config."""
    import numpy as np
    import sounddevice as sd

    default_in = None
    try:
        default_in = sd.default.device[0]
    except Exception:  # noqa: BLE001
        pass
    inputs = [(i, dev["name"]) for i, dev in enumerate(sd.query_devices())
              if dev.get("max_input_channels", 0) > 0]
    print("Input devices:")
    for i, name in inputs:
        print(f"  [{i}] {name}" + ("   <- default" if i == default_in else ""))
    if not inputs:
        print("  (none)")
        print("\nWindows sees NO microphone for this app. Turn on mic access:")
        print("  Settings > Privacy & security > Microphone > 'Let desktop apps access")
        print("  your microphone' = On, and set an input under Settings > System > Sound.")
        print("Then run --mic-test again.")
        return

    want = (os.environ.get("JARVIS_INPUT_DEVICE") or "").strip()
    device = None
    if want.isdigit():
        device = int(want)
    elif want:
        for i, dev in enumerate(sd.query_devices()):
            if dev.get("max_input_channels", 0) > 0 and want.lower() in dev["name"].lower():
                device = i
                break

    print("\nRecording 3 seconds — say something at normal volume…")
    try:
        audio = sd.rec(3 * SAMPLE_RATE, samplerate=SAMPLE_RATE, channels=1,
                       dtype="int16", device=device)
        sd.wait()
    except Exception as err:  # noqa: BLE001
        print(f"Couldn't open that microphone ({err}).")
        print("Pick another with JARVIS_INPUT_DEVICE=<index> from the list above,")
        print("or enable mic access for desktop apps in Windows Settings.")
        return
    peak = float(np.abs(audio).max()) / 32768.0
    if peak < 0.003:
        print(f"Peak level {peak:.3f}: SILENT. The app is getting no audio — on a Mac,")
        print("allow your terminal in System Settings > Privacy & Security > Microphone,")
        print("or pick another mic with JARVIS_INPUT_DEVICE=<index or name> from the list above.")
        return
    print(f"Peak level {peak:.3f}: the microphone hears you.")

    try:
        from openwakeword.model import Model

        try:
            import openwakeword.utils as oww_utils

            try:
                oww_utils.download_models(model_names=["hey_jarvis"])
            except TypeError:
                oww_utils.download_models()
        except Exception:  # noqa: BLE001
            pass
        try:
            oww = Model(wakeword_models=["hey_jarvis"])
        except Exception:  # noqa: BLE001
            oww = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")
    except Exception as err:  # noqa: BLE001
        print(f"Wake model unavailable ({err}) — voice still works in --auto or --push mode.")
        return

    threshold = float(os.environ.get("JARVIS_WAKE_THRESHOLD", "0.5"))
    print("\nScoring for 8 seconds — say 'Hey Jarvis' a couple of times…")
    best = 0.0
    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16",
                        blocksize=1280, device=device) as stream:
        t0 = time.time()
        while time.time() - t0 < 8:
            data, _ = stream.read(1280)
            best = max(best, max(oww.predict(data.flatten()).values(), default=0.0))
    print(f"Best wake score: {best:.3f} (triggers at {threshold})")
    if best >= threshold:
        print("Verdict: the wake word WORKS on this setup.")
    elif best >= 0.25:
        print(f"Verdict: nearly there — start with JARVIS_WAKE_THRESHOLD={max(0.2, round(best - 0.05, 2))}")
    else:
        print("Verdict: it hears sound but not the phrase — get closer, say 'Hey… Jarvis'")
        print("as two clear words, or try another mic with JARVIS_INPUT_DEVICE.")


NO_MIC_HELP = (
    "No microphone is available to Jarvis. On Windows: Settings > Privacy & security "
    "> Microphone > turn ON 'Let desktop apps access your microphone', and pick an "
    "input under Settings > System > Sound. On macOS: System Settings > Privacy & "
    "Security > Microphone > allow your terminal. Then relaunch, or run --mic-test "
    "and set JARVIS_INPUT_DEVICE."
)
NO_MIC_HUD = "No microphone available — enable desktop mic access, then relaunch."


def _has_input_device(sd) -> bool:
    """True if any device exposes input channels."""
    try:
        return any(d.get("max_input_channels", 0) > 0 for d in sd.query_devices())
    except Exception:  # noqa: BLE001
        return False


def _is_audio_device_error(err: Exception) -> bool:
    """Recognise 'no/blocked microphone' errors (PortAudio device -1, etc.)."""
    text = str(err).lower()
    return (
        err.__class__.__name__ == "PortAudioError"
        or "querying device" in text
        or "invalid device" in text
        or "error querying" in text
        or ("device" in text and "-1" in text)
    )


def run_turn(you: str, brain: WorkerBrain, state: AppState, cfg: Config) -> str:
    """One utterance → one spoken reply. Local PC commands answer instantly;
    everything else goes to the brain (tools, memory, vision)."""
    log(f"You: {you}")
    state.set(you=you)
    reply = local_intent(you)
    if reply is None:
        state.set(state="thinking")
        image = image_for_utterance(you)
        reply = brain.ask(you, image)
    log(f"Jarvis: {reply}")
    state.set(state="speaking", reply=reply)
    speak(reply, cfg.voice)
    state.set(state="idle")
    return reply


def voice_loop(cfg: Config, state: AppState, mode: str):
    brain = WorkerBrain(cfg)
    transcriber = Transcriber(cfg.whisper_model)
    listener = Listener(cfg, state, mode)

    # Load Whisper now, not on the first command — the first "Hey Jarvis"
    # should answer promptly instead of stalling on a model download.
    threading.Thread(target=transcriber.warmup, daemon=True).start()

    log(f"Jarvis Desktop online (brain: {cfg.url}).")
    state.set(state="idle")

    sd = getattr(listener, "sd", None)
    if sd is not None and not _has_input_device(sd):
        log(NO_MIC_HELP)
        state.set(state="idle", reply=NO_MIC_HUD)

    warned_mic = False
    while True:
        try:
            audio = listener.wait_for_command()
            warned_mic = False  # a successful capture means the mic is back
            if audio is None or audio.size == 0:
                state.set(state="idle")
                continue
            state.set(state="thinking")
            you = transcriber.transcribe(audio)
            if not you:
                state.set(state="idle")
                continue
            run_turn(you, brain, state, cfg)

            # Conversation window: for a few seconds after each reply, a
            # follow-up needs no wake word — just answer back.
            while mode == "wake" and cfg.followup_secs > 0:
                audio = listener.capture_followup(cfg.followup_secs)
                if audio is None or audio.size == 0:
                    state.set(state="idle")
                    break
                state.set(state="thinking")
                you = transcriber.transcribe(audio)
                if not you:
                    state.set(state="idle")
                    break
                run_turn(you, brain, state, cfg)
        except KeyboardInterrupt:
            log("Shutting down.")
            os._exit(0)
        except SystemExit as err:
            # Raised for unrecoverable listener states (no console for push-to-talk).
            # In the daemon voice thread SystemExit dies silently, so surface the
            # reason in the HUD caption before this thread ends.
            msg = str(err) or "Voice loop stopped."
            log(msg)
            state.set(state="idle", reply=msg)
            return
        except Exception as err:  # noqa: BLE001 — one bad cycle must not kill the app
            if _is_audio_device_error(err):
                # No usable mic: say it once, then back off (don't spam once a
                # second). Recovers on its own if the user enables mic access.
                if not warned_mic:
                    log(NO_MIC_HELP)
                    state.set(state="idle", reply=NO_MIC_HUD)
                    warned_mic = True
                time.sleep(8)
            else:
                log(f"Cycle error: {err}")
                state.set(state="idle")
                time.sleep(1)


def main():
    parser = argparse.ArgumentParser(description="Jarvis desktop assistant.")
    parser.add_argument("--push", action="store_true", help="Push-to-talk instead of the wake word.")
    parser.add_argument("--auto", action="store_true", help="Hands-free voice activity detection.")
    parser.add_argument("--no-hud", action="store_true", help="Voice only; don't open the HUD window.")
    parser.add_argument("--text", metavar="MSG", help="One typed message (no mic) and exit.")
    parser.add_argument("--mic-test", action="store_true",
                        help="Diagnose the microphone + wake word, then exit.")
    parser.add_argument("--url", help="Worker /jarvis endpoint (overrides config).")
    args = parser.parse_args()

    if args.mic_test:
        mic_test()
        return

    cfg = Config(args)
    state = AppState()

    if args.text:
        run_turn(args.text, WorkerBrain(cfg), state, cfg)
        return

    mode = "push" if args.push else "auto" if args.auto else "wake"

    hud_ok = False if args.no_hud else start_hud_server(cfg.hud_port, state)

    if hud_ok:
        # pywebview must own the main thread; the voice loop runs beside it.
        threading.Thread(target=voice_loop, args=(cfg, state, mode), daemon=True).start()
        open_hud_window(cfg.hud_port)
    else:
        voice_loop(cfg, state, mode)


if __name__ == "__main__":
    main()
