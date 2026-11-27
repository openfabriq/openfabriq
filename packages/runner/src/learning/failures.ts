import { includesName, isEngineName } from "@openfabriq/core";
import type { CommandRun } from "../run/harness.js";
import type { Finding, ReviewRound } from "../run/internal-review.js";
import { openingRun, type RunRecord } from "../state/journal.js";

// Failures: runs whose work was judged bad, read from the journal. Only quality signals count:
// a budget, a timeout, a broken setup or a refused output are settled in factory.yaml, not lessons.

export const FAILURE_KINDS = [
	"check",
	"review",
	"checks_failed",
	"changes_requested",
] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

export interface Failure {
	/** `<run id>:<kind>`: a run fails at most once of each kind. */
	id: string;
	kind: FailureKind;
	/** The run where it was seen. */
	run: string;
	/** The agent whose work was judged: for a pull request's failed checks or requested changes, the one that opened it. */
	agent: string;
	automation: string;
	at: string;
	/** The run's subject, for people. */
	number?: number;
	url?: string;
	title?: string;
	/** checks_failed and changes_requested: the run that opened the pull request. */
	openedIn?: string;
	/** One line: what was judged bad. */
	summary: string;
	/** check: the end of the failed check's output. */
	output?: string;
	/** review: the findings of the reviews that asked for changes. */
	findings?: Finding[];
}

/** What a run kept on disk that tells a failure, read when needed: its commands and checks, its internal reviews. */
export interface RunEvidence {
	commands(): CommandRun[];
	reviews(): ReviewRound[] | undefined;
}

const CHECK_FAILED = 'the check "';

/** The failures of one run, from its record and what it kept. */
function runFailures(
	run: RunRecord,
	runs: RunRecord[],
	evidence: RunEvidence,
	maintainers: string[],
): Failure[] {
	// The engine's own runs never count: learning would learn from itself.
	if (
		run.status === "queued" ||
		isEngineName(run.automation) ||
		isEngineName(run.agent)
	)
		return [];
	const base = {
		run: run.id,
		agent: run.agent,
		automation: run.automation,
		at: run.endedAt ?? run.startedAt ?? run.queuedAt,
		...(run.number !== undefined ? { number: run.number } : {}),
		...(run.url ? { url: run.url } : {}),
		...(run.title ? { title: run.title } : {}),
	};
	const found: Failure[] = [];
	// The engine's last run of the checks refused the code, after the agent's rounds of fixes.
	if (run.reason?.startsWith(CHECK_FAILED)) {
		const last = evidence
			.commands()
			.filter((c) => c.kind === "check")
			.at(-1);
		found.push({
			...base,
			id: `${run.id}:check`,
			kind: "check",
			summary: run.reason,
			...(last && !last.ok ? { output: last.output } : {}),
		});
	}
	// The reviewer's own verdicts only: one the engine gave (no budget, no verdict) judges nothing.
	const asked = (evidence.reviews() ?? []).filter(
		(r) => r.verdict === "needs_changes" && r.reason === undefined,
	);
	const first = asked[0];
	if (first)
		found.push({
			...base,
			id: `${run.id}:review`,
			kind: "review",
			summary: `${first.reviewer} asked for changes: ${first.summary}`,
			findings: asked.flatMap((r) => r.findings),
		});
	const pullRequestFailure =
		run.event === "pull_request.checks_failed" ||
		run.event === "pull_request.changes_requested";
	if (pullRequestFailure && run.isPullRequest && run.number !== undefined) {
		const opened = openingRun(runs, run.number);
		// Requested changes count when a maintainer asked for them, whoever the automation runs for: never
		// the engine's own reviewer, whose account starts runs too, nor a run older than requestedBy.
		const byMaintainer =
			run.event !== "pull_request.changes_requested" ||
			(!run.untrusted &&
				run.requestedBy !== undefined &&
				includesName(maintainers, run.requestedBy));
		if (opened && !isEngineName(opened.agent) && byMaintainer) {
			const kind =
				run.event === "pull_request.checks_failed"
					? "checks_failed"
					: "changes_requested";
			found.push({
				...base,
				id: `${run.id}:${kind}`,
				kind,
				agent: opened.agent,
				openedIn: opened.id,
				summary:
					kind === "checks_failed"
						? `the checks of #${run.number} failed on GitHub`
						: `a maintainer asked for changes on #${run.number}`,
			});
		}
	}
	return found;
}

/** Every failure in the journal, latest first, as the runs are. */
export function findFailures(
	runs: RunRecord[],
	evidenceOf: (run: RunRecord) => RunEvidence,
	maintainers: string[],
): Failure[] {
	return runs.flatMap((run) =>
		runFailures(run, runs, evidenceOf(run), maintainers),
	);
}
