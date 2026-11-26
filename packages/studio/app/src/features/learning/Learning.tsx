import { Check, CircleAlert, Loader2 } from "lucide-react";
import { Elapsed } from "../../components/badges.js";
import {
	ConfirmRun,
	NoticeBox,
	RunButton,
} from "../../components/engine-run.js";
import { ErrorNote, PageSkeleton } from "../../components/feedback.js";
import { PageHeader } from "../../components/page-layout.js";
import { useApi } from "../../hooks/use-api.js";
import { useEngineRun } from "../../hooks/use-engine-run.js";
import { query } from "../../lib/api.js";
import { isBusy } from "../../lib/engine-run.js";
import { ago } from "../../lib/format.js";
import { runHref } from "../../lib/route.js";
import type { LearningAnswer } from "../../lib/types.js";
import { LearningDashboard, Progress, tabOf } from "./LearningDashboard.js";
import { LessonDetail } from "./LessonDetail.js";
import { type LearningNotice, learningNotice } from "./learning-view.js";

// Learning: the mistakes of the factory's work, the lessons drawn from them, and the rules to
// review on GitHub. The studio never approves nor merges: a person does, on the pull request. Its
// one action asks the engine for a batch now, like `openfabriq run learning`.

/** Learning's page on one of its tabs, or one lesson's page. */
export function Learning({
	project,
	lesson,
	tab,
}: {
	project: string | undefined;
	lesson: string | undefined;
	tab: string | undefined;
}) {
	return lesson ? (
		<LessonDetail project={project} id={lesson} />
	) : (
		<LearningPage project={project} tab={tab} />
	);
}

function LearningPage({
	project,
	tab,
}: {
	project: string | undefined;
	tab: string | undefined;
}) {
	const { justAsked, failure, confirming, setConfirming, ask } = useEngineRun(
		"/api/learning/run",
		project,
	);
	const { data, error, refetch } = useApi<LearningAnswer>(
		`/api/learning${query({ project })}`,
		// Read every 3 s while a batch waits or works, so the page follows it.
		(latest) => (justAsked || isBusy(latest?.run) ? 3000 : 30_000),
	);
	if (error && !data) return <ErrorNote>{error}</ErrorNote>;
	if (!data) return <PageSkeleton />;
	return (
		<>
			<PageHeader
				title="Learning"
				description="Mistakes that repeat become rules for the agents, reviewed by a person on GitHub."
			>
				{project && data.learning && (
					<>
						<RunButton
							label="Run learning now"
							busyLabel="Learning…"
							icon="play"
							busy={justAsked || isBusy(data.run)}
							onClick={() => setConfirming(true)}
						/>
						<ConfirmRun
							open={confirming}
							title="Run learning now?"
							text={`An agent reads the mistakes since the last batch and groups them into lessons. When a cause shows in ${data.threshold} runs, it proposes its rule by pull request. With no new mistake and no rule waiting, it stops before it starts and costs nothing.`}
							confirm="Run"
							usdPerRun={data.usdPerRun}
							onCancel={() => setConfirming(false)}
							onConfirm={() => void ask(refetch)}
						/>
					</>
				)}
			</PageHeader>
			{project && (
				<RunNotice
					notice={learningNotice(data.run)}
					failure={failure}
					project={project}
				/>
			)}
			<LearningDashboard
				data={data}
				project={project}
				tab={tabOf(tab, data)}
				status={
					(data.progress || (project && data.learning)) && (
						<div className="mb-8 flex flex-wrap items-center justify-between gap-x-10 gap-y-2">
							{data.progress ? <Progress progress={data.progress} /> : <span />}
							{project && data.learning && (
								<BatchTimes
									learning={data.learning}
									run={data.run}
									project={project}
								/>
							)}
						</div>
					)
				}
			/>
		</>
	);
}

/** "Mon 30 Nov", in the factory's time zone, as its schedule is read. */
const batchDay = (iso: string, timeZone?: string) =>
	new Date(iso).toLocaleDateString("en-GB", {
		weekday: "short",
		day: "numeric",
		month: "short",
		...(timeZone ? { timeZone } : {}),
	});

/** Learning's batches, in a line: "Runs every Monday at 08:00 · next Mon 30 Nov · last 2h ago"; the last opens its run. */
function BatchTimes({
	learning,
	run,
	project,
}: {
	learning: NonNullable<LearningAnswer["learning"]>;
	run: LearningAnswer["run"];
	project: string;
}) {
	const busy = isBusy(run);
	const last = run && "id" in run && !busy ? run : undefined;
	const dot = <span className="text-fg-3"> · </span>;
	return (
		<p className="tnum text-sm text-fg-2">
			Runs {learning.words}
			{learning.next && (
				<>
					{dot}next{" "}
					<span className="text-fg">
						{batchDay(learning.next, learning.timezone)}
					</span>
				</>
			)}
			{dot}
			{busy ? (
				<span className="text-fg">running now</span>
			) : last ? (
				<a
					href={runHref(last.id, { project })}
					title="Open its run"
					aria-label={`Last batch: ${ago(last.at)}, open its run`}
					className={`no-underline transition-colors duration-150 hover:text-fg-2 ${last.state === "failed" ? "text-bad" : "text-fg"}`}
				>
					last {last.state === "failed" ? "failed " : ""}
					{ago(last.at)}
				</a>
			) : (
				<span className="text-fg">never run yet</span>
			)}
		</p>
	);
}

/** Where learning's latest batch stands, above the dashboard. */
function RunNotice({
	notice,
	failure,
	project,
}: {
	notice: LearningNotice | undefined;
	failure: string | undefined;
	project: string;
}) {
	const runLink = (id: string) => (
		<a href={runHref(id, { project })} className="whitespace-nowrap">
			See the run
		</a>
	);
	const working = (
		<Loader2 className="animate-spin text-accent-text" aria-hidden />
	);
	const failed = <CircleAlert className="text-bad" aria-hidden />;
	if (failure)
		return (
			<NoticeBox tone="failed" icon={failed}>
				{failure}
			</NoticeBox>
		);
	switch (notice?.kind) {
		case "asked":
			return (
				<NoticeBox tone="working" icon={working}>
					Asked. Learning starts within a minute.
				</NoticeBox>
			);
		case "queued":
			return (
				<NoticeBox tone="working" icon={working}>
					Waiting for its turn: the engine runs a few agents at a time.{" "}
					{runLink(notice.id)}
				</NoticeBox>
			);
		case "running":
			return (
				<NoticeBox tone="working" icon={working}>
					Learning is studying the new mistakes, for{" "}
					<Elapsed since={notice.since} /> so far. {runLink(notice.id)}
				</NoticeBox>
			);
		case "failed":
			return (
				<NoticeBox tone="failed" icon={failed}>
					The last batch did not finish
					{notice.reason ? `: ${notice.reason}` : ""}. {runLink(notice.id)}
				</NoticeBox>
			);
		case "done":
			return (
				<NoticeBox tone="done" icon={<Check className="text-ok" aria-hidden />}>
					{notice.pullRequest ? (
						<>
							The batch is done and proposed a rule:{" "}
							<a href={notice.pullRequest} target="_blank" rel="noreferrer">
								review its pull request
							</a>
							.
						</>
					) : (
						"The batch is done: nothing new to propose this time."
					)}{" "}
					{runLink(notice.id)}
				</NoticeBox>
			);
		default:
			return null;
	}
}
