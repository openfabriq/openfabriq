import type { AgentHue } from "../../lib/agent-hue.js";
import type { Board, Metrics } from "../../lib/types.js";

// The overview's figures from a project's metrics: what each card shows, in words and numbers.

/** A CSS width: `part` of `whole`, 0% of nothing. */
export const percent = (part: number, whole: number) =>
	whole > 0 ? `${(part / whole) * 100}%` : "0%";

/**
 * The lines of an axis from 0: about four steps of 1, 2 or 5 (times a power of ten), the top
 * at or above `max`. `minStep` keeps the steps whole where a part means nothing (a run, a cent).
 */
export function axisTicks(max: number, minStep = 0): number[] {
	if (max <= 0) return [0, Math.max(minStep, 1)];
	const rough = max / 4;
	const power = 10 ** Math.floor(Math.log10(rough));
	const nice = [1, 2, 5, 10].find((m) => rough <= m * power) ?? 10;
	const step = Math.max(nice * power, minStep);
	const count = Math.ceil(max / step - 1e-9);
	return Array.from({ length: count + 1 }, (_, i) =>
		Number((i * step).toFixed(10)),
	);
}

const STEPPED_IN = [
	{ key: "handoffs", words: ["handed to a person", "handed to a person"] },
	{ key: "failedRuns", words: ["failed run", "failed runs"] },
	{
		key: "refusedOutputs",
		words: ["blocked by the factory's rules", "blocked by the factory's rules"],
	},
] as const;

/** "2 handed to a person · 1 failed run"; a figure made of one part only names it, its number being the figure's. */
const breakdown = (parts: [number, string][]) => {
	const [first, ...rest] = parts;
	return first && rest.length === 0
		? first[1]
		: parts.map(([n, word]) => `${n} ${word}`).join(" · ");
};

/** A share as a whole percent, such as "89%"; undefined of nothing. */
const share = (part: number, whole: number) =>
	whole > 0 ? `${Math.round((part / whole) * 100)}%` : undefined;

/** The productivity cards' lines: what each figure is made of, only what is not zero. */
export function productivity(m: Metrics) {
	const { opened, merged, closed, unknown } = m.pullRequests;
	const open = opened - merged - closed - unknown;
	const { finished, autonomous } = m.autonomy;
	const issues = m.issues;
	const { outputs } = m;
	return {
		/** The finished runs nobody had to step in, "89%", and of how many. */
		autonomy: share(autonomous, finished),
		autonomyWords:
			finished > 0 ? `${autonomous} of ${finished} finished runs` : "",
		/** The merged share of the pull requests a person decided on, "82%"; the open ones are not counted. */
		mergeRate: share(merged, merged + closed),
		mergeRateWords: [
			merged + closed > 0 && `${merged} of ${merged + closed} decided`,
			open > 0 && `${open} still open, not counted`,
		]
			.filter(Boolean)
			.join(" · "),
		/** "of 27 an agent opened a pull request for". */
		issuesWords:
			issues.attempted > 0
				? `of ${issues.attempted} an agent opened a pull request for`
				: "",
		/** "2 handed to a person · 1 failed run". */
		steppedInWords: breakdown(
			STEPPED_IN.filter((s) => m.interventions[s.key] > 0).map((s) => {
				const n = m.interventions[s.key];
				return [n, s.words[n === 1 ? 0 : 1]];
			}),
		),
		/** The applied outputs, most first. */
		outputs,
		applied: outputs.reduce((sum, a) => sum + a.count, 0),
	};
}

/** Who spent the money: each agent that spent or ran, in its color, then the chat when it spent. */
export function spendingParts(m: Metrics, agentHue: AgentHue) {
	return [
		...m.cost.byAgent.map((a) => ({
			key: a.agent,
			value: a.usd,
			runs: a.runs as number | undefined,
			color: agentHue(a.agent),
		})),
		{
			key: "chat",
			value: m.cost.chatUsd,
			runs: undefined,
			color: "var(--fg-3)",
		},
	].filter((p) => p.value > 0 || p.runs);
}

