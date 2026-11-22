import type { RunRecord } from "@openfabriq/runner";
import { expect, it } from "vitest";
import {
	computeMetrics,
	pullRequestUrls,
	runsInPeriod,
} from "../../src/metrics/metrics.js";

// Local times, so days do not depend on the machine's time zone.
const NOW = new Date(2026, 9, 10, 18, 0);
const at = (day: number, hour = 12) =>
	new Date(2026, 9, day, hour).toISOString();

/** A day of `byDay` with nothing in it but what `over` says. */
const day = (date: string, over: object = {}) => ({
	day: date,
	usd: 0,
	runs: 0,
	agents: {},
	finished: 0,
	succeeded: 0,
	autonomous: 0,
	opened: 0,
	merged: 0,
	...over,
});

const run = (over: Partial<RunRecord>): RunRecord => ({
	id: Math.random().toString(36).slice(2),
	repository: "acme/shop",
	automation: "implement",
	agent: "implementer",
	event: "issue.labeled",
	isPullRequest: false,
	status: "succeeded",
	queuedAt: at(10),
	outputs: [],
	...over,
});

const RUNS: RunRecord[] = [
	run({
		queuedAt: at(10),
		durationMs: 60_000,
		costUsd: 1.5,
		outputs: [
			{
				action: "create_pull_request",
				summary: "Add a counter",
				status: "applied",
				url: "https://github.com/acme/shop/pull/1",
			},
			{ action: "add_comment", summary: "Done", status: "applied" },
		],
	}),
	run({
		queuedAt: at(9),
		agent: "reviewer",
		durationMs: 30_000,
		costUsd: 0.5,
		outputs: [
			{ action: "add_labels", summary: "needs-human", status: "applied" },
			{
				action: "request_changes",
				summary: "Missing test",
				status: "refused",
				reason: "review_rounds reached (1)",
			},
		],
	}),
	run({
		queuedAt: at(8),
		status: "failed",
		durationMs: 90_000,
		costUsd: 1,
		outputs: [
			{
				action: "create_pull_request",
				summary: "Retry",
				status: "applied",
				url: "https://github.com/acme/shop/pull/2",
			},
		],
	}),
	run({ queuedAt: at(10, 17), status: "running" }),
	run({ queuedAt: at(10, 17), status: "skipped", reason: "daily limit" }),
	// Outside 7 days.
	run({ queuedAt: at(1), costUsd: 9, durationMs: 1_000 }),
];

it("counts runs, durations and costs over the last 7 days", () => {
	const m = computeMetrics(RUNS, "7d", NOW);
	expect(m.since).toBe("2026-10-04");
	expect(m.runs).toEqual({
		total: 5,
		succeeded: 2,
		failed: 1,
		skipped: 1,
		active: 1,
	});
	expect(m.averageDurationMs).toBe(60_000);
	expect(m.agentTimeMs).toBe(180_000);
	expect(m.cost.totalUsd).toBe(3);
	expect(m.cost.byAgent).toEqual([
		{ agent: "implementer", usd: 2.5, runs: 4 },
		{ agent: "reviewer", usd: 0.5, runs: 1 },
	]);
	expect(m.byDay).toHaveLength(7);
	expect(m.byDay.at(-1)).toEqual(
		day("2026-10-10", {
			usd: 1.5,
			runs: 3,
			agents: { implementer: 3 },
			finished: 1,
			succeeded: 1,
			autonomous: 1,
			opened: 1,
		}),
	);
	expect(m.byDay[0]).toEqual(day("2026-10-04"));
});

it("counts the finished runs nobody had to step in: no failure, handoff or refused output", () => {
	// Succeeded on its own; succeeded, handed over with a refused output; failed; running; skipped.
	expect(computeMetrics(RUNS, "7d", NOW).autonomy).toEqual({
		finished: 3,
		autonomous: 1,
	});
});

it("asks GitHub only about the pull requests of the period's runs", () => {
	const old = run({ queuedAt: at(1), endedAt: at(1) });
	expect(runsInPeriod([old, ...RUNS], "7d", NOW)).toEqual(
		RUNS.filter(
			(r) => new Date(r.endedAt ?? r.queuedAt) >= new Date(2026, 9, 4),
		),
	);
	expect(runsInPeriod([old], "30d", NOW)).toEqual([old]);
	expect(runsInPeriod([old], "all", NOW)).toEqual([old]);
});

