# Jarvis — a voice assistant for Meta AI glasses

A Cloudflare Worker that gives your Meta (Ray-Ban) AI glasses a J.A.R.V.I.S.-style
voice assistant: dry-witted, concise, and built for speech. It answers with
[Claude](https://www.anthropic.com/) and remembers your conversation in
[D1](https://developers.cloudflare.com/d1/).

The glasses are a closed platform — there's no SDK to install a custom assistant —
so Jarvis reaches them through a channel they already speak: **WhatsApp**. You
talk, the glasses transcribe and send, this Worker answers in character, and the
glasses read the reply back to you. A channel-agnostic JSON endpoint is included
too, so you can wire Jarvis to any other speech bridge.

> **Want to use Jarvis on your Mac instead of the glasses?** There's a voice
> client in [`mac/`](./mac) — talk to Jarvis out loud on macOS (local Whisper for
> speech-to-text, the built-in `say` voice for replies). Run `cd mac && ./install.sh`
> for a standalone double-click **Jarvis.app** that talks straight to Claude (no
> Worker needed), or pair it with this Worker to share one brain and memory. See
> [`mac/README.md`](./mac/README.md).

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
| `POST` | `/jarvis`   | Channel-agnostic voice endpoint. `{ text, sessionId? } → { reply }`. |
| `GET`  | `/whatsapp` | WhatsApp webhook verification handshake.                          |
| `POST` | `/whatsapp` | WhatsApp inbound messages (the glasses bridge).                   |

### The JSON endpoint

```bash
curl -X POST "$WORKER_URL/jarvis" \
  -H 'content-type: application/json' \
  -d '{ "text": "what should I focus on this morning?", "sessionId": "me" }'
# → { "reply": "...", "sessionId": "me" }
```

Pass a stable `sessionId` per wearer/device to give Jarvis memory across turns.
Say "Jarvis, start over" to wipe a session's history.

## Setup

1. **Install & initialise the database**
   ```bash
   npm install
   npx wrangler d1 migrations apply DB --remote   # creates the jarvis_turns table
   ```

2. **Choose a brain**
   - **Claude (recommended):** `npx wrangler secret put ANTHROPIC_API_KEY`
   - **Or Workers AI fallback:** leave the key unset — the bound `AI` resource
     (Llama) answers automatically. Lower quality, no external key.

3. **Deploy**
   ```bash
   npm run deploy   # applies any pending D1 migrations, then deploys
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
| `ANTHROPIC_API_KEY`        | one of   | Anthropic API key — Jarvis answers with Claude.              |
| `AI` binding               | these    | Workers AI fallback (already bound) when no key is set.      |
| `JARVIS_MODEL`             | no       | Claude model id. Defaults to `claude-opus-4-8`.              |
| `JARVIS_NAME`              | no       | What the assistant calls itself. Defaults to `Jarvis`.       |
| `JARVIS_USER_TITLE`        | no       | How it addresses you. Defaults to `sir`; set `""` for none.  |
| `WHATSAPP_TOKEN`           | WhatsApp | Cloud API access token (secret).                             |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp | The number replies are sent from.                            |
| `WHATSAPP_VERIFY_TOKEN`    | WhatsApp | Your chosen webhook verification token.                      |
| `WHATSAPP_APP_SECRET`      | WhatsApp | App secret used to verify `X-Hub-Signature-256` (secret).    |

## Local development

```bash
npm run dev        # seeds local D1 and starts wrangler dev
```

## Notes

- Replies are tuned for **speech** — short, plain sentences, no markdown — because
  they get read aloud. Thinking is disabled for snappy responses.
- WhatsApp webhooks are HMAC-verified when `WHATSAPP_APP_SECRET` is set. Set it
  before going live.
