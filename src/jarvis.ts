// The Jarvis "brain": turns an incoming utterance into a spoken reply.
//
// Powered by Claude (Anthropic API) when ANTHROPIC_API_KEY is set, with an
// automatic fallback to Cloudflare Workers AI (Llama) when it isn't — so the
// assistant still answers even before you've wired up a key.
//
// On the Claude path Jarvis is an *agent*: it can call tools mid-turn (tell the
// time, check the weather, do exact math and unit conversions, and remember or
// recall facts and reminders). It also knows you — durable facts about the
// wearer are injected into every system prompt — and it's grounded in the real
// date/time. The Workers AI fallback can't call tools, so it degrades to a
// memory-aware, date-grounded conversation.

import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, type PersonaConfig } from "./persona";
import { appendTurns, clearHistory, loadHistory, type Turn } from "./memory";
import {
	clearFacts,
	clearReminders,
	dueReminders,
	formatFactsForPrompt,
	getFactValue,
	loadFacts,
	markReminderFired,
} from "./longterm";
import { formatSpokenDateTime, formatSpokenDue, safeTimeZone } from "./datetime";
import { buildToolCatalog, runTool, type ToolContext } from "./tools";

const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_NAME = "Jarvis";
const DEFAULT_USER_TITLE = "sir";

// Spoken replies are short; this is plenty of headroom and keeps latency low.
const MAX_TOKENS = 1024;

// How many durable facts to inject into the system prompt each turn.
const FACT_INJECT_LIMIT = 40;

// Bounds on the agentic tool-call loop so a turn always ends in a spoken
// sentence — never a hang or a dangling tool call.
const MAX_TOOL_STEPS = 5;
const TOOL_TIME_BUDGET_MS = 22_000;

// Phrases that wipe the short-term conversation and start fresh.
const RESET_PATTERN =
	/^\s*(jarvis,?\s+)?(reset|start over|forget (everything|all that|the conversation)|new conversation|clear (memory|history))\s*[.!]?\s*$/i;

// Phrases that wipe everything Jarvis knows about you — the privacy command.
const FORGET_ME_PATTERN =
	/^\s*(jarvis,?\s+)?(forget (everything|all|what you know) about me|forget me|wipe (my data|everything about me)|delete (my data|everything about me))\s*[.!]?\s*$/i;

