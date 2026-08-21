// Routing tests for the public CelluNOVA site (cellunovabiologics.com), which
// is served from the ASSETS binding by serveCelluNova in index.ts. The
// previous domain (cellsunova.com) permanently redirects here.
import { describe, expect, it } from "vitest";
import worker from "./index";

const ctx = {} as ExecutionContext;

/** Minimal in-memory D1 stand-in covering the SQL the signup + leads flows use. */
function makeDb() {
	const apps = new Map<string, Record<string, unknown>>();
	const leads = new Map<string, { id?: string; data: string }>();
	const orders = new Map<string, { data: string }>();
	const accounts = new Map<string, Record<string, unknown>>();
	const reports = new Map<string, { data: string }>();
	const repApps = new Map<string, Record<string, unknown>>();
	const callBookings = new Map<string, Record<string, unknown>>();
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
				leads.set(String(args[0]), { id: String(args[0]), data: String(args[1]) });
			} else if (s.startsWith("UPDATE crm_leads")) {
				const row = leads.get(String(args[1]));
				if (row) row.data = String(args[0]);
			} else if (s.startsWith("DELETE FROM crm_leads")) {
				leads.clear();
			} else if (s.startsWith("INSERT OR REPLACE INTO orders")) {
				orders.set(String(args[0]), { data: String(args[1]) });
			} else if (s.startsWith("INSERT INTO portal_accounts")) {
				accounts.set(String(args[0]), {
					user: args[0], hash: args[1], role: args[2], disabled: 0, created_at: args[3],
				});
			} else if (s.startsWith("UPDATE portal_accounts SET hash")) {
				const row = accounts.get(String(args[1]));
				if (row) row.hash = args[0];
			} else if (s.startsWith("UPDATE portal_accounts SET disabled")) {
				const row = accounts.get(String(args[1]));
				if (row) row.disabled = args[0];
			} else if (s.startsWith("UPDATE portal_accounts SET manager")) {
				const row = accounts.get(String(args[1]));
				if (row) row.manager = args[0];
			} else if (s.startsWith("DELETE FROM portal_accounts")) {
				accounts.delete(String(args[0]));
			} else if (s.startsWith("INSERT INTO marketing_reports")) {
				reports.set(String(args[0]), { data: String(args[1]) });
			} else if (s.startsWith("INSERT INTO rep_applications")) {
				repApps.set(String(args[0]), {
					id: args[0], name: args[1], dob: args[2], state: args[3], email: args[4],
					phone: args[5], referred_by: args[6], cv_filename: args[7], status: "pending", created_at: args[8],
				});
			} else if (s.startsWith("UPDATE rep_applications")) {
				const row = repApps.get(String(args[1]));
				if (row) row.status = args[0];
			} else if (s.startsWith("INSERT INTO call_bookings")) {
				callBookings.set(String(args[0]), {
					id: args[0], date: args[1], hour: args[2], name: args[3], clinic: args[4],
					email: args[5], phone: args[6], notes: args[7], created_at: args[8],
				});
			}
			return {};
		},
		first: async () =>
			sql.includes("FROM crm_leads")
				? (leads.get(String(args[0])) ?? null)
				: sql.includes("FROM orders")
					? (orders.get(String(args[0])) ?? null)
					: (apps.get(String(args[0])) ?? null),
		all: async () => ({
			results: sql.includes("FROM crm_leads")
				? [...leads.values()]
				: sql.includes("FROM orders")
					? [...orders.values()]
					: sql.includes("FROM portal_accounts")
						? [...accounts.values()]
						: sql.includes("FROM marketing_reports")
							? [...reports.values()]
							: sql.includes("FROM rep_applications")
								? [...repApps.values()]
								: sql.includes("FROM call_bookings")
									? [...callBookings.values()]
									: [...apps.values()],
		}),
	});
	return {
		rows: apps,
		leads,
		orders,
		accounts,
		reports,
		repApps,
		callBookings,
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

async function hit(path: string, host = "www.cellunovabiologics.com", method = "GET", cookie?: string) {
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
		new Request("https://www.cellunovabiologics.com/login", { method: "POST", body }) as never,
		env,
		ctx,
	);
	return { res, cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] };
}

