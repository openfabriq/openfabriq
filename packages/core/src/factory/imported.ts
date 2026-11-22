import { isMap, isScalar, parseDocument } from "yaml";
import { z } from "zod";
import { suggested } from "../words.js";
import { type Layout, splitArea } from "./files.js";
import type { DeclaredSkill, FactoryFiles, Problem } from "./types.js";

/**
 * Where a factory records the skills it imported from public repositories, by folder: each entry
 * has the fields of the skills CLI's skills-lock.json (version 2), and the same content hash.
 */
export const IMPORTED_SKILLS = "imported-skills.json";

/**
 * A GitHub repository, owner/repo: never starting with -, which a command would read as an
 * option, nor `.` or `..` as its name, which would lead a GitHub API path elsewhere.
 */
export const REPOSITORY =
	/^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.{1,2}$)(?!-)[A-Za-z0-9._-]+$/;

const ImportedSkill = z.strictObject({
	source: z.string().regex(REPOSITORY, {
		error: "is a GitHub repository, like mattpocock/skills",
	}),
	sourceType: z.literal("github"),
	/** The branch it was taken from: what git allows in a branch's name, never a leading -. */
	// biome-ignore lint/suspicious/noControlCharactersInRegex: they are what is refused.
	ref: z.string().regex(/^(?!-)[^\u0000- \u007f~^:?*[\\]+$/, {
		error: "is a branch's name",
	}),
	commit: z.string().regex(/^[0-9a-f]{40}$/, { error: "is a commit's SHA" }),
	/** Its SKILL.md in the source repository: any folder's name, but no . or .. and nothing that drives a terminal. */
	skillPath: z
		.string()
		// biome-ignore lint/suspicious/noControlCharactersInRegex: they are what is refused.
		.regex(/^(?:(?!\.{1,2}\/)[^/\u0000-\u001f\u007f-\u009f]+\/)*SKILL\.md$/, {
			error: "is the path of a SKILL.md in the repository",
		}),
	computedHash: z
		.string()
		.regex(/^[0-9a-f]{64}$/, { error: "is a SHA-256 in hex" }),
});
const ImportedSkillsFile = z
	.strictObject({
		version: z.literal(1),
		skills: z.record(z.string(), ImportedSkill),
	})
	// A key is a skill's folder in openfabriq/, never a path that leaves it: skill remove deletes it.
	.superRefine(({ skills }, ctx) => {
		for (const folder of Object.keys(skills))
			if (skillPlace(folder) === undefined)
				ctx.addIssue({
					code: "custom",
					path: ["skills", folder],
					message:
						"is a skill's folder in openfabriq/, like skills/code-review",
				});
	});

export type ImportedSkill = z.infer<typeof ImportedSkill>;
export type ImportedSkills = z.infer<typeof ImportedSkillsFile>;

/** The file's entries, or what is wrong with it. */
export function readImportedSkills(text: string): ImportedSkills | string[] {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return [
			`is not JSON; "openfabriq skill add" writes it, never edit it by hand`,
		];
	}
	const parsed = ImportedSkillsFile.safeParse(value);
	return parsed.success
		? parsed.data
		: parsed.error.issues.map(
				(issue) =>
					`${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message}`,
			);
}

/** The file as `openfabriq skill add` writes it: folders sorted, so a change is one line. */
export function importedSkillsText(skills: ImportedSkills["skills"]): string {
	const sorted = Object.fromEntries(
		Object.entries(skills).sort(([a], [b]) => (a < b ? -1 : 1)),
	);
	return `${JSON.stringify({ version: 1, skills: sorted }, null, 2)}\n`;
}

/**
 * Problems of the imported skills: imported-skills.json's shape, entries whose folder is no skill
 * of the factory, and any gap between it and what factory.yaml's `skills` declares.
 */
