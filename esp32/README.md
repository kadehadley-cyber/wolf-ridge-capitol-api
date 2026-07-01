# Jarvis on the ESP32-2432S028 (2.8" "Cheap Yellow Display")

A touch-driven J.A.R.V.I.S. terminal with the arc-reactor HUD, for the
**ESP32-2432S028R** — the 2.8" ILI9341 "CYD". Tap a command; it calls your
Cloudflare Worker over Wi-Fi (the same brain + long-term memory as the rest of
Jarvis) and shows the reply on the glowing HUD.

```
 tap a command  ─▶  HTTPS POST /jarvis  ─▶  Worker (Claude + memory)  ─▶  reply on the HUD
```

> **No microphone.** The stock CYD has a screen, resistive touch, speaker, RGB
> LED, and Wi-Fi — but **no mic**, so there's no "Hey Jarvis" voice input here.
> Interaction is by touch. (Real voice would need an add-on I2S mic — see the end.)

## What you get

- The **arc-reactor HUD**: glowing pulsing core with a rotating reticle, rings +
  tick marks, a sweeping indicator, live NTP clock, all in JARVIS cyan. It speeds
  up while a request is in flight.
- Three configurable **touch buttons** (default: Time / Weather / Briefing) that
  POST to `/jarvis` and show the word-wrapped reply. Tap the reactor to re-run the
  briefing; tap elsewhere to dismiss a reply.
- The **RGB LED** mirrors the state (idle breathe → blue thinking → green replied).

## Build & flash (PlatformIO)

1. Install [PlatformIO](https://platformio.org/) (VS Code extension or `pip install platformio`).
2. Configure your secrets:
   ```bash
   cd esp32
   cp include/config.example.h include/config.h
   # edit include/config.h — Wi-Fi, your Worker URL + JARVIS_API_KEY, timezone
   ```
3. Plug in the board over USB and:
   ```bash
   pio run -t upload -t monitor
   ```

Everything (display driver, pins, libraries) is set in `platformio.ini`, so
TFT_eSPI needs no manual `User_Setup.h` edits.

<details>
<summary>Arduino IDE instead of PlatformIO</summary>

Install **TFT_eSPI**, **XPT2046_Touchscreen**, and **ArduinoJson** via the Library
Manager, then replicate the `build_flags` from `platformio.ini` in TFT_eSPI's
`User_Setup.h` (ILI9341, pins MISO 12 / MOSI 13 / SCLK 14 / CS 15 / DC 2 / RST -1 /
BL 21). Board: "ESP32 Dev Module". Copy `config.example.h` → `config.h` next to the sketch.
</details>

## Configuration (`include/config.h`)

| Define | What |
| --- | --- |
| `WIFI_SSID` / `WIFI_PASSWORD` | Your Wi-Fi. |
| `JARVIS_URL` | Your Worker's `/jarvis` endpoint. |
| `JARVIS_API_KEY` | Bearer token, if the Worker has `JARVIS_API_KEY` set. |
| `JARVIS_SESSION` | Memory bucket for this device (default `cyd`). |
| `TZ_INFO` / `NTP_SERVER` | Clock timezone + time source. |
| `CMD1..3_LABEL` / `_PROMPT` | The three button labels and the prompts they send. |

Since the Worker holds the tools + memory, the **Weather** button sends "what's the
weather at home?" — set your `home_location` from any Jarvis client first (e.g.
*"remember my home location is American Fork"*).

## Notes & tuning

- **Colours look wrong / inverted?** Uncomment `tft.invertDisplay(true);` in
  `setup()`, or swap `-DILI9341_2_DRIVER` for `-DILI9341_DRIVER` in `platformio.ini`
  (CYD panels vary).
- **Touch lands in the wrong place?** Uncomment `#define TOUCH_DEBUG` in `config.h`,
  watch the serial monitor while you tap the corners, and adjust `TS_MINX/MAXX/
  MINY/MAXY` in `main.cpp`.
- **TLS:** the client uses `setInsecure()` (no cert pinning) — fine for a hobby
  device on your own network.

## Adding real voice (optional)

The board exposes a few spare pins on its side connector. Wiring an **I2S MEMS
mic (e.g. INMP441)** lets you capture audio; you'd stream it to a speech-to-text
service (or the Worker) and drop the transcript into `askJarvis()` — the HUD and
networking here are already built for it. That's a hardware mod beyond this
firmware, but the door's open.
