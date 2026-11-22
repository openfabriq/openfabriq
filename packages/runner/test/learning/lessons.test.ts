import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Failure } from "../../src/learning/failures.js";
import { outsideLearning } from "../../src/learning/guard.js";
import {
	cameBack,
	followed,
	group,
	isImprovable,
	type Lesson,
	newFailures,
	nextToImprove,
	readLessons,
	saveLessons,
} from "../../src/learning/lessons.js";

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
		const grouped = group(
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
			expect(nextToImprove(grouped.lessons)?.id).toBe("L1");
	});

	it("refuse groupings that leave out a failure, take one twice, or aim beyond skills and agent.md", () => {
		expect(
			group(
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
		expect(followed(proposed, "OPEN", NOW)).toBeUndefined();
		expect(followed(proposed, "MERGED", NOW)?.status).toBe("promoted");
		const rejected = followed(proposed, "CLOSED", NOW);
		expect(rejected?.status).toBe("rejected");
		expect(nextToImprove(rejected ? [rejected] : [])).toBeUndefined();
	});

	it("count the failures that came back after their improvement was merged", () => {
		const promoted = lesson({
			id: "L1",
			status: "promoted",
			resolvedAt: "2026-11-10T00:00:00Z",
			failures: [
				{ id: "a", agent: "coder", at: "2026-11-01T00:00:00Z" },
				{ id: "c", agent: "coder", at: "2026-11-12T00:00:00Z" },
			],
		});
		expect(cameBack(promoted).map((f) => f.id)).toEqual(["c"]);
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

	it("refuses another file, a changed front matter, a new or removed agent.md", async () => {
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
		).toContain("front matter");
	});
});
