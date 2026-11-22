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
	frontMatterField,
	grantsTools,
	IMPORTED_SKILLS,
	type ImportedSkills,
	importedSkillsText,
	REPOSITORY,
	readImportedSkills,
	type SkillPlace,
	scanLayout,
	sentenceList,
	skillFolder,
	splitArea,
} from "@openfabriq/core";
import {
	exec,
	factoryFolder,
	readFactoryFolder,
	skillFiles,
	skillHash,
} from "@openfabriq/runner";
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
	const place = placeOf(args, folder);
	if (typeof place === "string") return fail(place);
	const imported = readImported(folder);
	if (typeof imported === "string") return fail(imported);

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
		const found = chooseSkill(skillCandidates(clone), wanted);
		if (typeof found === "string") return fail(found);
		const source = join(clone, found.folder);
		const files = skillFiles(source);
		const skillMd = files.find((f) => f.path === "SKILL.md");
		if (skillMd && grantsTools(Buffer.from(skillMd.content).toString("utf8")))
			return fail(
				`${repository}'s ${found.name} grants itself tools with allowed-tools, which a factory refuses: the agent's tools say what it may use`,
			);
		const key = skillFolder(found.name, place);
		const target = join(folder, key);
		const entry = imported.skills[key];
		// A folder deleted since its import is imported again; one changed by hand is kept.
		if (
			entry &&
			existsSync(target) &&
			skillHash(skillFiles(target)) !== entry.computedHash
		)
			return fail(
				`openfabriq/${key} changed since it was imported, and updating it would lose that change: put it back as it was imported, or delete the folder, then run this again. Adapt an imported skill in the agent's own body instead.`,
			);
		if (!entry && existsSync(target))
			return fail(
				`openfabriq/${key} is already a skill of the factory, not one it imported: give it another name, or delete it first`,
			);
		rmSync(target, { recursive: true, force: true });
		for (const file of files) {
			const to = join(target, file.path);
			mkdirSync(dirname(to), { recursive: true });
			// Keeps a script's mode, so it still runs; a link inside the folder becomes its file.
			copyFileSync(join(source, file.path), to);
		}
		writeImported(folder, {
			...imported.skills,
			[key]: {
				source: repository,
				sourceType: "github",
				ref,
				commit,
				skillPath: found.folder ? `${found.folder}/SKILL.md` : "SKILL.md",
				computedHash: skillHash(files),
			},
		});
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

/** Where --agent or --area puts the skill, or why the factory has no such place. */
function placeOf(args: SkillArgs, folder: string): SkillPlace | string {
	if (args.agent && args.area)
		return "Pass --agent or --area, not both: an agent's skills are in its own folder";
	if (!args.agent && !args.area) return {};
	const layout = scanLayout(readFactoryFolder(folder));
	if (args.agent) {
		const agentFile = layout.agentFiles.get(args.agent);
		if (!agentFile)
			return `The factory has no agent named ${args.agent}: its agents are ${sentenceList([...layout.agentFiles.keys()].sort())}`;
		const { area } = splitArea(agentFile, layout.areas);
		return { agent: args.agent, ...(area ? { area } : {}) };
	}
	const area = args.area ?? "";
	return layout.areas.has(area)
		? { area }
		: `The factory has no area named ${area}: an area is a folder of openfabriq/ with agents/ or automations/`;
}

function removeSkill(given: string | undefined, folder: string): CommandResult {
	const key = (given ?? "").replace(/^openfabriq\//, "").replace(/\/+$/, "");
	if (!key)
		return fail(
			"Name the skill's folder: openfabriq skill remove skills/code-review",
		);
	const imported = readImported(folder);
	if (typeof imported === "string") return fail(imported);
	const folders = Object.keys(imported.skills).sort();
	if (!imported.skills[key])
		return fail(
			`openfabriq/${key} is not an imported skill${folders.length ? `; the imported ones are ${sentenceList(folders)}` : ""}. Delete a skill of your own like any other folder.`,
		);
	rmSync(join(folder, key), { recursive: true, force: true });
	const { [key]: _removed, ...rest } = imported.skills;
	writeImported(folder, rest);
	return {
		code: 0,
		output: `✓ Removed openfabriq/${key}. Open a pull request, and run "openfabriq apply" once it is merged.`,
	};
}

/** The factory's imported skills, none without the file, or why it cannot be read. */
function readImported(folder: string): ImportedSkills | string {
	const path = join(folder, IMPORTED_SKILLS);
	if (!existsSync(path)) return { version: 1, skills: {} };
	const read = readImportedSkills(readFileSync(path, "utf8"));
	return Array.isArray(read)
		? `openfabriq/${IMPORTED_SKILLS} cannot be read (${read.join("; ")}): fix it, or check it out again from git`
		: read;
}

/** Writes the imported skills, or removes the file once there are none. */
function writeImported(folder: string, skills: ImportedSkills["skills"]) {
	const path = join(folder, IMPORTED_SKILLS);
	if (Object.keys(skills).length)
		writeFileSync(path, importedSkillsText(skills));
	else rmSync(path, { force: true });
}

/** A skill of a repository: its folder there ("" at the root) and its name. */
export interface Candidate {
	folder: string;
	name: string;
}

/** Every SKILL.md of a cloned repository, outside .git and node_modules. */
function skillCandidates(clone: string): Candidate[] {
	return readdirSync(clone, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name === "SKILL.md")
		.map((entry) => relative(clone, entry.parentPath).split(sep).join("/"))
		.filter((folder) => !/(^|\/)(\.git|node_modules)(\/|$)/.test(folder))
		.map((folder) => {
			const name = frontMatterField(
				readFileSync(join(clone, folder, "SKILL.md"), "utf8"),
				"name",
			);
			return {
				folder,
				name:
					typeof name === "string" ? name : (folder.split("/").at(-1) ?? ""),
			};
		});
}

// Where the skills CLI looks first: the root, then skills/, then the agents' own skill folders.
const FIRST_PLACES = [
	(folder: string) => folder === "",
	(folder: string) => folder.startsWith("skills/"),
	(folder: string) => /^\.(claude|agents)\/skills\//.test(folder),
];
const placeRank = (folder: string) => {
	const at = FIRST_PLACES.findIndex((first) => first(folder));
	return at === -1 ? FIRST_PLACES.length : at;
};

/**
 * The skill to import: the one named, by its name or its folder's, or the repository's only skill.
 * Two of the same name: the first where the skills CLI looks, then the shallowest.
 */
export function chooseSkill(
	candidates: Candidate[],
	wanted: string | undefined,
): Candidate | string {
	const skills = [...candidates].sort(
		(a, b) =>
			placeRank(a.folder) - placeRank(b.folder) ||
			a.folder.split("/").length - b.folder.split("/").length ||
			(a.folder < b.folder ? -1 : 1),
	);
	if (skills.length === 0)
		return "This repository has no skill: no SKILL.md in it";
	const names = sentenceList(
		[...new Set(skills.map((s) => printable(s.name)))].sort(),
	);
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
		return `The skill's name, ${printable(skill.name)}, cannot be a folder of the factory: a skill's name is lowercase letters, digits and -`;
	return skill;
}

/** A name read from a repository, without the control characters that would drive the terminal. */
const printable = (name: string) =>
	// biome-ignore lint/suspicious/noControlCharactersInRegex: they are what is removed.
	name.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
