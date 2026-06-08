// Extra bindings, secrets, and vars used by Jarvis. These merge into the `Env`
// interface that `wrangler types` generates in worker-configuration.d.ts (which
// only knows about the `DB` binding declared in wrangler.json).

interface Env {
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
