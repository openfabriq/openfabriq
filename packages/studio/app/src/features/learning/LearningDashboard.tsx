import type { FailureKind } from "@openfabriq/runner";
import {
	ArrowRight,
	ArrowUpRight,
	ChevronRight,
	TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { AgentTag } from "../../components/badges.js";
import { Tabs } from "../../components/tabs.js";
import { capitalized } from "../../lib/format.js";
import { learningHref, runHref } from "../../lib/route.js";
import type { LearningAnswer } from "../../lib/types.js";
import {
	type LessonResult,
	lessonResult,
	progressView,
	whatHappensNext,
} from "./learning-view.js";
import {
	Code,
	InfoTip,
	inlineCode,
	KIND_ORDER,
	KINDS,
	MISTAKE_HINT,
	owner,
	Pips,
	type Row,
	SAID,
	SEEN_HINT,
	SHORT,
	since,
	times,
} from "./parts.js";

// Learning at a glance: four cards say where things stand, then a table per tab holds the
// lessons. A "mistake" is any time an agent's work was not right the first time: a check that kept
// failing, the review or a maintainer that asked for changes, red checks on GitHub. Never "a
// failed run": the run may well have succeeded once fixed.

export type Tab = "review" | "learning" | "learned" | "mistakes";

/** The tab a page opens on: the one asked, else what waits for a person, else what is being learned. */
export function tabOf(asked: string | undefined, data: LearningAnswer): Tab {
	if (
		asked === "review" ||
		asked === "learning" ||
		asked === "learned" ||
		asked === "mistakes"
	)
		return asked;
	return data.toReview.length > 0 ? "review" : "learning";
}

export function LearningDashboard({
	data,
	project,
	tab,
	status,
}: {
	data: LearningAnswer;
	project: string | undefined;
	tab: Tab;
	/** The line above the cards: mistakes per run, and learning's batches. */
	status?: ReactNode;
}) {
	const n = data.numbers;
	const tabHref = (t: Tab) => learningHref({ project, tab: t });
	const couldNot = data.candidates.filter((r) => r.waits !== undefined).length;
	const merged = data.history.filter((r) => r.status === "promoted");
	const results = merged.map(lessonResult);
	const count = (r: LessonResult) => results.filter((x) => x === r).length;
	const [holding, cameBack, notApplied] = [
		count("holding"),
		count("came-back"),
		count("not-applied"),
	];
	const oldest = data.toReview.at(-1)?.improvement?.at;
	const cards: CardSpec[] = [
		{
			tab: "review",
			label: "To review",
			value: data.toReview.length,
			tone: data.toReview.length > 0 ? "accent" : undefined,
			hint: "Rules learning proposed, each in a pull request on GitHub. Once a person merges one, the engine applies it on its own: the agents use it from their next run.",
			line:
				data.toReview.length === 0
					? "Nothing waits for you"
					: oldest
						? `Oldest proposed ${since(oldest)}`
						: "On GitHub",
		},
		{
			tab: "learning",
			label: "Being learned",
			value: data.candidates.length,
			hint: `Mistakes with the same cause, grouped into a lesson. Learning proposes its rule once the mistake is seen in ${data.threshold} separate runs.`,
			line:
				couldNot > 0
					? `${couldNot} could not be proposed yet`
					: `A rule is proposed once seen in ${data.threshold} runs`,
		},
		{
			tab: "learned",
			label: "Learned",
			value: merged.length,
			hint: "Rules merged on GitHub. Holding: the mistake has not happened since. Came back: it happened again, so the rule did not hold. Not applied yet: merged, and the engine could not apply it on its own yet. Declined rules and ignored lessons are in the tab, not counted.",
			line:
				merged.length === 0 ? (
					"No rule merged yet"
				) : (
					<MergedLine
						parts={[
							[holding, "holding", "text-ok"],
							[cameBack, "came back", "text-warn"],
							[notApplied, "not applied yet", "text-fg-2"],
						]}
					/>
				),
		},
		{
			tab: "mistakes",
			label: "Agent mistakes",
			value: n.failures,
			hint: (
				<>
					Each time an agent's work was not right the first time. Not a failed
					run: the work may well have passed once fixed.
					<span className="mt-2 grid gap-1">
						{KIND_ORDER.map((k) => (
							<span key={k} className="flex gap-2">
								<span
									className={`mt-1.5 size-1.5 shrink-0 rounded-full ${KINDS[k].bar}`}
									aria-hidden
								/>
								<span>
									<span className="font-medium text-fg">{SHORT[k]}</span>:{" "}
									{KIND_HINT[k]}
								</span>
							</span>
						))}
					</span>
				</>
			),
			line: "In the last 30 days",
			mix: data.byKind,
		},
	];
	return (
		<>
			{!data.learning && (
				<Banner>
					Learning is off: mistakes are counted, but no rule is proposed. Add{" "}
					{inlineCode("learning: true")} to{" "}
					{inlineCode("openfabriq/factory.yaml")}, then run{" "}
					{inlineCode("openfabriq apply")}.
				</Banner>
			)}
			{status}
			<div className="mb-10 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				{cards.map((c, i) => (
					<StatCard
						key={c.tab}
						card={c}
						href={tabHref(c.tab)}
						right={i % 2 === 1}
					/>
				))}
			</div>
			<Tabs
				label="Learning"
				current={tab}
				href={tabHref}
				tabs={[
					{ id: "review", label: "To review", count: data.toReview.length },
					{
						id: "learning",
						label: "Being learned",
						count: data.candidates.length,
					},
					{ id: "learned", label: "Learned", count: merged.length },
					{ id: "mistakes", label: "Agent mistakes", count: n.failures },
				]}
			/>
			{tab === "review" && <ReviewTable data={data} project={project} />}
			{tab === "learning" && <LearningTable data={data} project={project} />}
			{tab === "learned" && <LearnedTable data={data} project={project} />}
			{tab === "mistakes" && <MistakesTable data={data} project={project} />}
		</>
	);
}

