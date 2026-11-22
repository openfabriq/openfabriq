import { z } from "zod";
import type { Layout } from "./files.js";
import type { FactoryFiles, Problem } from "./types.js";

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
	/** The branch it was taken from. */
	ref: z.string().regex(/^(?!-)[\w./-]+$/, { error: "is a branch's name" }),
	commit: z.string().regex(/^[0-9a-f]{40}$/, { error: "is a commit's SHA" }),
	/** Its SKILL.md in the source repository. */
	skillPath: z.string().regex(/^(?:(?!\.{1,2}\/)[\w.-]+\/)*SKILL\.md$/, {
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

/** Problems of imported-skills.json: its shape, and entries whose folder is no skill of the factory. */
export function importedSkillsProblems(
	files: FactoryFiles,
	{ skillFolders }: Layout,
): Omit<Problem, "level">[] {
	const text = files[IMPORTED_SKILLS];
	if (text === undefined) return [];
	const read = readImportedSkills(text);
	const messages = Array.isArray(read)
		? read
		: Object.keys(read.skills)
				.sort()
				.filter((folder) => !skillFolders.get(folder))
				.map(
					(folder) =>
						`lists ${folder}, which is not a skill folder of the factory: run "openfabriq skill remove ${folder}"`,
				);
	return messages.map((message) => ({ file: IMPORTED_SKILLS, message }));
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
