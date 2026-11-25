import type { Factory } from "@openfabriq/core";
import type { AgentResult } from "../agent/port.js";
import type { QueuedRun } from "../engine/queue.js";
import type { RunRecord } from "../state/journal.js";
import type { SubjectRead } from "./subject.js";

/** Where a run comes from, for people: the journal and the app show it. */
function runSource(
	run: QueuedRun,
	factory: Factory | undefined,
): NonNullable<RunRecord["source"]> {
	const source = run.event.source;
	if (source?.kind === "slack")
		return {
			kind: "slack",
			label: `#${factory?.slack?.channel ?? source.channel}`,
		};
	if (source?.kind === "linear")
		return { kind: "linear", label: source.identifier, url: source.url };
	if (source?.kind === "sentry")
		return { kind: "sentry", label: source.shortId, url: source.url };
	if (source?.kind === "webhook")
		return { kind: "webhook", label: source.webhook };
	return {
		kind: "github",
		label: run.number === undefined ? run.repository : `#${run.number}`,
	};
}

/**
 * What the journal knows of a run from its queue entry: the same at queued, running and ended.
 * `fallbackQueuedAt` stands in for a run queued before the queue kept the time.
 */
export function baseRecord(
	run: QueuedRun,
	factory: Factory | undefined,
	fallbackQueuedAt: string,
): RunRecord {
	return {
		id: run.id,
		repository: run.repository,
		automation: run.automation,
		agent: factory?.automations[run.automation]?.agent ?? "",
		event: run.event.event,
		...(run.event.label ? { label: run.event.label } : {}),
		...(run.number !== undefined ? { number: run.number } : {}),
		isPullRequest: run.event.isPullRequest,
		...(run.event.key.startsWith("manual:")
			? { manual: run.event.actor }
			: run.event.event === "schedule"
				? { scheduledFor: run.event.at }
				: {}),
		...(run.untrusted ? { untrusted: true } : {}),
		status: "queued",
		queuedAt: run.queuedAt ?? fallbackQueuedAt,
		outputs: [],
		source: runSource(run, factory),
	};
}

/** The record once its subject is read: its title and link, and a Slack thread's link as its source's. */
export function titled(
	record: RunRecord,
	read: Pick<SubjectRead, "title" | "url" | "sourceUrl">,
): RunRecord {
	return {
		...record,
		...(read.title !== undefined ? { title: read.title } : {}),
		...(read.url !== undefined ? { url: read.url } : {}),
		...(read.sourceUrl && record.source
			? { source: { ...record.source, url: read.sourceUrl } }
			: {}),
	};
}

/** The record of a run that ended at `at`: its status, why, and how long it took. */
export function ended(
	record: RunRecord,
	status: RunRecord["status"],
	reason: string | undefined,
	at: Date,
): RunRecord {
	return {
		...record,
		status,
		...(reason ? { reason } : {}),
		endedAt: at.toISOString(),
		durationMs: at.getTime() - new Date(record.startedAt ?? at).getTime(),
	};
}

/** What the agent's run cost, for the journal. */
export function agentCost(
	result: AgentResult,
): Pick<
	RunRecord,
	"costUsd" | "turns" | "tokens" | "model" | "mcpUnavailable"
> {
	return {
		costUsd: result.costUsd,
		turns: result.turns,
		tokens: result.tokens,
		...(result.model ? { model: result.model } : {}),
		...(result.mcpUnavailable ? { mcpUnavailable: result.mcpUnavailable } : {}),
	};
}
