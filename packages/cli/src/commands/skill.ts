import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import {
	IMPORTED_SKILLS,
	type ImportedSkills,
	importedSkillsText,
	isHashed,
	readImportedSkills,
	scanLayout,
	sentenceList,
	skillHash,
	splitFrontMatter,
} from "@openfabriq/core";
import { exec, factoryFolder, readFactoryFolder } from "@openfabriq/runner";
import type { CommandResult } from "../result.js";

// Public skills brought into the factory as plain files, pinned to a commit, with the skills CLI's hash.

export interface SkillArgs {
	action?: string | undefined;
	/** add: owner/repo, or owner/repo@skill; remove: the skill's folder in openfabriq/. */
	target?: string | undefined;
	/** add: the skill's name, when the repository has several. */
	name?: string | undefined;
	agent?: string | undefined;
	area?: string | undefined;
}

/** The skill's name in its SKILL.md, the name its folder takes: lowercase letters, digits and -. */
const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;

const fail = (output: string): CommandResult => ({ code: 1, output });

export async function skillCommand(
	args: SkillArgs,
	dir = ".",
	run = exec,
): Promise<CommandResult> {
	const folder = factoryFolder(dir);
	if (!existsSync(join(folder, "factory.yaml")))
		return fail(
			`No factory here: no factory.yaml, nor an openfabriq/ folder. Run "openfabriq init" first.`,
		);
	if (args.action === "add") return addSkill(args, folder, run);
	if (args.action === "remove") return removeSkill(args.target, folder);
	return fail(
		"Usage: openfabriq skill add <owner/repo> [skill] [--agent name | --area name], or openfabriq skill remove <folder>",
	);
}

