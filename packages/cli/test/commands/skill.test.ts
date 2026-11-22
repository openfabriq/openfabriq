import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadFactory, skillHash } from "@openfabriq/core";
import { readFactoryFolder } from "@openfabriq/runner";
import { describe, expect, it } from "vitest";
import { skillCommand, skillFiles } from "../../src/commands/skill.js";

const COMMIT = "c".repeat(40);
const REVIEW =
	"---\nname: code-review\ndescription: Reviews a change\n---\nReview it.\n";
const PUBLIC = {
	"README.md": "# skills\n",
	"skills/code-review/SKILL.md": REVIEW,
	"skills/code-review/scripts/diff.sh": "#!/bin/sh\ngit diff\n",
	"skills/code-review/metadata.json": "{}",
	"skills/tdd/SKILL.md":
		"---\nname: tdd\ndescription: Tests first\n---\nRed.\n",
};

function write(dir: string, files: Record<string, string>) {
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
}

/** gh clones `repository` into its folder; git says its commit and branch. */
const github =
	(repository: Record<string, string>, calls: string[][] = []) =>
	async (command: string, args: string[]) => {
		calls.push([command, ...args]);
		if (command === "gh") {
			write(args[3] ?? "", repository);
			const script = join(args[3] ?? "", "skills/code-review/scripts/diff.sh");
			if (existsSync(script)) chmodSync(script, 0o755);
			return "";
		}
		return args.includes("--abbrev-ref") ? "main\n" : `${COMMIT}\n`;
	};

function factory(extra: Record<string, string> = {}): string {
	const repo = mkdtempSync(join(tmpdir(), "skill-add-"));
	write(join(repo, "openfabriq"), {
		"factory.yaml": "name: F\nrepository: acme/app\nmaintainers: [alice]\n",
		"agents/reviewer/agent.md": "---\ndescription: Reviews\n---\nReview.\n",
		"qa/agents/tester/agent.md": "---\ndescription: Tests\n---\nTest.\n",
		...extra,
	});
	return repo;
}

const lockOf = (repo: string) =>
	JSON.parse(
		readFileSync(join(repo, "openfabriq/imported-skills.json"), "utf8"),
	);

