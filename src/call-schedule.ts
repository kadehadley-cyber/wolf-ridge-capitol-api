// MD-call scheduling: public 1-hour slots that land on the admin's
// Treatment Schedule page.
//
//   GET  /api/call-slots?date=YYYY-MM-DD   slot availability for a weekday
//   POST /api/call-book                    { date, hour, name, clinic, email,
//                                            phone, notes } books a free slot
//   GET  /portal/api/call-bookings         upcoming bookings (admin/manager;
//                                          gated by the router)
//
// Slots are 1-hour blocks, 9:00–16:00 Mountain Time, weekdays, up to 30 days
// out. A date+hour pair books once; the admin is emailed on every booking.

import { adminEmail, esc, sendEmail } from "./email";

export const CALL_HOURS = [9, 10, 11, 12, 13, 14, 15, 16];
const MAX_DAYS_OUT = 30;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
	});
}

const ensured = new WeakMap<object, Promise<unknown>>();
function ensureCallBookingsTable(env: Env): Promise<unknown> {
	let p = ensured.get(env.DB);
	if (!p) {
		p = env.DB.prepare(
			`CREATE TABLE IF NOT EXISTS call_bookings (
				id TEXT PRIMARY KEY,
				date TEXT NOT NULL,
				hour INTEGER NOT NULL,
				name TEXT NOT NULL,
				clinic TEXT,
				email TEXT NOT NULL,
				phone TEXT,
				notes TEXT,
				created_at TEXT NOT NULL,
				UNIQUE(date, hour)
			)`,
		).run();
		ensured.set(env.DB, p);
	}
	return p;
}

interface BookingRow {
	id: string;
	date: string;
	hour: number;
	name: string;
	clinic: string | null;
	email: string;
	phone: string | null;
	notes: string | null;
	created_at: string;
}

async function allBookings(env: Env): Promise<BookingRow[]> {
	await ensureCallBookingsTable(env);
	const rows = await env.DB.prepare(
		`SELECT id, date, hour, name, clinic, email, phone, notes, created_at FROM call_bookings ORDER BY date, hour`,
	).all<BookingRow>();
	return rows.results ?? [];
}

function todayUtcDate(): string {
	return new Date().toISOString().slice(0, 10);
}

/** A bookable date: valid format, today..+30 days, Monday–Friday. */
function validDate(date: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
	const d = new Date(date + "T12:00:00Z");
	if (Number.isNaN(d.getTime())) return false;
	const today = todayUtcDate();
	const max = new Date(Date.now() + MAX_DAYS_OUT * 86400000).toISOString().slice(0, 10);
	if (date < today || date > max) return false;
	const dow = d.getUTCDay();
	return dow >= 1 && dow <= 5;
}

export function hourLabel(hour: number): string {
	const h12 = hour > 12 ? hour - 12 : hour;
	return `${h12}:00 ${hour >= 12 ? "PM" : "AM"} MT`;
}

export async function handleCallSlots(request: Request, env: Env): Promise<Response> {
	const date = new URL(request.url).searchParams.get("date") ?? "";
	if (!validDate(date)) return json({ error: "Pick a weekday within the next 30 days." }, 400);
	const taken = new Set((await allBookings(env)).filter((b) => b.date === date).map((b) => b.hour));
	return json({
		date,
		slots: CALL_HOURS.map((hour) => ({ hour, label: hourLabel(hour), taken: taken.has(hour) })),
	});
}

export async function handleCallBook(request: Request, env: Env): Promise<Response> {
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ error: "Body must be JSON." }, 400);
	}
	// Honeypot field: bots that fill it get a quiet success.
	if (String(body.website ?? "") !== "") return json({ ok: true });

	const date = String(body.date ?? "");
	const hour = Number(body.hour);
	const name = String(body.name ?? "").trim().slice(0, 200);
	const clinic = String(body.clinic ?? "").trim().slice(0, 200);
	const email = String(body.email ?? "").trim().slice(0, 320);
	const phone = String(body.phone ?? "").trim().slice(0, 40);
	const notes = String(body.notes ?? "").trim().slice(0, 500);

	if (!validDate(date)) return json({ error: "Pick a weekday within the next 30 days." }, 400);
	if (!CALL_HOURS.includes(hour)) return json({ error: "Pick one of the listed time slots." }, 400);
	if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return json({ error: "Your name and a valid email are required." }, 400);
	}

	const clash = (await allBookings(env)).some((b) => b.date === date && b.hour === hour);
	if (clash) return json({ error: "That slot was just taken — pick another." }, 409);

	const id = crypto.randomUUID();
	const createdAt = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO call_bookings (id, date, hour, name, clinic, email, phone, notes, created_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
	)
		.bind(id, date, hour, name, clinic || null, email, phone || null, notes || null, createdAt)
		.run();

	const rows = [
		["When", `${date} · ${hourLabel(hour)} (1 hour)`],
		["Name", name],
		["Clinic", clinic || "—"],
		["Email", email],
		["Phone", phone || "—"],
		["Topic", notes || "—"],
	]
		.map(
			([k, v]) => `<tr>
	<td style="padding:5px 12px 5px 0;font-size:13px;color:#2e7d74;font-weight:bold;white-space:nowrap;">${esc(k)}</td>
	<td style="padding:5px 0;font-size:14px;color:#16403b;">${esc(v)}</td>
</tr>`,
		)
		.join("");
	await sendEmail(
		env,
		adminEmail(env),
		`MD call booked: ${date} ${hourLabel(hour)} — ${name}`,
		`<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f6faf9;">
<div style="background:#ffffff;border:1px solid #e3ecea;border-radius:10px;padding:24px;">
<h1 style="margin:0 0 6px;font-size:21px;color:#16403b;">New MD call booking</h1>
<p style="margin:0 0 14px;font-size:14px;color:#4a5f58;">It's on your Treatment Schedule page in the portal.</p>
<table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>
</div></div>`,
	);

	return json({ ok: true, date, hour, label: hourLabel(hour) });
}

/** Upcoming bookings for the admin's Treatment Schedule page. */
export async function handleCallBookingsList(env: Env): Promise<Response> {
	const today = todayUtcDate();
	const bookings = (await allBookings(env)).filter((b) => b.date >= today);
	return json({ bookings: bookings.map((b) => ({ ...b, label: hourLabel(b.hour) })) });
}
