// Long-term memory for Jarvis: the wearer's "dossier" of durable facts, one-shot
// reminders, and the daily-briefing ledger. Everything here is backed by D1 and
// strictly session-scoped, with parameterized queries throughout (no string
// interpolation into SQL). This is the layer that lets Jarvis *know you* across
// sessions and *speak first*, not just answer one turn at a time.

export interface Fact {
	key: string;
	value: string;
	category: string;
}

export interface Reminder {
	id: number;
	text: string;
	/** Absolute due instant, ISO-8601 UTC. */
	dueAt: string;
}

// --- Bounds. Keeping memory small keeps prompts cheap and latency low. ---

/** Longest a fact key may be (clamped, not rejected). */
const MAX_KEY_LEN = 64;
/** Longest a fact value may be. */
const MAX_VALUE_LEN = 512;
/** Hard ceiling on stored facts per session; oldest are evicted past this. */
const MAX_FACTS_PER_SESSION = 200;
/** Longest reminder text. */
const MAX_REMINDER_LEN = 256;
/** Hard ceiling on pending reminders per session. */
const MAX_PENDING_REMINDERS = 100;

const FACT_CATEGORIES = new Set([
	"identity",
	"preference",
	"location",
	"relationship",
	"schedule",
	"other",
]);

// --------------------------------------------------------------------------- //
// Facts
// --------------------------------------------------------------------------- //

/** Most-recently-updated facts for a session, newest first. */
export async function loadFacts(
	db: D1Database,
	sessionId: string,
	limit = 40,
): Promise<Fact[]> {
	const { results } = await db
		.prepare(
			`SELECT fact_key AS key, fact_value AS value, category
			 FROM jarvis_facts
			 WHERE session_id = ?
			 ORDER BY updated_at DESC, id DESC
			 LIMIT ?`,
		)
		.bind(sessionId, limit)
		.all<Fact>();
	return results ?? [];
}

/**
 * Remember (or update) one durable fact. Idempotent upsert keyed by
 * (session_id, fact_key). Clamps oversized input and evicts the oldest facts
 * once the per-session ceiling is exceeded.
 */
export async function upsertFact(
	db: D1Database,
	sessionId: string,
	key: string,
	value: string,
	category = "other",
): Promise<void> {
	const k = key.trim().slice(0, MAX_KEY_LEN);
	const v = value.trim().slice(0, MAX_VALUE_LEN);
	const cat = FACT_CATEGORIES.has(category) ? category : "other";
	if (!k || !v) throw new Error("A fact needs both a key and a value.");

	await db
		.prepare(
			`INSERT INTO jarvis_facts (session_id, fact_key, fact_value, category)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT (session_id, fact_key)
			 DO UPDATE SET fact_value = excluded.fact_value,
			               category   = excluded.category,
			               updated_at = datetime('now')`,
		)
		.bind(sessionId, k, v, cat)
		.run();

	// Evict the oldest beyond the ceiling so a session can't grow without bound.
	await db
		.prepare(
			`DELETE FROM jarvis_facts
			 WHERE session_id = ?
			   AND id NOT IN (
			     SELECT id FROM jarvis_facts
			     WHERE session_id = ?
			     ORDER BY updated_at DESC, id DESC
			     LIMIT ?
			   )`,
		)
		.bind(sessionId, sessionId, MAX_FACTS_PER_SESSION)
		.run();
}

/** Delete one fact by key. Returns how many rows were removed (0 or 1). */
export async function deleteFact(
	db: D1Database,
	sessionId: string,
	key: string,
): Promise<number> {
	const res = await db
		.prepare(`DELETE FROM jarvis_facts WHERE session_id = ? AND fact_key = ?`)
		.bind(sessionId, key.trim().slice(0, MAX_KEY_LEN))
		.run();
	return res.meta.changes ?? 0;
}