describe("openfabriq skill add", () => {
	it("copies the skill's files, pinned to the commit, with the skills CLI's hash", async () => {
		const repo = factory();
		const calls: string[][] = [];
		const result = await skillCommand(
			{ action: "add", target: "mattpocock/skills", name: "code-review" },
			repo,
			github(PUBLIC, calls),
		);
		expect(result.code).toBe(0);
		expect(result.output).toContain(
			"✓ Imported code-review from mattpocock/skills at ccccccc into openfabriq/skills/code-review",
		);
		expect(calls[0]?.slice(0, 3)).toEqual(["gh", "repo", "clone"]);
		const folder = join(repo, "openfabriq/skills/code-review");
		expect(
			skillFiles(folder)
				.map((f) => f.path)
				.sort(),
		).toEqual(["SKILL.md", "scripts/diff.sh"]);
		expect(statSync(join(folder, "scripts/diff.sh")).mode & 0o111).not.toBe(0);
		expect(lockOf(repo)).toEqual({
			version: 1,
			skills: {
				"skills/code-review": {
					source: "mattpocock/skills",
					sourceType: "github",
					ref: "main",
					commit: COMMIT,
					skillPath: "skills/code-review/SKILL.md",
					computedHash: skillHash(skillFiles(folder)),
				},
			},
		});
		const files = readFactoryFolder(join(repo, "openfabriq"));
		expect(
			loadFactory(files).problems.filter((p) => p.level === "error"),
		).toEqual([]);
	});

	it("takes owner/repo@skill, and puts an agent's skill in its folder, in its area", async () => {
		const repo = factory();
		const result = await skillCommand(
			{ action: "add", target: "mattpocock/skills@tdd", agent: "tester" },
			repo,
			github(PUBLIC),
		);
		expect(result.code).toBe(0);
		expect(Object.keys(lockOf(repo).skills)).toEqual([
			"qa/agents/tester/skills/tdd",
		]);
		expect(
			existsSync(join(repo, "openfabriq/qa/agents/tester/skills/tdd/SKILL.md")),
		).toBe(true);
	});

	it("puts an area's skill in its skills folder", async () => {
		const repo = factory();
		await skillCommand(
			{ action: "add", target: "mattpocock/skills", name: "tdd", area: "qa" },
			repo,
			github(PUBLIC),
		);
		expect(Object.keys(lockOf(repo).skills)).toEqual(["qa/skills/tdd"]);
	});

	it("takes a repository's only skill, at its root, without its name", async () => {
		const repo = factory();
		const result = await skillCommand(
			{ action: "add", target: "acme/one" },
			repo,
			github({ "SKILL.md": REVIEW, "notes.md": "n\n" }),
		);
		expect(result.code).toBe(0);
		expect(lockOf(repo).skills["skills/code-review"].skillPath).toBe(
			"SKILL.md",
		);
	});

	it("names the skills when the repository has several, or not the one asked", async () => {
		const repo = factory();
		expect(
			(
				await skillCommand(
					{ action: "add", target: "mattpocock/skills" },
					repo,
					github(PUBLIC),
				)
			).output,
		).toBe("This repository has several skills, name one: code-review and tdd");
		expect(
			(
				await skillCommand(
					{ action: "add", target: "mattpocock/skills", name: "x" },
					repo,
					github(PUBLIC),
				)
			).output,
		).toBe(
			"This repository has no skill named x: its skills are code-review and tdd",
		);
	});

	it("refuses a skill that grants itself tools, and writes nothing", async () => {
		const repo = factory();
		const result = await skillCommand(
			{ action: "add", target: "acme/one" },
			repo,
			github({
				"SKILL.md":
					"---\nname: s\ndescription: S\nallowed-tools: Bash\n---\nGo.\n",
			}),
		);
		expect(result.code).toBe(1);
		expect(result.output).toContain("grants itself tools with allowed-tools");
		expect(existsSync(join(repo, "openfabriq/skills/s"))).toBe(false);
	});

	it("refuses an unknown agent or area, and both at once", async () => {
		const repo = factory();
		const add = (args: object) =>
			skillCommand(
				{ action: "add", target: "mattpocock/skills", name: "tdd", ...args },
				repo,
				github(PUBLIC),
			);
		expect((await add({ agent: "nobody" })).output).toBe(
			"The factory has no agent named nobody: its agents are reviewer and tester",
		);
		expect((await add({ area: "ops" })).code).toBe(1);
		expect((await add({ agent: "tester", area: "qa" })).code).toBe(1);
	});

	it("updates an imported skill left as it was, and refuses one changed by hand", async () => {
		const repo = factory();
		const add = (repository: Record<string, string>) =>
			skillCommand(
				{ action: "add", target: "mattpocock/skills", name: "code-review" },
				repo,
				github(repository),
			);
		await add(PUBLIC);
		const newer = {
			...PUBLIC,
			"skills/code-review/SKILL.md": `${REVIEW}More.\n`,
		};
		const updated = await add(newer);
		expect(updated.output).toContain("✓ Updated code-review");
		expect(
			readFileSync(
				join(repo, "openfabriq/skills/code-review/SKILL.md"),
				"utf8",
			),
		).toContain("More.");

		writeFileSync(
			join(repo, "openfabriq/skills/code-review/SKILL.md"),
			"mine\n",
		);
		const refused = await add(PUBLIC);
		expect(refused.code).toBe(1);
		expect(refused.output).toContain("changed since it was imported");
		expect(
			readFileSync(
				join(repo, "openfabriq/skills/code-review/SKILL.md"),
				"utf8",
			),
		).toBe("mine\n");
	});

	it("never overwrites a skill of the factory's own", async () => {
		const repo = factory({ "skills/code-review/SKILL.md": REVIEW });
		const result = await skillCommand(
			{ action: "add", target: "mattpocock/skills", name: "code-review" },
			repo,
			github(PUBLIC),
		);
		expect(result.code).toBe(1);
		expect(result.output).toContain("not one it imported");
	});
});

describe("openfabriq skill remove", () => {
	it("removes the folder and its entry, then the file once empty", async () => {
		const repo = factory();
		for (const name of ["code-review", "tdd"])
			await skillCommand(
				{ action: "add", target: "mattpocock/skills", name },
				repo,
				github(PUBLIC),
			);
		const removed = skillCommand(
			{ action: "remove", target: "openfabriq/skills/tdd/" },
			repo,
		);
		expect((await removed).code).toBe(0);
		expect(existsSync(join(repo, "openfabriq/skills/tdd"))).toBe(false);
		expect(Object.keys(lockOf(repo).skills)).toEqual(["skills/code-review"]);
		await skillCommand(
			{ action: "remove", target: "skills/code-review" },
			repo,
		);
		expect(existsSync(join(repo, "openfabriq/imported-skills.json"))).toBe(
			false,
		);
	});

	it("refuses a skill it did not import", async () => {
		const repo = factory({ "skills/mine/SKILL.md": REVIEW });
		const result = await skillCommand(
			{ action: "remove", target: "skills/mine" },
			repo,
		);
		expect(result.code).toBe(1);
		expect(existsSync(join(repo, "openfabriq/skills/mine"))).toBe(true);
	});
});
