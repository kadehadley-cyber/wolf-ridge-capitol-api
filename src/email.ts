// Outbound email for the CelluNOVA site, sent through Resend.
//
// Configuration (Worker secrets / vars):
//   RESEND_API_KEY      required for real sending; without it sends are skipped
//                       (applications are still stored in D1, nothing is lost)
//   MAIL_FROM           verified sender, e.g. "CelluNOVA <no-reply@cellsunova.com>"
//   ADMIN_NOTIFY_EMAIL  where clinic applications go (defaults below)

export const DEFAULT_ADMIN_EMAIL = "DrHadley@cellunova.bio";

export interface SendResult {
	ok: boolean;
	skipped?: boolean;
	error?: string;
}

export function adminEmail(env: Env): string {
	return env.ADMIN_NOTIFY_EMAIL || DEFAULT_ADMIN_EMAIL;
}

export async function sendEmail(env: Env, to: string, subject: string, html: string): Promise<SendResult> {
	if (!env.RESEND_API_KEY) {
		console.warn(`email skipped (RESEND_API_KEY not set): to=${to} subject=${subject}`);
		return { ok: false, skipped: true };
	}
	try {
		const res = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				authorization: `Bearer ${env.RESEND_API_KEY}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				from: env.MAIL_FROM || "CelluNOVA <no-reply@cellsunova.com>",
				to: [to],
				subject,
				html,
			}),
		});
		if (!res.ok) {
			const detail = (await res.text()).slice(0, 300);
			console.error(`resend error ${res.status}: ${detail}`);
			return { ok: false, error: `resend ${res.status}` };
		}
		return { ok: true };
	} catch (err) {
		console.error("resend fetch failed:", err);
		return { ok: false, error: String(err) };
	}
}

/** Escape user text for safe embedding in HTML (emails and pages). */
export function esc(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