/** What a unit of work cost; undefined when there is no such unit yet. */
export function costRatios(m: Metrics) {
	const { merged } = m.pullRequests;
	return {
		/** The agents' cost, without the chat. */
		perRun:
			m.runs.total > 0
				? (m.cost.totalUsd - m.cost.chatUsd) / m.runs.total
				: undefined,
		perMergedPr: merged > 0 ? m.cost.totalUsd / merged : undefined,
		/** The agents' cost, without the chat, per hour they spent working. */
		perAgentHour:
			m.agentTimeMs > 0
				? (m.cost.totalUsd - m.cost.chatUsd) / (m.agentTimeMs / 3_600_000)
				: undefined,
	};
}

const OUTCOMES = [
	{ key: "merged", label: "Merged pull requests", color: "var(--ok)" },
	{ key: "open", label: "Pull requests still open", color: "var(--accent)" },
	{ key: "closed", label: "Closed without merge", color: "var(--bad)" },
	{ key: "failed", label: "Failed runs", color: "var(--warn)" },
	{ key: "other", label: "Other work", color: "var(--fg-2)" },
] as const;

/** Where the money went: the runs' cost by what came of their work, then the chat; only what spent. */
export function outcomeParts(m: Metrics) {
	return [
		...OUTCOMES.map((o) => ({ ...o, value: m.cost.byOutcome[o.key] })),
		{
			key: "chat",
			label: "Chat",
			color: "var(--fg-3)",
			value: m.cost.chatUsd,
		},
	].filter((p) => p.value > 0);
}

type Day = Metrics["byDay"][number];

/**
 * Day by day, the share of the finished runs that needed nobody, and of those that succeeded, over the
 * `window` days up to that day (fewer at the start of the period); undefined while none has finished.
 */
export function rollingRates(byDay: Day[], window = 7) {
	return byDay.map((d, i) => {
		const span = byDay.slice(Math.max(0, i - window + 1), i + 1);
		const sum = (key: "finished" | "succeeded" | "autonomous") =>
			span.reduce((total, x) => total + x[key], 0);
		const finished = sum("finished");
		return {
			day: d.day,
			finished,
			autonomy: finished > 0 ? sum("autonomous") / finished : undefined,
			success: finished > 0 ? sum("succeeded") / finished : undefined,
		};
	});
}

/** The factory's pull requests opened and merged since the start of the period, day by day. */
export function cumulativePullRequests(byDay: Day[]) {
	let opened = 0;
	let merged = 0;
	return byDay.map((d) => {
		opened += d.opened;
		merged += d.merged;
		return { day: d.day, opened, merged };
	});
}

/** How many of the project's cards wait for a person; undefined until the board is read. */
export const waitingFor = (board: Board | undefined, repository: string) =>
	board?.stages
		.find((s) => s.id === "needs-you")
		?.cards.filter((c) => c.run.repository === repository).length;

/**
 * The runs per day of the chart: every agent's, cut in parts by agent (the same order each day,
 * so an agent keeps its place in the column), or one agent's when the filter names it.
 */
export function runsPerDay(
	byDay: { day: string; runs: number; agents: Record<string, number> }[],
	agent?: string,
): { day: string; value: number; parts?: { key: string; value: number }[] }[] {
	if (agent)
		return byDay.map((d) => ({ day: d.day, value: d.agents[agent] ?? 0 }));
	const order = [
		...new Set(byDay.flatMap((d) => Object.keys(d.agents))),
	].sort();
	return byDay.map((d) => ({
		day: d.day,
		value: d.runs,
		parts: order.flatMap((a) => {
			const value = d.agents[a] ?? 0;
			return value > 0 ? [{ key: a, value }] : [];
		}),
	}));
}
