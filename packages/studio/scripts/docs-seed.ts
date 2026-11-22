// Development only: the studio with made-up data, for the docs. Seeds a temporary OPENFABRIQ_HOME
// with a factory (the 02-sdlc example, with Slack and Linear from 03-team-chat) and a week of runs
// from GitHub, Slack, Linear, Sentry and a webhook, then serves the built studio on a free port
// with a fake chat and a fake relay. Imported by docs-screenshots.ts and docs-demo.ts. Needs
// `pnpm build`. Never reads ~/.openfabriq.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type {
	ChatEvent,
	ChatTurnInput,
	CommandRun,
	ReviewRound,
	RunRecord,
} from "@openfabriq/runner";

process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-docs-"));
const {
	appendRun,
	projectDir,
	readAppliedFactory,
	readFactoryFolder,
	studioTokenPath,
	writeApplied,
	writeSecrets,
} = await import("@openfabriq/runner");
const { startStudio } = await import("../dist/index.js");
const { WIKI } = await import("./docs-wiki.ts");

const REPO = "acme/web-app";
const GH = `https://github.com/${REPO}`;
const examples = join(import.meta.dirname, "../../../examples");

// --- The factory: 02-sdlc for acme/web-app, with Slack and Linear from 03-team-chat. ---

const sdlc = readFactoryFolder(join(examples, "02-sdlc/openfabriq"));
const chat = readFactoryFolder(join(examples, "03-team-chat/openfabriq"));
const yaml = String(sdlc["factory.yaml"])
	.replace("name: Task app factory", "name: Web app factory")
	.replace("repository: acme/task-app", `repository: ${REPO}`)
	.replace("project: task-app", "project: web-app")
	.replace(
		"integrations:\n",
		"integrations:\n  slack:\n    channel: factory\n  linear:\n    team: ENG\n",
	);
if (yaml.includes("task-app") || !yaml.includes("slack:"))
	throw new Error(
		`02-sdlc's factory.yaml changed: update this script.\n${yaml}`,
	);
const borrowed = [
	"agents/intake/agent.md",
	"automations/answer-slack-mentions/automation.md",
	"automations/implement-delegated-linear-issues/automation.md",
];
writeApplied(REPO, {
	...sdlc,
	"factory.yaml": `${yaml}learning: true\n`,
	...Object.fromEntries(borrowed.map((p) => [p, String(chat[p])])),
});
if (!readAppliedFactory(REPO))
	throw new Error("The seeded factory does not load.");

// --- The wiki: the engine's clone of acme/web-app, with the pages of docs-wiki.ts. ---

const clone = join(projectDir(REPO), "repo");
const git = (...args: string[]) =>
	execFileSync("git", ["-C", clone, ...args], { encoding: "utf8" }).trim();
for (const [path, text] of Object.entries(WIKI)) {
	mkdirSync(dirname(join(clone, "wiki", path)), { recursive: true });
	writeFileSync(join(clone, "wiki", path), text);
}
git("init", "-q", "-b", "main");
git("-c", "user.name=Alice", "-c", "user.email=alice@acme.test", "add", "-A");
git(
	"-c",
	"user.name=Alice",
	"-c",
	"user.email=alice@acme.test",
	"commit",
	"-q",
	"-m",
	"docs: wiki",
);
// The default branch's head, as the poll would have read it from GitHub.
writeFileSync(
	join(projectDir(REPO), "cursor.json"),
	JSON.stringify({ branch: git("rev-parse", "HEAD") }),
);

// --- The machine: tokens set, and a relay that says Linear is installed. ---

const relay = createServer((_req, res) => {
	res.setHeader("content-type", "application/json");
	res.end(JSON.stringify({ organizations: [{ id: "acme", name: "Acme" }] }));
}).listen(0, "127.0.0.1");
await new Promise((ok) => relay.once("listening", ok));
writeSecrets("relay", {
	url: `http://127.0.0.1:${(relay.address() as AddressInfo).port}`,
	token: "docs",
});
writeSecrets("slack", { bot_token: "xoxb-docs" });
writeSecrets("sentry", { token: "docs" });

// --- The runs: a week of work, appended in order. Each run starts a minute after the one before. ---

type Step =
	| string
	| { think: string }
	| [tool: string, input: Record<string, unknown>, result: string];

interface Seed extends Partial<RunRecord> {
	id: string;
	automation: string;
	agent: string;
	event: string;
	/** Minutes, from the end of the run before; a number starts a new story that many minutes ago. */
	gap?: number;
	ago?: number;
	ms?: number;
	steps?: Step[];
	report?: string;
	prompt?: string;
	commands?: Omit<CommandRun, "at">[];
	/** The rounds of its internal review (reviewed_by), each `second` seconds after the run started. */
	reviews?: (Omit<ReviewRound, "at" | "reviewer"> & { second: number })[];
}

