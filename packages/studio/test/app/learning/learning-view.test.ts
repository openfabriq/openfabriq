import { expect, it } from "vitest";
import {
	agentLearningLine,
	learningNotice,
	lessonResult,
	progressView,
	whatHappensNext,
} from "../../../app/src/features/learning/learning-view.js";

it("says what a lesson being learned waits for", () => {
	expect(whatHappensNext({ runs: 1 }, 2)).toBe(
		"If this mistake happens once more, learning proposes the rule.",
	);
	expect(whatHappensNext({ runs: 1 }, 3)).toBe(
		"If this mistake happens 2 more times, learning proposes the rule.",
	);
	expect(whatHappensNext({ runs: 2, waits: true }, 2)).toBe(
		"Its rule could not be proposed. Learning tries again after the next mistake.",
	);
});

it("names what came of a lesson", () => {
	const merged = { status: "promoted" as const, cameBack: 0 };
	expect(lessonResult({ status: "proposed", cameBack: 0 })).toBe("to-review");
	expect(lessonResult({ status: "rejected", cameBack: 0 })).toBe("declined");
	expect(lessonResult(merged)).toBe("not-applied");
	expect(lessonResult({ ...merged, appliedAt: "2026-11-20T00:00:00Z" })).toBe(
		"holding",
	);
	expect(
		lessonResult({ ...merged, appliedAt: "2026-11-20T00:00:00Z", cameBack: 2 }),
	).toBe("came-back");
	expect(lessonResult({ status: "candidate", cameBack: 0 })).toBe(
		"being-learned",
	);
	expect(lessonResult({ status: "candidate", cameBack: 0, waits: true })).toBe(
		"waiting",
	);
});

it("gives an agent's page one line, only when learning has something about it", () => {
	const byAgent = {
		coder: { failures: 3, toReview: 1 },
		writer: { failures: 1, toReview: 0 },
		quiet: { failures: 0, toReview: 0 },
	};
	expect(agentLearningLine(byAgent, "coder")).toBe(
		"3 mistakes, 1 rule to review",
	);
	expect(agentLearningLine(byAgent, "writer")).toBe("1 mistake");
	expect(agentLearningLine(byAgent, "quiet")).toBeUndefined();
	expect(agentLearningLine(byAgent, "other")).toBeUndefined();
	expect(agentLearningLine(undefined, "coder")).toBeUndefined();
});

it("compares mistakes per run once both sides have enough runs", () => {
	const since = "2026-10-12T00:00:00Z";
	const view = (before: [number, number], after: [number, number]) =>
		progressView({
			since,
			before: { runs: before[0], mistakes: before[1] },
			after: { runs: after[0], mistakes: after[1] },
			minRuns: 20,
		});
	// Either side short: it waits, and says both.
	expect(view([12, 3], [25, 2])).toEqual({
		kind: "waiting",
		since,
		runsBefore: 12,
		runsAfter: 25,
		needed: 20,
	});
	expect(view([50, 20], [40, 10])).toMatchObject({
		kind: "measured",
		before: 0.4,
		after: 0.25,
		trend: "fewer",
		label: "38% fewer",
	});
	// A rise too small to round is still a rise.
	expect(view([1000, 500], [1000, 502])).toMatchObject({
		trend: "more",
		label: "under 1% more",
	});
	expect(view([20, 0], [20, 3])).toMatchObject({
		trend: "more",
		label: "a rise",
	});
	expect(view([20, 0], [20, 0])).toMatchObject({
		trend: "same",
		label: "no change",
	});
});

it("follows learning's latest run until it ends well", () => {
	expect(learningNotice(null)).toBeUndefined();
	expect(learningNotice({ state: "asked" })).toEqual({ kind: "asked" });
	expect(learningNotice({ state: "running", id: "l1", at: "t" })).toEqual({
		kind: "running",
		id: "l1",
		since: "t",
	});
	expect(
		learningNotice({ state: "failed", id: "l1", at: "t", reason: "limit" }),
	).toEqual({ kind: "failed", id: "l1", reason: "limit" });
	const ended = "2026-11-26T10:00:00Z";
	const minutes = (n: number) => Date.parse(ended) + n * 60_000;
	// Just ended: it says so, with the rule it proposed if any.
	expect(
		learningNotice(
			{ state: "succeeded", id: "l1", at: ended, pullRequest: "pr" },
			minutes(2),
		),
	).toEqual({ kind: "done", id: "l1", pullRequest: "pr" });
	expect(
		learningNotice({ state: "skipped", id: "l1", at: ended }, minutes(2)),
	).toEqual({ kind: "done", id: "l1" });
	// Then the page shows what came of it.
	expect(
		learningNotice({ state: "succeeded", id: "l1", at: ended }, minutes(20)),
	).toBeUndefined();
});
