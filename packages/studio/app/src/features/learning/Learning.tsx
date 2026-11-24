import { ChevronRight, ExternalLink, GraduationCap } from "lucide-react";
import { AgentTag } from "../../components/badges.js";
import { Empty, ErrorNote, PageSkeleton } from "../../components/feedback.js";
import { PageHeader, Section } from "../../components/page-layout.js";
import { Segmented } from "../../components/segmented.js";
import { useApi } from "../../hooks/use-api.js";
import { query } from "../../lib/api.js";
import { ago } from "../../lib/format.js";
import { learningHref, runHref } from "../../lib/route.js";
import type { LearningAnswer, LessonAnswer, Period } from "../../lib/types.js";
import { Card, Figure } from "../overview/charts.js";
import { FileDiff } from "../run-detail/FileDiff.js";
import { candidateNote, FAILURE_WORDS, outcomeWords } from "./learning-view.js";

// Learning, read-only: what failed, the lessons drawn from it, and the improvements to review on
// GitHub. The studio never approves nor merges: a person does, on the pull request.

const PERIODS: { value: Period; label: string }[] = [
	{ value: "7d", label: "7 days" },
	{ value: "30d", label: "30 days" },
	{ value: "all", label: "All time" },
];

type Row = LearningAnswer["toReview"][number];

const inlineCode = (text: string) => (
	<code className="rounded-md bg-sunken px-1.5 py-0.5 font-mono text-xs text-fg ring-1 ring-line">
		{text}
	</code>
);

/** Learning's page, or one lesson's improvement. */
export function Learning({
	project,
	lesson,
	period,
}: {
	project: string | undefined;
	lesson: string | undefined;
	period: string | undefined;
}) {
	return lesson ? (
		<LessonPage project={project} id={lesson} />
	) : (
		<LearningPage
			project={project}
			period={PERIODS.find((p) => p.value === period)?.value ?? "30d"}
		/>
	);
}

function LessonList({
	rows,
	project,
	aside,
}: {
	rows: Row[];
	project: string | undefined;
	aside: (row: Row) => string;
}) {
	return (
		<ul className="panel divide-y divide-line">
			{rows.map((row) => (
				<li key={row.id}>
					<a
						href={learningHref({ project, lesson: row.id })}
						className="flex items-center gap-3 px-4 py-3 text-sm text-fg no-underline transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-hover sm:px-5"
					>
						<span className="tnum w-8 shrink-0 font-mono text-xs text-fg-3">
							{row.id}
						</span>
						<span className="min-w-0 flex-1">
							<span className="block truncate">{row.rule}</span>
							<span className="block truncate font-mono text-xs text-fg-2">
								{row.target}
							</span>
						</span>
						<span className="hidden shrink-0 text-xs text-fg-2 sm:block">
							{aside(row)}
						</span>
						<ChevronRight className="size-4 shrink-0 text-fg-3" aria-hidden />
					</a>
				</li>
			))}
		</ul>
	);
}

function LearningPage({
	project,
	period,
}: {
	project: string | undefined;
	period: Period;
}) {
	const { data, error } = useApi<LearningAnswer>(
		`/api/learning${query({ project, period })}`,
		30_000,
	);
	if (error && !data) return <ErrorNote>{error}</ErrorNote>;
	if (!data) return <PageSkeleton />;
	const { numbers: n } = data;
	return (
		<>
			<PageHeader
				title="Learning"
				description={
					data.learning
						? `${data.learning.text[0]?.toUpperCase()}${data.learning.text.slice(1)}. A person merges each one, then applies the factory.`
						: "The factory's failed work: checks that kept failing, reviews and maintainers that asked for changes."
				}
			>
				<Segmented
					label="Period"
					value={period}
					options={PERIODS}
					href={(p) =>
						learningHref({ project, period: p === "30d" ? undefined : p })
					}
				/>
			</PageHeader>
			{!data.learning && (
				<p className="panel mb-6 px-5 py-4 text-sm text-fg-2">
					Learning is off. To turn it on, add {inlineCode("learning: true")} to{" "}
					{inlineCode("openfabriq/factory.yaml")}, then run{" "}
					{inlineCode("openfabriq apply")}: each week the engine studies the
					work that failed, and proposes improvements to skills and agent.md, by
					pull request only.
				</p>
			)}
			{data.learning && data.unheard.length > 0 && (
				<p className="panel mb-6 px-5 py-4 text-sm text-fg-2">
					Failed checks and changes a maintainer asks for on GitHub count as
					failures only when an automation of the factory runs on them. None
					runs on{" "}
					{data.unheard.map((event, i) => (
						<span key={event}>
							{i > 0 && " or "}
							{inlineCode(event)}
						</span>
					))}
					: learning does not see those failures.
				</p>
			)}
			<div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<Card title="Failures">
					<Figure value={n.failures}>over the period</Figure>
				</Card>
				<Card title="Lessons">
					<Figure value={n.lessons}>not resolved yet</Figure>
				</Card>
				<Card title="To review">
					<Figure value={n.toReview}>improvements on GitHub</Figure>
				</Card>
				<Card title="Came back">
					<Figure value={n.cameBack}>after a merged improvement</Figure>
				</Card>
			</div>
			<div className="space-y-10">
				{data.toReview.length > 0 && (
					<Section title="Improvements to review">
						<LessonList
							rows={data.toReview}
							project={project}
							aside={(r) => `${r.failures} failures`}
						/>
					</Section>
				)}
				{data.candidates.length > 0 && (
					<Section title="Candidate lessons">
						<LessonList
							rows={data.candidates}
							project={project}
							aside={(r) => candidateNote(r, data.threshold)}
						/>
					</Section>
				)}
				{data.history.length > 0 && (
					<Section title="History">
						<LessonList
							rows={data.history}
							project={project}
							aside={(r) =>
								`${outcomeWords(r.status)}${r.cameBack ? `, came back ${r.cameBack}×` : ""}`
							}
						/>
					</Section>
				)}
				<Section title="Recent failures">
					{data.recent.length === 0 ? (
						<Empty icon={<GraduationCap />} title="No failure over the period">
							A failure is a check that kept failing, an internal review that
							asked for changes, or failed checks and requested changes on a
							pull request the factory opened.
						</Empty>
					) : (
						<ul className="panel divide-y divide-line">
							{data.recent.map((f) => (
								<li key={f.id}>
									<a
										href={runHref(f.run, { project })}
										className="flex items-center gap-3 px-4 py-2.5 text-sm text-fg no-underline transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-hover sm:px-5"
									>
										<span className="w-28 shrink-0 truncate">
											<AgentTag name={f.agent} className="max-w-full" />
										</span>
										<span className="min-w-0 flex-1">
											<span className="block truncate">
												{FAILURE_WORDS[f.kind]}
											</span>
											<span className="block truncate text-xs text-fg-2">
												{f.summary}
											</span>
										</span>
										<span className="tnum w-16 shrink-0 text-right text-xs text-fg-2">
											{ago(f.at)}
										</span>
									</a>
								</li>
							))}
						</ul>
					)}
				</Section>
			</div>
		</>
	);
}