const MIN = 60_000;
let cursor = Date.now();
/** When a run last worked on each pull request. */
const lastOn = new Map<string, number>();

function run(seed: Seed): void {
	const {
		gap = 1,
		ago,
		ms = 0,
		steps,
		report,
		prompt,
		commands,
		reviews,
		...rest
	} = seed;
	cursor = ago === undefined ? cursor + gap * MIN : Date.now() - ago * MIN;
	const start = new Date(cursor).toISOString();
	const status = rest.status ?? "succeeded";
	const ended = status !== "queued" && status !== "running";
	appendRun({
		repository: REPO,
		isPullRequest: false,
		model: "sonnet",
		outputs: [],
		status,
		queuedAt: start,
		...(status !== "queued" ? { startedAt: start } : {}),
		...(ended
			? { endedAt: new Date(cursor + ms).toISOString(), durationMs: ms }
			: {}),
		...(rest.number !== undefined
			? { url: rest.isPullRequest ? pull(rest.number) : issue(rest.number) }
			: {}),
		...rest,
	} as RunRecord);
	if (ended) cursor += ms;
	// The merge dates need the last run on each pull request.
	for (const o of rest.outputs ?? [])
		if (o.url?.includes("/pull/")) lastOn.set(o.url, cursor);
	if (rest.isPullRequest && rest.number !== undefined)
		lastOn.set(pull(rest.number), cursor);
	const dir = join(projectDir(REPO), "runs", seed.id);
	mkdirSync(dir, { recursive: true });
	if (prompt) writeFileSync(join(dir, "prompt.md"), prompt);
	if (commands)
		writeFileSync(
			join(dir, "commands.jsonl"),
			commands
				.map((c) =>
					JSON.stringify({ ...c, at: new Date(cursor).toISOString() }),
				)
				.join("\n"),
		);
	if (reviews)
		writeFileSync(
			join(dir, "reviews.json"),
			JSON.stringify(
				reviews.map(({ second, ...r }) => ({
					...r,
					reviewer: "reviewer",
					at: new Date(Date.parse(start) + second * 1000).toISOString(),
				})),
			),
		);
	if (steps)
		writeFileSync(
			join(dir, "transcript.jsonl"),
			transcript(start, steps, report),
		);
}

/** A transcript as the Agent SDK writes it: thoughts, words and tool calls, then the report. */
function transcript(at: string, steps: Step[], report?: string): string {
	const lines: unknown[] = [];
	let t = Date.parse(at);
	const say = (content: unknown) => {
		t += 3000;
		lines.push({
			type: "assistant",
			message: { content: [content] },
			timestamp: new Date(t).toISOString(),
		});
	};
	for (const [i, step] of steps.entries()) {
		if (typeof step === "string") {
			say({ type: "text", text: step });
			continue;
		}
		if (!Array.isArray(step)) {
			say({ type: "thinking", thinking: step.think, signature: "s" });
			continue;
		}
		const [name, input, result] = step;
		say({ type: "tool_use", id: `toolu_${i}`, name, input });
		t += 2000;
		lines.push({
			type: "user",
			message: {
				content: [
					{ type: "tool_result", tool_use_id: `toolu_${i}`, content: result },
				],
			},
			timestamp: new Date(t).toISOString(),
		});
	}
	if (report) {
		say({ type: "text", text: report });
		lines.push({
			type: "result",
			subtype: "success",
			is_error: false,
			result: report,
			num_turns: steps.length + 1,
		});
	}
	return lines.map((l) => JSON.stringify(l)).join("\n");
}

const issue = (n: number) => `${GH}/issues/${n}`;
const pull = (n: number) => `${GH}/pull/${n}`;
/** A commit id the engine pushed for a pull request. */
const commit = (n: number) => `c0ffee${n}`;
const DAY = 24 * 60;
const proposal = (action: string, input: Record<string, unknown>): Step => [
	`mcp__openfabriq__${action}`,
	input,
	"Proposed. The engine applies it after the run.",
];
const checks: Omit<CommandRun, "at">[] = [
	{
		kind: "command",
		name: "test",
		command: "npm test",
		ok: true,
		output: "Tests  51 passed (51)",
		durationMs: 6_100,
	},
	{
		kind: "check",
		name: "test",
		command: "npm test",
		ok: true,
		output: "Tests  51 passed (51)",
		durationMs: 6_200,
	},
	{
		kind: "check",
		name: "typecheck",
		command: "npm run typecheck",
		ok: true,
		output: "",
		durationMs: 4_100,
	},
	{
		kind: "check",
		name: "lint",
		command: "npm run lint",
		ok: true,
		output: "Checked 96 files. No fixes applied.",
		durationMs: 900,
	},
];

