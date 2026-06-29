// Jarvis's hands. This is what turns the assistant from a talking head into an
// agent: a catalog of tools Claude can call mid-turn to actually *do* things —
// tell the real time, check the weather, do exact arithmetic and unit
// conversions, and remember/recall facts and reminders. Every tool runs inside
// the Worker with NO extra API keys, so the whole catalog works on a fresh
// deploy.
//
// Design rules that keep the tool loop safe and snappy:
//   * Executors never throw into the loop — runTool() catches everything and
//     returns an `is_error` tool result the model can recover from.
//   * Tool inputs arrive as `unknown` and are narrowed with hand-written guards.
//   * The only outbound network call (weather) goes through safeFetch, which is
//     locked to the two Open-Meteo hosts (SSRF defense).
//   * Arithmetic uses a hand-written parser, never eval/Function.

import type Anthropic from "@anthropic-ai/sdk";
import { formatSpokenDateTime, formatSpokenDue, safeTimeZone } from "./datetime";
import {
	addReminder,
	cancelReminderById,
	deleteFact,
	getFactValue,
	loadPendingReminders,
	matchPendingReminders,
	searchFacts,
	upsertFact,
	type Fact,
	type Reminder,
} from "./longterm";

/** Everything an executor needs about the current turn. */
export interface ToolContext {
	env: Env;
	sessionId: string;
	/** The wall-clock "now" for this turn — the clock that grounds reminders. */
	now: Date;
	/** Facts already loaded for this session (so tools needn't re-query). */
	facts: Fact[];
}

/** A tool = its Claude-facing schema plus an executor. */
export interface JarvisTool {
	definition: Anthropic.Tool;
	execute(input: unknown, ctx: ToolContext): Promise<string>;
}

/** Result of running a tool, ready to become a `tool_result` block. */
export interface ToolResult {
	content: string;
	isError: boolean;
}

// --------------------------------------------------------------------------- //
// Catalog + dispatch
// --------------------------------------------------------------------------- //

/** The always-on tool catalog. Every tool here works without any API key. */
export function buildToolCatalog(): JarvisTool[] {
	return [
		getTimeTool,
		getWeatherTool,
		rememberFactTool,
		recallFactsTool,
		forgetFactTool,
		setReminderTool,
		listRemindersTool,
		cancelReminderTool,
		doMathTool,
		convertUnitsTool,
	];
}

/**
 * Run one tool by name, never throwing. Any failure becomes an error result the
 * model can read and recover from in a follow-up turn.
 */
export async function runTool(
	catalog: JarvisTool[],
	name: string,
	input: unknown,
	ctx: ToolContext,
): Promise<ToolResult> {
	const tool = catalog.find((t) => t.definition.name === name);
	if (!tool) return { content: `Unknown tool: ${name}.`, isError: true };
	try {
		return { content: await tool.execute(input, ctx), isError: false };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { content: `That didn't work: ${message}`, isError: true };
	}
}

// --------------------------------------------------------------------------- //
// Input-narrowing helpers (ToolUseBlock.input is `unknown`)
// --------------------------------------------------------------------------- //

function asObject(input: unknown): Record<string, unknown> {
	return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}