export function importedSkillsProblems(
	files: FactoryFiles,
	layout: Layout,
	declared: Record<string, DeclaredSkill> = {},
): Omit<Problem, "level">[] {
	const text = files[IMPORTED_SKILLS];
	const read =
		text === undefined
			? { version: 1 as const, skills: {} }
			: readImportedSkills(text);
	if (Array.isArray(read))
		return read.map((message) => ({ file: IMPORTED_SKILLS, message }));
	const problems: Omit<Problem, "level">[] = [];
	const inLock = (message: string) =>
		problems.push({ file: IMPORTED_SKILLS, message });
	const inFactory = (message: string) =>
		problems.push({ file: "factory.yaml", message });
	for (const folder of Object.keys(read.skills).sort())
		if (!layout.skillFolders.get(folder))
			inLock(
				`lists ${folder}, which is not a skill folder of the factory: run "openfabriq skill remove ${folder}"`,
			);
	const declaredFolders = new Set<string>();
	for (const [name, skill] of Object.entries(declared).sort()) {
		const place = declaredPlace(skill, layout);
		if (typeof place === "string") {
			inFactory(`skills.${name}: ${place}`);
			continue;
		}
		const folder = skillFolder(name, place);
		declaredFolders.add(folder);
		const entry = read.skills[folder];
		if (!entry)
			inFactory(
				`skills.${name}: declared, but not imported: run "${skillAddCommand(name, skill)}"`,
			);
		else if (entry.source !== skill.from)
			inFactory(
				`skills.${name}: declared from ${skill.from}, but imported from ${entry.source}: run "${skillAddCommand(name, skill)}"`,
			);
	}
	for (const folder of Object.keys(read.skills).sort())
		if (!declaredFolders.has(folder))
			inLock(
				`imports ${folder}, which factory.yaml's skills does not declare: declare it, or run "openfabriq skill remove ${folder}"`,
			);
	return problems;
}

/** Where a declared skill goes, or why its agent or area does not exist. */
export function declaredPlace(
	skill: DeclaredSkill,
	{ agentFiles, areas }: Pick<Layout, "agentFiles" | "areas">,
): SkillPlace | string {
	if (skill.agent) {
		const agentFile = agentFiles.get(skill.agent);
		if (!agentFile)
			return suggested(`agent "${skill.agent}" does not exist.`, skill.agent, [
				...agentFiles.keys(),
			]);
		const { area } = splitArea(agentFile, areas);
		return { agent: skill.agent, ...(area ? { area } : {}) };
	}
	if (skill.area)
		return areas.has(skill.area)
			? { area: skill.area }
			: suggested(`area "${skill.area}" does not exist.`, skill.area, [
					...areas,
				]);
	return {};
}

/** The command that imports a declared skill, as the person would type it. */
export function skillAddCommand(name: string, skill: DeclaredSkill): string {
	const where = skill.agent
		? ` --agent ${skill.agent}`
		: skill.area
			? ` --area ${skill.area}`
			: "";
	return `openfabriq skill add ${skill.from} ${name}${where}`;
}

/** Where an imported skill goes: an agent's own skills, an area's, or the shared ones. */
export type SkillPlace =
	| { agent: string; area?: string }
	| { area: string }
	| Record<string, never>;

/** The skill's folder in openfabriq/, its key in imported-skills.json: `qa/agents/tester/skills/tdd`. */
export function skillFolder(name: string, place: SkillPlace): string {
	const area = "area" in place && place.area ? `${place.area}/` : "";
	const agent = "agent" in place ? `agents/${place.agent}/` : "";
	return `${area}${agent}skills/${name}`;
}

/** A skill's folder read back: its name and its place, or undefined for no skill folder. */
export function skillPlace(
	folder: string,
): { name: string; place: SkillPlace } | undefined {
	// Names only: lowercase letters, digits and -, so no part is . or .. or leaves openfabriq/.
	const match =
		/^(?:([a-z0-9][a-z0-9-]*)\/)?(?:agents\/([a-z0-9][a-z0-9-]*)\/)?skills\/([a-z0-9][a-z0-9-]*)$/.exec(
			folder,
		);
	if (!match) return undefined;
	const [, area, agent, name = ""] = match;
	const place: SkillPlace = agent
		? { agent, ...(area ? { area } : {}) }
		: area
			? { area }
			: {};
	return { name, place };
}

