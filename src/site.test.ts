// Routing tests for the public CelluNOVA site (cellsunova.com), which is
// served from the ASSETS binding by serveCelluNova in index.ts.
import { describe, expect, it } from "vitest";
import worker from "./index";

const ctx = {} as ExecutionContext;

/** Minimal in-memory D1 stand-in covering the SQL the signup + leads flows use. */
function makeDb() {
	const apps = new Map<string, Record<string, unknown>>();
	const leads = new Map<string, { data: string }>();
	const exec = (sql: string, args: unknown[]) => ({
		run: async () => {
			const s = sql.trimStart();
			if (s.startsWith("INSERT INTO clinic_applications")) {
				apps.set(String(args[0]), {
					id: args[0], clinic_name: args[1], contact_name: args[2], email: args[3],
					phone: args[4], npi: args[5], status: args[6], token: args[7],
					created_at: args[8], approved_at: null,
				});
			} else if (s.startsWith("UPDATE clinic_applications")) {
				const row = apps.get(String(args[1]));
				if (row) { row.status = "approved"; row.approved_at = args[0]; }
			} else if (s.startsWith("INSERT INTO crm_leads")) {
				leads.set(String(args[0]), { data: String(args[1]) });
			} else if (s.startsWith("DELETE FROM crm_leads")) {
				leads.clear();
			}
			return {};
		},
		first: async () => apps.get(String(args[0])) ?? null,
		all: async () => ({
			results: sql.includes("FROM crm_leads") ? [...leads.values()] : [...apps.values()],
		}),
	});
	return {
		rows: apps,
		leads,
		prepare(sql: string) {
			return { bind: (...args: unknown[]) => exec(sql, args), ...exec(sql, []) };
		},
		batch: async (stmts: Array<{ run: () => Promise<unknown> }>) => {
			for (const s of stmts) await s.run();
			return [];
		},
	};
}

function makeEnv() {
	const calls: string[] = [];
	const db = makeDb();
	const env = {
		ASSETS: {
			fetch: async (req: Request) => {
				const path = new URL(req.url).pathname;
				calls.push(path);
				return new Response("asset:" + path);
			},
		},
		DB: db,
	} as unknown as Env;
	return { env, calls, db };
}

async function hit(path: string, host = "www.cellsunova.com", method = "GET", cookie?: string) {
	const { env, calls } = makeEnv();
	const headers = cookie ? { cookie } : undefined;
	const res = await worker.fetch!(
		new Request(`https://${host}${path}`, { method, headers }) as never,
		env,
		ctx,
	);
	return { res, calls };
}

async function login(username = "DrHadley", password = "Ghoster2024!") {
	const { env } = makeEnv();
	const body = new FormData();
	body.set("username", username);
	body.set("password", password);
	const res = await worker.fetch!(
		new Request("https://www.cellsunova.com/login", { method: "POST", body }) as never,
		env,
		ctx,
	);
	return { res, cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] };
}