// Issue #41: triage, then an implementation its review approves at once; merged.
run({
	ago: 6 * DAY + 600,
	id: "triage-41",
	automation: "triage-issues",
	agent: "triage",
	event: "issue.opened",
	number: 41,
	title: "Search tasks by tag",
	ms: 38_000,
	costUsd: 0.07,
	outputs: [
		{
			action: "add_labels",
			summary: "feature, ready-for-agent",
			status: "applied",
		},
	],
	steps: [
		["Grep", { pattern: "tags", path: "src" }, "src/tasks/model.ts"],
		proposal("add_labels", { labels: ["feature", "ready-for-agent"] }),
	],
	report:
		"A clear feature: the issue says which field to search and what an empty result shows. I labeled it `feature` and `ready-for-agent`.",
});
run({
	id: "implement-41",
	automation: "implement-ready-issues",
	agent: "implementer",
	event: "issue.labeled",
	label: "ready-for-agent",
	number: 41,
	title: "Search tasks by tag",
	ms: 9 * MIN,
	costUsd: 1.12,
	tokens: { input: 8_100, output: 1_900 },
	outputs: [
		{
			action: "create_pull_request",
			summary: "Search tasks by tag",
			status: "applied",
			url: pull(42),
			commits: [commit(42)],
		},
	],
	steps: [
		[
			"Read",
			{ file_path: "src/tasks/search.ts" },
			"export function search(tasks, text) { … }",
		],
		[
			"Edit",
			{
				file_path: "src/tasks/search.ts",
				old_string: "t.title.includes(text)",
				new_string: "t.title.includes(text) || t.tags.includes(text)",
			},
			"Updated.",
		],
		proposal("create_pull_request", {
			title: "Search tasks by tag",
			body: "Closes #41.",
		}),
	],
	report:
		"I opened PR #42: the search box also matches a task's tags, with two new tests.",
	commands: checks,
	reviews: [
		{
			round: 1,
			second: 16,
			verdict: "approved",
			risk: "low",
			summary: "Does what #41 asks and nothing else; every case is tested.",
			findings: [],
			costUsd: 0.18,
		},
	],
});

