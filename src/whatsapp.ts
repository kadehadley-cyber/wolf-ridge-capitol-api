// WhatsApp bridge for the Meta glasses.
//
// The glasses can't host a custom assistant, but they *can* send a WhatsApp
// message by voice ("Hey Meta, send a message to Jarvis..."). Register a
// WhatsApp Cloud API number as a contact named "Jarvis", point its webhook at
// `/whatsapp` on this Worker, and the loop closes: you speak -> the glasses
// transcribe and send -> this Worker answers in character -> WhatsApp delivers
// the reply -> the glasses read it back to you.
//
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks

import { ask } from "./jarvis";

const GRAPH_API_VERSION = "v21.0";

/**
 * Webhook verification handshake (GET). Meta calls this once when you register
 * the webhook; echo back `hub.challenge` if the verify token matches.
 */
export function verifyWebhook(url: URL, env: Env): Response {
	const mode = url.searchParams.get("hub.mode");
	const token = url.searchParams.get("hub.verify_token");
	const challenge = url.searchParams.get("hub.challenge");

	if (
		mode === "subscribe" &&
		env.WHATSAPP_VERIFY_TOKEN &&
		token === env.WHATSAPP_VERIFY_TOKEN
	) {
		return new Response(challenge ?? "", { status: 200 });
	}
	return new Response("Verification failed", { status: 403 });
}

/**
 * Inbound message handler (POST). Verifies the payload signature, then answers
 * every text message in the batch. The reply is sent out-of-band via the Graph
 * API, so we acknowledge the webhook immediately (Meta retries on non-200s).
 */
export async function handleInbound(
	rawBody: string,
	signature: string | null,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	if (!(await verifySignature(rawBody, signature, env))) {
		return new Response("Invalid signature", { status: 401 });
	}

	let payload: WhatsAppWebhookPayload;
	try {
		payload = JSON.parse(rawBody);
	} catch {
		return new Response("Bad JSON", { status: 400 });
	}

	// Process replies after acknowledging so the webhook returns fast.
	ctx.waitUntil(respondToMessages(payload, env));
	return new Response("EVENT_RECEIVED", { status: 200 });
}

async function respondToMessages(
	payload: WhatsAppWebhookPayload,
	env: Env,
): Promise<void> {
	for (const entry of payload.entry ?? []) {
		for (const change of entry.changes ?? []) {
			const value = change.value;
			for (const message of value?.messages ?? []) {
				if (message.type !== "text" || !message.text?.body) continue;

				const from = message.from; // the wearer's phone number == session id
				try {
					const reply = await ask(env, from, message.text.body);
					await sendText(env, from, reply);
				} catch (err) {
					console.error("Jarvis failed to answer:", err);
					await sendText(
						env,
						from,
						"Something went wrong on my end. Try me again in a moment.",
					);
				}
			}
		}
	}
}

export async function sendText(env: Env, to: string, body: string): Promise<void> {
	if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
		console.error("WhatsApp credentials missing; cannot deliver reply.");
		return;
	}

	const res = await fetch(
		`https://graph.facebook.com/${GRAPH_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				messaging_product: "whatsapp",
				to,
				type: "text",
				text: { body },
			}),
		},
	);

	if (!res.ok) {
		console.error("WhatsApp send failed:", res.status, await res.text());
	}
}

/**
 * Verify Meta's `X-Hub-Signature-256` header (HMAC-SHA256 of the raw body keyed
 * by the app secret). Fails CLOSED: with no `WHATSAPP_APP_SECRET` configured we
 * reject inbound webhooks rather than trust them, because an accepted message
 * now writes durable memory and reminders and triggers billable replies — a
 * forged, unsigned webhook must not be able to do that.
 */
async function verifySignature(
	rawBody: string,
	signature: string | null,
	env: Env,
): Promise<boolean> {
	if (!env.WHATSAPP_APP_SECRET) {
		console.error(
			"WHATSAPP_APP_SECRET not set — rejecting inbound webhook. Set it to enable the WhatsApp bridge.",
		);
		return false;
	}
	if (!signature?.startsWith("sha256=")) return false;

	const expected = signature.slice("sha256=".length);
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(env.WHATSAPP_APP_SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const mac = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(rawBody),
	);
	const actual = [...new Uint8Array(mac)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	return timingSafeEqual(actual, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) {
		mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return mismatch === 0;
}

// --- Minimal shape of the WhatsApp Cloud API webhook payload we consume. ---

interface WhatsAppWebhookPayload {
	entry?: Array<{
		changes?: Array<{
			value?: {
				messages?: Array<{
					from: string;
					type: string;
					text?: { body: string };
				}>;
			};
		}>;
	}>;
}
