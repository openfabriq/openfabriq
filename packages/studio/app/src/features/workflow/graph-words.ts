import {
	HANDOFF_LABEL,
	type WorkflowGraph,
	type WorkflowNode,
} from "@openfabriq/core";
import { capitalized, EVENT_SHORT, eventPhrase } from "../../lib/format.js";

// The workflow's boxes in words: what an event is, what an automation may write.

/** How an event reads in the graph: where work starts, where it lands on a person, or in between. */
export type Role = "start" | "you" | "out" | "pass";

export const roleOf = (n: WorkflowNode): Role =>
	n.entry
		? "start"
		: n.end
			? n.detail === HANDOFF_LABEL
				? "you"
				: "out"
			: "pass";

/** "add_labels (ready-for-agent, needs-info)" → its action and its labels; a merge's conditions, one by one. */
export function permission(can: string): { action: string; labels: string[] } {
	const [, action = can, labels] = can.match(/^(\w+)(?: \((.*)\))?$/) ?? [];
	const separator = action === "merge_pull_request" ? "; " : ", ";
	return { action, labels: labels ? labels.split(separator) : [] };
}

/** "Issue labeled · ready-for-agent". */
export const eventWords = (n: WorkflowNode) =>
	`${EVENT_SHORT[n.title] ?? n.title}${n.detail ? ` · ${n.detail}` : ""}`;

/** "An issue is labeled (ready-for-agent).": the event as a sentence. */
export const eventSentence = (n: WorkflowNode) =>
	`${capitalized(eventPhrase(n.title))}${
		n.detail && n.detail !== "any label" ? ` (${n.detail})` : ""
	}.`;

const SOURCE: Record<string, string> = {
	slack: "Someone in Slack",
	linear: "Someone in Linear",
	sentry: "Sentry",
};

/** The arrows that come into a box. */
export const edgesInto = (graph: WorkflowGraph, id: string) =>
	graph.edges.filter((e) => e.target === id);

/** The arrows that leave a box. */
export const edgesFrom = (graph: WorkflowGraph, id: string) =>
	graph.edges.filter((e) => e.source === id);

/**
 * What can come after an automation: the automations its events start, two arrows away,
 * then the events it writes that end the work.
 */
export function comesNext(graph: WorkflowGraph, id: string): string[] {
	const after = edgesFrom(graph, id).flatMap((e) =>
		edgesFrom(graph, e.target).map((f) => f.target),
	);
	const byId = new Map(graph.nodes.map((n) => [n.id, n]));
	const ends = edgesFrom(graph, id)
		.map((e) => byId.get(e.target))
		.filter((n): n is WorkflowNode => Boolean(n?.end));
	return [...after, ...ends.map((n) => n.id)];
}

/** Who causes an event nothing in the factory produces. */
export const originWords = (n: WorkflowNode) =>
	`${
		n.source
			? `${SOURCE[n.source] ?? n.source}.`
			: n.title === "schedule"
				? "The clock."
				: "A person, or GitHub."
	} Nothing in the factory produces it: work starts here.`;
