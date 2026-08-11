// Jarvis — a voice assistant backend for Meta AI glasses, running on a
// Cloudflare Worker.
//
// Routes:
//   GET  /            -> status / setup page
//   POST /jarvis      -> generic voice endpoint: { text, sessionId? } -> { reply }
//   GET  /briefing    -> proactive spoken briefing: ?sessionId= -> { reply }
//   GET  /whatsapp    -> WhatsApp webhook verification handshake
//   POST /whatsapp    -> WhatsApp inbound messages (the glasses bridge)
//
// Plus a scheduled (cron) handler that pushes due reminders and the daily
// briefing when a WhatsApp delivery channel is configured.

import {
	CLEAR_SESSION_COOKIE,
	createSessionCookie,
	hasValidSession,
	loginPage,
	verifyCredentials,
} from "./auth";
import { ask, type ImageAttachment } from "./jarvis";
import { composeBriefing } from "./briefing";
import { runScheduled } from "./cron";
import { handleInbound, verifyWebhook } from "./whatsapp";
import { renderHtml } from "./renderHtml";
import { appManifest, APP_SW, iconBytes, renderAppHtml } from "./app";

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		// The public CelluNOVA site lives on its own domain; everything else
		// (workers.dev, previews) keeps serving the Jarvis API below.
		const host = url.hostname.toLowerCase();
		if (host === "cellsunova.com" || host === "www.cellsunova.com") {
			return serveCelluNova(request, env, url);
		}

		switch (`${request.method} ${url.pathname}`) {
			case "GET /":
				return new Response(renderHtml(env), {
					headers: { "content-type": "text/html; charset=utf-8" },
				});

			// The phone app (installable PWA). Static UI only — the /jarvis calls it
			// makes still carry the bearer key. /app/ is canonical so the service
			// worker's scope covers the whole app.
			case "GET /app":
				return Response.redirect(new URL("/app/", url).toString(), 301);
			case "GET /app/":
				return new Response(renderAppHtml(env), {
					headers: { "content-type": "text/html; charset=utf-8" },
				});
			case "GET /app/manifest.webmanifest":
				return new Response(appManifest(env.JARVIS_NAME || "Jarvis"), {
					headers: { "content-type": "application/manifest+json" },
				});
			case "GET /app/sw.js":
				return new Response(APP_SW, {
					headers: { "content-type": "text/javascript; charset=utf-8" },
				});
			case "GET /app/icon-192.png":
			case "GET /app/icon-512.png":
				return new Response(iconBytes(url.pathname.includes("512") ? "512" : "192"), {
					headers: {
						"content-type": "image/png",
						"cache-control": "public, max-age=86400",
					},
				});

			case "GET /whatsapp":
				return verifyWebhook(url, env);

			case "POST /whatsapp": {
				const raw = await request.text();
				const signature = request.headers.get("x-hub-signature-256");
				return handleInbound(raw, signature, env, ctx);
			}

			case "POST /jarvis":
				if (!authorized(request, env)) return unauthorized();
				return handleJarvis(request, env);

			case "GET /briefing":
				if (!authorized(request, env)) return unauthorized();
				return handleBriefing(url, env);

			default:
				return new Response("Not found", { status: 404 });
		}
	},

	// Cron entrypoint: sweep due reminders and deliver scheduled briefings. The
	// work is gated on WhatsApp being configured, so this no-ops otherwise.
	async scheduled(_controller, env, ctx) {
		ctx.waitUntil(runScheduled(env, new Date()));
	},
} satisfies ExportedHandler<Env>;

/**
 * cellsunova.com: serve the static CelluNOVA site from the assets binding.
 *
 * URL scheme (public URLs on the left, files under web/ on the right):
 *   /                    -> clinic-portal/site/            (homepage)
 *   /site.css, /site.js  -> clinic-portal/site/...         (homepage assets)
 *   /portal/             -> clinic-portal/                 (Protocols page)
 *   /portal/<page>/      -> clinic-portal/<page>/          (crm, pricing, ...)
 *
 * run_worker_first is on, so nothing under web/ is reachable except through
 * these mappings; internal docs (*.md, hardening/) are never served.
 */