it("counts the factory's pull requests and the merged ones, as far as gh could tell", () => {
	expect(pullRequestUrls(RUNS)).toEqual([
		"https://github.com/acme/shop/pull/1",
		"https://github.com/acme/shop/pull/2",
	]);
	const m = computeMetrics(RUNS, "7d", NOW, {
		"https://github.com/acme/shop/pull/1": { merged: true, open: false },
	});
	expect(m.pullRequests).toEqual({
		opened: 2,
		merged: 1,
		closed: 0,
		unknown: 1,
	});
	// Closed without a merge: counted apart.
	const closed = computeMetrics(RUNS, "7d", NOW, {
		"https://github.com/acme/shop/pull/1": { merged: false, open: false },
	});
	expect(closed.pullRequests).toEqual({
		opened: 2,
		merged: 0,
		closed: 1,
		unknown: 1,
	});
});

it("puts each pull request on the day it was opened, and on the day GitHub says it was merged", () => {
	const m = computeMetrics(RUNS, "7d", NOW, {
		"https://github.com/acme/shop/pull/1": {
			merged: true,
			mergedAt: at(10, 15),
			open: false,
		},
		// Merged before the period: not on a day of it.
		"https://github.com/acme/shop/pull/2": {
			merged: true,
			mergedAt: at(1),
			open: false,
		},
	});
	expect(m.byDay.map((d) => [d.opened, d.merged])).toEqual([
		[0, 0],
		[0, 0],
		[0, 0],
		[0, 0],
		[1, 0],
		[0, 0],
		[1, 1],
	]);
});

it("counts the issues an agent opened a pull request for, and those a merged one resolved", () => {
	const pr = (n: number) => `https://github.com/acme/shop/pull/${n}`;
	const opens = (n: number) => ({
		outputs: [
			{
				action: "create_pull_request" as const,
				summary: "Fix",
				status: "applied" as const,
				url: pr(n),
			},
		],
	});
	const issue = (n: number, over: Partial<RunRecord> = {}) =>
		run({
			number: n,
			url: `https://github.com/acme/shop/issues/${n}`,
			...over,
		});
	const runs = [
		// Merged at the second try.
		issue(1, opens(11)),
		issue(1, opens(12)),
		// Only triaged: not counted.
		issue(2, { agent: "triager" }),
		// Closed without a merge.
		issue(3, opens(13)),
		// A review of a pull request opens none for an issue.
		run({ number: 4, isPullRequest: true, url: pr(4), ...opens(14) }),
		// A Slack thread is no issue.
		run({ source: { kind: "slack", label: "#factory" }, ...opens(15) }),
		run({
			source: {
				kind: "linear",
				label: "ENG-7",
				url: "https://linear.app/acme/issue/ENG-7/x",
			},
			...opens(16),
		}),
	];
	expect(
		computeMetrics(runs, "7d", NOW, {
			[pr(11)]: { merged: false, open: false },
			[pr(12)]: { merged: true, open: false },
			[pr(13)]: { merged: false, open: false },
			[pr(16)]: { merged: true, open: false },
		}).issues,
	).toEqual({ attempted: 3, resolved: 2 });
});

it("splits the runs' cost by what came of their work", () => {
	const pr = (n: number) => `https://github.com/acme/shop/pull/${n}`;
	const opened = (n: number, costUsd: number, model = "sonnet") =>
		run({
			costUsd,
			model,
			outputs: [
				{
					action: "create_pull_request",
					summary: "x",
					status: "applied",
					url: pr(n),
				},
			],
		});
	const runs = [
		opened(1, 2),
		// A review of the merged pull request: its cost went into that work too.
		run({ costUsd: 1, model: "haiku", isPullRequest: true, url: pr(1) }),
		opened(2, 3, "opus"),
		opened(3, 0.5),
		run({ costUsd: 0.25, model: "haiku", status: "failed" }),
		// A triage: neither a pull request nor a failure.
		run({ costUsd: 0.75, model: "haiku" }),
		run({ status: "skipped" }),
	];
	const m = computeMetrics(runs, "7d", NOW, {
		[pr(1)]: { merged: true, open: false },
		[pr(2)]: { merged: false, open: false },
		[pr(3)]: { merged: false, open: true },
	});
	expect(m.cost.byOutcome).toEqual({
		merged: 3,
		open: 0.5,
		closed: 3,
		failed: 0.25,
		other: 0.75,
	});
});

it("counts human interventions: handoffs, failed runs, refused outputs", () => {
	expect(computeMetrics(RUNS, "7d", NOW).interventions).toEqual({
		total: 3,
		handoffs: 1,
		failedRuns: 1,
		refusedOutputs: 1,
	});
});

it("counts the applied outputs by action, most first", () => {
	expect(computeMetrics(RUNS, "7d", NOW).outputs).toEqual([
		{ action: "create_pull_request", count: 2 },
		{ action: "add_comment", count: 1 },
		{ action: "add_labels", count: 1 },
	]);
});

