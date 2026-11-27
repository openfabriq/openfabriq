import type { Failure, RunRecord } from "@openfabriq/runner";
import { expect, it } from "vitest";
import { progressOf } from "../../src/learning/learning.js";

const run = (
	id: string,
	at: string,
	more: Partial<RunRecord> = {},
): RunRecord => ({
	id,
	repository: "acme/app",
	automation: "code",
	agent: "coder",
	event: "issue.labeled",
	isPullRequest: false,
	status: "succeeded",
	queuedAt: at,
	startedAt: at,
	outputs: [],
	...more,
});

const mistake = (run: string, at: string, automation = "code"): Failure => ({
	id: `${run}:check`,
	kind: "check",
	run,
	agent: "coder",
	automation,
	at,
	summary: "tests failed",
});

it("counts the factory's ended runs and mistakes on each side of the first apply", () => {
	const runs = [
		run("a", "2026-10-01T00:00:00Z"),
		run("b", "2026-10-02T00:00:00Z", { status: "failed" }),
		run("c", "2026-10-03T00:00:00Z", { status: "skipped" }),
		run("l", "2026-10-04T00:00:00Z", { automation: "learning" }),
		run("d", "2026-10-20T00:00:00Z"),
		// Started before the apply, ended after it, like its mistake: an "after" run.
		run("x", "2026-10-11T23:00:00Z", { endedAt: "2026-10-12T01:00:00Z" }),
		run("e", "2026-10-21T00:00:00Z", { status: "running" }),
	];
	const failures = [
		mistake("b", "2026-10-02T01:00:00Z"),
		mistake("a", "2026-10-01T01:00:00Z"),
		mistake("l", "2026-10-04T01:00:00Z", "learning"),
		mistake("d", "2026-10-20T01:00:00Z"),
		mistake("x", "2026-10-12T01:00:00Z"),
	];
	expect(progressOf(runs, failures, "2026-10-12T00:00:00Z")).toEqual({
		since: "2026-10-12T00:00:00Z",
		before: { runs: 2, mistakes: 2 },
		after: { runs: 2, mistakes: 2 },
		minRuns: 20,
	});
});