async function serveCelluNova(request: Request, env: Env, url: URL): Promise<Response> {
	// Canonical host: apex redirects to www.
	if (url.hostname.toLowerCase() === "cellsunova.com") {
		url.hostname = "www.cellsunova.com";
		return Response.redirect(url.toString(), 301);
	}

	const p = url.pathname;

	// ── Sign in / sign out ──
	if (p === "/login") {
		if (request.method === "POST") {
			const form = await request.formData();
			const username = String(form.get("username") ?? "");
			const password = String(form.get("password") ?? "");
			const nextRaw = String(form.get("next") ?? "/portal/");
			const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/portal/";
			if (await verifyCredentials(env, username, password)) {
				return new Response(null, {
					status: 303,
					headers: { location: next, "set-cookie": await createSessionCookie(env) },
				});
			}
			return loginPage(true, next);
		}
		if (await hasValidSession(env, request)) {
			url.pathname = "/portal/";
			url.search = "";
			return Response.redirect(url.toString(), 302);
		}
		return loginPage(false, url.searchParams.get("next") ?? "/portal/");
	}
	if (p === "/logout") {
		url.pathname = "/";
		url.search = "";
		return new Response(null, {
			status: 303,
			headers: { location: url.toString(), "set-cookie": CLEAR_SESSION_COOKIE },
		});
	}

	if (request.method !== "GET" && request.method !== "HEAD") {
		return new Response("Method not allowed", { status: 405 });
	}

	// Internal working docs never ship, whatever the path.
	if (/\.md$/i.test(p) || p.includes("/hardening/")) {
		return new Response("Not found", { status: 404 });
	}

	// ── Portal requires a signed session; everything else is public ──
	if (p === "/portal" || p.startsWith("/portal/")) {
		if (!(await hasValidSession(env, request))) {
			url.pathname = "/login";
			url.search = "?next=" + encodeURIComponent(p);
			return Response.redirect(url.toString(), 302);
		}
	}

	// Redirects: legacy names, and page dirs get a trailing slash so their
	// relative asset URLs (crm.css, pricing.js, ...) resolve correctly.
	const redirects = new Map<string, string>([
		["/portal", "/portal/"],
		["/portal/protocols", "/portal/"],
		["/portal/support", "/portal/tickets/"],
		["/portal/marketing-resources", "/portal/marketing/"],
	]);
	for (const dir of ["crm", "pricing", "orders", "tickets", "treatment-schedule", "welcome", "admin", "marketing"]) {
		redirects.set(`/portal/${dir}`, `/portal/${dir}/`);
	}
	const target = redirects.get(p);
	if (target) {
		url.pathname = target;
		return Response.redirect(url.toString(), 301);
	}

	// Map the public path to its location under web/.
	let assetPath: string;
	if (p === "/" || p === "/index.html") {
		assetPath = "/clinic-portal/site/";
	} else if (p.startsWith("/portal/")) {
		assetPath = "/clinic-portal/" + p.slice("/portal/".length);
	} else {
		// Homepage-relative assets (/site.css, /site.js) and anything else.
		assetPath = "/clinic-portal/site" + p;
	}

	const assetUrl = new URL(assetPath, url.origin);
	return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
}

/**
 * Channel-agnostic voice endpoint. Point any speech-to-text / text-to-speech
 * bridge (an iOS Shortcut, a relay app, your own glasses integration) at this:
 * POST a transcript, speak the `reply` back.
 */
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
// Base64 inflates by ~4/3, so 5M chars decode to ~3.75 MB — comfortably under the
// Anthropic API's 5 MB per-image ceiling. Keeping the local gate below the API's
// means an oversized photo gets a clean 413 here instead of failing the whole turn.
const MAX_IMAGE_B64_CHARS = 5_000_000;

async function handleJarvis(request: Request, env: Env): Promise<Response> {
	let body: {
		text?: string;
		sessionId?: string;
		imageBase64?: string;
		imageType?: string;
	};
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

	// Optional image (identification via vision): raw base64 or a data: URL.
	let image: ImageAttachment | undefined;
	if (typeof body.imageBase64 === "string" && body.imageBase64) {
		// Match any media type (case-insensitive, and subtypes with +/-/. like
		// image/svg+xml) so the prefix is always stripped; the type is then
		// validated against IMAGE_TYPES below, giving a clean 415 for unsupported
		// kinds instead of forwarding the whole data: URL as base64 payload.
		const dataUrl = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.*)$/is.exec(body.imageBase64);
		const data = dataUrl ? dataUrl[2] : body.imageBase64;
		const mediaType = (dataUrl?.[1] ?? body.imageType ?? "image/jpeg").toLowerCase();
		if (!IMAGE_TYPES.has(mediaType)) {
			return json({ error: "Unsupported image type." }, 415);
		}
		if (data.length > MAX_IMAGE_B64_CHARS) {
			return json({ error: "Image too large." }, 413);
		}
		image = { data, mediaType: mediaType as ImageAttachment["mediaType"] };
	}

	try {
		const reply = await ask(env, sessionId, text, image);
		return json({ reply, sessionId });
	} catch (err) {
		console.error("Jarvis error:", err);
		return json({ error: "Jarvis is unavailable right now." }, 503);
	}
}

/**
 * Proactive briefing endpoint. Returns a spoken-style summary of the wearer's
 * day (time, weather, reminders) for the given session — the "speak first"
 * surface, available with or without an API key.
 */
async function handleBriefing(url: URL, env: Env): Promise<Response> {
	const sessionId = (url.searchParams.get("sessionId") ?? "default").toString();
	try {
		const reply = await composeBriefing(env, sessionId, new Date());
		return json({ reply, sessionId });
	} catch (err) {
		console.error("Briefing error:", err);
		return json({ error: "Jarvis couldn't put a briefing together right now." }, 503);
	}
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

/**
 * Gate the HTTP endpoints that touch a session's durable memory. When
 * JARVIS_API_KEY is set, require a matching bearer token (constant-time compare);
 * when it isn't, stay open for zero-config local use.
 */
function authorized(request: Request, env: Env): boolean {
	if (!env.JARVIS_API_KEY) return true;
	const header = request.headers.get("authorization") ?? "";
	const match = /^Bearer\s+(.+)$/i.exec(header);
	return match ? timingSafeEqual(match[1], env.JARVIS_API_KEY) : false;
}

function unauthorized(): Response {
	return json({ error: "Unauthorized." }, 401);
}

/** Length-independent constant-time string comparison. */
function timingSafeEqual(a: string, b: string): boolean {
	const enc = new TextEncoder();
	const ab = enc.encode(a);
	const bb = enc.encode(b);
	// Compare against a fixed-length digest so length itself isn't a side channel.
	let mismatch = ab.length ^ bb.length;
	for (let i = 0; i < ab.length; i++) {
		mismatch |= ab[i] ^ bb[(i % bb.length) || 0];
	}
	return mismatch === 0;
}
