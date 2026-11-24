import { type Factory, LESSON_THRESHOLD, learningText } from "@openfabriq/core";
import {
	awaitsImprovement,
	cameBack,
	type Failure,
	failedRuns,
	type Lesson,
	type LessonFailure,
	type LessonStatus,
	lessonAgents,
	projectFailures,
	type RunRecord,
	readApplies,
	readLessons,
	readRunFile,
	resolvedByPullRequest,
} from "@openfabriq/runner";
import { type Period, runsInPeriod } from "../metrics/metrics.js";
import { changedFiles, type ShownFiles } from "../runs/run-files.js";
import type { SubjectStates } from "../subjects/subject-state.js";
import { diffFiles } from "./pull-diff.js";

/** A lesson as the Learning page lists it. */
export interface LessonRow {
	id: string;
	cause: string;
	rule: string;
	target: string;
	status: Lesson["status"];
	/** How many failures the lesson holds. */
	failures: number;
	/** How many runs they come from: what the threshold counts. */
	runs: number;
	agents: string[];
	/** How many of them came back after its improvement was merged. */
	cameBack: number;
	updatedAt: string;
	improvement?: NonNullable<Lesson["improvement"]>;
	resolvedAt?: string;
	/** Its improvement was asked for and came to nothing: it waits for a new failure. */
	waits?: true;
}

/** What GET /api/learning sends. */
export interface LearningAnswer {
	/** Learning's schedule and its sentence, when the factory turns it on. */
	learning?: { schedule: string; text: string };
	threshold: number;
	unheard: GitHubFailureEvent[];
	numbers: {
		failures: number;
		lessons: number;
		toReview: number;
		cameBack: number;
	};
	toReview: LessonRow[];
	candidates: LessonRow[];
	history: LessonRow[];
	recent: Failure[];
	byAgent: Record<string, { failures: number; toReview: number }>;
}

/** What GET /api/learning/:id sends. */
export interface LessonAnswer extends Omit<LessonRow, "failures"> {
	/** Each failure as the journal tells it, or as the lesson kept it when the journal no longer has it. */
	failures: (Failure | LessonFailure)[];
	cameBackIds: string[];
	targetUrl: string;
	diff?: ShownFiles;
	diffFrom?: "pull request" | "run";
}

const lessonRow = (lesson: Lesson, applies: string[]): LessonRow => ({
	id: lesson.id,
	cause: lesson.cause,
	rule: lesson.rule,
	target: lesson.target,
	status: lesson.status,
	failures: lesson.failures.length,
	runs: failedRuns(lesson),
	agents: lessonAgents(lesson).sort(),
	cameBack: cameBack(lesson, applies).length,
	updatedAt: lesson.updatedAt,
	...(lesson.improvement ? { improvement: lesson.improvement } : {}),
	...(lesson.resolvedAt ? { resolvedAt: lesson.resolvedAt } : {}),
	...(lesson.status === "candidate" &&
	lesson.triedAt !== undefined &&
	failedRuns(lesson) >= LESSON_THRESHOLD &&
	!awaitsImprovement(lesson)
		? { waits: true as const }
		: {}),
});

/** The failures that come from GitHub: the journal holds them only when an automation of the factory ran on them. */
const FROM_GITHUB = [
	"pull_request.checks_failed",
	"pull_request.changes_requested",
] as const;
type GitHubFailureEvent = (typeof FROM_GITHUB)[number];

/** The GitHub events of failures no automation of the factory runs on: learning never sees those failures. */
export const unheardEvents = (factory: Factory): GitHubFailureEvent[] =>
	FROM_GITHUB.filter(
		(event) =>
			!Object.values(factory.automations).some(
				(a) => !a.builtIn && a.when.some((t) => t.event === event),
			),
	);

/** At most this many recent failures on the page. */
const RECENT = 20;

/** The pull requests of the improvements open for review: the studio asks GitHub how they stand. */
export const improvementUrls = (repository: string) =>
	readLessons(repository).flatMap((l) =>
		l.status === "proposed" && l.improvement ? [l.improvement.url] : [],
	);

/**
 * The lessons of a project, with the improvements GitHub merged or closed since the last batch
 * shown as they are now: the engine records it at its next batch, the studio tells it at once.
 */
