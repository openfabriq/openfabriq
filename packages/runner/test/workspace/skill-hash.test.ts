import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	isHashed,
	skillFiles,
	skillHash,
} from "../../src/workspace/skill-hash.js";

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

describe("the files of a skill folder", () => {
	it("follows a link inside the folder, and leaves out one that is broken, loops or leaves it", () => {
		const outside = mkdtempSync(join(tmpdir(), "skill-outside-"));
		writeFileSync(join(outside, "secret.txt"), "no\n");
		const dir = mkdtempSync(join(tmpdir(), "skill-files-"));
		mkdirSync(join(dir, "docs"));
		writeFileSync(join(dir, "SKILL.md"), "# s\n");
		writeFileSync(join(dir, "docs/a.md"), "a\n");
		writeFileSync(join(dir, "metadata.json"), "{}");
		symlinkSync("docs/a.md", join(dir, "same.md"));
		symlinkSync("docs", join(dir, "more"));
		symlinkSync(join(outside, "secret.txt"), join(dir, "secret.txt"));
		symlinkSync("missing.md", join(dir, "broken.md"));
		symlinkSync("..", join(dir, "docs/up"));
		const files = skillFiles(dir);
		expect(files.map((f) => f.path).sort()).toEqual([
			"SKILL.md",
			"docs/a.md",
			"more/a.md",
			"same.md",
		]);
		expect(
			Buffer.from(
				files.find((f) => f.path === "same.md")?.content ?? [],
			).toString(),
		).toBe("a\n");
	});

	it("is empty without a folder", () => {
		expect(skillFiles(join(tmpdir(), "no-such-skill-folder"))).toEqual([]);
	});
});
