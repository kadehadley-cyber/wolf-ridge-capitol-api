import { defineConfig } from "vitest/config";

// The functions under test are pure (math, units, number formatting, date/time,
// reminder windowing, the reminder-mention heuristic) — they touch only standard
// JS + Intl, never the Workers runtime or D1 — so the default Node environment is
// all we need. No Cloudflare pool, no wrangler bootstrapping.
export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
