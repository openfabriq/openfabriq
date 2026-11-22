import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LESSON_THRESHOLD } from "@openfabriq/core";
import { jsonLines } from "../files.js";
import { projectDir } from "../state/projects.js";
import type { Failure } from "./failures.js";

// Lessons: the common cause of failures and the rule that would have avoided it. They stay
// candidates in the engine's state; only an improvement a person merged reaches Git.

/**
 * candidate: waiting for failures or for its improvement; proposed: its improvement is open;
 * promoted: merged; rejected: closed unmerged, never proposed again.
 */
export type LessonStatus = "candidate" | "proposed" | "promoted" | "rejected";

/** A failure as a lesson keeps it: enough to count it without the journal. */
export interface LessonFailure {
	id: string;
	agent: string;
	at: string;
}

export interface Lesson {
	/** L1, L2…: short, for people and for the agent. */
	id: string;
	cause: string;
	rule: string;
	/** The file the rule goes into, from the repository's root: a skill's Markdown or an agent.md under openfabriq/. */
	target: string;
	failures: LessonFailure[];
	status: LessonStatus;
	/** The pull request that carries it into the factory, and the learning run that opened it. */
	improvement?: { url: string; number: number; run: string; at: string };
	createdAt: string;
	updatedAt: string;
	/** When the engine saw its improvement merged or closed. */
	resolvedAt?: string;
	/** When GitHub merged its improvement: failures after it came back. */
	mergedAt?: string;
}

/** What the learning agent says of a lesson: an existing one the failures join, or a new one. */
export type Grouping =
	| { lesson: string; failures: string[] }
	| { cause: string; rule: string; target: string; failures: string[] };

const lessonsFile = (repository: string) =>
	join(projectDir(repository), "lessons.jsonl");

/** The lessons of a project, by id, the last line of each winning, oldest first. */
export function readLessons(repository: string): Lesson[] {
	const file = lessonsFile(repository);
	if (!existsSync(file)) return [];
	const byId = new Map<string, Lesson>();
	for (const lesson of jsonLines<Lesson>(readFileSync(file, "utf8")))
		byId.set(lesson.id, lesson);
	return [...byId.values()];
}

/** Writes the lessons that changed, one line each. */
export function saveLessons(repository: string, changed: Lesson[]): void {
	if (changed.length === 0) return;
	mkdirSync(projectDir(repository), { recursive: true });
	appendFileSync(
		lessonsFile(repository),
		changed.map((l) => `${JSON.stringify(l)}\n`).join(""),
	);
}

/** The failures no lesson holds yet: those the next batch studies. */
export function newFailures(failures: Failure[], lessons: Lesson[]): Failure[] {
	const held = new Set(lessons.flatMap((l) => l.failures.map((f) => f.id)));
	return failures.filter((f) => !held.has(f.id));
}

/**
 * How many runs a lesson's failures come from: a run whose review asked for changes and whose
 * checks then failed is one incident, not two. A failure's id is `<run id>:<kind>`.
 */
export const failedRuns = (lesson: Lesson) =>
	new Set(lesson.failures.map((f) => f.id.slice(0, f.id.lastIndexOf(":"))))
		.size;

/** A lesson whose failures come from enough runs, and no improvement yet: the engine proposes one. */
export const awaitsImprovement = (lesson: Lesson) =>
	lesson.status === "candidate" &&
	!lesson.improvement &&
	failedRuns(lesson) >= LESSON_THRESHOLD;

/** The next lesson to improve: the oldest that awaits one. */
export const nextToImprove = (lessons: Lesson[]) =>
	lessons.find(awaitsImprovement);

/** Why a file cannot take a lesson, or undefined: a skill's Markdown or an agent.md of the factory. */
export function targetProblem(target: string): string | undefined {
	return isImprovable(target)
		? undefined
		: `"${target}" is neither a Markdown file of a skill of the factory nor an agent.md: name one, like openfabriq/skills/<skill>/SKILL.md or openfabriq/agents/<agent>/agent.md`;
}

