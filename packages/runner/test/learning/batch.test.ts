import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Factory, LEARNING_FOLDER } from "@openfabriq/core";
import { beforeEach, describe, expect, it } from "vitest";
import { takeRequests } from "../../src/engine/requests.js";
import type { GitHub } from "../../src/github/github.js";
import { prepareBatch } from "../../src/learning/batch.js";
import { readLessons, saveLessons } from "../../src/learning/lessons.js";
import type { RunRecord } from "../../src/state/journal.js";
import { projectDir } from "../../src/state/projects.js";

const REPO = "acme/app";
const NOW = () => new Date("2026-11-23T08:00:00Z");
const factory = {
	automations: { implement: { from: "maintainers" } },
} as unknown as Factory;

const failed = (id: string, at: string): RunRecord => ({
	id,
	repository: REPO,
	automation: "implement",
	agent: "coder",
	event: "issue.labeled",
	number: 4,
	url: "https://github.com/acme/app/issues/4",
	isPullRequest: false,
	status: "failed",
	reason: 'the check "test" failed (npm test)',
	queuedAt: at,
	endedAt: at,
	outputs: [],
});

const github = (states: Record<number, string> = {}) =>
	({
		subject: async (_repo: string, number: number) => ({
			state: states[number] ?? "OPEN",
			...(states[number] === "MERGED"
				? { mergedAt: "2026-11-05T00:00:00Z" }
				: {}),
		}),
		reviews: async () => [],
	}) as unknown as GitHub;

let worktree: string;
beforeEach(() => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "of-learning-"));
	worktree = mkdtempSync(join(tmpdir(), "of-worktree-"));
	// The agent.md the lessons go into: a target must exist.
	mkdirSync(join(worktree, "openfabriq/agents/coder"), { recursive: true });
	writeFileSync(join(worktree, "openfabriq/agents/coder/agent.md"), "");
});

const batch = (runs: RunRecord[], gh = github()) =>
	prepareBatch({
		repository: REPO,
		factory,
		runs,
		github: gh,
		worktree,
		now: NOW,
	});

/** Calls the record_lessons tool as the agent would. */
async function record(
	tool: { handler: (input: never, extra: never) => Promise<unknown> },
	lessons: unknown,
) {
	const answer = (await tool.handler({ lessons } as never, {} as never)) as {
		content: { text: string }[];
		isError?: boolean;
	};
	return { text: answer.content[0]?.text ?? "", error: answer.isError };
}

