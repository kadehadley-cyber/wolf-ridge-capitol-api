import { describe, it, expect } from "vitest";
import { replyMentions } from "./jarvis";

describe("replyMentions", () => {
	it("is true when the reply voices a distinctive word from the reminder", () => {
		expect(replyMentions("Don't forget to call the dentist.", "call the dentist")).toBe(true);
		expect(replyMentions("I'll pick up groceries later.", "pick up groceries")).toBe(true);
	});

	it("is false when the reply answers around the reminder", () => {
		expect(replyMentions("It's seventy-two degrees and clear.", "call the dentist")).toBe(false);
	});

	it("assumes surfaced when the reminder has no distinctive words", () => {
		// "to", "a" etc. are too short; nothing distinctive to match on.
		expect(replyMentions("Sure thing.", "go")).toBe(true);
	});

	it("ignores generic reminder-scaffolding words", () => {
		// "remind"/"about"/"that" are stopwords, so a bare echo of them isn't a match.
		expect(replyMentions("Reminder noted, that's all about it.", "remind me about that")).toBe(true);
		// but a real keyword still matches
		expect(replyMentions("Your invoice is ready.", "remind me about the invoice")).toBe(true);
	});
});
