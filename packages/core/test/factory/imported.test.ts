import { describe, expect, it } from "vitest";
import {
	IMPORTED_SKILLS,
	type ImportedSkills,
	isHashed,
	readImportedSkills,
	skillHash,
} from "../../src/factory/imported.js";
import { loadFactory } from "../../src/factory/load.js";
import type { FactoryFiles } from "../../src/factory/types.js";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("the hash of a skill, the same as the skills CLI's", () => {
	// The test vectors of the skills CLI's README, "Lock File Content Hash".
	it("matches the skills CLI's test vectors", () => {
		expect(skillHash([])).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
		expect(skillHash([{ path: "SKILL.md", content: bytes("# hi\n") }])).toBe(
			"93c36952d8843b33e68ae970ebabcc03e1687c9bb0dd1ecaf357060318952f55",
		);
		expect(
			skillHash([
				{ path: "docs/b.md", content: bytes("b\n") },
				{ path: "SKILL.md", content: bytes("a\n") },
			]),
		).toBe("b22c4d22aa319d2924312fa18fcbfedc88fa89c74dbd8f298c683e1caf7b7f24");
	});

	it("reads CRLF as LF in a text file, never in a binary one", () => {
		const lf = skillHash([{ path: "SKILL.md", content: bytes("a\nb\n") }]);
		expect(
			skillHash([{ path: "SKILL.md", content: bytes("a\r\nb\r\n") }]),
		).toBe(lf);
		const binary = (text: string) => new Uint8Array([0, ...bytes(text)]);
		expect(skillHash([{ path: "x.bin", content: binary("a\r\n") }])).not.toBe(
			skillHash([{ path: "x.bin", content: binary("a\n") }]),
		);
	});

	it("sorts paths by their bytes, not by locale", () => {
		const a = { path: "B.md", content: bytes("1") };
		const b = { path: "a.md", content: bytes("2") };
		expect(skillHash([a, b])).toBe(skillHash([b, a]));
	});

	it("leaves out what the skills CLI does not install", () => {
		expect(
			[
				"SKILL.md",
				"metadata.json",
				"docs/metadata.json",
				".git/config",
				"scripts/__pycache__/x.pyc",
				"__pypackages__/a/b.py",
				"scripts/run.sh",
			].filter(isHashed),
		).toEqual(["SKILL.md", "scripts/run.sh"]);
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