// Issue #44: a bug investigated, then fixed in two rounds of review; merged. Its implementation is the docs' main run.
run({
	ago: 5 * DAY + 420,
	id: "triage-44",
	automation: "triage-issues",
	agent: "triage",
	event: "issue.opened",
	number: 44,
	title: "Export fails for accounts with more than 1,000 tasks",
	ms: 41_000,
	costUsd: 0.08,
	outputs: [
		{
			action: "add_labels",
			summary: "bug, needs-investigation",
			status: "applied",
		},
	],
	steps: [proposal("add_labels", { labels: ["bug", "needs-investigation"] })],
	report:
		"A bug, but the cause is unknown: I labeled it `needs-investigation`.",
});
run({
	id: "investigate-44",
	automation: "investigate-bugs",
	agent: "investigator",
	event: "issue.labeled",
	label: "needs-investigation",
	number: 44,
	title: "Export fails for accounts with more than 1,000 tasks",
	ms: 3 * MIN,
	costUsd: 0.31,
	outputs: [
		{
			action: "add_comment",
			summary: "The export loads every task in memory before writing the file.",
			status: "applied",
			url: `${issue(44)}#issuecomment-2`,
		},
		{ action: "add_labels", summary: "ready-for-agent", status: "applied" },
	],
	steps: [
		[
			"Read",
			{ file_path: "src/export/csv.ts" },
			"const tasks = await db.tasks.findMany({ where: { accountId } });",
		],
		["Bash", { command: "npm test -- export" }, "✓ exports 10 tasks"],
		proposal("add_comment", {
			body: "The export loads every task in memory before writing the file.",
		}),
		proposal("add_labels", { labels: ["ready-for-agent"] }),
	],
	report:
		"`exportCsv` loads every task before it writes a line, and the request times out after 30 seconds. Streaming the rows fixes it; I wrote the contract on #44 and labeled it `ready-for-agent`.",
});
const exportPr = "Stream the export instead of loading every task";
run({
	id: "implement-44",
	automation: "implement-ready-issues",
	agent: "implementer",
	event: "issue.labeled",
	label: "ready-for-agent",
	number: 44,
	title: "Export fails for accounts with more than 1,000 tasks",
	ms: 11 * MIN + 24_000,
	costUsd: 1.36,
	tokens: { input: 14_200, output: 3_400 },
	turns: 17,
	outputs: [
		{
			action: "create_pull_request",
			summary: exportPr,
			status: "applied",
			url: pull(45),
			commits: [commit(45)],
		},
	],
	prompt:
		"Issue #44 of acme/web-app is labeled ready-for-agent. Implement it and open a pull request.",
	commands: checks,
	steps: [
		{
			think:
				"The investigator's comment says the export loads every task. Read the export first, then the database helper.",
		},
		"I'll start with the export and the comment on #44.",
		[
			"Read",
			{ file_path: "src/export/csv.ts" },
			"export async function exportCsv(accountId, res) {\n\tconst tasks = await db.tasks.findMany({ where: { accountId } });\n\tres.write(toCsv(tasks));\n}",
		],
		[
			"Grep",
			{ pattern: "findMany", path: "src/db" },
			"src/db/tasks.ts:12: export function findMany(query)",
		],
		[
			"Read",
			{ file_path: "src/db/tasks.ts" },
			"export function findMany(query) { … }\nexport async function* pages(query, size = 500) { … }",
		],
		{
			think:
				"`pages` already yields batches of 500. Use it and write each batch as it arrives.",
		},
		[
			"Edit",
			{
				file_path: "src/export/csv.ts",
				old_string:
					"const tasks = await db.tasks.findMany({ where: { accountId } });\n\tres.write(toCsv(tasks));",
				new_string:
					"res.write(CSV_HEADER);\n\tfor await (const batch of db.tasks.pages({ where: { accountId } }))\n\t\tres.write(toCsvRows(batch));",
			},
			"Updated.",
		],
		[
			"Write",
			{
				file_path: "src/export/csv.test.ts",
				content:
					'it("exports 2,500 tasks in batches", async () => {\n\tconst res = fakeResponse();\n\tawait exportCsv(bigAccount, res);\n\texpect(res.lines).toHaveLength(2501);\n});\n',
			},
			"Created.",
		],
		["Bash", { command: "npm test" }, "Tests  50 passed (50)"],
		proposal("create_pull_request", {
			title: exportPr,
			body: "Closes #44.\n\nThe export writes the tasks in batches of 500 instead of loading them all.",
		}),
		"The review found one defect: a failure mid-stream leaves a truncated file with a 200 status.",
		[
			"Edit",
			{
				file_path: "src/export/csv.ts",
				old_string: "for await",
				new_string: "try {\n\tfor await",
			},
			"Updated.",
		],
		["Bash", { command: "npm test" }, "Tests  51 passed (51)"],
		"The tests pass. Proposing the pull request again, with the fix.",
		proposal("create_pull_request", {
			title: exportPr,
			body: "Closes #44.\n\nThe export writes the tasks in batches of 500 instead of loading them all.",
		}),
	],
	report: `I opened PR #45, **${exportPr}**.

- **The cause.** \`exportCsv\` loaded every task before writing, so large accounts hit the 30-second timeout.
- **The fix.** It writes the header, then each batch of 500 from \`db.tasks.pages\`, the helper the API already uses.
- **Tests.** A new test exports 2,500 tasks, another fails the stream halfway; \`npm test\` passes.`,
	reviews: [
		{
			round: 1,
			second: 45,
			verdict: "needs_changes",
			summary: "An error mid-stream leaves a truncated file with a 200 status.",
			findings: [
				{
					file: "src/export/csv.ts",
					line: 4,
					problem:
						"If the database fails after the first batch, the user downloads a truncated file and sees no error.",
					suggestion: "End the file with an error line and log the failure.",
					blocking: true,
				},
			],
			costUsd: 0.22,
		},
		{
			round: 2,
			second: 66,
			verdict: "approved",
			risk: "medium",
			summary: "The failure mid-stream is handled and tested.",
			findings: [],
			costUsd: 0.15,
		},
	],
});

