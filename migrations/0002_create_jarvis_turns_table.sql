-- Migration number: 0002 	 2026-06-07T00:00:00.000Z
-- Short-term conversational memory for the Jarvis voice assistant.
-- One row per spoken turn, grouped by session (a phone number for the WhatsApp
-- bridge, or a caller-supplied id for the JSON endpoint).
CREATE TABLE IF NOT EXISTS jarvis_turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jarvis_turns_session
    ON jarvis_turns (session_id, id);
