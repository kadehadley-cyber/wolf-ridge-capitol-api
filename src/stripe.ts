// Stripe Checkout for the portal's ordering flow on cellunovabiologics.com.
//
//   POST /portal/api/checkout          create a Checkout Session from the cart;
//                                      the browser redirects to Stripe's hosted
//                                      payment page (cards never touch us)
//   GET  /portal/api/checkout/confirm  after Stripe redirects back, verify the
//                                      session server-side and record the order
//   GET  /portal/api/orders            the clinic's recorded orders
//   POST /stripe/webhook               signed Stripe events (backup recorder)
//
// Configuration (Worker secrets — never in the repo):
//   STRIPE_SECRET_KEY      required; without it checkout returns 503
//   STRIPE_WEBHOOK_SECRET  optional; enables the signed webhook recorder
//
// Prices are computed HERE from the canonical catalog. The client sends only
// product ids and quantities, so a tampered page can't change what's charged.

import { adminEmail, esc, sendEmail } from "./email";

const SITE = "https://www.cellunovabiologics.com";

// The NOVA line: $800 per cc, NOVA-E1 at $500 per cc (unit_amount is cents).
// Each product sells only its listed volumes: V1/M1/E2 in 1 or 2 cc, E1 in
// 1, 2, or 3 cc.
const CATALOG: Record<string, { name: string; perCcCents: number; vols: Record<string, number> }> = {
	"nova-flow": { name: "NOVA-V1", perCcCents: 80000, vols: { "1 cc": 1, "2 cc": 2 } },
	"nova-flex": { name: "NOVA-M1", perCcCents: 80000, vols: { "1 cc": 1, "2 cc": 2 } },
	"nova-elite": { name: "NOVA-E2", perCcCents: 80000, vols: { "1 cc": 1, "2 cc": 2 } },
	"exo-plus": { name: "NOVA-E1", perCcCents: 50000, vols: { "1 cc": 1, "2 cc": 2, "3 cc": 3 } },
	// Materials & Extras — fixed-price equipment.
	"cryofreezer": { name: "-80°C Cryofreezer", perCcCents: 270000, vols: { "1 unit": 1 } },
};
const MAX_LINES = 20;
const MAX_QTY = 50;

const ensured = new WeakMap<object, Promise<unknown>>();
function ensureOrdersTable(env: Env): Promise<unknown> {
	let p = ensured.get(env.DB);
	if (!p) {
		p = env.DB.prepare(
			`CREATE TABLE IF NOT EXISTS orders (
				id TEXT PRIMARY KEY,
				data TEXT NOT NULL,
				created_at TEXT NOT NULL
			)`,
		).run();
		ensured.set(env.DB, p);
	}
	return p;
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
	});
}

async function stripeApi(env: Env, method: "GET" | "POST", path: string, body?: URLSearchParams) {
	const res = await fetch(`https://api.stripe.com${path}`, {
		method,
		headers: {
			authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
			...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
		},
		body: body?.toString(),
	});
	const data = (await res.json()) as Record<string, unknown>;
	if (!res.ok) {
		const err = (data.error as { message?: string } | undefined)?.message ?? `stripe ${res.status}`;
		throw new Error(err);
	}
	return data;
}

/** POST /portal/api/checkout — cart in, Stripe-hosted payment page URL out.
 *  `account` is the signed-in username; it rides in the session metadata so
 *  the recorded order is attributed to the clinic that placed it. */
