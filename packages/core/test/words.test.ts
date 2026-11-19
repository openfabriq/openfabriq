import { describe, expect, it } from "vitest";
import { isOneOf, sentenceList, suggested, unknownWord } from "../src/words.js";

describe("sentenceList", () => {
	it("joins 0, 1, 2 and 3 items with and", () => {
		expect(sentenceList([])).toBe("");
		expect(sentenceList(["a"])).toBe("a");
		expect(sentenceList(["a", "b"])).toBe("a and b");
		expect(sentenceList(["a", "b", "c"])).toBe("a, b and c");
	});

	it("joins 0, 1, 2 and 3 items with or", () => {
		expect(sentenceList([], "or")).toBe("");
		expect(sentenceList(["a"], "or")).toBe("a");
		expect(sentenceList(["a", "b"], "or")).toBe("a or b");
		expect(sentenceList(["a", "b", "c"], "or")).toBe("a, b or c");
	});
});

describe("isOneOf", () => {
	it("tells whether a word is in the list", () => {
		expect(isOneOf(["issue", "pull_request"], "issue")).toBe(true);
		expect(isOneOf(["issue", "pull_request"], "issues")).toBe(false);
		expect(isOneOf([], "issue")).toBe(false);
	});
});

describe("unknownWord", () => {
	const events = ["issue.opened", "issue.labeled", "pull_request.opened"];

	it("suggests a close word", () => {
		expect(unknownWord("event", "issue.label", events, "when")).toBe(
			'unknown event "issue.label" in when. Did you mean "issue.labeled"?',
		);
	});

	it("lists every option when no word is close", () => {
		expect(unknownWord("event", "deploy", events)).toBe(
			'unknown event "deploy". Use one of: issue.opened, issue.labeled, pull_request.opened',
		);
	});

	it("adds nothing when there is no option", () => {
		expect(unknownWord("event", "deploy", [])).toBe('unknown event "deploy".');
	});
});

describe("suggested", () => {
	it("suggests the closest option", () => {
		expect(
			suggested("No.", "issue.opend", ["issue.closed", "issue.opened"]),
		).toBe('No. Did you mean "issue.opened"?');
	});

	it("adds nothing when there is no option", () => {
		expect(suggested("No.", "word", [])).toBe("No.");
	});

	it("allows a distance of a third of the word's length", () => {
		// "abcdef" has 6 letters: a distance of 2 is close, 3 is not.
		expect(suggested("No.", "abcdef", ["abcdxy"])).toBe(
			'No. Did you mean "abcdxy"?',
		);
		expect(suggested("No.", "abcdef", ["abcxyz"])).toBe(
			"No. Use one of: abcxyz",
		);
		// "abcdefghi" has 9 letters: a distance of 3 is close, 4 is not.
		expect(suggested("No.", "abcdefghi", ["abcdefxyz"])).toBe(
			'No. Did you mean "abcdefxyz"?',
		);
		expect(suggested("No.", "abcdefghi", ["abcdewxyz"])).toBe(
			"No. Use one of: abcdewxyz",
		);
	});

	it("allows a distance of at least 1 for a short word", () => {
		// A third of 2 letters rounds down to 0: the threshold stays at 1.
		expect(suggested("No.", "ab", ["ax"])).toBe('No. Did you mean "ax"?');
		expect(suggested("No.", "ab", ["xy"])).toBe("No. Use one of: xy");
		expect(suggested("No.", "a", ["b"])).toBe('No. Did you mean "b"?');
	});
});
