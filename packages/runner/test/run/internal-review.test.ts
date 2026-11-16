import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
	internalReview,
	type ReviewPhase,
	type Verdict,
} from "../../src/run/internal-review.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

/** A review of two rounds at most, whose reviewer gives the verdicts in turn, on a clock that moves a minute a call. */
function review(verdicts: Verdict[]) {
	const runDir = mkdtempSync(join(tmpdir(), "of-review-"));
	dirs.push(runDir);
	let minute = 0;
	const now = () => new Date(Date.UTC(2026, 10, 16, 10, minute++));
	const phase = (): ReviewPhase | undefined =>
		existsSync(join(runDir, "phase.json"))
			? JSON.parse(readFileSync(join(runDir, "phase.json"), "utf8"))
			: undefined;
	const during: (ReviewPhase | undefined)[] = [];
	const reviews = internalReview({
		author: "implementer",
		reviewer: "change-reviewer",
		limit: 2,
		budgetUsd: 10,
		deadline: Date.UTC(2026, 10, 17),
		runDir,
		now,
		snapshot: async () => async () => {},
		prompt: () => "Review.",
		launch: async (round) => {
			during.push(phase());
			const next = verdicts.shift();
			if (next) round.record(next);
			return {
				status: "succeeded",
				turns: 1,
				tokens: { input: 1, output: 1 },
				costUsd: 0.1,
			};
		},
	});
	return { reviews, phase, during };
}

const changes: Verdict = {
	verdict: "needs_changes",
	summary: "Off by one.",
	findings: [{ problem: "starts at 1", blocking: true }],
};
const approved: Verdict = {
	verdict: "approved",
	risk: "low",
	summary: "Fine.",
	findings: [],
};

it("records who reviews, which round and since when, while the round runs", async () => {
	const { reviews, during } = review([approved]);
	await reviews.run();
	expect(during).toEqual([
		{
			doing: "reviewing",
			agent: "change-reviewer",
			round: 1,
			limit: 2,
			since: "2026-11-16T10:00:00.000Z",
		},
	]);
});

it("records the author fixing the findings between rounds, then the next round", async () => {
	const { reviews, phase, during } = review([changes, approved]);
	await reviews.run();
	expect(phase()).toEqual({
		doing: "fixing",
		agent: "implementer",
		round: 1,
		limit: 2,
		since: expect.any(String),
	});
	const fixingSince = phase()?.since ?? "";
	expect(fixingSince > "2026-11-16T10:00:00.000Z").toBe(true);
	await reviews.run();
	expect(during[1]).toMatchObject({ doing: "reviewing", round: 2 });
	expect((during[1]?.since ?? "") > fixingSince).toBe(true);
});

it("keeps no phase once no fix follows: approved, or the last round spent", async () => {
	const done = review([approved]);
	await done.reviews.run();
	expect(done.phase()).toBeUndefined();
	const spent = review([changes, changes]);
	await spent.reviews.run();
	await spent.reviews.run();
	expect(spent.phase()).toBeUndefined();
});
