import type { ReactNode } from "react";
import { AgentTag } from "../../components/badges.js";
import { useAgentHue } from "../../hooks/use-agent-hue.js";
import { duration, money } from "../../lib/format.js";
import type { Metrics } from "../../lib/types.js";
import { Card, Figure, HelpNote, none, PerDay, Shares } from "./charts.js";
import { costRatios, outcomeParts, spendingParts } from "./overview-figures.js";

/** A bar cut in parts and the list of them under it: what a sum is made of. */
function Breakdown({
	parts,
}: {
	parts: {
		key: string;
		value: number;
		color: string;
		name: ReactNode;
		runs?: number | undefined;
	}[];
}) {
	return (
		<>
			<div className="mt-4">
				<Shares
					label={parts.map((p) => `${p.key} ${money(p.value)}`).join(", ")}
					parts={parts}
				/>
			</div>
			<ul className="tnum mt-3 divide-y divide-line text-[13px]">
				{parts.map((p) => (
					<li
						key={p.key}
						className="flex items-baseline justify-between gap-3 py-1.5"
					>
						{p.name}
						<span className="shrink-0 text-fg">
							{p.runs !== undefined && (
								<span className="mr-3 text-2xs text-fg-3">
									{p.runs} {p.runs === 1 ? "run" : "runs"}
								</span>
							)}
							{money(p.value)}
						</span>
					</li>
				))}
			</ul>
		</>
	);
}

const Swatch = ({ color, children }: { color: string; children: string }) => (
	<span className="inline-flex items-center gap-1.5 text-fg-2">
		<span
			aria-hidden
			className="size-2 shrink-0 rounded-[3px]"
			style={{ background: color }}
		/>
		{children}
	</span>
);

/** What the factory spent: in all, per unit of work, per day, who spent it, and on what. */
export function Spending({ m }: { m: Metrics }) {
	const agents = spendingParts(m, useAgentHue());
	const outcomes = outcomeParts(m);
	const cost = costRatios(m);
	const { merged } = m.pullRequests;
	return (
		<>
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<Card
					title="Spent"
					note={
						<HelpNote label="What spent means on a subscription">
							On a subscription, nothing is billed per token. This is what the
							same tokens would cost on the API: a measure of how much of your
							quota the factory uses.
						</HelpNote>
					}
				>
					<Figure value={money(m.cost.totalUsd)}>
						{m.cost.chatUsd > 0
							? `${money(m.cost.chatUsd)} of it in chat`
							: "agents and chat"}
					</Figure>
				</Card>
				<Card title="Cost per run">
					<Figure value={cost.perRun === undefined ? none : money(cost.perRun)}>
						{m.averageDurationMs !== undefined &&
							`${duration(m.averageDurationMs)} on average`}
					</Figure>
				</Card>
				<Card title="Cost per merged PR">
					<Figure
						value={
							cost.perMergedPr === undefined ? none : money(cost.perMergedPr)
						}
					>
						{merged > 0 &&
							`all costs, chat and triage included · ${merged} merged`}
					</Figure>
				</Card>
				<Card title="Cost per agent hour">
					<Figure
						value={
							cost.perAgentHour === undefined ? none : money(cost.perAgentHour)
						}
					>
						{m.agentTimeMs > 0 && `${duration(m.agentTimeMs)} of agent work`}
					</Figure>
				</Card>
			</div>
			<Card title="Cost per day" className="mt-3">
				<div className="mt-4 flex flex-1 flex-col">
					<PerDay
						days={m.byDay.map((d) => ({
							day: d.day,
							value: d.usd,
							runs: d.runs,
						}))}
						format={(v) => money(v).replace("< ", "")}
						color="var(--accent)"
						unit="spent"
						minStep={0.01}
					/>
				</div>
			</Card>
			<div className="mt-3 grid gap-3 lg:grid-cols-2">
				<Card title="Cost per agent">
					{agents.length === 0 ? (
						<p className="mt-2 text-sm text-fg-2">Nothing spent yet.</p>
					) : (
						<Breakdown
							parts={agents.map((p) => ({
								...p,
								name:
									p.key === "chat" ? (
										<Swatch color="var(--fg-3)">Chat</Swatch>
									) : (
										<AgentTag name={p.key} className="text-[13px]" />
									),
							}))}
						/>
					)}
				</Card>
				<Card title="Where the money went">
					{outcomes.length === 0 ? (
						<p className="mt-2 text-sm text-fg-2">Nothing spent yet.</p>
					) : (
						<>
							<Breakdown
								parts={outcomes.map((p) => ({
									...p,
									name: <Swatch color={p.color}>{p.label}</Swatch>,
								}))}
							/>
							<p className="mt-3 text-xs text-pretty text-fg-3">
								A run counts for the pull request it opened, pushed to or
								reviewed. Other work: triage, comments, reviews of other pull
								requests.
							</p>
						</>
					)}
				</Card>
			</div>
		</>
	);
}
