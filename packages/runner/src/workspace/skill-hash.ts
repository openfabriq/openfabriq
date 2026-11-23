import { createHash } from "node:crypto";
import {
	existsSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
} from "node:fs";
import { join, sep } from "node:path";

// The content hash of the skills CLI's skills-lock.json (version 2), its computedHash: an imported
// skill's entry in imported-skills.json carries it, so both tools agree on a skill's content.

/** A file of a skill: its path in the skill's folder, with /, and its bytes. */
export interface SkillFile {
	path: string;
	content: Uint8Array;
}

// What the skills CLI leaves out of a skill, so of its hash and of the copy.
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
export function skillHash(files: SkillFile[]): string {
	const entries = files
		.filter((file) => isHashed(file.path))
		.map((file) => ({
			path: Buffer.from(file.path, "utf8"),
			content: crlfToLf(Buffer.from(file.content)),
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

function crlfToLf(content: Buffer): Buffer {
	if (content.includes(0) || !content.includes("\r\n")) return content;
	return Buffer.from(
		content.toString("latin1").replaceAll("\r\n", "\n"),
		"latin1",
	);
}

/**
 * The files of a skill folder that the skills CLI copies, with their bytes; none when there is no
 * folder. A link counts as what it points to, unless it is broken, loops, or leaves the folder.
 */
export function skillFiles(dir: string): SkillFile[] {
	if (!existsSync(dir)) return [];
	const root = realpathSync(dir);
	const files: SkillFile[] = [];
	const walk = (folder: string, prefix: string, ancestors: Set<string>) => {
		const real = realpathSync(folder);
		if (ancestors.has(real)) return;
		const branch = new Set(ancestors).add(real);
		for (const entry of readdirSync(folder, { withFileTypes: true })) {
			const full = join(folder, entry.name);
			let target = full;
			if (entry.isSymbolicLink()) {
				try {
					target = realpathSync(full);
				} catch {
					continue;
				}
				if (target !== root && !target.startsWith(root + sep)) continue;
			} else if (!entry.isFile() && !entry.isDirectory()) continue;
			const isFolder = statSync(target).isDirectory();
			const path = prefix + entry.name;
			if (!isHashed(isFolder ? `${path}/x` : path)) continue;
			if (isFolder) walk(full, `${path}/`, branch);
			else files.push({ path, content: readFileSync(target) });
		}
	};
	walk(dir, "", new Set());
	return files;
}
