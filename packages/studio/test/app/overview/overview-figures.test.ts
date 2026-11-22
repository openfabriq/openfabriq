import { describe, expect, it } from "vitest";
import {
	axisTicks,
	costRatios,
	cumulativePullRequests,
	outcomeParts,
	percent,
	productivity,
	rollingRates,
	runsPerDay,
	spendingParts,
	waitingFor,
} from "../../../app/src/features/overview/overview-figures.js";
import { agentHues } from "../../../app/src/lib/agent-hue.js";
import type { Board, Metrics } from "../../../app/src/lib/types.js";

const metrics = (over: Partial<Metrics> = {}): Metrics => ({
	period: "7d",
	runs: { total: 0, succeeded: 0, failed: 0, skipped: 0, active: 0 },
	agentTimeMs: 0,
	autonomy: { finished: 0, autonomous: 0 },
	cost: {
		totalUsd: 0,
		chatUsd: 0,
		byAgent: [],
		byOutcome: { merged: 0, open: 0, closed: 0, failed: 0, other: 0 },
	},
	byDay: [],
	pullRequests: { opened: 0, merged: 0, closed: 0, unknown: 0 },
	issues: { attempted: 0, resolved: 0 },
	interventions: { total: 0, handoffs: 0, failedRuns: 0, refusedOutputs: 0 },
	outputs: [],
	...over,
});

const COST = metrics().cost;

