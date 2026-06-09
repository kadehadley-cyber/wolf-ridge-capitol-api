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
// Web search produces extra intermediate output, so the tooled Claude path gets
// more room; the spoken answer itself still stays short.
const CLAUDE_MAX_TOKENS = 2048;

// Spelling out the trigger condition makes Opus reach for the tool reliably.
const TOOL_SENTENCE =
	"You can search the web — do so whenever the answer depends on current, " +
	"real-world, or changing information (weather, news, prices, sports, recent " +
	"facts, anything you're unsure of) rather than guessing. After searching, give " +
	"the short spoken answer, not a list of sources.";

/** A one-line "the time right now is…" note for the system prompt. */
function timeLine(env: Env): string {
	const tz = env.JARVIS_TIMEZONE || "UTC";
	let stamp: string;
	try {
		stamp = new Intl.DateTimeFormat("en-GB", {
			weekday: "long",
			year: "numeric",
			month: "long",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			timeZone: tz,
		}).format(new Date());
	} catch {
		stamp = new Date().toUTCString();
	}
	return `For your reference, the current date and time is ${stamp} (${tz}).`;
}

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
	const base = buildSystemPrompt(persona(env));
	const messages: Turn[] = [...history, { role: "user", content: utterance }];

	if (env.ANTHROPIC_API_KEY) {
		// Claude gets the live web-search tool plus time + tool guidance.
		const system = `${base}\n\n${timeLine(env)} ${TOOL_SENTENCE}`;
		return generateWithClaude(env, system, messages);
	}
	if (env.AI) {
		// The Workers AI fallback has no tools, but still gets the current time.
		const system = `${base}\n\n${timeLine(env)}`;
		return generateWithWorkersAI(env, system, messages);
	}
	throw new Error(
		"No language model configured. Set the ANTHROPIC_API_KEY secret or bind Workers AI as `AI`.",
	);
}

async function generateWithClaude(
	env: Env,
	system: string,
	turns: Turn[],
): Promise<string> {
	const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
	const messages: Anthropic.MessageParam[] = turns.map((m) => ({
		role: m.role,
		content: m.content,
	}));

	const request = () =>
		client.messages.create({
			model: env.JARVIS_MODEL || DEFAULT_MODEL,
			max_tokens: CLAUDE_MAX_TOKENS,
			// A voice assistant should answer without a long "thinking" pause; the
			// persona prompt tells it to emit only the final spoken answer.
			thinking: { type: "disabled" },
			system,
			// Live web search gives Jarvis real agency. Server-side tool — Anthropic
			// runs the search loop. Disable with JARVIS_TOOLS=off.
			tools:
				env.JARVIS_TOOLS === "off"
					? undefined
					: [{ type: "web_search_20260209", name: "web_search" }],
			messages,
		});

	let response = await request();
	// Server-side search runs its own loop; if it hits the server iteration limit
	// it returns `pause_turn`. Re-send the accumulated turn to let it finish.
	for (let i = 0; response.stop_reason === "pause_turn" && i < 4; i++) {
		messages.push({ role: "assistant", content: response.content });
		response = await request();
	}

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
