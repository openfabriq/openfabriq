import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LESSON_THRESHOLD, readImportedSkills } from "@openfabriq/core";
import { errorText, jsonLines } from "../files.js";
import type { GitHub } from "../github/github.js";
import { type Apply, projectDir } from "../state/projects.js";
import type { Failure } from "./failures.js";

// Lessons: the common cause of failures and the rule that would have avoided it. They stay
// candidates in the engine's state; only an improvement a person merged reaches Git.

/**
 * candidate: waiting for failures or for its improvement; proposed: its improvement is open;
 * promoted: merged; rejected: closed unmerged, never proposed again; ignored: its failures teach
 * nothing an instruction could fix (a flaky test, a service that was down), never proposed, and
 * not counted as the agents' mistakes.
 */
export type LessonStatus =
	| "candidate"
	| "proposed"
	| "promoted"
	| "rejected"
	| "ignored";

/** A failure as a lesson keeps it: enough to count it without the journal. */
export interface LessonFailure {
	id: string;
	agent: string;
	at: string;
	/** The run's subject, an issue or a pull request: the improvement links it even once the journal no longer has the run. */
	url?: string;
}

export interface Lesson {
	/** L1, L2…: short, for people and for the agent. */
	id: string;
	cause: string;
	/** Empty for an ignored lesson: there is no rule to write. */
	rule: string;
	/** The file the rule goes into, from the repository's root: a skill's Markdown, an agent.md or an automation.md under openfabriq/. Empty for an ignored lesson. */
	target: string;
	failures: LessonFailure[];
	status: LessonStatus;
	/** The pull request that carries it into the factory, and the learning run that opened it. */
	improvement?: { url: string; number: number; run: string; at: string };
	createdAt: string;
	updatedAt: string;
	/** When the engine saw its improvement merged or closed. */
	resolvedAt?: string;
	/** When GitHub merged its improvement. */
	mergedAt?: string;
	/** The commit GitHub merged its improvement as: the engine applies the rule as it is there. */
	mergeCommit?: string;
	/** When the engine last asked for its improvement: one that came to nothing waits for a new failure. */
	triedAt?: string;
}

/** Why a file cannot take a lesson, or undefined. */
export type TargetRefusal = (target: string) => string | undefined;

/** What the learning agent says of a lesson: an existing one the failures join, a new one, or a new one to ignore. */
export type Grouping =
	| { lesson: string; failures: string[] }
	| { cause: string; rule: string; target: string; failures: string[] }
	| { cause: string; ignore: true; failures: string[] };

/** The failures of the ignored lessons: not the agents' mistakes, so never counted as such. */
export const ignoredFailures = (lessons: Lesson[]) =>
	new Set(
		lessons
			.filter((l) => l.status === "ignored")
			.flatMap((l) => l.failures.map((f) => f.id)),
	);

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

/** The agents whose work a lesson's failures judged. */
export const lessonAgents = (lesson: Lesson) => [
	...new Set(lesson.failures.map((f) => f.agent)),
];

/**
 * A lesson whose failures come from enough runs, and no improvement yet: the engine proposes one.
 * One the engine asked for that came to nothing (refused, a check failed, no pull request) waits
 * until a new failure joins it, instead of a paid run at each batch.
 */
export const awaitsImprovement = (lesson: Lesson) =>
	lesson.status === "candidate" &&
	!lesson.improvement &&
	failedRuns(lesson) >= LESSON_THRESHOLD &&
	(lesson.triedAt === undefined || lesson.updatedAt > lesson.triedAt);

/**
 * The next lesson to improve: the oldest that awaits one, and whose target can take it. A target
 * that can no longer (a skill imported since, a file removed) would be refused at each batch.
 */
export const nextToImprove = (lessons: Lesson[], refusal: TargetRefusal) =>
	lessons.find((l) => awaitsImprovement(l) && !refusal(l.target));

/** Why a file cannot take a lesson, or undefined: a skill's Markdown, an agent.md or an automation.md of the factory. */
export function targetProblem(target: string): string | undefined {
	return isImprovable(target)
		? undefined
		: `"${target}" is neither a Markdown file of a skill of the factory, an agent.md, nor an automation.md: name one, like openfabriq/skills/<skill>/SKILL.md, openfabriq/agents/<agent>/agent.md or openfabriq/automations/<automation>/automation.md`;
}

/** The folders of the skills imported from public repositories, as `openfabriq/<folder>/`, from imported-skills.json: none when it is missing or broken, which validate refuses. */
export function importedFolders(lock: string | undefined): string[] {
	const read = lock === undefined ? [] : readImportedSkills(lock);
	return Array.isArray(read)
		? []
		: Object.keys(read.skills).map((folder) => `openfabriq/${folder}/`);
}

/** Why a file of an imported skill cannot change, or undefined: it stays as its source has it, so `openfabriq skill update` keeps working. */
export function importedProblem(
	path: string,
	imported: string[],
): string | undefined {
	const folder = imported.find((f) => path.startsWith(f));
	return folder
		? `${path} is in ${folder.slice(0, -1)}, a skill imported from a public repository: it stays as its source has it. Write the rule into the agent.md of the agent that uses it`
		: undefined;
}

/** A file whose front matter an improvement keeps: an agent.md, an automation.md (its triggers and rights), or a skill's SKILL.md. */
export const keepsFrontMatter = (path: string) =>
	path.endsWith("/agent.md") ||
	path.endsWith("/automation.md") ||
	path.endsWith("/SKILL.md");