/** A day of `byDay`, nothing in it but what `over` says. */
const day = (date: string, over: Partial<Metrics["byDay"][number]> = {}) => ({
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

it("draws an axis in about four round steps, whole when asked", () => {
	expect(axisTicks(18)).toEqual([0, 5, 10, 15, 20]);
	expect(axisTicks(0.37)).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
	expect(axisTicks(3, 1)).toEqual([0, 1, 2, 3]);
	expect(axisTicks(1, 1)).toEqual([0, 1]);
	expect(axisTicks(0.012, 0.01)).toEqual([0, 0.01, 0.02]);
	expect(axisTicks(0)).toEqual([0, 1]);
});

it("cuts a whole in parts, nothing of nothing", () => {
	expect(percent(1, 4)).toBe("25%");
	expect(percent(3, 0)).toBe("0%");
});

describe("the productivity cards", () => {
	it("say what each figure is made of, and sort the outputs, most first", () => {
		const p = productivity(
			metrics({
				pullRequests: { opened: 5, merged: 1, closed: 1, unknown: 1 },
				interventions: {
					total: 3,
					handoffs: 2,
					failedRuns: 1,
					refusedOutputs: 0,
				},
				autonomy: { finished: 4, autonomous: 3 },
				issues: { attempted: 6, resolved: 2 },
				outputs: [
					{ action: "push_to_pull_request", count: 5 },
					{ action: "create_pull_request", count: 4 },
					{ action: "add_comment", count: 1 },
				],
			}),
		);
		expect(p.autonomy).toBe("75%");
		expect(p.autonomyWords).toBe("3 of 4 finished runs");
		expect(p.mergeRate).toBe("50%");
		expect(p.mergeRateWords).toBe("1 of 2 decided · 2 still open, not counted");
		expect(p.issuesWords).toBe("of 6 an agent opened a pull request for");
		expect(p.steppedInWords).toBe("2 handed to a person · 1 failed run");
		expect(p.outputs.map((a) => a.action)).toEqual([
			"push_to_pull_request",
			"create_pull_request",
			"add_comment",
		]);
		expect(p.applied).toBe(10);
	});

	it("name a figure made of one part without repeating its number", () => {
		const p = productivity(
			metrics({
				interventions: {
					total: 6,
					handoffs: 6,
					failedRuns: 0,
					refusedOutputs: 0,
				},
			}),
		);
		expect(p.steppedInWords).toBe("handed to a person");
		expect(
			productivity(
				metrics({
					interventions: {
						total: 1,
						handoffs: 0,
						failedRuns: 1,
						refusedOutputs: 0,
					},
				}),
			).steppedInWords,
		).toBe("failed run");
	});

	it("say nothing of what is zero", () => {
		const p = productivity(metrics());
		expect(p.steppedInWords).toBe("");
		expect(p.autonomy).toBeUndefined();
		expect(p.autonomyWords).toBe("");
		expect(p.mergeRate).toBeUndefined();
		expect(p.mergeRateWords).toBe("");
		expect(p.issuesWords).toBe("");
		expect(p.applied).toBe(0);
	});
});

it("lists the agents that spent or ran, and the chat only when it spent", () => {
	const parts = spendingParts(
		metrics({
			cost: {
				...COST,
				totalUsd: 2,
				byAgent: [
					{ agent: "triage", usd: 0, runs: 2 },
					{ agent: "idle", usd: 0, runs: 0 },
					{ agent: "implementer", usd: 2, runs: 1 },
				],
			},
		}),
		agentHues([]),
	);
	expect(parts.map((p) => p.key)).toEqual(["triage", "implementer"]);
	const withChat = spendingParts(
		metrics({ cost: { ...COST, totalUsd: 1, chatUsd: 1 } }),
		agentHues([]),
	);
	expect(withChat).toEqual([
		{ key: "chat", value: 1, runs: undefined, color: "var(--fg-3)" },
	]);
});

it("divides the cost by units of work, none without any", () => {
	expect(costRatios(metrics())).toEqual({
		perRun: undefined,
		perMergedPr: undefined,
		perAgentHour: undefined,
	});
	expect(
		costRatios(
			metrics({
				runs: { total: 4, succeeded: 4, failed: 0, skipped: 0, active: 0 },
				cost: { ...COST, totalUsd: 10, chatUsd: 2 },
				pullRequests: { opened: 3, merged: 2, closed: 0, unknown: 0 },
				agentTimeMs: 30 * 60_000,
			}),
		),
	).toEqual({ perRun: 2, perMergedPr: 5, perAgentHour: 16 });
});

it("says where the money went, the chat last, only what spent", () => {
	const parts = outcomeParts(
		metrics({
			cost: {
				...COST,
				chatUsd: 0.5,
				byOutcome: { merged: 3, open: 0, closed: 1, failed: 0, other: 2 },
			},
		}),
	);
	expect(parts.map((p) => [p.key, p.value])).toEqual([
		["merged", 3],
		["closed", 1],
		["other", 2],
		["chat", 0.5],
	]);
});

it("rates the finished runs over the days up to each day, none before any finished", () => {
	const rates = rollingRates(
		[
			day("2026-11-01"),
			day("2026-11-02", { finished: 2, succeeded: 2, autonomous: 1 }),
			day("2026-11-03", { finished: 2, succeeded: 1, autonomous: 1 }),
			day("2026-11-04", { finished: 1, succeeded: 1, autonomous: 1 }),
		],
		2,
	);
	expect(rates).toEqual([
		{ day: "2026-11-01", finished: 0, autonomy: undefined, success: undefined },
		{ day: "2026-11-02", finished: 2, autonomy: 0.5, success: 1 },
		{ day: "2026-11-03", finished: 4, autonomy: 0.5, success: 0.75 },
		// The 2nd is out of the window.
		{ day: "2026-11-04", finished: 3, autonomy: 2 / 3, success: 2 / 3 },
	]);
});

it("adds up the pull requests opened and merged, day after day", () => {
	expect(
		cumulativePullRequests([
			day("2026-11-01", { opened: 2 }),
			day("2026-11-02"),
			day("2026-11-03", { opened: 1, merged: 2 }),
		]),
	).toEqual([
		{ day: "2026-11-01", opened: 2, merged: 0 },
		{ day: "2026-11-02", opened: 2, merged: 0 },
		{ day: "2026-11-03", opened: 3, merged: 2 },
	]);
});

it("counts the project's cards that need a person, once the board is read", () => {
	const card = (repository: string) =>
		({
			run: { repository },
			trail: [],
		}) as unknown as Board["stages"][number]["cards"][number];
	const board = {
		agents: [],
		stages: [
			{ id: "needs-you", cards: [card("acme/shop"), card("acme/other")] },
		],
	} as unknown as Board;
	expect(waitingFor(board, "acme/shop")).toBe(1);
	expect(waitingFor(undefined, "acme/shop")).toBeUndefined();
});

describe("runsPerDay", () => {
	const byDay = [
		day("2026-11-04", { runs: 3, agents: { triage: 1, implementer: 2 } }),
		day("2026-11-05"),
	];
	it("splits each day by agent, in the same order every day", () => {
		expect(runsPerDay(byDay)).toEqual([
			{
				day: "2026-11-04",
				value: 3,
				parts: [
					{ key: "implementer", value: 2 },
					{ key: "triage", value: 1 },
				],
			},
			{ day: "2026-11-05", value: 0, parts: [] },
		]);
	});
	it("shows one agent's runs when the filter names it", () => {
		expect(runsPerDay(byDay, "triage")).toEqual([
			{ day: "2026-11-04", value: 1 },
			{ day: "2026-11-05", value: 0 },
		]);
	});
});