/** "12 Oct". */
const day = (iso: string) =>
	new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** How the factory's mistakes per run moved since the first learned rule applied, in a line; the method behind its mark. */
export function Progress({
	progress,
}: {
	progress: NonNullable<LearningAnswer["progress"]>;
}) {
	const view = progressView(progress);
	const tip = (sample: ReactNode) => (
		<InfoTip label="mistakes per run">
			Mistakes divided by the runs of the factory's agents, before and after the
			first learned rule applied on {day(view.since)}. {sample} It says what
			changed, not why: the agents' work changes too.
		</InfoTip>
	);
	if (view.kind === "waiting")
		return (
			<p className="flex flex-wrap items-center gap-x-1.5 text-sm text-fg-2">
				Mistakes per run are compared once {view.needed} runs have finished on
				each side of {day(view.since)}{" "}
				<span className="tnum text-fg-3">
					({view.runsBefore} before, {view.runsAfter} after)
				</span>
				{tip("Fewer runs than that on a side would make the rate noise.")}
			</p>
		);
	const tone =
		view.trend === "fewer"
			? "text-ok"
			: view.trend === "more"
				? "text-warn"
				: "text-fg-2";
	return (
		<p className="tnum flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-2">
			Mistakes per run
			<span className="inline-flex items-center gap-1.5 font-semibold text-fg">
				{view.before.toFixed(2)}
				<ArrowRight className="size-3.5 text-fg-3" aria-hidden />
				<span className="sr-only">to</span>
				{view.after.toFixed(2)}
			</span>
			<span className={`font-semibold ${tone}`}>{view.label}</span>
			since {day(view.since)}
			{tip(`${view.runsBefore} runs before, ${view.runsAfter} after.`)}
		</p>
	);
}

interface CardSpec {
	tab: Tab;
	label: string;
	value: number;
	/** What the number counts, behind the info mark. */
	hint: ReactNode;
	line: ReactNode;
	tone?: "accent" | undefined;
	mix?: Partial<Record<FailureKind, number>>;
}

