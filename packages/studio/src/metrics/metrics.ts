import type { Action } from "@openfabriq/core";
import type { RunRecord } from "@openfabriq/runner";
import { subjectUrl } from "../board/board.js";
import { byEngineHandoff, handedOver, isLinkNotice } from "../runs/story.js";
import type { SubjectState, SubjectStates } from "../subjects/subject-state.js";

export const PERIODS = ["7d", "30d", "all"] as const;
export type Period = (typeof PERIODS)[number];

/** One chat message's cost (the chat spends the subscription too). */
export interface ChatCost {
	at: string;
	costUsd: number;
}

export interface Metrics {
	period: Period;
	/** First day counted, YYYY-MM-DD in the machine's time zone; absent for "all" without runs or chats. */
	since?: string;
	runs: {
		total: number;
		succeeded: number;
		failed: number;
		skipped: number;
		active: number;
	};
	averageDurationMs?: number;
	/** Time the agents spent working, all finished runs together. */
	agentTimeMs: number;
	/** The finished runs (succeeded or failed), and those nobody had to step in: no failure, handoff or refused output. */
	autonomy: { finished: number; autonomous: number };
	cost: {
		totalUsd: number;
		chatUsd: number;
		byAgent: { agent: string; usd: number; runs: number }[];
		/**
		 * What came of the money the runs spent, the chat apart: the work on a pull request the factory opened,
		 * by what became of it; the failed runs; and the rest (triage, comments, reviews of other pull requests).
		 */
		byOutcome: {
			merged: number;
			open: number;
			closed: number;
			failed: number;
			other: number;
		};
	};
	/** Each day of the period. `agents`: the runs of each agent that day, an agent without one left out. */
	byDay: {
		day: string;
		usd: number;
		runs: number;
		agents: Record<string, number>;
		/** Of the day's runs, those finished, those that succeeded and those nobody had to step in. */
		finished: number;
		succeeded: number;
		autonomous: number;
		/** The factory's pull requests opened that day, and those of them merged that day. */
		opened: number;
		merged: number;
	}[];
	pullRequests: {
		opened: number;
		merged: number;
		/** Closed without a merge: a person turned the work down. */
		closed: number;
		unknown: number;
	};
	/**
	 * The issues (GitHub, Linear, Sentry) an agent opened a pull request for, and those resolved: one
	 * of those pull requests was merged.
	 */
	issues: { attempted: number; resolved: number };
	interventions: {
		total: number;
		handoffs: number;
		failedRuns: number;
		refusedOutputs: number;
	};
	/** The outputs the engine applied for the agents, by action, most first. */
	outputs: { action: Action; count: number }[];
}

/** YYYY-MM-DD of a date in the machine's time zone, like `costToday` in the runner. */
const localDay = (date: Date) => date.toLocaleDateString("sv-SE");

function days(from: Date, to: Date): string[] {
	const out: string[] = [];
	const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
	while (day <= to) {
		out.push(localDay(day));
		day.setDate(day.getDate() + 1);
	}
	return out;
}

/** The pull requests the factory opened: applied `create_pull_request` outputs, by URL. */
export function pullRequestUrls(runs: RunRecord[]): string[] {
	return [
		...new Set(
			runs.flatMap((r) =>
				r.outputs
					.filter(
						(o) =>
							o.action === "create_pull_request" &&
							o.status === "applied" &&
							o.url,
					)
					.map((o) => o.url as string),
			),
		),
	];
}

/** A run counts on the day it ended, like the daily cost limit (`costToday`); queued, until then. */
const when = (r: RunRecord) => r.endedAt ?? r.queuedAt;

/** A pull request GitHub says was closed without a merge. */
const closedUnmerged = (state: SubjectState | undefined) =>
	state !== undefined && !state.merged && !state.open;

/** The outputs applied for the agent: not the engine's own handoff or link notes. */
const applied = (r: RunRecord) =>
	r.outputs.filter(
		(o) => o.status === "applied" && !byEngineHandoff(r, o) && !isLinkNotice(o),
	);

/** A finished run nobody had to step in: it succeeded, was not handed over, and had no output refused. */
const autonomous = (r: RunRecord) =>
	r.status === "succeeded" &&
	!handedOver(r) &&
	!r.outputs.some((o) => o.status === "refused");