// Issue #48: a question back to the author. #49: the checks failed.
run({
	ago: 4 * DAY + 300,
	id: "triage-48",
	automation: "triage-issues",
	agent: "triage",
	event: "issue.opened",
	number: 48,
	title: "Add a due date to tasks",
	ms: 45_000,
	costUsd: 0.09,
	outputs: [
		{
			action: "add_comment",
			summary: "Should overdue tasks move to the top, or only turn red?",
			status: "applied",
			url: `${issue(48)}#issuecomment-3`,
		},
		{ action: "add_labels", summary: "feature, needs-info", status: "applied" },
	],
	steps: [
		proposal("add_comment", {
			body: "Should overdue tasks move to the top, or only turn red?",
		}),
		proposal("add_labels", { labels: ["feature", "needs-info"] }),
	],
	report:
		"The issue does not say what happens to overdue tasks. I asked, and labeled it `needs-info`.",
});
run({
	gap: 90,
	id: "implement-49",
	automation: "implement-ready-issues",
	agent: "implementer",
	event: "issue.labeled",
	label: "ready-for-agent",
	number: 49,
	title: "Remember the last filter between visits",
	status: "failed",
	reason: 'the check "typecheck" failed (npm run typecheck)',
	ms: 9 * MIN,
	costUsd: 1.08,
	steps: [
		[
			"Edit",
			{
				file_path: "src/tasks/filters.ts",
				old_string: 'useState("all")',
				new_string: 'useStoredState("filter", "all")',
			},
			"Updated.",
		],
		["Bash", { command: "npm test" }, "Tests  49 passed (49)"],
	],
	commands: [
		...checks.slice(0, 2),
		{
			kind: "check",
			name: "typecheck",
			command: "npm run typecheck",
			ok: false,
			output:
				"src/tasks/filters.ts(8,22): error TS2304: Cannot find name 'useStoredState'.",
			durationMs: 4_000,
		},
	],
});
// Issue #50: already labeled by a person.
run({
	ago: 3 * DAY + 500,
	id: "triage-50",
	automation: "triage-issues",
	agent: "triage",
	event: "issue.opened",
	number: 50,
	title: "Typo on the pricing page",
	status: "skipped",
	reason: "The issue is already labeled.",
});
// Issue #53: needs a person.
run({
	gap: 120,
	id: "triage-53",
	automation: "triage-issues",
	agent: "triage",
	event: "issue.opened",
	number: 53,
	title: "Login fails with SSO accounts",
	ms: 52_000,
	costUsd: 0.11,
	outputs: [
		{
			action: "add_comment",
			summary:
				"This depends on the identity provider's settings, which the code cannot see.",
			status: "applied",
			url: `${issue(53)}#issuecomment-4`,
		},
		{
			action: "add_labels",
			summary: "bug, needs-human",
			status: "applied",
		},
	],
	steps: [
		proposal("add_comment", {
			body: "This depends on the identity provider's settings, which the code cannot see.",
		}),
		proposal("add_labels", { labels: ["bug", "needs-human"] }),
	],
	report:
		"The SSO callback rejects the provider's certificate, which is set in the provider's console, not in this repository. A person has to check it.",
});

// The webhook: a failed deploy becomes an issue, fixed and merged.
const deployIssue = "Deploy of 9c2e417 failed: the build cannot find @acme/ui";
run({
	ago: 2 * DAY + 520,
	id: "webhook-deploy-failed",
	automation: "investigate-failed-deploys",
	agent: "investigator",
	event: "webhook.received",
	title: "Webhook received",
	source: { kind: "webhook", label: "deploy-failed" },
	ms: 131_000,
	costUsd: 0.27,
	outputs: [
		{
			action: "create_issue",
			summary: deployIssue,
			status: "applied",
			url: issue(56),
		},
	],
	steps: [
		[
			"Bash",
			{ command: "git log --oneline 3b7d0aa..9c2e417" },
			"9c2e417 chore: move the UI kit to packages/ui\n5d1f0b8 fix(auth): keep the session on refresh",
		],
		[
			"Read",
			{ file_path: "package.json" },
			'{ "dependencies": { "@acme/ui": "workspace:*" } }',
		],
		["Read", { file_path: "pnpm-workspace.yaml" }, "packages:\n  - apps/*"],
		proposal("create_issue", { title: deployIssue, body: "## What failed\n…" }),
	],
	report: `I opened incident issue #56, **${deployIssue}**.

- **What failed.** The deploy platform stopped at \`pnpm install\`: \`@acme/ui@workspace:*\` matches no package.
- **The suspect commit.** \`9c2e417\` moved the UI kit to \`packages/ui\`, but \`pnpm-workspace.yaml\` still lists only \`apps/*\`.
- **Next step.** Add \`packages/*\` to the workspace; the issue says how to check it locally before deploying again.

Production still runs \`3b7d0aa\`, the last good deploy.`,
});
run({
	id: "triage-56",
	automation: "triage-issues",
	agent: "triage",
	event: "issue.opened",
	number: 56,
	title: deployIssue,
	ms: 30_000,
	costUsd: 0.06,
	outputs: [
		{
			action: "add_labels",
			summary: "bug, ready-for-agent",
			status: "applied",
		},
	],
	steps: [proposal("add_labels", { labels: ["bug", "ready-for-agent"] })],
	report:
		"The incident issue already has its cause and fix: `ready-for-agent`.",
});
run({
	id: "implement-56",
	automation: "implement-ready-issues",
	agent: "implementer",
	event: "issue.labeled",
	label: "ready-for-agent",
	number: 56,
	title: deployIssue,
	ms: 4 * MIN,
	costUsd: 0.47,
	outputs: [
		{
			action: "create_pull_request",
			summary: "Add packages/* to the pnpm workspace",
			status: "applied",
			url: pull(57),
			commits: [commit(57)],
		},
		{
			action: "add_labels",
			summary: "incident",
			status: "refused",
			reason: "implement-ready-issues may not add labels",
		},
	],
	steps: [
		["Read", { file_path: "pnpm-workspace.yaml" }, "packages:\n  - apps/*"],
		[
			"Edit",
			{
				file_path: "pnpm-workspace.yaml",
				old_string: "  - apps/*",
				new_string: "  - apps/*\n  - packages/*",
			},
			"Updated.",
		],
		["Bash", { command: "pnpm install --frozen-lockfile" }, "Done in 6.1s"],
		proposal("create_pull_request", {
			title: "Add packages/* to the pnpm workspace",
			body: "Closes #56.\n\nThe UI kit moved to `packages/ui` in 9c2e417, but the workspace only listed `apps/*`, so `pnpm install` could not resolve `@acme/ui`.",
		}),
		proposal("add_labels", { labels: ["incident"] }),
	],
	report:
		"I opened PR #57: the workspace lists `packages/*`, and `pnpm install --frozen-lockfile` passes. I also asked for the `incident` label, which this automation may not add.",
	commands: checks,
	reviews: [
		{
			round: 1,
			second: 21,
			verdict: "approved",
			risk: "low",
			summary: "One line, and it fixes #56.",
			findings: [],
			costUsd: 0.09,
		},
	],
});

