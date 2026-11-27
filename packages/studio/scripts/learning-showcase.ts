// Development only: the studio with every case of the Learning page, to work on its design. Seeds
// OPENFABRIQ_HOME (a fixed folder in the temp directory, never ~/.openfabriq) with two projects:
// acme/web-app, learning on, with failures of every kind and lessons in every state; and
// acme/docs-site, learning off, with nothing failed. Serves the built studio on 4310, the port the
// app's dev server (`pnpm --filter @openfabriq/studio dev`) reaches. Needs `pnpm build`.
//
//   OPENFABRIQ_HOME=$TMPDIR/openfabriq-learning-showcase node --experimental-strip-types scripts/learning-showcase.ts

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type {
	CommandRun,
	Lesson,
	ReviewRound,
	RunRecord,
} from "@openfabriq/runner";

process.env.OPENFABRIQ_HOME ??= join(tmpdir(), "openfabriq-learning-showcase");
// It deletes the folder first: never one that may hold a real factory's state.
if (basename(process.env.OPENFABRIQ_HOME) !== "openfabriq-learning-showcase")
	throw new Error(
		`OPENFABRIQ_HOME must be a folder named openfabriq-learning-showcase, not ${process.env.OPENFABRIQ_HOME}: the showcase deletes it.`,
	);
rmSync(process.env.OPENFABRIQ_HOME, { recursive: true, force: true });
const { appendRun, projectDir, readFactoryFolder, runDir, writeApplied } =
	await import("@openfabriq/runner");
const { startStudio } = await import("../dist/index.js");

const REPO = "acme/web-app";
const GH = `https://github.com/${REPO}`;
const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

// --- The factories ---

const agent = (
	description: string,
	body: string,
	tools = "read, edit, shell",
) => `---\ndescription: ${description}\ntools: [${tools}]\n---\n${body}\n`;
const automation = (header: string, body: string) =>
	`---\n${header}\n---\n${body}\n`;

writeApplied(
	REPO,
	{
		"factory.yaml": `name: Web app factory
repository: ${REPO}
maintainers: [alice, bob]
model: sonnet
commands:
  test: npm test
  typecheck: npm run typecheck
  lint: npm run lint
checks: [test, typecheck, lint]
learning: true
`,
		"agents/implementer/agent.md": agent(
			"Turns a ready issue into a pull request proven by the checks",
			"# Implementation\n\nMake the smallest change that does what the issue asks, with its test.",
		),
		"agents/reviewer/agent.md": agent(
			"Reads the implementer's change before the pull request opens",
			"# Review\n\nJudge the change against the issue.",
			"read, shell",
		),
		"agents/docs-writer/agent.md": agent(
			"Keeps the user guide in step with the code",
			"# Docs\n\nUpdate the guide when a behavior changes.",
		),
		"agents/fixer/agent.md": agent(
			"Answers a maintainer's requested changes on a pull request",
			"# Rework\n\nMake the changes asked, then push.",
		),
		"skills/typescript/SKILL.md":
			"---\nname: typescript\ndescription: How this project writes TypeScript\n---\n# TypeScript\n",
		"skills/testing/SKILL.md":
			"---\nname: testing\ndescription: How this project tests\n---\n# Testing\n",
		"automations/implement/automation.md": automation(
			"when:\n  issue.labeled: { labels: [ready-for-agent] }\nagent: implementer\nreviewed_by: reviewer\ncan: [create_pull_request, add_comment]",
			"Implement the issue.",
		),
		"automations/docs/automation.md": automation(
			"when:\n  issue.labeled: { labels: [docs] }\nagent: docs-writer\ncan: [create_pull_request]",
			"Update the guide.",
		),
		"automations/rework/automation.md": automation(
			"when: pull_request.changes_requested\nagent: fixer\ncan: [push_to_pull_request, add_comment]",
			"Make the requested changes.",
		),
	},
	new Date(NOW - 40 * DAY),
);
writeApplied(
	"acme/docs-site",
	{
		"factory.yaml":
			"name: Docs site\nrepository: acme/docs-site\nmaintainers: [alice]\n",
		"agents/writer/agent.md": agent("Writes pages", "# Writing"),
		"automations/write/automation.md": automation(
			"when: issue.opened\nagent: writer\ncan: [create_pull_request]",
			"Write the page.",
		),
	},
	new Date(NOW - 40 * DAY),
);