/** A number, what it counts, and one line that says what it means; it opens its tab. */
function StatCard({
	card,
	href,
	right,
}: {
	card: CardSpec;
	href: string;
	/** A card on the right of its row: its tooltip opens toward the left. */
	right: boolean;
}) {
	return (
		<div className="group relative flex min-h-[8.5rem] flex-col rounded-xl border border-line bg-panel px-5 pt-4 pb-4 text-fg shadow-1 transition-[border-color,box-shadow] duration-200 ease-out hover:border-line-2 hover:shadow-2">
			<span className="flex items-center gap-1.5 text-sm text-fg-2">
				{card.tone === "accent" && (
					<span className="relative mr-0.5 flex size-2" aria-hidden>
						<span className="absolute inset-0 rounded-full bg-accent opacity-50 [animation:ping-dot_1.8s_cubic-bezier(0,0,0.2,1)_infinite]" />
						<span className="relative size-2 rounded-full bg-accent" />
					</span>
				)}
				{/* The whole card opens the tab; the info mark sits above that link. */}
				<a
					href={href}
					className="text-fg-2 no-underline outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-accent"
				>
					{card.label}
				</a>
				<span className="relative z-10 inline-flex">
					<InfoTip
						label={card.label}
						side="below"
						align={right ? "end" : "start"}
					>
						{card.hint}
					</InfoTip>
				</span>
				<ChevronRight
					className="ml-auto size-4 text-fg-3 opacity-0 transition-[opacity,translate] duration-200 group-hover:translate-x-0.5 group-hover:opacity-100"
					aria-hidden
				/>
			</span>
			<span
				className={`tnum mt-2 text-[2rem] leading-none font-semibold tracking-[-0.03em] ${card.tone === "accent" ? "text-accent-text" : "text-fg"}`}
			>
				{card.value}
			</span>
			<span className="mt-auto pt-3 text-xs leading-5 text-fg-2">
				{card.line}
			</span>
			{card.mix && <Mix mix={card.mix} />}
		</div>
	);
}

/** What each kind of mistake is, after its name in the legend. */
const KIND_HINT: Record<FailureKind, string> = {
	check: "the agent's own check kept failing",
	review: "the factory's review asked for changes",
	checks_failed: "red checks on its pull request",
	changes_requested: "a maintainer asked for changes on GitHub",
};

/** The kinds of mistake: a bar of their shares, and a legend that names each with its count. */
function Mix({ mix }: { mix: Partial<Record<FailureKind, number>> }) {
	const total = KIND_ORDER.reduce((sum, k) => sum + (mix[k] ?? 0), 0);
	if (total === 0) return null;
	return (
		<>
			<span
				className="mt-2 flex h-1.5 gap-px overflow-hidden rounded-full"
				aria-hidden
			>
				{KIND_ORDER.filter((k) => mix[k]).map((k) => (
					<span key={k} className={KINDS[k].bar} style={{ flexGrow: mix[k] }} />
				))}
			</span>
			<span className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs leading-4">
				{KIND_ORDER.map((k) => (
					<span
						key={k}
						title={SAID[k]}
						className={`flex min-w-0 items-center gap-1.5 ${mix[k] ? "text-fg-2" : "text-fg-3"}`}
					>
						<span
							className={`size-1.5 shrink-0 rounded-full ${mix[k] ? KINDS[k].bar : "bg-line-2"}`}
							aria-hidden
						/>
						<span className="truncate">{SHORT[k]}</span>
						<span className="tnum ml-auto text-fg">{mix[k] ?? 0}</span>
					</span>
				))}
			</span>
		</>
	);
}

// --- The tables ---

function Table({
	columns,
	children,
	empty,
}: {
	columns: { label: string; className?: string; hint?: string }[];
	children: ReactNode;
	empty?: ReactNode;
}) {
	return (
		// No overflow-hidden: a column's tooltip may reach past the table's edge; the corners round the cells.
		<div className="panel">
			{empty ?? (
				<table className="w-full text-left">
					<thead className="hidden md:table-header-group">
						<tr className="border-b border-line bg-sunken/50 [&>th:first-child]:rounded-tl-[11px] [&>th:last-child]:rounded-tr-[11px]">
							{columns.map((c) => (
								<th
									key={c.label}
									scope="col"
									className={`h-10 px-5 text-xs font-medium text-fg-2 ${c.className ?? ""}`}
								>
									<span className="inline-flex items-center gap-1">
										{c.label}
										{c.hint && (
											<InfoTip label={c.label} side="below">
												{c.hint}
											</InfoTip>
										)}
									</span>
								</th>
							))}
						</tr>
					</thead>
					<tbody className="divide-y divide-line [&>tr:last-child>td:first-child]:rounded-bl-[11px] [&>tr:last-child>td:last-child]:rounded-br-[11px] [&>tr:last-child]:rounded-b-[11px]">
						{children}
					</tbody>
				</table>
			)}
		</div>
	);
}

