// Short-term conversational memory backed by the existing D1 database.
//
// Each spoken turn is one row. We key rows by a session id (a phone number for
// the WhatsApp bridge, or a caller-supplied id for the JSON endpoint) so that
// several people — or several devices — can talk to Jarvis without their
// conversations bleeding together.

export interface Turn {
	role: "user" | "assistant";
	content: string;
}

/** How many recent turns to feed back to the model as context. */
const HISTORY_LIMIT = 20;

export async function loadHistory(
	db: D1Database,
	sessionId: string,
): Promise<Turn[]> {
	// Pull the most recent turns, then flip back into chronological order.
	const { results } = await db
		.prepare(
			`SELECT role, content FROM jarvis_turns
			 WHERE session_id = ?
			 ORDER BY id DESC
			 LIMIT ?`,
		)
		.bind(sessionId, HISTORY_LIMIT)
		.all<Turn>();

	const turns = (results ?? []).reverse();
	// Defensive: the model API rejects empty content blocks and requires the
	// conversation to open with a user turn. Normal writes always satisfy both
	// (whole pairs, never-empty replies), but don't let an odd DB state — a
	// manual edit, a partial import — wedge every future call in the session.
	const clean = turns.filter((t) => t.content && t.content.trim() !== "");
	while (clean.length > 0 && clean[0].role !== "user") {
		clean.shift();
	}
	return clean;
}

export async function appendTurns(
	db: D1Database,
	sessionId: string,
	turns: Turn[],
): Promise<void> {
	if (turns.length === 0) return;

	const stmt = db.prepare(
		`INSERT INTO jarvis_turns (session_id, role, content) VALUES (?, ?, ?)`,
	);
	await db.batch(turns.map((t) => stmt.bind(sessionId, t.role, t.content)));
}

/** Forget a session's history (e.g. on a "start over" command). */
export async function clearHistory(
	db: D1Database,
	sessionId: string,
): Promise<void> {
	await db
		.prepare(`DELETE FROM jarvis_turns WHERE session_id = ?`)
		.bind(sessionId)
		.run();
}
