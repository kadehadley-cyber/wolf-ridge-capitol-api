// CRM leads API for the portal on cellsunova.com.
//
//   GET  /portal/api/leads   the full lead list: every lead uploaded from the
//                            CRM plus every clinic application from the
//                            sign-up form, mapped into the CRM's lead schema
//   POST /portal/api/leads   replace the uploaded lead set ({ leads: [...] });
//                            the CRM calls this automatically on Import
//
// Both sit behind the portal session (checked in index.ts before dispatch).
// Leads are stored in D1 as JSON rows, so the schema can evolve client-side
// without migrations.

import { ensureApplicationsTable } from "./signup";

const MAX_LEADS = 2000;
const MAX_BODY = 4_000_000; // ~4 MB of JSON is far beyond any real lead list

const ensured = new WeakMap<object, Promise<unknown>>();

function ensureLeadsTable(env: Env): Promise<unknown> {
	let p = ensured.get(env.DB);
	if (!p) {
		p = env.DB.prepare(
			`CREATE TABLE IF NOT EXISTS crm_leads (
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

type LeadRecord = Record<string, unknown>;

/** Map a clinic application row into the CRM lead schema. */
function applicationToLead(app: Record<string, unknown>): LeadRecord {
	return {
		name: app.clinic_name,
		owner_name: app.contact_name,
		doctor_name: app.contact_name,
		email: app.email,
		phone: app.phone,
		npi: app.npi ?? "",
		source: "inbound",
		stage: app.status === "approved" ? "sold" : "new",
		is_provider: true,
		created_at: app.created_at,
		engagement: "visited_pricing", // they applied on the site: active interest
	};
}

async function currentLeads(env: Env): Promise<LeadRecord[]> {
	await Promise.all([ensureLeadsTable(env), ensureApplicationsTable(env)]);

	const uploadedRows = await env.DB.prepare(`SELECT data FROM crm_leads`).all<{ data: string }>();
	const uploaded: LeadRecord[] = [];
	for (const row of uploadedRows.results ?? []) {
		try {
			const parsed = JSON.parse(row.data);
			if (parsed && typeof parsed === "object") uploaded.push(parsed as LeadRecord);
		} catch {
			// Skip an unparsable row rather than failing the whole list.
		}
	}

	const appRows = await env.DB.prepare(`SELECT * FROM clinic_applications`).all<Record<string, unknown>>();
	const seenEmails = new Set(
		uploaded.map((l) => String(l.email ?? "").trim().toLowerCase()).filter(Boolean),
	);
	const fromApplications = (appRows.results ?? [])
		.filter((a) => !seenEmails.has(String(a.email ?? "").trim().toLowerCase()))
		.map(applicationToLead);

	// Stable, unique ids for the client, whatever the sources contained.
	return [...uploaded, ...fromApplications].map((l, i) => ({ ...l, id: i + 1 }));
}

export async function handleLeadsApi(request: Request, env: Env): Promise<Response> {
	if (request.method === "GET") {
		return json({ leads: await currentLeads(env) });
	}

	if (request.method === "POST") {
		const raw = await request.text();
		if (raw.length > MAX_BODY) return json({ error: "Lead list too large." }, 413);
		let leads: unknown;
		try {
			const body = JSON.parse(raw);
			leads = Array.isArray(body) ? body : body?.leads;
		} catch {
			return json({ error: "Body must be JSON." }, 400);
		}
		if (!Array.isArray(leads)) return json({ error: "Expected { leads: [...] }." }, 400);
		if (leads.length > MAX_LEADS) return json({ error: `At most ${MAX_LEADS} leads.` }, 413);

		await ensureLeadsTable(env);
		const createdAt = new Date().toISOString();
		const statements = [env.DB.prepare(`DELETE FROM crm_leads`)];
		for (const lead of leads) {
			if (lead === null || typeof lead !== "object") continue;
			statements.push(
				env.DB.prepare(`INSERT INTO crm_leads (id, data, created_at) VALUES (?1, ?2, ?3)`).bind(
					crypto.randomUUID(),
					JSON.stringify(lead),
					createdAt,
				),
			);
		}
		await env.DB.batch(statements);
		return json({ leads: await currentLeads(env) });
	}

	return json({ error: "Method not allowed." }, 405);
}