function lessonsNow(
	repository: string,
	states: SubjectStates,
	now: Date,
): Lesson[] {
	return readLessons(repository).map((lesson) => {
		const pull = lesson.improvement && states[lesson.improvement.url];
		if (!pull) return lesson;
		const state = pull.merged ? "MERGED" : pull.open ? "OPEN" : "CLOSED";
		return (
			resolvedByPullRequest(
				lesson,
				{ state, ...(pull.mergedAt ? { mergedAt: pull.mergedAt } : {}) },
				now,
			) ?? lesson
		);
	});
}

/**
 * What GET /api/learning sends: four numbers (failures over the period, unresolved lessons,
 * improvements to review, failures that came back after a merged improvement), the improvements
 * to review, the candidate lessons, the history, and each agent's share. Failures come from the
 * journal even with learning off; the page then says how to turn it on.
 */
export function learningOf(
	repository: string,
	factory: Factory,
	runs: RunRecord[],
	period: Period,
	now: Date,
	/** How the improvements' pull requests stand on GitHub, by URL. */
	states: SubjectStates,
): LearningAnswer {
	const shown = new Set(runsInPeriod(runs, period, now).map((r) => r.id));
	const failures = projectFailures(repository, runs).filter((f) =>
		shown.has(f.run),
	);
	const lessons = lessonsNow(repository, states, now);
	const applies = readApplies(repository);
	const row = (lesson: Lesson) => lessonRow(lesson, applies);
	const withStatus = (status: LessonStatus) =>
		lessons.filter((l) => l.status === status);
	const latestFirst = (a: Lesson, b: Lesson) =>
		b.updatedAt.localeCompare(a.updatedAt);
	const toReview = withStatus("proposed");
	const byAgent: Record<string, { failures: number; toReview: number }> = {};
	const agentShare = (agent: string) => {
		byAgent[agent] ??= { failures: 0, toReview: 0 };
		return byAgent[agent];
	};
	for (const f of failures) agentShare(f.agent).failures += 1;
	for (const l of toReview)
		for (const agent of lessonAgents(l)) agentShare(agent).toReview += 1;
	return {
		...(factory.learning
			? {
					learning: {
						schedule: factory.learning.schedule,
						text: learningText(factory.learning),
					},
				}
			: {}),
		threshold: LESSON_THRESHOLD,
		unheard: unheardEvents(factory),
		numbers: {
			failures: failures.length,
			lessons: lessons.filter(
				(l) => l.status === "candidate" || l.status === "proposed",
			).length,
			toReview: toReview.length,
			cameBack: lessons.flatMap((l) => cameBack(l, applies)).length,
		},
		toReview: toReview.sort(latestFirst).map(row),
		candidates: withStatus("candidate").sort(latestFirst).map(row),
		history: [...withStatus("promoted"), ...withStatus("rejected")]
			.sort(latestFirst)
			.map(row),
		recent: failures.slice(0, RECENT),
		byAgent,
	};
}

/**
 * What GET /api/learning/:id sends: one lesson, its failures, and its improvement's diff, read on
 * the pull request (`diffFrom: "pull request"`), or as the learning run committed it when GitHub
 * cannot tell (`"run"`).
 */
export async function lessonOf(
	repository: string,
	runs: RunRecord[],
	id: string,
	pullDiff: (repository: string, number: number) => Promise<string | undefined>,
	states: SubjectStates,
	now: Date,
): Promise<LessonAnswer | undefined> {
	const lesson = lessonsNow(repository, states, now).find((l) => l.id === id);
	if (!lesson) return undefined;
	const applies = readApplies(repository);
	const journalFailures = new Map(
		projectFailures(repository, runs).map((f) => [f.id, f]),
	);
	const failures = lesson.failures.map(
		(f): Failure | LessonFailure => journalFailures.get(f.id) ?? f,
	);
	const pullText =
		lesson.improvement &&
		(await pullDiff(repository, lesson.improvement.number));
	const onPull = pullText ? diffFiles(pullText) : [];
	// Otherwise the diff the learning run committed and opened the pull request with.
	const diff = onPull.length
		? { total: onPull.length, files: onPull }
		: lesson.improvement &&
			changedFiles(
				readRunFile(repository, lesson.improvement.run, "changed-files.json"),
			);
	return {
		...lessonRow(lesson, applies),
		failures,
		cameBackIds: cameBack(lesson, applies).map((f) => f.id),
		targetUrl: `https://github.com/${repository}/blob/HEAD/${lesson.target}`,
		...(diff ? { diff, diffFrom: onPull.length ? "pull request" : "run" } : {}),
	};
}
