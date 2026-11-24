import {
	type Agent,
	type Factory,
	isEngineAgent,
	LEARNING,
	WIKI,
} from "@openfabriq/core";
import type { QueuedRun } from "../engine/queue.js";
import { outsideLearning } from "../learning/guard.js";
import type { Workspace } from "../workspace/workspace.js";
import type { RunPaths } from "./execute.js";
import type { harness } from "./harness.js";
import { unresolvedConflict } from "./outputs/merge.js";
import { outsideWiki, workflowChange } from "./outputs/review.js";
import type { Proposal } from "./outputs/tools.js";

/** The agent's code as the run left it, with what judges it: the proposals it goes with and the harness. */
export interface CodeToJudge {
	run: QueuedRun;
	factory: Factory;
	agent: Agent;
	workspace: Workspace;
	paths: RunPaths;
	ref: string;
	data: Record<string, unknown>;
	defaultBranch: string;
	reviewed: { accepted: Proposal[] };
	checks: ReturnType<typeof harness>;
}

/**
 * Why the agent's code cannot be published, if it cannot: a CI workflow changed, the wiki's agent
 * wrote outside the wiki, learning's beyond the text of skills and agent.md files, a conflict left
 * unresolved, or a check of the factory that failed.
 */
export async function judgeCode(
	step: CodeToJudge,
): Promise<string | undefined> {
	const { run, factory, agent, workspace, paths, ref, data } = step;
	const { clone, worktree } = paths;
	// A run that merges the base branch in, for a conflict or on request: its commits are not the run's to judge.
	const prBase = run.event.isPullRequest
		? String(
				(data.pull_request as { baseRefName?: string } | undefined)
					?.baseRefName ?? step.defaultBranch,
			)
		: undefined;
	// The agent merged the base: HEAD contains it, and the pull request's branch did not at the start.
	const mergedIn = async (base: string) =>
		(await workspace.contains(clone, worktree, base).catch(() => false)) &&
		!(await workspace.contains(clone, worktree, base, ref).catch(() => true));
	const conflictBase =
		prBase &&
		(run.event.event === "pull_request.conflicted" || (await mergedIn(prBase)))
			? prBase
			: undefined;
	const touchedFiles = await workspace.touched(
		clone,
		worktree,
		conflictBase ?? ref,
	);
	return (
		workflowChange(touchedFiles) ??
		(isEngineAgent(agent, WIKI) && factory.wiki
			? outsideWiki(touchedFiles, factory.wiki.folder)
			: undefined) ??
		(isEngineAgent(agent, LEARNING)
			? await outsideLearning(touchedFiles, (path) =>
					workspace.versions(clone, worktree, ref, path),
				)
			: undefined) ??
		// An agent that pushes nothing (two changes contradict) has nothing to lock: its comment says why.
		(conflictBase &&
		step.reviewed.accepted.some((p) => p.action === "push_to_pull_request")
			? await unresolvedConflict(workspace, clone, worktree, {
					base: conflictBase,
					files: await workspace.touched(clone, worktree, ref),
				})
			: undefined) ??
		(await step.checks.gate())
	);
}