/** The pull request a run worked on: the one it opened or pushed to, or its subject. */
const pullRequestOf = (r: RunRecord) =>
	r.outputs.find(
		(o) =>
			(o.action === "create_pull_request" ||
				o.action === "push_to_pull_request") &&
			o.status === "applied" &&
			o.url,
	)?.url ?? (r.isPullRequest ? r.url : undefined);

/** The first day counted: "all" starts at midnight of the first run or chat message, so none of them is left out. */
function periodStart(
	runs: RunRecord[],
	chats: ChatCost[],
	period: Period,
	now: Date,
): Date | undefined {
	const from =
		period === "all"
			? [...runs.map(when), ...chats.map((c) => c.at)]
					.map((iso) => new Date(iso))
					.reduce<Date | undefined>((a, b) => (!a || b < a ? b : a), undefined)
			: now;
	const back = period === "all" ? 0 : period === "7d" ? 6 : 29;
	return (
		from && new Date(from.getFullYear(), from.getMonth(), from.getDate() - back)
	);
}

/** The runs a period shows: the pull requests GitHub is asked about are theirs only. */
export function runsInPeriod(
	runs: RunRecord[],
	period: Period,
	now: Date,
): RunRecord[] {
	const start =
		period === "all" ? undefined : periodStart(runs, [], period, now);
	return start ? runs.filter((r) => new Date(when(r)) >= start) : runs;
}

type Day = Omit<Metrics["byDay"][number], "day">;

/** Each day of the period: what its runs and chat messages cost, its runs by agent and how they ended, the pull requests opened and merged. */
function dayBuckets(
	start: Date | undefined,
	now: Date,
	runs: RunRecord[],
	chats: ChatCost[],
	states: SubjectStates,
): Metrics["byDay"] {
	const byDay = new Map<string, Day>(
		(start ? days(start, now) : []).map((d) => [
			d,
			{
				usd: 0,
				runs: 0,
				agents: {},
				finished: 0,
				succeeded: 0,
				autonomous: 0,
				opened: 0,
				merged: 0,
			},
		]),
	);
	const dayOf = (iso: string) => byDay.get(localDay(new Date(iso)));
	const opened = new Set<string>();
	for (const r of runs) {
		const day = dayOf(when(r));
		if (!day) continue;
		day.usd += r.costUsd ?? 0;
		day.runs += 1;
		day.agents[r.agent] = (day.agents[r.agent] ?? 0) + 1;
		if (r.status === "succeeded" || r.status === "failed") day.finished += 1;
		if (r.status === "succeeded") day.succeeded += 1;
		if (autonomous(r)) day.autonomous += 1;
		for (const url of pullRequestUrls([r]))
			if (!opened.has(url)) {
				opened.add(url);
				day.opened += 1;
			}
	}
	for (const c of chats) {
		const day = dayOf(c.at);
		if (day) day.usd += c.costUsd;
	}
	for (const url of opened) {
		const mergedAt = states[url]?.mergedAt;
		const mergedOn = mergedAt && dayOf(mergedAt);
		if (mergedOn) mergedOn.merged += 1;
	}
	return [...byDay].map(([day, d]) => ({ day, ...d }));
}

function runCounts(runs: RunRecord[]): Metrics["runs"] {
	const count = (status: RunRecord["status"]) =>
		runs.filter((r) => r.status === status).length;
	return {
		total: runs.length,
		succeeded: count("succeeded"),
		failed: count("failed"),
		skipped: count("skipped"),
		active: count("queued") + count("running"),
	};
}

/** The most expensive agent first. */
function costByAgent(runs: RunRecord[]): Metrics["cost"]["byAgent"] {
	const byAgent = new Map<string, { usd: number; runs: number }>();
	for (const r of runs) {
		const agent = byAgent.get(r.agent) ?? { usd: 0, runs: 0 };
		agent.usd += r.costUsd ?? 0;
		agent.runs += 1;
		byAgent.set(r.agent, agent);
	}
	return [...byAgent]
		.map(([agent, v]) => ({ agent, ...v }))
		.sort((a, b) => b.usd - a.usd || b.runs - a.runs);
}

