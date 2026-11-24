import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Failure } from "../../src/learning/failures.js";
import { outsideLearning } from "../../src/learning/guard.js";
import {
	cameBack,
	groupIntoLessons,
	importedFolders,
	isImprovable,
	type Lesson,
	newFailures,
	nextToImprove,
	readLessons,
	resolvedByPullRequest,
	saveLessons,
	targetProblem,
	targetRefusalIn,
} from "../../src/learning/lessons.js";

const LOCK = JSON.stringify({
	version: 1,
	skills: {
		"skills/code-review": {
			source: "mattpocock/skills",
			sourceType: "github",
			ref: "main",
			commit: "a".repeat(40),
			skillPath: "code-review/SKILL.md",
			computedHash: "b".repeat(64),
		},
	},
});

const NOW = new Date("2026-11-23T08:00:00Z");
const failure = (id: string, agent = "coder"): Failure => ({
	id,
	kind: "check",
	run: id.split(":")[0] ?? id,
	agent,
	automation: "implement",
	at: "2026-11-20T10:00:00Z",
	summary: 'the check "test" failed (npm test)',
});
const lesson = (fields: Partial<Lesson> & { id: string }): Lesson => ({
	cause: "dates are not validated",
	rule: "Validate every date a user types.",
	target: "openfabriq/agents/coder/agent.md",
	failures: [{ id: "r0:check", agent: "coder", at: "2026-11-01T00:00:00Z" }],
	status: "candidate",
	createdAt: "2026-11-02T00:00:00Z",
	updatedAt: "2026-11-02T00:00:00Z",
	...fields,
});

