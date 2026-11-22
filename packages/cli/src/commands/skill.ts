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
	type DeclaredSkill,
	declaredPlace,
	frontMatterField,
	grantsTools,
	IMPORTED_SKILLS,
	type ImportedSkills,
	importedSkillsText,
	loadFactory,
	REPOSITORY,
	readImportedSkills,
	type SkillPlace,
	scanLayout,
	sentenceList,
	skillFolder,
	skillPlace,
	withDeclaredSkill,
} from "@openfabriq/core";
import {
	errorText,
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
	const temp = mkdtempSync(join(tmpdir(), "openfabriq-skill-"));
	try {
		const clone = cloner(run, temp);
		if (args.action === "add") return await addSkill(args, folder, clone);
		if (args.action === "update")
			return await updateSkills(args.target, folder, clone);
		if (args.action === "remove") return removeSkill(args.target, folder);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
	return fail(
		"Usage: openfabriq skill add <owner/repo> [skill] [--agent name | --area name], openfabriq skill update [skill], or openfabriq skill remove <folder>",
	);
}

/** A repository cloned at the last commit of its default branch. */
interface Clone {
	dir: string;
	commit: string;
	ref: string;
}

/** Clones each repository once for the command, in its temp folder. */
function cloner(run: typeof exec, temp: string) {
	const clones = new Map<string, Promise<Clone>>();
	return (repository: string): Promise<Clone> => {
		const known = clones.get(repository);
		if (known) return known;
		const dir = join(temp, `${clones.size}`);
		const cloning = (async () => {
			await run("gh", [
				"repo",
				"clone",
				repository,
				dir,
				"--",
				"--depth",
				"1",
				"--quiet",
			]);
			const git = async (...args: string[]) =>
				(await run("git", ["-C", dir, ...args])).trim();
			return {
				dir,
				commit: await git("rev-parse", "HEAD"),
				ref: await git("rev-parse", "--abbrev-ref", "HEAD"),
			};
		})();
		clones.set(repository, cloning);
		return cloning;
	};
}

type Cloner = ReturnType<typeof cloner>;

/** What importing a skill did: written, left as it was, or kept because it was edited since its import. */
interface Imported {
	status: "imported" | "updated" | "unchanged" | "edited";
	name: string;
	key: string;
	commit: string;
}

/**
 * Copies a skill of a repository into its folder of the factory and records it in `imported`, or
 * says why it cannot. A skill edited since its import is kept; one whose content did not change keeps its
 * entry, so a pull request shows only what changed.
 */
async function importSkill(
	folder: string,
	imported: ImportedSkills,
	request: {
		repository: string;
		wanted: string | undefined;
		place: SkillPlace;
	},
	clone: Cloner,
): Promise<Imported | string> {
	const { repository, wanted, place } = request;
	const source = await clone(repository);
	const found = chooseSkill(skillCandidates(source.dir), wanted);
	if (typeof found === "string") return found;
	const from = join(source.dir, found.folder);
	const files = skillFiles(from);
	const skillMd = files.find((f) => f.path === "SKILL.md");
	if (skillMd && grantsTools(Buffer.from(skillMd.content).toString("utf8")))
		return `${repository}'s ${found.name} grants itself tools with allowed-tools, which a factory refuses: the agent's tools say what it may use`;
	const key = skillFolder(found.name, place);
	const target = join(folder, key);
	// factory.yaml declares a skill by its name, so the factory imports each name in one place.
	const elsewhere = Object.keys(imported.skills).find(
		(folder) => folder !== key && skillPlace(folder)?.name === found.name,
	);
	if (elsewhere)
		return `${found.name} is already imported in openfabriq/${elsewhere}: run "openfabriq skill remove ${elsewhere}" first, then import it again`;
	const entry = Object.hasOwn(imported.skills, key)
		? imported.skills[key]
		: undefined;
	const done = (status: Imported["status"]) => ({
		status,
		name: found.name,
		key,
		commit: status === "unchanged" && entry ? entry.commit : source.commit,
	});
	// A folder deleted since its import is imported again; one edited since is kept.
	if (
		entry &&
		existsSync(target) &&
		skillHash(skillFiles(target)) !== entry.computedHash
	)
		return done("edited");
	if (!entry && existsSync(target))
		return `openfabriq/${key} is already a skill of the factory, not one it imported: give it another name, or delete it first`;
	const computedHash = skillHash(files);
	if (
		entry?.source === repository &&
		entry.computedHash === computedHash &&
		existsSync(target)
	)
		return done("unchanged");
	const record = {
		source: repository,
		sourceType: "github" as const,
		ref: source.ref,
		commit: source.commit,
		skillPath: found.folder ? `${found.folder}/SKILL.md` : "SKILL.md",
		computedHash,
	};
	// An entry imported-skills.json would refuse would make the whole file unreadable.
	const refused = readImportedSkills(importedSkillsText({ [key]: record }));
	if (Array.isArray(refused))
		return `${repository}'s ${found.name} cannot be recorded in ${IMPORTED_SKILLS}: ${printable(refused.join("; "))}`;
	rmSync(target, { recursive: true, force: true });
	for (const file of files) {
		const to = join(target, file.path);
		mkdirSync(dirname(to), { recursive: true });
		// Keeps a script's mode, so it still runs; a link inside the folder becomes its file.
		copyFileSync(join(from, file.path), to);
	}
	imported.skills[key] = record;
	return done(entry ? "updated" : "imported");
}

const MERGE = `  - Open a pull request, then run "openfabriq apply" once it is merged.`;
const UPDATED_STEPS = [
	"Next:",
	"  - Read what changed: git diff openfabriq/",
	MERGE,
];
const importedSteps = (key: string) => [
	"Next:",
	`  - Read openfabriq/${key}/ before an agent uses it: it was written for a person who answers its questions, and an agent has no one to ask.`,
	`  - To adapt it, edit ${agentFiles(key)}, never the skill itself.`,
	MERGE,
];
const EDITED = (key: string) =>
	[
		`openfabriq/${key} was edited since its import, so it is not overwritten.`,
		...editedSkillHelp(key),
	].join("\n");

/** What to do with an imported skill edited since its import, indented below its line: for add, update and doctor. */
export function editedSkillHelp(key: string): string[] {
	return [
		`  To undo the edit: delete openfabriq/${key}, then run "openfabriq skill update ${skillPlace(key)?.name ?? key}".`,
		`  To adapt the skill, edit ${agentFiles(key)} instead: the skill then keeps its updates.`,
	];
}

/** Where to adapt an imported skill: its agent's agent.md, or those of the agents that have it. */
function agentFiles(key: string): string {
	const place = skillPlace(key)?.place ?? {};
	if ("agent" in place)
		return `openfabriq/${key.slice(0, key.lastIndexOf("/skills/"))}/agent.md`;
	return "area" in place
		? `the agent.md of the agents in openfabriq/${place.area}/`
		: "the agent.md of the agents that use it";
}

async function addSkill(
	args: SkillArgs,
	folder: string,
	clone: Cloner,
): Promise<CommandResult> {
	const [repository = "", afterAt] = (args.target ?? "").split("@");
	if (!REPOSITORY.test(repository))
		return fail(
			"Name a GitHub repository and its skill: openfabriq skill add mattpocock/skills code-review",
		);
	const place = placeOf(args, folder);
	if (typeof place === "string") return fail(place);
	const imported = readImported(folder);
	if (typeof imported === "string") return fail(imported);
	const done = await importSkill(
		folder,
		imported,
		{ repository, wanted: args.name ?? afterAt, place },
		clone,
	);
	if (typeof done === "string") return fail(done);
	if (done.status === "edited") return fail(EDITED(done.key));
	writeImported(folder, imported.skills);
	declare(folder, done.name, {
		from: repository,
		...(args.agent ? { agent: args.agent } : {}),
		...(args.area ? { area: args.area } : {}),
	});
	const what =
		done.status === "unchanged"
			? `${done.name} from ${repository} is already up to date in openfabriq/${done.key}`
			: `${done.status === "updated" ? "Updated" : "Imported"} ${done.name} from ${repository} at ${done.commit.slice(0, 7)} into openfabriq/${done.key}, declared in factory.yaml`;
	const steps =
		done.status === "unchanged" ? [] : ["", ...importedSteps(done.key)];
	return { code: 0, output: [`✓ ${what}`, ...steps].join("\n") };
}

/** Updates every skill factory.yaml declares, or the one named, to its source's last commit. */
async function updateSkills(
	only: string | undefined,
	folder: string,
	clone: Cloner,
): Promise<CommandResult> {
	const imported = readImported(folder);
	if (typeof imported === "string") return fail(imported);
	const lines: string[] = [];
	let failed = false;
	let changed = false;
	const update = async (
		name: string,
		repository: string,
		place: SkillPlace,
	) => {
		const done = await importSkill(
			folder,
			imported,
			{ repository, wanted: name, place },
			clone,
		).catch((error: unknown) => `${errorText(error).split("\n")[0]}`);
		if (typeof done === "string") {
			failed = true;
			lines.push(`✗ ${name}: ${done}`);
		} else if (done.status === "edited")
			lines.push(
				`! ${name}: edited since its import, so not updated.`,
				...editedSkillHelp(done.key),
			);
		else if (done.status === "unchanged") lines.push(`✓ ${name}: up to date`);
		else {
			changed = true;
			lines.push(
				`✓ ${name}: updated to ${repository} at ${done.commit.slice(0, 7)}`,
			);
		}
	};
	// A skill whose folder was deleted comes back first: without it, the factory is not valid.
	const restored = new Set<string>();
	for (const [key, entry] of Object.entries(imported.skills).sort()) {
		const skill = skillPlace(key);
		if (!skill || (only && skill.name !== only)) continue;
		if (existsSync(join(folder, key))) continue;
		restored.add(skill.name);
		await update(skill.name, entry.source, skill.place);
	}
	if (restored.size) writeImported(folder, imported.skills);
	const files = readFactoryFolder(folder);
	const { factory, problems } = loadFactory(files);
	if (!factory)
		return fail(
			[
				...lines,
				`The factory has ${problems.filter((p) => p.level === "error").length} error(s): run "openfabriq validate", fix them, then update.`,
			].join("\n"),
		);
	const declared = factory.importedSkills ?? {};
	const names = Object.keys(declared).sort();
	if (only && !Object.hasOwn(declared, only))
		return fail(
			`factory.yaml's skills declares no ${only}${names.length ? `: it declares ${sentenceList(names)}` : ""}`,
		);
	if (names.length === 0)
		return fail(
			`factory.yaml declares no skills: import one with "openfabriq skill add <owner/repo> <skill>"`,
		);
	const layout = scanLayout(files);
	for (const name of only ? [only] : names) {
		const skill = declared[name];
		const place = skill && declaredPlace(skill, layout);
		if (restored.has(name) || !skill || typeof place === "string" || !place)
			continue;
		await update(name, skill.from, place);
	}
	writeImported(folder, imported.skills);
	if (changed) lines.push("", ...UPDATED_STEPS);
	return { code: failed ? 1 : 0, output: lines.join("\n") };
}

/** Where --agent or --area puts the skill, or why the factory has no such place. */
function placeOf(args: SkillArgs, folder: string): SkillPlace | string {
	if (args.agent && args.area)
		return "Pass --agent or --area, not both: an agent's skills are in its own folder";
	const place = declaredPlace(
		{
			from: "",
			...(args.agent ? { agent: args.agent } : {}),
			...(args.area ? { area: args.area } : {}),
		},
		scanLayout(readFactoryFolder(folder)),
	);
	return typeof place === "string"
		? `The factory has no such place: ${place}`
		: place;
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
	if (!Object.hasOwn(imported.skills, key))
		return fail(
			`openfabriq/${key} is not an imported skill${folders.length ? `; the imported ones are ${sentenceList(folders)}` : ""}. Delete a skill of your own like any other folder.`,
		);
	rmSync(join(folder, key), { recursive: true, force: true });
	const { [key]: _removed, ...rest } = imported.skills;
	writeImported(folder, rest);
	const name = skillPlace(key)?.name;
	if (name) declare(folder, name, undefined);
	return {
		code: 0,
		output: `✓ Removed openfabriq/${key} and its line in factory.yaml's skills. Open a pull request, and run "openfabriq apply" once it is merged.`,
	};
}

/** Writes a skill's declaration in factory.yaml, or takes it out. */
function declare(
	folder: string,
	name: string,
	skill: DeclaredSkill | undefined,
) {
	const path = join(folder, "factory.yaml");
	writeFileSync(
		path,
		withDeclaredSkill(readFileSync(path, "utf8"), name, skill),
	);
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