/** Keyword search over a session's facts (key or value), newest first. */
export async function searchFacts(
	db: D1Database,
	sessionId: string,
	query?: string,
	category?: string,
): Promise<Fact[]> {
	const q = query?.trim();
	const like = q ? `%${escapeLike(q)}%` : null;
	const cat = category?.trim() || null;

	const { results } = await db
		.prepare(
			`SELECT fact_key AS key, fact_value AS value, category
			 FROM jarvis_facts
			 WHERE session_id = ?
			   AND (?2 IS NULL OR fact_key LIKE ?2 ESCAPE '\\' OR fact_value LIKE ?2 ESCAPE '\\')
			   AND (?3 IS NULL OR category = ?3)
			 ORDER BY updated_at DESC, id DESC
			 LIMIT 20`,
		)
		.bind(sessionId, like, cat)
		.all<Fact>();
	return results ?? [];
}

/** Forget everything Jarvis knows about a session (the privacy command). */
export async function clearFacts(
	db: D1Database,
	sessionId: string,
): Promise<void> {
	await db
		.prepare(`DELETE FROM jarvis_facts WHERE session_id = ?`)
		.bind(sessionId)
		.run();
}

/** Read a single fact value out of an already-loaded list (no extra query). */
export function getFactValue(facts: Fact[], key: string): string | undefined {
	return facts.find((f) => f.key === key)?.value;
}

/**
 * Render facts as a compact, clearly-fenced reference block for the system
 * prompt. Deliberately labelled as data — the persona prompt instructs the model
 * to treat it as reference, never as instructions (prompt-injection defense).
 */
export function formatFactsForPrompt(facts: Fact[]): string {
	if (facts.length === 0) return "";
	return facts.map((f) => `- ${f.key}: ${f.value}`).join("\n");
}

// --------------------------------------------------------------------------- //
// Reminders
// --------------------------------------------------------------------------- //

/** Store a one-shot reminder. `dueAtUtc` must already be a valid ISO instant. */
export async function addReminder(
	db: D1Database,
	sessionId: string,
	text: string,
	dueAtUtc: string,
): Promise<number> {
	const pending = await countPendingReminders(db, sessionId);
	if (pending >= MAX_PENDING_REMINDERS) {
		throw new Error(
			`You already have ${pending} reminders pending; clear some before adding more.`,
		);
	}
	const res = await db
		.prepare(
			`INSERT INTO jarvis_reminders (session_id, text, due_at_utc)
			 VALUES (?, ?, ?)`,
		)
		.bind(sessionId, text.trim().slice(0, MAX_REMINDER_LEN), dueAtUtc)
		.run();
	return Number(res.meta.last_row_id ?? 0);
}

async function countPendingReminders(
	db: D1Database,
	sessionId: string,
): Promise<number> {
	const row = await db
		.prepare(
			`SELECT COUNT(*) AS n FROM jarvis_reminders
			 WHERE session_id = ? AND fired_at IS NULL`,
		)
		.bind(sessionId)
		.first<{ n: number }>();
	return row?.n ?? 0;
}

/** All pending reminders for a session, soonest first. */
export async function loadPendingReminders(
	db: D1Database,
	sessionId: string,
): Promise<Reminder[]> {
	const { results } = await db
		.prepare(
			`SELECT id, text, due_at_utc AS dueAt
			 FROM jarvis_reminders
			 WHERE session_id = ? AND fired_at IS NULL
			 ORDER BY due_at_utc ASC, id ASC`,
		)
		.bind(sessionId)
		.all<Reminder>();
	return results ?? [];
}

/** Pending reminders already due as of `now`. */
export async function dueReminders(
	db: D1Database,
	sessionId: string,
	now: Date,
): Promise<Reminder[]> {
	const { results } = await db
		.prepare(
			`SELECT id, text, due_at_utc AS dueAt
			 FROM jarvis_reminders
			 WHERE session_id = ? AND fired_at IS NULL AND due_at_utc <= ?
			 ORDER BY due_at_utc ASC, id ASC`,
		)
		.bind(sessionId, now.toISOString())
		.all<Reminder>();
	return results ?? [];
}