describe("lessons", () => {
	it("are kept in lessons.jsonl, the last line of each winning", () => {
		process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "of-lessons-"));
		saveLessons("acme/app", [lesson({ id: "L1" }), lesson({ id: "L2" })]);
		saveLessons("acme/app", [lesson({ id: "L1", status: "rejected" })]);
		expect(readLessons("acme/app").map((l) => [l.id, l.status])).toEqual([
			["L1", "rejected"],
			["L2", "candidate"],
		]);
	});

	it("study the failures no lesson holds yet", () => {
		expect(
			newFailures(
				[failure("r0:check"), failure("r1:check")],
				[lesson({ id: "L1" })],
			).map((f) => f.id),
		).toEqual(["r1:check"]);
	});

	it("take each new failure into an existing lesson or a new one", () => {
		const grouped = groupIntoLessons(
			[lesson({ id: "L1" })],
			[failure("r1:check"), failure("r2:review", "writer")],
			[
				{ lesson: "L1", failures: ["r1:check"] },
				{
					cause: "the changelog is forgotten",
					rule: "Add a line to CHANGELOG.md.",
					target: "openfabriq/skills/changes/SKILL.md",
					failures: ["r2:review"],
				},
			],
			NOW,
			targetProblem,
		);
		expect(grouped).toMatchObject({
			changed: [
				{ id: "L1", failures: [{ id: "r0:check" }, { id: "r1:check" }] },
				{
					id: "L2",
					status: "candidate",
					failures: [
						{ id: "r2:review", agent: "writer", at: "2026-11-20T10:00:00Z" },
					],
				},
			],
		});
		// Two failures: the engine proposes an improvement for L1, not for L2.
		if ("lessons" in grouped)
			expect(nextToImprove(grouped.lessons, targetProblem)?.id).toBe("L1");
	});

	it("refuse groupings that leave out a failure, take one twice, or aim beyond skills and agent.md", () => {
		expect(
			groupIntoLessons(
				[],
				[failure("r1:check"), failure("r2:check")],
				[
					{
						cause: "c",
						rule: "r",
						target: "openfabriq/factory.yaml",
						failures: ["r1:check", "r1:check", "r9:check"],
					},
					{ lesson: "L7", failures: [] },
				],
				NOW,
				targetProblem,
			),
		).toEqual({
			problems: [
				"r1:check is in two lessons",
				"r9:check is not a failure of this batch",
				"every failure needs a lesson: r2:check",
				'"openfabriq/factory.yaml" is neither a Markdown file of a skill of the factory nor an agent.md: name one, like openfabriq/skills/<skill>/SKILL.md or openfabriq/agents/<agent>/agent.md',
				"L7 is not a lesson",
			],
		});
	});

	it("count runs, not failures, for the threshold: a run that failed its review and its checks is one incident", () => {
		const once = lesson({
			id: "L1",
			failures: [
				{ id: "r1:review", agent: "coder", at: "2026-11-01T00:00:00Z" },
				{ id: "r1:check", agent: "coder", at: "2026-11-01T00:00:00Z" },
			],
		});
		expect(nextToImprove([once], targetProblem)).toBeUndefined();
		const twice = {
			...once,
			failures: [
				...once.failures,
				{ id: "r2:check", agent: "coder", at: "2026-11-02T00:00:00Z" },
			],
		};
		expect(nextToImprove([twice], targetProblem)?.id).toBe("L1");
	});

	it("follow their improvement: merged is promoted, closed unmerged is rejected, and never proposed again", () => {
		const proposed = lesson({
			id: "L1",
			status: "proposed",
			failures: [
				{ id: "a", agent: "coder", at: "2026-11-01T00:00:00Z" },
				{ id: "b", agent: "coder", at: "2026-11-02T00:00:00Z" },
			],
			improvement: {
				url: "https://github.com/acme/app/pull/9",
				number: 9,
				run: "l1",
				at: "2026-11-03T00:00:00Z",
			},
		});
		expect(
			resolvedByPullRequest(proposed, { state: "OPEN" }, NOW),
		).toBeUndefined();
		expect(
			resolvedByPullRequest(
				proposed,
				{ state: "MERGED", mergedAt: "2026-11-04T00:00:00Z" },
				NOW,
			),
		).toMatchObject({ status: "promoted", mergedAt: "2026-11-04T00:00:00Z" });
		const rejected = resolvedByPullRequest(proposed, { state: "CLOSED" }, NOW);
		expect(rejected?.status).toBe("rejected");
		expect(
			nextToImprove(rejected ? [rejected] : [], targetProblem),
		).toBeUndefined();
	});

	it("count the failures that came back once their improvement ran: after the first apply that followed GitHub's merge", () => {
		const promoted = lesson({
			id: "L1",
			status: "promoted",
			mergedAt: "2026-11-05T00:00:00Z",
			resolvedAt: "2026-11-10T00:00:00Z",
			failures: [
				{ id: "a", agent: "coder", at: "2026-11-01T00:00:00Z" },
				{ id: "b", agent: "coder", at: "2026-11-07T00:00:00Z" },
				{ id: "c", agent: "coder", at: "2026-11-12T00:00:00Z" },
			],
		});
		// Merged, not applied yet: nothing came back.
		expect(cameBack(promoted, ["2026-11-04T00:00:00Z"])).toEqual([]);
		const applies = [
			"2026-11-04T00:00:00Z",
			"2026-11-06T00:00:00Z",
			"2026-11-11T00:00:00Z",
		];
		expect(cameBack(promoted, applies).map((f) => f.id)).toEqual(["b", "c"]);
		// An older lesson has only the batch that saw it merged.
		const { mergedAt: _, ...older } = promoted;
		expect(cameBack(older, applies).map((f) => f.id)).toEqual(["c"]);
	});

	it("wait for a new failure once their improvement was asked for and came to nothing", () => {
		const failures = [
			{ id: "r1:check", agent: "coder", at: "2026-11-01T00:00:00Z" },
			{ id: "r2:check", agent: "coder", at: "2026-11-02T00:00:00Z" },
		];
		const tried = lesson({
			id: "L1",
			failures,
			updatedAt: "2026-11-02T00:00:00Z",
			triedAt: "2026-11-03T00:00:00Z",
		});
		expect(nextToImprove([tried], targetProblem)).toBeUndefined();
		const grouped = groupIntoLessons(
			[tried],
			[{ ...failure("r3:check"), url: "https://github.com/acme/app/issues/4" }],
			[{ lesson: "L1", failures: ["r3:check"] }],
			NOW,
			targetProblem,
		);
		if (!("lessons" in grouped)) throw new Error(grouped.problems.join());
		expect(nextToImprove(grouped.lessons, targetProblem)?.id).toBe("L1");
		// The failure keeps its subject, so the improvement links it once the journal drops the run.
		expect(grouped.lessons[0]?.failures.at(-1)).toMatchObject({
			id: "r3:check",
			url: "https://github.com/acme/app/issues/4",
		});
	});

	it("never aim at a skill imported from a public repository, nor at an agent.md or SKILL.md that is not there", () => {
		const worktree = mkdtempSync(join(tmpdir(), "of-target-"));
		mkdirSync(join(worktree, "openfabriq/agents/coder"), { recursive: true });
		writeFileSync(join(worktree, "openfabriq/agents/coder/agent.md"), "");
		const whyNot = targetRefusalIn(worktree, importedFolders(LOCK));
		expect(whyNot("openfabriq/agents/coder/agent.md")).toBeUndefined();
		expect(whyNot("openfabriq/skills/dates/reference.md")).toBeUndefined();
		expect(whyNot("openfabriq/skills/code-review/SKILL.md")).toContain(
			"skills/code-review, a skill imported from a public repository",
		);
		expect(whyNot("openfabriq/skills/dates/SKILL.md")).toContain(
			"does not exist",
		);
		// A lesson whose target became an imported skill waits, instead of being refused each batch.
		const waiting = lesson({
			id: "L1",
			target: "openfabriq/skills/code-review/SKILL.md",
			failures: [
				{ id: "r1:check", agent: "coder", at: "2026-11-01T00:00:00Z" },
				{ id: "r2:check", agent: "coder", at: "2026-11-02T00:00:00Z" },
			],
		});
		expect(nextToImprove([waiting], targetProblem)?.id).toBe("L1");
		expect(nextToImprove([waiting], whyNot)).toBeUndefined();
		expect(importedFolders("not json")).toEqual([]);
	});

	it.each([
		["openfabriq/skills/testing/SKILL.md", true],
		["openfabriq/skills/testing/reference/dates.md", true],
		["openfabriq/qa/skills/testing/SKILL.md", true],
		["openfabriq/agents/coder/skills/dates/SKILL.md", true],
		["openfabriq/agents/coder/agent.md", true],
		["openfabriq/qa/agents/tester/agent.md", true],
		["openfabriq/skills/testing/run.sh", false],
		["openfabriq/factory.yaml", false],
		["openfabriq/automations/implement/automation.md", false],
		["openfabriq/skills/../factory.md", false],
		["src/app.ts", false],
	])("may change %s: %s", (path, ok) => {
		expect(isImprovable(path)).toBe(ok);
	});
});

