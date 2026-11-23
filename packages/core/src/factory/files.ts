import { parse as parseYaml } from "yaml";
import { NAME } from "./factory-rules.js";
import type { FactoryFiles, Problem } from "./types.js";

export function splitFrontMatter(
	text: string,
): { header: unknown; body: string } | string {
	const match =
		/^\uFEFF?---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)([\s\S]*)$/.exec(text);
	if (!match) return "must start with a header between two --- lines";
	const header = readYaml(match[1] ?? "");
	if (typeof header === "string") return header;
	return { header: header.value, body: (match[2] ?? "").trim() };
}

export function readYaml(text: string): { value: unknown } | string {
	try {
		return { value: parseYaml(text) };
	} catch (error) {
		return `invalid YAML: ${String((error as Error).message).split("\n")[0]}`;
	}
}

/** The folders of openfabriq/ that are never an area. */
const RESERVED = new Set(["agents", "automations", "skills", "scripts"]);
/** What an area's folder holds. */
const INSIDE = /^(agents|automations|skills)\//;

/**
 * The areas: the folders of openfabriq/, other than its own, that hold agents/ or automations/.
 * A folder with only skills/ is no area: a folder of notes may have one.
 */
export function areasOf(files: FactoryFiles): Set<string> {
	const areas = new Set<string>();
	for (const path of Object.keys(files)) {
		const [first = "", second] = path.split("/");
		if (
			!RESERVED.has(first) &&
			(second === "agents" || second === "automations")
		)
			areas.add(first);
	}
	return areas;
}

/** A path's area and the rest of it: `qa/agents/x/agent.md` is `agents/x/agent.md` in qa. */
export function splitArea(
	path: string,
	areas: Set<string>,
): { area?: string; rest: string } {
	const slash = path.indexOf("/");
	const first = path.slice(0, slash);
	const rest = path.slice(slash + 1);
	return slash > 0 && areas.has(first) && INSIDE.test(rest)
		? { area: first, rest }
		: { rest: path };
}

/** The folder of an agent or an automation: `qa/agents/tester`, or `agents/tester` without an area. */
export function resourceFolder(
	kind: "agents" | "automations",
	name: string,
	area?: string,
): string {
	return `${area ? `${area}/` : ""}${kind}/${name}`;
}

export interface Layout {
	/** Agent name → path of its agent.md. */
	agentFiles: Map<string, string>;
	/** Automation name → path of its automation.md. */
	automationFiles: Map<string, string>;
	/** agents/<name> or automations/<name>, with its area before → has its main file. */
	folders: Map<string, boolean>;
	/** Agent name → the skills in its own folder. */
	agentSkills: Map<string, Set<string>>;
	/** Skill folder → has SKILL.md. */
	skillFolders: Map<string, boolean>;
	/** The areas, by folder name. */
	areas: Set<string>;
	/** Area → the skills in its skills/ folder. */
	areaSkills: Map<string, Set<string>>;
	/** A second folder for a name already taken: where it is, and the first one's. */
	/** A second folder for a name already taken, always in an area: two folders at the root cannot share a name. */
	duplicates: {
		folder: string;
		first: string;
		name: string;
		kind: "agents" | "automations";
		area: string;
	}[];
}

/** Which agents, automations and skills exist, before reading any of them. */
export function scanLayout(files: FactoryFiles): Layout {
	const areas = areasOf(files);
	const agentFiles = new Map<string, string>();
	const automationFiles = new Map<string, string>();
	const folders = new Map<string, boolean>();
	const agentSkills = new Map<string, Set<string>>();
	const skillFolders = new Map<string, boolean>();
	const areaSkills = new Map<string, Set<string>>();
	const duplicates: Layout["duplicates"] = [];
	// Folders at the root first: a name taken there is the first one.
	const paths = Object.keys(files).sort((a, b) => {
		const rank = (p: string) => (splitArea(p, areas).area ? 1 : 0);
		return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
	});
	for (const path of paths) {
		const { area, rest } = splitArea(path, areas);
		const prefix = area ? `${area}/` : "";
		const own = /^(agents|automations)\/([^/]+)\/(.+)$/.exec(rest);
		const skill = /^(agents\/([^/]+)\/)?skills\/([^/]+)\/(.+)$/.exec(rest);
		if (own) {
			const [, kind = "agents", name = "", tail] = own;
			const main = tail === (kind === "agents" ? "agent.md" : "automation.md");
			const folder = `${prefix}${kind}/${name}`;
			folders.set(folder, folders.get(folder) === true || main);
			const byName = kind === "agents" ? agentFiles : automationFiles;
			const taken = byName.get(name);
			if (main && taken !== undefined)
				duplicates.push({
					folder,
					first: taken.slice(0, taken.lastIndexOf("/")),
					name,
					kind: kind as "agents" | "automations",
					area: area ?? "",
				});
			else if (main) byName.set(name, path);
		}
		if (skill) {
			const skillFolder = `${prefix}${skill[1] ?? ""}skills/${skill[3]}`;
			skillFolders.set(
				skillFolder,
				skillFolders.get(skillFolder) === true || skill[4] === "SKILL.md",
			);
			if (skill[2]) {
				const set = agentSkills.get(skill[2]) ?? new Set();
				agentSkills.set(skill[2], set.add(skill[3] ?? ""));
			} else if (area) {
				const set = areaSkills.get(area) ?? new Set();
				areaSkills.set(area, set.add(skill[3] ?? ""));
			}
		}
	}
	return {
		agentFiles,
		automationFiles,
		folders,
		agentSkills,
		skillFolders,
		areas,
		areaSkills,
		duplicates,
	};
}

