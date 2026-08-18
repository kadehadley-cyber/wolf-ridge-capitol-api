// Clinic sign-up flow for cellunovabiologics.com.
//
//   POST /signup           public application form (homepage #clinic-signup)
//   GET  /portal/approve   approve link from the review email; session-gated by
//                          the /portal/* auth wall AND a per-application token
//
// Every application is stored in D1 first, so nothing is lost even when email
// sending is not configured yet. The review email to the admin carries an
// Approve button; approving marks the row and sends the clinic the on-brand
// welcome email.

import { adminEmail, esc, sendEmail } from "./email";

const SITE = "https://www.cellunovabiologics.com";

/* ── D1 ─────────────────────────────────────────────────────────────────── */

const ensured = new WeakMap<object, Promise<unknown>>();

export function ensureApplicationsTable(env: Env): Promise<unknown> {
	let p = ensured.get(env.DB);
	if (!p) {
		p = env.DB.prepare(
			`CREATE TABLE IF NOT EXISTS clinic_applications (
				id TEXT PRIMARY KEY,
				clinic_name TEXT NOT NULL,
				contact_name TEXT NOT NULL,
				email TEXT NOT NULL,
				phone TEXT NOT NULL,
				npi TEXT,
				status TEXT NOT NULL DEFAULT 'pending',
				token TEXT NOT NULL,
				created_at TEXT NOT NULL,
				approved_at TEXT
			)`,
		).run();
		ensured.set(env.DB, p);
	}
	return p;
}

interface Application {
	id: string;
	clinic_name: string;
	contact_name: string;
	email: string;
	phone: string;
	npi: string | null;
	status: string;
	token: string;
	created_at: string;
	approved_at: string | null;
}

/* ── Small branded page shell (matches the login page look) ─────────────── */

export function page(title: string, inner: string, status = 200): Response {
	const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} - CelluNOVA</title>
<style>
:root { color-scheme: dark; }
body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
  background:#0b120f; color:#eef5f1; font-family:system-ui,-apple-system,"Segoe UI",sans-serif; }
