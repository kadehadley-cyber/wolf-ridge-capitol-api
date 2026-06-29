-- Migration number: 0003 	 2026-06-29T00:00:00.000Z
-- Long-term memory for Jarvis: a per-session "dossier" of durable facts about
-- the wearer, one-shot reminders, and an idempotency ledger so the proactive
-- daily briefing is sent at most once per day. Every table is session-scoped
-- (a phone number for the WhatsApp bridge, or a caller-supplied id) so several
-- people/devices never see each other's data. All forward-only and re-appliable.

-- Durable facts about the wearer. Keyed (session_id, fact_key) so remembering a
-- fact is a clean upsert and there is no cross-session bleed.
CREATE TABLE IF NOT EXISTS jarvis_facts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    fact_key   TEXT NOT NULL,
    fact_value TEXT NOT NULL,
    category   TEXT NOT NULL DEFAULT 'other',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jarvis_facts_session_key
    ON jarvis_facts (session_id, fact_key);

CREATE INDEX IF NOT EXISTS idx_jarvis_facts_rank
    ON jarvis_facts (session_id, updated_at DESC);

-- One-shot reminders. `fired_at IS NULL` is the "pending" sentinel; it is set
-- when the reminder is delivered (cron push), surfaced, or cancelled.
CREATE TABLE IF NOT EXISTS jarvis_reminders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    text       TEXT NOT NULL,
    due_at_utc TEXT NOT NULL,                  -- ISO-8601 UTC instant
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    fired_at   TEXT                            -- NULL = pending
);

CREATE INDEX IF NOT EXISTS idx_jarvis_reminders_due
    ON jarvis_reminders (session_id, fired_at, due_at_utc);

-- Daily-briefing idempotency ledger: at most one proactive briefing per session
-- per local day, even under overlapping/retried cron ticks.
CREATE TABLE IF NOT EXISTS briefings_sent (
    session_id TEXT NOT NULL,
    ymd        TEXT NOT NULL,                  -- local 'YYYY-MM-DD' in the session tz
    sent_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (session_id, ymd)
);
