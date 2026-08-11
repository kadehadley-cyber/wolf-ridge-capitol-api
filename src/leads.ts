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

/* ── Lead scan: discover clinics from the NPI Registry ──────────────────
 * NPPES is the U.S. government's public registry of medical providers: free,
 * no API key, searchable by state and taxonomy. The scan pulls organizations
 * for the requested specialties, maps them into the CRM schema, dedupes
 * against everything already stored (NPI, phone, name+city), and appends the
 * new ones to crm_leads. Nothing is ever imported manually. */

// Each CRM category maps to one or more NUCC taxonomy descriptions. The registry
// is searched for every taxonomy in the list, so a category can span the way a
// specialty is actually enumerated (e.g. pain medicine vs. interventional pain).
const SCAN_TAXONOMY: Record<string, string[]> = {
	ortho: ["Orthopaedic Surgery", "Sports Medicine"],
	pain_management: ["Pain Medicine", "Interventional Pain Medicine"],
	plastic_surgery: ["Plastic Surgery"],
	podiatry: ["Podiatrist"],
	med_spa: ["Dermatology"],
	wellness: ["Chiropractor"],
};

interface NppesResult {
	number?: number | string;
	enumeration_type?: string;
	basic?: {
		organization_name?: string;
		first_name?: string;
		last_name?: string;
		credential?: string;
	};
	addresses?: Array<{
		address_purpose?: string;
		address_1?: string;
		city?: string;
		state?: string;
		telephone_number?: string;
	}>;
}

/** Build a display name from a provider record — an organization name, or an
 *  individual physician's name with credential (e.g. "Jane Doe, MD"). */
function nppesName(r: NppesResult): string {
	const org = r.basic?.organization_name?.trim();
	if (org) return org;
	const person = [r.basic?.first_name, r.basic?.last_name]
		.map((s) => (s ?? "").trim())
		.filter(Boolean)
		.join(" ");
	if (!person) return "";
	const cred = (r.basic?.credential ?? "").replace(/[,\s]+$/g, "").trim();
	return cred ? `${person}, ${cred}` : person;
}

function nppesToLead(r: NppesResult, category: string): LeadRecord | null {
	const name = nppesName(r);
	if (!name) return null;
	const isOrg = r.enumeration_type === "NPI-2" || !!r.basic?.organization_name;
	const person = !isOrg
		? [r.basic?.first_name, r.basic?.last_name].map((s) => (s ?? "").trim()).filter(Boolean).join(" ")
		: "";
	const addr =
		r.addresses?.find((a) => a.address_purpose === "LOCATION") ?? r.addresses?.[0] ?? {};
	return {
		name,
		// Individual providers are physicians; surface the name in the doctor field too.
		doctor_name: person,
		owner_name: person,
		phone: addr.telephone_number ?? "",
		address: addr.address_1 ?? "",
		city: addr.city ?? "",
		state: (addr.state ?? "").toUpperCase().slice(0, 2),
		npi: String(r.number ?? ""),
		category,
		source: "intelligence",
		stage: "new",
		is_provider: true,
		created_at: new Date().toISOString(),
	};
}

const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const nameCityKey = (l: LeadRecord) =>
	(String(l.name ?? "").toLowerCase().trim() + "|" + String(l.city ?? "").toLowerCase().trim());

export async function handleLeadScan(request: Request, env: Env): Promise<Response> {
	if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

	let body: { state?: string; categories?: string[]; limit?: number };
	try {
		body = await request.json();
	} catch {
		return json({ error: "Body must be JSON." }, 400);
	}
	const state = String(body.state ?? "").toUpperCase().slice(0, 2);
	if (!/^[A-Z]{2}$/.test(state)) return json({ error: "Pick a state to scan." }, 400);
	const categories = (body.categories ?? []).filter((c) => c in SCAN_TAXONOMY);
	if (!categories.length) return json({ error: "Pick at least one specialty." }, 400);
	const limit = Math.min(Math.max(Number(body.limit) || 40, 1), 100);
	// One registry query per (category, taxonomy) pair; size each to reach the target.
	const taxa = categories.flatMap((c) => SCAN_TAXONOMY[c].map((t) => ({ category: c, taxonomy: t })));
	const perQuery = Math.min(100, Math.max(20, Math.ceil(limit / categories.length)));

	// Existing identities, for dedup.
	const existing = await currentLeads(env);
	const seenNpi = new Set(existing.map((l) => String(l.npi ?? "")).filter(Boolean));
	const seenPhone = new Set(existing.map((l) => digits(l.phone)).filter((d) => d.length >= 7));
	const seenNameCity = new Set(existing.map(nameCityKey));

	const found: LeadRecord[] = [];
	const errors: string[] = [];
	for (const { category, taxonomy } of taxa) {
		// No enumeration_type filter: this returns both individual physicians
		// (NPI-1) and practice organizations (NPI-2). Individuals are the bulk of
		// regenerative-medicine providers, so org-only scans came back nearly empty.
		const params = new URLSearchParams({
			version: "2.1",
			state,
			taxonomy_description: taxonomy,
			limit: String(perQuery),
		});
		try {
			const res = await fetch(`https://npiregistry.cms.hhs.gov/api/?${params}`, {
				headers: { accept: "application/json" },
			});
			if (!res.ok) {
				errors.push(`${taxonomy}: registry returned ${res.status}`);
				continue;
			}
			const data = (await res.json()) as { results?: NppesResult[]; Errors?: Array<{ description?: string }> };
			if (data.Errors?.length) {
				errors.push(`${taxonomy}: ${data.Errors.map((e) => e.description).filter(Boolean).join("; ")}`);
				continue;
			}
			for (const r of data.results ?? []) {
				const lead = nppesToLead(r, category);
				if (!lead) continue;
				const phoneKey = digits(lead.phone);
				if (
					(lead.npi && seenNpi.has(String(lead.npi))) ||
					(phoneKey.length >= 7 && seenPhone.has(phoneKey)) ||
					seenNameCity.has(nameCityKey(lead))
				) {
					continue;
				}
				seenNpi.add(String(lead.npi));
				if (phoneKey.length >= 7) seenPhone.add(phoneKey);
				seenNameCity.add(nameCityKey(lead));
				found.push(lead);
				if (found.length >= limit) break;
			}
		} catch (err) {
			errors.push(`${taxonomy}: ${String(err).slice(0, 120)}`);
		}
		if (found.length >= limit) break;
	}

	if (found.length) {
		await ensureLeadsTable(env);
		const createdAt = new Date().toISOString();
		const statements = found.map((lead) =>
			env.DB.prepare(`INSERT INTO crm_leads (id, data, created_at) VALUES (?1, ?2, ?3)`).bind(
				crypto.randomUUID(),
				JSON.stringify(lead),
				createdAt,
			),
		);
		await env.DB.batch(statements);
	}

	return json({ added: found.length, errors, leads: await currentLeads(env) });
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
