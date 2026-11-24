import {
	type ChatTool,
	type RunRecord,
	readAppliedFactory,
	readChats,
	readRuns,
	readTool,
} from "@openfabriq/runner";
import { z } from "zod";
import { agentOrderByProject } from "../board/agent-order.js";
import { boardColumns, subjectsToAsk } from "../board/board.js";
import { improvementUrls, learningOf } from "../learning/learning.js";
import {
	computeMetrics,
	PERIODS,
	pullRequestUrls,
} from "../metrics/metrics.js";
import { ASK_NEEDED_AGAIN_MS } from "../subjects/cached-states.js";
import type { SubjectStates } from "../subjects/subject-state.js";

/** A board card for the chat: the run's essentials, not its whole record. */
const card = (r: RunRecord) => ({
	subject:
		r.source?.label ?? (r.number === undefined ? r.automation : `#${r.number}`),
	...(r.title ? { title: r.title } : {}),
	...(r.url ? { url: r.url } : {}),
	run: r.id,
	agent: r.agent,
	status: r.status,
	...(r.reason ? { reason: r.reason } : {}),
});

/** The numbers and the board the app shows, as tools of the project's chat. */
export function appChatTools(
	repository: string,
	subjectStates: (urls: string[], maxAgeMs?: number) => Promise<SubjectStates>,
	now = () => new Date(),
): ChatTool[] {
	return [
		readTool(
			"metrics",
			"The numbers of the Overview page over a period: runs by status, cost by agent and by day (chat included), runs that needed nobody, pull requests opened and merged, issues an agent opened a pull request for and those resolved by a merge, human interventions (handoffs, failed runs, refused outputs), the applied outputs by action, the cost by what came of the work, and learning: failures over the period, unresolved lessons, improvements to review, and failures that came back after a merged improvement.",
			{ period: z.enum(PERIODS).default("7d") },
			async ({ period }) => {
				const runs = readRuns(repository);
				const factory = readAppliedFactory(repository);
				return {
					...computeMetrics(
						runs,
						period,
						now(),
						await subjectStates(pullRequestUrls(runs)),
						readChats(repository),
					),
					...(factory
						? {
								learning: learningOf(
									repository,
									factory,
									runs,
									period,
									now(),
									await subjectStates(improvementUrls(repository)),
								).numbers,
							}
						: {}),
				};
			},
		),
		readTool(
			"board",
			"Where each issue, pull request or conversation stands: waiting, working, needs-you (failed, handed to a human, or stopped at a cost limit) or done, with the agents that touched it in order; and what each agent is doing now.",
			{},
			async () => {
				const runs = readRuns(repository);
				const board = boardColumns(
					runs,
					agentOrderByProject([repository]),
					await subjectStates(subjectsToAsk(runs), ASK_NEEDED_AGAIN_MS),
				);
				return {
					stages: board.stages.map((s) => ({
						stage: s.id,
						cards: s.cards.map((c) => ({
							...card(c.run),
							trail: c.trail.map((t) => `${t.agent} (${t.status})`),
						})),
					})),
					agents: board.agents,
				};
			},
		),
	];
}