async function addSkill(
	args: SkillArgs,
	folder: string,
	run: typeof exec,
): Promise<CommandResult> {
	const [repository = "", afterAt] = (args.target ?? "").split("@");
	const wanted = args.name ?? afterAt;
	if (!REPOSITORY.test(repository))
		return fail(
			"Name a GitHub repository and its skill: openfabriq skill add mattpocock/skills code-review",
		);
	if (args.agent && args.area)
		return fail(
			"Pass --agent or --area, not both: an agent's skills are in its own folder",
		);
	const files = readFactoryFolder(folder);
	const layout = scanLayout(files);
	let parent = "";
	if (args.agent) {
		const agentFile = layout.agentFiles.get(args.agent);
		if (!agentFile)
			return fail(
				`The factory has no agent named ${args.agent}: its agents are ${sentenceList([...layout.agentFiles.keys()].sort())}`,
			);
		parent = `${dirname(agentFile)}/`;
	} else if (args.area) {
		if (!layout.areas.has(args.area))
			return fail(
				`The factory has no area named ${args.area}: an area is a folder of openfabriq/ with agents/ or automations/`,
			);
		parent = `${args.area}/`;
	}
	const lock = readLock(files[IMPORTED_SKILLS]);
	if (typeof lock === "string") return fail(lock);

	const temp = mkdtempSync(join(tmpdir(), "openfabriq-skill-"));
	try {
		const clone = join(temp, "source");
		await run("gh", [
			"repo",
			"clone",
			repository,
			clone,
			"--",
			"--depth",
			"1",
			"--quiet",
		]);
		const commit = (
			await run("git", ["-C", clone, "rev-parse", "HEAD"])
		).trim();
		const ref = (
			await run("git", ["-C", clone, "rev-parse", "--abbrev-ref", "HEAD"])
		).trim();
		const found = findSkill(clone, wanted);
		if (typeof found === "string") return fail(found);
		const sourceFiles = skillFiles(join(clone, found.folder));
		const skillMd = sourceFiles.find((f) => f.path === "SKILL.md");
		if (skillMd && grantsTools(Buffer.from(skillMd.content).toString("utf8")))
			return fail(
				`${repository}'s ${found.name} grants itself tools with allowed-tools, which a factory refuses: the agent's tools say what it may use`,
			);
		const key = `${parent}skills/${found.name}`;
		const target = join(folder, key);
		const entry = lock.skills[key];
		if (entry) {
			if (skillHash(skillFiles(target)) !== entry.computedHash)
				return fail(
					`openfabriq/${key} changed since it was imported, and updating it would lose that change: put it back as it was imported, or delete the folder, then run this again. Adapt an imported skill in the agent's own body instead.`,
				);
		} else if (existsSync(target))
			return fail(
				`openfabriq/${key} is already a skill of the factory, not one it imported: give it another name, or delete it first`,
			);
		rmSync(target, { recursive: true, force: true });
		for (const file of sourceFiles) {
			const to = join(target, file.path);
			mkdirSync(dirname(to), { recursive: true });
			// Keeps a script's mode, so it still runs.
			copyFileSync(join(clone, found.folder, file.path), to);
		}
		const skills = {
			...lock.skills,
			[key]: {
				source: repository,
				sourceType: "github" as const,
				ref,
				commit,
				skillPath: found.folder ? `${found.folder}/SKILL.md` : "SKILL.md",
				computedHash: skillHash(sourceFiles),
			},
		};
		writeFileSync(join(folder, IMPORTED_SKILLS), importedSkillsText(skills));
		return {
			code: 0,
			output: [
				`✓ ${entry ? "Updated" : "Imported"} ${found.name} from ${repository} at ${commit.slice(0, 7)} into openfabriq/${key}`,
				"",
				`Read its files: it was written for a person at the keyboard, and the agent's own body says how the factory uses it. Then open a pull request, and run "openfabriq apply" once it is merged.`,
			].join("\n"),
		};
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
}

function removeSkill(given: string | undefined, folder: string): CommandResult {
	const key = (given ?? "").replace(/^openfabriq\//, "").replace(/\/+$/, "");
	if (!key)
		return fail(
			"Name the skill's folder: openfabriq skill remove skills/code-review",
		);
	const lock = readLock(readIfExists(join(folder, IMPORTED_SKILLS)));
	if (typeof lock === "string") return fail(lock);
	if (!lock.skills[key])
		return fail(
			`openfabriq/${key} is not an imported skill${Object.keys(lock.skills).length ? `; the imported ones are ${sentenceList(Object.keys(lock.skills).sort())}` : ""}. Delete a skill of your own like any other folder.`,
		);
	rmSync(join(folder, key), { recursive: true, force: true });
	const { [key]: _removed, ...rest } = lock.skills;
	if (Object.keys(rest).length)
		writeFileSync(join(folder, IMPORTED_SKILLS), importedSkillsText(rest));
	else rmSync(join(folder, IMPORTED_SKILLS), { force: true });
	return {
		code: 0,
		output: `✓ Removed openfabriq/${key}. Open a pull request, and run "openfabriq apply" once it is merged.`,
	};
}

function readIfExists(path: string): string | undefined {
	return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/** The factory's imported skills, none without the file, or why it cannot be read. */
function readLock(text: string | undefined): ImportedSkills | string {
	if (text === undefined) return { version: 1, skills: {} };
	const read = readImportedSkills(text);
	return Array.isArray(read)
		? `openfabriq/${IMPORTED_SKILLS} cannot be read (${read.join("; ")}): fix it, or check it out again from git`
		: read;
}

function grantsTools(text: string): boolean {
	const split = splitFrontMatter(text);
	const header = typeof split === "string" ? undefined : split.header;
	return !!header && typeof header === "object" && "allowed-tools" in header;
}

/**
 * The files of a skill folder that the skills CLI would copy, with their bytes. Links are left
 * out: a link could point outside the folder.
 */
export function skillFiles(dir: string): { path: string; content: Buffer }[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name))
		.map((path) => ({
			path: relative(dir, path).split(sep).join("/"),
			content: readFileSync(path),
		}))
		.filter((file) => isHashed(file.path));
}

/**
 * The skill to import from a repository: the one named, or its only skill. A SKILL.md at the root
 * comes first, then the shallowest.
 * shortcut: one search of the whole repository instead of the skills CLI's list of folders and
 * manifests; a repository with two skills of one name gets the shallower, until someone needs more.
 */
function findSkill(
	clone: string,
	wanted: string | undefined,
): { folder: string; name: string } | string {
	const skills = readdirSync(clone, { recursive: true, withFileTypes: true })
		.filter(
			(entry) =>
				entry.isFile() &&
				entry.name === "SKILL.md" &&
				!/(^|[/\\])(\.git|node_modules)([/\\]|$)/.test(
					relative(clone, entry.parentPath),
				),
		)
		.map((entry) => {
			const folder = relative(clone, entry.parentPath).split(sep).join("/");
			const split = splitFrontMatter(
				readFileSync(join(entry.parentPath, entry.name), "utf8"),
			);
			const header = typeof split === "string" ? undefined : split.header;
			const named =
				header && typeof header === "object" && "name" in header
					? header.name
					: undefined;
			const name =
				typeof named === "string" ? named : folder.split("/").at(-1) || "";
			return { folder, name };
		})
		.sort(
			(a, b) =>
				a.folder.split("/").length - b.folder.split("/").length ||
				(a.folder < b.folder ? -1 : 1),
		);
	if (skills.length === 0)
		return "This repository has no skill: no SKILL.md in it";
	const names = sentenceList([...new Set(skills.map((s) => s.name))].sort());
	const skill = wanted
		? skills.find(
				(s) => s.name === wanted || s.folder.split("/").at(-1) === wanted,
			)
		: skills.length === 1
			? skills[0]
			: undefined;
	if (!skill)
		return wanted
			? `This repository has no skill named ${wanted}: its skills are ${names}`
			: `This repository has several skills, name one: ${names}`;
	if (!SKILL_NAME.test(skill.name))
		return `The skill's name, ${skill.name}, cannot be a folder of the factory: a skill's name is lowercase letters, digits and -`;
	return skill;
}