function optStr(obj: Record<string, unknown>, key: string): string | undefined {
	const v = obj[key];
	return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function reqStr(obj: Record<string, unknown>, key: string): string {
	const v = optStr(obj, key);
	if (v === undefined) throw new Error(`missing "${key}"`);
	return v;
}
function optNum(obj: Record<string, unknown>, key: string): number | undefined {
	const v = obj[key];
	if (typeof v === "number" && Number.isFinite(v)) return v;
	if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
	return undefined;
}

// --------------------------------------------------------------------------- //
// Tool: get_time
// --------------------------------------------------------------------------- //

const getTimeTool: JarvisTool = {
	definition: {
		name: "get_time",
		description:
			"Get the current date and time. Use this to ground anything time-sensitive — what day it is, or to compute a reminder's absolute time from a phrase like 'in 20 minutes' or 'tomorrow at 9'.",
		input_schema: {
			type: "object",
			properties: {
				timezone: {
					type: "string",
					description:
						"IANA timezone, e.g. 'America/Denver'. Omit to use the wearer's saved timezone, else UTC.",
				},
			},
		},
	},
	async execute(input, ctx) {
		const obj = asObject(input);
		const tz = safeTimeZone(
			optStr(obj, "timezone") ??
				getFactValue(ctx.facts, "timezone") ??
				ctx.env.JARVIS_TIMEZONE,
		);
		return JSON.stringify({
			iso: ctx.now.toISOString(),
			spoken: formatSpokenDateTime(ctx.now, tz),
			timezone: tz,
		});
	},
};

// --------------------------------------------------------------------------- //
// Tool: get_weather  (Open-Meteo — keyless)
// --------------------------------------------------------------------------- //

const getWeatherTool: JarvisTool = {
	definition: {
		name: "get_weather",
		description:
			"Get current or near-term weather for a place. Omit location to use the wearer's saved home_location. Keyless.",
		input_schema: {
			type: "object",
			properties: {
				location: {
					type: "string",
					description: "City or place name. Omit to use the saved home_location fact.",
				},
				when: {
					type: "string",
					enum: ["now", "today", "tomorrow"],
					description: "Which forecast to summarise. Defaults to 'now'.",
				},
			},
		},
	},
	async execute(input, ctx) {
		const obj = asObject(input);
		const place = optStr(obj, "location") ?? getFactValue(ctx.facts, "home_location");
		if (!place) {
			return JSON.stringify({
				need: "location",
				message: "No location given and no home_location saved. Ask the wearer where.",
			});
		}
		const when = (optStr(obj, "when") ?? "now") as "now" | "today" | "tomorrow";
		const unitFact = (getFactValue(ctx.facts, "temp_unit") ?? "").toLowerCase();
		const tempUnit = unitFact.startsWith("c") ? "celsius" : "fahrenheit";
		return getWeather(place, when, tempUnit);
	},
};

export async function getWeather(
	place: string,
	when: "now" | "today" | "tomorrow",
	tempUnit: "celsius" | "fahrenheit",
): Promise<string> {
	const first = await geocodePlace(place);
	if (!first) {
		return JSON.stringify({ error: `Couldn't find a place called "${place}".` });
	}
	const { latitude, longitude } = first;
	const label = [first.name, first.admin1, first.country_code]
		.filter(Boolean)
		.join(", ");

	const degree = tempUnit === "celsius" ? "°C" : "°F";
	const fc = await fetchJson(
		`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
			`&current=temperature_2m,weather_code,wind_speed_10m` +
			`&daily=temperature_2m_max,temperature_2m_min,weather_code` +
			`&temperature_unit=${tempUnit}&wind_speed_unit=mph&timezone=auto&forecast_days=2`,
	);

	const current = isObject(fc.current) ? fc.current : {};
	const daily = isObject(fc.daily) ? fc.daily : {};
	const dayIndex = when === "tomorrow" ? 1 : 0;

	const out: Record<string, unknown> = { location: label, when, unit: degree };

	if (when === "now") {
		out.temperature = round1(num(current.temperature_2m));
		out.conditions = wmoPhrase(num(current.weather_code));
		out.wind_mph = round1(num(current.wind_speed_10m));
	}
	const highs = numArray(daily.temperature_2m_max);
	const lows = numArray(daily.temperature_2m_min);
	const codes = numArray(daily.weather_code);
	if (highs[dayIndex] !== undefined) out.high = round1(highs[dayIndex]);
	if (lows[dayIndex] !== undefined) out.low = round1(lows[dayIndex]);
	if (codes[dayIndex] !== undefined && when !== "now") {
		out.conditions = wmoPhrase(codes[dayIndex]);
	}
	return JSON.stringify(out);
}

/**
 * Resolve a place name to coordinates, tolerant of natural phrasing. Open-Meteo's
 * geocoder matches bare city names, so "American Fork Utah" or "Provo, UT" miss;
 * we retry with progressively simpler queries until one resolves.
 */
async function geocodePlace(
	place: string,
): Promise<ReturnType<typeof firstResult>> {
	for (const name of geocodeCandidates(place)) {
		const geo = await fetchJson(
			`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
				name,
			)}&count=1&language=en&format=json`,
		);
		const first = firstResult(geo);
		if (first) return first;
	}
	return undefined;
}

/**
 * Progressively-simpler geocoder queries: the full string first (so clean names
 * like "New York" resolve on the first try and never get truncated), then the
 * part before a comma, then the string minus its last word (usually a US state).
 * Deduplicated and capped so a lookup is at most a few requests.
 */
export function geocodeCandidates(place: string): string[] {
	const trimmed = place.trim();
	const candidates = [trimmed];
	if (trimmed.includes(",")) {
		const beforeComma = trimmed.split(",")[0].trim();
		if (beforeComma) candidates.push(beforeComma);
	}
	const words = trimmed.split(/\s+/);
	if (words.length > 1) candidates.push(words.slice(0, -1).join(" "));
	return [...new Set(candidates.filter(Boolean))].slice(0, 3);
}

// --------------------------------------------------------------------------- //
// Tool: remember_fact / recall_facts / forget_fact
// --------------------------------------------------------------------------- //

const FACT_CATEGORY_ENUM = [
	"identity",
	"preference",
	"location",
	"relationship",
	"schedule",
	"other",
];

const rememberFactTool: JarvisTool = {
	definition: {
		name: "remember_fact",
		description:
			"Durably remember one fact about the wearer across sessions (name, home_location, timezone, coffee_order, a preference, a relationship). Use a short snake_case key. Calling again with the same key updates it. Remember quietly; don't announce it.",
		input_schema: {
			type: "object",
			properties: {
				key: { type: "string", description: "Short snake_case slug, e.g. home_location." },
				value: { type: "string", description: "The fact in plain words." },
				category: { type: "string", enum: FACT_CATEGORY_ENUM },
			},
			required: ["key", "value"],
		},
	},
	async execute(input, ctx) {
		const obj = asObject(input);
		const key = reqStr(obj, "key");
		const value = reqStr(obj, "value");
		const category = optStr(obj, "category") ?? "other";
		await upsertFact(ctx.env.DB, ctx.sessionId, key, value, category);
		return JSON.stringify({ ok: true, stored: key });
	},
};

const recallFactsTool: JarvisTool = {
	definition: {
		name: "recall_facts",
		description:
			"Search your durable memory of the wearer. Most facts are already provided to you each turn; use this only to dig up something older or more specific.",
		input_schema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Keyword to match against fact keys/values." },
				category: { type: "string", enum: FACT_CATEGORY_ENUM },
			},
		},
	},
	async execute(input, ctx) {
		const obj = asObject(input);
		const facts = await searchFacts(
			ctx.env.DB,
			ctx.sessionId,
			optStr(obj, "query"),
			optStr(obj, "category"),
		);
		return JSON.stringify({ facts: facts.map((f) => ({ key: f.key, value: f.value })) });
	},
};

const forgetFactTool: JarvisTool = {
	definition: {
		name: "forget_fact",
		description: "Delete one durable fact by its key. Use when the wearer asks you to forget or correct something.",
		input_schema: {
			type: "object",
			properties: { key: { type: "string", description: "The fact slug to delete." } },
			required: ["key"],
		},
	},
	async execute(input, ctx) {
		const key = reqStr(asObject(input), "key");
		const deleted = await deleteFact(ctx.env.DB, ctx.sessionId, key);
		return JSON.stringify({ ok: true, deleted });
	},
};

// --------------------------------------------------------------------------- //
// Tool: set_reminder / list_reminders / cancel_reminder
// --------------------------------------------------------------------------- //

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const setReminderTool: JarvisTool = {
	definition: {
		name: "set_reminder",
		description:
			"Set a one-shot reminder. Compute due_at as an absolute UTC instant from get_time plus the wearer's phrasing. Reminders surface next time you talk and are pushed proactively only if WhatsApp delivery is configured — so don't promise an alarm.",
		input_schema: {
			type: "object",
			properties: {
				text: { type: "string", description: "What to remind about, in the wearer's framing." },
				due_at: {
					type: "string",
					description: "Absolute ISO-8601 UTC instant, e.g. 2026-06-29T21:00:00Z.",
				},
			},
			required: ["text", "due_at"],
		},
	},
	async execute(input, ctx) {
		const obj = asObject(input);
		const text = reqStr(obj, "text");
		const dueRaw = reqStr(obj, "due_at");
		const due = new Date(dueRaw);
		const ms = due.getTime();
		if (!Number.isFinite(ms)) {
			throw new Error(`couldn't parse due_at "${dueRaw}" as a date`);
		}
		if (ms < ctx.now.getTime() - 60_000) {
			throw new Error("that time is in the past");
		}
		if (ms > ctx.now.getTime() + ONE_YEAR_MS) {
			throw new Error("that's more than a year out");
		}
		const tz = safeTimeZone(getFactValue(ctx.facts, "timezone") ?? ctx.env.JARVIS_TIMEZONE);
		const id = await addReminder(ctx.env.DB, ctx.sessionId, text, due.toISOString());
		const pushable = Boolean(ctx.env.WHATSAPP_TOKEN && ctx.env.WHATSAPP_PHONE_NUMBER_ID);
		return JSON.stringify({
			ok: true,
			id,
			spoken_due: formatSpokenDue(due, tz),
			delivery: pushable
				? "I'll message you when it's due."
				: "I'll bring it up next time we talk.",
		});
	},
};