/** Explore improvement: the lesson, the diff its pull request proposed, and the failures it comes from. */
function LessonPage({
	project,
	id,
}: {
	project: string | undefined;
	id: string;
}) {
	const { data, error } = useApi<LessonAnswer>(
		// Read once: the diff comes from GitHub.
		`/api/learning/${encodeURIComponent(id)}${query({ project })}`,
	);
	if (error && !data) return <ErrorNote>{error}</ErrorNote>;
	if (!data) return <PageSkeleton />;
	const cameBack = new Set(data.cameBackIds);
	return (
		<>
			<PageHeader title={`Lesson ${data.id}`} description={data.cause}>
				{data.improvement && (
					<a
						href={data.improvement.url}
						target="_blank"
						rel="noreferrer"
						className="btn"
					>
						<ExternalLink className="size-3.5 text-fg-2" aria-hidden />
						Review on GitHub
					</a>
				)}
			</PageHeader>
			<div className="space-y-10">
				<Section
					title="Rule"
					aside={
						<a href={data.targetUrl} target="_blank" rel="noreferrer">
							{data.target}
						</a>
					}
				>
					<p className="panel px-5 py-4 text-sm text-fg">{data.rule}</p>
				</Section>
				{data.diff && (
					<Section
						title="The change it proposes"
						aside={
							data.diffFrom === "run"
								? "As the learning run proposed it: GitHub did not answer"
								: "As on the pull request"
						}
					>
						<div className="panel overflow-hidden">
							{data.diff.files.map((file) => (
								<div key={file.path}>
									<p className="px-4 py-2 font-mono text-xs text-fg-2">
										{file.path}
									</p>
									{file.hunks && (
										<FileDiff path={file.path} hunks={file.hunks} />
									)}
								</div>
							))}
						</div>
					</Section>
				)}
				<Section title={`Failures (${data.failures.length})`}>
					<ul className="panel divide-y divide-line">
						{data.failures.map((f) => (
							<li
								key={f.id}
								className="flex items-center gap-3 px-4 py-2.5 text-sm sm:px-5"
							>
								<span className="w-28 shrink-0 truncate">
									<AgentTag name={f.agent} className="max-w-full" />
								</span>
								<span className="min-w-0 flex-1">
									{"summary" in f ? (
										<a href={runHref(f.run, { project })}>{f.summary}</a>
									) : (
										<span className="text-fg-2">{f.id}</span>
									)}
									{cameBack.has(f.id) && (
										<span className="ml-2 text-xs text-warn">came back</span>
									)}
								</span>
								{"url" in f && f.url && (
									<a
										href={f.url}
										target="_blank"
										rel="noreferrer"
										className="shrink-0 text-xs text-fg-2"
									>
										GitHub
									</a>
								)}
								<span className="tnum w-16 shrink-0 text-right text-xs text-fg-2">
									{ago(f.at)}
								</span>
							</li>
						))}
					</ul>
				</Section>
			</div>
		</>
	);
}
