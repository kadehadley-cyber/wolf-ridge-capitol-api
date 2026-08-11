// Routing tests for the public CelluNOVA site (cellsunova.com), which is
// served from the ASSETS binding by serveCelluNova in index.ts.
import { describe, expect, it } from "vitest";
import worker from "./index";

const ctx = {} as ExecutionContext;

function makeEnv() {
	const calls: string[] = [];
	const env = {
		ASSETS: {
			fetch: async (req: Request) => {
				const path = new URL(req.url).pathname;
				calls.push(path);
				return new Response("asset:" + path);
			},
		},
	} as unknown as Env;
	return { env, calls };
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

	it("leaves other hosts on the Jarvis routes", async () => {
		const { res, calls } = await hit("/portal/crm/", "example.workers.dev");
		expect(calls).toEqual([]);           // assets never touched
		expect(res.status).toBe(404);        // Jarvis switch: unknown path
	});
});