// Slack: a request in #factory becomes an issue.
const slackIssue = "Let people export their invoices as CSV";
const slackUrl = "https://acme.slack.com/archives/C07FACTORY/p1762160520000100";
run({
	ago: DAY + 610,
	id: "slack-export",
	automation: "answer-slack-mentions",
	agent: "intake",
	event: "slack.mentioned",
	title: "can we let people export their invoices as CSV? finance asks weekly",
	url: slackUrl,
	source: { kind: "slack", label: "#factory", url: slackUrl },
	ms: 48_000,
	costUsd: 0.09,
	outputs: [
		{
			action: "create_issue",
			summary: slackIssue,
			status: "applied",
			url: issue(58),
		},
	],
	steps: [
		["Grep", { pattern: "invoice", path: "src" }, "src/billing/invoices.ts"],
		[
			"Read",
			{ file_path: "src/billing/invoices.ts" },
			"export async function listInvoices(accountId) { … }",
		],
		proposal("create_issue", {
			title: slackIssue,
			body: "## Goal\nFinance downloads …",
		}),
	],
	report: `I opened issue #58, **${slackIssue}**, from Alex's request in #factory.

- **What it asks.** A *Download CSV* button on the invoices page, one row per invoice: number, date, customer, amount, status.
- **Where it goes.** \`listInvoices\` in \`src/billing/invoices.ts\` already returns every field, so no new query is needed.
- **Open question.** Finance did not say whether refunded invoices belong in the file; the issue asks it rather than guessing.

The engine posts the issue's link in the Slack thread.`,
});
run({
	id: "triage-58",
	automation: "triage-issues",
	agent: "triage",
	event: "issue.opened",
	number: 58,
	title: slackIssue,
	ms: 35_000,
	costUsd: 0.07,
	outputs: [
		{ action: "add_labels", summary: "feature, needs-info", status: "applied" },
	],
	steps: [proposal("add_labels", { labels: ["feature", "needs-info"] })],
	report:
		"The issue asks its own question about refunds: `needs-info` until finance answers.",
});

// Linear: an issue assigned to openfabriq becomes a pull request.
const linearPr = "ENG-142 Show the trial's days left in the header";
const linearUrl = "https://linear.app/acme/issue/ENG-142";
run({
	gap: 75,
	id: "linear-eng-142",
	automation: "implement-delegated-linear-issues",
	agent: "implementer",
	event: "linear.issue.delegated",
	title: linearPr,
	url: linearUrl,
	source: { kind: "linear", label: "ENG-142", url: linearUrl },
	ms: 412_000,
	costUsd: 0.86,
	tokens: { input: 9_400, output: 2_100 },
	outputs: [
		{
			action: "create_pull_request",
			summary: linearPr,
			status: "applied",
			url: pull(61),
			commits: [commit(61)],
		},
	],
	commands: checks,
	steps: [
		["Grep", { pattern: "trialEndsAt", path: "src" }, "src/account/plan.ts"],
		[
			"Read",
			{ file_path: "src/components/Header.tsx" },
			"export function Header() { … }",
		],
		[
			"Edit",
			{
				file_path: "src/components/Header.tsx",
				old_string: "<UserMenu />",
				new_string: "<TrialBadge account={account} />\n<UserMenu />",
			},
			"Updated.",
		],
		[
			"Write",
			{
				file_path: "src/components/TrialBadge.tsx",
				content:
					"export function TrialBadge({ account }) {\n\tconst days = daysLeft(account.trialEndsAt);\n\tif (days === undefined) return null;\n\treturn <span>{days} days left</span>;\n}\n",
			},
			"Created.",
		],
		["Bash", { command: "npm test" }, "Tests  48 passed (48)"],
		proposal("create_pull_request", {
			title: linearPr,
			body: "Closes ENG-142.",
		}),
	],
	report: `I opened PR #61 for ENG-142.

- **What changed.** A \`TrialBadge\` in the header shows "12 days left" while the account is on trial, and nothing once it pays.
- **The rule.** Days are counted from \`trialEndsAt\` in the account's time zone, so the badge never says "0 days left" on the last day.
- **Tests.** Three cases for \`daysLeft\` (on trial, last day, paid); \`npm test\` passes.

The engine shows the link in the Linear session.`,
});

