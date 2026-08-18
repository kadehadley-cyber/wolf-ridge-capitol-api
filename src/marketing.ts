// AI market scanner for the Marketing Resources page.
//
//   GET  /portal/api/marketing/reports    stored reports, newest first
//   POST /portal/api/marketing/generate   { city, state, focus? } → runs a
//        real scan: pulls providers for the area from the NPPES NPI registry
//        (live CMS data — the same source as the CRM lead scan), then has the
//        AI analyze the competitive landscape into the report schema the
//        marketing page renders (summary, market_overview, top_competitors,
//        search_terms, adoption_pathways, regulatory_note).
//
// AI backend: Anthropic (ANTHROPIC_API_KEY secret) when configured, otherwise
// the Workers AI binding. Reports persist in the marketing_reports D1 table.

const MAX_PROVIDERS_PER_TAXONOMY = 30;
const MAX_PROVIDERS_TOTAL = 80;
const SCAN_TAXONOMIES = [
	"Chiropractor",
	"Physical Medicine & Rehabilitation",
	"Orthopaedic Surgery",
	"Pain Medicine",
	"Sports Medicine",
	"Naturopath",
];

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
	});
}

const ensured = new WeakMap<object, Promise<unknown>>();
function ensureReportsTable(env: Env): Promise<unknown> {
	let p = ensured.get(env.DB);
	if (!p) {
		p = env.DB.prepare(
			`CREATE TABLE IF NOT EXISTS marketing_reports (
				id TEXT PRIMARY KEY,
				data TEXT NOT NULL,
				created_at TEXT NOT NULL
			)`,
		).run();
		ensured.set(env.DB, p);
	}
	return p;
}

/* ── NPPES: real providers in the area ──────────────────────────────────── */

interface NppesResult {
	enumeration_type?: string;
	basic?: { organization_name?: string; first_name?: string; last_name?: string; credential?: string };
	addresses?: Array<{ address_purpose?: string; address_1?: string; city?: string; state?: string; telephone_number?: string }>;
	taxonomies?: Array<{ desc?: string; primary?: boolean }>;
}

interface AreaProvider {
	name: string;
	kind: "organization" | "individual";
	specialty: string;
	address: string;
	phone: string;
}

async function fetchAreaProviders(city: string, state: string): Promise<AreaProvider[]> {
	const seen = new Set<string>();
	const out: AreaProvider[] = [];
	for (const taxonomy of SCAN_TAXONOMIES) {
		if (out.length >= MAX_PROVIDERS_TOTAL) break;
		const params = new URLSearchParams({
			version: "2.1",
			city,
			state,
			taxonomy_description: taxonomy,
			limit: String(MAX_PROVIDERS_PER_TAXONOMY),
		});
		try {
			const res = await fetch(`https://npiregistry.cms.hhs.gov/api/?${params}`, {
				headers: { accept: "application/json" },
			});
			if (!res.ok) continue;
			const data = (await res.json()) as { results?: NppesResult[] };
			for (const r of data.results ?? []) {
				const basic = r.basic ?? {};
				const name = basic.organization_name
					? basic.organization_name
					: [basic.first_name, basic.last_name].filter(Boolean).join(" ") + (basic.credential ? `, ${basic.credential}` : "");
				if (!name.trim()) continue;
				const loc = (r.addresses ?? []).find((a) => a.address_purpose === "LOCATION") ?? (r.addresses ?? [])[0] ?? {};
				const key = (name + "|" + (loc.telephone_number ?? "")).toLowerCase();
				if (seen.has(key)) continue;
				seen.add(key);
				out.push({
					name: name.trim(),
					kind: basic.organization_name ? "organization" : "individual",
					specialty: (r.taxonomies ?? []).find((t) => t.primary)?.desc ?? taxonomy,
					address: [loc.address_1, loc.city, loc.state].filter(Boolean).join(", "),
					phone: loc.telephone_number ?? "",
				});
				if (out.length >= MAX_PROVIDERS_TOTAL) break;
			}
		} catch {
			// A taxonomy fetch failing shouldn't sink the scan.
		}
	}
	return out;
}

/* ── AI analysis ────────────────────────────────────────────────────────── */

function analysisPrompt(city: string, state: string, focus: string, providers: AreaProvider[]): string {
	return `You are a healthcare market analyst for CelluNOVA Biologics, a physician-led distributor of MSC and exosome biologics that partners with clinics.

Analyze the regenerative-medicine market in ${city}, ${state}.${focus ? ` Focus area: ${focus}.` : ""}

Below is LIVE provider data pulled from the CMS NPI registry for this area (name, type, specialty, address, phone):

${JSON.stringify(providers.slice(0, MAX_PROVIDERS_TOTAL), null, 1)}

Produce a market report as STRICT JSON (no markdown fences, no commentary) with exactly these keys:
{
  "summary": "2-3 sentence executive summary of the local market",
  "market_overview": "one paragraph: saturation, demand signals, positioning opportunity for a physician-led biologics supplier",
  "top_competitors": [up to 8 entries chosen from the provider list above that are the most likely regenerative-medicine competitors or prospects (favor sports medicine, pain, ortho, PM&R, chiropractic groups, and clinic-sounding organization names): {"name": "...", "address": "...", "why": "one line on why they matter", "stem_cell_status": "advertised" | "likely" | "unclear", "similarity": "high" | "medium" | "low"}],
  "search_terms": [8-10 entries: {"term": "realistic local patient search phrase", "why": "one line", "score_0_100": integer local-intent estimate}],
  "adoption_pathways": [4-6 entries: {"angle": "outreach or positioning angle", "why_relevant": "one line tied to this specific market"}],
  "regulatory_note": "one or two sentences on advertising/claims caution for regenerative therapies in ${state}"
}

Ground every claim in the provider list and general market knowledge; never invent clinic names that are not in the list. Use plain professional language.`;
}

