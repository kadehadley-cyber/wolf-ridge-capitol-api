// The proactive "speak first" surface: a short spoken morning briefing composed
// from what Jarvis knows — the time, today's reminders, the weather where the
// wearer lives, and a touch of the dossier. Used by both GET /briefing (always
// available, synchronous) and the cron push. Every piece is gathered
// defensively so a single failure never sinks the whole briefing, and it works
// with no API key (a deterministic template) or polishes into character when
// ANTHROPIC_API_KEY is set.

import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, type PersonaConfig } from "./persona";
import {
	getFactValue,
	loadFacts,
	loadPendingReminders,
	type Reminder,
} from "./longterm";
import {
	formatSpokenDateTime,
	formatSpokenDue,
	localHour,
	localYmd,
	safeTimeZone,
} from "./datetime";
import { getWeather } from "./tools";

const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_NAME = "Jarvis";
const DEFAULT_USER_TITLE = "sir";

function persona(env: Env): PersonaConfig {
	return {
		name: env.JARVIS_NAME || DEFAULT_NAME,
		userTitle:
			env.JARVIS_USER_TITLE === undefined ? DEFAULT_USER_TITLE : env.JARVIS_USER_TITLE,
	};
}

/** Compose the spoken briefing string for a session at instant `now`. */
export async function composeBriefing(
	env: Env,
	sessionId: string,
	now: Date,
): Promise<string> {
	const facts = await loadFacts(env.DB, sessionId, 40);
	const tz = safeTimeZone(getFactValue(facts, "timezone") ?? env.JARVIS_TIMEZONE);

	const greeting = greetingFor(localHour(now, tz));
	const nowSpoken = formatSpokenDateTime(now, tz);

	const todays = await todaysReminders(env, sessionId, now, tz);
	const remindersText = todays.length
		? todays.map((r) => `${r.text} (${formatSpokenDue(new Date(r.dueAt), tz)})`).join("; ")
		: "";

	const weatherText = await weatherLine(env, facts);

	const template = deterministicBriefing(greeting, nowSpoken, weatherText, todays, tz);

	// No key → deterministic template. With a key → one cheap call to phrase it in
	// character; fall back to the template on any error.
	if (!env.ANTHROPIC_API_KEY) return template;
	try {
		return (await polish(env, greeting, nowSpoken, weatherText, remindersText)) || template;
	} catch {
		return template;
	}
}

/** How far back an overdue reminder still counts as "today's" news. */
const OVERDUE_GRACE_MS = 36 * 60 * 60 * 1000;

/**
 * Reminders worth mentioning in a briefing: due on the local calendar day, or
 * recently overdue. The grace window keeps week-old missed reminders from being
 * recited every single morning (they remain available via `list_reminders`).
 */
async function todaysReminders(
	env: Env,
	sessionId: string,
	now: Date,
	tz: string,
): Promise<Reminder[]> {
	const pending = await loadPendingReminders(env.DB, sessionId).catch(() => [] as Reminder[]);
	const today = localYmd(now, tz);
	const nowMs = now.getTime();
	return pending.filter((r) => {
		const dueMs = new Date(r.dueAt).getTime();
		if (!Number.isFinite(dueMs)) return false;
		if (dueMs <= nowMs) return nowMs - dueMs <= OVERDUE_GRACE_MS;
		return localYmd(new Date(r.dueAt), tz) === today;
	});
}

/** A short spoken weather clause, or "" if there's no home_location or it fails. */
async function weatherLine(
	env: Env,
	facts: Awaited<ReturnType<typeof loadFacts>>,
): Promise<string> {
	const home = getFactValue(facts, "home_location");
	if (!home) return "";
	try {
		const unitFact = (getFactValue(facts, "temp_unit") ?? "").toLowerCase();
		const tempUnit = unitFact.startsWith("c") ? "celsius" : "fahrenheit";
		const w = JSON.parse(await getWeather(home, "now", tempUnit)) as Record<string, unknown>;
		const place = typeof w.location === "string" ? w.location : home;
		const bits: string[] = [];
		if (typeof w.temperature === "number") bits.push(`${Math.round(w.temperature)} degrees`);
		if (typeof w.conditions === "string") bits.push(w.conditions);
		let clause = bits.join(" and ");
		if (typeof w.high === "number" && typeof w.low === "number") {
			clause += `, with a high of ${Math.round(w.high)} and a low of ${Math.round(w.low)}`;
		}
		return clause ? `${place} is ${clause}` : "";
	} catch {
		return "";
	}
}

function deterministicBriefing(
	greeting: string,
	nowSpoken: string,
	weatherText: string,
	reminders: Reminder[],
	tz: string,
): string {
	const sentences = [`${greeting}. It's ${nowSpoken}.`];
	if (weatherText) sentences.push(`${capitalize(weatherText)}.`);
	if (reminders.length === 0) {
		sentences.push(`Nothing on your reminder list today.`);
	} else if (reminders.length === 1) {
		const r = reminders[0];
		sentences.push(`One reminder: ${r.text}, ${formatSpokenDue(new Date(r.dueAt), tz)}.`);
	} else {
		const items = reminders.map((r) => r.text).join("; ");
		sentences.push(`${reminders.length} reminders today: ${items}.`);
	}
	return sentences.join(" ");
}

async function polish(
	env: Env,
	greeting: string,
	nowSpoken: string,
	weatherText: string,
	remindersText: string,
): Promise<string> {
	const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
	const response = await client.messages.create({
		model: env.JARVIS_MODEL || DEFAULT_MODEL,
		max_tokens: 400,
		thinking: { type: "disabled" },
		system: buildSystemPrompt(persona(env)),
		messages: [
			{
				role: "user",
				content:
					`Give me my briefing as two or three spoken sentences, in character. ` +
					`Open with a brief "${greeting}". Use only these facts, and don't invent anything:\n` +
					`Time: ${nowSpoken}\n` +
					`Weather: ${weatherText || "not available"}\n` +
					`Reminders today: ${remindersText || "none"}`,
			},
		],
	});
	return response.content
		.filter((b): b is Anthropic.TextBlock => b.type === "text")
		.map((b) => b.text)
		.join(" ")
		.trim();
}

function greetingFor(hour: number): string {
	if (hour < 12) return "Good morning";
	if (hour < 18) return "Good afternoon";
	return "Good evening";
}

function capitalize(s: string): string {
	return s ? s[0].toUpperCase() + s.slice(1) : s;
}
