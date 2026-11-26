import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type Factory,
	isEngineAgent,
	LEARNING,
	REVIEW_LABELS,
	setupNetwork,
	subjectOf,
	WORKING_LABEL,
} from "@openfabriq/core";
import { hideSecrets, runEnv } from "../agent/env.js";
import type { AgentLauncher } from "../agent/port.js";
import type { QueuedRun } from "../engine/queue.js";
import { errorText } from "../files.js";
import type { GitHub } from "../github/github.js";
import { prepareBatch } from "../learning/batch.js";
import type { LinearAgent } from "../sources/linear/agent.js";
import type { Sentry } from "../sources/sentry/client.js";
import type { Slack } from "../sources/slack/client.js";
import type { RunRecord } from "../state/journal.js";
import { projectDir, runDir } from "../state/projects.js";
import { recordRefusals } from "../state/refusals.js";
import type { RunJournal } from "../state/run-journal.js";
import { withPatches } from "../workspace/diff.js";
import type { ChangedFiles, Workspace } from "../workspace/workspace.js";
import { handOff } from "./handoff.js";
import { labelReviewedPush, withReview } from "./internal-review.js";
import { judgeCode } from "./judge.js";
import {
	factorySecrets,
	launchAgent,
	runSetup,
	withoutSecrets,
} from "./launch.js";
import type { SourceWriter } from "./outputs/apply.js";
import { applyOutputs, creditFor } from "./outputs/publish.js";
import {
	gateOnChecks,
	type Outcome,
	reviewProposals,
} from "./outputs/review.js";
import {
	notConnected,
	reviewRoundsReached,
	subjectGone,
} from "./preconditions.js";
import { agentCost, baseRecord, ended, titled } from "./record.js";
import { readLinked, readSubject, sourceWriter } from "./subject.js";

export interface RunDeps {
	github: GitHub;
	launch: AgentLauncher;
	workspace: Workspace;
	identity: { name: string; email: string };
	/** The runs' history: each run writes its records there, and reads the day's cost and the engine's merges. */
	journal: RunJournal;
	now?: () => Date;
	/** Present when Slack is connected. */
	slack?: Slack;
	/** Present when the relay is connected: Linear, as the openfabriq app of an organization. */
	linearApp?: (organizationId: string) => LinearAgent;
	/** Present when Sentry is connected. */
	sentry?: Sentry;
	/** The engine's log: what the engine does on GitHub on its own, like the working label. */
	log?: (line: string) => void;
}

/**
 * Runs one automation on one event, from the limits to the journal. A failure of the run is its
 * record's status; only writing the journal can throw (a full disk).
 */
export async function executeRun(
	run: QueuedRun,
	factory: Factory,
	deps: RunDeps,
	defaultBranch: string,
): Promise<RunRecord> {
	const writer = sourceWriter(run, factory, deps);
	const record = await runToRecord(run, factory, deps, defaultBranch, writer);
	// A delegated Linear session ends with the engine's word on how the run went.
	await writer?.close?.(record).catch(() => undefined);
	return record;
}

/** Why a run that ended well wrote nothing: the agent proposed no output at all. */
export const NO_OUTPUT = "the agent proposed no output";
export const NOTHING_TO_LEARN =
	"nothing to learn: no new failure, and no lesson waits for its improvement";
export const NO_REWORK = "the review requested changes and the run pushed none";

/** Where a run works: its folder in the project, the project's clone, and its own worktree. */
export interface RunPaths {
	runDir: string;
	clone: string;
	worktree: string;
}

/** The run's time, minutes_per_run, counted from its first setup command. */
export interface RunTime {
	started: number;
	limitMs: number;
}

/** The studio lists at most this many of a run's changed files, and says how many more. */
export const CHANGED_FILES_KEPT = 500;

/**
 * What the run changed in its worktree, kept in changed-files.json with each file's diff, within
 * PATCH_LIMITS: the studio shows it once the worktree is gone. Git failing writes nothing, and the run goes on.
 */
async function recordChangedFiles(
	workspace: Workspace,
	paths: RunPaths,
	ref: string,
): Promise<void> {
	await workspace
		.changedFiles(paths.clone, paths.worktree, ref)
		.then(async (files) => {
			const kept = await withPatches(
				files.slice(0, CHANGED_FILES_KEPT),
				(path) => workspace.patch(paths.clone, paths.worktree, ref, path),
			);
			writeFileSync(
				join(paths.runDir, "changed-files.json"),
				`${JSON.stringify({ total: files.length, files: kept } satisfies ChangedFiles)}\n`,
			);
		})
		.catch(() => undefined);
}

