"""
PC control tools for the Windows Jarvis assistant.

These are client-side tools: Claude decides to call one, and this module runs it
on the local machine via PowerShell / cmd. Each returns a short status string
that goes back to the model so it can confirm out loud.

Safety: the everyday actions (open apps/URLs, search, type, media, lock/sleep)
are enabled by default. Anything that can destroy work or run arbitrary code —
shutdown/restart and raw PowerShell — is gated behind `allow_shell` (the
`--allow-shell` flag), so a stray sentence can't wipe your session.
"""

from __future__ import annotations

import os
import subprocess
import urllib.parse

_TIMEOUT = 20


def control_tools(allow_shell: bool) -> list[dict]:
    """Anthropic tool definitions for the PC-control toolkit."""
    tools: list[dict] = [
        {
            "name": "open_app",
            "description": (
                "Open/launch an application on this Windows PC by name. "
                "Use for requests like 'open Chrome', 'launch Notepad', 'start Spotify'. "
                "Pass the common app name (e.g. 'chrome', 'notepad', 'calc', 'spotify')."
            ),
            "input_schema": {
                "type": "object",
                "properties": {"name": {"type": "string", "description": "Application name"}},
                "required": ["name"],
            },
        },
        {
            "name": "open_url",
            "description": "Open a web page in the default browser. Use when the user names a site or asks to pull up a URL.",
            "input_schema": {
                "type": "object",
                "properties": {"url": {"type": "string", "description": "The URL to open"}},
                "required": ["url"],
            },
        },
        {
            "name": "search_web_in_browser",
            "description": (
                "Open the default browser to search results for a query. Use when the user wants to "
                "'pull up' / 'look up' / 'search for' something on screen. (To answer a question out "
                "loud yourself, use the web_search tool instead.)"
            ),
            "input_schema": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "What to search for"}},
                "required": ["query"],
            },
        },
        {
            "name": "type_text",
            "description": "Type text into whatever window is currently focused (via the clipboard + paste). Use for dictation, e.g. 'type out this email...'.",
            "input_schema": {
                "type": "object",
                "properties": {"text": {"type": "string", "description": "The text to type"}},
                "required": ["text"],
            },
        },
        {
            "name": "media_control",
            "description": "Control media playback and system volume.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": [
                            "play_pause",
                            "next",
                            "previous",
                            "volume_up",
                            "volume_down",
                            "mute",
                        ],
                    }
                },
                "required": ["action"],
            },
        },
        {
            "name": "system_power",
            "description": (
                "Lock or sleep the machine."
                + (" Also shut down or restart it." if allow_shell else "")
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["lock", "sleep"] + (["shutdown", "restart"] if allow_shell else []),
                    }
                },
                "required": ["action"],
            },
        },
    ]

    if allow_shell:
        tools.append(
            {
                "name": "run_powershell",
                "description": (
                    "Run an arbitrary PowerShell command on this PC and return its output. "
                    "Powerful — use for tasks the other tools don't cover (file operations, "
                    "system queries, automation). Prefer the specific tools when they fit."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {"command": {"type": "string", "description": "PowerShell to run"}},
                    "required": ["command"],
                },
            }
        )
    return tools


def run_tool(name: str, tool_input: dict, allow_shell: bool) -> str:
    """Execute one tool call and return a short status string for the model."""
    try:
        if name == "open_app":
            return _open(tool_input.get("name", ""), "app")
        if name == "open_url":
            return _open(_normalize_url(tool_input.get("url", "")), "url")
        if name == "search_web_in_browser":
            q = urllib.parse.quote(tool_input.get("query", ""))
            return _open(f"https://www.google.com/search?q={q}", "search")
        if name == "type_text":
            return _type_text(tool_input.get("text", ""))
        if name == "media_control":
            return _media(tool_input.get("action", ""))
        if name == "system_power":
            return _power(tool_input.get("action", ""), allow_shell)
        if name == "run_powershell":
            if not allow_shell:
                return "Shell access is disabled. Restart Jarvis with --allow-shell to enable it."
            return _powershell(tool_input.get("command", ""))
        return f"Unknown tool: {name}"
    except subprocess.TimeoutExpired:
        return f"The '{name}' command timed out."
    except Exception as err:  # keep the agent loop alive; report back to the model
        return f"The '{name}' command failed: {err}"


