import {
	type Factory,
	resourceFolder,
	type WorkflowGraph,
	workflowGraph,
} from "@openfabriq/core";
import { type RunRecord, readAppliedFactory } from "@openfabriq/runner";
import { subjectUrl } from "../board/board.js";
import { ASK_NEEDED_AGAIN_MS } from "../subjects/cached-states.js";
import type { SubjectState, SubjectStates } from "../subjects/subject-state.js";
import { type RunFiles, readRunFiles } from "./run-files.js";
import { runStory } from "./story.js";
import { parseTranscript } from "./transcript.js";

/** What GET /api/run sends: the run, its files (prompt, commands, transcript) and its story among the other runs. Pure. */
export function runDetail(
	run: RunRecord,
	all: RunRecord[],
	files: RunFiles,
	graph: WorkflowGraph | undefined,
	area?: string,
	factory?: Factory,
) {
	return {
		run,
		// Where its automation's file is, for the hints that send people to it.
		automationFile: `openfabriq/${resourceFolder("automations", run.automation, area)}/automation.md`,
		// What the engine ran for it: commands and checks.
		commands: files.commands,
		...(files.prompt !== undefined ? { prompt: files.prompt } : {}),
		// What the run changed, from Git, once it ended.
		...(files.changedFiles ? { changedFiles: files.changedFiles } : {}),
		// reviewed_by: how the internal review went, round by round.
		...(files.reviews ? { reviews: files.reviews } : {}),
		// reviewed_by: who works now; a run that ended does nothing more.
		...(files.phase && run.status === "running" ? { phase: files.phase } : {}),
		transcript: parseTranscript(files.transcript),
		story: runStory(run, all, graph, factory),
	};
}

/** The run's detail, read from disk, with its subject's state when the run asks someone to act: whether that is still true. */
export async function runWithSubjectState(
	run: RunRecord,
	all: RunRecord[],
	subjectStates: (urls: string[], maxAgeMs?: number) => Promise<SubjectStates>,
): Promise<ReturnType<typeof runDetail> & { subjectState?: SubjectState }> {
	const factory = readAppliedFactory(run.repository);
	const detail = runDetail(
		run,
		all,
		readRunFiles(run),
		factory ? workflowGraph(factory) : undefined,
		factory?.automations[run.automation]?.area,
		factory,
	);
	const asked = subjectUrl(run);
	if (!detail.story.attention || !asked) return detail;
	const subjectState = (await subjectStates([asked], ASK_NEEDED_AGAIN_MS))[
		asked
	];
	return subjectState ? { ...detail, subjectState } : detail;
}
