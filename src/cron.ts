// Proactive delivery, driven by the Worker's scheduled (cron) handler. Two jobs
// run on each tick:
//
//   * Reminder sweep — push any now-due reminders to sessions reachable over
//     WhatsApp, marking each fired atomically so it goes out at most once.
//   * Briefing tick — for sessions that set a `briefing_hour`, deliver the daily
//     briefing when their local hour matches, guarded by a once-per-day ledger.
//
// Everything is gated on WhatsApp being configured: with no push channel there's
// nothing to deliver, so the handler no-ops (reminders still surface in-band via
// the next conversation and GET /briefing). Per-session work is isolated in
// try/catch so one bad row can't sink the tick.

import { composeBriefing } from "./briefing";
import {
	dueReminders,
	getFactValue,
	loadFacts,
	markBriefingSent,
	markReminderFired,
	sessionsWithBriefingHour,
	sessionsWithDueReminders,
} from "./longterm";
import { localHour, localYmd, safeTimeZone } from "./datetime";
import { sendText } from "./whatsapp";

/** Run all scheduled jobs. Safe to call from `scheduled()` under waitUntil. */
export async function runScheduled(env: Env, now: Date): Promise<void> {
	if (!whatsAppConfigured(env)) {
		// No push channel; reminders/briefings are pull-based until WhatsApp is set.
		return;
	}
	await Promise.allSettled([runReminderSweep(env, now), runBriefingTick(env, now)]);
}

/** Deliver due reminders to phone-number sessions, at most once each. */
export async function runReminderSweep(env: Env, now: Date): Promise<void> {
	const sessions = await sessionsWithDueReminders(env.DB, now);
	for (const sessionId of sessions) {
		if (!isPhoneNumber(sessionId)) continue;
		try {
			const due = await dueReminders(env.DB, sessionId, now);
			for (const r of due) {
				// Flip to fired first so overlapping ticks can't double-send; we
				// accept the rare lost message over texting twice.
				const won = await markReminderFired(env.DB, sessionId, r.id);
				if (!won) continue;
				await sendText(env, sessionId, `Reminder: ${r.text}.`);
			}
		} catch (err) {
			console.error("Reminder sweep failed for", sessionId, err);
		}
	}
}

/** Deliver the daily briefing to opted-in sessions at their chosen local hour. */
export async function runBriefingTick(env: Env, now: Date): Promise<void> {
	const subscribers = await sessionsWithBriefingHour(env.DB);
	for (const { sessionId, hour } of subscribers) {
		if (!isPhoneNumber(sessionId)) continue;
		const target = parseInt(hour, 10);
		if (!Number.isFinite(target)) continue;
		try {
			const facts = await loadFacts(env.DB, sessionId, 40);
			const tz = safeTimeZone(getFactValue(facts, "timezone") ?? env.JARVIS_TIMEZONE);
			if (localHour(now, tz) !== target) continue;

			// Claim today's slot; if we don't win the insert, it already went out.
			const won = await markBriefingSent(env.DB, sessionId, localYmd(now, tz));
			if (!won) continue;

			const text = await composeBriefing(env, sessionId, now);
			await sendText(env, sessionId, text);
		} catch (err) {
			console.error("Briefing tick failed for", sessionId, err);
		}
	}
}

function whatsAppConfigured(env: Env): boolean {
	return Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);
}

/** WhatsApp session ids are the wearer's phone number (digits, maybe a +). */
function isPhoneNumber(sessionId: string): boolean {
	return /^\+?\d{7,15}$/.test(sessionId);
}