// --- The runs: failures of every kind, and the runs around them ---

let issue = 100;
function run(
	fields: Partial<RunRecord> & { id: string; at: number },
): RunRecord {
	const { at, ...rest } = fields;
	const number = rest.number ?? issue++;
	const record: RunRecord = {
		repository: REPO,
		automation: "implement",
		agent: "implementer",
		event: "issue.labeled",
		isPullRequest: false,
		status: "succeeded",
		queuedAt: ago(at + 10 * 60_000),
		startedAt: ago(at + 9 * 60_000),
		endedAt: ago(at),
		durationMs: 9 * 60_000,
		costUsd: 0.6,
		outputs: [],
		number,
		url: `${GH}/${rest.isPullRequest ? "pull" : "issues"}/${number}`,
		...rest,
	};
	appendRun(record);
	return record;
}
const keep = (id: string, name: string, value: unknown) => {
	mkdirSync(runDir(REPO, id), { recursive: true });
	writeFileSync(
		join(runDir(REPO, id), name),
		typeof value === "string" ? value : JSON.stringify(value),
	);
};
const failedCheck = (
	id: string,
	at: number,
	title: string,
	check: string,
	output: string,
	agentName = "implementer",
) => {
	run({
		id,
		at,
		title,
		agent: agentName,
		automation: agentName === "docs-writer" ? "docs" : "implement",
		status: "failed",
		reason: `the check "${check}" failed (npm run ${check})`,
	});
	const line: CommandRun = {
		kind: "check",
		name: check,
		command: `npm run ${check}`,
		ok: false,
		output,
		durationMs: 14_000,
		at: ago(at),
	};
	keep(id, "commands.jsonl", `${JSON.stringify(line)}\n`);
};
const reviewed = (
	id: string,
	at: number,
	title: string,
	summary: string,
	findings: ReviewRound["findings"],
) => {
	const record = run({
		id,
		at,
		title,
		outputs: [
			{
				action: "create_pull_request",
				status: "applied",
				summary: title,
				url: `${GH}/pull/${issue + 50}`,
			},
		],
	});
	const round: ReviewRound = {
		round: 1,
		reviewer: "reviewer",
		verdict: "needs_changes",
		summary,
		findings,
		costUsd: 0.2,
		at: ago(at + HOUR),
	} as ReviewRound;
	keep(id, "reviews.json", [round]);
	return record;
};
const opened = (id: string, at: number, number: number, title: string) =>
	run({
		id,
		at,
		title,
		outputs: [
			{
				action: "create_pull_request",
				status: "applied",
				summary: title,
				url: `${GH}/pull/${number}`,
			},
		],
	});