// Sentry: a production error becomes an issue, now being implemented.
const sentryIssue = "Checkout crashes when a coupon empties the cart total";
const sentryUrl = "https://acme.sentry.io/issues/5120344871/";
run({
	ago: 190,
	id: "sentry-web-app-3f",
	automation: "investigate-production-errors",
	agent: "investigator",
	event: "sentry.issue.created",
	title:
		"WEB-APP-3F TypeError: Cannot read properties of undefined (reading 'amount')",
	url: sentryUrl,
	source: { kind: "sentry", label: "WEB-APP-3F", url: sentryUrl },
	ms: 97_000,
	costUsd: 0.21,
	outputs: [
		{
			action: "create_issue",
			summary: sentryIssue,
			status: "applied",
			url: issue(63),
		},
	],
	steps: [
		[
			"Read",
			{ file_path: "src/checkout/total.ts" },
			"export function total(cart) { … }",
		],
		[
			"Grep",
			{ pattern: "lines\\[0\\]", path: "src/checkout" },
			"src/checkout/total.ts:18",
		],
		[
			"Bash",
			{ command: "git log -3 --oneline -- src/checkout" },
			"a41c9e2 feat(checkout): coupons can cover the whole order",
		],
		proposal("create_issue", {
			title: sentryIssue,
			body: "## What happens\n…",
		}),
	],
	report: `I opened issue #63, **${sentryIssue}**.

- **The crash.** \`total()\` in \`src/checkout/total.ts\` reads \`cart.lines[0].amount\` to pick the currency. A 100% coupon removes the paid lines, so \`lines\` is empty and the read throws.
- **Since when.** Commit \`a41c9e2\` let a coupon cover the whole order, two days before the first event.
- **Who it hits.** 37 events from 21 users, all on \`/checkout\` in production.
- **The contract.** A free order shows a total of 0 in the account's currency and can be confirmed; the issue lists the cases to test.

The engine adds the Sentry link to the issue and notes the issue on WEB-APP-3F.`,
});
run({
	id: "triage-63",
	automation: "triage-issues",
	agent: "triage",
	event: "issue.opened",
	number: 63,
	title: sentryIssue,
	ms: 33_000,
	costUsd: 0.06,
	outputs: [
		{
			action: "add_labels",
			summary: "bug, ready-for-agent",
			status: "applied",
		},
	],
	steps: [proposal("add_labels", { labels: ["bug", "ready-for-agent"] })],
	report: "The investigator's issue is a complete contract: `ready-for-agent`.",
});
run({
	ago: 4,
	id: "implement-63",
	automation: "implement-ready-issues",
	agent: "implementer",
	event: "issue.labeled",
	label: "ready-for-agent",
	number: 63,
	title: sentryIssue,
	status: "running",
	steps: [
		["Read", { file_path: "src/checkout/total.ts" }, "…"],
		["Read", { file_path: "src/checkout/total.test.ts" }, "…"],
	],
});
run({
	ago: 1,
	id: "triage-65",
	automation: "triage-issues",
	agent: "triage",
	event: "issue.opened",
	number: 65,
	title: "Keyboard shortcut to add a task",
	status: "queued",
});

// --- Learning: a batch that opened an improvement, and its lessons. ---

const ago = (minutes: number) =>
	new Date(Date.now() - minutes * MIN).toISOString();
