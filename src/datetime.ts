// Small, pure date/time helpers shared by the tools, the brain, and the
// briefing. Everything is timezone-aware via Intl, voice-friendly (it produces
// strings a person would actually say), and defensive about bad IANA names so a
// stray timezone fact can never throw.

/** Validate an IANA timezone, falling back to UTC if it isn't recognised. */
export function safeTimeZone(tz: string | undefined): string {
	if (!tz) return "UTC";
	try {
		// Throws RangeError for an unknown zone.
		new Intl.DateTimeFormat("en-US", { timeZone: tz });
		return tz;
	} catch {
		return "UTC";
	}
}

/** "Sunday, June 29, 2026 at 3:42 PM" — what get_time and the briefing speak. */
export function formatSpokenDateTime(date: Date, tz: string | undefined): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone: safeTimeZone(tz),
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	}).format(date);
}

/** "3:42 PM" — a bare clock time, e.g. for a reminder's due moment. */
export function formatSpokenTime(date: Date, tz: string | undefined): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone: safeTimeZone(tz),
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	}).format(date);
}

/** "Monday, July 1 at 9:00 AM" — a reminder's due moment, with weekday. */
export function formatSpokenDue(date: Date, tz: string | undefined): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone: safeTimeZone(tz),
		weekday: "long",
		month: "long",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	}).format(date);
}

/** Local calendar day as 'YYYY-MM-DD' in the given zone (for the daily ledger). */
export function localYmd(date: Date, tz: string | undefined): string {
	// en-CA renders ISO-style YYYY-MM-DD.
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: safeTimeZone(tz),
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(date);
}

/** Local hour [0–23] in the given zone (for the briefing-hour match). */
export function localHour(date: Date, tz: string | undefined): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: safeTimeZone(tz),
		hour: "numeric",
		hour12: false,
	}).formatToParts(date);
	const raw = parts.find((p) => p.type === "hour")?.value ?? "0";
	const hour = parseInt(raw, 10);
	// Some engines render midnight as 24 under hour12:false; normalise.
	return Number.isFinite(hour) ? hour % 24 : 0;
}