// Checks that kept failing.
failedCheck(
	"impl-201",
	2 * DAY,
	"Remember the last filter between visits",
	"typecheck",
	"src/filters.ts(42,7): error TS2322: Type 'string | undefined' is not assignable to type 'string'.\n  Type 'undefined' is not assignable to type 'string'.",
);
failedCheck(
	"impl-202",
	9 * DAY,
	"Show the due date in the task list",
	"typecheck",
	"src/tasks/list.tsx(18,21): error TS2532: Object is possibly 'undefined'.",
);
failedCheck(
	"impl-203",
	4 * HOUR,
	"Export tasks as CSV with their tags",
	"test",
	"✖ exports tags in the CSV (12ms)\n  AssertionError: expected 'a;b' to equal '\"a;b\"'\n    at test/export.test.ts:31:12",
);
failedCheck(
	"docs-204",
	6 * DAY,
	"Document the keyboard shortcuts",
	"lint",
	"docs/shortcuts.md:14 MD040/fenced-code-language Fenced code blocks should have a language specified",
	"docs-writer",
);
// Internal reviews that asked for changes.
reviewed(
	"impl-205",
	3 * DAY,
	"Stream the export instead of loading every task",
	"The stream has no error path: a failure halfway leaves the user with half a file and no message.",
	[
		{
			file: "src/export.ts",
			line: 58,
			problem: "No error handling when the stream fails halfway",
			suggestion:
				"End the stream with an error line, log it, and test that failure",
			blocking: true,
		},
	],
);
reviewed(
	"impl-206",
	12 * DAY,
	"Paginate the activity feed",
	"The cursor is read from the URL without validation, and a test is missing for the last page.",
	[
		{
			file: "src/feed.ts",
			line: 22,
			problem: "The cursor from the URL is trusted as a number",
			blocking: true,
		},
		{
			file: "test/feed.test.ts",
			problem: "No test for the last page",
			blocking: true,
		},
		{ problem: "The page size could be a named constant", blocking: false },
	],
);
reviewed(
	"impl-207",
	20 * DAY,
	"Add a CSV import for tasks",
	"Same error path missing as in the export: a bad row stops the import silently.",
	[
		{
			file: "src/import.ts",
			line: 40,
			problem: "A malformed row ends the import without telling the user",
			blocking: true,
		},
	],
);
// A run that failed its review, then its checks: two failures, one incident.
const renamed = reviewed(
	"impl-208",
	26 * DAY,
	"Rename a tag everywhere it is used",
	"Renaming does not update the saved filters.",
	[
		{
			file: "src/tags.ts",
			line: 77,
			problem: "Saved filters keep the old tag name",
			blocking: true,
		},
	],
);
keep(
	"impl-208",
	"commands.jsonl",
	`${JSON.stringify({ kind: "check", name: "test", command: "npm test", ok: false, output: "✖ renames the tag in saved filters", durationMs: 9000, at: ago(26 * DAY) })}\n`,
);
appendRun({
	...renamed,
	status: "failed",
	reason: 'the check "test" failed (npm test)',
	outputs: [],
});
// Failed checks on GitHub, and a maintainer's requested changes, on pull requests the factory opened.
opened("impl-210", 5 * DAY, 310, "Add dark mode to the settings page");
run({
	id: "fix-211",
	at: 4 * DAY,
	number: 310,
	isPullRequest: true,
	event: "pull_request.checks_failed",
	automation: "rework",
	agent: "fixer",
	title: "Add dark mode to the settings page",
});
keep("fix-211", "failed-checks.json", [
	{
		name: "e2e (chromium)",
		conclusion: "failure",
		log: "settings.spec.ts:12 expected the theme toggle to be visible",
	},
]);
opened("impl-212", 7 * DAY, 312, "Let people pin a project to the top");
run({
	id: "fix-213",
	at: 6 * DAY,
	number: 312,
	isPullRequest: true,
	event: "pull_request.changes_requested",
	automation: "rework",
	agent: "fixer",
	requestedBy: "alice",
	title: "Let people pin a project to the top",
});
opened("impl-214", 8 * DAY, 314, "Sort projects by last activity");
run({
	id: "fix-215",
	at: 7 * DAY,
	number: 314,
	isPullRequest: true,
	event: "pull_request.changes_requested",
	automation: "rework",
	agent: "fixer",
	requestedBy: "bob",
	title: "Sort projects by last activity",
});
// A failure after an improvement ran: it came back.
failedCheck(
	"impl-216",
	1 * DAY,
	"Store the user's time zone",
	"typecheck",
	"src/profile.ts(9,3): error TS2322: Type 'string | undefined' is not assignable to type 'string'.",
);
// Runs that went well, so the page is not only failures.
for (let i = 0; i < 14; i++)
	run({
		id: `ok-${i}`,
		at: i * 2 * DAY + 3 * HOUR,
		title: `A small change ${i}`,
	});

// --- The lessons, in every state ---

