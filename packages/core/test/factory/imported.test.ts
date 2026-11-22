import { describe, expect, it } from "vitest";
import {
	IMPORTED_SKILLS,
	type ImportedSkills,
	readImportedSkills,
	skillFolder,
	skillPlace,
} from "../../src/factory/imported.js";
import { loadFactory } from "../../src/factory/load.js";
import type { FactoryFiles } from "../../src/factory/types.js";

describe("an imported skill's folder", () => {
	it("is built from its name and place, and read back", () => {
		const cases = [
			[{}, "skills/tdd"],
			[{ area: "qa" }, "qa/skills/tdd"],
			[{ agent: "reviewer" }, "agents/reviewer/skills/tdd"],
			[{ agent: "tester", area: "qa" }, "qa/agents/tester/skills/tdd"],
		] as const;
		for (const [place, folder] of cases) {
			expect(skillFolder("tdd", place)).toBe(folder);
			expect(skillPlace(folder)).toEqual({ name: "tdd", place });
		}
		expect(skillPlace("agents/reviewer/agent.md")).toBeUndefined();
		for (const outside of [
			"../skills/x",
			"skills/..",
			"qa/../skills/x",
			"../../.ssh",
		])
			expect(skillPlace(outside)).toBeUndefined();
	});
});

const FACTORY = "name: F\nrepository: acme/app\nmaintainers: [alice]\n";
const SKILL = "---\nname: code-review\ndescription: Reviews\n---\nReview.\n";
const ENTRY = {
	source: "mattpocock/skills",
	sourceType: "github" as const,
	ref: "main",
	commit: "a".repeat(40),
	skillPath: "skills/code-review/SKILL.md",
	computedHash: "b".repeat(64),
};
const lock = (skills: Record<string, unknown>) =>
	JSON.stringify({ version: 1, skills });

const errors = (files: FactoryFiles) =>
	loadFactory({ "factory.yaml": FACTORY, ...files })
		.problems.filter((p) => p.level === "error")
		.map((p) => `${p.file}: ${p.message}`);

describe("imported-skills.json", () => {
	it("reads its entries by folder", () => {
		const read = readImportedSkills(lock({ "skills/code-review": ENTRY }));
		expect(read).toEqual({
			version: 1,
			skills: { "skills/code-review": ENTRY },
		} satisfies ImportedSkills);
	});

	it("is valid when each entry has its folder", () => {
		expect(
			errors({
				"skills/code-review/SKILL.md": SKILL,
				[IMPORTED_SKILLS]: lock({ "skills/code-review": ENTRY }),
			}),
		).toEqual([]);
	});

	it("refuses an entry whose folder is gone", () => {
		expect(
			errors({ [IMPORTED_SKILLS]: lock({ "skills/code-review": ENTRY }) }),
		).toEqual([
			`${IMPORTED_SKILLS}: lists skills/code-review, which is not a skill folder of the factory: run "openfabriq skill remove skills/code-review"`,
		]);
	});

	it("says what is wrong with a broken file", () => {
		expect(errors({ [IMPORTED_SKILLS]: "{" })).toEqual([
			`${IMPORTED_SKILLS}: is not JSON; "openfabriq skill add" writes it, never edit it by hand`,
		]);
		const [problem] = errors({
			"skills/code-review/SKILL.md": SKILL,
			[IMPORTED_SKILLS]: lock({
				"skills/code-review": { ...ENTRY, commit: "main" },
			}),
		});
		expect(problem).toMatch(
			new RegExp(`^${IMPORTED_SKILLS}: skills.skills/code-review.commit: `),
		);
	});
});

describe("what imported-skills.json may hold", () => {
	const problems = (skills: Record<string, unknown>) => {
		const read = readImportedSkills(lock(skills));
		return Array.isArray(read) ? read : [];
	};

	it("refuses a key that is no skill folder, so skill remove never deletes outside openfabriq/", () => {
		expect(problems({ "../../.ssh": ENTRY })).toEqual([
			"skills.../../.ssh: is a skill's folder in openfabriq/, like skills/code-review",
		]);
	});

	it("refuses a repository a command would read as an option, or whose name leads elsewhere", () => {
		for (const source of ["-x/skills", "acme/..", "acme/.", "acme/-x", "acme"])
			expect(problems({ "skills/s": { ...ENTRY, source } })).toEqual([
				"skills.skills/s.source: is a GitHub repository, like mattpocock/skills",
			]);
		expect(
			problems({ "skills/s": { ...ENTRY, source: "acme/.github" } }),
		).toEqual([]);
	});

	it("refuses a branch or a path with characters a terminal or a URL would read", () => {
		expect(
			problems({ "skills/s": { ...ENTRY, ref: "main\u001b[2J" } }),
		).toEqual(["skills.skills/s.ref: is a branch's name"]);
		expect(
			problems({ "skills/s": { ...ENTRY, skillPath: "../x/SKILL.md" } }),
		).toEqual([
			"skills.skills/s.skillPath: is the path of a SKILL.md in the repository",
		]);
	});
});
