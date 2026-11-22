import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Factory, LESSON_THRESHOLD, learningText } from "@openfabriq/core";
import {
	cameBack,
	type Failure,
	type Lesson,
	type LessonFailure,
	projectDir,
	projectFailures,
	type RunRecord,
	readLessons,
} from "@openfabriq/runner";
import { type Period, runsInPeriod } from "../metrics/metrics.js";
import { changedFiles, type ShownFiles } from "../runs/run-files.js";
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
	agents: string[];
	/** How many of them came back after its improvement was merged. */
	cameBack: number;
	updatedAt: string;
	improvement?: NonNullable<Lesson["improvement"]>;
	resolvedAt?: string;
}

/** What GET /api/learning sends. */
export interface LearningAnswer {
	/** Learning's schedule and its sentence, when the factory turns it on. */
	learning?: { schedule: string; text: string };
	threshold: number;
	unheard: (typeof FROM_GITHUB)[number][];
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

const lessonRow = (lesson: Lesson): LessonRow => ({
	id: lesson.id,
	cause: lesson.cause,
	rule: lesson.rule,
	target: lesson.target,
	status: lesson.status,
	failures: lesson.failures.length,
	agents: [...new Set(lesson.failures.map((f) => f.agent))].sort(),
	cameBack: cameBack(lesson).length,
	updatedAt: lesson.updatedAt,
	...(lesson.improvement ? { improvement: lesson.improvement } : {}),
	...(lesson.resolvedAt ? { resolvedAt: lesson.resolvedAt } : {}),
});

/** The failures that come from GitHub: the journal holds them only when an automation of the factory ran on them. */
const FROM_GITHUB = [
	"pull_request.checks_failed",
	"pull_request.changes_requested",
] as const;

/** The GitHub events of failures no automation of the factory runs on: learning never sees those failures. */
export const unheard = (factory: Factory) =>
	FROM_GITHUB.filter(
		(event) =>
			!Object.values(factory.automations).some(
				(a) => !a.builtIn && a.when.some((t) => t.event === event),
			),
	);

/** At most this many recent failures on the page. */
const RECENT = 20;

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
): LearningAnswer {
	const shown = new Set(runsInPeriod(runs, period, now).map((r) => r.id));
	const failures = projectFailures(repository, runs, factory).filter((f) =>
		shown.has(f.run),
	);
	const lessons = readLessons(repository);
	const of = (status: Lesson["status"]) =>
		lessons.filter((l) => l.status === status);
	const latestFirst = (a: Lesson, b: Lesson) =>
		b.updatedAt.localeCompare(a.updatedAt);
	const toReview = of("proposed");
	const byAgent: Record<string, { failures: number; toReview: number }> = {};
	const share = (agent: string) => {
		byAgent[agent] ??= { failures: 0, toReview: 0 };
		return byAgent[agent];
	};
	for (const f of failures) share(f.agent).failures += 1;
	for (const l of toReview)
		for (const agent of new Set(l.failures.map((f) => f.agent)))
			share(agent).toReview += 1;
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
		unheard: unheard(factory),
		numbers: {
			failures: failures.length,
			lessons: lessons.filter(
				(l) => l.status === "candidate" || l.status === "proposed",
			).length,
			toReview: toReview.length,
			cameBack: lessons.flatMap(cameBack).length,
		},
		toReview: toReview.sort(latestFirst).map(lessonRow),
		candidates: of("candidate").sort(latestFirst).map(lessonRow),
		history: [...of("promoted"), ...of("rejected")]
			.sort(latestFirst)
			.map(lessonRow),
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
	factory: Factory,
	runs: RunRecord[],
	id: string,
	pullDiff: (repository: string, number: number) => Promise<string | undefined>,
): Promise<LessonAnswer | undefined> {
	const lesson = readLessons(repository).find((l) => l.id === id);
	if (!lesson) return undefined;
	const all = new Map(
		projectFailures(repository, runs, factory).map((f) => [f.id, f]),
	);
	const failures = lesson.failures.map(
		(f): Failure | LessonFailure => all.get(f.id) ?? f,
	);
	const read =
		lesson.improvement &&
		(await pullDiff(repository, lesson.improvement.number));
	const onPull = read ? diffFiles(read) : [];
	// Otherwise the diff the learning run committed and opened the pull request with.
	const file =
		lesson.improvement &&
		join(
			projectDir(repository),
			"runs",
			lesson.improvement.run,
			"changed-files.json",
		);
	const diff = onPull.length
		? { total: onPull.length, files: onPull }
		: file && existsSync(file)
			? changedFiles(readFileSync(file, "utf8"))
			: undefined;
	return {
		...lessonRow(lesson),
		failures,
		cameBackIds: cameBack(lesson).map((f) => f.id),
		targetUrl: `https://github.com/${repository}/blob/HEAD/${lesson.target}`,
		...(diff ? { diff, diffFrom: onPull.length ? "pull request" : "run" } : {}),
	};
}
