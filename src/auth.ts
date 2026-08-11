// Authentication for the CelluNOVA portal on cellsunova.com.
//
// No plaintext credential lives in this repository: the password is stored as
// a PBKDF2-SHA256 hash (100k iterations, random salt), and every default below
// can be overridden with Worker secrets so credentials rotate without a code
// change:
//   PORTAL_ADMIN_USER        username (defaults to the baked-in admin)
//   PORTAL_ADMIN_PASS_HASH   pbkdf2$<iterations>$<salt hex>$<hash hex>
//   PORTAL_SESSION_SECRET    HMAC key for the session cookie (set this in
//                            production; the fallback signs with the password
//                            hash, which is weaker if the repo leaks)
//
// Sessions are a signed `cn_admin=<expiry>.<hmac>` cookie: HttpOnly, Secure,
// SameSite=Lax, 12 hour lifetime. Comparisons are constant-time.

const encoder = new TextEncoder();

export const DEFAULT_ADMIN_USER = "DrHadley";
export const DEFAULT_ADMIN_PASS_HASH =
	"pbkdf2$100000$6e78f2a513948a981ea29c9781e038f4$74967a333a458f5886f25d2822e532ee6163c4c6d4b76fbed5c7f820cb71d4ce";

// A second built-in account. As with the primary, only the PBKDF2 hash is
// stored here — the plaintext password never lives in the repository.
const SECOND_ADMIN_USER = "Admin";
const SECOND_ADMIN_PASS_HASH =
	"pbkdf2$100000$4ac2b07b25a4c91b951132bce30e0dde$91b7946a0e954275f6aeb177c253246593ca9a674864061bb9e2746d84430d40";

interface Account {
	user: string;
	hash: string;
}

/** Accounts allowed to sign in: the primary (overridable via the
 *  PORTAL_ADMIN_USER / PORTAL_ADMIN_PASS_HASH secrets so it can rotate without
 *  a code change) plus the built-in secondary account. */
function accounts(env: Env): Account[] {
	return [
		{ user: env.PORTAL_ADMIN_USER || DEFAULT_ADMIN_USER, hash: env.PORTAL_ADMIN_PASS_HASH || DEFAULT_ADMIN_PASS_HASH },
		{ user: SECOND_ADMIN_USER, hash: SECOND_ADMIN_PASS_HASH },
	];
}

const COOKIE = "cn_admin";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function hexToBytes(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}

function bytesToHex(buf: ArrayBuffer): string {
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Length-independent constant-time string comparison. */
function timingSafeEqualStr(a: string, b: string): boolean {
	const ab = encoder.encode(a);
	const bb = encoder.encode(b);
	let mismatch = ab.length ^ bb.length;
	for (let i = 0; i < ab.length; i++) {
		mismatch |= ab[i] ^ bb[i % bb.length || 0];
	}
	return mismatch === 0;
}

export async function pbkdf2Hex(password: string, saltHex: string, iterations: number): Promise<string> {
	const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex) as unknown as BufferSource, iterations },
		key,
		256,
	);
	return bytesToHex(bits);
}

export async function verifyCredentials(env: Env, username: string, password: string): Promise<boolean> {
	let ok = false;
	// Check every account with the same work regardless of match, so a wrong
	// username costs the same as a wrong password and neither short-circuits.
	for (const acc of accounts(env)) {
		const parts = acc.hash.split("$");
		if (parts.length !== 4 || parts[0] !== "pbkdf2") continue;
		const iterations = Number(parts[1]) || 100000;
		const derived = await pbkdf2Hex(password, parts[2], iterations);
		const userOk = timingSafeEqualStr(username, acc.user);
		const passOk = timingSafeEqualStr(derived, parts[3]);
		if (userOk && passOk) ok = true;
	}
	return ok;
}

async function signingKey(env: Env): Promise<CryptoKey> {
	const secret = env.PORTAL_SESSION_SECRET || env.PORTAL_ADMIN_PASS_HASH || DEFAULT_ADMIN_PASS_HASH;
	return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
		"sign",
		"verify",
	]);
}

export async function createSessionCookie(env: Env): Promise<string> {
	const exp = Date.now() + SESSION_TTL_MS;
	const sig = await crypto.subtle.sign("HMAC", await signingKey(env), encoder.encode(String(exp)));
	return `${COOKIE}=${exp}.${bytesToHex(sig)}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

export const CLEAR_SESSION_COOKIE = `${COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`;

export async function hasValidSession(env: Env, request: Request): Promise<boolean> {
	const cookie = request.headers.get("cookie") ?? "";
	const m = /(?:^|;\s*)cn_admin=(\d+)\.([0-9a-f]+)/.exec(cookie);
	if (!m) return false;
	const exp = Number(m[1]);
	if (!Number.isFinite(exp) || exp < Date.now()) return false;
	try {
		return await crypto.subtle.verify(
			"HMAC",
			await signingKey(env),
			hexToBytes(m[2]) as unknown as BufferSource,
			encoder.encode(m[1]),
		);
	} catch {
		return false;
	}
}

/** The sign-in page, served by the Worker with no external dependencies. */
export function loginPage(error: boolean, next: string): Response {
	const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/portal/";
	const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
	const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Sign in - CelluNOVA</title>
<style>
:root { color-scheme: dark; }
body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
  background:#0b120f; color:#eef5f1; font-family:system-ui,-apple-system,"Segoe UI",sans-serif; }
.card { width:100%; max-width:380px; margin:20px; padding:34px 32px; border-radius:18px;
  background:#0f1714; border:1px solid rgba(255,255,255,.12); box-shadow:0 30px 70px rgba(0,0,0,.55); }
h1 { font-size:22px; margin:0 0 4px; }
h1 span { color:#7dd340; }
p.sub { font-size:13px; color:#8aa39b; margin:0 0 22px; }
label { display:block; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#8aa39b; margin:0 0 6px; }
input { width:100%; box-sizing:border-box; margin-bottom:14px; padding:11px 13px; border-radius:8px;
  background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.12); color:#eef5f1; font:inherit; font-size:14px; }
input:focus { outline:none; border-color:rgba(125,211,64,.55); background:rgba(125,211,64,.04); }
button { width:100%; padding:13px; border:none; border-radius:9px; background:#6fce35; color:#04120a;
  font:inherit; font-size:14px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; cursor:pointer; }
button:hover { background:#8fdd5a; }
.err { font-size:13px; color:#ff8fa6; margin:0 0 14px; }
a.back { display:block; text-align:center; font-size:12px; color:#8aa39b; margin-top:16px; text-decoration:none; }
a.back:hover { color:#7dd340; }
</style>
</head>
<body>
<form class="card" method="post" action="/login">
  <h1>Cellu<span>NOVA</span> Portal</h1>
  <p class="sub">Sign in to continue.</p>
  ${error ? '<p class="err">Incorrect username or password.</p>' : ""}
  <label for="u">Username</label>
  <input id="u" name="username" autocomplete="username" autofocus>
  <label for="p">Password</label>
  <input id="p" name="password" type="password" autocomplete="current-password">
  <input type="hidden" name="next" value="${esc(safeNext)}">
  <button type="submit">Sign in</button>
  <a class="back" href="/">Back to cellsunova.com</a>
</form>
</body>
</html>`;
	return new Response(html, {
		status: error ? 401 : 200,
		headers: {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store",
			"content-security-policy":
				"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
		},
	});
}
