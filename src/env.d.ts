// Extra bindings, secrets, and vars used by Jarvis. These merge into the `Env`
// interface that `wrangler types` generates in worker-configuration.d.ts (which
// only knows about the `DB` binding declared in wrangler.json).

interface Env {
	// --- Static assets (the CelluNOVA site under web/, served on cellunovabiologics.com) ---
	/** Workers static assets binding; run_worker_first routes everything here first. */
	ASSETS: { fetch(request: Request): Promise<Response> };

	// --- Portal sign-in (defaults baked into src/auth.ts; override via secrets) ---
	/** Portal admin username. */
	PORTAL_ADMIN_USER?: string;
	/** Portal admin password hash: pbkdf2$<iterations>$<salt hex>$<hash hex>. */
	PORTAL_ADMIN_PASS_HASH?: string;
	/** HMAC key for the session cookie; set this secret in production. */
	PORTAL_SESSION_SECRET?: string;

	// --- Clinic sign-up email (Resend) ---
	/** Resend API key (secret). Without it, emails are skipped but applications still store in D1. */
	RESEND_API_KEY?: string;
	/** Verified sender, e.g. "CelluNOVA <no-reply@cellunovabiologics.com>". */
	MAIL_FROM?: string;
	/** Where clinic applications are sent for review. Defaults to DrHadley@cellunovabiologics.com. */
	ADMIN_NOTIFY_EMAIL?: string;

	// --- Access control ---
	/**
	 * Shared bearer token (secret) for the HTTP endpoints `/jarvis` and
	 * `/briefing`, which read and write a session's durable memory. When set,
	 * callers must send `Authorization: Bearer <key>`. Leave unset only for local
	 * development; set it for any shared/public deployment so a session's dossier
	 * can't be read or poisoned by guessing its id.
	 */
	JARVIS_API_KEY?: string;

	// --- Language model (set ANTHROPIC_API_KEY, or bind Workers AI as a fallback) ---
	/** Anthropic API key (secret). When set, Jarvis answers with Claude. */
	ANTHROPIC_API_KEY?: string;
	/** Override the Claude model id. Defaults to claude-opus-4-8. */
	JARVIS_MODEL?: string;
	/** Cloudflare Workers AI binding — used only if ANTHROPIC_API_KEY is absent. */
	AI?: { run(model: string, inputs: unknown): Promise<{ response?: string }> };

	// --- Persona ---
	/** What the assistant calls itself. Defaults to "Jarvis". */
	JARVIS_NAME?: string;
	/** How the assistant addresses the wearer. Defaults to "sir"; set "" for none. */
	JARVIS_USER_TITLE?: string;
	/**
	 * Default IANA timezone (e.g. "America/Denver") used to ground time and
	 * reminders when a wearer hasn't saved their own `timezone` fact. Optional;
	 * falls back to UTC.
	 */
	JARVIS_TIMEZONE?: string;
	/**
	 * Where the wearer lives, e.g. "St. George, Utah". Anchors weather with no
	 * location and directions with no origin, so a fresh session already knows
	 * home. A saved `home_location` fact overrides it.
	 */
	JARVIS_HOME_LOCATION?: string;

	// --- Smart home & devices (all optional; tools appear only when configured) ---
	/**
	 * Home Assistant base URL (https — e.g. your Nabu Casa or tunnel URL). With
	 * HOME_ASSISTANT_TOKEN set, Jarvis gains the `control_home` tool: lights,
	 * switches, covers (the mask, garage, blinds), locks, scenes.
	 */
	HOME_ASSISTANT_URL?: string;
	/** Home Assistant long-lived access token (secret). */
	HOME_ASSISTANT_TOKEN?: string;
	/**
	 * Named hardware commands as a JSON map of command → https webhook URL,
	 * e.g. {"open mask":"https://helmet.example.com/open"}. Gives Jarvis the
	 * `trigger_device` tool for DIY hardware (an ESP32 servo helmet, etc.).
	 */
	JARVIS_DEVICES?: string;

	// --- WhatsApp Cloud API bridge ---
	/** Permanent access token for the WhatsApp Cloud API (secret). */
	WHATSAPP_TOKEN?: string;
	/** The Cloud API phone number id messages are sent from. */
	WHATSAPP_PHONE_NUMBER_ID?: string;
	/** Token you choose; must match what you enter in the Meta webhook console. */
	WHATSAPP_VERIFY_TOKEN?: string;
	/** App secret (secret), used to verify the X-Hub-Signature-256 header. */
	WHATSAPP_APP_SECRET?: string;
}