/** A file an improvement may change, from the repository's root: a skill's Markdown, or an agent.md (its body: the guard checks the front matter). */
export function isImprovable(path: string): boolean {
	if (
		path.split("/").some((part) => part === "" || part === "." || part === "..")
	)
		return false;
	return (
		/^openfabriq\/([^/]+\/)?(agents\/[^/]+\/)?skills\/[^/]+\/.+\.md$/.test(
			path,
		) || /^openfabriq\/([^/]+\/)?agents\/[^/]+\/agent\.md$/.test(path)
	);
}

/**
 * The lessons once the agent's groupings are applied, and those that changed; or why the groupings
 * cannot be taken: every new failure goes to exactly one lesson, existing or new.
 */
export function groupIntoLessons(
	lessons: Lesson[],
	staged: Failure[],
	groupings: Grouping[],
	now: Date,
): { lessons: Lesson[]; changed: Lesson[] } | { problems: string[] } {
	const problems: string[] = [];
	const byId = new Map(staged.map((f) => [f.id, f]));
	const seen = new Set<string>();
	for (const g of groupings)
		for (const id of g.failures) {
			if (!byId.has(id)) problems.push(`${id} is not a failure of this batch`);
			else if (seen.has(id)) problems.push(`${id} is in two lessons`);
			seen.add(id);
		}
	const missing = staged.filter((f) => !seen.has(f.id)).map((f) => f.id);
	if (missing.length)
		problems.push(`every failure needs a lesson: ${missing.join(", ")}`);
	for (const g of groupings) {
		if ("lesson" in g) {
			if (!lessons.some((l) => l.id === g.lesson))
				problems.push(`${g.lesson} is not a lesson`);
		} else {
			const why = targetProblem(g.target);
			if (why) problems.push(why);
		}
	}
	if (problems.length) return { problems };

	const at = now.toISOString();
	const held = (ids: string[]): LessonFailure[] =>
		ids.flatMap((id) => {
			const f = byId.get(id);
			return f ? [{ id: f.id, agent: f.agent, at: f.at }] : [];
		});
	let next = Math.max(0, ...lessons.map((l) => Number(l.id.slice(1)) || 0));
	const all = [...lessons];
	const changed: Lesson[] = [];
	for (const g of groupings) {
		if (g.failures.length === 0) continue;
		if ("lesson" in g) {
			const index = all.findIndex((l) => l.id === g.lesson);
			const lesson = all[index];
			if (!lesson) continue;
			const grown = {
				...lesson,
				failures: [...lesson.failures, ...held(g.failures)],
				updatedAt: at,
			};
			all[index] = grown;
			changed.push(grown);
		} else {
			next += 1;
			const lesson: Lesson = {
				id: `L${next}`,
				cause: g.cause,
				rule: g.rule,
				target: g.target,
				failures: held(g.failures),
				status: "candidate",
				createdAt: at,
				updatedAt: at,
			};
			all.push(lesson);
			changed.push(lesson);
		}
	}
	return { lessons: all, changed };
}

/** A lesson once its improvement's pull request is seen merged (GitHub's `mergedAt`), closed, or still open. */
export function resolvedByPullRequest(
	lesson: Lesson,
	pull: { state: string; mergedAt?: string | undefined },
	now: Date,
): Lesson | undefined {
	const { state, mergedAt } = pull;
	if (lesson.status !== "proposed") return undefined;
	const status =
		state === "MERGED"
			? "promoted"
			: state === "CLOSED"
				? "rejected"
				: undefined;
	if (!status) return undefined;
	const at = now.toISOString();
	return {
		...lesson,
		status,
		resolvedAt: at,
		...(status === "promoted" && mergedAt ? { mergedAt } : {}),
		updatedAt: at,
	};
}

/** The failures of a lesson that happened after its improvement was merged: the cause came back. */
export function cameBack(lesson: Lesson): LessonFailure[] {
	// GitHub's merge time; an older lesson has only the batch that saw it.
	const merged = lesson.mergedAt ?? lesson.resolvedAt;
	return lesson.status === "promoted" && merged
		? lesson.failures.filter((f) => f.at > merged)
		: [];
}
