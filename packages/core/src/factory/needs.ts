import { frontMatterField } from "./files.js";
import type { Factory, FactoryFiles } from "./types.js";

// What a factory needs on the engine's machine, read from its files, for openfabriq doctor.

const ASSIGNMENT = /^[A-Za-z_]\w*=/;

/**
 * The program a line starts: its first word, after the variable assignments. None for a path
 * (a script of the factory or a file of the repository): it is not looked up on the machine.
 */
export function programStartedBy(line: string): string | undefined {
	const words = line.trim().split(/\s+/);
	const word = words.find((w) => !ASSIGNMENT.test(w))?.split(/[;&|<>()]/)[0];
	return word && !word.includes("/") ? word : undefined;
}

// A package manager command that installs programs by name, as a skill's compatibility writes it.
const INSTALL =
	/\b(?:npm\s+(?:install|i)\s+(?:-g|--global)|brew\s+install|pipx\s+install)((?:\s+[^\s&|;]+)+)/g;

/**
 * The programs a skill's `compatibility` installs: `npm install -g agent-browser` → agent-browser.
 * A scoped npm package names no command, so it is left out, as is every other way to install.
 */
export function installedBy(text: string): string[] {
	return [...text.matchAll(INSTALL)].flatMap((m) =>
		(m[1] ?? "")
			.trim()
			.split(/\s+/)
			.filter((w) => !w.startsWith("-") && !w.startsWith("@"))
			.map((w) => w.replace(/\.$/, "").replace(/@.*$/, ""))
			.filter(Boolean),
	);
}

export interface MachineNeeds {
	/** Program → the lines that start it: "setup", "command test", "MCP server docs", a skill's folder. */
	programs: Record<string, string[]>;
	/** Skill folder → the `compatibility` of its SKILL.md, the Agent Skills field for what it needs. */
	skills: Record<string, string>;
}

export function machineNeeds(
	factory: Factory,
	files: FactoryFiles,
): MachineNeeds {
	const programs: Record<string, string[]> = {};
	const lines: [string, string][] = [
		...(factory.setup ?? []).map((line) => ["setup", line] as [string, string]),
		...Object.entries(factory.commands ?? {}).map(
			([name, line]) => [`command ${name}`, line] as [string, string],
		),
		...Object.entries(factory.mcp ?? {}).flatMap(([name, server]) =>
			"command" in server
				? [[`MCP server ${name}`, server.command] as [string, string]]
				: [],
		),
	];
	for (const [where, line] of lines) {
		const program = programStartedBy(line);
		if (!program) continue;
		programs[program] = [...(programs[program] ?? []), where];
	}
	const skills: Record<string, string> = {};
	for (const [path, text] of Object.entries(files).sort()) {
		if (!path.endsWith("/SKILL.md")) continue;
		const compatibility = frontMatterField(text, "compatibility");
		if (typeof compatibility !== "string" || !compatibility.trim()) continue;
		const skill = path.slice(0, -"/SKILL.md".length);
		skills[skill] = compatibility.trim();
		for (const program of installedBy(compatibility))
			programs[program] = [...(programs[program] ?? []), skill];
	}
	return { programs, skills };
}
