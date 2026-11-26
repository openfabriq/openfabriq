import {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FactoryFiles, WORKING_LABEL } from "@openfabriq/core";
import { beforeEach, expect, it } from "vitest";
import type { AgentLauncher, AgentResult } from "../../src/agent/port.js";
import { type EngineDeps, startEngine } from "../../src/engine/engine.js";
import type { QueuedRun } from "../../src/engine/queue.js";
import type { GitHub } from "../../src/github/github.js";
import type { IssueItem } from "../../src/github/timeline.js";
import {
	appendRun,
	home,
	projectDir,
	readFactoryFolder,
	readRuns,
	requestRun,
	saveQueue,
	writeApplied,
} from "../../src/index.js";
import type { Workspace } from "../../src/workspace/workspace.js";

const ROOT = join(import.meta.dirname, "../../../..");
const REPO = "acme/task-app";
const T0 = new Date("2026-11-02T10:00:00Z");
let clock: Date;
let items: IssueItem[];
let changed: Record<number, string[]>;
let logs: string[];
let hang: boolean;
let removed: string[];

function sdlc(changes: FactoryFiles = {}): FactoryFiles {
	return {
		...readFactoryFolder(join(ROOT, "fixtures/valid/sdlc/openfabriq")),
		...changes,
	};
}

function fakeGitHub(): GitHub {
	const unused = async () => {
		throw new Error("not used");
	};
	return {
		currentUser: async () => "ada",
		defaultBranch: async () => "main",
		labels: async () => [],
		createLabel: unused,
		clone: unused,
		issuesUpdatedSince: async () => items,
		timeline: async () => [],
		openPulls: async () => [],
		commitAuthor: async () => "ada",
		branchHead: async () => "head",
		changedFiles: async (_repo, number) => changed[number] ?? [],
		commitFiles: async () => [],
		jobLog: unused,
		// A hung run: as if the engine process stopped in the middle of it.
		subject: (_repo, number) =>
			hang
				? new Promise(() => {})
				: Promise.resolve({ number, title: `#${number}` }),
		reviews: async () => [],
		comment: async () => "https://github.com/c/1",
		addLabels: async () => {},
		removeLabel: async () => true,
		createPullRequest: unused,
		review: async () => "https://github.com/r/1",
		createIssue: unused,
		close: unused,
		mergeMethod: unused,
		branchRed: unused,
		merge: unused,
		disableAutoMerge: unused,
	};
}

const workspace: Workspace = {
	settle: async () => "judged",
	mcpServer: async (_clone, command) => command,
	create: async () => {},
	remove: async (_clone, dir) => {
		removed.push(dir);
	},
	commitsAhead: async () => 0,
	commit: async () => {},
	push: async () => {},
	setup: async () => {},
	run: async () => ({ ok: true, output: "" }),
	changed: async () => ({ uncommitted: false, ahead: 0 }),
	touched: async () => [],
	versions: async () => ({}),
	commitsSince: async () => [],
	fetch: async () => {},
	contains: async () => true,
	snapshot: async () => async () => {},
	conflictMarkers: async () => [],
	changedFiles: async () => [],
	patch: async () => "",
	plugin: () => undefined,
};

const neverEnds: AgentLauncher = () => new Promise(() => {});

const engine = (
	maxRuns: number,
	launch: AgentLauncher = neverEnds,
	github: Partial<GitHub> = {},
	more: Partial<EngineDeps> = {},
) =>
	startEngine({
		github: { ...fakeGitHub(), ...github },
		launch,
		workspace,
		identity: { name: "T", email: "t@example.com" },
		log: (line) => logs.push(line),
		now: () => clock,
		maxRuns,
		...more,
	});

const done: AgentResult = {
	status: "succeeded",
	costUsd: 0,
	turns: 1,
	tokens: { input: 0, output: 0 },
};
const settle = () => new Promise((ok) => setTimeout(ok, 20));

const pullRequest = (number: number): IssueItem => ({
	number,
	created_at: new Date(T0.getTime() + 60_000).toISOString(),
	user: { login: "ada" },
	pull_request: {},
});