.card { width:100%; max-width:440px; margin:20px; padding:36px 34px; border-radius:18px;
  background:#0f1714; border:1px solid rgba(255,255,255,.12); box-shadow:0 30px 70px rgba(0,0,0,.55); }
h1 { font-size:22px; margin:0 0 10px; } h1 span { color:#7dd340; }
p { font-size:14px; color:#8aa39b; line-height:1.65; margin:0 0 12px; }
strong { color:#eef5f1; }
a.btn { display:inline-block; margin-top:10px; padding:12px 22px; border-radius:9px; background:#6fce35;
  color:#04120a; font-weight:800; font-size:13px; letter-spacing:.05em; text-transform:uppercase; text-decoration:none; }
a.plain { color:#7dd340; text-decoration:none; }
</style>
</head>
<body><div class="card">${inner}</div></body>
</html>`;
	return new Response(html, {
		status,
		headers: {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store",
			"content-security-policy":
				"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
		},
	});
}

/* ── Email templates (light, on the brand kit's clinical palette) ───────── */

function emailShell(inner: string): string {
	return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f2f7f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f7f5;padding:28px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
<tr><td style="background:#16403b;padding:22px 32px;">
  <span style="font-size:20px;font-weight:bold;color:#ffffff;">Cellu<span style="color:#7dd340;">NOVA</span></span>
</td></tr>
<tr><td style="height:4px;background:#d4af37;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:32px;">${inner}</td></tr>
<tr><td style="padding:20px 32px;background:#f6faf8;border-top:1px solid #e2ece8;">
  <p style="margin:0;font-size:11px;color:#6b7f78;line-height:1.6;">CelluNOVA, physician-led biologics distribution.
  For licensed clinics only. Not medical advice.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function button(href: string, label: string, color = "#6fce35", textColor = "#04120a"): string {
	return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0;"><tr>
<td style="border-radius:8px;background:${color};">
<a href="${esc(href)}" style="display:inline-block;padding:13px 26px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${textColor};text-decoration:none;letter-spacing:.4px;">${esc(label)}</a>
</td></tr></table>`;
}

function reviewEmail(app: Application, approveUrl: string): string {
	const row = (k: string, v: string) =>
		`<tr><td style="padding:7px 12px;font-size:13px;color:#6b7f78;white-space:nowrap;">${k}</td>
		 <td style="padding:7px 12px;font-size:13px;color:#16403b;font-weight:bold;">${esc(v)}</td></tr>`;
	return emailShell(`
<h1 style="margin:0 0 6px;font-size:21px;color:#16403b;">New clinic application</h1>
<p style="margin:0 0 18px;font-size:14px;color:#4a5f58;line-height:1.6;">A clinic has applied for portal access and is waiting for your review.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f6faf8;border:1px solid #e2ece8;border-radius:10px;">
${row("Clinic", app.clinic_name)}
${row("Owner / physician", app.contact_name)}
${row("Email", app.email)}
${row("Office number", app.phone)}
${row("NPI", app.npi || "Not provided")}
${row("Received", app.created_at)}
</table>
${button(approveUrl, "Approve this clinic")}
<p style="margin:0;font-size:12px;color:#6b7f78;line-height:1.6;">You will be asked to sign in to the portal first.
Approving sends the clinic their welcome email automatically.<br>
If the button does not work, open this link:<br>
<a href="${esc(approveUrl)}" style="color:#2e7d74;word-break:break-all;">${esc(approveUrl)}</a></p>`);
}

function welcomeEmail(app: Application, contactRep: string): string {
	const mailto = `mailto:${contactRep}?subject=${encodeURIComponent("Place an order for " + app.clinic_name)}`;
	const step = (n: number, text: string) =>
		`<tr><td style="width:30px;padding:8px 0;vertical-align:top;">
			<span style="display:inline-block;width:24px;height:24px;border-radius:12px;background:#6fce35;color:#04120a;font-size:13px;font-weight:bold;text-align:center;line-height:24px;">${n}</span>
		 </td><td style="padding:8px 0 8px 10px;font-size:14px;color:#4a5f58;line-height:1.6;">${text}</td></tr>`;
	return emailShell(`
<h1 style="margin:0 0 6px;font-size:22px;color:#16403b;">Congratulations, ${esc(app.contact_name)}!</h1>
<p style="margin:0 0 16px;font-size:15px;color:#4a5f58;line-height:1.7;"><strong style="color:#16403b;">${esc(app.clinic_name)}</strong>
has been approved. Welcome to the CelluNOVA team.</p>
<p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#2e7d74;text-transform:uppercase;letter-spacing:1px;">How to order from your portal</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
${step(1, 'Sign in to the clinic portal at <a href="' + SITE + '/portal/" style="color:#2e7d74;">www.cellunovabiologics.com/portal</a>. Your sign-in credentials arrive separately from our team.')}
${step(2, "Open <strong>Pricing &amp; Ordering</strong> and build your order from the NOVA product line, adding case notes for our team.")}
${step(3, "Pay securely by card at checkout — your order goes straight to fulfilment.")}
${step(4, "Orders ship cold-chain with tracking, with protocols matched to what you ordered.")}
</table>
${button(SITE + "/portal/", "Open the Clinic Portal")}
<p style="margin:6px 0 0;font-size:14px;color:#4a5f58;line-height:1.7;">Prefer a hand? Your rep can place the order for you.</p>
${button(mailto, "Have my rep place the order", "#16403b", "#ffffff")}
<p style="margin:10px 0 0;font-size:13px;color:#6b7f78;line-height:1.6;">Questions about protocols or a complex case?
Reply to this email to set up an MD-to-MD call with our medical board.</p>`);
}

/* ── Handlers ───────────────────────────────────────────────────────────── */

function field(form: FormData, name: string, max: number): string {
	return String(form.get(name) ?? "").trim().slice(0, max);
}

export async function handleSignup(request: Request, env: Env): Promise<Response> {
	const form = await request.formData();

	// Honeypot: bots that fill the invisible field get a quiet "success".
	if (String(form.get("website") ?? "") !== "") {
		return page("Application received", `<h1>Application <span>received</span></h1>
			<p>Thanks! Our medical team reviews every application.</p>`);
	}

	const clinic = field(form, "clinic_name", 200);
	const contact = field(form, "contact_name", 200);
	const email = field(form, "email", 320);
	const phone = field(form, "phone", 40);
	const npi = field(form, "npi", 20);

	if (!clinic || !contact || !phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return page(
			"Check your application",
			`<h1>Almost <span>there</span></h1>
			<p>Clinic name, owner or physician name, a valid email, and an office number are required.</p>
			<a class="btn" href="/#clinic-signup">Back to the form</a>`,
			400,
		);
	}

	await ensureApplicationsTable(env);
	const id = crypto.randomUUID();
	const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
	const createdAt = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO clinic_applications (id, clinic_name, contact_name, email, phone, npi, status, token, created_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
	)
		.bind(id, clinic, contact, email, phone, npi || null, "pending", token, createdAt)
		.run();

	const app: Application = {
		id, clinic_name: clinic, contact_name: contact, email, phone,
		npi: npi || null, status: "pending", token, created_at: createdAt, approved_at: null,
	};
	const approveUrl = `${SITE}/portal/approve?id=${id}&token=${token}`;
	await sendEmail(env, adminEmail(env), `New clinic application: ${clinic}`, reviewEmail(app, approveUrl));

	return page(
		"Application received",
		`<h1>Application <span>received</span></h1>
		<p>Thanks, <strong>${esc(contact)}</strong>. Our medical team reviews every clinic application.</p>
		<p>We will follow up at <strong>${esc(email)}</strong> once <strong>${esc(clinic)}</strong> has been reviewed.</p>
		<a class="btn" href="/">Back to cellunovabiologics.com</a>`,
	);
}

/** Constant-time string comparison (token check). */
function safeEqual(a: string, b: string): boolean {
	const enc = new TextEncoder();
	const ab = enc.encode(a);
	const bb = enc.encode(b);
	let mismatch = ab.length ^ bb.length;
	for (let i = 0; i < ab.length; i++) mismatch |= ab[i] ^ bb[i % bb.length || 0];
	return mismatch === 0;
}

export async function handleApprove(env: Env, url: URL): Promise<Response> {
	const id = url.searchParams.get("id") ?? "";
	const token = url.searchParams.get("token") ?? "";
	if (!id || !token) return page("Approval", `<h1>Missing <span>link</span></h1><p>This approval link is incomplete. Open the link from the review email.</p>`, 400);

	await ensureApplicationsTable(env);
	const row = await env.DB.prepare(`SELECT * FROM clinic_applications WHERE id = ?1`).bind(id).first<Application>();
	if (!row) return page("Approval", `<h1>Not <span>found</span></h1><p>No application matches this link.</p>`, 404);
	if (!safeEqual(token, row.token)) return page("Approval", `<h1>Invalid <span>link</span></h1><p>This approval link is not valid.</p>`, 403);

	if (row.status === "approved") {
		return page("Already approved", `<h1>Already <span>approved</span></h1>
			<p><strong>${esc(row.clinic_name)}</strong> was already approved${row.approved_at ? " on " + esc(row.approved_at.slice(0, 10)) : ""}. No new email was sent.</p>`);
	}

	await env.DB.prepare(`UPDATE clinic_applications SET status = 'approved', approved_at = ?1 WHERE id = ?2`)
		.bind(new Date().toISOString(), id)
		.run();

	const mail = await sendEmail(env, row.email, "Welcome to the CelluNOVA team", welcomeEmail(row, adminEmail(env)));
	const mailNote = mail.ok
		? `The welcome email is on its way to <strong>${esc(row.email)}</strong>.`
		: mail.skipped
			? `Email sending is not configured yet (set RESEND_API_KEY), so the welcome email was <strong>not</strong> sent. The approval is recorded.`
			: `The approval is recorded, but sending the welcome email failed. Try the clinic directly at <strong>${esc(row.email)}</strong>.`;

	return page(
		"Clinic approved",
		`<h1>Clinic <span>approved</span></h1>
		<p><strong>${esc(row.clinic_name)}</strong> (${esc(row.contact_name)}) is approved.</p>
		<p>${mailNote}</p>
		<a class="btn" href="/portal/">Back to the portal</a>`,
	);
}
