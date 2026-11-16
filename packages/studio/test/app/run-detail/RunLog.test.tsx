// @vitest-environment happy-dom
import { OUTPUT_TOOL_PREFIX } from "@openfabriq/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { RunLog } from "../../../app/src/features/run-detail/RunLog.js";
import type { ToolCall } from "../../../app/src/features/run-detail/run-log.js";
import { detail } from "./detail.js";

afterEach(cleanup);

const bash = (id: string, command: string, isError = false): ToolCall => ({
	type: "tool-call",
	toolCallId: id,
	toolName: "Bash",
	args: { command },
	result: "ok",
	isError,
	artifact: { title: "Run", detail: command, output: false },
});

const withTools = (...content: ToolCall[]) =>
	detail(
		{},
		{
			prompt:
				'Implement issue #4.\n<github-data>{"title":"Add a counter"}</github-data>',
			transcript: {
				messages: [
					{
						id: "m1",
						role: "assistant",
						createdAt: "2026-11-03T10:01:00.000Z",
						content,
					},
				],
			},
		},
	);

const filter = (name: RegExp) => screen.getByRole("button", { name });
const rowOf = (text: string) =>
	screen.getByText(text).closest("details") as HTMLDetailsElement;

it("counts each filter, and offers Errors only when something failed", () => {
	render(<RunLog detail={withTools(bash("t1", "ls"))} project={undefined} />);
	expect(filter(/Tool calls/).textContent).toBe("Tool calls1");
	expect(screen.queryByRole("button", { name: /Errors/ })).toBeNull();
	cleanup();

	render(
		<RunLog
			detail={withTools(bash("t1", "ls"), bash("t2", "pnpm test", true))}
			project={undefined}
		/>,
	);
	expect(filter(/Errors/).textContent).toBe("Errors1");
	fireEvent.click(filter(/Errors/));
	expect(screen.queryByText("ls")).toBeNull();
	expect(screen.getByText("pnpm test")).toBeTruthy();
});

it("says so when a filter keeps nothing", () => {
	render(<RunLog detail={detail()} project={undefined} />);
	fireEvent.click(filter(/Tool calls/));
	expect(screen.getByText("Nothing of this kind in this run.")).toBeTruthy();
});

it("keeps an opened step open, and only that one, when the filter changes", () => {
	render(
		<RunLog
			detail={withTools(bash("t1", "ls"), bash("t2", "pnpm test"))}
			project={undefined}
		/>,
	);
	rowOf("pnpm test").open = true;
	fireEvent.click(filter(/Tool calls/));
	expect(rowOf("pnpm test").open).toBe(true);
	expect(rowOf("ls").open).toBe(false);
});

it("shows the prompt as sent, its GitHub data block included", () => {
	render(<RunLog detail={withTools()} project={undefined} />);
	const prompt = rowOf("Prompt").querySelector("pre");
	expect(prompt?.textContent).toContain(
		'<github-data>{"title":"Add a counter"}</github-data>',
	);
});

it("writes what the engine did in words, on the clock of the run", () => {
	render(
		<RunLog
			detail={detail(
				{
					status: "failed",
					model: "sonnet",
					startedAt: "2026-11-03T10:00:05.000Z",
					endedAt: "2026-11-03T10:02:00.000Z",
					durationMs: 115_000,
					costUsd: 0.42,
					reason: "The checks failed: typecheck",
					outputs: [
						{
							action: "add_comment",
							summary: "## Not done",
							status: "applied",
							url: "https://github.com/acme/shop/issues/4#c1",
						},
						{
							action: "add_labels",
							summary: "deploy",
							status: "refused",
							reason: "not allowed",
						},
					],
				},
				{
					transcript: {
						messages: [
							{
								id: "m1",
								role: "user",
								createdAt: "2026-11-03T10:00:30.000Z",
								content: [{ type: "text", text: "Go on" }],
							},
							{
								id: "m2",
								role: "assistant",
								createdAt: "2026-11-03T10:01:00.000Z",
								content: [
									{ type: "reasoning", text: "Look at the test first." },
									{ type: "text", text: "Done." },
								],
							},
						],
					},
				},
			)}
			project={undefined}
		/>,
	);
	const rows = [...document.querySelectorAll("ol > li")].map((li) =>
		li.textContent?.replace(/\s+/g, " ").trim(),
	);
	expect(rows).toEqual([
		"0:00Queued: an issue is labeled (ready-for-agent), on Issue #4.",
		"0:05Started implementer on sonnet.",
		"0:30A person wroteGo on",
		"1:00ThinkingLook at the test first.",
		"1:00Done.",
		"2:00Failed: The checks failed: typecheck.",
		"2:00Wrote: Comment “Not done”Open",
		"2:00Did not write: Add labels “deploy” — not allowed",
		"2:00Ended after 1m 55s, $0.42.",
	]);
	expect(screen.getByText("Open").getAttribute("href")).toBe(
		"https://github.com/acme/shop/issues/4#c1",
	);
});

it("links a proposed output to the Outputs tab, in the page's project", () => {
	const proposal: ToolCall = {
		...bash("t1", ""),
		toolName: `${OUTPUT_TOOL_PREFIX}add_comment`,
		artifact: { title: "Comment", output: true },
	};
	render(<RunLog detail={withTools(proposal)} project="acme/shop" />);
	const link = screen.getByText("See in Outputs").closest("a");
	expect(link?.getAttribute("href")).toBe(
		"#/run/r1?project=acme%2Fshop&tab=outputs",
	);
});

it("names the reviewer and the round while a review runs, and says Working… otherwise", () => {
	const running = {
		status: "running" as const,
		startedAt: "2026-11-03T10:00:10.000Z",
	};
	render(<RunLog detail={detail(running)} project={undefined} />);
	expect(screen.getByText("Working…")).toBeTruthy();
	cleanup();
	render(
		<RunLog
			detail={detail(running, {
				phase: {
					doing: "reviewing",
					agent: "change-reviewer",
					round: 2,
					limit: 2,
					since: "2026-11-03T10:04:00.000Z",
				},
			})}
			project={undefined}
		/>,
	);
	expect(
		screen.getByText("change-reviewer is reviewing, round 2 of 2"),
	).toBeTruthy();
	expect(screen.queryByText("Working…")).toBeNull();
});
