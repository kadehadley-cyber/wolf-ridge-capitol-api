// CRM leads API for the portal on cellunovabiologics.com.
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

	const uploadedRows = await env.DB.prepare(`SELECT id, data FROM crm_leads`).all<{ id: string; data: string }>();
	const uploaded: LeadRecord[] = [];
	for (const row of uploadedRows.results ?? []) {
		try {
			const parsed = JSON.parse(row.data);
			// The row id rides along so the CRM can address this lead in the
			// rep-assignment API.
			if (parsed && typeof parsed === "object") uploaded.push({ ...(parsed as LeadRecord), id: row.id });
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
 * no API key, searchable by state and taxonomy. The scan pages through the
 * registry for the requested specialties (individuals and organizations),
 * scores every candidate on registry-fit signals, keeps one best entry per
 * practice, dedupes against everything already stored (NPI, phone, name+city),
 * and appends the top-ranked new clinics. Nothing is ever imported manually. */

// Each CRM category maps to one or more NUCC taxonomy descriptions. The registry
// is searched for every taxonomy in the list, so a category can span the way a
// specialty is actually enumerated (e.g. pain medicine vs. interventional pain).
const SCAN_TAXONOMY: Record<string, string[]> = {
	ortho: ["Orthopaedic Surgery", "Sports Medicine"],
	pain_management: ["Pain Medicine", "Interventional Pain Medicine", "Physical Medicine & Rehabilitation"],
	plastic_surgery: ["Plastic Surgery"],
	podiatry: ["Podiatrist"],
	med_spa: ["Dermatology"],
	wellness: ["Chiropractor"],
};

// How strong a fit each category is for stem cells / exosomes (0-10). Mirrors
// the client's SPECIALTY_FIT so the server can rank candidates before returning.
const SPECIALTY_FIT: Record<string, number> = {
	ortho: 10,
	pain_management: 10,
	wellness: 8,
	med_spa: 7,
	plastic_surgery: 6,
	podiatry: 6,
};

// Sub-specialties that strongly indicate an active regenerative-medicine practice.
// A provider listing any of these is a stronger buyer regardless of their category.
const HIGH_VALUE_SUBSPECIALTIES = new Set([
	"sports medicine",
	"interventional pain medicine",
	"physical medicine & rehabilitation",
	"regenerative medicine",
	"rheumatology",
	"pain medicine",
]);

interface NppesTaxonomy {
	desc?: string;
	primary?: boolean;
}

interface NppesResult {
	number?: number | string;
	enumeration_type?: string;
	basic?: {
		organization_name?: string;
		first_name?: string;
		last_name?: string;
		credential?: string;
		sole_proprietor?: string;
	};
	taxonomies?: NppesTaxonomy[];
	addresses?: Array<{
		address_purpose?: string;
		address_1?: string;
		city?: string;
		state?: string;
		telephone_number?: string;
	}>;
}

/* Rank a registry record on the fit signals NPPES actually gives us, so a scan
 * returns the best-matched clinics instead of the first ones the registry lists:
 *   - specialty fit of the requested category (ortho/pain rank highest)
 *   - the target specialty being the provider's PRIMARY enumerated taxonomy
 *   - any high-value regenerative sub-specialty in their taxonomy list
 *   - organization (multi-provider volume) over a solo individual
 *   - a reachable phone number
 * Returns a 0-100 score. */
function scanScore(r: NppesResult, category: string): number {
	let s = 30;
	s += (SPECIALTY_FIT[category] ?? 5) * 2; // up to +20

	const taxa = r.taxonomies ?? [];
	const wanted = (SCAN_TAXONOMY[category] ?? []).map((d) => d.toLowerCase());
	const matched = taxa.find((t) => wanted.includes((t.desc ?? "").toLowerCase()));
	if (matched?.primary) s += 12; // the target specialty is their main focus
	if (taxa.some((t) => HIGH_VALUE_SUBSPECIALTIES.has((t.desc ?? "").toLowerCase()))) s += 12;

	if (r.enumeration_type === "NPI-2") s += 6; // organization: more providers, more volume
	const addr = r.addresses?.find((a) => a.address_purpose === "LOCATION") ?? r.addresses?.[0];
	if (digits(addr?.telephone_number).length >= 10) s += 5; // reachable

	return Math.max(0, Math.min(100, Math.round(s)));
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
		// A solo individual who is the sole proprietor is the physician-owner —
		// the decision maker, so a faster close. Real NPPES field, not inferred.
		decision_maker_is_owner: !isOrg && r.basic?.sole_proprietor === "YES",
		// The registry can't confirm PRP/exosomes/stem cells, but a regenerative
		// sub-specialty (sports medicine, interventional pain, PM&R, etc.) is a
		// strong signal the practice is already doing regenerative work.
		regen_specialty: (r.taxonomies ?? []).some((t) => HIGH_VALUE_SUBSPECIALTIES.has((t.desc ?? "").toLowerCase())),
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
	const stateRaw = String(body.state ?? "").toUpperCase().trim();
	const allStates = stateRaw === "" || stateRaw === "ALL" || stateRaw === "*";
	const state = allStates ? "" : stateRaw.slice(0, 2);
	if (!allStates && !/^[A-Z]{2}$/.test(state)) {
		return json({ error: "Pick a state to scan, or choose All states." }, 400);
	}
	const categories = (body.categories ?? []).filter((c) => c in SCAN_TAXONOMY);
	if (!categories.length) return json({ error: "Pick at least one specialty." }, 400);
	const limit = Math.min(Math.max(Number(body.limit) || 40, 1), 200);
	const taxa = categories.flatMap((c) => SCAN_TAXONOMY[c].map((t) => ({ category: c, taxonomy: t })));
	// Page through the registry to build a large candidate pool to rank from,
	// bounded so the whole scan stays well under the Worker subrequest budget.
	const PAGE_SIZE = 200; // NPPES max results per request
	const pageCap = Math.min(4, Math.max(1, Math.floor(24 / taxa.length)));

	// Existing identities, so a scan never re-adds a lead already in the CRM.
	const existing = await currentLeads(env);
	const existNpi = new Set(existing.map((l) => String(l.npi ?? "")).filter(Boolean));
	const existPhone = new Set(existing.map((l) => digits(l.phone)).filter((d) => d.length >= 7));
	const existNameCity = new Set(existing.map(nameCityKey));

	const pool: Array<{ lead: LeadRecord; score: number }> = [];
	const errors: string[] = [];
	for (const { category, taxonomy } of taxa) {
		for (let page = 0; page < pageCap; page++) {
			// No enumeration_type filter: this returns both individual physicians
			// (NPI-1) and practice organizations (NPI-2). Individuals are the bulk
			// of regenerative-medicine providers, so org-only scans were near-empty.
			const params = new URLSearchParams({
				version: "2.1",
				taxonomy_description: taxonomy,
				limit: String(PAGE_SIZE),
			});
			if (!allStates) params.set("state", state); // all-states omits the filter
			if (page > 0) params.set("skip", String(page * PAGE_SIZE));

			let results: NppesResult[];
			try {
				const res = await fetch(`https://npiregistry.cms.hhs.gov/api/?${params}`, {
					headers: { accept: "application/json" },
				});
				if (!res.ok) { errors.push(`${taxonomy}: registry returned ${res.status}`); break; }
				const data = (await res.json()) as { results?: NppesResult[]; Errors?: Array<{ description?: string }> };
				if (data.Errors?.length) {
					errors.push(`${taxonomy}: ${data.Errors.map((e) => e.description).filter(Boolean).join("; ")}`);
					break;
				}
				results = data.results ?? [];
			} catch (err) {
				errors.push(`${taxonomy}: ${String(err).slice(0, 120)}`);
				break;
			}

			for (const r of results) {
				const lead = nppesToLead(r, category);
				if (!lead) continue;
				// Actionable only: needs a phone to call or at least a location.
				if (digits(lead.phone).length < 7 && !lead.address) continue;
				// Skip anything already stored in the CRM.
				const phoneKey = digits(lead.phone);
				if (
					(lead.npi && existNpi.has(String(lead.npi))) ||
					(phoneKey.length >= 7 && existPhone.has(phoneKey)) ||
					existNameCity.has(nameCityKey(lead))
				) {
					continue;
				}
				const score = scanScore(r, category);
				lead.scan_score = score;
				lead.score = score;
				pool.push({ lead, score });
			}
			if (results.length < PAGE_SIZE) break; // reached the last page for this taxonomy
		}
	}

	// Rank by registry fit, then collapse to one best entry per practice (same
	// phone, or same name+city) and per NPI so a clinic's many listed providers
	// don't flood the list. Sorting first means the highest score wins each key.
	pool.sort((a, b) => b.score - a.score);
	const chosenByPractice = new Map<string, LeadRecord>();
	const chosenNpi = new Set<string>();
	for (const { lead } of pool) {
		const npi = String(lead.npi ?? "");
		if (npi && chosenNpi.has(npi)) continue;
		const practiceKey = digits(lead.phone).length >= 7 ? digits(lead.phone) : nameCityKey(lead);
		if (chosenByPractice.has(practiceKey)) continue;
		chosenByPractice.set(practiceKey, lead);
		if (npi) chosenNpi.add(npi);
		if (chosenByPractice.size >= limit) break;
	}
	const found = [...chosenByPractice.values()];

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
		// Rows keep the id they were served with, so rep assignments, notes,
		// and follow-ups stay addressable across full-set re-uploads.
		const seen = new Set<string>();
		for (const lead of leads) {
			if (lead === null || typeof lead !== "object") continue;
			const embedded = (lead as { id?: unknown }).id;
			let id = typeof embedded === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(embedded) ? embedded : crypto.randomUUID();
			if (seen.has(id)) id = crypto.randomUUID();
			seen.add(id);
			statements.push(
				env.DB.prepare(`INSERT INTO crm_leads (id, data, created_at) VALUES (?1, ?2, ?3)`).bind(
					id,
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