describe("a batch of learning", () => {
	it("has nothing to do without a new failure or a lesson waiting", async () => {
		expect(await batch([])).toBeUndefined();
		expect(existsSync(join(worktree, LEARNING_FOLDER))).toBe(false);
	});

	it("stages each new failure with what tells why, records the lessons, and asks for the improvement once a lesson has two", async () => {
		const runs = [
			failed("r2", "2026-11-21T10:00:00Z"),
			failed("r1", "2026-11-20T10:00:00Z"),
		];
		const dir = join(projectDir(REPO), "runs", "r1");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "commands.jsonl"),
			`${JSON.stringify({ kind: "check", name: "test", command: "npm test", ok: false, output: "expected <2>", durationMs: 1, at: "" })}\n`,
		);
		const learning = await batch(runs);
		if (!learning) throw new Error("a batch");
		const staged = join(worktree, LEARNING_FOLDER);
		expect(readdirSync(join(staged, "failures")).sort()).toEqual([
			"r1-check.json",
			"r2-check.json",
		]);
		const evidence = readFileSync(
			join(staged, "failures/r1-check.json"),
			"utf8",
		);
		expect(evidence).toContain('"output": "expected \\u003c2>"');
		expect(readFileSync(join(staged, "README.md"), "utf8")).toContain(
			"2 new failures",
		);
		expect(learning.improving()).toBeUndefined();

		const [tool] = learning.tools;
		if (!tool) throw new Error("record_lessons");
		expect(
			await record(tool, [
				{ cause: "c", rule: "r", target: "src/a.ts", failures: ["r1:check"] },
			]),
		).toMatchObject({ error: true });
		const answer = await record(tool, [
			{
				cause: "tests are not run before finishing",
				rule: "Run the tests before you finish.",
				target: "openfabriq/agents/coder/agent.md",
				failures: ["r1:check", "r2:check"],
			},
		]);
		expect(answer.text).toContain("Improve lesson L1 now");
		expect(readLessons(REPO).map((l) => [l.id, l.failures.length])).toEqual([
			["L1", 2],
		]);
		expect(learning.improving()?.id).toBe("L1");

		const reviewed = learning.review({
			accepted: [
				{
					action: "create_pull_request",
					title: "learning: run tests",
					body: "Adds a line.",
				},
			],
			refused: [],
		});
		const body =
			reviewed.accepted[0]?.action === "create_pull_request"
				? reviewed.accepted[0].body
				: "";
		expect(body).toContain("### Lesson L1");
		expect(body).toContain(
			'- #4 (implement, coder): the check "test" failed (npm test) https://github.com/acme/app/issues/4',
		);

		learning.finish(
			[
				{
					action: "create_pull_request",
					status: "applied",
					summary: "learning: run tests",
					url: "https://github.com/acme/app/pull/9",
				},
			],
			"l1",
		);
		expect(readLessons(REPO)[0]).toMatchObject({
			status: "proposed",
			improvement: { number: 9, run: "l1" },
		});
		// No other lesson waits: no next batch asked for.
		expect(takeRequests(REPO)).toEqual([]);
	});

	it("asks for the next batch at once when another lesson waits for its improvement", async () => {
		const waiting = (id: string) => ({
			id,
			cause: "c",
			rule: "r",
			target: "openfabriq/agents/coder/agent.md",
			failures: [
				{ id: `${id}a:check`, agent: "coder", at: "2026-11-01T00:00:00Z" },
				{ id: `${id}b:check`, agent: "coder", at: "2026-11-02T00:00:00Z" },
			],
			status: "candidate" as const,
			createdAt: "2026-11-02T00:00:00Z",
			updatedAt: "2026-11-02T00:00:00Z",
		});
		saveLessons(REPO, [waiting("L1"), waiting("L2")]);
		const learning = await batch([]);
		if (!learning) throw new Error("a lesson waits");
		expect(learning.improving()?.id).toBe("L1");
		learning.finish(
			[
				{
					action: "create_pull_request",
					status: "applied",
					summary: "learning: L1",
					url: "https://github.com/acme/app/pull/9",
				},
			],
			"l1",
		);
		expect(takeRequests(REPO)).toMatchObject([
			{ id: "learning-l1", automation: "learning", by: "learning" },
		]);
	});

	it("refuses a pull request no lesson asked for", async () => {
		const learning = await batch([failed("r1", "2026-11-20T10:00:00Z")]);
		const reviewed = learning?.review({
			accepted: [{ action: "create_pull_request", title: "t", body: "b" }],
			refused: [],
		});
		expect(reviewed).toEqual({
			accepted: [],
			refused: [
				expect.objectContaining({
					status: "refused",
					reason:
						"learning opens a pull request only for the lesson the engine asks to improve",
				}),
			],
		});
	});

	it("reads its improvements on GitHub: merged promoted, closed rejected; and takes the next lesson that waits", async () => {
		const base = {
			cause: "c",
			rule: "r",
			target: "openfabriq/agents/coder/agent.md",
			createdAt: "2026-11-01T00:00:00Z",
			updatedAt: "2026-11-01T00:00:00Z",
			failures: [
				{ id: "r1:check", agent: "coder", at: "2026-11-01T00:00:00Z" },
				{ id: "r2:check", agent: "coder", at: "2026-11-02T00:00:00Z" },
			],
		};
		const improvement = (number: number) => ({
			url: `https://github.com/acme/app/pull/${number}`,
			number,
			run: "l0",
			at: "2026-11-03T00:00:00Z",
		});
		saveLessons(REPO, [
			{ ...base, id: "L1", status: "proposed", improvement: improvement(7) },
			{ ...base, id: "L2", status: "proposed", improvement: improvement(8) },
			{ ...base, id: "L3", status: "candidate" },
			{ ...base, id: "L4", status: "candidate" },
		]);
		const learning = await batch([], github({ 7: "MERGED", 8: "CLOSED" }));
		expect(readLessons(REPO)[0]?.mergedAt).toBe("2026-11-05T00:00:00Z");
		expect(readLessons(REPO).map((l) => [l.id, l.status])).toEqual([
			["L1", "promoted"],
			["L2", "rejected"],
			["L3", "candidate"],
			["L4", "candidate"],
		]);
		expect(learning?.tools).toEqual([]);
		expect(learning?.improving()?.id).toBe("L3");
		learning?.finish(
			[
				{
					action: "create_pull_request",
					status: "applied",
					summary: "s",
					url: "https://github.com/acme/app/pull/10",
				},
			],
			"l1",
		);
		// L4 still waits: the next batch is asked for at once.
		expect(takeRequests(REPO)).toMatchObject([
			{ automation: "learning", by: "learning" },
		]);
	});
});