const listRemindersTool: JarvisTool = {
	definition: {
		name: "list_reminders",
		description: "List the wearer's pending reminders.",
		input_schema: {
			type: "object",
			properties: {
				window: { type: "string", enum: ["due", "today", "upcoming", "all"] },
			},
		},
	},
	async execute(input, ctx) {
		const window = (optStr(asObject(input), "window") ?? "today") as
			| "due"
			| "today"
			| "upcoming"
			| "all";
		const tz = safeTimeZone(getFactValue(ctx.facts, "timezone") ?? ctx.env.JARVIS_TIMEZONE);
		const pending = await loadPendingReminders(ctx.env.DB, ctx.sessionId);
		const filtered = filterRemindersByWindow(pending, window, ctx.now, tz);
		return JSON.stringify({
			window,
			reminders: filtered.map((r) => ({
				id: r.id,
				text: r.text,
				due: formatSpokenDue(new Date(r.dueAt), tz),
			})),
		});
	},
};

const cancelReminderTool: JarvisTool = {
	definition: {
		name: "cancel_reminder",
		description:
			"Cancel a pending reminder by id (preferred) or by fuzzy text match. If several match the text, you'll get candidates to disambiguate.",
		input_schema: {
			type: "object",
			properties: {
				id: { type: "integer", description: "Reminder id from list_reminders or set_reminder." },
				match: { type: "string", description: "Alternative: fuzzy text of the reminder to cancel." },
			},
		},
	},
	async execute(input, ctx) {
		const obj = asObject(input);
		const id = optNum(obj, "id");
		if (id !== undefined) {
			const cancelled = await cancelReminderById(ctx.env.DB, ctx.sessionId, Math.trunc(id));
			return JSON.stringify({ cancelled });
		}
		const match = optStr(obj, "match");
		if (!match) throw new Error("give me an id or some text to match");
		const hits = await matchPendingReminders(ctx.env.DB, ctx.sessionId, match);
		if (hits.length === 0) return JSON.stringify({ cancelled: false, reason: "no match" });
		if (hits.length > 1) {
			return JSON.stringify({
				cancelled: false,
				candidates: hits.map((r) => ({ id: r.id, text: r.text })),
			});
		}
		const cancelled = await cancelReminderById(ctx.env.DB, ctx.sessionId, hits[0].id);
		return JSON.stringify({ cancelled, text: hits[0].text });
	},
};