/**
 * Atomically mark a reminder fired, but only if still pending. Returns true if
 * this call is the one that flipped it (at-most-once delivery for the cron
 * sweep). `id` is bound, so concurrent ticks can't double-send.
 */
export async function markReminderFired(
	db: D1Database,
	sessionId: string,
	id: number,
): Promise<boolean> {
	const res = await db
		.prepare(
			`UPDATE jarvis_reminders
			 SET fired_at = datetime('now')
			 WHERE id = ? AND session_id = ? AND fired_at IS NULL`,
		)
		.bind(id, sessionId)
		.run();
	return (res.meta.changes ?? 0) > 0;
}

/** Cancel a pending reminder by id. Returns true if one was cancelled. */
export async function cancelReminderById(
	db: D1Database,
	sessionId: string,
	id: number,
): Promise<boolean> {
	const res = await db
		.prepare(
			`UPDATE jarvis_reminders SET fired_at = datetime('now')
			 WHERE id = ? AND session_id = ? AND fired_at IS NULL`,
		)
		.bind(id, sessionId)
		.run();
	return (res.meta.changes ?? 0) > 0;
}

/** Find pending reminders whose text matches a fuzzy substring. */
export async function matchPendingReminders(
	db: D1Database,
	sessionId: string,
	match: string,
): Promise<Reminder[]> {
	const { results } = await db
		.prepare(
			`SELECT id, text, due_at_utc AS dueAt
			 FROM jarvis_reminders
			 WHERE session_id = ? AND fired_at IS NULL
			   AND text LIKE ? ESCAPE '\\'
			 ORDER BY due_at_utc ASC, id ASC`,
		)
		.bind(sessionId, `%${escapeLike(match.trim())}%`)
		.all<Reminder>();
	return results ?? [];
}

/** Drop every reminder for a session (used by the privacy command). */
export async function clearReminders(
	db: D1Database,
	sessionId: string,
): Promise<void> {
	await db
		.prepare(`DELETE FROM jarvis_reminders WHERE session_id = ?`)
		.bind(sessionId)
		.run();
}

/** Distinct sessions that currently have at least one due, pending reminder. */
export async function sessionsWithDueReminders(
	db: D1Database,
	now: Date,
): Promise<string[]> {
	const { results } = await db
		.prepare(
			`SELECT DISTINCT session_id AS sessionId
			 FROM jarvis_reminders
			 WHERE fired_at IS NULL AND due_at_utc <= ?
			 LIMIT 500`,
		)
		.bind(now.toISOString())
		.all<{ sessionId: string }>();
	return (results ?? []).map((r) => r.sessionId);
}

// --------------------------------------------------------------------------- //
// Daily-briefing ledger
// --------------------------------------------------------------------------- //

/** Sessions that have opted into a proactive daily briefing, with the hour. */
export async function sessionsWithBriefingHour(
	db: D1Database,
): Promise<Array<{ sessionId: string; hour: string }>> {
	const { results } = await db
		.prepare(
			`SELECT session_id AS sessionId, fact_value AS hour
			 FROM jarvis_facts
			 WHERE fact_key = 'briefing_hour'
			 LIMIT 500`,
		)
		.all<{ sessionId: string; hour: string }>();
	return results ?? [];
}

/** Record that today's briefing went out (idempotent on the PRIMARY KEY). */
export async function markBriefingSent(
	db: D1Database,
	sessionId: string,
	ymd: string,
): Promise<boolean> {
	const res = await db
		.prepare(
			`INSERT OR IGNORE INTO briefings_sent (session_id, ymd) VALUES (?, ?)`,
		)
		.bind(sessionId, ymd)
		.run();
	// changes === 1 means we won the race and should actually send.
	return (res.meta.changes ?? 0) > 0;
}

// --------------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------------- //

/** Escape LIKE wildcards in user input so they're treated literally. */
function escapeLike(s: string): string {
	return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