/**
 * factory.yaml with a skill declared, or no longer declared without `skill`. Only that skill's line
 * changes; the rest of the text and its comments stay as they are, but a `skills` written in flow
 * style is rewritten whole. A shared skill is one line; an agent's or an area's, `{ from, agent }`.
 */
export function withDeclaredSkill(
	factoryYaml: string,
	name: string,
	skill: DeclaredSkill | undefined,
): string {
	const doc = parseDocument(factoryYaml);
	const root = doc.contents;
	const pair = isMap(root)
		? root.items.find(
				(item) => isScalar(item.key) && item.key.value === "skills",
			)
		: undefined;
	const read: unknown = pair?.value
		? (pair.value as { toJSON(): unknown }).toJSON()
		: {};
	const skills: Record<string, unknown> =
		read && typeof read === "object"
			? { ...(read as Record<string, unknown>) }
			: {};
	if (skill) skills[name] = skill;
	else delete skills[name];
	const lines = Object.entries(skills).map(
		([key, value]) => `  ${key}: ${declarationText(value)}`,
	);
	const entries =
		isMap(pair?.value) && !pair.value.flow ? pair.value.items : undefined;
	if (entries?.length && lines.length) {
		// Only that skill's line changes, so the others keep their comments.
		const span = (item: (typeof entries)[number]) => {
			const keyAt = rangeOf(item.key)?.[0] ?? 0;
			const valueEnd = rangeOf(item.value)?.[1] ?? rangeOf(item.key)?.[1] ?? 0;
			const newline = factoryYaml.indexOf("\n", valueEnd - 1);
			const start = factoryYaml.lastIndexOf("\n", keyAt - 1) + 1;
			return {
				start,
				end: newline === -1 ? factoryYaml.length : newline + 1,
				indent: factoryYaml.slice(start, keyAt),
			};
		};
		const { indent } = span(entries[0] as (typeof entries)[number]);
		const line = skill ? `${indent}${name}: ${declarationText(skill)}\n` : "";
		const own = entries.find(
			(item) => isScalar(item.key) && item.key.value === name,
		);
		const { start, end } = own
			? span(own)
			: span(entries.at(-1) as (typeof entries)[number]);
		if (!own) {
			const text = factoryYaml.slice(0, end);
			const gap = text.endsWith("\n") ? "" : "\n";
			return `${text}${gap}${line}${factoryYaml.slice(end)}`;
		}
		return `${factoryYaml.slice(0, start)}${line}${factoryYaml.slice(end)}`;
	}
	const section = lines.length ? `skills:\n${lines.join("\n")}\n` : "";
	const keyStart = pair && isScalar(pair.key) ? pair.key.range?.[0] : undefined;
	const valueEnd = (pair?.value as { range?: number[] } | undefined)
		?.range?.[2];
	if (keyStart === undefined || valueEnd === undefined) {
		const text =
			factoryYaml.endsWith("\n") || !factoryYaml
				? factoryYaml
				: `${factoryYaml}\n`;
		return `${text}${section}`;
	}
	const after = factoryYaml.slice(valueEnd).replace(/^\n/, "");
	return `${factoryYaml.slice(0, keyStart)}${section}${after}`;
}

const rangeOf = (node: unknown) =>
	(node as { range?: [number, number, number] } | null)?.range;

/** A declaration as factory.yaml writes it: the repository, or `{ from, agent }` and the like. */
function declarationText(value: unknown): string {
	if (typeof value === "string") return value;
	if (!value || typeof value !== "object") return String(value);
	const { from, agent, area } = value as DeclaredSkill;
	if (!agent && !area) return String(from);
	return `{ from: ${from}, ${agent ? `agent: ${agent}` : `area: ${area}`} }`;
}