/** The run from its limits to its last record in the journal: its source's session is closed after. */
async function runToRecord(
	run: QueuedRun,
	factory: Factory,
	deps: RunDeps,
	defaultBranch: string,
	writer: SourceWriter | undefined,
): Promise<RunRecord> {
	const now = deps.now ?? (() => new Date());
	const { github } = deps;
	const repo = factory.repository;
	const automation = factory.automations[run.automation];
	const agent = automation ? factory.agents[automation.agent] : undefined;
	const source = run.event.source;
	let record: RunRecord = {
		...baseRecord(run, factory, run.event.at || now().toISOString()),
		status: "running",
		startedAt: now().toISOString(),
	};
	const signedBy = creditFor(run, factory, defaultBranch);
	const handOffTo = {
		run,
		repository: repo,
		writer,
		github,
		...(signedBy ? { credit: signedBy } : {}),
	};
	const finish = (
		last: RunRecord,
		status: RunRecord["status"],
		reason?: string,
	): RunRecord => {
		const done = ended(last, status, reason, now());
		deps.journal.append(done);
		return done;
	};

	if (!automation || !agent)
		return finish(
			record,
			"skipped",
			"the automation is no longer in the applied factory",
		);
	if (source && !writer) return finish(record, "failed", notConnected(source));
	let labeled = false;
	const paths: RunPaths = {
		runDir: runDir(repo, run.id),
		clone: join(projectDir(repo), "repo"),
		worktree: join(projectDir(repo), "worktrees", run.id),
	};
	try {
		mkdirSync(paths.runDir, { recursive: true });
		if (deps.journal.costToday(repo, now()) >= factory.limits.usd_per_day)
			return finish(
				record,
				"skipped",
				`the daily cost limit of ${factory.limits.usd_per_day} USD is reached (usd_per_day)`,
			);

		const subject = { number: run.number, kind: subjectOf(run.event.event) };
		const read = await readSubject(run, factory, deps, defaultBranch);
		record = titled(record, read);
		const { ref, headRef } = read;
		const data = await readLinked(run, factory, deps, read.data);
		// Kept for learning: the failed checks' logs are read once, here.
		if (data.failed_checks)
			writeFileSync(
				join(paths.runDir, "failed-checks.json"),
				`${JSON.stringify(data.failed_checks)}\n`,
			);
		const gone = subjectGone(data);
		if (gone) return finish(record, "skipped", gone);
		deps.journal.append(record);
		// Linear's advice for a delegated issue: started once an agent works on it.
		await writer?.start?.().catch(() => undefined);

		const rounds = await reviewRoundsReached(run, factory, github);
		if (rounds !== undefined) {
			record = {
				...record,
				outputs: await handOff(
					`${rounds} review rounds reached (review_rounds: ${factory.limits.review_rounds})`,
					handOffTo,
				),
			};
			return finish(record, "skipped", `review_rounds reached (${rounds})`);
		}

		// GitHub shows the run works on its issue or pull request. The queue runs one run at a time
		// per subject, so no other run takes the label off while this one works.
		if (run.number !== undefined)
			labeled = await github.addLabels(repo, run.number, [WORKING_LABEL]).then(
				() => {
					deps.log?.(
						`${repo} #${run.number}: labeled ${WORKING_LABEL} while ${run.automation} works`,
					);
					return true;
				},
				(error: unknown) => {
					deps.log?.(
						`${repo} #${run.number}: could not label ${WORKING_LABEL}: ${errorText(error)}`,
					);
					return false;
				},
			);

		await deps.workspace.create(paths.clone, paths.worktree, ref);
		// Learning studies a batch the engine stages in its worktree: none, and nothing runs.
		const isLearning = isEngineAgent(agent, LEARNING);
		const learning = isLearning
			? await prepareBatch({
					repository: repo,
					factory,
					runs: deps.journal.read(repo),
					github,
					worktree: paths.worktree,
					now,
					...(deps.log ? { log: deps.log } : {}),
				})
			: undefined;
		if (isLearning && !learning)
			return finish(record, "skipped", NOTHING_TO_LEARN);
		const env = runEnv(deps.identity, factory);
		if (env.variables) record = { ...record, variables: env.variables };
		const secrets = factorySecrets(factory, env.command);
		const hide = (text: string) => hideSecrets(text, secrets);
		const time: RunTime = {
			started: now().getTime(),
			limitMs: factory.limits.minutes_per_run * 60_000,
		};
		// On a pull request's branch, an untrusted run's setup runs what such a run pushed there.
		const untrustedCode = run.untrusted === true && headRef !== undefined;
		const setupFailed = await runSetup(factory.setup ?? [], {
			workspace: deps.workspace,
			paths,
			env: untrustedCode ? withoutSecrets(factory, env.command) : env.command,
			ownCache: untrustedCode,
			network: setupNetwork(factory),
			refused: (sites) => recordRefusals(paths.runDir, "setup", sites),
			time,
			now,
			hide,
		});
		if (setupFailed) {
			record = {
				...record,
				outputs: await handOff(
					`the setup command "${setupFailed.command}" failed`,
					handOffTo,
				),
			};
			return finish(
				record,
				"failed",
				`setup "${setupFailed.command}" ${setupFailed.output}`,
			);
		}

		const { result, proposals, checks, checkReviewedCommit, reviews } =
			await launchAgent({
				run,
				factory,
				automation,
				agent,
				deps,
				writer,
				paths,
				ref,
				data,
				subject,
				env,
				hide,
				time,
				now,
				...(learning ? { tools: learning.tools } : {}),
			});
		// The agents are done: nothing they left running moves the commit that is judged and pushed.
		const judged = await deps.workspace.settle(paths.clone, paths.worktree);
		// The run's cost counts its reviews.
		record = {
			...record,
			...agentCost(result),
			costUsd: result.costUsd + (reviews?.costUsd() ?? 0),
		};
		writeFileSync(
			join(paths.runDir, "proposals.json"),
			`${JSON.stringify(proposals, null, 2)}\n`,
		);
		// reviewed_by: code on its way out carries how its review ended.
		const review = proposals.some(
			(p) =>
				p.action === "create_pull_request" ||
				p.action === "push_to_pull_request",
		)
			? reviews?.outcome()
			: undefined;

		// A failed run still gets its proposals checked and applied: what it wrote before failing is visible.
		const asked = reviewProposals(
			review ? withReview(proposals, review) : proposals,
			automation,
			subject,
		);
		const reviewed = learning ? learning.review(asked) : asked;
		const checkFailure = await judgeCode({
			run,
			factory,
			agent,
			workspace: deps.workspace,
			paths,
			ref,
			data,
			defaultBranch,
			reviewed,
			checks,
		});
		const { accepted, refused } = gateOnChecks(reviewed, checkFailure);
		// Written at once: the poll may see the new issue or pull request, its labels or a pushed head, before the run ends.
		const openedSoFar: Outcome[] = [];
		const applied = await applyOutputs(accepted, {
			run,
			factory,
			automation,
			deps,
			writer,
			paths,
			ref,
			...(headRef ? { headRef } : {}),
			data,
			subject,
			defaultBranch,
			checkReviewedCommit,
			judged,
			opened: (outcome) => {
				openedSoFar.push(outcome);
				deps.journal.append({ ...record, outputs: [...openedSoFar] });
			},
		});
		record = { ...record, outputs: [...applied, ...refused] };
		learning?.finish(record.outputs, run.id);
		// Journaled before the labels and the merge that follow: a stop in between never writes them again.
		deps.journal.append(record);
		const pushed =
			run.number !== undefined &&
			applied.some(
				(o) => o.action === "push_to_pull_request" && o.status === "applied",
			);
		// A push no review read, in a factory that reviews: the labels of an earlier review no longer hold.
		if (
			pushed &&
			run.number !== undefined &&
			!review &&
			Object.values(factory.automations).some((a) => a.reviewedBy)
		)
			for (const label of REVIEW_LABELS)
				await github.removeLabel(repo, run.number, label).catch(() => false);
		// A reviewed push: the pull request's labels say what the review of the new commits found.
		if (review && pushed && run.number !== undefined)
			record = {
				...record,
				outputs: [
					...record.outputs,
					...(await labelReviewedPush(review, run.number, {
						github,
						repository: repo,
						handOff: (reason, details) => handOff(reason, handOffTo, details),
					})),
				],
			};
		// Before the run's last record: the studio stops reading a run once it ended.
		await recordChangedFiles(deps.workspace, paths, ref);
		if (result.status === "failed") {
			const handed = await handOff(
				`the run failed (${result.reason})`,
				handOffTo,
			);
			record = { ...record, outputs: [...record.outputs, ...handed] };
			return finish(record, "failed", result.reason);
		}
		if (checkFailure) {
			const handed = await handOff(checkFailure, handOffTo);
			record = { ...record, outputs: [...record.outputs, ...handed] };
			return finish(record, "failed", checkFailure);
		}
		// Changes were requested and none came: without a push there is no new review, so a person takes over.
		if (
			run.event.event === "pull_request.changes_requested" &&
			automation.can.some((p) => p.action === "push_to_pull_request") &&
			!record.outputs.some(
				(o) => o.action === "push_to_pull_request" && o.status === "applied",
			)
		) {
			const handed = await handOff(NO_REWORK, handOffTo);
			record = { ...record, outputs: [...record.outputs, ...handed] };
			return finish(record, "succeeded", NO_REWORK);
		}
		// Green but silent: say so, or a person waits on an issue where nothing will come.
		return finish(
			record,
			"succeeded",
			review && !review.approved
				? review.reason
				: record.outputs.length
					? undefined
					: NO_OUTPUT,
		);
	} catch (error) {
		return finish(record, "failed", errorText(error));
	} finally {
		if (labeled && run.number !== undefined)
			await takeOffWorkingLabel(github, repo, run.number, deps.log);
		await deps.workspace
			.remove(paths.clone, paths.worktree)
			.catch(() => undefined);
	}
}

/** Takes the working label off an issue or pull request. Left on after a failure, the next run there takes it off. */
export function takeOffWorkingLabel(
	github: GitHub,
	repository: string,
	number: number,
	log?: (line: string) => void,
): Promise<void> {
	return github
		.removeLabel(repository, number, WORKING_LABEL)
		.then(() => undefined)
		.catch((error: unknown) =>
			log?.(
				`${repository} #${number}: could not take ${WORKING_LABEL} off: ${errorText(error)}`,
			),
		);
}