export async function handleCheckout(request: Request, env: Env, account = ""): Promise<Response> {
	if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
	if (!env.STRIPE_SECRET_KEY) {
		return json({ error: "Payments aren't configured yet. Set the STRIPE_SECRET_KEY secret." }, 503);
	}

	let body: { items?: Array<{ id?: string; vol?: string; qty?: number }>; notes?: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: "Body must be JSON." }, 400);
	}
	const items = (body.items ?? []).slice(0, MAX_LINES);
	if (!items.length) return json({ error: "The order is empty." }, 400);

	const params = new URLSearchParams({ mode: "payment" });
	params.set("success_url", `${SITE}/portal/orders/?session_id={CHECKOUT_SESSION_ID}`);
	params.set("cancel_url", `${SITE}/portal/pricing/`);
	let i = 0;
	for (const item of items) {
		const product = CATALOG[String(item.id ?? "")];
		const cc = product?.vols[String(item.vol ?? "")];
		const qty = Math.floor(Number(item.qty) || 0);
		if (!product || !cc) return json({ error: "Unknown product or size." }, 400);
		if (qty < 1 || qty > MAX_QTY) return json({ error: "Quantity out of range." }, 400);
		params.set(`line_items[${i}][quantity]`, String(qty));
		params.set(`line_items[${i}][price_data][currency]`, "usd");
		params.set(`line_items[${i}][price_data][unit_amount]`, String(product.perCcCents * cc));
		params.set(`line_items[${i}][price_data][product_data][name]`, `${product.name} — ${item.vol}`);
		i++;
	}
	const notes = String(body.notes ?? "").slice(0, 480);
	if (notes) params.set("metadata[notes]", notes);
	params.set("metadata[source]", "clinic-portal");
	if (account) params.set("metadata[account]", account.slice(0, 100));

	try {
		const session = await stripeApi(env, "POST", "/v1/checkout/sessions", params);
		return json({ id: session.id, url: session.url });
	} catch (err) {
		console.error("stripe checkout error:", err);
		return json({ error: "Could not start checkout. Please try again." }, 502);
	}
}

interface StripeSession {
	id?: string;
	payment_status?: string;
	amount_total?: number;
	currency?: string;
	created?: number;
	metadata?: { notes?: string; account?: string };
	line_items?: { data?: Array<{ description?: string; quantity?: number; amount_total?: number }> };
}

