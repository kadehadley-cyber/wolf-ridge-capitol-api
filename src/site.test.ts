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

async function hit(path: string, host = "www.cellsunova.com", method = "GET") {
	const { env, calls } = makeEnv();
	const res = await worker.fetch!(
		new Request(`https://${host}${path}`, { method }) as never,
		env,
		ctx,
	);
	return { res, calls };
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

	it("serves the protocols page at /portal/", async () => {
		const { calls } = await hit("/portal/");
		expect(calls).toEqual(["/clinic-portal/"]);
	});

	it("maps portal subpages and their assets", async () => {
		expect((await hit("/portal/crm/")).calls).toEqual(["/clinic-portal/crm/"]);
		expect((await hit("/portal/crm/crm.js")).calls).toEqual(["/clinic-portal/crm/crm.js"]);
		expect((await hit("/portal/styles/portal.css")).calls).toEqual(["/clinic-portal/styles/portal.css"]);
	});

	it("adds trailing slashes to page directories", async () => {
		const { res } = await hit("/portal/crm");
		expect(res.status).toBe(301);
		expect(res.headers.get("location")).toBe("https://www.cellsunova.com/portal/crm/");
	});

	it("redirects legacy paths", async () => {
		expect((await hit("/portal/protocols")).res.headers.get("location"))
			.toBe("https://www.cellsunova.com/portal/");
		expect((await hit("/portal/support")).res.headers.get("location"))
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