function persona(env: Env): PersonaConfig {
	return {
		name: env.JARVIS_NAME || DEFAULT_NAME,
		userTitle:
			env.JARVIS_USER_TITLE === undefined ? DEFAULT_USER_TITLE : env.JARVIS_USER_TITLE,
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

	if (!text) {
		return `I'm here. What do you need?`;
	}

	// The privacy command is checked first — it's the most destructive and its
	// phrasing ("forget everything about me") would otherwise look like a reset.
	if (FORGET_ME_PATTERN.test(text)) {
		await Promise.all([
			clearHistory(env.DB, sessionId),
			clearFacts(env.DB, sessionId),
			clearReminders(env.DB, sessionId),
		]);
		return `Done. I've wiped what I knew about you, along with our conversation.`;
	}

	if (RESET_PATTERN.test(text)) {
		await clearHistory(env.DB, sessionId);
		return `Done. Clean slate.`;
	}

	const now = new Date();
	const [history, facts] = await Promise.all([
		loadHistory(env.DB, sessionId),
		loadFacts(env.DB, sessionId, FACT_INJECT_LIMIT),
	]);

	const tz = safeTimeZone(getFactValue(facts, "timezone") ?? env.JARVIS_TIMEZONE);
	const due = await dueReminders(env.DB, sessionId, now);

	const system = buildSystemPrompt(persona(env), {
		// Tools only fire on the Claude path; don't claim agency the fallback lacks.
		hasTools: Boolean(env.ANTHROPIC_API_KEY),
		nowSpoken: formatSpokenDateTime(now, tz),
		knownFacts: formatFactsForPrompt(facts),
		dueReminders: due
			.map((r) => `- ${r.text} (due ${formatSpokenDue(new Date(r.dueAt), tz)})`)
			.join("\n"),
	});

	const reply =
		(await generate(env, sessionId, system, history, text, now, facts)).trim() ||
		`Apologies — I didn't catch that. Could you say it again?`;

	await appendTurns(env.DB, sessionId, [
		{ role: "user", content: text },
		{ role: "assistant", content: reply },
	]);

	// Consume a surfaced reminder only if the reply actually voiced it; otherwise
	// leave it pending so it resurfaces next turn rather than being silently lost.
	if (due.length) {
		const voiced = due.filter((r) => replyMentions(reply, r.text));
		await Promise.all(voiced.map((r) => markReminderFired(env.DB, sessionId, r.id)));
	}

	return reply;
}

async function generate(
	env: Env,
	sessionId: string,
	system: string,
	history: Turn[],
	utterance: string,
	now: Date,
	facts: Awaited<ReturnType<typeof loadFacts>>,
): Promise<string> {
	if (env.ANTHROPIC_API_KEY) {
		return generateWithClaude(env, sessionId, system, history, utterance, now, facts);
	}
	if (env.AI) {
		return generateWithWorkersAI(env, system, history, utterance);
	}
	throw new Error(
		"No language model configured. Set the ANTHROPIC_API_KEY secret or bind Workers AI as `AI`.",
	);
}

/**
 * The agentic path. Claude may call tools across several rounds; each round we
 * run the requested tools and feed the results back. Bounded by step count and
 * a wall-clock budget, with a final tools-free call so the turn always resolves
 * to a spoken sentence.
 */
async function generateWithClaude(
	env: Env,
	sessionId: string,
	system: string,
	history: Turn[],
	utterance: string,
	now: Date,
	facts: Awaited<ReturnType<typeof loadFacts>>,
): Promise<string> {
	const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
	const model = env.JARVIS_MODEL || DEFAULT_MODEL;
	const catalog = buildToolCatalog();
	const tools = catalog.map((t) => t.definition);
	const ctx: ToolContext = { env, sessionId, now, facts };

	const messages: Anthropic.MessageParam[] = [
		...history.map((m) => ({ role: m.role, content: m.content })),
		{ role: "user", content: utterance },
	];

	const start = Date.now();
	for (let step = 0; step < MAX_TOOL_STEPS; step++) {
		const response = await client.messages.create({
			model,
			max_tokens: MAX_TOKENS,
			// Snappy spoken replies: no "thinking" pause before answering.
			thinking: { type: "disabled" },
			system,
			tools,
			tool_choice: { type: "auto" },
			messages,
		});

		if (response.stop_reason !== "tool_use") {
			return joinText(response.content);
		}

		// Echo the assistant's tool-call turn back, then answer every tool_use
		// block in this round in parallel.
		messages.push({ role: "assistant", content: response.content });
		const toolUses = response.content.filter(
			(b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
		);
		const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
			toolUses.map(async (tu) => {
				const r = await runTool(catalog, tu.name, tu.input, ctx);
				return {
					type: "tool_result",
					tool_use_id: tu.id,
					content: r.content,
					is_error: r.isError,
				};
			}),
		);
		messages.push({ role: "user", content: results });

		if (Date.now() - start > TOOL_TIME_BUDGET_MS) break;
	}

	// Step/budget exhausted: one final call with tools omitted forces a spoken
	// answer instead of leaving the wearer hanging on a tool call.
	const final = await client.messages.create({
		model,
		max_tokens: MAX_TOKENS,
		thinking: { type: "disabled" },
		system,
		messages,
	});
	return joinText(final.content);
}

async function generateWithWorkersAI(
	env: Env,
	system: string,
	history: Turn[],
	utterance: string,
): Promise<string> {
	const result = await env.AI!.run("@cf/meta/llama-3.1-8b-instruct", {
		max_tokens: MAX_TOKENS,
		messages: [
			{ role: "system", content: system },
			...history.map((m) => ({ role: m.role, content: m.content })),
			{ role: "user", content: utterance },
		],
	});
	return typeof result?.response === "string" ? result.response : "";
}

/** Collapse a Claude response's content blocks into the spoken text. */
function joinText(content: Anthropic.ContentBlock[]): string {
	return content
		.filter((block): block is Anthropic.TextBlock => block.type === "text")
		.map((block) => block.text)
		.join(" ");
}

// Words too generic to indicate a reminder was actually voiced.
const REMINDER_STOPWORDS = new Set([
	"remind",
	"reminder",
	"about",
	"that",
	"this",
	"with",
	"your",
	"have",
	"from",
	"need",
	"please",
	"later",
	"today",
	"tomorrow",
]);

/**
 * Heuristic: did the spoken reply plausibly mention this reminder? Used to avoid
 * consuming a due reminder the model answered around without ever voicing. If
 * the text has no distinctive words, assume it surfaced (don't strand it).
 */
function replyMentions(reply: string, reminderText: string): boolean {
	const haystack = reply.toLowerCase();
	const significant = (reminderText.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter(
		(w) => !REMINDER_STOPWORDS.has(w),
	);
	if (significant.length === 0) return true;
	return significant.some((w) => haystack.includes(w));
}