describe("cellsunova.com site routing", () => {
	it("serves the homepage from clinic-portal/site/", async () => {
		const { res, calls } = await hit("/");
		expect(res.status).toBe(200);
		expect(calls).toEqual(["/clinic-portal/site/"]);
	});

	it("maps homepage-relative assets", async () => {
		expect((await hit("/site.css")).calls).toEqual(["/clinic-portal/site/site.css"]);
		expect((await hit("/site.js")).calls).toEqual(["/clinic-portal/site/site.js"]);
	});

	it("requires sign-in for the portal", async () => {
		const { res, calls } = await hit("/portal/crm/");
		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toBe(
			"https://www.cellsunova.com/login?next=%2Fportal%2Fcrm%2F",
		);
		expect(calls).toEqual([]);
	});

	it("serves the login page and rejects bad credentials", async () => {
		const page = await hit("/login");
		expect(page.res.status).toBe(200);
		expect(await page.res.text()).toContain("Sign in");
		const bad = await login("DrHadley", "wrong-password");
		expect(bad.res.status).toBe(401);
		expect(bad.cookie).toBe("");
	});

	it("signs in with the admin credentials and sets a session cookie", async () => {
		const { res, cookie } = await login();
		expect(res.status).toBe(303);
		expect(res.headers.get("location")).toBe("/portal/");
		expect(cookie.startsWith("cn_admin=")).toBe(true);
		expect(res.headers.get("set-cookie")).toContain("HttpOnly");
	});

	it("signs in with the second admin account", async () => {
		const { res, cookie } = await login("Admin", "NOVAto200M");
		expect(res.status).toBe(303);
		expect(cookie.startsWith("cn_admin=")).toBe(true);
		// And a bad password for that account is still rejected.
		const bad = await login("Admin", "wrong-password");
		expect(bad.res.status).toBe(401);
	});

	it("serves the protocols page at /portal/ when signed in", async () => {
		const { cookie } = await login();
		const { calls } = await hit("/portal/", "www.cellsunova.com", "GET", cookie);
		expect(calls).toEqual(["/clinic-portal/"]);
	});

	it("maps portal subpages and their assets when signed in", async () => {
		const { cookie } = await login();
		expect((await hit("/portal/crm/", "www.cellsunova.com", "GET", cookie)).calls).toEqual(["/clinic-portal/crm/"]);
		expect((await hit("/portal/crm/crm.js", "www.cellsunova.com", "GET", cookie)).calls).toEqual(["/clinic-portal/crm/crm.js"]);
		expect((await hit("/portal/styles/portal.css", "www.cellsunova.com", "GET", cookie)).calls).toEqual(["/clinic-portal/styles/portal.css"]);
		// Hosted protocol-library pages serve as static assets behind the portal auth.
		expect((await hit("/portal/protocols/library/knee.html", "www.cellsunova.com", "GET", cookie)).calls)
			.toEqual(["/clinic-portal/protocols/library/knee.html"]);
	});

	it("rejects a forged session cookie", async () => {
		const forged = "cn_admin=" + (Date.now() + 3600000) + ".deadbeef";
		const { res, calls } = await hit("/portal/", "www.cellsunova.com", "GET", forged);
		expect(res.status).toBe(302);
		expect(calls).toEqual([]);
	});

	it("logs out and clears the cookie", async () => {
		const { res } = await hit("/logout");
		expect(res.status).toBe(303);
		expect(res.headers.get("set-cookie")).toContain("cn_admin=;");
	});

	it("adds trailing slashes to page directories", async () => {
		const { cookie } = await login();
		const { res } = await hit("/portal/crm", "www.cellsunova.com", "GET", cookie);
		expect(res.status).toBe(301);
		expect(res.headers.get("location")).toBe("https://www.cellsunova.com/portal/crm/");
	});

	it("redirects legacy paths", async () => {
		const { cookie } = await login();
		expect((await hit("/portal/protocols", "www.cellsunova.com", "GET", cookie)).res.headers.get("location"))
			.toBe("https://www.cellsunova.com/portal/");
		expect((await hit("/portal/support", "www.cellsunova.com", "GET", cookie)).res.headers.get("location"))
			.toBe("https://www.cellsunova.com/portal/tickets/");
	});

	it("redirects the apex to www", async () => {
		const { res } = await hit("/portal/crm/", "cellsunova.com");
		expect(res.status).toBe(301);
		expect(res.headers.get("location")).toBe("https://www.cellsunova.com/portal/crm/");
	});

	it("never serves internal docs", async () => {
		expect((await hit("/portal/SECURITY-REVIEW.md")).res.status).toBe(404);
		expect((await hit("/portal/SCRAPE-PLAN.md")).res.status).toBe(404);
		expect((await hit("/portal/hardening/portal.js")).res.status).toBe(404);
	});

	it("rejects non-GET methods", async () => {
		expect((await hit("/portal/crm/", "www.cellsunova.com", "POST")).res.status).toBe(405);
	});

	it("accepts a clinic application and stores it pending", async () => {
		const { env, db } = makeEnv();
		const body = new FormData();
		body.set("clinic_name", "Test Clinic");
		body.set("contact_name", "Dr. Test");
		body.set("email", "owner@testclinic.test");
		body.set("phone", "+1 555 000 1234");
		body.set("npi", "1234567890");
		const res = await worker.fetch!(
			new Request("https://www.cellsunova.com/signup", { method: "POST", body }) as never,
			env,
			ctx,
		);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain("Application");
		const row = [...db.rows.values()][0];
		expect(row.clinic_name).toBe("Test Clinic");
		expect(row.status).toBe("pending");
	});

	it("rejects an application without a valid email", async () => {
		const { env, db } = makeEnv();
		const body = new FormData();
		body.set("clinic_name", "Test Clinic");
		body.set("contact_name", "Dr. Test");
		body.set("email", "not-an-email");
		body.set("phone", "+1 555 000 1234");
		const res = await worker.fetch!(
			new Request("https://www.cellsunova.com/signup", { method: "POST", body }) as never,
			env,
			ctx,
		);
		expect(res.status).toBe(400);
		expect(db.rows.size).toBe(0);
	});

	it("approves an application through the token link (session required)", async () => {
		const { env, db } = makeEnv();
		const body = new FormData();
		body.set("clinic_name", "Approve Me Clinic");
		body.set("contact_name", "Dr. A");
		body.set("email", "a@clinic.test");
		body.set("phone", "+1 555 1");
		await worker.fetch!(
			new Request("https://www.cellsunova.com/signup", { method: "POST", body }) as never,
			env,
			ctx,
		);
		const row = [...db.rows.values()][0];
		const path = `/portal/approve?id=${row.id}&token=${row.token}`;

		// Signed out: bounced to login with the full query preserved.
		const anon = await worker.fetch!(
			new Request(`https://www.cellsunova.com${path}`) as never,
			env,
			ctx,
		);
		expect(anon.status).toBe(302);
		expect(anon.headers.get("location")).toContain("/login?next=");

		// Signed in with a valid token: approved.
		const { cookie } = await login();
		const ok = await worker.fetch!(
			new Request(`https://www.cellsunova.com${path}`, { headers: { cookie } }) as never,
			env,
			ctx,
		);
		expect(ok.status).toBe(200);
		expect(await ok.text()).toContain("approved");
		expect(row.status).toBe("approved");

		// Wrong token: rejected.
		const bad = await worker.fetch!(
			new Request(`https://www.cellsunova.com/portal/approve?id=${row.id}&token=deadbeef`, {
				headers: { cookie },
			}) as never,
			env,
			ctx,
		);
		expect(bad.status).toBe(403);
	});

	it("requires a session for the leads API and returns JSON, not a redirect", async () => {
		const { env } = makeEnv();
		const res = await worker.fetch!(
			new Request("https://www.cellsunova.com/portal/api/leads") as never,
			env,
			ctx,
		);
		expect(res.status).toBe(401);
		expect(res.headers.get("content-type")).toContain("application/json");
	});

	it("serves clinic applications as CRM leads automatically", async () => {
		const { env } = makeEnv();
		const body = new FormData();
		body.set("clinic_name", "Inbound Clinic");
		body.set("contact_name", "Dr. Lead");
		body.set("email", "lead@inbound.test");
		body.set("phone", "+1 555 2");
		await worker.fetch!(
			new Request("https://www.cellsunova.com/signup", { method: "POST", body }) as never,
			env,
			ctx,
		);
		const { cookie } = await login();
		const res = await worker.fetch!(
			new Request("https://www.cellsunova.com/portal/api/leads", { headers: { cookie } }) as never,
			env,
			ctx,
		);
		const data = (await res.json()) as { leads: Array<Record<string, unknown>> };
		expect(data.leads).toHaveLength(1);
		expect(data.leads[0].name).toBe("Inbound Clinic");
		expect(data.leads[0].source).toBe("inbound");
		expect(data.leads[0].stage).toBe("new");
	});

	it("stores uploaded leads and merges them with applications, deduping by email", async () => {
		const { env } = makeEnv();
		const form = new FormData();
		form.set("clinic_name", "Dupe Clinic");
		form.set("contact_name", "Dr. D");
		form.set("email", "dupe@clinic.test");
		form.set("phone", "+1 555 3");
		await worker.fetch!(
			new Request("https://www.cellsunova.com/signup", { method: "POST", body: form }) as never,
			env,
			ctx,
		);
		const { cookie } = await login();
		const upload = await worker.fetch!(
			new Request("https://www.cellsunova.com/portal/api/leads", {
				method: "POST",
				headers: { cookie, "content-type": "application/json" },
				body: JSON.stringify({
					leads: [
						{ name: "Uploaded One", email: "one@x.test" },
						{ name: "Dupe Clinic Uploaded", email: "dupe@clinic.test" },
					],
				}),
			}) as never,
			env,
			ctx,
		);
		expect(upload.status).toBe(200);
		const data = (await upload.json()) as { leads: Array<Record<string, unknown>> };
		// Two uploaded + zero from applications (the application email is deduped).
		expect(data.leads).toHaveLength(2);
		expect(data.leads.map((l) => l.id)).toEqual([1, 2]);

		// A later GET returns the same merged list.
		const again = await worker.fetch!(
			new Request("https://www.cellsunova.com/portal/api/leads", { headers: { cookie } }) as never,
			env,
			ctx,
		);
		const againData = (await again.json()) as { leads: Array<Record<string, unknown>> };
		expect(againData.leads).toHaveLength(2);
	});

	it("scans the NPI registry, appends new clinics, and dedupes on rescan", async () => {
		const { env, db } = makeEnv();
		const { cookie } = await login();

		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const u = String(input);
			if (u.startsWith("https://npiregistry.cms.hhs.gov/")) {
				return new Response(
					JSON.stringify({
						results: [
							{
								number: 1111111111,
								basic: { organization_name: "Registry Ortho Group" },
								addresses: [
									{ address_purpose: "LOCATION", address_1: "1 Main St", city: "Boise", state: "ID", telephone_number: "208-555-0100" },
								],
							},
							{
								number: 2222222222,
								basic: { organization_name: "Registry Pain Clinic" },
								addresses: [
									{ address_purpose: "LOCATION", address_1: "2 Oak Ave", city: "Nampa", state: "ID", telephone_number: "208-555-0200" },
								],
							},
						],
					}),
					{ headers: { "content-type": "application/json" } },
				);
			}
			return realFetch(input as never);
		}) as typeof fetch;

		try {
			const scan = await worker.fetch!(
				new Request("https://www.cellsunova.com/portal/api/leads/scan", {
					method: "POST",
					headers: { cookie, "content-type": "application/json" },
					body: JSON.stringify({ state: "ID", categories: ["ortho"], limit: 50 }),
				}) as never,
				env,
				ctx,
			);
			expect(scan.status).toBe(200);
			const data = (await scan.json()) as { added: number; leads: Array<Record<string, unknown>> };
			expect(data.added).toBe(2);
			expect(data.leads.map((l) => l.name)).toEqual(["Registry Ortho Group", "Registry Pain Clinic"]);
			expect(data.leads[0].source).toBe("intelligence");
			expect(db.leads.size).toBe(2);

			// Rescan with identical registry data: everything dedupes, nothing added.
			const again = await worker.fetch!(
				new Request("https://www.cellsunova.com/portal/api/leads/scan", {
					method: "POST",
					headers: { cookie, "content-type": "application/json" },
					body: JSON.stringify({ state: "ID", categories: ["ortho"], limit: 50 }),
				}) as never,
				env,
				ctx,
			);
			const againData = (await again.json()) as { added: number };
			expect(againData.added).toBe(0);
			expect(db.leads.size).toBe(2);
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	it("maps individual providers (NPI-1) with their credential", async () => {
		const { env, db } = makeEnv();
		const { cookie } = await login();

		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const u = String(input);
			if (u.startsWith("https://npiregistry.cms.hhs.gov/")) {
				// A scan with no enumeration_type filter returns individuals too.
				expect(u).not.toContain("enumeration_type");
				return new Response(
					JSON.stringify({
						results: [
							{
								number: 3333333333,
								enumeration_type: "NPI-1",
								basic: { first_name: "Jane", last_name: "Smith", credential: "M.D." },
								addresses: [
									{ address_purpose: "LOCATION", address_1: "9 Elm St", city: "Boise", state: "ID", telephone_number: "208-555-0300" },
								],
							},
						],
					}),
					{ headers: { "content-type": "application/json" } },
				);
			}
			return realFetch(input as never);
		}) as typeof fetch;

		try {
			const scan = await worker.fetch!(
				new Request("https://www.cellsunova.com/portal/api/leads/scan", {
					method: "POST",
					headers: { cookie, "content-type": "application/json" },
					body: JSON.stringify({ state: "ID", categories: ["podiatry"], limit: 25 }),
				}) as never,
				env,
				ctx,
			);
			expect(scan.status).toBe(200);
			const data = (await scan.json()) as { added: number; leads: Array<Record<string, unknown>> };
			expect(data.added).toBe(1);
			expect(data.leads[0].name).toBe("Jane Smith, M.D.");
			expect(data.leads[0].doctor_name).toBe("Jane Smith");
			expect(db.leads.size).toBe(1);
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	it("scans nationwide when state is ALL (no state filter)", async () => {
		const { env, db } = makeEnv();
		const { cookie } = await login();

		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const u = String(input);
			if (u.startsWith("https://npiregistry.cms.hhs.gov/")) {
				// All-states scan must not constrain by state.
				expect(u).not.toContain("state=");
				return new Response(
					JSON.stringify({
						results: [
							{
								number: 4444444444,
								enumeration_type: "NPI-2",
								basic: { organization_name: "Nationwide Ortho" },
								addresses: [
									{ address_purpose: "LOCATION", address_1: "5 Center St", city: "Reno", state: "NV", telephone_number: "775-555-0400" },
								],
							},
						],
					}),
					{ headers: { "content-type": "application/json" } },
				);
			}
			return realFetch(input as never);
		}) as typeof fetch;

		try {
			const scan = await worker.fetch!(
				new Request("https://www.cellsunova.com/portal/api/leads/scan", {
					method: "POST",
					headers: { cookie, "content-type": "application/json" },
					body: JSON.stringify({ state: "ALL", categories: ["ortho"], limit: 25 }),
				}) as never,
				env,
				ctx,
			);
			expect(scan.status).toBe(200);
			const data = (await scan.json()) as { added: number };
			expect(data.added).toBe(1);
			expect(db.leads.size).toBe(1);
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	it("returns the best-scored clinics first and drops weaker matches when capped", async () => {
		const { env } = makeEnv();
		const { cookie } = await login();

		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const u = String(input);
			if (u.startsWith("https://npiregistry.cms.hhs.gov/")) {
				return new Response(
					JSON.stringify({
						results: [
							{
								// Weakest: individual, not primary, no phone, no sub-specialty.
								number: 5555555550,
								enumeration_type: "NPI-1",
								basic: { first_name: "Low", last_name: "Fit", credential: "MD" },
								taxonomies: [{ desc: "Orthopaedic Surgery", primary: false }],
								addresses: [{ address_purpose: "LOCATION", address_1: "1 Rd", city: "Boise", state: "ID" }],
							},
							{
								// Strongest: organization, primary specialty, sports-medicine sub-specialty, phone.
								number: 5555555551,
								enumeration_type: "NPI-2",
								basic: { organization_name: "Elite Ortho & Sports" },
								taxonomies: [
									{ desc: "Orthopaedic Surgery", primary: true },
									{ desc: "Sports Medicine", primary: false },
								],
								addresses: [{ address_purpose: "LOCATION", address_1: "2 Rd", city: "Nampa", state: "ID", telephone_number: "208-555-0500" }],
							},
							{
								// Middle: individual, primary specialty, phone, no sub-specialty.
								number: 5555555552,
								enumeration_type: "NPI-1",
								basic: { first_name: "Mid", last_name: "Fit", credential: "DO" },
								taxonomies: [{ desc: "Orthopaedic Surgery", primary: true }],
								addresses: [{ address_purpose: "LOCATION", address_1: "3 Rd", city: "Meridian", state: "ID", telephone_number: "208-555-0600" }],
							},
						],
					}),
					{ headers: { "content-type": "application/json" } },
				);
			}
			return realFetch(input as never);
		}) as typeof fetch;

		try {
			const scan = await worker.fetch!(
				new Request("https://www.cellsunova.com/portal/api/leads/scan", {
					method: "POST",
					headers: { cookie, "content-type": "application/json" },
					body: JSON.stringify({ state: "ID", categories: ["ortho"], limit: 2 }),
				}) as never,
				env,
				ctx,
			);
			expect(scan.status).toBe(200);
			const data = (await scan.json()) as { added: number; leads: Array<Record<string, unknown>> };
			expect(data.added).toBe(2); // capped at 2 of the 3 candidates
			const names = data.leads.map((l) => l.name);
			expect(names[0]).toBe("Elite Ortho & Sports"); // highest registry fit ranks first
			expect(data.leads[0].regen_specialty).toBe(true); // sports-medicine taxonomy flags regen
			expect(names).not.toContain("Low Fit, MD"); // weakest match dropped
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	it("pages past the first 200 results to widen the candidate pool", async () => {
		const { env } = makeEnv();
		const { cookie } = await login();

		let sawSkip = false;
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const u = String(input);
			if (u.startsWith("https://npiregistry.cms.hhs.gov/")) {
				if (u.includes("skip=200")) {
					sawSkip = true;
					return new Response(JSON.stringify({ results: [] }), { headers: { "content-type": "application/json" } });
				}
				// A full page of 200 must trigger a second page request.
				const results = Array.from({ length: 200 }, (_, i) => ({
					number: 900000000 + i,
					enumeration_type: "NPI-2",
					basic: { organization_name: "Podiatry Group " + i },
					taxonomies: [{ desc: "Podiatrist", primary: true }],
					addresses: [{ address_purpose: "LOCATION", city: "Boise", state: "ID", telephone_number: "2085" + String(100000 + i) }],
				}));
				return new Response(JSON.stringify({ results }), { headers: { "content-type": "application/json" } });
			}
			return realFetch(input as never);
		}) as typeof fetch;

		try {
			const scan = await worker.fetch!(
				new Request("https://www.cellsunova.com/portal/api/leads/scan", {
					method: "POST",
					headers: { cookie, "content-type": "application/json" },
					body: JSON.stringify({ state: "ID", categories: ["podiatry"], limit: 50 }),
				}) as never,
				env,
				ctx,
			);
			expect(scan.status).toBe(200);
			const data = (await scan.json()) as { added: number };
			expect(sawSkip).toBe(true); // paged past the first 200
			expect(data.added).toBe(50); // capped at the requested limit
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	it("rejects a scan without any specialties", async () => {
		const { env } = makeEnv();
		const { cookie } = await login();
		const res = await worker.fetch!(
			new Request("https://www.cellsunova.com/portal/api/leads/scan", {
				method: "POST",
				headers: { cookie, "content-type": "application/json" },
				body: JSON.stringify({ state: "AZ", categories: [] }),
			}) as never,
			env,
			ctx,
		);
		expect(res.status).toBe(400);
	});

	it("leaves other hosts on the Jarvis routes", async () => {
		const { res, calls } = await hit("/portal/crm/", "example.workers.dev");
		expect(calls).toEqual([]);           // assets never touched
		expect(res.status).toBe(404);        // Jarvis switch: unknown path
	});
});
