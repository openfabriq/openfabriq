import { LESSON_THRESHOLD } from "@openfabriq/core";
import { ArrowLeft, ArrowUpRight, FileText } from "lucide-react";
import type { ReactNode } from "react";
import { AgentTag } from "../../components/badges.js";
import { ErrorNote, PageSkeleton } from "../../components/feedback.js";
import { useApi } from "../../hooks/use-api.js";
import { query } from "../../lib/api.js";
import { agentHref, learningHref, runHref } from "../../lib/route.js";
import type { LessonAnswer } from "../../lib/types.js";
import { FileDiff } from "../run-detail/FileDiff.js";
import { lessonResult, whatHappensNext } from "./learning-view.js";
import {
	Code,
	InfoTip,
	inlineCode,
	KINDS,
	owner,
	Pips,
	SAID,
	SEEN_HINT,
	since,
	times,
} from "./parts.js";

// One lesson: the rule it writes and where, what came of it, why, the change it proposes, the
// mistakes it comes from, and its history. Read-only: the review happens on GitHub.

type Tone = "accent" | "ok" | "warn" | "muted" | "neutral";

const TONES: Record<Tone, { dot: string; text: string; soft: string }> = {
	accent: {
		dot: "bg-accent",
		text: "text-accent-text",
		soft: "bg-accent-soft",
	},
	ok: { dot: "bg-ok", text: "text-ok", soft: "bg-ok-soft" },
	warn: { dot: "bg-warn", text: "text-warn", soft: "bg-warn-soft" },
	muted: { dot: "bg-fg-3", text: "text-fg-2", soft: "bg-hover" },
	neutral: { dot: "bg-fg-2", text: "text-fg", soft: "bg-hover" },
};

/** What came of a lesson: its state, in a word and a sentence. */
function resultOf(
	l: LessonAnswer,
	threshold: number,
): { tone: Tone; title: string; text: ReactNode } {
	const pr = l.improvement;
	switch (lessonResult(l)) {
		case "to-review":
			return {
				tone: "accent",
				title: "Waiting for your review",
				text: (
					<>
						Learning proposed this rule in pull request #{pr?.number}
						{pr ? ` ${since(pr.at)}` : ""}. Merge it on GitHub: the engine
						applies it on its own, and the agents use it from their next run.
					</>
				),
			};
		case "declined":
			return {
				tone: "muted",
				title: "Declined",
				text: `Its pull request was closed without merge${l.resolvedAt ? ` ${since(l.resolvedAt)}` : ""}. Learning does not propose this rule again.`,
			};
		case "not-applied":
			return {
				tone: "neutral",
				title: "Merged, not applied yet",
				text: (
					<>
						The rule is in the repository, but the agents do not use it yet. The
						engine applies a merged rule within a minute while{" "}
						{inlineCode("openfabriq start")} runs; when it cannot, its log says
						why, and {inlineCode("openfabriq apply")} applies it. From then on,
						the same mistake counts as coming back.
					</>
				),
			};
		case "came-back":
			return {
				tone: "warn",
				title: `Came back ${times(l.cameBack)}`,
				text: `Applied ${since(l.appliedAt ?? "")}, and the same mistake happened ${times(l.cameBack)} since. The rule may need to be sharper: a new lesson will say so.`,
			};
		case "holding":
			return {
				tone: "ok",
				title: "Holding",
				text: `Applied ${since(l.appliedAt ?? "")}. The mistake has not come back since.`,
			};
		case "waiting":
			return {
				tone: "warn",
				title: "Waiting for it to happen again",
				text: `Learning drafted the rule${l.triedAt ? ` ${since(l.triedAt)}` : ""} but could not open its pull request. It tries again after the next mistake of this cause, not before.`,
			};
		case "ignored":
			return {
				tone: "muted",
				title: "Ignored",
				text: "Learning judged these mistakes outside the agents' hands: no sentence in a skill or an agent.md would have avoided them. It proposes no rule, and they are not counted as the agents' mistakes.",
			};
		case "being-learned":
			return {
				tone: "neutral",
				title: "Being learned",
				text: `Seen in ${l.runs === 1 ? "one run" : `${l.runs} runs`}. ${whatHappensNext(l, threshold)}`,
			};
	}
}

