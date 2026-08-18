// Rep workspace API for the CelluNOVA portal.
//
//   GET  /portal/api/rep/leads          the signed-in rep's assigned leads
//                                       (admin/manager: every lead, plus the
//                                       rep roster for the assign dropdown)
//   POST /portal/api/rep/note           { id, text }            append a note
//   POST /portal/api/rep/followup       { id, due, kind, note } schedule one
//   POST /portal/api/rep/followup-done  { id, fid, done }       toggle done
//   POST /portal/api/rep/assign         { id, rep }             admin only
//
// Notes and follow-ups live inside the lead's JSON blob (rep_notes[] and
// followups[]), so they survive CRM re-imports that round-trip lead objects.

import { repRoster, type Session } from "./auth";

const KINDS = new Set(["call", "email", "visit", "other"]);
const MAX_NOTE = 2000;
const MAX_FU_NOTE = 500;
const MAX_NOTES = 500;
const MAX_FOLLOWUPS = 200;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
	});
}

type LeadRow = { id: string; data: string };
type Lead = Record<string, unknown> & {
	assigned_rep?: string;
	rep_notes?: Array<{ at: string; by: string; text: string }>;
	followups?: Array<{ fid: string; due: string; kind: string; note: string; done: boolean; created_at: string }>;
};

async function loadLead(env: Env, id: string): Promise<{ row: LeadRow; lead: Lead } | null> {
	if (!id) return null;
	const row = await env.DB.prepare(`SELECT id, data FROM crm_leads WHERE id = ?1`).bind(id).first<LeadRow>();
	if (!row) return null;
	try {
		return { row, lead: JSON.parse(row.data) as Lead };
	} catch {
		return null;
	}
}

async function saveLead(env: Env, id: string, lead: Lead): Promise<void> {
	await env.DB.prepare(`UPDATE crm_leads SET data = ?1 WHERE id = ?2`).bind(JSON.stringify(lead), id).run();
}

/** May this session act on this lead? Reps only touch their own assignments. */
function canTouch(sess: Session, lead: Lead): boolean {
	if (sess.role === "admin") return true;
	return sess.role === "rep" && (lead.assigned_rep ?? "") === sess.user;
}

export async function handleRepLeads(env: Env, sess: Session): Promise<Response> {
	const rows = await env.DB.prepare(`SELECT id, data FROM crm_leads ORDER BY created_at DESC`).all<LeadRow>();
	const leads: Array<Record<string, unknown>> = [];
	for (const row of rows.results ?? []) {
		try {
			const lead = JSON.parse(row.data) as Lead;
			const mine = (lead.assigned_rep ?? "") === sess.user;
			if (sess.role === "rep" && !mine) continue;
			leads.push({ ...lead, id: row.id });
		} catch {
			// Skip unparsable rows.
		}
	}
	return json({
		role: sess.role,
		user: sess.user,
		leads,
		...(sess.role === "admin" || sess.role === "manager" ? { reps: await repRoster(env) } : {}),
	});
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
	try {
		const body = (await request.json()) as Record<string, unknown>;
		return body && typeof body === "object" ? body : null;
	} catch {
		return null;
	}
}

export async function handleRepNote(request: Request, env: Env, sess: Session): Promise<Response> {
	const body = await readBody(request);
	if (!body) return json({ error: "Body must be JSON." }, 400);
	const text = String(body.text ?? "").trim().slice(0, MAX_NOTE);
	if (!text) return json({ error: "The note is empty." }, 400);
	const found = await loadLead(env, String(body.id ?? ""));
	if (!found || !canTouch(sess, found.lead)) return json({ error: "No such assigned lead." }, 404);
	const notes = Array.isArray(found.lead.rep_notes) ? found.lead.rep_notes : [];
	notes.push({ at: new Date().toISOString(), by: sess.user, text });
	found.lead.rep_notes = notes.slice(-MAX_NOTES);
	await saveLead(env, found.row.id, found.lead);
	return json({ ok: true, rep_notes: found.lead.rep_notes });
}

export async function handleRepFollowup(request: Request, env: Env, sess: Session): Promise<Response> {
	const body = await readBody(request);
	if (!body) return json({ error: "Body must be JSON." }, 400);
	const due = String(body.due ?? "");
	if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(due) || Number.isNaN(Date.parse(due))) {
		return json({ error: "Pick a valid date for the follow-up." }, 400);
	}
	const kind = String(body.kind ?? "call");
	if (!KINDS.has(kind)) return json({ error: "Unknown follow-up type." }, 400);
	const note = String(body.note ?? "").trim().slice(0, MAX_FU_NOTE);
	const found = await loadLead(env, String(body.id ?? ""));
	if (!found || !canTouch(sess, found.lead)) return json({ error: "No such assigned lead." }, 404);
	const followups = Array.isArray(found.lead.followups) ? found.lead.followups : [];
	followups.push({ fid: crypto.randomUUID(), due, kind, note, done: false, created_at: new Date().toISOString() });
	followups.sort((a, b) => String(a.due).localeCompare(String(b.due)));
	found.lead.followups = followups.slice(0, MAX_FOLLOWUPS);
	await saveLead(env, found.row.id, found.lead);
	return json({ ok: true, followups: found.lead.followups });
}

export async function handleRepFollowupDone(request: Request, env: Env, sess: Session): Promise<Response> {
	const body = await readBody(request);
	if (!body) return json({ error: "Body must be JSON." }, 400);
	const found = await loadLead(env, String(body.id ?? ""));
	if (!found || !canTouch(sess, found.lead)) return json({ error: "No such assigned lead." }, 404);
	const fid = String(body.fid ?? "");
	const fu = (found.lead.followups ?? []).find((f) => f.fid === fid);
	if (!fu) return json({ error: "No such follow-up." }, 404);
	fu.done = Boolean(body.done);
	await saveLead(env, found.row.id, found.lead);
	return json({ ok: true, followups: found.lead.followups });
}

/** Admin only (enforced by the router): point a lead at a rep, or "" to clear. */
export async function handleRepAssign(request: Request, env: Env): Promise<Response> {
	const body = await readBody(request);
	if (!body) return json({ error: "Body must be JSON." }, 400);
	const rep = String(body.rep ?? "");
	if (rep !== "" && !(await repRoster(env)).includes(rep)) return json({ error: "Unknown rep." }, 400);
	const found = await loadLead(env, String(body.id ?? ""));
	if (!found) return json({ error: "No such lead." }, 404);
	found.lead.assigned_rep = rep;
	await saveLead(env, found.row.id, found.lead);
	return json({ ok: true, id: found.row.id, assigned_rep: rep });
}