/** An empty tab: what would be there, and when. */
function Nothing({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="px-6 py-14 text-center">
			<p className="text-sm font-medium text-fg">{title}</p>
			<p className="mx-auto mt-1.5 max-w-[46ch] text-sm leading-6 text-fg-2">
				{children}
			</p>
		</div>
	);
}

/** The first cell of a lesson's row: its rule, and whom it is for; on a phone, the rest below. */
function RuleCell({
	row,
	project,
	muted,
	below,
}: {
	row: Row;
	project: string | undefined;
	muted?: boolean;
	below?: ReactNode;
}) {
	const who = owner(row.target);
	// An ignored lesson has no rule nor file: its cause, and the agents it concerned.
	const ignored = row.status === "ignored";
	return (
		<td className="px-5 py-4 align-top">
			<a
				href={learningHref({ project, lesson: row.id })}
				className={`line-clamp-2 max-w-[62ch] text-[15px] leading-6 no-underline after:absolute after:inset-0 ${muted ? "text-fg-3" : "text-fg"}`}
			>
				<Code text={ignored ? row.cause : row.rule} />
			</a>
			<span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-2">
				{ignored ? (
					row.agents.map((a) => <AgentTag key={a} name={a} />)
				) : who.agent ? (
					<AgentTag name={who.agent} />
				) : (
					<span className="inline-flex items-center gap-1.5">
						<span
							className="size-2 rounded-[3px] ring-1 ring-fg-3"
							aria-hidden
						/>
						{who.label}
					</span>
				)}
				{below && <span className="md:hidden">{below}</span>}
			</span>
		</td>
	);
}

function ReviewTable({
	data,
	project,
}: {
	data: LearningAnswer;
	project: string | undefined;
}) {
	return (
		<Table
			columns={[
				{ label: "Rule" },
				{ label: "Seen", className: "w-28", hint: SEEN_HINT(data.threshold) },
				{ label: "Proposed", className: "w-32" },
				{ label: "", className: "w-44" },
			]}
			empty={
				data.toReview.length === 0 ? (
					<Nothing title="Nothing to review">
						When the same mistake comes back in {data.threshold} runs, learning
						writes a rule and opens a pull request: it shows up here.
					</Nothing>
				) : undefined
			}
		>
			{data.toReview.map((row) => (
				<tr
					key={row.id}
					className="group relative transition-colors duration-150 hover:bg-hover"
				>
					<RuleCell
						row={row}
						project={project}
						below={`Seen ${times(row.runs)}${row.improvement ? ` · proposed ${since(row.improvement.at)}` : ""}`}
					/>
					<td className="hidden px-5 py-4 align-top text-sm text-fg-2 md:table-cell">
						{capitalized(times(row.runs))}
					</td>
					<td className="tnum hidden px-5 py-4 align-top text-sm whitespace-nowrap text-fg-2 md:table-cell">
						{row.improvement ? since(row.improvement.at) : "—"}
					</td>
					<td className="relative z-10 px-5 py-4 text-right align-top">
						{row.improvement && (
							<a
								href={row.improvement.url}
								target="_blank"
								rel="noreferrer"
								className="btn-ink whitespace-nowrap no-underline"
							>
								Review #{row.improvement.number}
								<ArrowUpRight className="size-3.5" aria-hidden />
							</a>
						)}
					</td>
				</tr>
			))}
		</Table>
	);
}

function LearningTable({
	data,
	project,
}: {
	data: LearningAnswer;
	project: string | undefined;
}) {
	return (
		<Table
			columns={[
				{ label: "Rule" },
				{ label: "Seen", className: "w-36", hint: SEEN_HINT(data.threshold) },
				{ label: "What happens next", className: "w-72" },
			]}
			empty={
				data.candidates.length === 0 ? (
					<Nothing title="Nothing being learned">
						A lesson starts the first time learning sees a mistake. Its rule is
						proposed once it comes back.
					</Nothing>
				) : undefined
			}
		>
			{data.candidates.map((row) => (
				<tr
					key={row.id}
					className="group relative transition-colors duration-150 hover:bg-hover"
				>
					<RuleCell
						row={row}
						project={project}
						below={whatHappensNext(row, data.threshold)}
					/>
					<td className="hidden px-5 py-4 align-top md:table-cell">
						<span className="flex items-center gap-2.5">
							<Pips
								value={row.runs}
								of={data.threshold}
								waits={row.waits !== undefined}
							/>
							<span className="text-sm text-fg-2">
								{capitalized(times(row.runs))}
							</span>
						</span>
					</td>
					<td
						className={`hidden px-5 py-4 align-top text-sm md:table-cell ${row.waits ? "text-warn" : "text-fg-2"}`}
					>
						{whatHappensNext(row, data.threshold)}
					</td>
				</tr>
			))}
		</Table>
	);
}