const savedQueue = () =>
	JSON.parse(readFileSync(join(projectDir(REPO), "queue.json"), "utf8")) as {
		queued: QueuedRun[];
		running: QueuedRun[];
	};

beforeEach(() => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
	clock = T0;
	items = [];
	changed = {};
	logs = [];
	hang = false;
	removed = [];
});

it("skips pull requests that only change ignored paths", async () => {
	writeApplied(
		REPO,
		sdlc({
			"automations/review-pull-requests/automation.md":
				'---\nwhen:\n  pull_request.opened: { ignore_paths: ["openfabriq/**"] }\nagent: reviewer\ncan: [add_comment]\n---\nReview.\n',
		}),
	);
	const e = engine(0);
	await e.tick(); // first start: only what happens from now on counts
	items = [pullRequest(7), pullRequest(8)];
	changed = {
		7: ["openfabriq/factory.yaml"],
		8: ["openfabriq/x.md", "a.ts"],
	};
	clock = new Date(T0.getTime() + 120_000);
	await e.tick();
	expect(e.status().queued.map((r) => [r.number, r.automation])).toEqual([
		[8, "review-pull-requests"],
	]);
	expect(savedQueue().queued.map((r) => r.number)).toEqual([8]);
});

it("writes the queue at every change, and restores it after a stop", async () => {
	writeApplied(REPO, sdlc());
	hang = true;
	const first = engine(1);
	await first.tick();
	items = [pullRequest(7), pullRequest(8)];
	clock = new Date(T0.getTime() + 120_000);
	await first.tick();
	// One run started and never ends; the other waits. Then the engine "stops".
	expect(savedQueue().running.map((r) => r.number)).toEqual([7]);
	expect(savedQueue().queued.map((r) => r.number)).toEqual([8]);
	const interrupted = savedQueue().running[0]?.id;

	const second = engine(0);
	items = [];
	await second.tick();
	const runs = readRuns(REPO);
	expect(runs.find((r) => r.id === interrupted)).toMatchObject({
		status: "failed",
		reason: "interrupted: the engine stopped",
		number: 7,
	});
	expect(
		second.status().queued.map((r) => [r.number, r.requeued ?? false]),
	).toEqual([
		[8, false],
		[7, true],
	]);
	expect(savedQueue().queued).toHaveLength(2);
});

it("queues an interrupted run again only once", async () => {
	writeApplied(REPO, sdlc());
	const run: QueuedRun = {
		id: "twice",
		repository: REPO,
		automation: "review-pull-requests",
		number: 9,
		repoWide: false,
		requeued: true,
		event: {
			key: "k",
			event: "pull_request.opened",
			number: 9,
			isPullRequest: true,
			actor: "ada",
			at: T0.toISOString(),
		},
	};
	appendRun({
		id: "twice",
		repository: REPO,
		automation: run.automation,
		agent: "reviewer",
		event: run.event.event,
		isPullRequest: true,
		status: "running",
		queuedAt: T0.toISOString(),
		outputs: [],
	});
	saveQueue(REPO, { queued: [], running: [run] });
	const e = engine(0);
	await e.tick();
	expect(e.status().queued).toEqual([]);
	expect(readRuns(REPO)).toEqual([
		expect.objectContaining({
			id: "twice",
			status: "failed",
			agent: "reviewer",
		}),
	]);
});