/** Store a paid session as an order row (idempotent by session id). */
async function recordPaidSession(env: Env, session: StripeSession): Promise<Record<string, unknown>> {
	const items = (session.line_items?.data ?? []).map((li) => {
		const [name, vol] = String(li.description ?? "").split(" — ");
		const qty = Number(li.quantity) || 1;
		return {
			name: name || "Item",
			vol: vol || "",
			qty,
			price: Math.round((Number(li.amount_total) || 0) / qty) / 100,
		};
	});
	const order = {
		id: session.id,
		number: "CN-" + String(session.id ?? "").slice(-6).toUpperCase(),
		date: new Date((Number(session.created) || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
		status: "paid",
		stage: 2, // paid and confirmed — straight to fulfilment
		total: (Number(session.amount_total) || 0) / 100,
		currency: session.currency ?? "usd",
		notes: session.metadata?.notes ?? "",
		account: session.metadata?.account ?? "",
		items,
	};
	await ensureOrdersTable(env);
	const existing = await env.DB.prepare(`SELECT id FROM orders WHERE id = ?1`)
		.bind(String(session.id))
		.first();
	await env.DB.prepare(`INSERT OR REPLACE INTO orders (id, data, created_at) VALUES (?1, ?2, ?3)`)
		.bind(String(session.id), JSON.stringify(order), order.date)
		.run();
	// Notify on first record only — confirm-on-return and the webhook can both
	// land here for the same session, but the admin should hear about it once.
	if (!existing) {
		await sendEmail(env, adminEmail(env), `New paid order: ${order.number}`, orderNotificationEmail(order));
	}
	return order;
}

/** Admin notification for a freshly paid order. */
function orderNotificationEmail(order: {
	number: string;
	date: string;
	total: number;
	currency: string;
	notes: string;
	account?: string;
	items: { name: string; vol: string; qty: number; price: number }[];
}): string {
	const rows = order.items
		.map(
			(it) => `<tr>
	<td style="padding:6px 10px;border-bottom:1px solid #e3ecea;font-size:14px;color:#16403b;">${esc(it.name)}${it.vol ? " — " + esc(it.vol) : ""}</td>
	<td style="padding:6px 10px;border-bottom:1px solid #e3ecea;font-size:14px;color:#4a5f58;text-align:center;">×${it.qty}</td>
	<td style="padding:6px 10px;border-bottom:1px solid #e3ecea;font-size:14px;color:#16403b;text-align:right;">$${(it.price * it.qty).toLocaleString("en-US")}</td>
</tr>`,
		)
		.join("");
	return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f6faf9;">
<div style="background:#ffffff;border:1px solid #e3ecea;border-radius:10px;padding:24px;">
<h1 style="margin:0 0 6px;font-size:21px;color:#16403b;">New paid order ${esc(order.number)}</h1>
<p style="margin:0 0 16px;font-size:14px;color:#4a5f58;">Paid ${esc(order.date)}${order.account ? ` by <strong style="color:#16403b;">${esc(order.account)}</strong>` : ""} — now in fulfilment. Ship cold-chain with tracking.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rows}
<tr><td style="padding:10px;font-size:15px;font-weight:bold;color:#16403b;" colspan="2">Total paid</td>
<td style="padding:10px;font-size:15px;font-weight:bold;color:#16403b;text-align:right;">$${order.total.toLocaleString("en-US")} ${esc(order.currency.toUpperCase())}</td></tr>
</table>
${order.notes ? `<p style="margin:14px 0 0;font-size:13px;color:#4a5f58;"><strong style="color:#16403b;">Clinic notes:</strong> ${esc(order.notes)}</p>` : ""}
<p style="margin:18px 0 0;"><a href="${SITE}/portal/orders/" style="display:inline-block;background:#2e7d74;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:10px 18px;border-radius:6px;">Open Order History</a></p>
</div></div>`;
}

/** GET /portal/api/checkout/confirm?session_id=… — verify with Stripe, record. */
export async function handleCheckoutConfirm(request: Request, env: Env): Promise<Response> {
	if (!env.STRIPE_SECRET_KEY) return json({ error: "Payments aren't configured yet." }, 503);
	const sessionId = new URL(request.url).searchParams.get("session_id") ?? "";
	if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return json({ error: "Bad session id." }, 400);
	try {
		const session = (await stripeApi(
			env,
			"GET",
			`/v1/checkout/sessions/${sessionId}?expand[]=line_items`,
		)) as StripeSession;
		if (session.payment_status !== "paid") {
			return json({ paid: false, status: session.payment_status ?? "unknown" });
		}
		const order = await recordPaidSession(env, session);
		return json({ paid: true, order });
	} catch (err) {
		console.error("stripe confirm error:", err);
		return json({ error: "Could not verify the payment." }, 502);
	}
}

/** GET /portal/api/orders — recorded orders, newest first. Admin and manager
 *  sessions see everything; a clinic session sees only its own orders. */
export async function handleOrdersList(
	_request: Request,
	env: Env,
	session: { role: string; user: string } = { role: "admin", user: "" },
): Promise<Response> {
	await ensureOrdersTable(env);
	const rows = await env.DB.prepare(`SELECT data FROM orders ORDER BY created_at DESC`).all<{ data: string }>();
	const orders: unknown[] = [];
	for (const row of rows.results ?? []) {
		try {
			const order = JSON.parse(row.data) as { account?: string };
			if (session.role === "admin" || session.role === "manager" || (order.account ?? "") === session.user) orders.push(order);
		} catch {
			// Skip an unparsable row rather than failing the list.
		}
	}
	return json({ orders });
}

const encoder = new TextEncoder();
function timingSafeEqualStr(a: string, b: string): boolean {
	const ab = encoder.encode(a);
	const bb = encoder.encode(b);
	let mismatch = ab.length ^ bb.length;
	for (let i = 0; i < ab.length; i++) mismatch |= ab[i] ^ bb[i % bb.length || 0];
	return mismatch === 0;
}

/** POST /stripe/webhook — signature-verified backup recorder, so orders are
 *  captured even when the buyer never returns to the success page. */
export async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
	if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
	if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "Webhook not configured." }, 501);

	const payload = await request.text();
	const sigHeader = request.headers.get("stripe-signature") ?? "";
	const parts = new Map(sigHeader.split(",").map((p) => p.split("=", 2) as [string, string]));
	const t = parts.get("t") ?? "";
	const v1 = parts.get("v1") ?? "";
	if (!t || !v1 || Math.abs(Date.now() / 1000 - Number(t)) > 300) {
		return json({ error: "Bad signature." }, 400);
	}
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(env.STRIPE_WEBHOOK_SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${t}.${payload}`));
	const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
	if (!timingSafeEqualStr(expected, v1)) return json({ error: "Bad signature." }, 400);

	let event: { type?: string; data?: { object?: StripeSession } };
	try {
		event = JSON.parse(payload);
	} catch {
		return json({ error: "Bad payload." }, 400);
	}
	if (event.type === "checkout.session.completed" && event.data?.object?.id) {
		try {
			// Re-fetch with line items expanded (webhook payloads omit them).
			const session = (await stripeApi(
				env,
				"GET",
				`/v1/checkout/sessions/${event.data.object.id}?expand[]=line_items`,
			)) as StripeSession;
			if (session.payment_status === "paid") await recordPaidSession(env, session);
		} catch (err) {
			console.error("stripe webhook record error:", err);
			return json({ error: "Record failed." }, 500);
		}
	}
	return json({ received: true });
}