run({
	ago: 3 * 60,
	id: "learning-66",
	automation: "learning",
	agent: "learning",
	event: "schedule",
	ms: 3 * MIN,
	costUsd: 0.41,
	outputs: [
		{
			action: "create_pull_request",
			summary: "learning: end a streamed file with its error",
			status: "applied",
			url: pull(66),
		},
	],
});
writeFileSync(
	join(projectDir(REPO), "runs/learning-66/changed-files.json"),
	JSON.stringify({
		total: 1,
		files: [
			{
				path: "openfabriq/agents/implementer/agent.md",
				add: 2,
				del: 0,
				patch:
					"@@ -14,3 +14,5 @@\n Write a test for each behavior the contract describes.\n \n+When you stream a response, decide what the reader sees if it fails halfway: end the stream with an error line, log it, and test that failure.\n+\n ## When you are done\n",
			},
		],
	}),
);
const lessons = [
	{
		id: "L1",
		cause: "the implementer forgets the changelog",
		rule: "Add a line under Unreleased in CHANGELOG.md for each change a user sees.",
		target: "openfabriq/agents/implementer/agent.md",
		status: "promoted",
		failures: [
			{ id: "implement-31:review", agent: "implementer", at: ago(20 * DAY) },
			{ id: "implement-33:review", agent: "implementer", at: ago(18 * DAY) },
		],
		improvement: {
			url: pull(38),
			number: 38,
			run: "learning-38",
			at: ago(17 * DAY),
		},
		createdAt: ago(18 * DAY),
		updatedAt: ago(14 * DAY),
		resolvedAt: ago(14 * DAY),
	},
	{
		id: "L2",
		cause: "a stream that fails halfway leaves a truncated file and no error",
		rule: "When you stream a response, decide what the reader sees if it fails halfway: end the stream with an error line, log it, and test that failure.",
		target: "openfabriq/agents/implementer/agent.md",
		status: "proposed",
		failures: [
			{
				id: "implement-37:review",
				agent: "implementer",
				at: ago(9 * DAY),
			},
			{ id: "implement-44:review", agent: "implementer", at: ago(5 * DAY) },
		],
		improvement: {
			url: pull(66),
			number: 66,
			run: "learning-66",
			at: ago(3 * 60),
		},
		createdAt: ago(9 * DAY),
		updatedAt: ago(3 * 60),
	},
	{
		id: "L3",
		cause: "the implementer calls a helper that does not exist yet",
		rule: "Before you use a helper, find it with grep; write it in the same change when it is missing.",
		target: "openfabriq/skills/typescript/SKILL.md",
		status: "candidate",
		failures: [
			{ id: "implement-49:check", agent: "implementer", at: ago(3 * DAY) },
		],
		createdAt: ago(3 * 60),
		updatedAt: ago(3 * 60),
	},
];
writeFileSync(
	join(projectDir(REPO), "lessons.jsonl"),
	`${lessons.map((l) => JSON.stringify(l)).join("\n")}\n`,
);

// --- The studio. ---

const merged = new Set([pull(42), pull(45), pull(57)]);
/** A canned chat answer about the runs above, streamed like the real one. */
async function* fakeChat({ signal }: ChatTurnInput): AsyncIterable<ChatEvent> {
	const wait = (ms: number) => sleep(ms, undefined, { signal });
	yield { type: "session", sessionId: crypto.randomUUID() };
	await wait(300);
	yield { type: "reasoning", delta: "Find the failed runs of the week first." };
	yield {
		type: "tool-call",
		id: "t1",
		name: "list_runs",
		args: { status: "failed" },
	};
	await wait(600);
	yield {
		type: "tool-result",
		id: "t1",
		result: [
			{
				id: "implement-49",
				reason: 'the check "typecheck" failed (npm run typecheck)',
			},
		],
	};
	yield {
		type: "tool-call",
		id: "t2",
		name: "read_run",
		args: { id: "implement-49" },
	};
	await wait(600);
	yield { type: "tool-result", id: "t2", result: '{ "status": "failed" }' };
	for (const word of "One run failed this week: **implementer** on issue #49. Its tests passed, but `typecheck` did not: it calls `useStoredState`, a hook that does not exist yet.\n\n- The engine ran the checks before anything left the machine, so no pull request was opened.\n- Add the hook, or relabel #49 `ready-for-agent` to let the implementer try again.".split(
		/(?<= )/,
	)) {
		yield { type: "text", delta: word };
		await wait(15);
	}
	yield { type: "done", costUsd: 0.04, durationMs: 4800 };
}
const server = startStudio(Number(process.env.DOCS_SEED_PORT ?? 0), undefined, {
	chat: fakeChat,
	// Learning's improvement as GitHub would show it.
	pullDiff: async (_repo, number) =>
		number === 66
			? "diff --git a/openfabriq/agents/implementer/agent.md b/openfabriq/agents/implementer/agent.md\n--- a/openfabriq/agents/implementer/agent.md\n+++ b/openfabriq/agents/implementer/agent.md\n@@ -14,3 +14,5 @@\n Write a test for each behavior the contract describes.\n \n+When you stream a response, decide what the reader sees if it fails halfway: end the stream with an error line, log it, and test that failure.\n+\n ## When you are done\n"
			: undefined,
	subjectState: async (url) =>
		merged.has(url)
			? {
					merged: true,
					// Within the hour after its last run.
					mergedAt: new Date(
						(lastOn.get(url) ?? Date.now()) + 40 * MIN,
					).toISOString(),
					open: false,
				}
			: { merged: false, open: true },
});
await new Promise((ok) => server.once("listening", ok));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const token = readFileSync(studioTokenPath(), "utf8");
const url = `${origin}/?token=${token}`;
const p = `project=${encodeURIComponent(REPO)}`;

export { origin, p, REPO, relay, server, token, url };
