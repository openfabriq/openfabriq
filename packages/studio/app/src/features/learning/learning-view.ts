import type { LearningAnswer } from "../../lib/types.js";

// The Learning pages' words and states, as pure functions.

const count = (n: number, one: string, many = `${one}s`) =>
	`${n} ${n === 1 ? one : many}`;

/** What a lesson being learned waits for, in a sentence. */
export function whatHappensNext(
	lesson: { runs: number; waits?: true | undefined },
	threshold: number,
): string {
	if (lesson.waits)
		return "Its rule could not be proposed. Learning tries again after the next mistake.";
	const left = Math.max(1, threshold - lesson.runs);
	return `If this mistake happens ${left === 1 ? "once more" : `${left} more times`}, learning proposes the rule.`;
}

/** The state of a lesson, as its page names it. */
export type LessonResult =
	| "to-review"
	| "being-learned"
	| "waiting"
	| "not-applied"
	| "holding"
	| "came-back"
	| "declined"
	| "ignored";

export function lessonResult(
	lesson: Pick<
		LearningAnswer["history"][number],
		"status" | "waits" | "appliedAt" | "cameBack"
	>,
): LessonResult {
	if (lesson.status === "proposed") return "to-review";
	if (lesson.status === "rejected") return "declined";
	if (lesson.status === "ignored") return "ignored";
	if (lesson.status === "promoted")
		return !lesson.appliedAt
			? "not-applied"
			: lesson.cameBack > 0
				? "came-back"
				: "holding";
	return lesson.waits ? "waiting" : "being-learned";
}

/** The line on an agent's page: "3 mistakes, 1 rule to review"; none without either. */
export function agentLearningLine(
	byAgent: LearningAnswer["byAgent"] | undefined,
	agent: string,
): string | undefined {
	const mine = byAgent?.[agent];
	if (!mine || (mine.failures === 0 && mine.toReview === 0)) return undefined;
	return [
		...(mine.failures ? [count(mine.failures, "mistake")] : []),
		...(mine.toReview ? [`${count(mine.toReview, "rule")} to review`] : []),
	].join(", ");
}

/** The factory's progress since its first learned rule applied: a comparison, or the runs it waits for on each side. */
export type ProgressView =
	| {
			kind: "waiting";
			since: string;
			runsBefore: number;
			runsAfter: number;
			needed: number;
	  }
	| {
			kind: "measured";
			since: string;
			before: number;
			after: number;
			trend: "fewer" | "more" | "same";
			/** "65% fewer", "under 1% more", "a rise" from none, "no change". */
			label: string;
			runsBefore: number;
			runsAfter: number;
	  };

export function progressView(
	progress: NonNullable<LearningAnswer["progress"]>,
): ProgressView {
	const { since, before, after, minRuns } = progress;
	const runs = { runsBefore: before.runs, runsAfter: after.runs };
	if (before.runs < minRuns || after.runs < minRuns)
		return { kind: "waiting", since, ...runs, needed: minRuns };
	const rate = (side: typeof before) => side.mistakes / side.runs;
	const [was, is] = [rate(before), rate(after)];
	// The trend from the rates themselves: a small rise is still a rise.
	const trend = is < was ? "fewer" : is > was ? "more" : "same";
	const percent = was > 0 ? (Math.abs(is - was) / was) * 100 : undefined;
	const label =
		trend === "same"
			? "no change"
			: percent === undefined
				? "a rise"
				: percent < 1
					? `under 1% ${trend}`
					: `${Math.round(percent)}% ${trend}`;
	return {
		kind: "measured",
		since,
		before: was,
		after: is,
		trend,
		label,
		...runs,
	};
}

/** What the page says above the dashboard about learning's latest run, if anything. */
export type LearningNotice =
	| { kind: "asked" }
	| { kind: "queued" | "running"; id: string; since: string }
	| { kind: "failed"; id: string; reason?: string }
	| { kind: "done"; id: string; pullRequest?: string };

/** A batch that ended well is said for this long, then the page shows what came of it. */
const DONE_FOR_MS = 15 * 60_000;

/** Working, a failure, or a batch that just ended well, with what it opened. */
export function learningNotice(
	run: LearningAnswer["run"] | undefined,
	now = Date.now(),
): LearningNotice | undefined {
	if (!run) return undefined;
	if (run.state === "asked") return { kind: "asked" };
	if (run.state === "queued" || run.state === "running")
		return { kind: run.state, id: run.id, since: run.at };
	if (run.state === "failed")
		return {
			kind: "failed",
			id: run.id,
			...(run.reason ? { reason: run.reason } : {}),
		};
	if (now - Date.parse(run.at) < DONE_FOR_MS)
		return {
			kind: "done",
			id: run.id,
			...(run.pullRequest ? { pullRequest: run.pullRequest } : {}),
		};
	return undefined;
}
