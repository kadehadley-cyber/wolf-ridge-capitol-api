// Jarvis — a voice assistant backend for Meta AI glasses, running on a
// Cloudflare Worker.
//
// Routes:
//   GET  /            -> status / setup page
//   POST /jarvis      -> generic voice endpoint: { text, sessionId? } -> { reply }
//   GET  /whatsapp    -> WhatsApp webhook verification handshake
//   POST /whatsapp    -> WhatsApp inbound messages (the glasses bridge)

import { ask } from "./jarvis";
import { handleInbound, verifyWebhook } from "./whatsapp";
import { renderHtml } from "./renderHtml";

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		switch (`${request.method} ${url.pathname}`) {
			case "GET /":
				return new Response(renderHtml(env), {
					headers: { "content-type": "text/html; charset=utf-8" },
				});

			case "GET /whatsapp":
				return verifyWebhook(url, env);

			case "POST /whatsapp": {
				const raw = await request.text();
				const signature = request.headers.get("x-hub-signature-256");
				return handleInbound(raw, signature, env, ctx);
			}

			case "POST /jarvis":
				return handleJarvis(request, env);

			default:
				return new Response("Not found", { status: 404 });
		}
	},
} satisfies ExportedHandler<Env>;

/**
 * Channel-agnostic voice endpoint. Point any speech-to-text / text-to-speech
 * bridge (an iOS Shortcut, a relay app, your own glasses integration) at this:
 * POST a transcript, speak the `reply` back.
 */
async function handleJarvis(request: Request, env: Env): Promise<Response> {
	let body: { text?: string; sessionId?: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: "Expected a JSON body like { \"text\": \"...\" }" }, 400);
	}

	const text = (body.text ?? "").toString();
	if (!text.trim()) {
		return json({ error: "Missing `text`." }, 400);
	}

	// Without a session id, every request is a fresh conversation. Supply a
	// stable id (per wearer/device) to give Jarvis memory across turns.
	const sessionId = (body.sessionId ?? "default").toString();

	try {
		const reply = await ask(env, sessionId, text);
		return json({ reply, sessionId });
	} catch (err) {
		console.error("Jarvis error:", err);
		return json({ error: "Jarvis is unavailable right now." }, 503);
	}
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}