function LearnedTable({
	data,
	project,
}: {
	data: LearningAnswer;
	project: string | undefined;
}) {
	return (
		<Table
			columns={[
				{ label: "Rule" },
				{ label: "Result", className: "w-56" },
				{ label: "When", className: "w-28 text-right" },
			]}
			empty={
				data.history.length === 0 ? (
					<Nothing title="No rule learned yet">
						A rule is learned once a person merges its pull request on GitHub.
					</Nothing>
				) : undefined
			}
		>
			{[...data.history]
				// Merged first, then declined and ignored under their own headings: the tab counts merged rules only.
				.sort((a, b) => GROUP[a.status] - GROUP[b.status])
				.flatMap((row, i, rows) => {
					const title = HEADING[row.status];
					const heading =
						title && rows[i - 1]?.status !== row.status
							? [
									<tr key={row.status}>
										<td
											colSpan={3}
											className="bg-sunken/50 px-5 py-2 text-xs font-medium text-fg-2"
										>
											{title}{" "}
											<span className="tnum text-fg-3">
												{rows.filter((r) => r.status === row.status).length}
											</span>
										</td>
									</tr>,
								]
							: [];
					// Declined or ignored lessons but no merged rule: say so before their headings.
					const none =
						i === 0 && row.status !== "promoted"
							? [
									<tr key="none">
										<td colSpan={3} className="px-5 py-4 text-sm text-fg-2">
											No rule merged yet.
										</td>
									</tr>,
								]
							: [];
					return [...none, ...heading, learnedRow(row)];
				})}
		</Table>
	);

	function learnedRow(row: Row) {
		const declined = row.status !== "promoted";
		return (
			<tr
				key={row.id}
				className="group relative transition-colors duration-150 hover:bg-hover"
			>
				<RuleCell
					row={row}
					project={project}
					muted={declined}
					below={<Result row={row} />}
				/>
				<td className="hidden px-5 py-4 align-top md:table-cell">
					<Result row={row} />
				</td>
				<td className="tnum hidden px-5 py-4 text-right align-top text-sm whitespace-nowrap text-fg-2 md:table-cell">
					{since(row.resolvedAt ?? row.updatedAt)}
				</td>
			</tr>
		);
	}
}

/** The Learned tab's groups, in order, and the heading above each but the first. */
const GROUP: Record<Row["status"], number> = {
	promoted: 0,
	rejected: 1,
	ignored: 2,
	candidate: 3,
	proposed: 3,
};
const HEADING: Partial<Record<Row["status"], string>> = {
	rejected: "Declined",
	ignored: "Ignored: not the agents' fault",
};

/** What came of a rule, as its lesson's page says it. */
const RESULT: Partial<Record<LessonResult, [string, string]>> = {
	holding: ["bg-ok", "text-ok"],
	"came-back": ["bg-warn", "text-warn"],
	"not-applied": ["bg-fg-3", "text-fg-2"],
	declined: ["bg-fg-3", "text-fg-3"],
	ignored: ["bg-fg-3", "text-fg-3"],
};

