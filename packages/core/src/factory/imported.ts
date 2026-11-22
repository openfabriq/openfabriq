import { createHash } from "node:crypto";
import { z } from "zod";
import type { Layout } from "./files.js";
import type { FactoryFiles, Problem } from "./types.js";

/**
 * Where a factory records the skills it imported from public repositories, by folder: each entry
 * has the fields of the skills CLI's skills-lock.json (version 2), and the same content hash.
 */
export const IMPORTED_SKILLS = "imported-skills.json";

const ImportedSkill = z.strictObject({
	/** The GitHub repository, owner/repo. */
	source: z.string().regex(/^[\w.-]+\/[\w.-]+$/, {
		error: "is a GitHub repository, like mattpocock/skills",
	}),
	sourceType: z.literal("github"),
	/** The branch it was taken from. */
	ref: z.string().min(1),
	commit: z.string().regex(/^[0-9a-f]{40}$/, { error: "is a commit's SHA" }),
	/** Its SKILL.md in the source repository. */
	skillPath: z.string().regex(/(^|\/)SKILL\.md$/, {
		error: "is the path of a SKILL.md",
	}),
	computedHash: z
		.string()
		.regex(/^[0-9a-f]{64}$/, { error: "is a SHA-256 in hex" }),
});
const ImportedSkillsFile = z.strictObject({
	version: z.literal(1),
	skills: z.record(z.string(), ImportedSkill),
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

// What the skills CLI leaves out of a skill, so of its hash.
const LEFT_OUT_FILES = new Set(["metadata.json"]);
const LEFT_OUT_FOLDERS = new Set([".git", "__pycache__", "__pypackages__"]);

/** Whether a file of a skill, by its path in the skill's folder, is copied and hashed. */
export function isHashed(path: string): boolean {
	const parts = path.split("/").filter(Boolean);
	return !parts.some((part, i) =>
		i < parts.length - 1
			? LEFT_OUT_FOLDERS.has(part)
			: LEFT_OUT_FILES.has(part),
	);
}

/**
 * The skills CLI's content hash of a skill folder: its files sorted by the bytes of their path,
 * each fed as `path \0 length \0 content` into one SHA-256, CRLF read as LF in a file without a
 * NUL byte. Lowercase hex.
 */
export function skillHash(
	files: { path: string; content: Uint8Array }[],
): string {
	const encoder = new TextEncoder();
	const entries = files
		.filter((file) => isHashed(file.path))
		.map((file) => ({
			path: Buffer.from(encoder.encode(file.path)),
			content: lf(Buffer.from(file.content)),
		}))
		.sort((a, b) => Buffer.compare(a.path, b.path));
	const hash = createHash("sha256");
	for (const { path, content } of entries)
		hash
			.update(path)
			.update("\0")
			.update(String(content.length))
			.update("\0")
			.update(content);
	return hash.digest("hex");
}

function lf(content: Buffer): Buffer {
	if (content.includes(0) || !content.includes("\r\n")) return content;
	return Buffer.from(
		content.toString("latin1").replaceAll("\r\n", "\n"),
		"latin1",
	);
}
