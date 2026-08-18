// Public "Become a Rep" application (homepage → /become-a-rep → POST /rep-apply).
//
// Every application is stored in D1 first, so nothing is lost even when email
// sending is unavailable; the notification (with the CV attached when one was
// uploaded) goes to ADMIN_NOTIFY_EMAIL. The CV itself is never stored — it
// only travels in the email.

import { adminEmail, esc, sendEmail, type EmailAttachment } from "./email";
import { page } from "./signup";

const MAX_CV_BYTES = 5 * 1024 * 1024;
const CV_EXTENSIONS = /\.(pdf|doc|docx)$/i;

const ensured = new WeakMap<object, Promise<unknown>>();
export function ensureRepApplicationsTable(env: Env): Promise<unknown> {
	let p = ensured.get(env.DB);
	if (!p) {
		p = env.DB.prepare(
			`CREATE TABLE IF NOT EXISTS rep_applications (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				dob TEXT NOT NULL,
				state TEXT NOT NULL,
				email TEXT,
				phone TEXT,
				referred_by TEXT,
				cv_filename TEXT,
				status TEXT NOT NULL DEFAULT 'pending',
				created_at TEXT NOT NULL
			)`,
		)
			.run()
			// Older deployments created the table without contact columns.
			.then(async (r) => {
				for (const col of ["email", "phone"]) {
					await env.DB.prepare(`ALTER TABLE rep_applications ADD COLUMN ${col} TEXT`).run().catch(() => {});
				}
				return r;
			});
		ensured.set(env.DB, p);
	}
	return p;
}

export interface RepApplicationRow {
	id: string;
	name: string;
	dob: string;
	state: string;
	email: string | null;
	phone: string | null;
	referred_by: string | null;
	cv_filename: string | null;
	status: string;
	created_at: string;
}

/** Pending applications, newest first — for the admin's Accounts page. */
export async function listPendingRepApplications(env: Env): Promise<RepApplicationRow[]> {
	await ensureRepApplicationsTable(env);
	const rows = await env.DB.prepare(
		`SELECT id, name, dob, state, email, phone, referred_by, cv_filename, status, created_at
		 FROM rep_applications ORDER BY created_at DESC`,
	).all<RepApplicationRow>();
	return (rows.results ?? []).filter((r) => (r.status ?? "pending") === "pending");
}

export async function setRepApplicationStatus(env: Env, id: string, status: "approved" | "dismissed"): Promise<void> {
	await ensureRepApplicationsTable(env);
	await env.DB.prepare(`UPDATE rep_applications SET status = ?1 WHERE id = ?2`).bind(status, id).run();
}

function field(form: FormData, name: string, max: number): string {
	return String(form.get(name) ?? "").trim().slice(0, max);
}

export async function handleRepApply(request: Request, env: Env): Promise<Response> {
	const form = await request.formData();

	// Honeypot: bots that fill the invisible field get a quiet "success".
	if (String(form.get("website") ?? "") !== "") {
		return page("Application received", `<h1>Application <span>received</span></h1>
			<p>Thanks! Our team reviews every application.</p>`);
	}

	const name = field(form, "name", 200);
	const dob = field(form, "dob", 10);
	const state = field(form, "state", 2).toUpperCase();
	const email = field(form, "email", 320);
	const phone = field(form, "phone", 40);
	const referredBy = field(form, "referred_by", 200);

	const dobOk = /^\d{4}-\d{2}-\d{2}$/.test(dob) && !Number.isNaN(Date.parse(dob));
	const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
	if (!name || !dobOk || !/^[A-Z]{2}$/.test(state) || !emailOk || !phone) {
		return page(
			"Check your application",
			`<h1>Almost <span>there</span></h1>
			<p>Your full name, date of birth, state, a valid email, and a phone number are required.</p>
			<a class="btn" href="/become-a-rep">Back to the form</a>`,
			400,
		);
	}

	// Optional CV: validated, base64-encoded, and forwarded as an email
	// attachment only — never stored.
	let cvName = "";
	const attachments: EmailAttachment[] = [];
	const cv = form.get("cv");
	if (cv instanceof File && cv.size > 0) {
		if (cv.size > MAX_CV_BYTES) {
			return page(
				"Check your application",
				`<h1>Almost <span>there</span></h1>
				<p>The CV file is over 5&nbsp;MB — please attach a smaller file.</p>
				<a class="btn" href="/become-a-rep">Back to the form</a>`,
				400,
			);
		}
		if (!CV_EXTENSIONS.test(cv.name)) {
			return page(
				"Check your application",
				`<h1>Almost <span>there</span></h1>
				<p>Please attach the CV as a PDF or Word document.</p>
				<a class="btn" href="/become-a-rep">Back to the form</a>`,
				400,
			);
		}
		cvName = cv.name.slice(0, 200);
		const bytes = new Uint8Array(await cv.arrayBuffer());
		let binary = "";
		const CHUNK = 0x8000;
		for (let i = 0; i < bytes.length; i += CHUNK) {
			binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
		}
		attachments.push({ filename: cvName, content: btoa(binary) });
	}

	await ensureRepApplicationsTable(env);
	const id = crypto.randomUUID();
	const createdAt = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO rep_applications (id, name, dob, state, email, phone, referred_by, cv_filename, status, created_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9)`,
	)
		.bind(id, name, dob, state, email, phone, referredBy || null, cvName || null, createdAt)
		.run();

	const rows = [
		["Name", name],
		["Email", email],
		["Phone", phone],
		["Date of birth", dob],
		["State", state],
		["Referred by", referredBy || "—"],
		["CV", cvName ? `${cvName} (attached)` : "not provided"],
	]
		.map(
			([k, v]) => `<tr>
	<td style="padding:5px 12px 5px 0;font-size:13px;color:#2e7d74;font-weight:bold;white-space:nowrap;">${esc(k)}</td>
	<td style="padding:5px 0;font-size:14px;color:#16403b;">${esc(v)}</td>
</tr>`,
		)
		.join("");
	await sendEmail(
		env,
		adminEmail(env),
		`New rep application: ${name}`,
		`<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f6faf9;">
<div style="background:#ffffff;border:1px solid #e3ecea;border-radius:10px;padding:24px;">
<h1 style="margin:0 0 6px;font-size:21px;color:#16403b;">New rep application</h1>
<p style="margin:0 0 14px;font-size:14px;color:#4a5f58;">Received ${esc(createdAt)}. When you approve them,
create their login in the portal's <strong>Accounts</strong> page and send credentials separately.</p>
<table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>
</div></div>`,
		attachments,
	);

	return page(
		"Application received",
		`<h1>Application <span>received</span></h1>
		<p>Thanks, <strong>${esc(name)}</strong>. Our team reviews every rep application and
		   follows up personally.</p>
		<a class="btn" href="/">Back to cellunovabiologics.com</a>`,
	);
}