it("times an interrupted run until its transcript's last write, or until the restart", async () => {
	writeApplied(REPO, sdlc());
	const interrupted = (id: string, number: number): QueuedRun => ({
		id,
		repository: REPO,
		automation: "review-pull-requests",
		number,
		repoWide: false,
		event: {
			key: `k${number}`,
			event: "pull_request.opened",
			number,
			isPullRequest: true,
			actor: "ada",
			at: T0.toISOString(),
		},
	});
	for (const id of ["written", "silent"])
		appendRun({
			id,
			repository: REPO,
			automation: "review-pull-requests",
			agent: "reviewer",
			event: "pull_request.opened",
			isPullRequest: true,
			status: "running",
			queuedAt: T0.toISOString(),
			startedAt: T0.toISOString(),
			title: "Kept from the running line",
			outputs: [],
		});
	const runDir = join(projectDir(REPO), "runs", "written");
	mkdirSync(runDir, { recursive: true });
	writeFileSync(join(runDir, "transcript.jsonl"), "{}\n");
	const lastWrite = new Date(T0.getTime() + 60_000);
	utimesSync(join(runDir, "transcript.jsonl"), lastWrite, lastWrite);
	saveQueue(REPO, {
		queued: [],
		running: [interrupted("written", 9), interrupted("silent", 10)],
	});
	clock = new Date(T0.getTime() + 300_000);
	const e = engine(0);
	await e.tick();
	const ended = (id: string) => readRuns(REPO).find((r) => r.id === id);
	expect(ended("written")).toMatchObject({
		status: "failed",
		reason: "interrupted: the engine stopped",
		title: "Kept from the running line",
		endedAt: clock.toISOString(),
		durationMs: 60_000,
	});
	expect(ended("silent")).toMatchObject({
		status: "failed",
		endedAt: clock.toISOString(),
		durationMs: 300_000,
	});
});

const nightly = () =>
	sdlc({
		"factory.yaml": `${readFileSync(join(ROOT, "fixtures/valid/sdlc/openfabriq/factory.yaml"), "utf8")}timezone: Europe/Paris\n`,
		"automations/nightly/automation.md":
			'---\nwhen:\n  schedule: { cron: "0 2 * * *" }\nagent: implementer\nconcurrency: repository\n---\nImprove the code.\n',
	});

it("runs a schedule missed while asleep once, at the factory's time zone", async () => {
	writeApplied(REPO, nightly());
	clock = new Date("2026-11-01T12:00:00Z");
	const e = engine(0);
	await e.tick(); // first start: checks from now on, no history
	expect(e.status().queued).toEqual([]);
	// Three nights asleep: 02:00 in Paris is 01:00 UTC in November.
	clock = new Date("2026-11-04T08:12:00Z");
	await e.tick();
	expect(e.status().queued.map((r) => r.automation)).toEqual(["nightly"]);
	expect(readRuns(REPO).find((r) => r.automation === "nightly")).toMatchObject({
		event: "schedule",
		scheduledFor: "2026-11-04T01:00:00.000Z",
	});
	clock = new Date("2026-11-04T08:13:00Z");
	await e.tick();
	expect(e.status().queued).toHaveLength(1);

	// A restart reads where the last check stopped: the next night is caught up too.
	// (The first night's run is done; a run still waiting would stand for it.)
	e.stop();
	saveQueue(REPO, { queued: [], running: [] });
	clock = new Date("2026-11-05T07:00:00Z");
	const again = engine(0);
	await again.tick();
	expect(
		readRuns(REPO)
			.filter((r) => r.automation === "nightly")
			.map((r) => r.scheduledFor),
	).toContain("2026-11-05T01:00:00.000Z");
});

it("keeps the machine awake while a run works, and lets it sleep after", async () => {
	writeApplied(REPO, nightly());
	const awake: boolean[] = [];
	let finish: () => void = () => {};
	const e = startEngine({
		github: fakeGitHub(),
		launch: () =>
			new Promise((done) => {
				finish = () =>
					done({
						status: "succeeded",
						costUsd: 0,
						turns: 1,
						tokens: { input: 0, output: 0 },
					});
			}),
		workspace,
		identity: { name: "T", email: "t@example.com" },
		log: (line) => logs.push(line),
		now: () => clock,
		maxRuns: 1,
		keepAwake: (on) => awake.push(on),
	});
	clock = new Date("2026-11-04T00:59:30Z");
	await e.tick();
	clock = new Date("2026-11-04T01:00:30Z");
	await e.tick();
	await new Promise((ok) => setTimeout(ok, 20));
	expect(awake).toEqual([true]);
	finish();
	await new Promise((ok) => setTimeout(ok, 20));
	expect(awake).toEqual([true, false]);
});