# --------------------------------------------------------------------------- #
# Executors
# --------------------------------------------------------------------------- #


def _open(target: str, kind: str) -> str:
    if not target:
        return f"No {kind} given."
    # `start "" <target>` launches apps, files, and URLs via the shell.
    subprocess.run(["cmd", "/c", "start", "", target], check=False, timeout=_TIMEOUT)
    if kind == "app":
        return f"Opened {target}."
    if kind == "search":
        return "Opened the search in your browser."
    return f"Opened {target}."


def _normalize_url(url: str) -> str:
    url = url.strip()
    if url and "://" not in url:
        return "https://" + url
    return url


def _type_text(text: str) -> str:
    if not text:
        return "Nothing to type."
    # Put the text on the clipboard, then paste — avoids SendKeys' need to escape
    # +, ^, %, ~, (), {} and reliably handles arbitrary content.
    script = (
        "Set-Clipboard -Value $env:JARVIS_TYPE_TEXT;"
        "Add-Type -AssemblyName System.Windows.Forms;"
        "[System.Windows.Forms.SendKeys]::SendWait('^v')"
    )
    env = dict(os.environ, JARVIS_TYPE_TEXT=text)
    _ps(script, env=env)
    return "Typed it into the active window."


_MEDIA_KEYS = {
    "play_pause": 0xB3,
    "next": 0xB0,
    "previous": 0xB1,
    "volume_up": 0xAF,
    "volume_down": 0xAE,
    "mute": 0xAD,
}


def _media(action: str) -> str:
    vk = _MEDIA_KEYS.get(action)
    if vk is None:
        return f"Unsupported media action: {action}."
    # Tap volume_up/down a few times so the change is audible.
    taps = 4 if action in ("volume_up", "volume_down") else 1
    sig = (
        '[DllImport("user32.dll")] public static extern void '
        "keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);"
    )
    presses = "".join(
        f"[W.K]::keybd_event({vk},0,0,0);[W.K]::keybd_event({vk},0,2,0);" for _ in range(taps)
    )
    script = f"Add-Type -MemberDefinition '{sig}' -Name K -Namespace W;{presses}"
    _ps(script)
    return f"Done: {action.replace('_', ' ')}."


def _power(action: str, allow_shell: bool) -> str:
    if action == "lock":
        subprocess.run(
            ["rundll32.exe", "user32.dll,LockWorkStation"], check=False, timeout=_TIMEOUT
        )
        return "Locked."
    if action == "sleep":
        subprocess.run(
            ["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"],
            check=False,
            timeout=_TIMEOUT,
        )
        return "Going to sleep."
    if action in ("shutdown", "restart"):
        if not allow_shell:
            return "Shutdown/restart is disabled. Restart Jarvis with --allow-shell to enable it."
        flag = "/s" if action == "shutdown" else "/r"
        subprocess.run(["shutdown", flag, "/t", "0"], check=False, timeout=_TIMEOUT)
        return f"{action.capitalize()} initiated."
    return f"Unsupported power action: {action}."


def _powershell(command: str) -> str:
    if not command.strip():
        return "No command given."
    out = _ps(command, capture=True)
    return out.strip()[:1500] or "Done."


def _ps(script: str, env=None, capture: bool = False, input_text: str | None = None):
    cmd = ["powershell", "-NoProfile", "-NonInteractive", "-Command", script]
    if capture:
        result = subprocess.run(
            cmd,
            env=env,
            input=input_text,
            text=True,
            capture_output=True,
            timeout=_TIMEOUT,
        )
        return (result.stdout or "") + (result.stderr or "")
    subprocess.run(cmd, env=env, input=input_text, text=True, check=False, timeout=_TIMEOUT)
    return ""