function Result({ row }: { row: Row }) {
	const result = lessonResult(row);
	const [dot, tone] = RESULT[result] ?? ["bg-fg-3", "text-fg-2"];
	const text =
		result === "came-back"
			? `Came back ${times(row.cameBack)}`
			: result === "holding"
				? "Holding: not seen since"
				: result === "not-applied"
					? "Merged, not applied yet"
					: result === "declined"
						? "Declined"
						: "Ignored";
	return (
		<span className={`inline-flex items-center gap-2 text-sm ${tone}`}>
			<span className={`size-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
			{text}
		</span>
	);
}

/** The merged rules' line on their card: "2 holding · 1 came back", the parts that are not zero. */
function MergedLine({ parts }: { parts: [number, string, string][] }) {
	return parts
		.filter(([n]) => n > 0)
		.map(([n, words, tone], i) => (
			<span key={words}>
				{i > 0 && <span className="text-fg-3"> · </span>}
				<span className={tone}>
					{n} {words}
				</span>
			</span>
		));
}

function MistakesTable({
	data,
	project,
}: {
	data: LearningAnswer;
	project: string | undefined;
}) {
	return (
		<>
			{/* With learning off too: the mistakes are counted, so the page says which it cannot see. */}
			{data.unheard.length > 0 && (
				<p className="mb-4 flex items-start gap-2 text-sm leading-6 text-fg-2">
					<TriangleAlert
						className="mt-1 size-3.5 shrink-0 text-warn"
						aria-hidden
					/>
					<span>
						{data.unheard.length > 1
							? "Red checks and the changes maintainers request on the factory's pull requests"
							: data.unheard[0] === "pull_request.checks_failed"
								? "Red checks on the factory's pull requests"
								: "Changes maintainers request on the factory's pull requests"}{" "}
						are missed.{" "}
						{data.unheard.length > 1
							? "Each is seen only when an automation of the factory runs on its event:"
							: "They are seen only when an automation of the factory runs on"}{" "}
						{data.unheard.map((event, i) => (
							<span key={event}>
								{i > 0 && " and "}
								{inlineCode(event)}
							</span>
						))}
						.
					</span>
				</p>
			)}
			<Table
				columns={[
					{ label: "Mistake", hint: MISTAKE_HINT },
					{
						label: "Lesson",
						className: "w-[38%]",
						hint: "Each week, learning reads the new mistakes and groups those with the same cause into a lesson. Not studied yet: learning has not read it.",
					},
					{ label: "When", className: "w-24 text-right" },
				]}
				empty={
					data.recent.length === 0 ? (
						<Nothing title="No mistake in the last 30 days">
							A mistake is a check that kept failing, a review or a maintainer
							that asked for changes, or red checks on a pull request the
							factory opened.
						</Nothing>
					) : undefined
				}
			>
				{data.recent.map((f) => {
					const { icon: Icon, tone } = KINDS[f.kind];
					return (
						<tr
							key={f.id}
							className="group relative align-top transition-colors duration-150 hover:bg-hover has-[[data-lesson]:hover]:bg-transparent"
						>
							<td className="px-5 py-3.5">
								<span className="flex items-start gap-3">
									<Icon
										className={`mt-1 size-4 shrink-0 ${tone}`}
										aria-hidden
									/>
									<span className="min-w-0">
										<a
											href={runHref(f.run, { project })}
											title="The run where the mistake happened"
											className="line-clamp-1 text-[15px] leading-6 text-fg no-underline after:absolute after:inset-0"
										>
											{SAID[f.kind]}
										</a>
										<span className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-fg-2">
											<AgentTag name={f.agent} />
											<span aria-hidden className="text-fg-3">
												·
											</span>
											<span className="min-w-0 truncate">
												{f.title ?? f.summary}
											</span>
										</span>
									</span>
								</span>
							</td>
							<td className="relative z-10 hidden px-5 py-3.5 md:table-cell">
								{f.lesson ? (
									<a
										href={learningHref({ project, lesson: f.lesson.id })}
										data-lesson
										title="Open the lesson"
										className="group/lesson -mx-2 -my-1.5 flex items-start gap-1.5 rounded-lg px-2 py-1.5 text-sm text-fg no-underline transition-colors duration-150 hover:bg-hover"
									>
										<span className="line-clamp-2">
											<Code text={f.lesson.rule} />
										</span>
										<ChevronRight
											className="mt-1 size-3.5 shrink-0 text-fg-3 transition-transform duration-200 group-hover/lesson:translate-x-0.5 group-hover/lesson:text-fg-2"
											aria-hidden
										/>
									</a>
								) : (
									<span className="text-sm text-fg-3">Not studied yet</span>
								)}
							</td>
							<td className="tnum hidden px-5 py-3.5 text-right text-sm whitespace-nowrap text-fg-2 md:table-cell">
								{since(f.at)}
							</td>
						</tr>
					);
				})}
			</Table>
			{data.recent.length < data.numbers.failures && (
				<p className="tnum mt-3 text-xs text-fg-3">
					The latest {data.recent.length} of {data.numbers.failures} mistakes.
				</p>
			)}
		</>
	);
}

function Banner({ children }: { children: ReactNode }) {
	return (
		<p className="mb-6 rounded-xl bg-sunken px-5 py-3.5 text-sm leading-6 text-fg-2 ring-1 ring-line">
			{children}
		</p>
	);
}
