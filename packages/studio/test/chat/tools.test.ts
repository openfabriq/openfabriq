import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRun, readFactoryFolder, writeApplied } from "@openfabriq/runner";
import { beforeEach, expect, it } from "vitest";
import { appChatTools } from "../../src/chat/tools.js";

const REPO = "acme/task-app";
const PR = "https://github.com/acme/task-app/pull/7";

beforeEach(() => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
	writeApplied(
		REPO,
		readFactoryFolder(
			join(import.meta.dirname, "../../../../fixtures/valid/sdlc/openfabriq"),
		),
	);
	appendRun({
		id: "r1",
		repository: REPO,
		automation: "implement-ready-issues",
		agent: "implementer",
		event: "issue.labeled",
		number: 4,
		title: "Add a due date",
		isPullRequest: false,
		status: "succeeded",
		queuedAt: "2026-11-03T08:00:00Z",
		endedAt: "2026-11-03T08:20:00Z",
		costUsd: 1.5,
		outputs: [{ action: "create_pull_request", status: "applied", url: PR }],
	} as never);
});

const call = async (name: string, args: object = {}) => {
	const tools = appChatTools(
		REPO,
		async (urls) =>
			Object.fromEntries(urls.map((u) => [u, { merged: true, open: false }])),
		() => new Date("2026-11-03T12:00:00Z"),
	);
	const out = (await tools
		.find((t) => t.name === name)
		?.handler(args as never, {})) as { content: { text: string }[] };
	return JSON.parse(out.content[0]?.text ?? "");
};

it("gives the chat the numbers of the Overview page", async () => {
	const metrics = await call("metrics", { period: "7d" });
	expect(metrics.runs.total).toBe(1);
	expect(metrics.cost.totalUsd).toBe(1.5);
	expect(metrics.pullRequests).toEqual({
		opened: 1,
		merged: 1,
		closed: 0,
		unknown: 0,
	});
	expect(metrics.cost.byOutcome.merged).toBe(1.5);
});

it("gives the chat the board, each card in a few fields", async () => {
	const board = await call("board");
	const done = board.stages.find((s: { stage: string }) => s.stage === "done");
	expect(done.cards).toEqual([
		{
			subject: "#4",
			title: "Add a due date",
			run: "r1",
			agent: "implementer",
			status: "succeeded",
			trail: ["implementer (succeeded)"],
		},
	]);
	expect(board.agents).toContainEqual({
		name: "implementer",
		working: 0,
		waiting: 0,
		runs: 1,
	});
});
