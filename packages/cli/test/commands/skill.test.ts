import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadFactory } from "@openfabriq/core";
import { readFactoryFolder, skillFiles, skillHash } from "@openfabriq/runner";
import { describe, expect, it } from "vitest";
import {
	chooseSkill,
	editedSkillHelp,
	skillCommand,
} from "../../src/commands/skill.js";

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
			"✓ Imported code-review from mattpocock/skills at ccccccc into openfabriq/skills/code-review, declared in factory.yaml",
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
			readFileSync(join(repo, "openfabriq/factory.yaml"), "utf8"),
		).toContain("skills:\n  tdd: { from: mattpocock/skills, agent: tester }\n");
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

	it("refuses a skill already imported in another place, since factory.yaml declares it once", async () => {
		const repo = factory();
		const add = (agent?: string) =>
			skillCommand(
				{ action: "add", target: "mattpocock/skills", name: "tdd", agent },
				repo,
				github(PUBLIC),
			);
		expect((await add()).code).toBe(0);
		const moved = await add("reviewer");
		expect(moved.code).toBe(1);
		expect(moved.output).toContain(
			'tdd is already imported in openfabriq/skills/tdd: run "openfabriq skill remove skills/tdd" first',
		);
		expect(Object.keys(lockOf(repo).skills)).toEqual(["skills/tdd"]);
		expect(
			existsSync(join(repo, "openfabriq/agents/reviewer/skills/tdd")),
		).toBe(false);
		await skillCommand({ action: "remove", target: "skills/tdd" }, repo);
		expect((await add("reviewer")).code).toBe(0);
		expect(
			readFileSync(join(repo, "openfabriq/factory.yaml"), "utf8"),
		).toContain("  tdd: { from: mattpocock/skills, agent: reviewer }\n");
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

	it("imports a skill from a folder of any name, and refuses one its lock could not hold", async () => {
		const repo = factory();
		const skill = "---\nname: cpp\ndescription: C++\n---\nGo.\n";
		const ok = await skillCommand(
			{ action: "add", target: "acme/one", name: "cpp" },
			repo,
			github({ "skills/c++/SKILL.md": skill }),
		);
		expect(ok.code).toBe(0);
		expect(lockOf(repo).skills["skills/cpp"].skillPath).toBe(
			"skills/c++/SKILL.md",
		);
		const refused = await skillCommand(
			{ action: "add", target: "acme/two", name: "tdd" },
			repo,
			github({
				"skills/\u001b[2J/SKILL.md":
					"---\nname: tdd\ndescription: T\n---\nGo.\n",
			}),
		);
		expect(refused.code).toBe(1);
		expect(refused.output).toContain(
			"cannot be recorded in imported-skills.json",
		);
		expect(refused.output).not.toContain("\u001b");
		expect(existsSync(join(repo, "openfabriq/skills/tdd"))).toBe(false);
		expect(Object.keys(lockOf(repo).skills)).toEqual(["skills/cpp"]);
	});

	it("refuses a repository a command would read as an option, before cloning", async () => {
		const repo = factory();
		const calls: string[][] = [];
		const result = await skillCommand(
			{ action: "add", target: "-x/skills", name: "tdd" },
			repo,
			github(PUBLIC, calls),
		);
		expect(result.code).toBe(1);
		expect(calls).toEqual([]);
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
			'The factory has no such place: agent "nobody" does not exist. Use one of: reviewer, tester',
		);
		expect((await add({ area: "ops" })).code).toBe(1);
		expect((await add({ agent: "tester", area: "qa" })).code).toBe(1);
	});

	it("updates an imported skill left as it was, and refuses one edited since its import", async () => {
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
		expect(refused.output).toContain(
			"openfabriq/skills/code-review was edited since its import, so it is not overwritten.",
		);
		expect(
			readFileSync(
				join(repo, "openfabriq/skills/code-review/SKILL.md"),
				"utf8",
			),
		).toBe("mine\n");
	});

	it("imports again a skill whose folder was deleted", async () => {
		const repo = factory();
		const add = () =>
			skillCommand(
				{ action: "add", target: "mattpocock/skills", name: "code-review" },
				repo,
				github(PUBLIC),
			);
		await add();
		writeFileSync(
			join(repo, "openfabriq/skills/code-review/SKILL.md"),
			"mine\n",
		);
		rmSync(join(repo, "openfabriq/skills/code-review"), { recursive: true });
		const again = await add();
		expect(again.code).toBe(0);
		expect(
			readFileSync(
				join(repo, "openfabriq/skills/code-review/SKILL.md"),
				"utf8",
			),
		).toBe(REVIEW);
	});

	it("copies a link inside the skill as its file", async () => {
		const repo = factory();
		const calls: string[][] = [];
		const linked = async (command: string, args: string[]) => {
			const out = await github(PUBLIC, calls)(command, args);
			if (command === "gh")
				symlinkSync(
					"SKILL.md",
					join(args[3] ?? "", "skills/code-review/README.md"),
				);
			return out;
		};
		await skillCommand(
			{ action: "add", target: "mattpocock/skills", name: "code-review" },
			repo,
			linked,
		);
		const copy = join(repo, "openfabriq/skills/code-review/README.md");
		expect(lstatSync(copy).isSymbolicLink()).toBe(false);
		expect(readFileSync(copy, "utf8")).toBe(REVIEW);
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

describe("openfabriq skill update", () => {
	const add = (repo: string, name: string, repository = PUBLIC) =>
		skillCommand(
			{ action: "add", target: "mattpocock/skills", name },
			repo,
			github(repository),
		);
	const update = (
		repo: string,
		repository: Record<string, string>,
		target?: string,
	) => skillCommand({ action: "update", target }, repo, github(repository));
	const NEWER = {
		...PUBLIC,
		"skills/tdd/SKILL.md":
			"---\nname: tdd\ndescription: Tests first\n---\nRed, then green.\n",
	};

	it("updates each declared skill whose source changed, and leaves the others as they were", async () => {
		const repo = factory();
		await add(repo, "code-review");
		await add(repo, "tdd");
		const before = lockOf(repo).skills["skills/code-review"];
		const result = await update(repo, NEWER);
		expect(result.code).toBe(0);
		expect(result.output).toContain("✓ code-review: up to date");
		expect(result.output).toContain(
			"✓ tdd: updated to mattpocock/skills at ccccccc",
		);
		expect(
			readFileSync(join(repo, "openfabriq/skills/tdd/SKILL.md"), "utf8"),
		).toContain("Red, then green.");
		expect(lockOf(repo).skills["skills/code-review"]).toEqual(before);
	});

	it("skips a skill edited since its import, and updates only the one named", async () => {
		const repo = factory();
		await add(repo, "code-review");
		await add(repo, "tdd");
		writeFileSync(join(repo, "openfabriq/skills/tdd/SKILL.md"), "mine\n");
		const named = await update(repo, NEWER, "code-review");
		expect(named.output).toBe("✓ code-review: up to date");
		const all = await update(repo, NEWER);
		expect(all.output).toContain(
			[
				"! tdd: edited since its import, so not updated.",
				'  To undo the edit: delete openfabriq/skills/tdd, then run "openfabriq skill update tdd".',
				"  To adapt the skill, edit the agent.md of the agents that use it instead: the skill then keeps its updates.",
			].join("\n"),
		);
		expect(
			readFileSync(join(repo, "openfabriq/skills/tdd/SKILL.md"), "utf8"),
		).toBe("mine\n");
	});

	it("says what factory.yaml declares when the skill named is not there", async () => {
		const repo = factory();
		await add(repo, "tdd");
		expect((await update(repo, PUBLIC, "nope")).output).toBe(
			"factory.yaml's skills declares no nope: it declares tdd",
		);
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

	it("never takes a name every object has for an imported skill", async () => {
		const repo = factory({ "constructor/notes.md": "Keep.\n" });
		const result = await skillCommand(
			{ action: "remove", target: "constructor" },
			repo,
		);
		expect(result.code).toBe(1);
		expect(existsSync(join(repo, "openfabriq/constructor/notes.md"))).toBe(
			true,
		);
	});

	it("says where to adapt a skill edited since its import: its agent's agent.md, or the area's agents", () => {
		expect(editedSkillHelp("qa/agents/tester/skills/tdd")[1]).toContain(
			"edit openfabriq/qa/agents/tester/agent.md instead",
		);
		expect(editedSkillHelp("qa/skills/tdd")[1]).toContain(
			"edit the agent.md of the agents in openfabriq/qa/ instead",
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

describe("the skill to import from a repository", () => {
	const skill = (folder: string, name = folder.split("/").at(-1) ?? "") => ({
		folder,
		name,
	});

	it("looks first where the skills CLI does: the root, skills/, then the agents' folders", () => {
		const found = (folders: string[]) =>
			chooseSkill(
				folders.map((f) => skill(f, "x")),
				"x",
			);
		expect(found(["other/x", "skills/deep/x"])).toEqual(
			skill("skills/deep/x", "x"),
		);
		expect(found(["a/x", ".claude/skills/x"])).toEqual(
			skill(".claude/skills/x", "x"),
		);
		expect(found(["skills/x", ""])).toEqual(skill("", "x"));
	});

	it("finds a skill by its folder's name too, and refuses a name no folder can take", () => {
		expect(chooseSkill([skill("skills/cr", "code-review")], "cr")).toEqual(
			skill("skills/cr", "code-review"),
		);
		expect(chooseSkill([skill("skills/x", "Code Review")], undefined)).toMatch(
			/cannot be a folder of the factory/,
		);
		expect(
			chooseSkill(
				[skill("a/x", "x\u001b]0;pwned\u0007"), skill("b/y", "y")],
				undefined,
			),
		).toBe("This repository has several skills, name one: x]0;pwned and y");
		expect(chooseSkill([], undefined)).toBe(
			"This repository has no skill: no SKILL.md in it",
		);
	});
});