const failure = (
	id: string,
	agentName: string,
	at: number,
	number?: number,
) => ({
	id,
	agent: agentName,
	at: ago(at),
	...(number ? { url: `${GH}/issues/${number}` } : {}),
});
const lesson = (
	fields: Partial<Lesson> &
		Pick<Lesson, "id" | "cause" | "rule" | "target" | "failures" | "status">,
): Lesson => ({
	createdAt: ago(30 * DAY),
	updatedAt: ago(DAY),
	...fields,
});
const improvement = (number: number, at: number) => ({
	url: `${GH}/pull/${number}`,
	number,
	run: `learning-${number}`,
	at: ago(at),
});
const lessons: Lesson[] = [
	// Merged a month ago, applied, and the cause came back once.
	lesson({
		id: "L1",
		cause:
			"Values that can be undefined are passed where a string is expected.",
		rule: "Narrow every optional value before you pass it on: a guard, a default, or an early return. Never silence the compiler with `!` or `as`.",
		target: "openfabriq/skills/typescript/SKILL.md",
		failures: [
			failure("impl-202:check", "implementer", 9 * DAY),
			failure("impl-201:check", "implementer", 2 * DAY),
			failure("impl-216:check", "implementer", DAY),
		],
		status: "promoted",
		improvement: improvement(61, 8 * DAY),
		mergedAt: ago(7 * DAY),
		resolvedAt: ago(6 * DAY),
		updatedAt: ago(DAY),
	}),
	// To review: an open improvement, from two agents' work.
	lesson({
		id: "L2",
		cause:
			"Streams and imports have no error path: a failure halfway leaves the user with half a result and no message.",
		rule: "When you stream or import, decide what the user sees if it fails halfway: end with an error line, log it, and write a test for that failure.",
		target: "openfabriq/agents/implementer/agent.md",
		failures: [
			failure("impl-207:review", "implementer", 20 * DAY, 107),
			failure("impl-205:review", "implementer", 3 * DAY, 105),
		],
		status: "proposed",
		improvement: improvement(66, 2 * HOUR),
		updatedAt: ago(2 * HOUR),
	}),
	// To review: a long rule, from a maintainer's requested changes.
	lesson({
		id: "L3",
		cause:
			"Lists are sorted or pinned without a stable order for equal values, so items jump between reloads and the maintainers ask for a fix each time.",
		rule: "Whenever you sort a list that people see, sort by the field asked for, then by a stable second key (the creation date, then the id), and add a test with two items that tie on the first key. Say in the pull request which key breaks ties.",
		target: "openfabriq/skills/testing/SKILL.md",
		failures: [
			failure("fix-213:changes_requested", "implementer", 6 * DAY, 312),
			failure("fix-215:changes_requested", "implementer", 7 * DAY, 314),
		],
		status: "proposed",
		improvement: improvement(68, 5 * HOUR),
		updatedAt: ago(5 * HOUR),
	}),
	// Candidates: one failure, needs two.
	lesson({
		id: "L4",
		cause: "Input read from the URL is trusted without validation.",
		rule: "Validate every value read from the URL: its type, its range, and what happens when it is missing.",
		target: "openfabriq/agents/implementer/agent.md",
		failures: [failure("impl-206:review", "implementer", 12 * DAY, 106)],
		status: "candidate",
		updatedAt: ago(12 * DAY),
	}),
	lesson({
		id: "L5",
		cause: "Code blocks in the guide have no language, so the docs lint fails.",
		rule: "Give every fenced code block in docs/ its language: bash, ts, json.",
		target: "openfabriq/agents/docs-writer/agent.md",
		failures: [failure("docs-204:check", "docs-writer", 6 * DAY, 104)],
		status: "candidate",
		updatedAt: ago(6 * DAY),
	}),
	// Two failures, one run: still a candidate.
	lesson({
		id: "L6",
		cause:
			"A rename does not reach the saved data that refers to the old name.",
		rule: "When you rename something people saved, migrate every stored reference and test the saved copy.",
		target: "openfabriq/agents/implementer/agent.md",
		failures: [
			failure("impl-208:review", "implementer", 26 * DAY, 108),
			failure("impl-208:check", "implementer", 26 * DAY, 108),
		],
		status: "candidate",
		updatedAt: ago(25 * DAY),
	}),
	// Its improvement came to nothing: it waits for a new failure.
	lesson({
		id: "L7",
		cause:
			"End-to-end tests look for elements before the page has rendered them.",
		rule: "In an end-to-end test, wait for the element by its role before you assert on it; never on a fixed delay.",
		target: "openfabriq/skills/testing/SKILL.md",
		failures: [
			failure("fix-211:checks_failed", "implementer", 4 * DAY, 310),
			failure("old-1:checks_failed", "implementer", 15 * DAY),
		],
		status: "candidate",
		updatedAt: ago(4 * DAY),
		triedAt: ago(3 * DAY),
	}),
	// Merged, applied, nothing came back.
	lesson({
		id: "L8",
		cause: "Tests write to the real clock, so they fail around midnight.",
		rule: "Inject the clock: every test that depends on today passes a fixed date.",
		target: "openfabriq/skills/testing/SKILL.md",
		failures: [
			failure("old-2:check", "implementer", 35 * DAY),
			failure("old-3:check", "implementer", 33 * DAY),
		],
		status: "promoted",
		improvement: improvement(52, 30 * DAY),
		mergedAt: ago(29 * DAY),
		resolvedAt: ago(28 * DAY),
		updatedAt: ago(28 * DAY),
	}),
	// Merged but not applied yet: Came back cannot count.
	lesson({
		id: "L9",
		cause: "The changelog line is forgotten for user-facing changes.",
		rule: "Add one line under `## Unreleased` in CHANGELOG.md for every change a user can see.",
		target: "openfabriq/agents/implementer/agent.md",
		failures: [
			failure("old-4:review", "implementer", 14 * DAY),
			failure("old-5:review", "implementer", 13 * DAY),
		],
		status: "promoted",
		improvement: improvement(64, 2 * DAY),
		mergedAt: ago(20 * HOUR),
		resolvedAt: ago(18 * HOUR),
		updatedAt: ago(18 * HOUR),
	}),
	// Closed without merge: never proposed again.
	lesson({
		id: "L10",
		cause: "The agent adds a dependency for a few lines of code.",
		rule: "Never add a package for what ten lines of the standard library do.",
		target: "openfabriq/agents/implementer/agent.md",
		failures: [
			failure("old-6:review", "implementer", 22 * DAY),
			failure("old-7:review", "implementer", 21 * DAY),
		],
		status: "rejected",
		improvement: improvement(58, 19 * DAY),
		resolvedAt: ago(17 * DAY),
		updatedAt: ago(17 * DAY),
	}),
	// Ignored: learning judged the failures outside the agents' hands.
	lesson({
		id: "L11",
		cause:
			"The CI runner ran out of disk space during the tests: nothing in the agent's change caused it.",
		rule: "",
		target: "",
		failures: [
			failure("before-0:check", "implementer", 39 * DAY),
			failure("before-3:check", "implementer", 39 * DAY - 18 * HOUR),
		],
		status: "ignored",
		updatedAt: ago(38 * DAY),
	}),
];
writeFileSync(
	join(projectDir(REPO), "lessons.jsonl"),
	lessons.map((l) => `${JSON.stringify(l)}\n`).join(""),
);
// The runs before and after the first rule applied 26 days ago, what the rate divides by: one in
// three failed its tests before, none of the later ones did.
for (let i = 0; i < 48; i++) {
	const at = 39 * DAY - i * 6 * HOUR;
	if (i % 3 === 0)
		failedCheck(`before-${i}`, at, "Small fix", "test", "✖ 1 test failed");
	else run({ id: `before-${i}`, at, title: "Small fix" });
}
for (let i = 0; i < 90; i++)
	run({ id: `after-${i}`, at: 25 * DAY - i * 6 * HOUR, title: "Small fix" });
