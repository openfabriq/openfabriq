import type { TranscriptPart } from "../../../../src/runs/transcript.js";
import { isOutput } from "../../components/assistant-ui/tool-parts.js";
import type { ReviewRound, RunDetail, RunRecord } from "../../lib/types.js";

export type ToolCall = Extract<TranscriptPart, { type: "tool-call" }>;

export const isOutputCall = (p: TranscriptPart): p is ToolCall =>
	p.type === "tool-call" && isOutput(p.toolName);

/** One line of the log: a gesture of the engine, or a step of the agent. */
export type Entry = { at?: string } & (
	| { kind: "queued" }
	| { kind: "started" }
	| { kind: "stopped"; status: "failed" | "skipped" }
	| { kind: "output"; output: RunRecord["outputs"][number] }
	| { kind: "ended" }
	| { kind: "review"; round: ReviewRound }
	| { kind: "prompt"; text: string }
	| { kind: "text"; text: string; person: boolean }
	| { kind: "reasoning"; text: string }
	| { kind: "tool"; part: ToolCall }
);

export type Filter = "all" | "messages" | "tools" | "errors";

/** Every tool call of the agent, in order: its steps. */
export const toolCalls = (transcript: RunDetail["transcript"]): ToolCall[] =>
	transcript.messages.flatMap((m) =>
		m.content.filter((p): p is ToolCall => p.type === "tool-call"),
	);

/**
 * The last line of a running run: who works now and since when. A reviewed run names its reviewer
 * and the round, or its author fixing the findings; otherwise "Working…" since the run started.
 */
export function working({
	run,
	phase,
}: Pick<RunDetail, "run" | "phase">):
	| { label: string; since: string }
	| undefined {
	if (run.status !== "running" || !run.startedAt) return undefined;
	if (!phase) return { label: "Working…", since: run.startedAt };
	return {
		label:
			phase.doing === "reviewing"
				? `${phase.agent} is reviewing, round ${phase.round} of ${phase.limit}`
				: `${phase.agent} is fixing the findings of round ${phase.round}`,
		since: phase.since,
	};
}

/** "1:05" since the run was queued: the log reads as one clock. */
export function sinceQueued(queuedAt: string, at?: string): string {
	if (!at) return "";
	const s = Math.max(
		0,
		Math.round((new Date(at).getTime() - new Date(queuedAt).getTime()) / 1000),
	);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = String(s % 60).padStart(2, "0");
	return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** The run in order: what the engine did around the agent, and every step of the agent. */
export function logEntries({
	run,
	prompt,
	transcript,
	reviews,
}: RunDetail): Entry[] {
	const out: Entry[] = [{ kind: "queued", at: run.queuedAt }];
	if (run.startedAt) out.push({ kind: "started", at: run.startedAt });
	if (prompt)
		out.push({
			kind: "prompt",
			...(run.startedAt ? { at: run.startedAt } : {}),
			text: prompt,
		});
	for (const m of transcript.messages)
		for (const p of m.content) {
			const at = p.at ?? m.createdAt;
			const when = at ? { at } : {};
			if (p.type === "text")
				out.push({
					kind: "text",
					...when,
					text: p.text,
					person: m.role === "user",
				});
			else if (p.type === "reasoning")
				out.push({ kind: "reasoning", ...when, text: p.text });
			else out.push({ kind: "tool", ...when, part: p });
		}
	const end = run.endedAt ? { at: run.endedAt } : {};
	if (run.status === "failed" || run.status === "skipped")
		out.push({ kind: "stopped", ...end, status: run.status });
	for (const o of run.outputs) out.push({ kind: "output", ...end, output: o });
	if (run.endedAt && run.status !== "skipped")
		out.push({ kind: "ended", ...end });
	// Each round of the internal review where it started: between the agent's steps.
	for (const round of reviews ?? []) {
		const after = out.findIndex(
			(e) => e.kind !== "queued" && e.at !== undefined && e.at > round.at,
		);
		out.splice(after < 0 ? out.length : after, 0, {
			kind: "review",
			at: round.at,
			round,
		});
	}
	return out;
}

/** Whether a line shows under a filter: errors are failed tool calls and a failed run. */
export const matches = (filter: Filter) => (e: Entry) =>
	filter === "all"
		? true
		: filter === "messages"
			? e.kind === "text" || e.kind === "prompt" || e.kind === "reasoning"
			: filter === "tools"
				? e.kind === "tool"
				: (e.kind === "tool" && Boolean(e.part.isError)) ||
					(e.kind === "stopped" && e.status === "failed");

/** The log's filters with the lines each keeps; Errors only when something failed. */
export function filterTabs(
	entries: Entry[],
): { id: Filter; label: string; n: number }[] {
	const count = (f: Filter) => entries.filter(matches(f)).length;
	const errors = count("errors");
	return [
		{ id: "all", label: "Everything", n: entries.length },
		{ id: "messages", label: "Messages", n: count("messages") },
		{ id: "tools", label: "Tool calls", n: count("tools") },
		...(errors ? [{ id: "errors" as const, label: "Errors", n: errors }] : []),
	];
}
