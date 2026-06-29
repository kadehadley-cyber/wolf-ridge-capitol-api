import { describe, it, expect } from "vitest";
import {
	formatSpokenDateTime,
	formatSpokenTime,
	localHour,
	localYmd,
	safeTimeZone,
} from "./datetime";

// 2026-06-29T18:00:00Z is 12:00 (noon) in America/Denver (MDT, UTC-6),
// and 03:00 the next day in Asia/Tokyo (UTC+9).
const now = new Date("2026-06-29T18:00:00Z");

describe("safeTimeZone", () => {
	it("passes through a valid IANA zone", () => {
		expect(safeTimeZone("America/Denver")).toBe("America/Denver");
	});
	it("falls back to UTC for an unknown or missing zone", () => {
		expect(safeTimeZone("Not/ARealZone")).toBe("UTC");
		expect(safeTimeZone(undefined)).toBe("UTC");
	});
});

describe("localYmd", () => {
	it("renders the local calendar day per zone", () => {
		expect(localYmd(now, "America/Denver")).toBe("2026-06-29");
		expect(localYmd(now, "Asia/Tokyo")).toBe("2026-06-30");
		expect(localYmd(now, "UTC")).toBe("2026-06-29");
	});
});

describe("localHour", () => {
	it("returns the local 24h hour per zone", () => {
		expect(localHour(now, "America/Denver")).toBe(12);
		expect(localHour(now, "Asia/Tokyo")).toBe(3);
		expect(localHour(now, "UTC")).toBe(18);
	});
});

describe("spoken formatters", () => {
	it("phrases the clock time for a zone", () => {
		expect(formatSpokenTime(now, "America/Denver")).toBe("12:00 PM");
		// Bad zone falls back to UTC rather than throwing.
		expect(formatSpokenTime(now, "Not/AZone")).toBe("6:00 PM");
	});
	it("phrases a full date/time a person could read aloud", () => {
		const spoken = formatSpokenDateTime(now, "America/Denver");
		expect(spoken).toContain("June 29, 2026");
		expect(spoken).toContain("12:00 PM");
	});
});
