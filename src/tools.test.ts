import { describe, it, expect } from "vitest";
import {
	buildToolCatalog,
	convertUnits,
	evalMath,
	filterRemindersByWindow,
	formatDurationSpoken,
	formatMilesSpoken,
	formatNumber,
	geocodeCandidates,
	homeLocation,
	parseDeviceMap,
} from "./tools";
import type { Fact, Reminder } from "./longterm";

describe("homeLocation", () => {
	const fact = (key: string, value: string): Fact =>
		({ key, value, category: "location", updatedAt: "" }) as Fact;
	const env = (v?: string) => ({ JARVIS_HOME_LOCATION: v }) as Env;

	it("falls back to the operator default when nothing is saved", () => {
		expect(homeLocation([], env("St. George, Utah"))).toBe("St. George, Utah");
	});

	it("prefers what the wearer told Jarvis", () => {
		expect(homeLocation([fact("home_location", "Provo")], env("St. George, Utah")))
			.toBe("Provo");
	});

	it("is undefined when neither is set", () => {
		expect(homeLocation([], env())).toBeUndefined();
	});

	it("treats blank values on either side as unset", () => {
		expect(homeLocation([], env("   "))).toBeUndefined();
		expect(homeLocation([fact("home_location", "  ")], env("St. George, Utah")))
			.toBe("St. George, Utah");
	});

	it("trims stored and configured values", () => {
		expect(homeLocation([], env(" St. George, Utah "))).toBe("St. George, Utah");
		expect(homeLocation([fact("home_location", " Provo ")], env("X"))).toBe("Provo");
	});
});

describe("evalMath", () => {
	it("respects operator precedence and parentheses", () => {
		expect(evalMath("2 + 3 * 4")).toBe(14);
		expect(evalMath("(2 + 3) * 4")).toBe(20);
		expect(evalMath("(1280*3)/12")).toBe(320);
	});

	it("treats ^ as right-associative", () => {
		expect(evalMath("2^3^2")).toBe(512);
		expect(evalMath("2^10")).toBe(1024);
	});

	it("handles unary minus and functions", () => {
		expect(evalMath("-5 + 2")).toBe(-3);
		expect(evalMath("sqrt(9)")).toBe(3);
		expect(evalMath("round(2.5)")).toBe(3);
		expect(evalMath("abs(-7)")).toBe(7);
		expect(evalMath("pi")).toBeCloseTo(Math.PI, 10);
	});

	it("understands percentages", () => {
		expect(evalMath("18% of 64.50")).toBeCloseTo(11.61, 10);
		expect(evalMath("20% off 80")).toBe(64);
		expect(evalMath("18%")).toBeCloseTo(0.18, 10);
	});

	it("accepts × and ÷ symbols", () => {
		expect(evalMath("6 × 7")).toBe(42);
		expect(evalMath("84 ÷ 2")).toBe(42);
	});

	it("rejects malformed input instead of guessing", () => {
		expect(() => evalMath("1/0")).toThrow();
		expect(() => evalMath("2 +")).toThrow();
		expect(() => evalMath("frobnicate(2)")).toThrow();
		expect(() => evalMath("2 3")).toThrow();
		expect(() => evalMath("sqrt(-1)")).toThrow();
	});

	it("rejects multi-dot numbers rather than silently truncating", () => {
		expect(() => evalMath("1.2.3")).toThrow();
		expect(() => evalMath("1..2")).toThrow();
		expect(() => evalMath("3.")).toThrow();
		// ...but legitimate decimals still work
		expect(evalMath("3.14 * 2")).toBeCloseTo(6.28, 10);
		expect(evalMath(".5 + .5")).toBe(1);
	});
});

describe("convertUnits", () => {
	it("converts within a dimension", () => {
		expect(convertUnits(1, "miles", "km")).toBeCloseTo(1.609344, 6);
		expect(convertUnits(1, "kg", "lb")).toBeCloseTo(2.20462262, 6);
		expect(convertUnits(1, "gallon", "liters")).toBeCloseTo(3.785411784, 6);
		expect(convertUnits(2, "hours", "minutes")).toBe(120);
		expect(convertUnits(1, "gb", "mb")).toBe(1000);
	});

	it("handles affine temperature conversions", () => {
		expect(convertUnits(100, "celsius", "fahrenheit")).toBeCloseTo(212, 9);
		expect(convertUnits(32, "f", "c")).toBeCloseTo(0, 9);
		expect(convertUnits(0, "celsius", "kelvin")).toBeCloseTo(273.15, 9);
	});

	it("rejects dimension mismatches and unknown units", () => {
		expect(() => convertUnits(1, "kg", "km")).toThrow();
		expect(() => convertUnits(1, "smoots", "m")).toThrow();
	});
});

