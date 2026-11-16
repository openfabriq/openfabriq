import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { useAgentHue } from "../../hooks/use-agent-hue.js";
import { ACTION_WORDS } from "../../lib/format.js";
import type { Metrics } from "../../lib/types.js";
import {
	Card,
	Figure,
	HelpNote,
	Lines,
	none,
	PerDay,
	Shares,
} from "./charts.js";
import {
	cumulativePullRequests,
	percent,
	productivity,
	rollingRates,
	runsPerDay,
} from "./overview-figures.js";

const runs = (n: number) => `${n} ${n === 1 ? "run" : "runs"}`;
const rate = (v: number) => `${Math.round(v * 100)}%`;

/** A figure's share, as a bar at the bottom of its card; nothing while there is nothing to share. */
function Bar({ label, parts }: Parameters<typeof Shares>[0]) {
	if (parts.every((p) => p.value <= 0)) return null;
	return (
		<div className="mt-auto pt-3">
			<Shares label={label} parts={parts} />
		</div>
	);
}

/** What the factory did: its runs, what they turned into, and where humans intervened. */
export function Productivity({
	m,
	waiting,
	board,
}: {
	m: Metrics;
	/** Cards waiting for a person now; undefined until the board is read. */
	waiting: number | undefined;
	board: string;
}) {
	const agentHue = useAgentHue();
	const p = productivity(m);
	const most = p.outputs[0]?.count ?? 0;
	const { finished, autonomous } = m.autonomy;
	const { merged, closed } = m.pullRequests;
	const [agent, setAgent] = useState("");
	const agents = [
		...new Set(m.byDay.flatMap((d) => Object.keys(d.agents))),
	].sort();
	// An agent with no run in the new period falls back to all of them.
	const shown = agents.includes(agent) ? agent : "";
	const days = m.byDay.map((d) => d.day);
	const rates = rollingRates(m.byDay);
	const pulls = cumulativePullRequests(m.byDay);
	return (
		<>
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<Card
					title="Autonomy"
					note={
						<HelpNote label="How autonomy is counted">
							A finished run needed nobody when it succeeded, was not handed to
							a person, and the factory's rules blocked nothing it proposed.
						</HelpNote>
					}
				>
					<Figure value={p.autonomy ?? none}>
						{p.autonomyWords && `${p.autonomyWords} needed nobody`}
					</Figure>
					<Bar
						label={p.autonomyWords}
						parts={[
							{ key: "autonomous", value: autonomous, color: "var(--ok)" },
							{
								key: "rest",
								value: finished - autonomous,
								color: "transparent",
							},
						]}
					/>
				</Card>
				<Card
					title="Merge rate"
					note={
						<HelpNote label="How the merge rate is counted">
							Of the factory's pull requests a person decided on, the share
							merged rather than closed without merge. Those still open are not
							counted yet.
						</HelpNote>
					}
				>
					<Figure value={p.mergeRate ?? none}>{p.mergeRateWords}</Figure>
					<Bar
						label={p.mergeRateWords}
						parts={[
							{ key: "merged", value: merged, color: "var(--ok)" },
							{ key: "closed", value: closed, color: "var(--bad)" },
						]}
					/>
				</Card>
				<Card
					title="Issues resolved"
					note={
						<HelpNote label="How resolved issues are counted">
							An issue counts once an agent opened a pull request for it, and is
							resolved once one of them is merged. Issues only triaged or
							commented on are left out.
						</HelpNote>
					}
				>
					<Figure value={m.issues.resolved}>{p.issuesWords}</Figure>
					<Bar
						label={`${m.issues.resolved} resolved of ${m.issues.attempted}`}
						parts={[
							{
								key: "resolved",
								value: m.issues.resolved,
								color: "var(--accent)",
							},
							{
								key: "rest",
								value: m.issues.attempted - m.issues.resolved,
								color: "transparent",
							},
						]}
					/>
				</Card>
				<Card title="Human interventions">
					<Figure value={m.interventions.total}>{p.steppedInWords}</Figure>
					{waiting !== undefined && (
						<div className="mt-auto pt-3">
							{waiting > 0 ? (
								<a
									href={board}
									className="group flex items-center justify-between gap-2 rounded-lg bg-warn-soft px-3 py-1.5 text-xs font-medium text-fg no-underline transition-colors duration-150 hover:bg-warn/20"
								>
									<span>
										<span className="tnum">{waiting}</span> waiting for you
									</span>
									<ArrowRight
										className="size-3.5 shrink-0 text-fg-2 transition-transform duration-150 group-hover:translate-x-0.5"
										aria-hidden
									/>
								</a>
							) : (
								<p className="flex items-center gap-1.5 text-xs text-fg-2">
									<Check className="size-3.5 text-ok" aria-hidden />
									Nothing waits for you
								</p>
							)}
						</div>
					)}
				</Card>
			</div>
			<div className="mt-3 grid gap-3 lg:grid-cols-2">
				<Card
					title="Runs per day"
					action={
						agents.length > 1 && (
							<select
								aria-label="Agent"
								className="select h-7 text-xs"
								value={shown}
								onChange={(e) => setAgent(e.target.value)}
							>
								<option value="">All agents</option>
								{agents.map((a) => (
									<option key={a} value={a}>
										{a}
									</option>
								))}
							</select>
						)
					}
				>
					<div className="mt-4 flex flex-1 flex-col">
						<PerDay
							days={runsPerDay(m.byDay, shown || undefined)}
							format={runs}
							minStep={1}
							color={shown ? agentHue(shown) : "var(--ok)"}
							partColor={agentHue}
						/>
					</div>
				</Card>
				<Card title="Autonomy and success, 7-day average">
					<div className="mt-4 flex flex-1 flex-col">
						<Lines
							days={days}
							max={1}
							format={rate}
							detail={(i) => `${runs(rates[i]?.finished ?? 0)} finished`}
							series={[
								{
									key: "autonomy",
									label: "Runs that needed nobody",
									color: "var(--ok)",
									fill: "var(--ok-soft)",
									values: rates.map((r) => r.autonomy),
								},
								{
									key: "success",
									label: "Runs that succeeded",
									color: "var(--accent)",
									dashed: true,
									values: rates.map((r) => r.success),
								},
							]}
						/>
					</div>
				</Card>
				<Card title="Pull requests, cumulative">
					<div className="mt-4 flex flex-1 flex-col">
						<Lines
							days={days}
							minStep={1}
							format={String}
							note="the gap: still open, or closed without merge"
							series={[
								{
									key: "merged",
									label: "Merged",
									total: String(pulls.at(-1)?.merged ?? 0),
									color: "var(--accent)",
									fill: "var(--accent-soft)",
									values: pulls.map((d) => d.merged),
								},
								{
									key: "opened",
									label: "Opened",
									total: String(pulls.at(-1)?.opened ?? 0),
									color: "var(--fg-3)",
									values: pulls.map((d) => d.opened),
								},
							]}
						/>
					</div>
				</Card>
				<Card title="Actions taken">
					{p.applied === 0 ? (
						<p className="mt-2 text-sm text-fg-2">No action yet.</p>
					) : (
						<>
							<Figure value={p.applied}>by the engine, for the agents</Figure>
							<ul className="tnum mt-4 space-y-2.5 text-[13px]">
								{p.outputs.map((a) => (
									<li
										key={a.action}
										className="grid grid-cols-[minmax(0,10rem)_1fr_2.5rem] items-center gap-3"
									>
										<span className="truncate text-fg-2">
											{ACTION_WORDS[a.action] ?? a.action}
										</span>
										<span className="h-1.5 rounded-full bg-sunken">
											<span
												className="block h-full rounded-full bg-ok/70"
												style={{ width: percent(a.count, most) }}
											/>
										</span>
										<span className="text-right font-medium text-fg">
											{a.count}
										</span>
									</li>
								))}
							</ul>
						</>
					)}
				</Card>
			</div>
		</>
	);
}
