import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type ChangedFile,
	type CommandRun,
	type Hunk,
	jsonLines,
	parseHunks,
	projectDir,
	type ReviewPhase,
	type ReviewRound,
	type RunRecord,
} from "@openfabriq/runner";

/** A changed file as the run's page gets it: its diff cut into hunks of numbered lines. */
export type ShownFile = Omit<ChangedFile, "patch"> & { hunks?: Hunk[] };

/** The run's changed files, as the engine kept them. */
export interface ShownFiles {
	total: number;
	files: ShownFile[];
}

/** What the engine kept on disk for a run: its prompt, the commands and checks it ran, its transcript as JSON lines, the files it changed. */
export interface RunFiles {
	prompt?: string;
	commands: CommandRun[];
	transcript: string;
	/** Recorded once the run ended; a running or older run has none. */
	changedFiles?: ShownFiles;
	/** reviewed_by: the rounds of the internal review, as each one ends. */
	reviews?: ReviewRound[];
	/** reviewed_by: who works now, during a round of review or the fixes after one. */
	phase?: ReviewPhase;
}

/** phase.json, or undefined when it is missing, cut short or of another shape. */
export function reviewPhase(text: string | undefined): ReviewPhase | undefined {
	if (text === undefined) return undefined;
	try {
		const p = JSON.parse(text) as Partial<ReviewPhase> | null;
		return p &&
			(p.doing === "reviewing" || p.doing === "fixing") &&
			typeof p.agent === "string" &&
			typeof p.round === "number" &&
			typeof p.limit === "number" &&
			typeof p.since === "string"
			? (p as ReviewPhase)
			: undefined;
	} catch {
		return undefined;
	}
}

/** reviews.json, or undefined when it is missing, cut short or of another shape. */
export function reviewRounds(
	text: string | undefined,
): ReviewRound[] | undefined {
	if (text === undefined) return undefined;
	try {
		const parsed: unknown = JSON.parse(text);
		return Array.isArray(parsed) ? (parsed as ReviewRound[]) : undefined;
	} catch {
		return undefined;
	}
}

/** changed-files.json, or undefined when it is missing or cut short (the engine stopped while writing it): the page falls back on the edit calls. */
export function changedFiles(text: string | undefined): ShownFiles | undefined {
	if (text === undefined) return undefined;
	try {
		const parsed = JSON.parse(text) as { total: number; files: ChangedFile[] };
		if (!Array.isArray(parsed?.files) || typeof parsed.total !== "number")
			return undefined;
		return {
			total: parsed.total,
			files: parsed.files.map(({ patch, ...file }) =>
				typeof patch === "string"
					? { ...file, hunks: parseHunks(patch) }
					: file,
			),
		};
	} catch {
		return undefined;
	}
}

/** The run's files in runs/<id>/; a file the run never wrote is left out, or empty. */
export function readRunFiles(run: RunRecord): RunFiles {
	const dir = join(projectDir(run.repository), "runs", run.id);
	const read = (name: string) => {
		const path = join(dir, name);
		return existsSync(path) ? readFileSync(path, "utf8") : undefined;
	};
	const prompt = read("prompt.md");
	const commands = read("commands.jsonl");
	const changed = changedFiles(read("changed-files.json"));
	const reviews = reviewRounds(read("reviews.json"));
	const phase = reviewPhase(read("phase.json"));
	return {
		...(prompt !== undefined ? { prompt } : {}),
		...(changed ? { changedFiles: changed } : {}),
		...(reviews ? { reviews } : {}),
		...(phase ? { phase } : {}),
		commands: commands !== undefined ? jsonLines<CommandRun>(commands) : [],
		transcript: read("transcript.jsonl") ?? "",
	};
}
