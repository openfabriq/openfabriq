import { describe, expect, it } from "vitest";
import { findFailures, type RunEvidence } from "../../src/learning/failures.js";
import type { CommandRun } from "../../src/run/harness.js";
import type { ReviewRound } from "../../src/run/internal-review.js";
import type { RunRecord } from "../../src/state/journal.js";

const run = (fields: Partial<RunRecord> & { id: string }): RunRecord => ({
	repository: "acme/app",
	automation: "implement",
	agent: "coder",
	event: "issue.labeled",
	isPullRequest: false,
	status: "succeeded",
	queuedAt: "2026-11-20T10:00:00Z",
	endedAt: "2026-11-20T10:30:00Z",
	outputs: [],
	...fields,
});

const check = (ok: boolean, output = "1 test failed"): CommandRun => ({
	kind: "check",
	name: "test",
	command: "npm test",
	ok,
	output,
	durationMs: 10,
	at: "2026-11-20T10:20:00Z",
});

const round = (fields: Partial<ReviewRound>): ReviewRound => ({
	round: 1,
	reviewer: "reviewer",
	verdict: "needs_changes",
	summary: "the date is not validated",
	findings: [{ file: "src/a.ts", problem: "no check", blocking: true }],
	costUsd: 0.1,
	at: "2026-11-20T10:10:00Z",
	...fields,
});

const evidence =
	(
		byRun: Record<
			string,
			Partial<{ commands: CommandRun[]; reviews: ReviewRound[] }>
		>,
	) =>
	(r: RunRecord): RunEvidence => ({
		commands: () => byRun[r.id]?.commands ?? [],
		reviews: () => byRun[r.id]?.reviews,
	});

const opened = run({
	id: "r1",
	outputs: [
		{
			action: "create_pull_request",
			status: "applied",
			summary: "Add the date",
			url: "https://github.com/acme/app/pull/7",
		},
	],
});

describe("failures", () => {
	it("a check still failing after the agent's rounds, with the end of its output", () => {
		const failed = run({
			id: "r2",
			status: "failed",
			reason: 'the check "test" failed (npm test)',
		});
		expect(
			findFailures(
				[failed],
				evidence({
					r2: { commands: [check(false), check(false, "2 tests failed")] },
				}),
			),
		).toEqual([
			expect.objectContaining({
				id: "r2:check",
				kind: "check",
				agent: "coder",
				summary: 'the check "test" failed (npm test)',
				output: "2 tests failed",
			}),
		]);
	});

	it("an internal review that asked for changes, even when the rework passed", () => {
		const reviewed = run({ id: "r2" });
		const failures = findFailures(
			[reviewed],
			evidence({
				r2: {
					reviews: [
						round({}),
						round({ round: 2, verdict: "approved", findings: [] }),
					],
				},
			}),
		);
		expect(failures).toEqual([
			expect.objectContaining({
				id: "r2:review",
				kind: "review",
				summary: "reviewer asked for changes: the date is not validated",
				findings: [{ file: "src/a.ts", problem: "no check", blocking: true }],
			}),
		]);
	});

	it("failed checks and a maintainer's requested changes on a pull request the factory opened, for the agent that opened it", () => {
		const checks = run({
			id: "r2",
			automation: "rework",
			agent: "fixer",
			event: "pull_request.checks_failed",
			isPullRequest: true,
			number: 7,
		});
		const changes = run({
			id: "r3",
			automation: "rework",
			agent: "fixer",
			event: "pull_request.changes_requested",
			isPullRequest: true,
			number: 7,
		});
		const failures = findFailures([changes, checks, opened], evidence({}));
		expect(failures.map((f) => [f.id, f.agent, f.openedIn])).toEqual([
			["r3:changes_requested", "coder", "r1"],
			["r2:checks_failed", "coder", "r1"],
		]);
	});

	it("not on a pull request no run opened, nor from an untrusted run: a maintainer's word counts whoever the automation runs for", () => {
		const other = run({
			id: "r2",
			automation: "rework",
			event: "pull_request.changes_requested",
			isPullRequest: true,
			number: 8,
		});
		const anyone = { ...other, id: "r3", number: 7, automation: "open" };
		const untrusted = { ...other, id: "r4", number: 7, untrusted: true };
		expect(
			findFailures([other, anyone, untrusted, opened], evidence({})).map(
				(f) => f.id,
			),
		).toEqual(["r3:changes_requested"]);
	});

	it("not budgets, timeouts, setups, refused outputs, nor the engine's own verdicts", () => {
		const runs = [
			run({ id: "a", status: "failed", reason: "the run's budget is spent" }),
			run({ id: "b", status: "failed", reason: 'setup "npm ci" failed' }),
			run({
				id: "c",
				outputs: [
					{
						action: "add_comment",
						status: "refused",
						summary: "comment",
						reason: "no",
					},
				],
			}),
			run({ id: "d" }),
		];
		expect(
			findFailures(
				runs,
				evidence({
					d: {
						reviews: [
							round({ verdict: "needs_human", reason: "no budget left" }),
						],
					},
				}),
			),
		).toEqual([]);
	});

	it("never the runs of learning or the wiki, nor a pull request they opened", () => {
		const learning = run({
			id: "l1",
			automation: "learning",
			agent: "learning",
			status: "failed",
			reason: 'the check "test" failed (npm test)',
			outputs: opened.outputs,
		});
		const checks = run({
			id: "r2",
			automation: "rework",
			event: "pull_request.checks_failed",
			isPullRequest: true,
			number: 7,
		});
		expect(findFailures([checks, learning], evidence({}))).toEqual([]);
	});
});