it("takes the manual runs, through the queue like any event", async () => {
	writeApplied(REPO, nightly());
	const e = engine(0);
	await e.tick();
	requestRun(REPO, {
		id: "r1",
		automation: "nightly",
		isPullRequest: false,
		by: "Ada",
		at: T0.toISOString(),
	});
	requestRun(REPO, {
		id: "r2",
		automation: "implement-ready-issues",
		isPullRequest: false,
		by: "Ada",
		at: T0.toISOString(),
	});
	await e.tick();
	expect(e.status().queued.map((r) => r.automation)).toEqual(["nightly"]);
	expect(readRuns(REPO).find((r) => r.automation === "nightly")).toMatchObject({
		event: "schedule",
		manual: "Ada",
	});
	// The request without its issue is refused, and said in the log.
	expect(logs).toContain(
		`${REPO}: manual run refused: implement-ready-issues starts on an issue: pass --issue <number>`,
	);
	await e.tick();
	expect(e.status().queued).toHaveLength(1);
});

it("takes a manual run at once when woken, without reading GitHub again", async () => {
	writeApplied(REPO, nightly());
	let calls = 0;
	const github = new Proxy(fakeGitHub(), {
		get: (target, key) => {
			const value = Reflect.get(target, key);
			return typeof value === "function"
				? (...args: unknown[]) => {
						calls++;
						return value(...args);
					}
				: value;
		},
	});
	const e = engine(0, neverEnds, {}, { github });
	await e.tick();
	const read = calls;
	expect(read).toBeGreaterThan(0);
	requestRun(REPO, {
		id: "r1",
		automation: "nightly",
		isPullRequest: false,
		by: "studio",
		at: T0.toISOString(),
	});
	e.wake();
	expect(e.status().queued.map((r) => r.automation)).toEqual(["nightly"]);
	expect(calls).toBe(read);
	// Taken once: the next tick finds nothing left to take.
	await e.tick();
	expect(e.status().queued).toHaveLength(1);
});

it("takes a manual run of an automation applied while the engine read GitHub", async () => {
	writeApplied(REPO, sdlc());
	let applying = false;
	const e = engine(1, neverEnds, {
		// openfabriq apply, then openfabriq run, in the seconds the engine waits for GitHub.
		issuesUpdatedSince: async () => {
			if (applying) {
				writeApplied(REPO, nightly());
				requestRun(REPO, {
					id: "r1",
					automation: "nightly",
					isPullRequest: false,
					by: "Ada",
					at: T0.toISOString(),
				});
			}
			return items;
		},
	});
	await e.tick();
	applying = true;
	await e.tick();
	expect(logs.filter((l) => l.includes("refused"))).toEqual([]);
	// It starts with the factory it was checked against: never "no longer in the applied factory".
	await new Promise((r) => setTimeout(r, 50));
	expect(readRuns(REPO).find((r) => r.automation === "nightly")?.status).toBe(
		"running",
	);
});

it("runs a labeled issue once, applies only what can allows, and survives gh going away", async () => {
	writeApplied(REPO, sdlc());
	const writes: string[] = [];
	let offline = false;
	const launches: string[] = [];
	const e = engine(
		1,
		async (run) => {
			launches.push(run.prompt.split("\n")[0] ?? "");
			run.outputs.propose({ action: "add_comment", body: "Root cause: x." });
			run.outputs.propose({
				action: "add_labels",
				labels: ["Ready-For-Agent", "wontfix"],
			});
			return done;
		},
		{
			issuesUpdatedSince: async () => {
				if (offline) throw new Error("gh: connection refused");
				return items;
			},
			timeline: async () => [
				{
					event: "labeled",
					id: 1,
					created_at: new Date(T0.getTime() + 60_000).toISOString(),
					actor: { login: "ada" },
					label: { name: "needs-investigation" },
				},
			],
			comment: async (_r, n, body) => {
				writes.push(`comment #${n}: ${body.split("\n")[0]}`);
				return "https://github.com/c/1";
			},
			addLabels: async (_r, n, labels) => {
				writes.push(`labels #${n}: ${labels.join(", ")}`);
			},
			removeLabel: async (_r, n, label) => {
				writes.push(`unlabel #${n}: ${label}`);
				return true;
			},
		},
	);
	await e.tick(); // first start
	items = [
		{ number: 12, created_at: "2026-10-01T00:00:00Z", user: { login: "x" } },
	];
	clock = new Date(T0.getTime() + 120_000);
	await e.tick();
	await settle();
	expect(launches).toHaveLength(1);
	expect(writes).toEqual([
		`labels #12: ${WORKING_LABEL}`,
		"comment #12: Root cause: x.",
		"labels #12: Ready-For-Agent",
		`unlabel #12: ${WORKING_LABEL}`,
	]);
	expect(logs).toContain(
		`${REPO} #12: labeled ${WORKING_LABEL} while investigate-bugs works`,
	);
	const record = readRuns(REPO)[0];
	expect(record).toMatchObject({
		automation: "investigate-bugs",
		number: 12,
		status: "succeeded",
	});
	expect(record?.outputs).toContainEqual(
		expect.objectContaining({ summary: "wontfix", status: "refused" }),
	);
	// The same event, read again in the overlap: nothing starts.
	clock = new Date(T0.getTime() + 180_000);
	await e.tick();
	await settle();
	expect(launches).toHaveLength(1);
	offline = true;
	clock = new Date(T0.getTime() + 240_000);
	await expect(e.tick()).resolves.toBeUndefined();
	expect(logs).toContain(`${REPO}: gh: connection refused`);
});

