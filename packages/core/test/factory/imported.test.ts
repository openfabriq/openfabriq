import { describe, expect, it } from "vitest";
import {
	IMPORTED_SKILLS,
	type ImportedSkills,
	readImportedSkills,
	skillFolder,
	skillPlace,
	withDeclaredSkill,
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

	it("is valid when each entry has its folder and its declaration", () => {
		expect(
			errors({
				"factory.yaml": `${FACTORY}skills:\n  code-review: mattpocock/skills\n`,
				"skills/code-review/SKILL.md": SKILL,
				[IMPORTED_SKILLS]: lock({ "skills/code-review": ENTRY }),
			}),
		).toEqual([]);
	});

	it("refuses an entry whose folder is gone, or that factory.yaml does not declare", () => {
		expect(
			errors({ [IMPORTED_SKILLS]: lock({ "skills/code-review": ENTRY }) }),
		).toEqual([
			`${IMPORTED_SKILLS}: lists skills/code-review, which is not a skill folder of the factory: run "openfabriq skill remove skills/code-review"`,
			`${IMPORTED_SKILLS}: imports skills/code-review, which factory.yaml's skills does not declare: declare it, or run "openfabriq skill remove skills/code-review"`,
		]);
	});

	it("says what is wrong with a broken file", () => {
		expect(errors({ [IMPORTED_SKILLS]: "{" })).toEqual([
			`${IMPORTED_SKILLS}: is not JSON; "openfabriq skill add" writes it, never edit it by hand`,
		]);
		const [problem] = errors({
			"factory.yaml": `${FACTORY}skills:\n  code-review: mattpocock/skills\n`,
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

describe("factory.yaml's skills", () => {
	const AGENT = "---\ndescription: Tests\n---\nTest.\n";
	const withSkills = (skills: string, more: FactoryFiles = {}) =>
		errors({
			"factory.yaml": `${FACTORY}skills:\n${skills}`,
			"qa/agents/tester/agent.md": AGENT,
			...more,
		});

	it("declares a shared skill, an agent's and an area's, each matched to its imported folder", () => {
		const entry = (folder: string) => ({
			[`${folder}/SKILL.md`]: SKILL,
		});
		expect(
			withSkills(
				"  code-review: mattpocock/skills\n  tdd: { from: mattpocock/skills, agent: tester }\n  owasp: { from: acme/sec, area: qa }\n",
				{
					...entry("skills/code-review"),
					...entry("qa/agents/tester/skills/tdd"),
					...entry("qa/skills/owasp"),
					[IMPORTED_SKILLS]: lock({
						"skills/code-review": ENTRY,
						"qa/agents/tester/skills/tdd": ENTRY,
						"qa/skills/owasp": { ...ENTRY, source: "acme/sec" },
					}),
				},
			),
		).toEqual([]);
	});

	it("says how to import a skill declared but not imported, or imported from elsewhere", () => {
		expect(
			withSkills(
				"  tdd: { from: mattpocock/skills, agent: tester }\n  code-review: acme/fork\n",
				{
					"skills/code-review/SKILL.md": SKILL,
					[IMPORTED_SKILLS]: lock({ "skills/code-review": ENTRY }),
				},
			),
		).toEqual([
			'factory.yaml: skills.code-review: declared from acme/fork, but imported from mattpocock/skills: run "openfabriq skill add acme/fork code-review"',
			'factory.yaml: skills.tdd: declared, but not imported: run "openfabriq skill add mattpocock/skills tdd --agent tester"',
		]);
	});

	it("refuses an unknown agent or area, both at once, and a name no folder can take", () => {
		expect(
			withSkills(
				"  a: { from: x/y, agent: testr }\n  b: { from: x/y, area: ops }\n",
			),
		).toEqual([
			'factory.yaml: skills.a: agent "testr" does not exist. Did you mean "tester"?',
			'factory.yaml: skills.b: area "ops" does not exist. Use one of: qa',
		]);
		expect(
			withSkills("  c: { from: x/y, agent: tester, area: qa }\n").join(),
		).toContain("takes agent or area, not both");
		expect(withSkills("  Code_Review: x/y\n").join()).toContain(
			"a skill's name is lowercase letters, digits and -",
		);
		expect(withSkills("  c: -x/y\n").join()).toContain(
			"is a GitHub repository, like mattpocock/skills",
		);
	});
});

describe("declaring a skill in factory.yaml", () => {
	const YAML =
		"# The factory\nname: F # its name\nrepository: acme/app\nmaintainers: [alice]\n";

	it("adds a shared skill on one line and an agent's as { from, agent }, keeping the comments", () => {
		let text = withDeclaredSkill(YAML, "code-review", {
			from: "mattpocock/skills",
		});
		text = withDeclaredSkill(text, "tdd", {
			from: "mattpocock/skills",
			agent: "tester",
		});
		expect(text).toBe(
			`${YAML}skills:\n  code-review: mattpocock/skills\n  tdd: { from: mattpocock/skills, agent: tester }\n`,
		);
	});

	it("replaces a declaration, then removes it, and the section once empty", () => {
		const once = withDeclaredSkill(YAML, "tdd", { from: "mattpocock/skills" });
		const moved = withDeclaredSkill(once, "tdd", {
			from: "acme/fork",
			area: "qa",
		});
		expect(moved).toContain("tdd: { from: acme/fork, area: qa }");
		expect(withDeclaredSkill(moved, "tdd", undefined)).toBe(YAML);
	});

	it("changes only the skill's own line, so the others keep their comments", () => {
		const text = `${YAML}skills:\n  # what we import\n  code-review: mattpocock/skills   # shared by every agent\n  web:\n    from: vercel-labs/agent-skills\n    area: qa # by hand\n# about the model\nmodel: opus\n`;
		const added = withDeclaredSkill(text, "tdd", {
			from: "mattpocock/skills",
			agent: "tester",
		});
		expect(added).toBe(
			text.replace(
				"# by hand\n",
				"# by hand\n  tdd: { from: mattpocock/skills, agent: tester }\n",
			),
		);
		expect(
			withDeclaredSkill(added, "code-review", { from: "acme/fork" }),
		).toContain(
			"# what we import\n  code-review: acme/fork\n  web:\n    from: vercel-labs/agent-skills\n    area: qa # by hand\n",
		);
		expect(withDeclaredSkill(added, "tdd", undefined)).toBe(text);
		expect(withDeclaredSkill(text, "web", undefined)).toBe(
			text.replace(
				"  web:\n    from: vercel-labs/agent-skills\n    area: qa # by hand\n",
				"",
			),
		);
	});

	it("rewrites a skills section in the middle of the file, and leaves what follows", () => {
		const text = `${YAML}skills:\n  tdd: mattpocock/skills # tests first\nmodel: opus\n`;
		expect(withDeclaredSkill(text, "tdd", { from: "acme/fork" })).toBe(
			`${YAML}skills:\n  tdd: acme/fork\nmodel: opus\n`,
		);
		expect(withDeclaredSkill(text, "tdd", undefined)).toBe(
			`${YAML}model: opus\n`,
		);
	});
});