// Learning's last batch, two hours ago: the page says when it ran.
run({
	id: "learning-batch",
	at: 2 * HOUR,
	automation: "learning",
	agent: "learning",
	event: "schedule",
	title: "Learning batch",
});
// An apply after L1's and L8's merges, none after L9's.
const applied = readFactoryFolder(join(projectDir(REPO), "factory"));
writeApplied(REPO, applied, new Date(NOW - 26 * DAY));
writeApplied(REPO, applied, new Date(NOW - 5 * DAY));

// --- The studio, with GitHub faked ---

const DIFF = (path: string, added: string) =>
	`diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -12,3 +12,5 @@\n Make the smallest change that does what the issue asks, with its test.\n \n+${added}\n+\n ## When you are done\n`;
const server = startStudio(4310, undefined, {
	pullDiff: async (_repo, number) =>
		number === 66
			? DIFF(
					"openfabriq/agents/implementer/agent.md",
					"When you stream or import, decide what the user sees if it fails halfway: end with an error line, log it, and write a test for that failure.",
				)
			: number === 68
				? DIFF(
						"openfabriq/skills/testing/SKILL.md",
						"Whenever you sort a list that people see, sort by the field asked for, then by a stable second key.",
					)
				: undefined,
	subjectState: async () => ({ merged: false, open: true }),
});
await new Promise((ok) => server.once("listening", ok));
const { readFileSync } = await import("node:fs");
const token = readFileSync(
	join(process.env.OPENFABRIQ_HOME, "viewer-token"),
	"utf8",
);
console.log(
	`Showcase studio: http://127.0.0.1:4310/?token=${token}#/learning?project=acme%2Fweb-app`,
);
console.log(`Data: ${process.env.OPENFABRIQ_HOME}`);
