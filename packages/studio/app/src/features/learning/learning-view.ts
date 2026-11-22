import type { LearningAnswer } from "../../lib/types.js";

// The Learning page's words, as pure functions.

const count = (n: number, one: string, many = `${one}s`) =>
	`${n} ${n === 1 ? one : many}`;

/** What one failure kind means, for people. */
export const FAILURE_WORDS: Record<string, string> = {
	check: "Check kept failing",
	review: "Internal review asked for changes",
	checks_failed: "Checks failed on GitHub",
	changes_requested: "A maintainer asked for changes",
};

/** A candidate lesson's progress: "1 failure, needs 2"; "2 failures in 1 run, needs 2 runs" when runs repeat. */
export const candidateNote = (
	failures: number,
	runs: number,
	threshold: number,
) =>
	runs === failures
		? `${count(failures, "failure")}, needs ${threshold}`
		: `${count(failures, "failure")} in ${count(runs, "run")}, needs ${threshold} runs`;

/** The line on an agent's page: "3 failures, 1 improvement to review"; none without either. */
export function agentLearningLine(
	byAgent: LearningAnswer["byAgent"] | undefined,
	agent: string,
): string | undefined {
	const mine = byAgent?.[agent];
	if (!mine || (mine.failures === 0 && mine.toReview === 0)) return undefined;
	return [
		...(mine.failures ? [count(mine.failures, "failure")] : []),
		...(mine.toReview
			? [`${count(mine.toReview, "improvement")} to review`]
			: []),
	].join(", ");
}

/** What came of a lesson in the history. */
export const outcomeWords = (status: string) =>
	status === "promoted" ? "Merged" : "Closed without merge";