it("survives gh offline at start, a .DS_Store, a corrupt queue and half a journal line", async () => {
	writeApplied(REPO, sdlc());
	writeApplied("acme/other", sdlc());
	writeFileSync(join(projectDir("acme/other"), "queue.json"), "{ half");
	writeFileSync(join(home(), "projects", ".DS_Store"), "");
	writeFileSync(join(home(), "projects", "acme", ".DS_Store"), "");
	appendRun({
		id: "a",
		repository: REPO,
		automation: "triage-issues",
		agent: "triage",
		event: "issue.opened",
		isPullRequest: false,
		status: "succeeded",
		queuedAt: T0.toISOString(),
		outputs: [],
	});
	appendFileSync(join(projectDir(REPO), "runs.jsonl"), '{"id":"b","rep');
	let offline = true;
	const e = engine(0, neverEnds, {
		currentUser: async () => {
			if (offline) throw new Error("gh: not reachable");
			return "ada";
		},
	});
	await expect(e.tick()).resolves.toBeUndefined();
	expect(logs).toContain("tick: gh: not reachable");
	expect(logs.some((l) => l.startsWith("acme/other: queue not restored"))).toBe(
		true,
	);
	offline = false;
	await e.tick();
	expect(readRuns(REPO).map((r) => r.id)).toEqual(["a"]);
});

it("reads every event before queuing any: a failure queues nothing, and the retry queues each once", async () => {
	writeApplied(
		REPO,
		sdlc({
			"automations/review-pull-requests/automation.md":
				'---\nwhen:\n  pull_request.opened: { ignore_paths: ["docs/**"] }\nagent: reviewer\ncan: [add_comment]\n---\nReview.\n',
		}),
	);
	let failing = true;
	const e = engine(0, neverEnds, {
		changedFiles: async (_r, n) => {
			if (n === 8 && failing) throw new Error("gh: timeout");
			return ["a.ts"];
		},
	});
	await e.tick();
	items = [pullRequest(7), pullRequest(8)];
	clock = new Date(T0.getTime() + 120_000);
	await e.tick();
	expect(e.status().queued).toEqual([]);
	failing = false;
	clock = new Date(T0.getTime() + 180_000);
	await e.tick();
	expect(e.status().queued.map((r) => r.number)).toEqual([7, 8]);
});

