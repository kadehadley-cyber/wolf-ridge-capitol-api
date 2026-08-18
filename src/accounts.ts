// Account manager API — admin (DrHadley) only; the router enforces that.
//
//   GET  /portal/api/accounts   built-in + database accounts (no hashes)
//   POST /portal/api/accounts   { action, ... }:
//     create  { user, role }    make a manager/rep/clinic account; returns the
//                               generated password ONCE — it is never stored
//     reset   { user }          new password for a database account (returned once)
//     disable { user } / enable { user }
//     delete  { user }
//
// Built-in accounts (the admin, Admin, Rep1, UnitedChiro) live in code and are
// listed read-only here. A database row can never carry the admin role.

import { builtinRoster, ensureAccountsTable, generatePassword, hashPassword, listDbAccounts } from "./auth";
import { listPendingRepApplications, setRepApplicationStatus } from "./rep-apply";

const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/;
const CREATABLE_ROLES = new Set(["manager", "rep", "clinic"]);
const PASSWORD_PREFIX: Record<string, string> = { manager: "Mgr", rep: "Rep", clinic: "CN" };

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
	});
}

export async function handleAccountsApi(request: Request, env: Env): Promise<Response> {
	if (request.method === "GET") {
		const builtin = builtinRoster(env).map((a) => ({ ...a, builtin: true, disabled: false }));
		const db = (await listDbAccounts(env)).map((r) => ({
			user: r.user,
			role: r.role,
			builtin: false,
			disabled: !!r.disabled,
			created_at: r.created_at,
		}));
		return json({ accounts: [...builtin, ...db], applications: await listPendingRepApplications(env) });
	}
	if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ error: "Body must be JSON." }, 400);
	}
	const action = String(body.action ?? "create");

	// Dismissing a rep application needs no username.
	if (action === "app-dismiss") {
		const appId = String(body.app_id ?? "");
		if (!appId) return json({ error: "Missing application id." }, 400);
		await setRepApplicationStatus(env, appId, "dismissed");
		return json({ ok: true, app_id: appId, dismissed: true });
	}

	const user = String(body.user ?? "").trim();
	if (!USERNAME_RE.test(user)) {
		return json({ error: "Usernames are 3–32 characters: letters, digits, dot, dash, underscore." }, 400);
	}
	await ensureAccountsTable(env);
	const builtins = builtinRoster(env);
	const isBuiltin = builtins.some((a) => a.user.toLowerCase() === user.toLowerCase());
	const existing = (await listDbAccounts(env)).find((r) => r.user.toLowerCase() === user.toLowerCase());

	if (action === "create" || action === "app-approve") {
		const role = action === "app-approve" ? "rep" : String(body.role ?? "");
		if (!CREATABLE_ROLES.has(role)) return json({ error: "Role must be manager, rep, or clinic." }, 400);
		if (isBuiltin || existing) return json({ error: "That username is taken." }, 409);
		const password = generatePassword(PASSWORD_PREFIX[role]);
		await env.DB.prepare(
			`INSERT INTO portal_accounts (user, hash, role, disabled, created_at) VALUES (?1, ?2, ?3, 0, ?4)`,
		)
			.bind(user, await hashPassword(password), role, new Date().toISOString())
			.run();
		if (action === "app-approve") {
			const appId = String(body.app_id ?? "");
			if (appId) await setRepApplicationStatus(env, appId, "approved");
		}
		return json({ ok: true, user, role, password });
	}

	// Every other action targets an existing database account; built-ins are
	// managed in code and immutable here.
	if (isBuiltin) return json({ error: "Built-in accounts are managed in code, not here." }, 400);
	if (!existing) return json({ error: "No such account." }, 404);

	if (action === "reset") {
		const password = generatePassword(PASSWORD_PREFIX[existing.role] ?? "CN");
		await env.DB.prepare(`UPDATE portal_accounts SET hash = ?1 WHERE user = ?2`)
			.bind(await hashPassword(password), existing.user)
			.run();
		return json({ ok: true, user: existing.user, role: existing.role, password });
	}
	if (action === "disable" || action === "enable") {
		await env.DB.prepare(`UPDATE portal_accounts SET disabled = ?1 WHERE user = ?2`)
			.bind(action === "disable" ? 1 : 0, existing.user)
			.run();
		return json({ ok: true, user: existing.user, disabled: action === "disable" });
	}
	if (action === "delete") {
		await env.DB.prepare(`DELETE FROM portal_accounts WHERE user = ?1`).bind(existing.user).run();
		return json({ ok: true, user: existing.user, deleted: true });
	}
	return json({ error: "Unknown action." }, 400);
}