/** Bucket pending reminders into the requested window using the session tz. */
export function filterRemindersByWindow(
	reminders: Reminder[],
	window: "due" | "today" | "upcoming" | "all",
	now: Date,
	tz: string,
): Reminder[] {
	if (window === "all") return reminders;
	const nowMs = now.getTime();
	const todayStr = new Intl.DateTimeFormat("en-CA", {
		timeZone: tz,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(now);
	return reminders.filter((r) => {
		const dueMs = new Date(r.dueAt).getTime();
		if (window === "due") return dueMs <= nowMs;
		if (window === "upcoming") return dueMs > nowMs;
		// "today": due on the same local calendar day, or already overdue.
		if (dueMs <= nowMs) return true;
		const dueStr = new Intl.DateTimeFormat("en-CA", {
			timeZone: tz,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).format(new Date(r.dueAt));
		return dueStr === todayStr;
	});
}

// --------------------------------------------------------------------------- //
// Tool: do_math  (hand-written parser — never eval)
// --------------------------------------------------------------------------- //

const doMathTool: JarvisTool = {
	definition: {
		name: "do_math",
		description:
			"Evaluate an arithmetic expression exactly: + - * / ^, parentheses, sqrt/abs/round/floor/ceil, pi, and percentages ('18% of 64.50', '20% off 80').",
		input_schema: {
			type: "object",
			properties: { expression: { type: "string", description: "e.g. (1280*3)/12, sqrt(2), 18% of 64.50" } },
			required: ["expression"],
		},
	},
	async execute(input) {
		const expression = reqStr(asObject(input), "expression");
		const result = evalMath(expression);
		return JSON.stringify({ expression, result, formatted: formatNumber(result) });
	},
};

/** Evaluate a small arithmetic grammar. No eval/Function — that would be RCE. */
export function evalMath(raw: string): number {
	if (raw.length > 200) throw new Error("expression too long");
	let s = raw.toLowerCase().trim();
	s = s.replace(/×/g, "*").replace(/÷/g, "/");
	// "<A>% off <B>"  ->  B reduced by A percent.
	s = s.replace(
		/([0-9]*\.?[0-9]+)\s*%\s*off\s+([0-9]*\.?[0-9]+)/g,
		(_m, a: string, b: string) => `(${b} - ${b}*${a}/100)`,
	);
	// "of" reads as multiplication ("18% of 64.50" -> "0.18 * 64.50").
	s = s.replace(/\bof\b/g, "*");

	const tokens = tokenizeMath(s);
	const parser = new MathParser(tokens);
	const value = parser.parseExpression();
	parser.expectEnd();
	if (!Number.isFinite(value)) throw new Error("that doesn't come out to a finite number");
	return value;
}

type MathTok =
	| { k: "num"; v: number }
	| { k: "op"; v: "+" | "-" | "*" | "/" | "^" }
	| { k: "("; }
	| { k: ")"; }
	| { k: "fn"; v: string };

function tokenizeMath(s: string): MathTok[] {
	const toks: MathTok[] = [];
	const isDigit = (c: string) => c >= "0" && c <= "9";
	let i = 0;
	while (i < s.length) {
		const c = s[i];
		if (c === " " || c === "\t" || c === ",") {
			i++;
			continue;
		}
		if (isDigit(c) || (c === "." && isDigit(s[i + 1] ?? ""))) {
			let j = i + 1;
			while (j < s.length && (isDigit(s[j]) || s[j] === ".")) j++;
			const slice = s.slice(i, j);
			// parseFloat would silently accept "1.2.3" as 1.2; reject malformed
			// numbers outright so an exact-arithmetic tool never returns a wrong
			// answer for a typo.
			if (!/^[0-9]*\.?[0-9]+$/.test(slice)) throw new Error(`bad number "${slice}"`);
			let value = parseFloat(slice);
			if (!Number.isFinite(value)) throw new Error(`bad number near "${slice}"`);
			i = j;
			if (s[i] === "%") {
				value = value / 100;
				i++;
			}
			toks.push({ k: "num", v: value });
			continue;
		}
		if (c >= "a" && c <= "z") {
			let j = i + 1;
			while (j < s.length && s[j] >= "a" && s[j] <= "z") j++;
			const word = s.slice(i, j);
			i = j;
			if (word === "pi") {
				toks.push({ k: "num", v: Math.PI });
			} else if (["sqrt", "abs", "round", "floor", "ceil"].includes(word)) {
				toks.push({ k: "fn", v: word });
			} else {
				throw new Error(`I don't recognise "${word}" in that expression`);
			}
			continue;
		}
		if (c === "+" || c === "-" || c === "*" || c === "/" || c === "^") {
			toks.push({ k: "op", v: c });
			i++;
			continue;
		}
		if (c === "(") {
			toks.push({ k: "(" });
			i++;
			continue;
		}
		if (c === ")") {
			toks.push({ k: ")" });
			i++;
			continue;
		}
		throw new Error(`unexpected character "${c}"`);
	}
	return toks;
}

class MathParser {
	private pos = 0;
	constructor(private readonly toks: MathTok[]) {}

	private peek(): MathTok | undefined {
		return this.toks[this.pos];
	}
	private next(): MathTok | undefined {
		return this.toks[this.pos++];
	}
	expectEnd(): void {
		if (this.pos !== this.toks.length) throw new Error("unexpected trailing input");
	}

	parseExpression(): number {
		return this.parseAddSub();
	}
	private parseAddSub(): number {
		let v = this.parseMulDiv();
		for (;;) {
			const t = this.peek();
			if (t && t.k === "op" && (t.v === "+" || t.v === "-")) {
				this.next();
				const r = this.parseMulDiv();
				v = t.v === "+" ? v + r : v - r;
			} else break;
		}
		return v;
	}
	private parseMulDiv(): number {
		let v = this.parsePower();
		for (;;) {
			const t = this.peek();
			if (t && t.k === "op" && (t.v === "*" || t.v === "/")) {
				this.next();
				const r = this.parsePower();
				if (t.v === "/") {
					if (r === 0) throw new Error("division by zero");
					v = v / r;
				} else {
					v = v * r;
				}
			} else break;
		}
		return v;
	}
	private parsePower(): number {
		const base = this.parseUnary();
		const t = this.peek();
		if (t && t.k === "op" && t.v === "^") {
			this.next();
			const exp = this.parsePower(); // right-associative
			return Math.pow(base, exp);
		}
		return base;
	}
	private parseUnary(): number {
		const t = this.peek();
		if (t && t.k === "op" && t.v === "-") {
			this.next();
			return -this.parseUnary();
		}
		if (t && t.k === "op" && t.v === "+") {
			this.next();
			return this.parseUnary();
		}
		return this.parsePrimary();
	}
	private parsePrimary(): number {
		const t = this.next();
		if (!t) throw new Error("unexpected end of expression");
		if (t.k === "num") return t.v;
		if (t.k === "fn") {
			let arg: number;
			if (this.peek()?.k === "(") {
				this.next();
				arg = this.parseExpression();
				if (this.next()?.k !== ")") throw new Error("expected )");
			} else {
				arg = this.parseUnary();
			}
			switch (t.v) {
				case "sqrt":
					if (arg < 0) throw new Error("can't take the square root of a negative");
					return Math.sqrt(arg);
				case "abs":
					return Math.abs(arg);
				case "round":
					return Math.round(arg);
				case "floor":
					return Math.floor(arg);
				case "ceil":
					return Math.ceil(arg);
				default:
					throw new Error(`unknown function ${t.v}`);
			}
		}
		if (t.k === "(") {
			const v = this.parseExpression();
			if (this.next()?.k !== ")") throw new Error("expected )");
			return v;
		}
		throw new Error("unexpected token");
	}
}

/**
 * Render a number the way a person would say it: plain digits, never scientific
 * notation, with enough precision that small magnitudes don't collapse to "0".
 * (This is read aloud, so "0.000000025" beats "2.5e-8".)
 */
export function formatNumber(n: number): string {
	if (!Number.isFinite(n)) throw new Error("that isn't a finite number");
	if (n === 0) return "0";
	const abs = Math.abs(n);
	// Keep ~10 significant fractional digits, but extend for very small numbers so
	// e.g. 1e-12 stays "0.000000000001" instead of rounding away to 0.
	const fractionDigits =
		abs < 1 ? Math.min(20, Math.max(10, Math.ceil(-Math.log10(abs)) + 4)) : 10;
	return n.toLocaleString("en-US", {
		useGrouping: false,
		maximumFractionDigits: fractionDigits,
	});
}

// --------------------------------------------------------------------------- //
// Tool: convert_units  (static tables — no network, no key)
// --------------------------------------------------------------------------- //

const convertUnitsTool: JarvisTool = {
	definition: {
		name: "convert_units",
		description:
			"Convert a value between units of the same kind: length, mass, volume, speed, data, time, or temperature (C/F/K).",
		input_schema: {
			type: "object",
			properties: {
				value: { type: "number" },
				from: { type: "string", description: "Source unit, e.g. miles, kg, celsius." },
				to: { type: "string", description: "Target unit, e.g. km, lb, fahrenheit." },
			},
			required: ["value", "from", "to"],
		},
	},
	async execute(input) {
		const obj = asObject(input);
		const value = optNum(obj, "value");
		if (value === undefined) throw new Error('missing numeric "value"');
		const from = reqStr(obj, "from");
		const to = reqStr(obj, "to");
		const result = convertUnits(value, from, to);
		return JSON.stringify({ value, from, to, result, formatted: formatNumber(result) });
	},
};

interface UnitDef {
	dim: string;
	/** Multiply a value in this unit by `factor` to get the dimension's base unit. */
	factor: number;
}

const UNIT_TABLE: Map<string, UnitDef> = (() => {
	const table = new Map<string, UnitDef>();
	const add = (dim: string, factor: number, ...names: string[]) => {
		for (const n of names) table.set(n, { dim, factor });
	};
	// length (base: metre)
	add("length", 1, "m", "meter", "meters", "metre", "metres");
	add("length", 1000, "km", "kilometer", "kilometers", "kilometre", "kilometres");
	add("length", 0.01, "cm", "centimeter", "centimeters", "centimetre", "centimetres");
	add("length", 0.001, "mm", "millimeter", "millimeters");
	add("length", 1609.344, "mi", "mile", "miles");
	add("length", 0.9144, "yd", "yard", "yards");
	add("length", 0.3048, "ft", "foot", "feet");
	add("length", 0.0254, "in", "inch", "inches");
	add("length", 1852, "nmi", "nauticalmile", "nauticalmiles");
	// mass (base: gram)
	add("mass", 1, "g", "gram", "grams");
	add("mass", 1000, "kg", "kilogram", "kilograms");
	add("mass", 0.001, "mg", "milligram", "milligrams");
	add("mass", 453.59237, "lb", "lbs", "pound", "pounds");
	add("mass", 28.349523125, "oz", "ounce", "ounces");
	add("mass", 6350.29318, "st", "stone", "stones");
	add("mass", 1_000_000, "t", "tonne", "tonnes", "metricton");
	// volume (base: litre)
	add("volume", 1, "l", "liter", "liters", "litre", "litres");
	add("volume", 0.001, "ml", "milliliter", "milliliters", "millilitre", "millilitres");
	add("volume", 3.785411784, "gal", "gallon", "gallons");
	add("volume", 0.946352946, "qt", "quart", "quarts");
	add("volume", 0.473176473, "pt", "pint", "pints");
	add("volume", 0.2365882365, "cup", "cups");
	add("volume", 0.0295735295625, "floz", "fluidounce", "fluidounces");
	add("volume", 0.01478676478, "tbsp", "tablespoon", "tablespoons");
	add("volume", 0.00492892159, "tsp", "teaspoon", "teaspoons");
	// speed (base: m/s)
	add("speed", 1, "mps");
	add("speed", 0.277777778, "kmh", "kph", "km/h");
	add("speed", 0.44704, "mph");
	add("speed", 0.514444, "knot", "knots", "kn", "kt");
	add("speed", 0.3048, "fps");
	// data (base: byte, decimal)
	add("data", 1, "byte", "bytes");
	add("data", 1e3, "kb", "kilobyte", "kilobytes");
	add("data", 1e6, "mb", "megabyte", "megabytes");
	add("data", 1e9, "gb", "gigabyte", "gigabytes");
	add("data", 1e12, "tb", "terabyte", "terabytes");
	add("data", 1024, "kib", "kibibyte", "kibibytes");
	add("data", 1048576, "mib", "mebibyte", "mebibytes");
	add("data", 1073741824, "gib", "gibibyte", "gibibytes");
	// time (base: second)
	add("time", 1, "s", "sec", "secs", "second", "seconds");
	add("time", 60, "min", "mins", "minute", "minutes");
	add("time", 3600, "h", "hr", "hrs", "hour", "hours");
	add("time", 86400, "day", "days");
	add("time", 604800, "week", "weeks");
	return table;
})();

const TEMP_ALIASES: Record<string, "c" | "f" | "k"> = {
	c: "c",
	celsius: "c",
	centigrade: "c",
	f: "f",
	fahrenheit: "f",
	k: "k",
	kelvin: "k",
};

export function convertUnits(value: number, from: string, to: string): number {
	const f = normUnit(from);
	const t = normUnit(to);
	if (TEMP_ALIASES[f] && TEMP_ALIASES[t]) {
		return fromCelsius(toCelsius(value, TEMP_ALIASES[f]), TEMP_ALIASES[t]);
	}
	const fe = UNIT_TABLE.get(f);
	const te = UNIT_TABLE.get(t);
	if (!fe) throw new Error(`I don't know the unit "${from}"`);
	if (!te) throw new Error(`I don't know the unit "${to}"`);
	if (fe.dim !== te.dim) {
		throw new Error(`can't convert ${from} (${fe.dim}) to ${to} (${te.dim})`);
	}
	return (value * fe.factor) / te.factor;
}

function normUnit(u: string): string {
	return u.trim().toLowerCase().replace(/\.$/, "").replace(/\s+/g, "");
}
function toCelsius(v: number, unit: "c" | "f" | "k"): number {
	return unit === "c" ? v : unit === "f" ? ((v - 32) * 5) / 9 : v - 273.15;
}
function fromCelsius(c: number, unit: "c" | "f" | "k"): number {
	return unit === "c" ? c : unit === "f" ? (c * 9) / 5 + 32 : c + 273.15;
}

// --------------------------------------------------------------------------- //
// Outbound fetch (SSRF-hardened) + small parsing helpers
// --------------------------------------------------------------------------- //

/** The only hosts Jarvis is ever allowed to reach out to. */
const ALLOWED_HOSTS = new Set([
	"geocoding-api.open-meteo.com",
	"api.open-meteo.com",
]);

/**
 * A locked-down fetch: https-only, hostname allowlist, no credentials/ports/IP
 * literals, a hard timeout, and a response-size cap. The weather location is
 * always a query parameter, never the host, so it can't steer the request.
 */
export async function safeFetch(rawUrl: string, timeoutMs = 4000): Promise<string> {
	const url = new URL(rawUrl);
	if (url.protocol !== "https:") throw new Error("only https is allowed");
	if (url.username || url.password) throw new Error("credentials in URL not allowed");
	if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error(`host not allowed: ${url.hostname}`);
	if (url.port && url.port !== "443") throw new Error("non-default port not allowed");
	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.includes(":")) {
		throw new Error("IP-literal host not allowed");
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url.toString(), {
			signal: controller.signal,
			headers: { accept: "application/json" },
			// Don't auto-follow redirects: a 3xx could point off the allowlist. Any
			// redirect is non-2xx, so the !res.ok check below rejects it.
			redirect: "manual",
		});
		if (!res.ok) throw new Error(`weather service returned ${res.status}`);
		const body = await res.text();
		if (body.length > 256 * 1024) throw new Error("weather response too large");
		return body;
	} finally {
		clearTimeout(timer);
	}
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
	const body = await safeFetch(url);
	try {
		const parsed = JSON.parse(body);
		return isObject(parsed) ? parsed : {};
	} catch {
		throw new Error("couldn't read the weather service response");
	}
}

function firstResult(
	geo: Record<string, unknown>,
): { latitude: number; longitude: number; name?: string; admin1?: string; country_code?: string } | undefined {
	const results = geo.results;
	if (!Array.isArray(results) || results.length === 0) return undefined;
	const r = results[0];
	if (!isObject(r)) return undefined;
	const latitude = num(r.latitude);
	const longitude = num(r.longitude);
	if (latitude === undefined || longitude === undefined) return undefined;
	return {
		latitude,
		longitude,
		name: typeof r.name === "string" ? r.name : undefined,
		admin1: typeof r.admin1 === "string" ? r.admin1 : undefined,
		country_code: typeof r.country_code === "string" ? r.country_code : undefined,
	};
}

function isObject(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === "object" && !Array.isArray(v);
}
function num(v: unknown): number | undefined {
	return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function numArray(v: unknown): Array<number | undefined> {
	return Array.isArray(v) ? v.map(num) : [];
}
function round1(v: number | undefined): number | undefined {
	return v === undefined ? undefined : Math.round(v * 10) / 10;
}

/** WMO weather interpretation codes -> a phrase a person would say. */
function wmoPhrase(code: number | undefined): string {
	switch (code) {
		case 0:
			return "clear";
		case 1:
			return "mainly clear";
		case 2:
			return "partly cloudy";
		case 3:
			return "overcast";
		case 45:
		case 48:
			return "foggy";
		case 51:
		case 53:
		case 55:
			return "drizzle";
		case 56:
		case 57:
			return "freezing drizzle";
		case 61:
			return "light rain";
		case 63:
			return "rain";
		case 65:
			return "heavy rain";
		case 66:
		case 67:
			return "freezing rain";
		case 71:
			return "light snow";
		case 73:
			return "snow";
		case 75:
			return "heavy snow";
		case 77:
			return "snow grains";
		case 80:
		case 81:
		case 82:
			return "rain showers";
		case 85:
		case 86:
			return "snow showers";
		case 95:
			return "thunderstorms";
		case 96:
		case 99:
			return "thunderstorms with hail";
		default:
			return "unsettled";
	}
}
