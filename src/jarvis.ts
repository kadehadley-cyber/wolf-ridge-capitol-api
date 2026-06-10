// The Jarvis "brain": turns an incoming utterance into a spoken reply.
//
// Powered by Claude (Anthropic API) when ANTHROPIC_API_KEY is set, with an
// automatic fallback to Cloudflare Workers AI (Llama) when it isn't — so the
// assistant still answers even before you've wired up a key.

import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, type PersonaConfig } from "./persona";
import {
	appendTurns,
	clearHistory,
	loadHistory,
	type Turn,
} from "./memory";

const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_NAME = "Jarvis";
const DEFAULT_USER_TITLE = "sir";

// Spoken replies are short; this is plenty of headroom and keeps latency low.
const MAX_TOKENS = 1024;

// Phrases that wipe the conversation and start fresh.
const RESET_PATTERN =
	/^\s*(jarvis,?\s+)?(reset|start over|forget (everything|all that|the conversation)|new conversation|clear (memory|history))\s*[.!]?\s*$/i;

function persona(env: Env): PersonaConfig {
	return {
		name: env.JARVIS_NAME || DEFAULT_NAME,
		userTitle:
			env.JARVIS_USER_TITLE === undefined
				? DEFAULT_USER_TITLE
				: env.JARVIS_USER_TITLE,
	};
}

/**
 * Produce Jarvis's spoken reply to one utterance, persisting the exchange so the
 * next turn has context.
 */
export async function ask(
	env: Env,
	sessionId: string,
	utterance: string,
): Promise<string> {
	const text = utterance.trim();
	const { name } = persona(env);

	if (!text) {
		return `I'm here. What do you need?`;
	}

	if (RESET_PATTERN.test(text)) {
		await clearHistory(env.DB, sessionId);
		return `Done. Clean slate.`;
	}

	const history = await loadHistory(env.DB, sessionId);
	const reply = (await generate(env, history, text)).trim() ||
		`Apologies — I didn't catch that. Could you say it again?`;

	await appendTurns(env.DB, sessionId, [
		{ role: "user", content: text },
		{ role: "assistant", content: reply },
	]);

	return reply;
}

async function generate(
	env: Env,
	history: Turn[],
	utterance: string,
): Promise<string> {
	const system = buildSystemPrompt(persona(env));
	const messages: Turn[] = [...history, { role: "user", content: utterance }];

	if (env.ANTHROPIC_API_KEY) {
		try {
			return await generateWithClaude(env, system, messages);
		} catch (err) {
			// A bad key, missing model access, or an Anthropic outage shouldn't
			// leave the wearer in silence — fall back to Workers AI when bound.
			if (!env.AI) throw err;
			console.error("Claude call failed; answering with Workers AI:", err);
			return generateWithWorkersAI(env, system, messages);
		}
	}
	if (env.AI) {
		return generateWithWorkersAI(env, system, messages);
	}
	throw new Error(
		"No language model configured. Set the ANTHROPIC_API_KEY secret or bind Workers AI as `AI`.",
	);
}

async function generateWithClaude(
	env: Env,
	system: string,
	messages: Turn[],
): Promise<string> {
	const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

	const response = await client.messages.create({
		model: env.JARVIS_MODEL || DEFAULT_MODEL,
		max_tokens: MAX_TOKENS,
		// A voice assistant must answer instantly — no "thinking" pause before
		// speaking. The persona prompt already tells it to emit only the final,
		// spoken answer (Opus 4.8 can otherwise narrate reasoning when thinking
		// is disabled).
		thinking: { type: "disabled" },
		system,
		messages: messages.map((m) => ({ role: m.role, content: m.content })),
	});

	return response.content
		.filter((block): block is Anthropic.TextBlock => block.type === "text")
		.map((block) => block.text)
		.join(" ");
}

async function generateWithWorkersAI(
	env: Env,
	system: string,
	messages: Turn[],
): Promise<string> {
	const result = await env.AI!.run("@cf/meta/llama-3.1-8b-instruct", {
		max_tokens: MAX_TOKENS,
		messages: [
			{ role: "system", content: system },
			...messages.map((m) => ({ role: m.role, content: m.content })),
		],
	});
	return typeof result?.response === "string" ? result.response : "";
}