it("writes the cursor only once the events are queued: a queue it cannot save leaves the cursor, and no half-queued run", async () => {
	writeApplied(REPO, sdlc());
	const e = engine(0);
	await e.tick();
	const cursor = join(projectDir(REPO), "cursor.json");
	const before = readFileSync(cursor, "utf8");
	// A directory where queue.json goes: saving the queue fails.
	mkdirSync(join(projectDir(REPO), "queue.json"));
	items = [pullRequest(7)];
	clock = new Date(T0.getTime() + 120_000);
	await e.tick();
	expect(readFileSync(cursor, "utf8")).toBe(before);
	expect(logs.some((l) => l.startsWith(`${REPO}: `))).toBe(true);
	expect(e.status().queued).toEqual([]);
	rmSync(join(projectDir(REPO), "queue.json"), { recursive: true });
	clock = new Date(T0.getTime() + 180_000);
	await e.tick();
	expect(readFileSync(cursor, "utf8")).not.toBe(before);
	expect(e.status().queued.map((r) => r.number)).toEqual([7]);
	expect(savedQueue().queued.map((r) => r.number)).toEqual([7]);
	expect(readRuns(REPO).map((r) => r.number)).toEqual([7]);
});

it("puts a run back in the queue when the queue cannot be saved as it starts, so a later tick starts it", async () => {
	writeApplied(REPO, sdlc());
	let finish: (result: AgentResult) => void = () => {};
	let launched = 0;
	const e = engine(1, () => {
		launched++;
		return new Promise((ok) => {
			finish = ok;
		});
	});
	await e.tick();
	items = [pullRequest(7), pullRequest(8)];
	clock = new Date(T0.getTime() + 120_000);
	await e.tick();
	await settle();
	expect(launched).toBe(1);
	// A directory where queue.json goes: saving the queue fails.
	rmSync(join(projectDir(REPO), "queue.json"));
	mkdirSync(join(projectDir(REPO), "queue.json"));
	finish(done);
	await settle();
	clock = new Date(T0.getTime() + 180_000);
	await e.tick();
	expect(e.status().active).toEqual([]);
	expect(e.status().queued.map((r) => r.number)).toEqual([8]);
	rmSync(join(projectDir(REPO), "queue.json"), { recursive: true });
	clock = new Date(T0.getTime() + 240_000);
	await e.tick();
	await settle();
	expect(launched).toBe(2);
	expect(e.status().active.map((r) => r.number)).toEqual([8]);
});

it("takes a pull request's pushes from its author, not from a commit's e-mail", async () => {
	writeApplied(REPO, sdlc());
	let sha = "a";
	const e = engine(0, neverEnds, {
		openPulls: async () => [{ number: 7, sha, author: "mallory", checks: [] }],
		commitAuthor: async () => "ada", // a commit can claim a maintainer's e-mail
	});
	await e.tick();
	sha = "b";
	clock = new Date(T0.getTime() + 120_000);
	await e.tick();
	expect(e.status().queued).toEqual([]);
});

it("never runs again a run the journal says ended, and removes interrupted worktrees", async () => {
	writeApplied(REPO, sdlc());
	const run: QueuedRun = {
		id: "ended",
		repository: REPO,
		automation: "review-pull-requests",
		number: 9,
		repoWide: false,
		event: {
			key: "k",
			event: "pull_request.opened",
			number: 9,
			isPullRequest: true,
			actor: "ada",
			at: T0.toISOString(),
		},
	};
	appendRun({
		id: "ended",
		repository: REPO,
		automation: run.automation,
		agent: "reviewer",
		event: run.event.event,
		isPullRequest: true,
		status: "succeeded",
		queuedAt: T0.toISOString(),
		endedAt: T0.toISOString(),
		outputs: [],
	});
	// The engine stopped after the journal, before the queue file.
	saveQueue(REPO, { queued: [], running: [run] });
	const unlabeled: string[] = [];
	const e = engine(0, neverEnds, {
		removeLabel: async (_repo, number, label) => {
			unlabeled.push(`#${number} ${label}`);
			return true;
		},
	});
	await e.tick();
	// It may have stopped before it took the working label off.
	expect(unlabeled).toEqual([`#9 ${WORKING_LABEL}`]);
	expect(e.status().queued).toEqual([]);
	expect(readRuns(REPO)[0]?.status).toBe("succeeded");
	expect(removed).toEqual([
		join(projectDir(REPO), "worktrees", "ended"),
		join(projectDir(REPO), "worktrees", "ended-merge"),
	]);
});