function costByOutcome(
	runs: RunRecord[],
	states: SubjectStates,
): Metrics["cost"]["byOutcome"] {
	const out = { merged: 0, open: 0, closed: 0, failed: 0, other: 0 };
	for (const r of runs) {
		const url = pullRequestOf(r);
		const state = url ? states[url] : undefined;
		const outcome =
			r.status === "failed"
				? "failed"
				: !state
					? "other"
					: state.merged
						? "merged"
						: state.open
							? "open"
							: "closed";
		out[outcome] += r.costUsd ?? 0;
	}
	return out;
}

function pullRequestsOf(
	runs: RunRecord[],
	states: SubjectStates,
): Metrics["pullRequests"] {
	const urls = pullRequestUrls(runs);
	return {
		opened: urls.length,
		merged: urls.filter((u) => states[u]?.merged).length,
		closed: urls.filter((u) => closedUnmerged(states[u])).length,
		unknown: urls.filter((u) => !states[u]).length,
	};
}

function interventionsOf(runs: RunRecord[]): Metrics["interventions"] {
	// A failed run is already one intervention; the engine's handoff after it is not another.
	const handoffs = runs.filter(
		(r) => r.status !== "failed" && handedOver(r),
	).length;
	const failedRuns = runs.filter((r) => r.status === "failed").length;
	const refusedOutputs = runs
		.flatMap((r) => r.outputs)
		.filter((o) => o.status === "refused").length;
	return {
		total: handoffs + failedRuns + refusedOutputs,
		handoffs,
		failedRuns,
		refusedOutputs,
	};
}

/** Each issue (GitHub, Linear, Sentry) a run opened pull requests for, and whether one of them was merged. */
function issuesOf(runs: RunRecord[], states: SubjectStates): Metrics["issues"] {
	const merged = new Map<string, boolean>();
	for (const r of runs) {
		const issue = r.isPullRequest ? undefined : subjectUrl(r);
		const opened = applied(r).flatMap((o) =>
			o.action === "create_pull_request" && o.url ? [o.url] : [],
		);
		if (!issue || opened.length === 0) continue;
		merged.set(
			issue,
			(merged.get(issue) ?? false) || opened.some((u) => states[u]?.merged),
		);
	}
	return {
		attempted: merged.size,
		resolved: [...merged.values()].filter(Boolean).length,
	};
}

function outputsOf(runs: RunRecord[]): Metrics["outputs"] {
	const counts = new Map<Action, number>();
	for (const o of runs.flatMap(applied))
		counts.set(o.action, (counts.get(o.action) ?? 0) + 1);
	return [...counts]
		.map(([action, count]) => ({ action, count }))
		.sort((a, b) => b.count - a.count);
}

/** Runs (latest first or not) → the numbers of one project, or of all, over a period. */
export function computeMetrics(
	runs: RunRecord[],
	period: Period,
	now: Date,
	/** The states of the factory's pull requests. */
	states: SubjectStates = {},
	chats: ChatCost[] = [],
): Metrics {
	const start = periodStart(runs, chats, period, now);
	const inPeriod = (iso: string) => !start || new Date(iso) >= start;
	const shown = runs.filter((r) => inPeriod(when(r)));
	const shownChats = chats.filter((c) => inPeriod(c.at));
	const chatUsd = shownChats.reduce((sum, c) => sum + c.costUsd, 0);
	const durations = shown.flatMap((r) =>
		r.durationMs !== undefined && r.status !== "skipped" ? [r.durationMs] : [],
	);
	const finished = shown.filter(
		(r) => r.status === "succeeded" || r.status === "failed",
	);

	return {
		period,
		...(start ? { since: localDay(start) } : {}),
		runs: runCounts(shown),
		...(durations.length
			? {
					averageDurationMs: Math.round(
						durations.reduce((a, b) => a + b, 0) / durations.length,
					),
				}
			: {}),
		agentTimeMs: durations.reduce((a, b) => a + b, 0),
		autonomy: {
			finished: finished.length,
			autonomous: finished.filter(autonomous).length,
		},
		cost: {
			totalUsd: shown.reduce((sum, r) => sum + (r.costUsd ?? 0), 0) + chatUsd,
			chatUsd,
			byAgent: costByAgent(shown),
			byOutcome: costByOutcome(shown, states),
		},
		byDay: dayBuckets(start, now, shown, shownChats, states),
		pullRequests: pullRequestsOf(shown, states),
		issues: issuesOf(shown, states),
		interventions: interventionsOf(shown),
		outputs: outputsOf(shown),
	};
}