/** A second agent or automation of a name another folder already has. */
export function duplicateNames({
	duplicates,
}: Layout): Omit<Problem, "level">[] {
	return duplicates.map(({ folder, first, name, kind, area }) => ({
		file: folder,
		message: `${kind === "agents" ? "an agent" : "an automation"} named ${name} is already in ${first}: names are unique in the whole factory. Rename one, like ${area}-${name}`,
	}));
}

/** Areas whose folder name the engine cannot read, and agents or automations two folders deep. */
export function misplacedAreas(
	files: FactoryFiles,
	{ areas }: Layout,
): Omit<Problem, "level">[] {
	const misnamed = [...areas]
		.sort()
		.filter((area) => !NAME.test(area))
		.map((area) => ({
			file: area,
			message:
				"an area's name is its folder's: lowercase letters, digits and -, like qa",
		}));
	const deep = Object.keys(files)
		.sort()
		.flatMap((path) => {
			const match =
				/^(?:[^/]+\/)+?([^/]+\/(?:agents\/[^/]+\/agent|automations\/[^/]+\/automation)\.md)$/.exec(
					path,
				);
			if (!match || match[1] === undefined || path === match[1]) return [];
			const [first = ""] = path.split("/");
			if (RESERVED.has(first)) return [];
			return [
				{
					file: path,
					message: `an area is one folder under openfabriq/: move it to ${match[1]}`,
				},
			];
		});
	return [...misnamed, ...deep];
}

/** Agents and automations written as one file instead of a folder. */
export function misplacedFiles(files: FactoryFiles): Omit<Problem, "level">[] {
	const areas = areasOf(files);
	return Object.keys(files)
		.sort()
		.flatMap((path) => {
			const { area, rest } = splitArea(path, areas);
			const flat = /^(agents|automations)\/([^/]+)\.md$/.exec(rest);
			if (!flat) return [];
			const prefix = area ? `${area}/` : "";
			const [kind, file] =
				flat[1] === "agents"
					? ["an agent", "agent.md"]
					: ["an automation", "automation.md"];
			return [
				{
					file: path,
					message: `${kind} is a folder: move it to ${prefix}${flat[1]}/${flat[2]}/${file}`,
				},
			];
		});
}

/** The agent and automation folders whose name the engine cannot put in a branch name, like `Nightly Check`. */
export function misnamedFolders({ folders }: Layout): Omit<Problem, "level">[] {
	return [...folders.keys()]
		.sort()
		.filter((folder) => !NAME.test(folder.slice(folder.lastIndexOf("/") + 1)))
		.map((folder) => ({
			file: folder,
			message: /(^|\/)agents\//.test(folder)
				? "an agent's name is its folder's: lowercase letters, digits and -, like reviewer"
				: "an automation's name is its folder's: lowercase letters, digits and -, like nightly-check",
		}));
}

/** The agent, automation and skill folders without their main file. */
export function missingFiles({
	folders,
	skillFolders,
}: Layout): Omit<Problem, "level">[] {
	const missing: Omit<Problem, "level">[] = [];
	for (const [folder, hasMainFile] of [...folders].sort())
		if (!hasMainFile)
			missing.push({
				file: folder,
				message: `missing ${folder}/${/(^|\/)agents\/[^/]+$/.test(folder) ? "agent" : "automation"}.md`,
			});
	for (const [folder, hasSkillFile] of skillFolders)
		if (!hasSkillFile)
			missing.push({ file: folder, message: `missing ${folder}/SKILL.md` });
	return missing;
}

/** A field of a file's front matter, or undefined when the file has no such field or no header. */
export function frontMatterField(text: string, key: string): unknown {
	const split = splitFrontMatter(text);
	const header = typeof split === "string" ? undefined : split.header;
	return header && typeof header === "object" && key in header
		? (header as Record<string, unknown>)[key]
		: undefined;
}

/**
 * Whether a SKILL.md grants tools with allowed-tools: Claude Code would let the agent use them
 * without asking, and the factory alone says which tools an agent may use.
 */
export function grantsTools(skillMd: string): boolean {
	// An empty allowed-tools: still grants: YAML reads it as null, not as absent.
	return frontMatterField(skillMd, "allowed-tools") !== undefined;
}

/** The skills of the factory whose SKILL.md grants tools. */
export function grantingSkills(
	files: FactoryFiles,
	{ skillFolders }: Layout,
): Omit<Problem, "level">[] {
	return [...skillFolders.keys()]
		.sort()
		.map((folder) => `${folder}/SKILL.md`)
		.filter((file) => grantsTools(files[file] ?? ""))
		.map((file) => ({
			file,
			message:
				"allowed-tools grants tools, but the factory lists the tools an agent may use: remove it, and add what the agent needs to its tools",
		}));
}
