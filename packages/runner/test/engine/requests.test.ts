import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Automation, type Factory, loadFactory } from "@openfabriq/core";
import { beforeEach, expect, it } from "vitest";
import {
	engineRun,
	manualEvent,
	manualRuns,
	requestEngineRun,
	requestRun,
	takeRequests,
} from "../../src/engine/requests.js";
import { readFactoryFolder } from "../../src/files.js";
import { appendRun, type RunRecord } from "../../src/state/journal.js";
import { writeApplied } from "../../src/state/projects.js";

const ROOT = join(import.meta.dirname, "../../../..");
const REPO = "acme/task-app";
const factory = loadFactory(
	readFactoryFolder(join(ROOT, "fixtures/valid/sdlc/openfabriq")),
).factory;
const automation = (name: string) => factory?.automations[name] as Automation;
const nightly: Automation = {
	name: "nightly",
	when: [{ event: "schedule", cron: "0 2 * * *" }],
	agent: "implementer",
	can: [],
	concurrency: "repository",
	from: "maintainers",
	instructions: "",
};
const request = (over: object = {}) => ({
	id: "r1",
	automation: "x",
	isPullRequest: false,
	by: "Ada",
	at: "2026-11-03T10:00:00Z",
	...over,
});

beforeEach(() => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
});

it("chooses the automation's own event for a manual run", () => {
	expect(manualEvent(nightly, request())).toEqual({
		key: "manual:r1",
		event: "schedule",
		isPullRequest: false,
		actor: "Ada",
		at: "2026-11-03T10:00:00Z",
	});
	expect(
		manualEvent(automation("implement-ready-issues"), request({ number: 12 })),
	).toEqual({
		key: "manual:r1",
		event: "issue.labeled",
		label: "ready-for-agent",
		number: 12,
		isPullRequest: false,
		actor: "Ada",
		at: "2026-11-03T10:00:00Z",
	});
	expect(
		manualEvent(
			automation("review-pull-requests"),
			request({ number: 21, isPullRequest: true }),
		),
	).toMatchObject({
		event: "pull_request.opened",
		number: 21,
		isPullRequest: true,
	});
});

it("explains what a manual run needs", () => {
	expect(manualEvent(automation("implement-ready-issues"), request())).toBe(
		"implement-ready-issues starts on an issue: pass --issue <number>",
	);
	expect(
		manualEvent(automation("review-pull-requests"), request({ number: 3 })),
	).toBe("review-pull-requests starts on a pull request: pass --pr <number>");
	expect(manualEvent(nightly, request({ number: 3 }))).toBe(
		"nightly runs on the whole repository: no --issue or --pr",
	);
	expect(
		manualEvent(
			{ ...nightly, name: "chat", when: [{ event: "slack.mentioned" }] },
			request(),
		),
	).toBe(
		"chat only starts from Slack, Linear, Sentry or a webhook: it cannot be run manually",
	);
});

it("queues the manual runs the applied factory can run, and says why it refuses the others", () => {
	requestRun(REPO, request({ id: "a", automation: "gone" }));
	requestRun(REPO, request({ id: "p", automation: "constructor" }));
	requestRun(REPO, request({ id: "b", automation: "implement-ready-issues" }));
	requestRun(
		REPO,
		request({ id: "c", automation: "implement-ready-issues", number: 12 }),
	);
	const manual = manualRuns(REPO, () => factory as Factory);
	const said = manual.map((manual) =>
		"refused" in manual
			? `refused ${manual.refused}`
			: `queued ${manual.run.repository} ${manual.run.automation} #${manual.run.number} ${manual.run.event.key}`,
	);
	expect(said.sort()).toEqual([
		"queued acme/task-app implement-ready-issues #12 manual:c",
		"refused constructor is not in the applied factory",
		"refused gone is not in the applied factory",
		"refused implement-ready-issues starts on an issue: pass --issue <number>",
	]);
	// A request stays until its run is queued or its refusal said: a failed queue loses none.
	for (const m of manual.slice(1)) m.taken();
	expect(takeRequests(REPO).map((r) => r.id)).toEqual(["a"]);
});

it("keeps requests on disk until the engine takes them, once", () => {
	requestRun(REPO, request({ id: "a" }));
	requestRun(REPO, request({ id: "b", number: 4 }));
	expect(
		takeRequests(REPO)
			.map((r) => r.id)
			.sort(),
	).toEqual(["a", "b"]);
	expect(takeRequests(REPO)).toEqual([]);
});

it("runs the engine's wiki, which has no trigger on demand, on the whole repository", () => {
	const wiki: Automation = { ...nightly, name: "wiki", when: [] };
	expect(manualEvent(wiki, request())).toEqual({
		key: "manual:r1",
		event: "default_branch.updated",
		isPullRequest: false,
		actor: "Ada",
		at: "2026-11-03T10:00:00Z",
	});
	expect(manualEvent(wiki, request({ number: 12 }))).toBe(
		"wiki runs on the whole repository: no --issue or --pr",
	);
});

it("says where the wiki's latest run stands, for the studio", () => {
	expect(engineRun(REPO, "wiki")).toBeUndefined();
	requestRun(REPO, { ...request(), automation: "wiki" });
	expect(engineRun(REPO, "wiki")).toEqual({ state: "asked" });
	takeRequests(REPO);
	const run: Omit<RunRecord, "status"> = {
		id: "w1",
		repository: REPO,
		automation: "wiki",
		agent: "wiki",
		event: "default_branch.updated",
		isPullRequest: false,
		queuedAt: "2026-11-06T10:00:00Z",
		outputs: [],
	};
	appendRun({ ...run, status: "running", startedAt: "2026-11-06T10:01:00Z" });
	expect(engineRun(REPO, "wiki")).toEqual({
		state: "running",
		id: "w1",
		at: "2026-11-06T10:01:00Z",
	});
	appendRun({
		...run,
		status: "succeeded",
		startedAt: "2026-11-06T10:01:00Z",
		endedAt: "2026-11-06T10:09:00Z",
		outputs: [
			{
				action: "create_pull_request",
				summary: "docs: wiki for 3f2a9c1",
				status: "applied",
				url: "https://github.com/acme/app/pull/7",
			},
		],
	});
	expect(engineRun(REPO, "wiki")).toEqual({
		state: "succeeded",
		id: "w1",
		at: "2026-11-06T10:09:00Z",
		pullRequest: "https://github.com/acme/app/pull/7",
	});
});

it("asks for a run of learning from the studio once, and only when the factory turns it on", () => {
	expect(requestEngineRun(REPO, "learning")).toBe("off");
	writeApplied(
		REPO,
		readFactoryFolder(join(ROOT, "fixtures/valid/learning/openfabriq")),
	);
	expect(requestEngineRun(REPO, "learning")).toBe("asked");
	expect(engineRun(REPO, "learning")).toEqual({ state: "asked" });
	// One at a time: a second click waits for the first.
	expect(requestEngineRun(REPO, "learning")).toBe("busy");
	expect(takeRequests(REPO).map((r) => [r.automation, r.by])).toEqual([
		["learning", "studio"],
	]);
});
