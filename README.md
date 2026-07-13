# Jarvis — a voice assistant for Meta AI glasses

A Cloudflare Worker that gives your Meta (Ray-Ban) AI glasses a J.A.R.V.I.S.-style
voice assistant: dry-witted, concise, and built for speech. It answers with
[Claude](https://www.anthropic.com/) and remembers your conversation in
[D1](https://developers.cloudflare.com/d1/).

Like the J.A.R.V.I.S. it's modelled on, this one doesn't just talk — it **acts**,
it **knows you**, and it can **speak first**:

- **Agency.** On the Claude path Jarvis can call tools mid-sentence — tell the
  real time, check the weather, do exact arithmetic and unit conversions, and
  set, list, or cancel reminders. Every tool runs inside the Worker with **no
  extra API keys**, so the whole kit works on a fresh deploy.
- **Long-term memory.** It durably remembers facts about you — your name, where
  you live, your timezone, your coffee order — and quietly carries them across
  conversations. Say *"forget everything about me"* to wipe the slate.
- **Proactive briefings.** A `GET /briefing` endpoint composes a spoken summary
  of your day (time, weather, today's reminders), and an optional cron can push
  it — and any due reminders — to you over WhatsApp.

The glasses are a closed platform — there's no SDK to install a custom assistant —
so Jarvis reaches them through a channel they already speak: **WhatsApp**. You
talk, the glasses transcribe and send, this Worker answers in character, and the
glasses read the reply back to you. A channel-agnostic JSON endpoint is included
too, so you can wire Jarvis to any other speech bridge.

> **One brain, many bodies.** Every client shares this Worker's persona, tools,
> and long-term memory:
>
> | Surface | Where | Interaction |
> | --- | --- | --- |
> | **Phone app** (Android/iPhone) | `GET /app` on this Worker | installable app: tap-to-talk / hands-free, spoken replies, camera identify |
> | **Desktop app** (Mac/Windows/Linux) | [`desktop/`](./desktop) | "Hey Jarvis" + the arc-reactor HUD window; screen/webcam identification |
> | macOS voice client | [`mac/`](./mac) | push-to-talk / hands-free, natural `say` voices |
> | Windows voice client | [`windows/`](./windows) | push-to-talk / hands-free, System.Speech |
> | Raspberry Pi appliance | [`pi/`](./pi) | always-on "Hey Jarvis" box + HUD kiosk |
> | ESP32-2432S028 (CYD) | [`esp32/`](./esp32) | 2.8" touch terminal + HUD |
> | Meta glasses | this Worker | WhatsApp bridge (below) |

## How it works

```
You speak ─▶ Meta glasses ─▶ WhatsApp Cloud API ─▶  POST /whatsapp  (this Worker)
                                                          │
   glasses read reply ◀─ WhatsApp ◀─ Graph API ◀─ Claude (Jarvis persona) + D1 memory
```

## Endpoints

| Method | Path        | Purpose                                                            |
| ------ | ----------- | ----------------------------------------------------------------- |
| `GET`  | `/`         | Status / setup page — shows what's configured.                    |
| `GET`  | `/app`      | The **phone app** — open on Android/iPhone and install it.        |
| `POST` | `/jarvis`   | Channel-agnostic voice endpoint. `{ text, sessionId? } → { reply }`. |
| `GET`  | `/briefing` | Proactive spoken briefing. `?sessionId=me → { reply }`.           |
| `GET`  | `/whatsapp` | WhatsApp webhook verification handshake.                          |
| `POST` | `/whatsapp` | WhatsApp inbound messages (the glasses bridge).                   |

### The phone app

Open `https://<your-worker>/app` on the phone and follow the install banner:

- **Android** — open in **Chrome**, then *menu ⋮ → Install app* (the banner
  shows a one-tap **Install** button when Chrome offers it).
- **iPhone / iPad** — open in **Safari** (installing only works from Safari),
  then *Share ↑ → Add to Home Screen*.

Jarvis installs like a native app: full-screen arc-reactor HUD, tap the
reactor to talk (or toggle 🎙 for a hands-free conversation), replies are
spoken with a British voice when the phone has one, and 📷 photographs
something for *"what am I looking at?"* identification. Enter your
`JARVIS_API_KEY` once in settings; it talks to this same Worker, so it shares
the memory and tools of every other surface. (Voice input needs Chrome on
Android or Safari on iOS 16.4+; typing always works.)

### The JSON endpoint

```bash
curl -X POST "$WORKER_URL/jarvis" \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer $JARVIS_API_KEY' \
  -d '{ "text": "what should I focus on this morning?", "sessionId": "me" }'
# → { "reply": "...", "sessionId": "me" }
```

The `authorization` header is required when `JARVIS_API_KEY` is set on the Worker;
omit it for an unauthenticated local Worker.

Pass a stable `sessionId` per wearer/device to give Jarvis memory across turns.
Say "Jarvis, start over" to wipe a session's short-term history, or "Jarvis,
forget everything about me" to also erase the long-term memory and reminders.

## What Jarvis can do (tools)

When answering with Claude, Jarvis has a small catalog of tools it can call
mid-turn. All of them run inside the Worker and need **no extra API keys**:

| Tool                                    | What it does                                                        |
| --------------------------------------- | ------------------------------------------------------------------- |
| `get_time`                              | The real date/time, in your timezone — grounds anything time-based. |
| `get_weather`                           | Current / today / tomorrow weather via keyless [Open-Meteo](https://open-meteo.com/). |
| `remember_fact` / `recall_facts` / `forget_fact` | Durable, correctable memory of facts about you.            |
| `set_reminder` / `list_reminders` / `cancel_reminder` | One-shot reminders.                            |
| `do_math`                               | Exact arithmetic, percentages, `sqrt`/`round`, parentheses (no `eval`). |
| `convert_units`                         | Length, mass, volume, speed, data, time, and temperature.           |
| `get_directions`                        | Driving distance + travel time between places/addresses, via keyless [Nominatim](https://nominatim.org/) + [OSRM](http://project-osrm.org/). |
| `control_home` *(when configured)*      | Home Assistant: lights, switches, locks, covers ("open the mask"). Set `HOME_ASSISTANT_URL` + `HOME_ASSISTANT_TOKEN`. |
| `trigger_device` *(when configured)*    | Named hardware webhooks from `JARVIS_DEVICES` — the DIY "suit" control plane. |

**Vision.** `POST /jarvis` also accepts an image (`imageBase64` + optional
`imageType`) alongside the text — Jarvis identifies what it's shown with Claude
vision. The desktop client uses this for *"what's on my screen?"* (screenshot)
and *"what am I looking at?"* (webcam).

**Memory** is injected into every turn, so Jarvis knows you without a lookup.
Tell it `remember that my home is Denver` or `my timezone is America/Denver` and
it'll keep that for next time. A few special keys unlock more: `home_location`
(default place for weather), `timezone` (grounds reminder times), `temp_unit`
(`celsius`/`fahrenheit`), and `briefing_hour` (0–23, the local hour for a pushed
daily briefing).

**Reminders** are pull-based by default: "remind me to call the dentist at
three" is stored and surfaces the next time you talk to Jarvis (or in your
briefing). If you've wired up the WhatsApp bridge, the cron trigger also
**pushes** due reminders and the daily briefing to you proactively.

> The Workers AI (Llama) fallback can't call tools, so without an
> `ANTHROPIC_API_KEY` Jarvis degrades to a memory-aware, date-grounded
> conversation — it still knows you, but it can't act.

## Setup

1. **Install & initialise the database**
   ```bash
   npm install
   npx wrangler d1 migrations apply DB --remote   # creates the memory + reminder tables
   ```

2. **Choose a brain**
   - **Claude (recommended):** `npx wrangler secret put ANTHROPIC_API_KEY`
   - **Or Workers AI fallback:** leave the key unset — the bound `AI` resource
     (Llama) answers automatically. Lower quality, no external key.

3. **Deploy**
   ```bash
   npx wrangler deploy
   ```

4. **Connect the glasses via WhatsApp** (optional but this is the magic part)
   - Set up a [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started)
     number and point its webhook at `https://<your-worker>/whatsapp`.
   - Configure these secrets/vars:
     ```bash
     npx wrangler secret put WHATSAPP_TOKEN          # permanent Cloud API token
     npx wrangler secret put WHATSAPP_APP_SECRET     # verifies webhook signatures
     # set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_VERIFY_TOKEN as vars or secrets
     ```
   - On your phone, save the Cloud API number as a contact named **Jarvis**, then:
     *"Hey Meta, send a message to Jarvis — what's the weather looking like?"*

## Configuration

| Variable                   | Required | Description                                                  |
| -------------------------- | -------- | ------------------------------------------------------------ |
| `JARVIS_API_KEY`           | prod     | Bearer token for `/jarvis` and `/briefing`. Unset = open (local only); set it for any shared deployment. |
| `ANTHROPIC_API_KEY`        | one of   | Anthropic API key — Jarvis answers with Claude.              |
| `AI` binding               | these    | Workers AI fallback (already bound) when no key is set.      |
| `JARVIS_MODEL`             | no       | Claude model id. Defaults to `claude-opus-4-8`.              |
| `JARVIS_NAME`              | no       | What the assistant calls itself. Defaults to `Jarvis`.       |
| `JARVIS_USER_TITLE`        | no       | How it addresses you. Defaults to `sir`; set `""` for none.  |
| `JARVIS_TIMEZONE`          | no       | Default IANA timezone for time/reminders before a wearer saves their own. Falls back to UTC. |
| `HOME_ASSISTANT_URL`       | no       | Home Assistant base URL (https — Nabu Casa or a tunnel). Enables `control_home`. |
| `HOME_ASSISTANT_TOKEN`     | no       | Home Assistant long-lived token (secret). |
| `JARVIS_DEVICES`           | no       | JSON map of named commands → https webhooks, e.g. `{"open mask":"https://…/open"}`. Enables `trigger_device`. |
| `WHATSAPP_TOKEN`           | WhatsApp | Cloud API access token (secret).                             |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp | The number replies are sent from.                            |
| `WHATSAPP_VERIFY_TOKEN`    | WhatsApp | Your chosen webhook verification token.                      |
| `WHATSAPP_APP_SECRET`      | WhatsApp | App secret used to verify `X-Hub-Signature-256` (secret).    |

## Local development

```bash
npm run dev        # seeds local D1 and starts wrangler dev
npm test           # run the unit tests (vitest)
npm run check      # the full gate: tsc + tests + a dry-run bundle
```

Unit tests ([vitest](https://vitest.dev/)) cover the pure logic — the math
evaluator, unit conversion, number formatting, timezone helpers, reminder
windowing, and the reminder-mention heuristic — and run in CI on every push and
pull request via `.github/workflows/ci.yml`.

## Proactive delivery (cron) — optional, off by default

Jarvis can *speak first* — sweep for due reminders and push the daily briefing on
a schedule — but that needs both a cron trigger and a WhatsApp delivery channel,
so it's **opt-in**. Without it, reminders are pull-based: they surface the next
time you talk to Jarvis or whenever you call `GET /briefing`.

To enable proactive push, configure the WhatsApp bridge and add a trigger to
`wrangler.json`:

```jsonc
"triggers": { "crons": ["*/15 * * * *"] }
```

The `scheduled()` handler then sweeps due reminders and delivers any scheduled
briefings over WhatsApp on each tick (it no-ops if WhatsApp isn't configured).
Reminders are marked delivered atomically (at most once) and the daily briefing
is guarded by a per-day ledger so it can't double-send. This scales to personal /
small deployments, not thousands of users.

## Notes

- Replies are tuned for **speech** — short, plain sentences, no markdown — because
  they get read aloud. Thinking is disabled for snappy responses.
- The only network call any tool makes is keyless weather, and it goes through a
  hardened fetch locked to the two Open-Meteo hosts (no SSRF, no arbitrary URLs).
  Arithmetic uses a hand-written parser, never `eval`.
- Stored facts and tool results are treated as **reference data, never
  instructions** (prompt-injection defense) and are scoped per session.
- **Access control.** Because a session id keys durable memory, the HTTP
  endpoints `/jarvis` and `/briefing` accept a bearer token: set `JARVIS_API_KEY`
  and send `Authorization: Bearer <key>` for any shared deployment (leave it
  unset only for local dev). The WhatsApp webhook **fails closed** — with no
  `WHATSAPP_APP_SECRET` configured, inbound messages are rejected rather than
  trusted, since an accepted message now writes durable state.

## Bonus: EMBERFALL 🐉

This repo also hosts [`game/`](game/README.md) — **Emberfall**, a self-contained
browser RPG: RuneScape-style skilling (13 skills, levels 1–99) in a Game of
Thrones-inspired realm, with dragon riding, dragonfire castle raids, and five
elemental bosses. No build step — open `game/index.html` and play.
