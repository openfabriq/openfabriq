import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readFactoryFolder } from "../../src/files.js";
import { applyMergedRules, withMergedRule } from "../../src/learning/apply.js";
import {
	type Lesson,
	readLessons,
	saveLessons,
} from "../../src/learning/lessons.js";
import {
	projectDir,
	readApplies,
	writeApplied,
} from "../../src/state/projects.js";

const ROOT = join(import.meta.dirname, "../../../..");
const REPO = "acme/app";
const FACTORY = readFactoryFolder(
	join(ROOT, "fixtures/valid/learning/openfabriq"),
);
const AGENT = "openfabriq/agents/coder/agent.md";
const RULE = "Run the tests before you finish.";
const withRule = (text: string) => `${text.trimEnd()}\n\n${RULE}\n`;
const NOW = new Date("2026-11-26T10:00:00Z");

const lesson = (id: string, number: number, target = AGENT): Lesson => ({
	id,
	cause: "the tests are not run",
	rule: RULE,
	target,
	failures: [],
	status: "proposed",
	improvement: {
		url: `https://github.com/${REPO}/pull/${number}`,
		number,
		run: "learning-1",
		at: "2026-11-25T00:00:00Z",
	},
	createdAt: "2026-11-24T00:00:00Z",
	updatedAt: "2026-11-25T00:00:00Z",
});

describe("a merged rule of learning", () => {
	it("applies its one file, as the default branch has it", () => {
		const merged = withRule(FACTORY["agents/coder/agent.md"] ?? "");
		expect(withMergedRule(FACTORY, AGENT, merged)).toEqual({
			...FACTORY,
			"agents/coder/agent.md": merged,
		});
	});

	it("waits for a person's apply when its file is not a rule's, not applied yet, or has a new front matter", () => {
		expect(withMergedRule(FACTORY, "openfabriq/factory.yaml", "x")).toEqual({
			problem: "openfabriq/factory.yaml is not a file learning improves",
		});
		expect(
			withMergedRule(FACTORY, "openfabriq/agents/tester/agent.md", "x"),
		).toEqual({
			problem:
				"openfabriq/agents/tester/agent.md is not in the applied factory",
		});
		expect(
			withMergedRule(
				FACTORY,
				AGENT,
				"---\ndescription: Writes code\ntools: [read, edit, shell, web]\n---\nWrite it.\n",
			),
		).toEqual({
			problem: `the front matter of ${AGENT} changed since the factory was applied`,
		});
	});
});

describe("the engine, after a merge", () => {
	beforeEach(() => {
		process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "of-apply-"));
		writeApplied(REPO, FACTORY, new Date("2026-11-20T00:00:00Z"));
	});

	it("applies the rules merged, declines those closed, and leaves the open ones", async () => {
		saveLessons(REPO, [lesson("L1", 7), lesson("L2", 8), lesson("L3", 9)]);
		const states: Record<number, Record<string, unknown>> = {
			7: { state: "MERGED", mergedAt: "2026-11-26T09:00:00Z" },
			8: { state: "CLOSED" },
			9: { state: "OPEN" },
		};
		const lines: string[] = [];
		const { applied, unread } = await applyMergedRules(REPO, {
			github: { subject: async (_r, number) => states[number] ?? {} },
			readMerged: async (path) =>
				path === AGENT
					? withRule(FACTORY["agents/coder/agent.md"] ?? "")
					: undefined,
			log: (line) => lines.push(line),
			now: () => NOW,
		});
		expect(applied.map((l) => l.id)).toEqual(["L1"]);
		expect(unread).toBe(false);
		expect(
			readFactoryFolder(join(projectDir(REPO), "factory"))[
				"agents/coder/agent.md"
			],
		).toContain(RULE);
		// The apply counts: from it, the same mistake counts as coming back.
		expect(readApplies(REPO)).toEqual([
			{ at: "2026-11-20T00:00:00.000Z" },
			{ at: NOW.toISOString(), lessons: ["L1"] },
		]);
		expect(readLessons(REPO).map((l) => [l.id, l.status])).toEqual([
			["L1", "promoted"],
			["L2", "rejected"],
			["L3", "proposed"],
		]);
		expect(lines).toEqual([
			`${REPO}: applied learning's rule L1 (#7) to ${AGENT}`,
		]);
	});

	it("says so when a merged rule cannot apply on its own", async () => {
		saveLessons(REPO, [lesson("L1", 7)]);
		const lines: string[] = [];
		const { applied } = await applyMergedRules(REPO, {
			github: { subject: async () => ({ state: "MERGED" }) },
			readMerged: async () => undefined,
			log: (line) => lines.push(line),
			now: () => NOW,
		});
		expect(applied).toEqual([]);
		expect(readApplies(REPO)).toHaveLength(1);
		expect(lines).toEqual([
			`${REPO}: learning's rule L1 (#7) is merged, not applied: ${AGENT} is not on the default branch. Run "openfabriq apply".`,
		]);
		// Promoted, not applied: the next look applies it, without asking GitHub again.
		const again = await applyMergedRules(REPO, {
			github: {
				subject: async () => {
					throw new Error("not asked");
				},
			},
			readMerged: async () => withRule(FACTORY["agents/coder/agent.md"] ?? ""),
			log: () => {},
			now: () => NOW,
		});
		expect(again.applied.map((l) => l.id)).toEqual(["L1"]);
		expect(again.unread).toBe(false);
	});

	it("applies a rule a batch promoted first, and leaves one a person applied since", async () => {
		const promoted = (id: string): Lesson => ({
			...lesson(id, 7),
			status: "promoted",
			mergedAt: "2026-11-19T00:00:00Z",
		});
		saveLessons(REPO, [promoted("L1")]);
		// L1 merged before the person's apply of 2026-11-20: that apply carried it.
		const before = await applyMergedRules(REPO, {
			github: { subject: async () => ({}) },
			readMerged: async () => {
				throw new Error("an applied rule is not read again");
			},
			log: () => {},
			now: () => NOW,
		});
		expect(before.applied).toEqual([]);
		saveLessons(REPO, [
			{ ...promoted("L2"), mergedAt: "2026-11-25T00:00:00Z" },
		]);
		const after = await applyMergedRules(REPO, {
			github: { subject: async () => ({}) },
			readMerged: async () => withRule(FACTORY["agents/coder/agent.md"] ?? ""),
			log: () => {},
			now: () => NOW,
		});
		expect(after.applied.map((l) => l.id)).toEqual(["L2"]);
	});
});