export function LessonDetail({
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
	const result = resultOf(data, LESSON_THRESHOLD);
	const tone = TONES[result.tone];
	const who = owner(data.target);
	// An ignored lesson has no rule nor file: its cause heads the page, and it concerns its agents.
	const ignored = data.status === "ignored";
	// An agent's page. A skill and an automation have none: the agent whose mistakes it comes from,
	// on its automations (where its page opens) or its skills.
	const automation = data.target.endsWith("/automation.md");
	const ownerHref = who.agent
		? agentHref(who.agent, project)
		: data.agents[0] &&
			agentHref(data.agents[0], project, automation ? undefined : "skills");
	const cameBack = new Set(data.cameBackIds);
	const file = data.target.split("/").at(-1);
	const folder = data.target.slice(0, data.target.length - (file?.length ?? 0));
	return (
		<article className="pb-16">
			<a
				href={learningHref({ project })}
				className="mb-6 inline-flex items-center gap-1.5 text-sm text-fg-2 no-underline transition-colors hover:text-fg"
			>
				<ArrowLeft className="size-3.5" aria-hidden />
				Learning
			</a>

			<header className="mb-8 flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
				<div className="min-w-0 max-w-[62ch]">
					<p className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-fg-2">
						<span className="font-mono text-xs text-fg-3">
							Lesson {data.id}
						</span>
						<span aria-hidden className="text-fg-3">
							·
						</span>
						{ignored ? (
							<>
								For{" "}
								{data.agents.map((a) => (
									<a
										key={a}
										href={agentHref(a, project)}
										title={`Open ${a}`}
										className="group/owner no-underline"
									>
										<AgentTag
											name={a}
											className="text-sm transition-colors duration-150 group-hover/owner:text-fg"
										/>
									</a>
								))}
							</>
						) : (
							<>
								For{" "}
								{ownerHref ? (
									<a
										href={ownerHref}
										title={
											who.agent
												? `Open ${who.agent}`
												: `Open the ${automation ? "automations" : "skills"} of ${data.agents[0]}`
										}
										className="group/owner text-fg-2 no-underline transition-colors duration-150 hover:text-fg"
									>
										{who.agent ? (
											<AgentTag
												name={who.agent}
												className="text-sm transition-colors duration-150 group-hover/owner:text-fg"
											/>
										) : (
											who.label
										)}
									</a>
								) : (
									who.label
								)}
								<span aria-hidden className="text-fg-3">
									·
								</span>
								<a
									href={data.targetUrl}
									target="_blank"
									rel="noreferrer"
									title={`Open ${data.target} on GitHub`}
									className="group/path inline-flex min-w-0 items-center gap-1.5 no-underline"
								>
									<FileText
										className="size-3.5 shrink-0 text-fg-3 transition-colors duration-150 group-hover/path:text-fg-2"
										aria-hidden
									/>
									<span className="min-w-0 truncate font-mono text-xs">
										<span className="text-fg-3 transition-colors duration-150 group-hover/path:text-fg-2">
											{folder}
										</span>
										<span className="text-fg-2 transition-colors duration-150 group-hover/path:text-fg">
											{file}
										</span>
									</span>
								</a>
							</>
						)}
					</p>
					<h1 className="text-[1.375rem] leading-8 font-semibold tracking-[-0.015em] text-fg">
						<Code text={ignored ? data.cause : data.rule} />
					</h1>
				</div>
				{data.improvement && (
					<a
						href={data.improvement.url}
						target="_blank"
						rel="noreferrer"
						className={`${data.status === "proposed" ? "btn-ink" : "btn"} shrink-0 no-underline`}
					>
						{data.status === "proposed" ? "Review" : "View"} #
						{data.improvement.number} on GitHub
						<ArrowUpRight className="size-3.5" aria-hidden />
					</a>
				)}
			</header>

			<section aria-label="Result" className="panel mb-12">
				<div className="px-6 pt-5 pb-6">
					<p
						className={`inline-flex h-7 items-center gap-2 rounded-full px-3 text-sm font-medium ${tone.soft} ${tone.text}`}
					>
						<span className={`size-2 rounded-full ${tone.dot}`} aria-hidden />
						{result.title}
					</p>
					<p className="mt-3 max-w-[68ch] text-[15px] leading-7 text-fg">
						{result.text}
					</p>
				</div>
			</section>

			<div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_17rem] xl:gap-14">
				<div className="min-w-0 space-y-12">
					{!ignored && (
						<>
							<Block title="Why">
								<div className="panel">
									<p className="max-w-[68ch] px-5 py-4 text-[15px] leading-7 text-fg">
										{data.cause}
									</p>
									<p className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-b-[11px] border-t border-line bg-sunken/50 px-5 py-3 text-sm text-fg-2">
										<Pips
											value={data.runs}
											of={LESSON_THRESHOLD}
											waits={data.waits !== undefined}
										/>
										<span>
											Seen in{" "}
											<span className="tnum font-medium text-fg">
												{data.runs === 1 ? "one run" : `${data.runs} runs`}
											</span>
										</span>
										<span aria-hidden className="text-fg-3">
											·
										</span>
										<span>
											<span className="tnum font-medium text-fg">
												{data.failures.length}
											</span>{" "}
											{data.failures.length === 1 ? "mistake" : "mistakes"}
										</span>
										<InfoTip label="seen in">
											{SEEN_HINT(LESSON_THRESHOLD)}
										</InfoTip>
									</p>
								</div>
							</Block>

							<Block
								title="The change"
								aside={
									data.diff
										? data.diffFrom === "run"
											? "As learning proposed it: GitHub did not answer"
											: data.improvement && (
													<>
														As on{" "}
														<a
															href={data.improvement.url}
															target="_blank"
															rel="noreferrer"
															className="text-fg-2 underline decoration-line-2 underline-offset-2 transition-colors hover:text-fg hover:decoration-fg-3"
														>
															pull request #{data.improvement.number}
														</a>
													</>
												)
										: undefined
								}
							>
								{data.diff ? (
									<div className="panel overflow-hidden">
										{data.diff.files.map((f) => (
											<div
												key={f.path}
												className="border-b border-line last:border-b-0"
											>
												<p className="flex items-center gap-2 bg-sunken/50 px-4 py-2.5 font-mono text-xs text-fg-2">
													<FileText
														className="size-3.5 text-fg-3"
														aria-hidden
													/>
													{f.path}
												</p>
												{f.hunks && <FileDiff path={f.path} hunks={f.hunks} />}
											</div>
										))}
									</div>
								) : data.improvement ? (
									<p className="rounded-xl border border-dashed border-line-2 px-5 py-6 text-sm leading-6 text-fg-2">
										The change is on{" "}
										<a
											href={data.improvement.url}
											target="_blank"
											rel="noreferrer"
										>
											pull request #{data.improvement.number}
										</a>
										: GitHub did not answer, and the learning run kept no copy
										of it.
									</p>
								) : (
									<p className="rounded-xl border border-dashed border-line-2 px-5 py-6 text-sm leading-6 text-fg-2">
										No change yet. Learning writes the rule into{" "}
										{inlineCode(data.target)} and opens a pull request once the
										mistake repeats.
									</p>
								)}
							</Block>
						</>
					)}

					<Block title="Mistakes it comes from" count={data.failures.length}>
						<ol className="panel divide-y divide-line">
							{[...data.failures]
								.sort((a, b) => b.at.localeCompare(a.at))
								.map((f) => {
									const { icon: Icon, tone: kindTone } = KINDS[f.kind];
									const journal = "summary" in f ? f : undefined;
									const github = f.url;
									return (
										<li
											key={f.id}
											className="group relative flex items-start gap-3.5 px-5 py-4 transition-colors duration-150 first:rounded-t-[11px] last:rounded-b-[11px] hover:bg-hover"
										>
											<span
												className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-sunken ring-1 ring-line ${kindTone}`}
											>
												<Icon className="size-3.5" aria-hidden />
											</span>
											<span className="min-w-0 flex-1">
												<span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
													{journal ? (
														<a
															href={runHref(journal.run, { project })}
															title="The run where the mistake happened"
															className="text-[15px] leading-6 font-medium text-fg no-underline after:absolute after:inset-0"
														>
															{SAID[f.kind]}
														</a>
													) : (
														<span className="text-[15px] leading-6 font-medium text-fg">
															{SAID[f.kind]}
														</span>
													)}
													{cameBack.has(f.id) && (
														<span
															title="It happened after the rule was applied: the rule did not prevent it."
															className="inline-flex h-5 items-center rounded-full bg-warn-soft px-2 text-2xs font-medium text-warn"
														>
															Came back after the rule
														</span>
													)}
												</span>
												{journal && journal.summary !== journal.title && (
													<span className="mt-1 block line-clamp-2 text-sm leading-6 text-fg-2">
														{journal.summary}
													</span>
												)}
												<span className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-3">
													<AgentTag name={f.agent} />
													<span aria-hidden className="text-fg-3">
														·
													</span>
													{journal ? (
														<span className="min-w-0 truncate">
															{journal.title ?? journal.summary}
														</span>
													) : (
														<span className="text-fg-3">
															The run is no longer in the journal
														</span>
													)}
													{github && (
														<a
															href={github}
															target="_blank"
															rel="noreferrer"
															className="relative z-10 inline-flex items-center gap-0.5 text-fg-2"
														>
															GitHub
															<ArrowUpRight className="size-3" aria-hidden />
														</a>
													)}
												</span>
											</span>
											<span className="tnum shrink-0 pt-0.5 text-xs whitespace-nowrap text-fg-3">
												{since(f.at)}
											</span>
										</li>
									);
								})}
						</ol>
					</Block>
				</div>

				<aside className="min-w-0">
					<Block title="History">
						<History lesson={data} now={result} />
					</Block>
				</aside>
			</div>
		</article>
	);
}

interface Moment {
	at: string;
	title: string;
	detail?: string;
	tone: Tone;
}

/** A lesson's life, oldest first: its mistakes, the rule proposed, merged, applied, came back. */
function History({
	lesson: l,
	now,
}: {
	lesson: LessonAnswer;
	now: { tone: Tone; title: string };
}) {
	const back = new Set(l.cameBackIds);
	const moments: Moment[] = [
		...l.failures.map(
			(f): Moment => ({
				at: f.at,
				title: back.has(f.id) ? "The mistake came back" : SAID[f.kind],
				detail: f.agent,
				tone: back.has(f.id) ? "warn" : "muted",
			}),
		),
		{
			at: l.createdAt,
			title: "Lesson drawn",
			detail: "by learning",
			tone: "neutral",
		} satisfies Moment,
		...(l.triedAt && l.status === "candidate"
			? [
					{
						at: l.triedAt,
						title: "Rule drafted, not opened",
						tone: "warn",
					} satisfies Moment,
				]
			: []),
		...(l.improvement
			? [
					{
						at: l.improvement.at,
						title: `Rule proposed in #${l.improvement.number}`,
						tone: "accent",
					} satisfies Moment,
				]
			: []),
		...(l.mergedAt
			? [
					{
						at: l.mergedAt,
						title: "Merged on GitHub",
						tone: "ok",
					} satisfies Moment,
				]
			: []),
		...(l.appliedAt
			? [
					{
						at: l.appliedAt,
						title: "Applied to the factory",
						detail: "the agents use the rule",
						tone: "ok",
					} satisfies Moment,
				]
			: []),
		...(l.status === "rejected" && l.resolvedAt
			? [
					{
						at: l.resolvedAt,
						title: "Declined",
						detail: "pull request closed",
						tone: "muted",
					} satisfies Moment,
				]
			: []),
	].sort((a, b) => a.at.localeCompare(b.at));
	// Where it stands now, unless the last moment already says it: a declined lesson ends there.
	if (l.status !== "rejected")
		moments.push({ at: "", title: now.title, detail: "now", tone: now.tone });
	return (
		<ol className="relative">
			{moments.map((m, i) => (
				<li
					key={`${m.at}-${m.title}`}
					className="relative flex gap-3.5 pb-5 last:pb-0"
				>
					{i < moments.length - 1 && (
						<span
							aria-hidden
							className="absolute top-3 bottom-0 left-[4.5px] w-px bg-line-2"
						/>
					)}
					<span
						aria-hidden
						className={`relative mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-bg ${m.at ? TONES[m.tone].dot : `border-2 bg-bg ${TONES[m.tone].text} border-current`}`}
					/>
					<span className="min-w-0">
						<span
							className={`block text-sm leading-5 ${m.tone === "muted" ? "text-fg-2" : TONES[m.tone].text}`}
						>
							{m.title}
						</span>
						<span className="mt-0.5 block text-xs text-fg-3">
							{[m.at ? since(m.at) : "", m.detail].filter(Boolean).join(" · ")}
						</span>
					</span>
				</li>
			))}
		</ol>
	);
}

function Block({
	title,
	count,
	aside,
	children,
}: {
	title: string;
	count?: number;
	aside?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section>
			<div className="mb-3.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
				<h2 className="text-base font-semibold text-fg">{title}</h2>
				{count !== undefined && (
					<span className="tnum text-sm text-fg-3">{count}</span>
				)}
				{aside && <span className="ml-auto text-xs text-fg-3">{aside}</span>}
			</div>
			{children}
		</section>
	);
}