function stripFences(text: string): string {
	const m = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
	const body = m ? m[1] : text;
	const start = body.indexOf("{");
	const end = body.lastIndexOf("}");
	return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

async function runAnalysis(env: Env, prompt: string): Promise<Record<string, unknown>> {
	let text = "";
	if (env.ANTHROPIC_API_KEY) {
		const res = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"x-api-key": env.ANTHROPIC_API_KEY,
				"anthropic-version": "2023-06-01",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model: env.JARVIS_MODEL || "claude-sonnet-5",
				max_tokens: 3000,
				messages: [{ role: "user", content: prompt }],
			}),
		});
		if (!res.ok) throw new Error(`anthropic ${res.status}`);
		const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
		text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
	} else if (env.AI) {
		const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
			max_tokens: 3000,
			messages: [{ role: "user", content: prompt }],
		}).catch(() => env.AI!.run("@cf/meta/llama-3.1-8b-instruct", {
			max_tokens: 3000,
			messages: [{ role: "user", content: prompt }],
		}));
		text = typeof result?.response === "string" ? result.response : "";
	} else {
		throw new Error("no-ai");
	}
	return JSON.parse(stripFences(text)) as Record<string, unknown>;
}

/* ── Sanitize the model output into the render schema ───────────────────── */

function str(v: unknown, max: number): string {
	return String(v ?? "").slice(0, max);
}

function sanitizeReport(ai: Record<string, unknown>, providers: AreaProvider[]): Record<string, unknown> {
	const byName = new Map(providers.map((p) => [p.name.toLowerCase(), p]));
	const competitors = (Array.isArray(ai.top_competitors) ? ai.top_competitors : []).slice(0, 8).map((c) => {
		const row = (c ?? {}) as Record<string, unknown>;
		const name = str(row.name, 120);
		const known = byName.get(name.toLowerCase());
		const address = str(row.address, 200) || known?.address || "";
		return {
			name,
			address,
			why: str(row.why, 240),
			stem_cell_status: ["advertised", "likely", "unclear"].includes(String(row.stem_cell_status)) ? String(row.stem_cell_status) : "unclear",
			similarity: ["high", "medium", "low"].includes(String(row.similarity)) ? String(row.similarity) : "medium",
			phone: known?.phone ?? "",
			// URLs are always ours, never the model's: a maps search on the
			// verified name+address renders safely and is genuinely useful.
			maps_url: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(name + " " + address),
		};
	}).filter((c) => c.name);
	return {
		summary: str(ai.summary, 600),
		market_overview: str(ai.market_overview, 2000),
		top_competitors: competitors,
		search_terms: (Array.isArray(ai.search_terms) ? ai.search_terms : []).slice(0, 12).map((t) => {
			const row = (t ?? {}) as Record<string, unknown>;
			return { term: str(row.term, 120), why: str(row.why, 240), score_0_100: Math.max(0, Math.min(100, Number(row.score_0_100) || 0)) };
		}).filter((t) => t.term),
		adoption_pathways: (Array.isArray(ai.adoption_pathways) ? ai.adoption_pathways : []).slice(0, 8).map((a) => {
			const row = (a ?? {}) as Record<string, unknown>;
			return { angle: str(row.angle, 160), why_relevant: str(row.why_relevant, 300) };
		}).filter((a) => a.angle),
		regulatory_note: str(ai.regulatory_note, 600),
	};
}

/* ── Handlers (role gating happens in the router) ───────────────────────── */

export async function handleMarketingReports(env: Env): Promise<Response> {
	await ensureReportsTable(env);
	const rows = await env.DB.prepare(`SELECT data FROM marketing_reports ORDER BY created_at DESC`).all<{ data: string }>();
	const reports: unknown[] = [];
	for (const row of rows.results ?? []) {
		try {
			reports.push(JSON.parse(row.data));
		} catch {
			// Skip unparsable rows.
		}
	}
	return json({ reports });
}

export async function handleMarketingGenerate(request: Request, env: Env): Promise<Response> {
	let body: { city?: string; state?: string; focus?: string };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return json({ error: "Body must be JSON." }, 400);
	}
	const city = String(body.city ?? "").trim().slice(0, 60);
	const state = String(body.state ?? "").trim().toUpperCase().slice(0, 2);
	const focus = String(body.focus ?? "").trim().slice(0, 120);
	if (!/^[A-Za-z .'-]{2,}$/.test(city) || !/^[A-Z]{2}$/.test(state)) {
		return json({ error: "Enter a city and a two-letter state." }, 400);
	}
	if (!env.ANTHROPIC_API_KEY && !env.AI) {
		return json({ error: "AI is not configured on the server." }, 503);
	}

	const providers = await fetchAreaProviders(city, state);
	if (!providers.length) {
		return json({ error: `The NPI registry returned no providers for ${city}, ${state} — check the spelling.` }, 404);
	}

	let analysis: Record<string, unknown>;
	try {
		analysis = await runAnalysis(env, analysisPrompt(city, state, focus, providers));
	} catch (err) {
		console.error("marketing analysis failed:", err);
		return json({ error: "The AI analysis failed — try again in a minute." }, 502);
	}

	const now = new Date().toISOString();
	const report = {
		id: crypto.randomUUID(),
		status: "completed",
		area: { city, state, focus },
		provider_count: providers.length,
		created_at: now,
		completed_at: now,
		...sanitizeReport(analysis, providers),
	};
	await ensureReportsTable(env);
	await env.DB.prepare(`INSERT INTO marketing_reports (id, data, created_at) VALUES (?1, ?2, ?3)`)
		.bind(report.id, JSON.stringify(report), now)
		.run();
	return json({ report });
}
