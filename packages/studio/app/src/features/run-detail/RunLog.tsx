import { useState } from "react";
import { runHref } from "../../lib/route.js";
import type { RunDetail } from "../../lib/types.js";
import { replacedProposals } from "./produced.js";
import { EntryRow, Row, Working } from "./RunLogRows.js";
import {
	type Filter,
	filterTabs,
	logEntries,
	matches,
	toolCalls,
	working,
} from "./run-log.js";

/** Everything the run did, in order, on one clock that starts when it was queued. */
export function RunLog({
	detail,
	project,
}: {
	detail: RunDetail;
	/** The page's project, kept in the links so they never rescope the app. */
	project: string | undefined;
}) {
	const [filter, setFilter] = useState<Filter>("all");
	const { run } = detail;
	const all = logEntries(detail);
	// Keyed by what each row shows, so a filter or a growing log never reuses another row's state.
	const shown = all
		.map((e, i) => ({
			e,
			key: e.kind === "tool" ? e.part.toolCallId : `${e.kind}-${i}`,
		}))
		.filter(({ e }) => matches(filter)(e));
	const outputsHref = runHref(run.id, { project, tab: "outputs" });
	const filters = filterTabs(all);
	const now = working(detail);
	const replaced = replacedProposals(
		toolCalls(detail.transcript),
		Boolean(detail.reviews?.length),
	);

	return (
		<div>
			<fieldset className="mb-4 flex flex-wrap items-center gap-1.5">
				<legend className="sr-only">Show</legend>
				{filters.map((f) => (
					<button
						key={f.id}
						type="button"
						aria-pressed={filter === f.id}
						onClick={() => setFilter(f.id)}
						className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors duration-150 ${filter === f.id ? "border-line-2 bg-panel text-fg shadow-1" : "border-transparent text-fg-2 hover:text-fg"} ${f.id === "errors" && filter !== f.id ? "text-bad" : ""}`}
					>
						{f.label}
						<span className="tnum text-fg-3">{f.n}</span>
					</button>
				))}
			</fieldset>
			<ol className="panel px-2 py-2 sm:px-3">
				{shown.map(({ e, key }) => (
					<EntryRow
						key={key}
						e={e}
						run={run}
						outputsHref={outputsHref}
						replaced={e.kind === "tool" && replaced.has(e.part.toolCallId)}
					/>
				))}
				{now && (
					<Row
						time=""
						icon={
							<span className="relative flex size-2" aria-hidden>
								<span
									className="absolute inset-0 rounded-full bg-accent opacity-60"
									style={{
										animation: "ping-dot 1.4s cubic-bezier(0,0,0.2,1) infinite",
									}}
								/>
								<span className="relative size-2 rounded-full bg-accent" />
							</span>
						}
					>
						<Working {...now} />
					</Row>
				)}
				{shown.length === 0 && (
					<li className="px-3 py-6 text-center text-sm text-fg-2">
						Nothing of this kind in this run.
					</li>
				)}
			</ol>
		</div>
	);
}