it("never queues again a run stopped after it wrote, and counts its whole budget when it said no cost", async () => {
	writeApplied(REPO, sdlc());
	const run: QueuedRun = {
		id: "wrote",
		repository: REPO,
		automation: "review-pull-requests",
		number: 9,
		repoWide: false,
		event: {
			key: "k",
			event: "pull_request.opened",
			number: 9,
			isPullRequest: true,
			actor: "ada",
			at: T0.toISOString(),
		},
	};
	appendRun({
		id: "wrote",
		repository: REPO,
		automation: run.automation,
		agent: "reviewer",
		event: run.event.event,
		isPullRequest: true,
		status: "running",
		queuedAt: T0.toISOString(),
		startedAt: T0.toISOString(),
		outputs: [{ action: "add_comment", summary: "comment", status: "applied" }],
	});
	saveQueue(REPO, { queued: [], running: [run] });
	const e = engine(0);
	await e.tick();
	expect(e.status().queued).toEqual([]);
	expect(readRuns(REPO)[0]).toMatchObject({
		id: "wrote",
		status: "failed",
		reason: "interrupted: the engine stopped",
		costUsd: 5,
	});
});

it("keeps who asked and when it was queued once a run starts", async () => {
	writeApplied(REPO, nightly());
	const e = engine(1, async () => done);
	await e.tick();
	requestRun(REPO, {
		id: "r1",
		automation: "nightly",
		isPullRequest: false,
		by: "Ada",
		at: T0.toISOString(),
	});
	clock = new Date(T0.getTime() + 60_000);
	await e.tick();
	await settle();
	expect(readRuns(REPO)[0]).toMatchObject({
		status: "succeeded",
		manual: "Ada",
		queuedAt: clock.toISOString(),
	});
	expect(logs).toContain(`queued ${REPO}: nightly (manual run by Ada)`);
});

it("starts nothing more once stopped", async () => {
	writeApplied(REPO, sdlc());
	let finish: () => void = () => {};
	let launches = 0;
	const e = engine(1, () => {
		launches += 1;
		return new Promise((ok) => {
			finish = () => ok(done);
		});
	});
	await e.tick();
	items = [pullRequest(7), pullRequest(8)];
	clock = new Date(T0.getTime() + 120_000);
	await e.tick();
	await settle();
	expect(launches).toBe(1);
	e.stop();
	finish();
	await settle();
	expect(launches).toBe(1);
	expect(e.status().queued.map((r) => r.number)).toEqual([8]);
});

it("keeps the clone on the default branch for the studio's wiki: at start and after each merge", async () => {
	writeApplied(
		REPO,
		sdlc({ "factory.yaml": `${sdlc()["factory.yaml"]}wiki: true\n` }),
	);
	const fetched: string[] = [];
	let head = "main1";
	const e = engine(
		0,
		neverEnds,
		{ branchHead: async () => head },
		{
			workspace: {
				...workspace,
				fetch: async (clone) => {
					fetched.push(clone);
				},
			},
		},
	);
	await e.tick();
	expect(fetched).toEqual([join(projectDir(REPO), "repo")]);
	await e.tick();
	expect(fetched).toHaveLength(1);
	head = "main2"; // a merge on the default branch
	clock = new Date(T0.getTime() + 120_000);
	await e.tick();
	expect(fetched).toHaveLength(2);

	// With the wiki off, the clone waits for the runs, as before.
	writeApplied(
		REPO,
		sdlc({ "factory.yaml": `${sdlc()["factory.yaml"]}wiki: false\n` }),
	);
	const off: string[] = [];
	const quiet = engine(
		0,
		neverEnds,
		{ branchHead: async () => head },
		{ workspace: { ...workspace, fetch: async (c) => void off.push(c) } },
	);
	await quiet.tick();
	head = "main3";
	clock = new Date(T0.getTime() + 240_000);
	await quiet.tick();
	expect(off).toEqual([]);
});

it("says why the applied factory does not load", async () => {
	writeApplied(REPO, { "factory.yaml": "name: Broken\n" });
	await engine(0).tick();
	expect(logs).toContain(
		`${REPO}: the applied factory does not load (factory.yaml: repository is required); run "openfabriq apply" again`,
	);
});