describe("cellunovabiologics.com site routing", () => {
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
			"https://www.cellunovabiologics.com/login?next=%2Fportal%2Fcrm%2F",
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

	it("signs in the manager account: full CRM, no ordering or approvals", async () => {
		const { res, cookie } = await login("Admin", "NOVAto200M");
		expect(res.status).toBe(303);
		expect(cookie).toContain(".manager.");
		// Sees every page, including admin areas…
		expect((await hit("/portal/crm/", "www.cellunovabiologics.com", "GET", cookie)).calls).toEqual([
			"/clinic-portal/crm/",
		]);
		expect((await hit("/portal/marketing/", "www.cellunovabiologics.com", "GET", cookie)).calls).toEqual([
			"/clinic-portal/marketing/",
		]);
		// …and uses the CRM fully: reads and imports both work.
		const read = await hit("/portal/api/leads", "www.cellunovabiologics.com", "GET", cookie);
		expect(read.res.status).not.toBe(403);
		expect(read.res.status).not.toBe(401);
		const { env } = makeEnv();
		const importLeads = await worker.fetch!(
			new Request("https://www.cellunovabiologics.com/portal/api/leads", {
				method: "POST",
				headers: { cookie, "content-type": "application/json" },
				body: JSON.stringify({ leads: [{ name: "Manager Imported Clinic" }] }),
			}) as never,
			env,
			ctx,
		);
		expect(importLeads.status).toBe(200);
		// Ordering, payment recording, and approvals stay off-limits:
		const checkout = await hit("/portal/api/checkout", "www.cellunovabiologics.com", "POST", cookie);
		expect(checkout.res.status).toBe(403);
		const confirm = await hit("/portal/api/checkout/confirm?session_id=cs_x", "www.cellunovabiologics.com", "GET", cookie);
		expect(confirm.res.status).toBe(403);
		const approve = await hit("/portal/approve?id=x&token=y", "www.cellunovabiologics.com", "GET", cookie);
		expect(approve.res.status).toBe(302);
		expect(approve.res.headers.get("location")).toBe("https://www.cellunovabiologics.com/portal/");
	});

	it("signs in a clinic account and blocks it from admin areas", async () => {
		const { res, cookie } = await login("UnitedChiro", "UC-m42f5xyDaCiFkm");
		expect(res.status).toBe(303);
		expect(cookie.startsWith("cn_admin=")).toBe(true);
		expect(cookie).toContain(".clinic.");
		// Clinic pages work…
		expect((await hit("/portal/", "www.cellunovabiologics.com", "GET", cookie)).calls).toEqual(["/clinic-portal/"]);
		expect((await hit("/portal/templates/", "www.cellunovabiologics.com", "GET", cookie)).calls).toEqual([
			"/clinic-portal/templates/",
		]);
		expect((await hit("/portal/orders/", "www.cellunovabiologics.com", "GET", cookie)).calls).toEqual([
			"/clinic-portal/orders/",
		]);
		// …admin areas redirect away without touching assets…
		for (const blocked of [
			"/portal/crm/",
			"/portal/marketing/",
			"/portal/admin/",
			"/portal/approve",
			"/portal/tickets/",
			"/portal/support",
			"/portal/treatment-schedule/",
			"/portal/welcome/",
		]) {
			const { res: r, calls } = await hit(blocked, "www.cellunovabiologics.com", "GET", cookie);
			expect(r.status).toBe(302);
			expect(r.headers.get("location")).toBe("https://www.cellunovabiologics.com/portal/");
			expect(calls).toEqual([]);
		}
		// …and the CRM API refuses with 403.
		const api = await hit("/portal/api/leads", "www.cellunovabiologics.com", "GET", cookie);
		expect(api.res.status).toBe(403);
	});

	it("keeps the CRM open to admin sessions", async () => {
		const { cookie } = await login();
		expect(cookie).toContain(".admin.");
		const { res } = await hit("/portal/api/leads", "www.cellunovabiologics.com", "GET", cookie);
		expect(res.status).not.toBe(403);
		expect(res.status).not.toBe(401);
	});

	it("gives reps their assigned leads only, with notes and follow-ups", async () => {
		const { env, db } = makeEnv();
		db.leads.set("lead-1", { id: "lead-1", data: JSON.stringify({ name: "Katy Spine Clinic", assigned_rep: "Rep1" }) });
		db.leads.set("lead-2", { id: "lead-2", data: JSON.stringify({ name: "Other Clinic", assigned_rep: "" }) });
		const call = async (path: string, cookie: string, method = "GET", body?: unknown) =>
			worker.fetch!(
				new Request("https://www.cellunovabiologics.com" + path, {
					method,
					headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
					...(body ? { body: JSON.stringify(body) } : {}),
				}) as never,
				env,
				ctx,
			);
		const rep = (await login("Rep1", "Rep-sA5xnHPHNMckBR")).cookie;
		expect(rep).toContain(".rep.");
		// Sees only the assigned lead.
		const mine = (await (await call("/portal/api/rep/leads", rep)).json()) as { leads: Array<{ id: string }> };
		expect(mine.leads).toHaveLength(1);
		expect(mine.leads[0].id).toBe("lead-1");
		// Can note and schedule on it…
		const note = await call("/portal/api/rep/note", rep, "POST", { id: "lead-1", text: "Spoke with front desk" });
		expect(note.status).toBe(200);
		const fu = await call("/portal/api/rep/followup", rep, "POST", { id: "lead-1", due: "2027-01-15", kind: "call", note: "Demo" });
		expect(fu.status).toBe(200);
		const saved = JSON.parse(db.leads.get("lead-1")!.data);
		expect(saved.rep_notes[0].text).toBe("Spoke with front desk");
		expect(saved.followups[0].kind).toBe("call");
		// …but not on an unassigned lead.
		expect((await call("/portal/api/rep/note", rep, "POST", { id: "lead-2", text: "nope" })).status).toBe(404);
		// Admin can assign; a rep cannot.
		const admin = (await login()).cookie;
		expect((await call("/portal/api/rep/assign", admin, "POST", { id: "lead-2", rep: "Rep1" })).status).toBe(200);
		expect(JSON.parse(db.leads.get("lead-2")!.data).assigned_rep).toBe("Rep1");
		expect((await call("/portal/api/rep/assign", rep, "POST", { id: "lead-2", rep: "" })).status).toBe(403);
		// The built-in manager runs no reps, so Rep1's leads are off-limits to
		// it now — only the admin (or Rep1's own manager) touches them.
		const manager = (await login("Admin", "NOVAto200M")).cookie;
		expect((await call("/portal/api/rep/assign", manager, "POST", { id: "lead-2", rep: "" })).status).toBe(403);
		expect((await call("/portal/api/rep/note", manager, "POST", { id: "lead-1", text: "manager note" })).status).toBe(404);
		// Managers still work unassigned leads — notes included.
		db.leads.set("lead-4", { id: "lead-4", data: JSON.stringify({ name: "Fresh Clinic", assigned_rep: "" }) });
		expect((await call("/portal/api/rep/note", manager, "POST", { id: "lead-4", text: "manager note" })).status).toBe(200);
		expect(JSON.parse(db.leads.get("lead-4")!.data).rep_notes.some(
			(n: { by: string; text: string }) => n.by === "Admin" && n.text === "manager note",
		)).toBe(true);
		// A device-local list has no row id — the server matches by NPI instead.
		db.leads.set("lead-3", { id: "lead-3", data: JSON.stringify({ name: "NPI Clinic", npi: "1234567890", phone: "555-111-2222" }) });
		expect(
			(await call("/portal/api/rep/assign", admin, "POST", { id: 7, npi: "1234567890", name: "NPI Clinic", phone: "555-111-2222", rep: "Rep1" })).status,
		).toBe(200);
		expect(JSON.parse(db.leads.get("lead-3")!.data).assigned_rep).toBe("Rep1");
	});

	it("scopes each manager to the reps assigned to them", async () => {
		const { env, db } = makeEnv();
		db.leads.set("lead-a", { id: "lead-a", data: JSON.stringify({ name: "Team Clinic", assigned_rep: "" }) });
		const call = async (path: string, cookie: string, method = "GET", body?: unknown) =>
			worker.fetch!(
				new Request("https://www.cellunovabiologics.com" + path, {
					method,
					headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
					...(body ? { body: JSON.stringify(body) } : {}),
				}) as never,
				env,
				ctx,
			);
		const loginEnv = async (username: string, password: string) => {
			const form = new FormData();
			form.set("username", username);
			form.set("password", password);
			const res = await worker.fetch!(
				new Request("https://www.cellunovabiologics.com/login", { method: "POST", body: form }) as never,
				env,
				ctx,
			);
			return (res.headers.get("set-cookie") ?? "").split(";")[0];
		};
		const admin = (await login()).cookie;
		const acct = async (body: unknown) =>
			(await (await call("/portal/api/accounts", admin, "POST", body)).json()) as Record<string, string>;

		// Two managers and one rep, with the rep pointed at KCollins.
		const kcPw = (await acct({ action: "create", user: "KCollins", role: "manager" })).password;
		const jgPw = (await acct({ action: "create", user: "JGomez", role: "manager" })).password;
		const ctPw = (await acct({ action: "create", user: "CTaylor", role: "rep" })).password;
		expect((await call("/portal/api/accounts", admin, "POST", { action: "set-manager", user: "CTaylor", manager: "KCollins" })).status).toBe(200);
		// Only reps report to a manager, and the manager must exist.
		expect((await call("/portal/api/accounts", admin, "POST", { action: "set-manager", user: "JGomez", manager: "KCollins" })).status).toBe(400);
		expect((await call("/portal/api/accounts", admin, "POST", { action: "set-manager", user: "CTaylor", manager: "Nobody" })).status).toBe(400);
		const list = (await (await call("/portal/api/accounts", admin)).json()) as { accounts: Array<{ user: string; manager?: string }> };
		expect(list.accounts.find((a) => a.user === "CTaylor")?.manager).toBe("KCollins");

		// Each manager's roster is their own reps — nothing more.
		const kc = await loginEnv("KCollins", kcPw);
		const jg = await loginEnv("JGomez", jgPw);
		const kcLeads = (await (await call("/portal/api/rep/leads", kc)).json()) as { reps: string[]; leads: unknown[] };
		const jgLeads = (await (await call("/portal/api/rep/leads", jg)).json()) as { reps: string[]; leads: unknown[] };
		expect(kcLeads.reps).toEqual(["CTaylor"]);
		expect(jgLeads.reps).toEqual([]);

		// KCollins assigns to their rep; JGomez can neither assign to CTaylor
		// nor touch a lead that belongs to KCollins's team.
		expect((await call("/portal/api/rep/assign", kc, "POST", { id: "lead-a", rep: "CTaylor" })).status).toBe(200);
		expect(JSON.parse(db.leads.get("lead-a")!.data).assigned_rep).toBe("CTaylor");
		expect((await call("/portal/api/rep/assign", jg, "POST", { id: "lead-a", rep: "CTaylor" })).status).toBe(400);
		expect((await call("/portal/api/rep/assign", jg, "POST", { id: "lead-a", rep: "" })).status).toBe(403);
		expect((await call("/portal/api/rep/note", jg, "POST", { id: "lead-a", text: "not my team" })).status).toBe(404);
		expect((await call("/portal/api/rep/note", kc, "POST", { id: "lead-a", text: "my team" })).status).toBe(200);

		// The team pipeline shows on the manager's rep page; the other
		// manager's stays empty. The rep signs in and sees the lead too.
		expect(((await (await call("/portal/api/rep/leads", kc)).json()) as { leads: unknown[] }).leads).toHaveLength(1);
		expect(((await (await call("/portal/api/rep/leads", jg)).json()) as { leads: unknown[] }).leads).toHaveLength(0);
		const ct = await loginEnv("CTaylor", ctPw);
		expect(((await (await call("/portal/api/rep/leads", ct)).json()) as { leads: unknown[] }).leads).toHaveLength(1);

		// The admin can preview a specific manager; unknown names refuse.
		expect((await call("/portal/api/preview", admin, "POST", { role: "manager", user: "KCollins" })).status).toBe(200);
		expect((await call("/portal/api/preview", admin, "POST", { role: "manager", user: "Nobody" })).status).toBe(400);
	});

	it("keeps reps inside their workspace pages", async () => {
		const { cookie } = await login("Rep1", "Rep-sA5xnHPHNMckBR");
		// Allowed: the workspace, marketing, and the clinic-facing material
		// (protocols and templates — reps sell with what clinics get).
		expect((await hit("/portal/rep/", "www.cellunovabiologics.com", "GET", cookie)).calls).toEqual([
			"/clinic-portal/rep/",
		]);
		expect((await hit("/portal/marketing/", "www.cellunovabiologics.com", "GET", cookie)).calls).toEqual([
			"/clinic-portal/marketing/",
		]);
		expect((await hit("/portal/templates/", "www.cellunovabiologics.com", "GET", cookie)).calls).toEqual([
			"/clinic-portal/templates/",
		]);
		expect(
			(await hit("/portal/protocols/library/shoulder-im.pdf", "www.cellunovabiologics.com", "GET", cookie)).calls,
		).toEqual(["/clinic-portal/protocols/library/shoulder-im.pdf"]);
		expect(
			(await hit("/portal/templates/rebrand/new-service-flyer.pdf", "www.cellunovabiologics.com", "GET", cookie)).calls,
		).toEqual(["/clinic-portal/templates/rebrand/new-service-flyer.pdf"]);
		// Everything else bounces to the workspace.
		for (const blocked of ["/portal/", "/portal/crm/", "/portal/pricing/", "/portal/orders/", "/portal/accounts/"]) {
			const { res, calls } = await hit(blocked, "www.cellunovabiologics.com", "GET", cookie);
			expect(res.status).toBe(302);
			expect(res.headers.get("location")).toBe("https://www.cellunovabiologics.com/portal/rep/");
			expect(calls).toEqual([]);
		}
	});

	it("account manager: admin-only, full create/reset/disable lifecycle", async () => {
		const { env, db } = makeEnv();
		const call = async (cookie: string, method = "GET", body?: unknown) =>
			worker.fetch!(
				new Request("https://www.cellunovabiologics.com/portal/api/accounts", {
					method,
					headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
					...(body ? { body: JSON.stringify(body) } : {}),
				}) as never,
				env,
				ctx,
			);
		const loginEnv = async (username: string, password: string) => {
			const form = new FormData();
			form.set("username", username);
			form.set("password", password);
			const res = await worker.fetch!(
				new Request("https://www.cellunovabiologics.com/login", { method: "POST", body: form }) as never,
				env,
				ctx,
			);
			return { res, cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] };
		};

		// Only the admin gets in — the manager is 403, and the page redirects it.
		const admin = (await login()).cookie;
		const manager = (await login("Admin", "NOVAto200M")).cookie;
		expect((await call(manager)).status).toBe(403);
		const mgrPage = await hit("/portal/accounts/", "www.cellunovabiologics.com", "GET", manager);
		expect(mgrPage.res.status).toBe(302);
		expect(mgrPage.res.headers.get("location")).toBe("https://www.cellunovabiologics.com/portal/");
		expect(mgrPage.calls).toEqual([]);

		// Listing shows the built-ins.
		const list = (await (await call(admin)).json()) as { accounts: Array<{ user: string; builtin: boolean }> };
		expect(list.accounts.some((a) => a.user === "DrHadley" && a.builtin)).toBe(true);

		// Create a rep account; the returned password signs in with role rep.
		const created = (await (
			await call(admin, "POST", { action: "create", user: "JSmith", role: "rep" })
		).json()) as { password: string };
		expect(created.password).toMatch(/^Rep-/);
		expect(db.accounts.has("JSmith")).toBe(true);
		const repLogin = await loginEnv("JSmith", created.password);
		expect(repLogin.res.status).toBe(303);
		expect(repLogin.cookie).toContain(".rep.");

		// Duplicate and built-in names refuse; admin role can't be created.
		expect((await call(admin, "POST", { action: "create", user: "JSmith", role: "rep" })).status).toBe(409);
		expect((await call(admin, "POST", { action: "create", user: "DrHadley", role: "rep" })).status).toBe(409);
		expect((await call(admin, "POST", { action: "create", user: "Sneaky", role: "admin" })).status).toBe(400);

		// Reset invalidates the old password.
		const reset = (await (await call(admin, "POST", { action: "reset", user: "JSmith" })).json()) as { password: string };
		expect((await loginEnv("JSmith", created.password)).res.status).toBe(401);
		expect((await loginEnv("JSmith", reset.password)).res.status).toBe(303);

		// Disable blocks sign-in; enable restores it; delete removes the row.
		await call(admin, "POST", { action: "disable", user: "JSmith" });
		expect((await loginEnv("JSmith", reset.password)).res.status).toBe(401);
		await call(admin, "POST", { action: "enable", user: "JSmith" });
		expect((await loginEnv("JSmith", reset.password)).res.status).toBe(303);
		await call(admin, "POST", { action: "delete", user: "JSmith" });
		expect(db.accounts.has("JSmith")).toBe(false);
	});

	it("accepts rep applications, validates them, and serves the public page", async () => {
		const { env, db, calls } = makeEnv();
		const apply = async (fields: Record<string, string>) => {
			const form = new FormData();
			for (const [k, v] of Object.entries(fields)) form.set(k, v);
			return worker.fetch!(
				new Request("https://www.cellunovabiologics.com/rep-apply", { method: "POST", body: form }) as never,
				env,
				ctx,
			);
		};
		// The public page serves without a session.
		await worker.fetch!(
			new Request("https://www.cellunovabiologics.com/become-a-rep") as never,
			env,
			ctx,
		);
		expect(calls).toContain("/clinic-portal/site/become-a-rep");
		// A valid application stores.
		const ok = await apply({
			name: "Jamie Rivera", dob: "1992-04-11", state: "TX",
			email: "jamie@example.com", phone: "555-201-3344", referred_by: "Dr. Sheppard",
		});
		expect(ok.status).toBe(200);
		expect(await ok.text()).toContain("received");
		expect(db.repApps.size).toBe(1);
		const row = [...db.repApps.values()][0];
		expect(row.state).toBe("TX");
		expect(row.email).toBe("jamie@example.com");
		expect(row.phone).toBe("555-201-3344");
		expect(row.referred_by).toBe("Dr. Sheppard");
		// Missing/invalid fields refuse; the honeypot pretends success but stores nothing.
		expect((await apply({ name: "X", dob: "not-a-date", state: "TX", email: "x@y.z", phone: "1" })).status).toBe(400);
		expect((await apply({ name: "NoMail", dob: "1990-01-01", state: "TX", phone: "555" })).status).toBe(400);
		expect((await apply({ name: "Bot", dob: "1990-01-01", state: "TX", email: "b@c.d", phone: "5", website: "spam" })).status).toBe(200);
		expect(db.repApps.size).toBe(1);
	});

	it("keeps lead row ids stable across CRM re-uploads", async () => {
		const { env, db } = makeEnv();
		const admin = (await login()).cookie;
		const uuid = "3f9a1b20-1111-4222-8333-abcdefabcdef";
		const res = await worker.fetch!(
			new Request("https://www.cellunovabiologics.com/portal/api/leads", {
				method: "POST",
				headers: { cookie: admin, "content-type": "application/json" },
				body: JSON.stringify({ leads: [{ id: uuid, name: "Stable Clinic", assigned_rep: "Rep1" }, { id: 7, name: "Numeric Id Import" }] }),
			}) as never,
			env,
			ctx,
		);
		expect(res.status).toBe(200);
		// The UUID-bearing lead keeps its row id; the numeric one gets a fresh UUID.
		expect(db.leads.has(uuid)).toBe(true);
		expect(JSON.parse(db.leads.get(uuid)!.data).assigned_rep).toBe("Rep1");
		expect(db.leads.size).toBe(2);
	});

	it("books 1-hour MD calls into open weekday slots", async () => {
		const { env, db } = makeEnv();
		// The next weekday within the window.
		let d = new Date(Date.now() + 86400000);
		while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(d.getTime() + 86400000);
		const date = d.toISOString().slice(0, 10);
		const call = async (path: string, method = "GET", body?: unknown, cookie?: string) =>
			worker.fetch!(
				new Request("https://www.cellunovabiologics.com" + path, {
					method,
					headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
					...(body ? { body: JSON.stringify(body) } : {}),
				}) as never,
				env,
				ctx,
			);
		// Slots list: 8 one-hour slots, all open.
		const slots = (await (await call(`/api/call-slots?date=${date}`)).json()) as { slots: Array<{ hour: number; taken: boolean }> };
		expect(slots.slots).toHaveLength(8);
		expect(slots.slots.every((s) => !s.taken)).toBe(true);
		// Book one; it stores and the slot flips to taken.
		const book = await call("/api/call-book", "POST", {
			date, hour: 10, name: "Dr. Field", clinic: "Field Chiro", email: "field@example.com", phone: "555-4", notes: "Product fit",
		});
		expect(book.status).toBe(200);
		expect(db.callBookings.size).toBe(1);
		const after = (await (await call(`/api/call-slots?date=${date}`)).json()) as { slots: Array<{ hour: number; taken: boolean }> };
		expect(after.slots.find((s) => s.hour === 10)?.taken).toBe(true);
		// Double-booking refuses; bad dates refuse; honeypot stores nothing.
		expect((await call("/api/call-book", "POST", { date, hour: 10, name: "X", email: "x@y.z" })).status).toBe(409);
		expect((await call("/api/call-book", "POST", { date: "2020-01-01", hour: 9, name: "X", email: "x@y.z" })).status).toBe(400);
		await call("/api/call-book", "POST", { date, hour: 11, name: "Bot", email: "b@c.d", website: "spam" });
		expect(db.callBookings.size).toBe(1);
		// The bookings list is for the admin (and manager), not reps or the public.
		expect((await call("/portal/api/call-bookings")).status).toBe(401);
		const rep = (await login("Rep1", "Rep-sA5xnHPHNMckBR")).cookie;
		expect((await call("/portal/api/call-bookings", "GET", undefined, rep)).status).toBe(403);
		const admin = (await login()).cookie;
		const list = (await (await call("/portal/api/call-bookings", "GET", undefined, admin)).json()) as { bookings: Array<{ name: string; label: string }> };
		expect(list.bookings).toHaveLength(1);
		expect(list.bookings[0].name).toBe("Dr. Field");
		expect(list.bookings[0].label).toBe("10:00 AM MT");
	});

	it("admin approves rep applications and previews other roles", async () => {
		const { env, db } = makeEnv();
		// A rep application arrives.
		const form = new FormData();
		form.set("name", "Casey Nguyen");
		form.set("dob", "1990-06-02");
		form.set("state", "TX");
		form.set("email", "casey@example.com");
		form.set("phone", "555-880-1200");
		await worker.fetch!(
			new Request("https://www.cellunovabiologics.com/rep-apply", { method: "POST", body: form }) as never,
			env,
			ctx,
		);
		const appId = [...db.repApps.keys()][0];
		const call = async (path: string, cookie: string, method = "GET", body?: unknown) =>
			worker.fetch!(
				new Request("https://www.cellunovabiologics.com" + path, {
					method,
					headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
					...(body ? { body: JSON.stringify(body) } : {}),
				}) as never,
				env,
				ctx,
			);
		const admin = (await login()).cookie;
		// The application shows in the accounts listing…
		const list = (await (await call("/portal/api/accounts", admin)).json()) as { applications: Array<{ id: string; name: string }> };
		expect(list.applications).toHaveLength(1);
		expect(list.applications[0].name).toBe("Casey Nguyen");
		// …and approving it creates a working rep login and clears the queue.
		const approved = (await (
			await call("/portal/api/accounts", admin, "POST", { action: "app-approve", app_id: appId, user: "CNguyen" })
		).json()) as { password: string; role: string };
		expect(approved.role).toBe("rep");
		expect(db.repApps.get(appId)?.status).toBe("approved");
		const after = (await (await call("/portal/api/accounts", admin)).json()) as { applications: unknown[] };
		expect(after.applications).toHaveLength(0);

		// View-as: only the admin may start a preview, and while previewing as
		// manager the admin-only API refuses — proof the preview restricts.
		const rep = (await login("Rep1", "Rep-sA5xnHPHNMckBR")).cookie;
		expect((await call("/portal/api/preview", rep, "POST", { role: "manager" })).status).toBe(403);
		const pv = await call("/portal/api/preview", admin, "POST", { role: "manager" });
		expect(pv.status).toBe(200);
		const pvCookie = (pv.headers.get("set-cookie") ?? "").split(";")[0];
		expect(pvCookie.startsWith("cn_preview=manager.")).toBe(true);
		const combined = admin + "; " + pvCookie;
		expect((await call("/portal/api/accounts", combined)).status).toBe(403);
		// A rep preview scopes rep data to the previewed rep.
		const pvRep = await call("/portal/api/preview", admin, "POST", { role: "rep", user: "CNguyen" });
		expect(pvRep.status).toBe(200);
		// Exiting clears the cookie and lands back on Accounts.
		const exit = await call("/portal/preview/exit", combined);
		expect(exit.status).toBe(303);
		expect(exit.headers.get("set-cookie")).toContain("cn_preview=;");
	});

	it("marketing scanner: gated by role, scans NPPES, stores an AI report", async () => {
		const { env, db } = makeEnv();
		(env as unknown as { AI: unknown }).AI = {
			run: async () => ({
				response: JSON.stringify({
					summary: "Katy has strong regen demand.",
					market_overview: "Growing suburban market.",
					top_competitors: [
						{ name: "Katy Sports & Spine", address: "1 Main St, Katy, TX", why: "Sports med group", stem_cell_status: "likely", similarity: "high" },
					],
					search_terms: [{ term: "stem cell knee katy", why: "ortho intent", score_0_100: 80 }],
					adoption_pathways: [{ angle: "Physician-led sourcing", why_relevant: "differentiator" }],
					regulatory_note: "Mind Texas advertising rules.",
				}),
			}),
		};
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const u = String(input instanceof Request ? input.url : input);
			if (u.startsWith("https://npiregistry.cms.hhs.gov/")) {
				return new Response(JSON.stringify({
					results: [{
						enumeration_type: "NPI-2",
						basic: { organization_name: "Katy Sports & Spine" },
						addresses: [{ address_purpose: "LOCATION", address_1: "1 Main St", city: "Katy", state: "TX", telephone_number: "281-555-0100" }],
						taxonomies: [{ desc: "Sports Medicine", primary: true }],
					}],
				}), { headers: { "content-type": "application/json" } });
			}
			return realFetch(input as never, init);
		}) as typeof fetch;
		try {
			const call = async (path: string, cookie?: string, method = "GET", body?: unknown) =>
				worker.fetch!(
					new Request("https://www.cellunovabiologics.com" + path, {
						method,
						headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
						...(body ? { body: JSON.stringify(body) } : {}),
					}) as never,
					env,
					ctx,
				);
			// Gating: anonymous 401, clinic 403, manager can read but not generate.
			expect((await call("/portal/api/marketing/reports")).status).toBe(401);
			const clinic = (await login("UnitedChiro", "UC-m42f5xyDaCiFkm")).cookie;
			expect((await call("/portal/api/marketing/reports", clinic)).status).toBe(403);
			const manager = (await login("Admin", "NOVAto200M")).cookie;
			expect((await call("/portal/api/marketing/reports", manager)).status).toBe(200);
			expect((await call("/portal/api/marketing/generate", manager, "POST", { city: "Katy", state: "TX" })).status).toBe(403);
			// Admin generates a real report from the mocked registry + AI.
			const admin = (await login()).cookie;
			const gen = await call("/portal/api/marketing/generate", admin, "POST", { city: "Katy", state: "TX", focus: "sports medicine" });
			expect(gen.status).toBe(200);
			const { report } = (await gen.json()) as { report: Record<string, unknown> };
			expect(report.provider_count).toBe(1);
			expect((report.top_competitors as Array<{ name: string; maps_url: string }>)[0].name).toBe("Katy Sports & Spine");
			expect((report.top_competitors as Array<{ maps_url: string }>)[0].maps_url).toContain("google.com/maps");
			expect(db.reports.size).toBe(1);
			// The stored report lists back.
			const list = (await (await call("/portal/api/marketing/reports", admin)).json()) as { reports: unknown[] };
			expect(list.reports).toHaveLength(1);
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	it("scopes the orders list to the clinic that placed them", async () => {
		const { env, db } = makeEnv();
		const mkOrder = (id: string, account: string) =>
			db.orders.set(id, {
				data: JSON.stringify({ id, number: "CN-" + id.toUpperCase(), date: "2026-08-18T00:00:00Z", stage: 2, total: 800, currency: "usd", notes: "", account, items: [] }),
			});
		mkOrder("cs_mine", "UnitedChiro");
		mkOrder("cs_admin_test", ""); // legacy/admin order with no account
		const list = async (cookie: string) => {
			const res = await worker.fetch!(
				new Request("https://www.cellunovabiologics.com/portal/api/orders", { headers: { cookie } }) as never,
				env,
				ctx,
			);
			return ((await res.json()) as { orders: Array<{ account?: string }> }).orders;
		};
		const clinic = (await login("UnitedChiro", "UC-m42f5xyDaCiFkm")).cookie;
		const admin = (await login()).cookie;
		const clinicOrders = await list(clinic);
		expect(clinicOrders).toHaveLength(1);
		expect(clinicOrders[0].account).toBe("UnitedChiro");
		expect(await list(admin)).toHaveLength(2);
	});

	it("serves the protocols page at /portal/ when signed in", async () => {
		const { cookie } = await login();
		const { calls } = await hit("/portal/", "www.cellunovabiologics.com", "GET", cookie);
		expect(calls).toEqual(["/clinic-portal/"]);
	});

	it("maps portal subpages and their assets when signed in", async () => {
		const { cookie } = await login();
		expect((await hit("/portal/crm/", "www.cellunovabiologics.com", "GET", cookie)).calls).toEqual(["/clinic-portal/crm/"]);
		expect((await hit("/portal/crm/crm.js", "www.cellunovabiologics.com", "GET", cookie)).calls).toEqual(["/clinic-portal/crm/crm.js"]);
		expect((await hit("/portal/styles/portal.css", "www.cellunovabiologics.com", "GET", cookie)).calls).toEqual(["/clinic-portal/styles/portal.css"]);
		// Hosted protocol-library pages serve as static assets behind the portal
		// auth. The .html extension is stripped before the assets fetch so the
		// binding serves content directly instead of redirecting to the pretty
		// URL in the internal (non-routable) /clinic-portal/ namespace.
		expect((await hit("/portal/protocols/library/knee.html", "www.cellunovabiologics.com", "GET", cookie)).calls)
			.toEqual(["/clinic-portal/protocols/library/knee"]);
		expect((await hit("/portal/templates/rebrand/new-service-flyer.html", "www.cellunovabiologics.com", "GET", cookie)).calls)
			.toEqual(["/clinic-portal/templates/rebrand/new-service-flyer"]);
		expect((await hit("/portal/protocols/library/injury-recovery.pdf", "www.cellunovabiologics.com", "GET", cookie)).calls)
			.toEqual(["/clinic-portal/protocols/library/injury-recovery.pdf"]);
	});

	it("rejects a forged session cookie", async () => {
		const forged = "cn_admin=" + (Date.now() + 3600000) + ".deadbeef";
		const { res, calls } = await hit("/portal/", "www.cellunovabiologics.com", "GET", forged);
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
		const { res } = await hit("/portal/crm", "www.cellunovabiologics.com", "GET", cookie);
		expect(res.status).toBe(301);
		expect(res.headers.get("location")).toBe("https://www.cellunovabiologics.com/portal/crm/");
	});

	it("redirects legacy paths", async () => {
		const { cookie } = await login();
		expect((await hit("/portal/protocols", "www.cellunovabiologics.com", "GET", cookie)).res.headers.get("location"))
			.toBe("https://www.cellunovabiologics.com/portal/");
		expect((await hit("/portal/support", "www.cellunovabiologics.com", "GET", cookie)).res.headers.get("location"))
			.toBe("https://www.cellunovabiologics.com/portal/tickets/");
	});

	it("redirects the apex to www", async () => {
		const { res } = await hit("/portal/crm/", "cellunovabiologics.com");
		expect(res.status).toBe(301);
		expect(res.headers.get("location")).toBe("https://www.cellunovabiologics.com/portal/crm/");
	});

	it("forces https on the site domains", async () => {
		const { env } = makeEnv();
		const res = await worker.fetch!(
			new Request("http://www.cellunovabiologics.com/signup") as never,
			env,
			ctx,
		);
		expect(res.status).toBe(301);
		expect(res.headers.get("location")).toBe("https://www.cellunovabiologics.com/signup");
		// http on the old domain jumps straight to https on the new one.
		const old = await worker.fetch!(
			new Request("http://cellsunova.com/portal/") as never,
			env,
			ctx,
		);
		expect(old.status).toBe(301);
		expect(old.headers.get("location")).toBe("https://www.cellunovabiologics.com/portal/");
	});

	it("permanently redirects the old domain to the new one, keeping the path", async () => {
		for (const host of ["www.cellsunova.com", "cellsunova.com"]) {
			const { res, calls } = await hit("/portal/crm/?tab=leads", host);
			expect(res.status).toBe(301);
			expect(res.headers.get("location")).toBe("https://www.cellunovabiologics.com/portal/crm/?tab=leads");
			expect(calls).toEqual([]); // nothing served from the old host
		}
	});

	it("never serves internal docs", async () => {
		expect((await hit("/portal/SECURITY-REVIEW.md")).res.status).toBe(404);
		expect((await hit("/portal/SCRAPE-PLAN.md")).res.status).toBe(404);
		expect((await hit("/portal/hardening/portal.js")).res.status).toBe(404);
	});

	it("rejects non-GET methods", async () => {
		expect((await hit("/portal/crm/", "www.cellunovabiologics.com", "POST")).res.status).toBe(405);
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
			new Request("https://www.cellunovabiologics.com/signup", { method: "POST", body }) as never,
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
			new Request("https://www.cellunovabiologics.com/signup", { method: "POST", body }) as never,
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
			new Request("https://www.cellunovabiologics.com/signup", { method: "POST", body }) as never,
			env,
			ctx,
		);
		const row = [...db.rows.values()][0];
		const path = `/portal/approve?id=${row.id}&token=${row.token}`;

		// Signed out: bounced to login with the full query preserved.
		const anon = await worker.fetch!(
			new Request(`https://www.cellunovabiologics.com${path}`) as never,
			env,
			ctx,
		);
		expect(anon.status).toBe(302);
		expect(anon.headers.get("location")).toContain("/login?next=");

		// Signed in with a valid token: approved.
		const { cookie } = await login();
		const ok = await worker.fetch!(
			new Request(`https://www.cellunovabiologics.com${path}`, { headers: { cookie } }) as never,
			env,
			ctx,
		);
		expect(ok.status).toBe(200);
		expect(await ok.text()).toContain("approved");
		expect(row.status).toBe("approved");

		// Wrong token: rejected.
		const bad = await worker.fetch!(
			new Request(`https://www.cellunovabiologics.com/portal/approve?id=${row.id}&token=deadbeef`, {
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
			new Request("https://www.cellunovabiologics.com/portal/api/leads") as never,
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
			new Request("https://www.cellunovabiologics.com/signup", { method: "POST", body }) as never,
			env,
			ctx,
		);
		const { cookie } = await login();
		const res = await worker.fetch!(
			new Request("https://www.cellunovabiologics.com/portal/api/leads", { headers: { cookie } }) as never,
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
			new Request("https://www.cellunovabiologics.com/signup", { method: "POST", body: form }) as never,
			env,
			ctx,
		);
		const { cookie } = await login();
		const upload = await worker.fetch!(
			new Request("https://www.cellunovabiologics.com/portal/api/leads", {
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
			new Request("https://www.cellunovabiologics.com/portal/api/leads", { headers: { cookie } }) as never,
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
				new Request("https://www.cellunovabiologics.com/portal/api/leads/scan", {
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
				new Request("https://www.cellunovabiologics.com/portal/api/leads/scan", {
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
				new Request("https://www.cellunovabiologics.com/portal/api/leads/scan", {
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
				new Request("https://www.cellunovabiologics.com/portal/api/leads/scan", {
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
				new Request("https://www.cellunovabiologics.com/portal/api/leads/scan", {
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
				new Request("https://www.cellunovabiologics.com/portal/api/leads/scan", {
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

	it("requires a session for the ordering API and 503s without a Stripe key", async () => {
		const { env } = makeEnv();
		const anon = await worker.fetch!(
			new Request("https://www.cellunovabiologics.com/portal/api/checkout", { method: "POST" }) as never,
			env,
			ctx,
		);
		expect(anon.status).toBe(401);

		const { cookie } = await login();
		const res = await worker.fetch!(
			new Request("https://www.cellunovabiologics.com/portal/api/checkout", {
				method: "POST",
				headers: { cookie, "content-type": "application/json" },
				body: JSON.stringify({ items: [{ id: "nova-flow", vol: "1 cc", qty: 1 }] }),
			}) as never,
			env,
			ctx,
		);
		expect(res.status).toBe(503);
	});

	it("creates a Stripe checkout session with server-side prices", async () => {
		const { env } = makeEnv();
		(env as { STRIPE_SECRET_KEY?: string }).STRIPE_SECRET_KEY = "sk_test_x";
		const { cookie } = await login();

		const realFetch = globalThis.fetch;
		let sentBody = "";
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const u = String(input);
			if (u.startsWith("https://api.stripe.com/v1/checkout/sessions")) {
				sentBody = String(init?.body ?? "");
				return new Response(
					JSON.stringify({ id: "cs_test_123", url: "https://checkout.stripe.com/c/pay/cs_test_123" }),
					{ headers: { "content-type": "application/json" } },
				);
			}
			return realFetch(input as never, init as never);
		}) as typeof fetch;

		try {
			const res = await worker.fetch!(
				new Request("https://www.cellunovabiologics.com/portal/api/checkout", {
					method: "POST",
					headers: { cookie, "content-type": "application/json" },
					body: JSON.stringify({
						items: [
							{ id: "nova-elite", vol: "2 cc", qty: 3 },
							{ id: "exo-plus", vol: "1 cc", qty: 2 },
						],
						notes: "For Tuesday cases",
					}),
				}) as never,
				env,
				ctx,
			);
			expect(res.status).toBe(200);
			const data = (await res.json()) as { url: string };
			expect(data.url).toContain("checkout.stripe.com");
			const p = new URLSearchParams(sentBody);
			expect(p.get("mode")).toBe("payment");
			expect(p.get("line_items[0][price_data][unit_amount]")).toBe("160000"); // 2 cc × $800
			expect(p.get("line_items[0][quantity]")).toBe("3");
			expect(p.get("line_items[1][price_data][unit_amount]")).toBe("50000"); // 1 cc × $500 (NOVA-E1)
			expect(p.get("metadata[notes]")).toBe("For Tuesday cases");
			expect(p.get("success_url")).toContain("/portal/orders/");

			// Volumes are per-product: 3 cc exists only for NOVA-E1, 5 cc nowhere.
			const tryVol = async (id: string, vol: string) =>
				(
					await worker.fetch!(
						new Request("https://www.cellunovabiologics.com/portal/api/checkout", {
							method: "POST",
							headers: { cookie, "content-type": "application/json" },
							body: JSON.stringify({ items: [{ id, vol, qty: 1 }] }),
						}) as never,
						env,
						ctx,
					)
				).status;
			expect(await tryVol("exo-plus", "3 cc")).toBe(200);
			expect(await tryVol("nova-flow", "3 cc")).toBe(400);
			expect(await tryVol("nova-elite", "5 cc")).toBe(400);
			// Equipment: the cryofreezer sells as a single $2,700 unit.
			expect(await tryVol("cryofreezer", "1 unit")).toBe(200);
			expect(new URLSearchParams(sentBody).get("line_items[0][price_data][unit_amount]")).toBe("270000");
			expect(await tryVol("cryofreezer", "2 cc")).toBe(400);
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	it("confirms a paid session, records the order, and lists it", async () => {
		const { env, db } = makeEnv();
		(env as { STRIPE_SECRET_KEY?: string }).STRIPE_SECRET_KEY = "sk_test_x";
		const { cookie } = await login();

		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const u = String(input);
			if (u.startsWith("https://api.stripe.com/v1/checkout/sessions/cs_test_abc")) {
				return new Response(
					JSON.stringify({
						id: "cs_test_abc",
						payment_status: "paid",
						amount_total: 530000,
						currency: "usd",
						created: 1765000000,
						metadata: { notes: "call before shipping" },
						line_items: {
							data: [
								{ description: "NOVA-E2 — 2 cc", quantity: 3, amount_total: 480000 },
								{ description: "NOVA-E1 — 1 cc", quantity: 1, amount_total: 50000 },
							],
						},
					}),
					{ headers: { "content-type": "application/json" } },
				);
			}
			return realFetch(input as never, init as never);
		}) as typeof fetch;

		try {
			const confirm = await worker.fetch!(
				new Request("https://www.cellunovabiologics.com/portal/api/checkout/confirm?session_id=cs_test_abc", {
					headers: { cookie },
				}) as never,
				env,
				ctx,
			);
			expect(confirm.status).toBe(200);
			const data = (await confirm.json()) as { paid: boolean; order: { total: number; items: unknown[] } };
			expect(data.paid).toBe(true);
			expect(data.order.total).toBe(5300);
			expect(data.order.items).toHaveLength(2);
			expect(db.orders.size).toBe(1);

			const list = await worker.fetch!(
				new Request("https://www.cellunovabiologics.com/portal/api/orders", { headers: { cookie } }) as never,
				env,
				ctx,
			);
			const listed = (await list.json()) as { orders: Array<{ total: number; notes: string }> };
			expect(listed.orders).toHaveLength(1);
			expect(listed.orders[0].total).toBe(5300);
			expect(listed.orders[0].notes).toBe("call before shipping");
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	it("rejects unconfigured or badly signed Stripe webhooks", async () => {
		const { env } = makeEnv();
		const noConfig = await worker.fetch!(
			new Request("https://www.cellunovabiologics.com/stripe/webhook", { method: "POST", body: "{}" }) as never,
			env,
			ctx,
		);
		expect(noConfig.status).toBe(501);

		(env as { STRIPE_WEBHOOK_SECRET?: string }).STRIPE_WEBHOOK_SECRET = "whsec_test";
		const badSig = await worker.fetch!(
			new Request("https://www.cellunovabiologics.com/stripe/webhook", {
				method: "POST",
				body: "{}",
				headers: { "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=deadbeef` },
			}) as never,
			env,
			ctx,
		);
		expect(badSig.status).toBe(400);
	});

	it("rejects a scan without any specialties", async () => {
		const { env } = makeEnv();
		const { cookie } = await login();
		const res = await worker.fetch!(
			new Request("https://www.cellunovabiologics.com/portal/api/leads/scan", {
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
