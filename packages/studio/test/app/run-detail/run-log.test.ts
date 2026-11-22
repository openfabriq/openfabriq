import { expect, it } from "vitest";
import {
	type Entry,
	filterTabs,
	logEntries,
	matches,
	sinceQueued,
	type ToolCall,
	toolCalls,
	working,
} from "../../../app/src/features/run-detail/run-log.js";
import { detail } from "./detail.js";

const tool = (id: string, isError = false): ToolCall => ({
	type: "tool-call",
	toolCallId: id,
	toolName: "Bash",
	args: {},
	result: "",
	isError,
	artifact: { title: "Run", output: false },
});

const transcript = {
	messages: [
		{
			id: "m1",
			role: "assistant" as const,
			createdAt: "2026-11-03T10:01:00.000Z",
			content: [
				{ type: "reasoning" as const, text: "Look first." },
				tool("t1"),
				tool("t2", true),
				{ type: "text" as const, text: "Done." },
			],
		},
	],
};

const kinds = (entries: Entry[]) => entries.map((e) => e.kind);

it("reads the engine around the agent, in order", () => {
	const entries = logEntries(
		detail(
			{
				startedAt: "2026-11-03T10:00:30.000Z",
				endedAt: "2026-11-03T10:05:00.000Z",
				outputs: [{ action: "add_comment", summary: "Hi", status: "applied" }],
			},
			{ prompt: "Do it.", transcript },
		),
	);
	expect(kinds(entries)).toEqual([
		"queued",
		"started",
		"prompt",
		"reasoning",
		"tool",
		"tool",
		"text",
		"output",
		"ended",
	]);
	expect(entries[2]?.at).toBe("2026-11-03T10:00:30.000Z");
	expect(entries[3]?.at).toBe("2026-11-03T10:01:00.000Z");
	expect(entries.at(-1)?.at).toBe("2026-11-03T10:05:00.000Z");
});

it("ends a skipped run on why it was skipped, without an Ended line", () => {
	const entries = logEntries(
		detail({ status: "skipped", endedAt: "2026-11-03T10:00:01.000Z" }),
	);
	expect(kinds(entries)).toEqual(["queued", "stopped"]);
	expect(entries[1]).toMatchObject({ kind: "stopped", status: "skipped" });
});

it("ends a failed run on its failure, then its end", () => {
	const entries = logEntries(
		detail({ status: "failed", endedAt: "2026-11-03T10:00:01.000Z" }),
	);
	expect(kinds(entries)).toEqual(["queued", "stopped", "ended"]);
});

it("keeps only failed calls and a failed run under Errors", () => {
	const failed = logEntries(
		detail(
			{ status: "failed", endedAt: "2026-11-03T10:02:00.000Z" },
			{ transcript },
		),
	);
	expect(failed.filter(matches("errors"))).toEqual([
		expect.objectContaining({
			kind: "tool",
			part: expect.objectContaining({ toolCallId: "t2" }),
		}),
		expect.objectContaining({ kind: "stopped", status: "failed" }),
	]);
	const skipped = logEntries(detail({ status: "skipped" }));
	expect(skipped.filter(matches("errors"))).toEqual([]);
	expect(kinds(failed.filter(matches("messages")))).toEqual([
		"reasoning",
		"text",
	]);
	expect(failed.filter(matches("tools"))).toHaveLength(2);
	expect(failed.filter(matches("all"))).toHaveLength(failed.length);
});

it("tells the time from the queue, hours only when there are some", () => {
	const queued = "2026-11-03T10:00:00.000Z";
	expect(sinceQueued(queued, "2026-11-03T10:01:05.000Z")).toBe("1:05");
	expect(sinceQueued(queued, "2026-11-03T11:02:03.000Z")).toBe("1:02:03");
	expect(sinceQueued(queued, "2026-11-03T09:59:00.000Z")).toBe("0:00");
	expect(sinceQueued(queued)).toBe("");
});

it("counts the lines of each filter, and offers Errors only when something failed", () => {
	const failed = logEntries(
		detail(
			{ status: "failed", endedAt: "2026-11-03T10:02:00.000Z" },
			{ prompt: "Do it.", transcript },
		),
	);
	expect(filterTabs(failed)).toEqual([
		{ id: "all", label: "Everything", n: 8 },
		{ id: "messages", label: "Messages", n: 3 },
		{ id: "tools", label: "Tool calls", n: 2 },
		{ id: "errors", label: "Errors", n: 2 },
	]);
	expect(filterTabs(logEntries(detail())).map((f) => f.id)).toEqual([
		"all",
		"messages",
		"tools",
	]);
});

it("collects the agent's tool calls, in order, from every message", () => {
	expect(toolCalls(transcript).map((c) => c.toolCallId)).toEqual(["t1", "t2"]);
	expect(toolCalls({ messages: [] })).toEqual([]);
});

it("starts the reviewer in the log at each round of the internal review, in time order", () => {
	const round = (
		n: number,
		at: string,
		verdict: "needs_changes" | "approved",
	) => ({
		round: n,
		reviewer: "reviewer",
		verdict,
		summary: `round ${n}`,
		findings: [],
		costUsd: 0.05,
		at,
		...(verdict === "approved" ? { risk: "low" as const } : {}),
	});
	const entries = logEntries(
		detail(
			{
				startedAt: "2026-11-03T10:00:30.000Z",
				endedAt: "2026-11-03T10:05:00.000Z",
			},
			{
				transcript,
				reviews: [
					round(1, "2026-11-03T10:00:45.000Z", "needs_changes"),
					round(2, "2026-11-03T10:02:00.000Z", "approved"),
				],
			},
		),
	);
	expect(kinds(entries)).toEqual([
		"queued",
		"started",
		"review",
		"reasoning",
		"tool",
		"tool",
		"text",
		"review",
		"ended",
	]);
	expect(entries.filter((e) => e.kind === "review").map((e) => e.at)).toEqual([
		"2026-11-03T10:00:45.000Z",
		"2026-11-03T10:02:00.000Z",
	]);
});

it("says who works on a running run, and counts from when that began", () => {
	const started = {
		status: "running" as const,
		startedAt: "2026-11-03T10:00:10.000Z",
	};
	const phase = {
		agent: "change-reviewer",
		round: 1,
		limit: 2,
		since: "2026-11-03T10:04:00.000Z",
	};
	expect(working(detail(started))).toEqual({
		label: "Working…",
		since: "2026-11-03T10:00:10.000Z",
	});
	expect(
		working(detail(started, { phase: { ...phase, doing: "reviewing" } })),
	).toEqual({
		label: "change-reviewer is reviewing, round 1 of 2",
		since: "2026-11-03T10:04:00.000Z",
	});
	expect(
		working(
			detail(started, {
				phase: { ...phase, doing: "fixing", agent: "implementer" },
			}),
		),
	).toEqual({
		label: "implementer is fixing the findings of round 1",
		since: "2026-11-03T10:04:00.000Z",
	});
	expect(working(detail())).toBeUndefined();
	expect(working(detail({ status: "running" }))).toBeUndefined();
});
