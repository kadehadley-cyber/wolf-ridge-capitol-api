// Simple status / setup page served at GET /. Shows which pieces are wired up
// so you can tell at a glance what's left to configure.

export function renderHtml(env: Env): string {
	const brain = env.ANTHROPIC_API_KEY
		? "Claude (Anthropic)"
		: env.AI
			? "Cloudflare Workers AI (fallback)"
			: "⚠️ none configured";

	const whatsapp =
		env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID
			? "ready"
			: "not configured";

	const signature = env.WHATSAPP_APP_SECRET
		? "enforced"
		: "⚠️ inbound rejected (set WHATSAPP_APP_SECRET)";

	const httpAuth = env.JARVIS_API_KEY
		? "bearer token required"
		: "⚠️ open (set JARVIS_API_KEY)";

	const whatsappReady = Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);
	const proactivePush = whatsappReady
		? "ready (cron pushes reminders + briefings)"
		: "pull-only (configure WhatsApp to push)";

	// Agency (tool use) is the Claude path only; the Workers AI fallback can't
	// call tools, so it degrades to a memory-aware conversation.
	const agency = env.ANTHROPIC_API_KEY
		? "ready (10 tools)"
		: "limited (set ANTHROPIC_API_KEY for tools)";

	const name = env.JARVIS_NAME || "Jarvis";

	const row = (label: string, value: string) =>
		`<tr><td>${label}</td><td>${escapeHtml(value)}</td></tr>`;

	return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(name)} · voice assistant</title>
    <style>
      :root { color-scheme: dark; }
      body { font: 16px/1.6 -apple-system, system-ui, sans-serif; max-width: 44rem;
             margin: 4rem auto; padding: 0 1.25rem; background: #0b0f14; color: #e6edf3; }
      h1 { font-weight: 650; letter-spacing: -0.02em; }
      .accent { color: #38bdf8; }
      table { border-collapse: collapse; width: 100%; margin: 1.5rem 0; }
      td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #1f2933; }
      td:first-child { color: #8b98a5; width: 12rem; }
      code { background: #111821; padding: 0.15rem 0.4rem; border-radius: 4px; }
      pre { background: #111821; padding: 1rem; border-radius: 8px; overflow-x: auto; }
      a { color: #38bdf8; }
    </style>
  </head>
  <body>
    <h1><span class="accent">${escapeHtml(name)}</span> is listening.</h1>
    <p>A voice-assistant backend for Meta AI glasses, running on a Cloudflare Worker.</p>

    <table>
      ${row("Brain", brain)}
      ${row("Agency (tools)", agency)}
      ${row("Long-term memory", "ready (D1)")}
      ${row("Reminders", "ready (D1)")}
      ${row("Proactive briefing", "GET /briefing?sessionId=me")}
      ${row("Proactive push", proactivePush)}
      ${row("HTTP auth", httpAuth)}
      ${row("WhatsApp bridge", whatsapp)}
      ${row("Webhook signature", signature)}
    </table>

    <h2>Try the voice endpoint</h2>
    <pre>curl -X POST "$WORKER_URL/jarvis" \\
  -H 'content-type: application/json' \\
  -d '{ "text": "what's on my plate today?", "sessionId": "me" }'</pre>

    <h2>Wire up the glasses (WhatsApp)</h2>
    <p>Set the WhatsApp Cloud API webhook to <code>POST /whatsapp</code> on this
       Worker, save a contact named “${escapeHtml(name)}” pointing at your
       Cloud API number, then tell the glasses:
       <em>“Hey Meta, send a message to ${escapeHtml(name)} — …”</em></p>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