describe("formatNumber", () => {
	it("renders plain digits for ordinary values", () => {
		expect(formatNumber(11.61)).toBe("11.61");
		expect(formatNumber(212)).toBe("212");
		expect(formatNumber(0)).toBe("0");
	});

	it("never uses scientific notation", () => {
		for (const n of [2.5e-8, 1e-9, 1e21, 1.5e15]) {
			expect(formatNumber(n)).not.toMatch(/e/i);
		}
	});

	it("does not collapse a small non-zero result to 0", () => {
		expect(formatNumber(1e-12)).toBe("0.000000000001");
		expect(formatNumber(2.5e-8)).toBe("0.000000025");
	});
});

describe("geocodeCandidates", () => {
	it("tries the full clean name first so it isn't truncated", () => {
		expect(geocodeCandidates("New York")[0]).toBe("New York");
	});

	it("falls back past a trailing state word", () => {
		const c = geocodeCandidates("American Fork Utah");
		expect(c[0]).toBe("American Fork Utah");
		expect(c).toContain("American Fork");
	});

	it("falls back to the part before a comma", () => {
		expect(geocodeCandidates("Provo, UT")).toContain("Provo");
	});

	it("dedupes and caps at three attempts", () => {
		const c = geocodeCandidates("a b c d");
		expect(c.length).toBeLessThanOrEqual(3);
		expect(new Set(c).size).toBe(c.length);
	});
});

describe("directions formatting", () => {
	it("speaks distances in plain miles", () => {
		expect(formatMilesSpoken(1609.344)).toBe("1 mile");
		expect(formatMilesSpoken(2575)).toBe("1.6 miles");
		expect(formatMilesSpoken(16093.44)).toBe("10 miles");
		expect(formatMilesSpoken(160934.4)).toBe("100 miles");
	});

	it("speaks durations the way a person would", () => {
		expect(formatDurationSpoken(20)).toBe("under a minute");
		expect(formatDurationSpoken(300)).toBe("about 5 minutes");
		expect(formatDurationSpoken(60)).toBe("about 1 minute");
		expect(formatDurationSpoken(3900)).toBe("about 1 hour and 5 minutes");
		expect(formatDurationSpoken(7200)).toBe("about 2 hours");
	});
});

describe("parseDeviceMap", () => {
	it("keeps only https entries with lowercased command names", () => {
		const map = parseDeviceMap(
			'{"Open Mask":"https://helmet/open","bad":"http://insecure","":"https://x"}',
		);
		expect(map).toEqual({ "open mask": "https://helmet/open" });
	});

	it("returns empty on malformed or missing input", () => {
		expect(parseDeviceMap(undefined)).toEqual({});
		expect(parseDeviceMap("not json")).toEqual({});
		expect(parseDeviceMap('["array"]')).toEqual({});
	});
});

describe("buildToolCatalog gating", () => {
	const names = (env: unknown) =>
		buildToolCatalog(env as Env).map((t) => t.definition.name);

	it("ships the keyless core (incl. directions) with no config", () => {
		const core = names({});
		expect(core).toContain("get_directions");
		expect(core).not.toContain("control_home");
		expect(core).not.toContain("trigger_device");
	});

	it("adds control_home only when Home Assistant is fully configured", () => {
		expect(names({ HOME_ASSISTANT_URL: "https://ha" })).not.toContain("control_home");
		expect(
			names({ HOME_ASSISTANT_URL: "https://ha", HOME_ASSISTANT_TOKEN: "t" }),
		).toContain("control_home");
	});

	it("adds trigger_device only when a valid device map exists", () => {
		expect(names({ JARVIS_DEVICES: "not json" })).not.toContain("trigger_device");
		expect(
			names({ JARVIS_DEVICES: '{"open mask":"https://helmet/open"}' }),
		).toContain("trigger_device");
	});
});

describe("filterRemindersByWindow", () => {
	const tz = "America/Denver";
	// now = 2026-06-29T18:00:00Z == 12:00 local (MDT, UTC-6)
	const now = new Date("2026-06-29T18:00:00Z");
	const r = (id: number, dueAt: string): Reminder => ({ id, text: `r${id}`, dueAt });

	const overdue = r(1, "2026-06-29T15:00:00Z"); // 9am local today, past
	const laterToday = r(2, "2026-06-29T23:00:00Z"); // 5pm local today, future
	const tomorrow = r(3, "2026-06-30T20:00:00Z"); // tomorrow
	const all = [overdue, laterToday, tomorrow];

	it("'due' returns only past-due", () => {
		expect(filterRemindersByWindow(all, "due", now, tz).map((x) => x.id)).toEqual([1]);
	});

	it("'upcoming' returns only future", () => {
		expect(filterRemindersByWindow(all, "upcoming", now, tz).map((x) => x.id)).toEqual([2, 3]);
	});

	it("'today' returns overdue plus same-local-day", () => {
		expect(filterRemindersByWindow(all, "today", now, tz).map((x) => x.id)).toEqual([1, 2]);
	});

	it("'all' returns everything", () => {
		expect(filterRemindersByWindow(all, "all", now, tz)).toHaveLength(3);
	});
});