it("covers every run for 'all', and adds the chat's cost", () => {
	const m = computeMetrics(RUNS, "all", NOW, {}, [
		{ at: at(10, 9), costUsd: 0.25 },
	]);
	expect(m.runs.total).toBe(6);
	expect(m.since).toBe("2026-10-01");
	expect(m.byDay).toHaveLength(10);
	expect(m.cost.chatUsd).toBe(0.25);
	expect(m.cost.totalUsd).toBe(12.25);
	expect(computeMetrics([], "all", NOW).byDay).toEqual([]);
});

it("counts a failed run the engine handed over once, and the engine's handoff as no output of the agent", () => {
	const failed = run({
		queuedAt: at(10),
		status: "failed",
		outputs: [
			{ action: "add_labels", summary: "needs-human", status: "applied" },
			{ action: "add_comment", summary: "handoff", status: "applied" },
		],
	});
	const skipped = run({
		queuedAt: at(10),
		status: "skipped",
		outputs: [
			{ action: "add_comment", summary: "Done", status: "applied" },
			{ action: "add_labels", summary: "needs-human", status: "applied" },
			{ action: "add_comment", summary: "handoff", status: "applied" },
		],
	});
	const m = computeMetrics([failed, skipped], "7d", NOW);
	expect(m.interventions).toEqual({
		total: 2,
		handoffs: 1,
		failedRuns: 1,
		refusedOutputs: 0,
	});
	expect(m.outputs).toEqual([{ action: "add_comment", count: 1 }]);
});

it("counts a run's cost on the day it ended, like the daily limit", () => {
	const late = run({ queuedAt: at(9, 23), endedAt: at(10, 1), costUsd: 2 });
	const { byDay } = computeMetrics([late], "7d", NOW);
	expect(byDay.at(-1)).toEqual(
		day("2026-10-10", {
			usd: 2,
			runs: 1,
			agents: { implementer: 1 },
			finished: 1,
			succeeded: 1,
			autonomous: 1,
		}),
	);
	expect(byDay.at(-2)).toEqual(day("2026-10-09"));
});

it("starts 'all' at midnight of the first run or chat, whichever came first", () => {
	const chats = [
		{ at: at(1, 9), costUsd: 0.5 },
		{ at: new Date(2026, 8, 30, 8).toISOString(), costUsd: 0.25 },
	];
	const m = computeMetrics(RUNS, "all", NOW, {}, chats);
	expect(m.since).toBe("2026-09-30");
	expect(m.cost.chatUsd).toBe(0.75);
	expect(m.byDay[0]).toEqual(day("2026-09-30", { usd: 0.25 }));
	expect(computeMetrics([], "all", NOW, {}, chats.slice(0, 1)).since).toBe(
		"2026-10-01",
	);
});

it("counts no output for the engine's link to what the run opened, old Linear records included", () => {
	const pr = {
		action: "create_pull_request",
		summary: "Add a counter",
		status: "applied",
		url: "https://github.com/acme/shop/pull/1",
	} as const;
	const slack = run({
		outputs: [
			pr,
			{
				action: "add_comment",
				summary: "link to the pull request",
				status: "applied",
				url: "https://acme.slack.com/archives/C1/p2",
			},
		],
	});
	// Before the fix, the link in a Linear session was recorded as a second pull request.
	const linear = run({
		outputs: [
			pr,
			{
				action: "create_pull_request",
				summary: "link to the pull request in the session",
				status: "applied",
			},
		],
	});
	const m = computeMetrics([slack, linear], "7d", NOW);
	expect(m.outputs).toEqual([{ action: "create_pull_request", count: 2 }]);
});

it("adds a chat's cost to its day, and leaves out the chats before the period", () => {
	const m = computeMetrics(RUNS, "7d", NOW, {}, [
		{ at: at(10, 9), costUsd: 0.25 },
		{ at: at(5, 9), costUsd: 0.5 },
		{ at: at(1, 9), costUsd: 4 },
	]);
	expect(m.cost.chatUsd).toBe(0.75);
	expect(m.cost.totalUsd).toBe(3.75);
	expect(m.byDay.at(-1)).toMatchObject({
		day: "2026-10-10",
		usd: 1.75,
		runs: 3,
	});
	expect(m.byDay[1]).toEqual(day("2026-10-05", { usd: 0.5 }));
	expect(m.byDay.reduce((sum, d) => sum + d.usd, 0)).toBe(3.75);
	const keys = [
		"period",
		"runs",
		"agentTimeMs",
		"autonomy",
		"cost",
		"byDay",
		"pullRequests",
		"issues",
		"interventions",
		"outputs",
	];
	expect(Object.keys(m)).toEqual([
		...keys.slice(0, 1),
		"since",
		...keys.slice(1, 2),
		"averageDurationMs",
		...keys.slice(2),
	]);
	expect(Object.keys(computeMetrics([], "all", NOW))).toEqual(keys);
});
