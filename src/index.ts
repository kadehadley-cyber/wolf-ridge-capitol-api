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
	CLEAR_PREVIEW_COOKIE,
	CLEAR_SESSION_COOKIE,
	createPreviewCookie,
	createSessionCookie,
	getSession,
	hasValidSession,
	loginPage,
	repRoster,
	sessionRole,
	verifyCredentials,
} from "./auth";
import { ask, type ImageAttachment } from "./jarvis";
import { handleLeadScan, handleLeadsApi } from "./leads";
import { handleCheckout, handleCheckoutConfirm, handleOrdersList, handleStripeWebhook } from "./stripe";
import { handleRepAssign, handleRepFollowup, handleRepFollowupDone, handleRepLeads, handleRepNote } from "./rep";
import { handleAccountsApi } from "./accounts";
import { handleMarketingGenerate, handleMarketingReports } from "./marketing";
import { handleApprove, handleSignup } from "./signup";
import { handleRepApply } from "./rep-apply";
import { handleCallBook, handleCallBookingsList, handleCallSlots } from "./call-schedule";
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
		const isSiteHost =
			host === "cellunovabiologics.com" ||
			host === "www.cellunovabiologics.com" ||
			host === "cellsunova.com" ||
			host === "www.cellsunova.com";
		// Force HTTPS on the site domains, whatever the zone settings say. A plain
		// http page makes browsers warn "the information you're about to submit is
		// not secure" on every form.
		if (isSiteHost && url.protocol === "http:") {
			url.protocol = "https:";
			url.hostname = host.endsWith("cellsunova.com") ? "www.cellunovabiologics.com" : host;
			return Response.redirect(url.toString(), 301);
		}
		if (host === "cellunovabiologics.com" || host === "www.cellunovabiologics.com") {
			return serveCelluNova(request, env, url);
		}
		// The previous domain permanently redirects to the new one, keeping the path.
		if (host === "cellsunova.com" || host === "www.cellsunova.com") {
			url.hostname = "www.cellunovabiologics.com";
			return Response.redirect(url.toString(), 301);
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

/** Portal areas that only admin sessions may reach. Clinic accounts get
 *  exactly: protocols, clinic templates (incl. rebrandable materials),
 *  pricing/ordering, and their own order history — everything else here. */
function isAdminOnlyPath(p: string): boolean {
	return (
		p === "/portal/approve" ||
		[
			"/portal/crm",
			"/portal/marketing",
			"/portal/marketing-resources",
			"/portal/admin",
			"/portal/tickets",
			"/portal/support",
			"/portal/treatment-schedule",
			"/portal/welcome",
			"/portal/accounts",
		].some((base) => p === base || p.startsWith(base + "/"))
	);
}

/** Portal paths a rep session may reach: its own workspace, the marketing
 *  materials, the one sample protocol (Shoulder IM), and shared styling. */
function isRepAllowedPath(p: string): boolean {
	return (
		p === "/portal/rep" ||
		p.startsWith("/portal/rep/") ||
		p === "/portal/marketing" ||
		p.startsWith("/portal/marketing/") ||
		p === "/portal/marketing-resources" ||
		p === "/portal/protocols/library/shoulder-im.pdf" ||
		p.startsWith("/portal/styles/") ||
		p.startsWith("/portal/js/")
	);
}

/** For clinic and rep sessions, drop the links from served portal HTML that
 *  the account can't open, so the sidebar shows only what actually works. */
function stripNavFor(role: string, res: Response): Response {
	if (typeof HTMLRewriter === "undefined") return res; // non-workers runtime (tests)
	const type = res.headers.get("content-type") ?? "";
	if (!type.includes("text/html")) return res;
	const strip =
		role === "clinic"
			? ["/portal/crm", "/portal/marketing", "/portal/support", "/portal/treatment-schedule", "/portal/rep", "/portal/accounts"]
			: role === "rep"
				? ["/portal/crm", "/portal/protocols", "/portal/templates", "/portal/pricing", "/portal/orders", "/portal/support", "/portal/treatment-schedule", "/portal/accounts"]
				: role === "manager"
					? ["/portal/accounts"]
					: [];
	if (!strip.length) return res;
	const remove = { element(el: { remove(): void }) { el.remove(); } };
	let rw = new HTMLRewriter();
	for (const href of strip) rw = rw.on(`a[href="${href}"]`, remove);
	return rw.transform(res);
}

/**
 * cellunovabiologics.com: serve the static CelluNOVA site from the assets binding.
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
	if (url.hostname.toLowerCase() === "cellunovabiologics.com") {
		url.hostname = "www.cellunovabiologics.com";
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
			const account = await verifyCredentials(env, username, password);
			if (account) {
				// Clinic sign-ins never land on an admin-only page.
				const dest = account.role === "clinic" && isAdminOnlyPath(next) ? "/portal/" : next;
				return new Response(null, {
					status: 303,
					headers: { location: dest, "set-cookie": await createSessionCookie(env, account) },
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

	// ── Clinic sign-up ──
	if (p === "/signup") {
		if (request.method === "POST") return handleSignup(request, env);
		url.pathname = "/";
		url.search = "";
		url.hash = "";
		return Response.redirect(url.toString() + "#clinic-signup", 302);
	}

	// ── MD-call scheduling (public page at /schedule-a-call) ──
	if (p === "/api/call-slots" && request.method === "GET") {
		return handleCallSlots(request, env);
	}
	if (p === "/api/call-book" && request.method === "POST") {
		return handleCallBook(request, env);
	}
	if (p === "/portal/api/call-bookings") {
		const sess = await getSession(env, request);
		if (!sess) {
			return new Response(JSON.stringify({ error: "Sign in required." }), {
				status: 401,
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		}
		if (sess.role !== "admin" && sess.role !== "manager") {
			return new Response(JSON.stringify({ error: "Admin access required." }), {
				status: 403,
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		}
		return handleCallBookingsList(env);
	}

	// ── Rep application (public page at /become-a-rep posts here) ──
	if (p === "/rep-apply") {
		if (request.method === "POST") return handleRepApply(request, env);
		url.pathname = "/become-a-rep";
		url.search = "";
		return Response.redirect(url.toString(), 302);
	}

	// ── CRM leads API (JSON; admin session required, 401/403 not a redirect;
	//    a manager may read the list but never scan or import) ──
	if (p === "/portal/api/leads" || p === "/portal/api/leads/scan") {
		const role = await sessionRole(env, request);
		if (!role) {
			return new Response(JSON.stringify({ error: "Sign in required." }), {
				status: 401,
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		}
		const managerRead = role === "manager" && request.method === "GET" && p === "/portal/api/leads";
		if (role !== "admin" && !managerRead) {
			return new Response(JSON.stringify({ error: role === "manager" ? "Manager accounts are view-only." : "Admin access required." }), {
				status: 403,
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		}
		return p.endsWith("/scan") ? handleLeadScan(request, env) : handleLeadsApi(request, env);
	}

	// ── Admin "view as" preview: see the portal as a manager or a rep ──
	if (p === "/portal/api/preview" && request.method === "POST") {
		// The base session decides — a preview must not be able to nest or
		// escalate, so look through any active preview cookie.
		const base = await getSession(env, request, true);
		if (!base || base.role !== "admin") {
			return new Response(JSON.stringify({ error: "Admin access required." }), {
				status: base ? 403 : 401,
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		}
		let body: { role?: string; user?: string };
		try {
			body = (await request.json()) as typeof body;
		} catch {
			body = {};
		}
		const role = String(body.role ?? "");
		if (role === "") {
			return new Response(JSON.stringify({ ok: true, preview: null }), {
				status: 200,
				headers: { "content-type": "application/json; charset=utf-8", "set-cookie": CLEAR_PREVIEW_COOKIE },
			});
		}
		let user = String(body.user ?? "");
		if (role === "manager") {
			user = "Admin";
		} else if (role === "rep") {
			if (!(await repRoster(env)).includes(user)) {
				return new Response(JSON.stringify({ error: "Unknown rep." }), {
					status: 400,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
		} else {
			return new Response(JSON.stringify({ error: "Preview as manager or a rep." }), {
				status: 400,
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		}
		return new Response(JSON.stringify({ ok: true, preview: { role, user } }), {
			status: 200,
			headers: {
				"content-type": "application/json; charset=utf-8",
				"set-cookie": await createPreviewCookie(env, role as "manager" | "rep", user),
			},
		});
	}

	// Exit preview from the banner link — just clears the preview cookie.
	if (p === "/portal/preview/exit") {
		url.pathname = "/portal/accounts/";
		url.search = "";
		return new Response(null, {
			status: 303,
			headers: { location: url.toString(), "set-cookie": CLEAR_PREVIEW_COOKIE },
		});
	}

	// ── Marketing scanner API (admin, manager, rep; clinics never; report
	//    generation writes to D1, so managers stay read-only) ──
	if (p === "/portal/api/marketing/reports" || p === "/portal/api/marketing/generate") {
		const sess = await getSession(env, request);
		const mjson = (data: unknown, status: number) =>
			new Response(JSON.stringify(data), {
				status,
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		if (!sess) return mjson({ error: "Sign in required." }, 401);
		if (sess.role === "clinic") return mjson({ error: "Not available to clinic accounts." }, 403);
		if (p === "/portal/api/marketing/reports" && request.method === "GET") {
			return handleMarketingReports(env);
		}
		if (p === "/portal/api/marketing/generate" && request.method === "POST") {
			if (sess.role === "manager") return mjson({ error: "Manager accounts are view-only." }, 403);
			return handleMarketingGenerate(request, env);
		}
		return mjson({ error: "Method not allowed." }, 405);
	}

	// ── Account manager API (JSON; strictly the admin — not even the manager) ──
	if (p === "/portal/api/accounts") {
		const sess = await getSession(env, request);
		if (!sess) {
			return new Response(JSON.stringify({ error: "Sign in required." }), {
				status: 401,
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		}
		if (sess.role !== "admin") {
			return new Response(JSON.stringify({ error: "Admin access required." }), {
				status: 403,
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		}
		return handleAccountsApi(request, env);
	}

	// ── Rep workspace API (JSON; rep sees own assignments, admin everything,
	//    manager read-only, clinic never) ──
	if (p.startsWith("/portal/api/rep/")) {
		const sess = await getSession(env, request);
		if (!sess) {
			return new Response(JSON.stringify({ error: "Sign in required." }), {
				status: 401,
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		}
		const deny = (msg: string, status = 403) =>
			new Response(JSON.stringify({ error: msg }), {
				status,
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		if (sess.role === "clinic") return deny("Not available to clinic accounts.");
		if (p === "/portal/api/rep/leads" && request.method === "GET") return handleRepLeads(env, sess);
		if (request.method !== "POST") return deny("Method not allowed.", 405);
		// Assignment is the one write managers may make — routing leads to reps
		// is management work; everything else stays view-only for them.
		if (p === "/portal/api/rep/assign") {
			return sess.role === "admin" || sess.role === "manager"
				? handleRepAssign(request, env)
				: deny("Admin or manager access required.");
		}
		if (sess.role === "manager") return deny("Manager accounts are view-only.");
		if (p === "/portal/api/rep/note") return handleRepNote(request, env, sess);
		if (p === "/portal/api/rep/followup") return handleRepFollowup(request, env, sess);
		if (p === "/portal/api/rep/followup-done") return handleRepFollowupDone(request, env, sess);
		return deny("Not found.", 404);
	}

	// ── Ordering API (JSON; session required) ──
	if (p === "/portal/api/checkout" || p === "/portal/api/checkout/confirm" || p === "/portal/api/orders") {
		const sess = await getSession(env, request);
		if (!sess) {
			return new Response(JSON.stringify({ error: "Sign in required." }), {
				status: 401,
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		}
		if (p === "/portal/api/checkout" || p === "/portal/api/checkout/confirm") {
			// Managers observe; they don't place or record orders.
			if (sess.role === "manager") {
				return new Response(JSON.stringify({ error: "Manager accounts are view-only." }), {
					status: 403,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
			if (p === "/portal/api/checkout") return handleCheckout(request, env, sess.user);
			return handleCheckoutConfirm(request, env);
		}
		return handleOrdersList(request, env, sess);
	}

	// Stripe calls this with a signed payload; no session, signature is the auth.
	if (p === "/stripe/webhook") {
		return handleStripeWebhook(request, env);
	}

	if (request.method !== "GET" && request.method !== "HEAD") {
		return new Response("Method not allowed", { status: 405 });
	}

	// Internal working docs never ship, whatever the path.
	if (/\.md$/i.test(p) || p.includes("/hardening/")) {
		return new Response("Not found", { status: 404 });
	}

	// ── Portal requires a signed session; everything else is public ──
	let role: import("./auth").Role | null = null;
	let previewing: { role: string; user: string } | null = null;
	if (p === "/portal" || p.startsWith("/portal/")) {
		const sess = await getSession(env, request);
		role = sess?.role ?? null;
		if (sess?.preview) previewing = { role: sess.role, user: sess.user };
		if (!role) {
			url.pathname = "/login";
			url.search = "?next=" + encodeURIComponent(p + url.search);
			return Response.redirect(url.toString(), 302);
		}
		// Clinic accounts get the clinic-facing pages only.
		if (role === "clinic" && isAdminOnlyPath(p)) {
			url.pathname = "/portal/";
			url.search = "";
			return Response.redirect(url.toString(), 302);
		}
		// Managers see every page but never act: the approve link writes, and
		// the account manager is strictly the admin's.
		if (role === "manager" && (p === "/portal/approve" || p === "/portal/accounts" || p.startsWith("/portal/accounts/"))) {
			url.pathname = "/portal/";
			url.search = "";
			return Response.redirect(url.toString(), 302);
		}
		// Reps live in their workspace: assigned leads, the marketing
		// materials, and the sample protocol — nothing else.
		if (role === "rep" && !isRepAllowedPath(p)) {
			url.pathname = "/portal/rep/";
			url.search = "";
			return Response.redirect(url.toString(), 302);
		}
	}

	// Approve link from the clinic-application review email (session-gated
	// above, plus its own per-application token).
	if (p === "/portal/approve") {
		return handleApprove(env, url);
	}

	// Redirects: legacy names, and page dirs get a trailing slash so their
	// relative asset URLs (crm.css, pricing.js, ...) resolve correctly.
	const redirects = new Map<string, string>([
		["/portal", "/portal/"],
		["/portal/protocols", "/portal/"],
		["/portal/support", "/portal/tickets/"],
		["/portal/marketing-resources", "/portal/marketing/"],
	]);
	for (const dir of ["crm", "pricing", "orders", "tickets", "treatment-schedule", "welcome", "admin", "marketing", "templates", "rep", "accounts"]) {
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

	// The assets binding answers a literal "x.html" request with a redirect to
	// the extensionless pretty URL — but that redirect points into the internal
	// /clinic-portal/ namespace, which is not publicly routable. Ask for the
	// pretty path directly so the content serves with no redirect at all.
	if (/\.html$/i.test(assetPath)) assetPath = assetPath.slice(0, -5);

	const assetUrl = new URL(assetPath, url.origin);
	let res = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));

	// Safety net: any asset redirect that leaks the internal /clinic-portal/
	// prefix is rewritten back into the public /portal/ URL space.
	if (res.status >= 300 && res.status < 400) {
		const loc = res.headers.get("location") ?? "";
		const m = /^(?:https?:\/\/[^/]+)?\/clinic-portal(\/.*)?$/.exec(loc);
		if (m) {
			const inner = m[1] ?? "/";
			const publicPath = inner.startsWith("/site") ? inner.slice("/site".length) || "/" : "/portal" + inner;
			const headers = new Headers(res.headers);
			headers.set("location", new URL(publicPath, url.origin).toString());
			res = new Response(null, { status: res.status, headers });
		}
	}
	if (role) res = stripNavFor(role, res);
	if (previewing) res = injectPreviewBanner(res, previewing);
	return res;
}

/** Floating banner on every portal page while the admin previews a role. */
function injectPreviewBanner(res: Response, preview: { role: string; user: string }): Response {
	if (typeof HTMLRewriter === "undefined") return res; // non-workers runtime (tests)
	const type = res.headers.get("content-type") ?? "";
	if (!type.includes("text/html")) return res;
	const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const banner =
		`<div class="preview-banner">Viewing the portal as <strong>${escText(preview.user)}</strong>` +
		` (${escText(preview.role)}) — this is exactly what they see. ` +
		`<a href="/portal/preview/exit">Exit preview</a></div>`;
	return new HTMLRewriter()
		.on("body", { element(el: { append(html: string, opts: { html: boolean }): void }) { el.append(banner, { html: true }); } })
		.transform(res);
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
