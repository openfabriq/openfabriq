import type { RunRecord } from "@openfabriq/runner";
import { expect, it } from "vitest";
import { runDetail } from "../../src/runs/run-detail.js";
import {
	changedFiles,
	reviewPhase,
	reviewRounds,
} from "../../src/runs/run-files.js";

const run = {
	id: "r1",
	repository: "acme/app",
	automation: "nightly-audit",
	agent: "auditor",
	event: "schedule",
	status: "succeeded",
	queuedAt: "2026-11-09T02:00:00.000Z",
	outputs: [],
} as unknown as RunRecord;
const files = { commands: [], transcript: "" };

it("says where the run's automation file is, in its area when it has one", () => {
	expect(
		runDetail(run, [run], files, undefined, "security").automationFile,
	).toBe("openfabriq/security/automations/nightly-audit/automation.md");
	expect(runDetail(run, [run], files, undefined).automationFile).toBe(
		"openfabriq/automations/nightly-audit/automation.md",
	);
});

it("sends the files the run changed only when the engine recorded them", () => {
	const changedFiles = { total: 1, files: [{ path: "a.ts", add: 1, del: 0 }] };
	expect(
		runDetail(run, [run], { ...files, changedFiles }, undefined).changedFiles,
	).toEqual(changedFiles);
	expect(runDetail(run, [run], files, undefined)).not.toHaveProperty(
		"changedFiles",
	);
});

it("reads changed-files.json as missing when it is cut short or of another shape", () => {
	expect(changedFiles('{"total":1,"files":[{"path":"a.ts"}]}\n')).toEqual({
		total: 1,
		files: [{ path: "a.ts" }],
	});
	expect(changedFiles('{"total":1,"fil')).toBeUndefined();
	expect(changedFiles("[]")).toBeUndefined();
	expect(changedFiles(undefined)).toBeUndefined();
});

it("sends each file's diff as numbered lines, and why a file has none", () => {
	const text = JSON.stringify({
		total: 3,
		files: [
			{ path: "a.ts", add: 1, del: 1, patch: "@@ -2 +2 @@\n-a\n+b\n" },
			{ path: "shot.png", noPatch: "binary" },
			{ path: "old.ts", add: 1, del: 0 },
		],
	});
	expect(changedFiles(text)?.files).toEqual([
		{
			path: "a.ts",
			add: 1,
			del: 1,
			hunks: [
				{
					header: "@@ -2 +2 @@",
					lines: [
						{ type: "-", text: "a", old: 2 },
						{ type: "+", text: "b", new: 2 },
					],
				},
			],
		},
		{ path: "shot.png", noPatch: "binary" },
		// Recorded before diffs: the page shows the agent's edits.
		{ path: "old.ts", add: 1, del: 0 },
	]);
});

it("sends the rounds of the internal review only when the run had some, and reads a cut-short reviews.json as none", () => {
	const reviews = [
		{
			round: 1,
			reviewer: "reviewer",
			verdict: "needs_changes" as const,
			summary: "Off by one.",
			findings: [{ problem: "starts at 1", blocking: true }],
			costUsd: 0.2,
			at: "2026-11-13T10:00:00.000Z",
		},
	];
	expect(
		runDetail(run, [run], { ...files, reviews }, undefined).reviews,
	).toEqual(reviews);
	expect(runDetail(run, [run], files, undefined)).not.toHaveProperty("reviews");
	expect(reviewRounds(`${JSON.stringify(reviews)}\n`)).toEqual(reviews);
	expect(reviewRounds('[{"round":1')).toBeUndefined();
	expect(reviewRounds("{}")).toBeUndefined();
	expect(reviewRounds(undefined)).toBeUndefined();
});

it("sends what a reviewed run does now only while it runs, and reads a cut-short phase.json as none", () => {
	const phase = {
		doing: "reviewing" as const,
		agent: "change-reviewer",
		round: 1,
		limit: 2,
		since: "2026-11-13T10:00:00.000Z",
	};
	const running = { ...run, status: "running" } as RunRecord;
	expect(
		runDetail(running, [running], { ...files, phase }, undefined).phase,
	).toEqual(phase);
	expect(
		runDetail(run, [run], { ...files, phase }, undefined),
	).not.toHaveProperty("phase");
	expect(runDetail(running, [running], files, undefined)).not.toHaveProperty(
		"phase",
	);
	expect(reviewPhase(`${JSON.stringify(phase)}\n`)).toEqual(phase);
	expect(reviewPhase('{"doing":"reviewing"')).toBeUndefined();
	expect(
		reviewPhase(
			'{"doing":"sleeping","agent":"a","round":1,"limit":2,"since":"x"}',
		),
	).toBeUndefined();
	expect(reviewPhase("[]")).toBeUndefined();
	expect(reviewPhase(undefined)).toBeUndefined();
});