/** Why an agent.md, an automation.md or a SKILL.md that is not in the worktree cannot take a lesson: an improvement only changes their body. */
function missingFileProblem(
	target: string,
	worktree: string,
): string | undefined {
	if (!keepsFrontMatter(target) || existsSync(join(worktree, target)))
		return undefined;
	return `${target} does not exist: an improvement changes the body of an existing agent.md, automation.md or SKILL.md. Name one, or another Markdown file of a skill`;
}

/**
 * Why a file of this worktree cannot take a lesson: not improvable, in an imported skill, or an
 * agent.md, automation.md or SKILL.md that is not there.
 */
export function targetRefusalIn(
	worktree: string,
	imported: string[],
): TargetRefusal {
	return (target) =>
		targetProblem(target) ??
		importedProblem(target, imported) ??
		missingFileProblem(target, worktree);
}

/** A file an improvement may change, from the repository's root: a skill's Markdown, an agent.md or an automation.md (their body: the guard checks the front matter). */
export function isImprovable(path: string): boolean {
	if (
		path.split("/").some((part) => part === "" || part === "." || part === "..")
	)
		return false;
	return (
		/^openfabriq\/([^/]+\/)?(agents\/[^/]+\/)?skills\/[^/]+\/.+\.md$/.test(
			path,
		) ||
		/^openfabriq\/([^/]+\/)?agents\/[^/]+\/agent\.md$/.test(path) ||
		/^openfabriq\/([^/]+\/)?automations\/[^/]+\/automation\.md$/.test(path)
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
	refusal: TargetRefusal,
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
		} else if (!("ignore" in g)) {
			const why = refusal(g.target);
			if (why) problems.push(why);
		}
	}
	if (problems.length) return { problems };

	const at = now.toISOString();
	const kept = (ids: string[]): LessonFailure[] =>
		ids.flatMap((id) => {
			const f = byId.get(id);
			return f
				? [
						{
							id: f.id,
							agent: f.agent,
							at: f.at,
							...(f.url ? { url: f.url } : {}),
						},
					]
				: [];
		});
	let lastNumber = Math.max(
		0,
		...lessons.map((l) => Number(l.id.slice(1)) || 0),
	);
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
				failures: [...lesson.failures, ...kept(g.failures)],
				updatedAt: at,
			};
			all[index] = grown;
			changed.push(grown);
		} else {
			lastNumber += 1;
			const ignored = "ignore" in g;
			const lesson: Lesson = {
				id: `L${lastNumber}`,
				cause: g.cause,
				rule: ignored ? "" : g.rule,
				target: ignored ? "" : g.target,
				failures: kept(g.failures),
				status: ignored ? "ignored" : "candidate",
				createdAt: at,
				updatedAt: at,
			};
			all.push(lesson);
			changed.push(lesson);
		}
	}
	return { lessons: all, changed };
}

/** How an improvement's pull request stands on GitHub, and once merged, when and as which commit. */
export interface PullState {
	state: string;
	mergedAt?: string;
	mergeCommit?: string;
}

/** How an improvement's pull request stands on GitHub: OPEN, MERGED or CLOSED, with GitHub's merge time; undefined when GitHub did not answer, and the log says so. */
export async function pullState(
	github: Pick<GitHub, "subject">,
	repository: string,
	number: number,
	log?: (line: string) => void,
): Promise<PullState | undefined> {
	return github.subject(repository, number, true).then(
		(p) => {
			const commit = (p.mergeCommit as { oid?: unknown } | null | undefined)
				?.oid;
			return {
				state: String(p.state ?? ""),
				...(typeof p.mergedAt === "string" ? { mergedAt: p.mergedAt } : {}),
				...(typeof commit === "string" ? { mergeCommit: commit } : {}),
			};
		},
		(error: unknown) => {
			log?.(
				`${repository}: could not read learning's pull request #${number}: ${errorText(error)}`,
			);
			return undefined;
		},
	);
}

/** A lesson once its improvement's pull request is seen merged (GitHub's `mergedAt`), closed, or still open. */
export function resolvedByPullRequest(
	lesson: Lesson,
	pull: PullState,
	now: Date,
): Lesson | undefined {
	const { state, mergedAt, mergeCommit } = pull;
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
		...(status === "promoted" && mergeCommit ? { mergeCommit } : {}),
		updatedAt: at,
	};
}

/**
 * The failures of a lesson that happened once its improvement ran: after the first apply of the
 * factory that followed GitHub's merge. Merged and not applied yet, nothing came back.
 */
export function cameBack(lesson: Lesson, applies: Apply[]): LessonFailure[] {
	const applied = appliedAt(lesson, applies);
	return applied ? lesson.failures.filter((f) => f.at > applied) : [];
}

/**
 * When a merged improvement started to run: the first apply after GitHub's merge, a person's or
 * the engine's of this very rule; undefined before. Another rule applied alone does not carry it.
 */
export function appliedAt(
	lesson: Lesson,
	applies: Apply[],
): string | undefined {
	// GitHub's merge time; an older lesson has only the batch that saw it.
	const merged = lesson.mergedAt ?? lesson.resolvedAt;
	if (lesson.status !== "promoted" || !merged) return undefined;
	return applies
		.filter(
			(a) => a.at >= merged && (!a.lessons || a.lessons.includes(lesson.id)),
		)
		.map((a) => a.at)
		.sort()[0];
}