describe("the guard of learning's pull requests", () => {
	const agentMd = (header: string) => `---\n${header}\n---\nDo things.\n`;
	const versions =
		(start: string | undefined, head: string | undefined) => async () => ({
			...(start !== undefined ? { start } : {}),
			...(head !== undefined ? { head } : {}),
		});

	it("lets the body of an agent.md and a skill's Markdown change", async () => {
		const md = agentMd("description: Codes");
		expect(
			await outsideLearning(
				["openfabriq/agents/coder/agent.md", "openfabriq/skills/x/SKILL.md"],
				versions(md, `${md}\nValidate dates.\n`),
			),
		).toBeUndefined();
	});

	it("keeps a SKILL.md's front matter, and a skill imported from a public repository, as they are", async () => {
		const skill = (header: string) => `---\n${header}\n---\n# Review\n`;
		expect(
			await outsideLearning(
				["openfabriq/skills/x/SKILL.md"],
				versions(skill("name: x"), skill("name: x\nallowed-tools: Bash")),
			),
		).toContain("front matter of openfabriq/skills/x/SKILL.md");
		const withLock = async (path: string) =>
			path === "openfabriq/imported-skills.json"
				? { start: LOCK, head: LOCK }
				: { start: "# A\n", head: "# A, and more\n" };
		expect(
			await outsideLearning(
				["openfabriq/skills/code-review/reference.md"],
				withLock,
			),
		).toContain("a skill imported from a public repository");
		expect(
			await outsideLearning(["openfabriq/skills/dates/reference.md"], withLock),
		).toBeUndefined();
	});

	it("refuses another file, a changed front matter, a new agent.md, a removed file", async () => {
		expect(
			await outsideLearning(
				["openfabriq/factory.yaml", "openfabriq/skills/x/SKILL.md"],
				versions("", ""),
			),
		).toContain("change openfabriq/factory.yaml:");
		const path = ["openfabriq/agents/coder/agent.md"];
		expect(
			await outsideLearning(
				path,
				versions(
					agentMd("description: Codes"),
					agentMd("description: Codes\ntools: [read, edit, shell]"),
				),
			),
		).toContain("front matter of openfabriq/agents/coder/agent.md");
		expect(
			await outsideLearning(path, versions(undefined, agentMd("x: y"))),
		).toContain("front matter");
		expect(
			await outsideLearning(path, versions(agentMd("x: y"), undefined)),
		).toContain("remove openfabriq/agents/coder/agent.md");
		expect(
			await outsideLearning(
				["openfabriq/skills/x/SKILL.md"],
				versions("# X\n", undefined),
			),
		).toContain("never removes a file");
	});
});
