import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { secretNames } from "../../src/factory/env.js";
import { loadFactory } from "../../src/factory/load.js";
import { scriptOf } from "../../src/factory/scripts.js";
import { whenText } from "../../src/factory/text.js";
import type { FactoryFiles } from "../../src/factory/types.js";
import { example, ROOT, readFolder } from "../helpers.js";

const FACTORY = "name: F\nrepository: acme/app\nmaintainers: [alice]\n";
const AGENT = "---\ndescription: Does things\n---\nDo things.\n";

function minimal(automation: string, extra: FactoryFiles = {}): FactoryFiles {
	return {
		"factory.yaml": FACTORY,
		"agents/worker/agent.md": AGENT,
		"automations/run/automation.md": `---\n${automation}\n---\nGo.\n`,
		...extra,
	};
}

const messages = (files: FactoryFiles) =>
	loadFactory(files).problems.map((p) => `${p.file}: ${p.message}`);

describe("the examples", () => {
	it.each(readdirSync(join(ROOT, "examples")))("%s is valid", (name) => {
		expect(messages(example(name))).toEqual([]);
	});

	it("01-quickstart is valid", () => {
		const { factory, problems } = loadFactory(example("01-quickstart"));
		expect(problems).toEqual([]);
		expect(factory?.automations["implement-ready-issues"]).toEqual({
			name: "implement-ready-issues",
			when: [{ event: "issue.labeled", labels: ["ready-for-agent"] }],
			agent: "implementer",
			can: [
				{ action: "create_pull_request" },
				{ action: "add_comment" },
				{ action: "remove_labels", labels: ["ready-for-agent"] },
			],
			concurrency: "issue",
			from: "maintainers",
			instructions: expect.stringContaining("Implement it"),
		});
	});

	it("00-at-a-glance keeps a skill for its implementer only", () => {
		const { factory, problems } = loadFactory(example("00-at-a-glance"));
		expect(problems).toEqual([]);
		expect(factory?.skills).toEqual(["writing-for-maintainers"]);
		expect(factory?.agents.implementer?.skills).toEqual([
			"test-driven-development",
		]);
		expect(factory?.automations["implement-ready-issues"]?.reviewedBy).toBe(
			"reviewer",
		);
	});

	it("02-sdlc is valid, with skills shared by its agents", () => {
		const { factory, problems } = loadFactory(example("02-sdlc"));
		expect(problems).toEqual([]);
		expect(Object.keys(factory?.agents ?? {}).sort()).toEqual([
			"implementer",
			"investigator",
			"reviewer",
			"triage",
		]);
		expect(factory?.automations["implement-ready-issues"]?.reviewedBy).toBe(
			"reviewer",
		);
		expect(factory?.skills).toEqual([
			"browser-evidence",
			"test-driven-development",
		]);
		expect(factory?.agents.implementer?.skills).toEqual([]);
		expect(factory?.agents.implementer?.model).toBe("opus");
		expect(factory?.automations["triage-issues"]?.can).toEqual([
			{ action: "add_comment" },
			{
				action: "add_labels",
				labels: [
					"ready-for-agent",
					"needs-info",
					"needs-investigation",
					"needs-human",
					"bug",
					"feature",
					"docs",
					"chore",
				],
			},
			{ action: "remove_labels", labels: ["needs-info"] },
		]);
		expect(factory?.limits.review_rounds).toBe(3);
	});
});

describe("defaults", () => {
	it("fills model, tools, limits, concurrency and from", () => {
		const { factory, problems } = loadFactory(
			minimal("when: issue.opened\nagent: worker"),
		);
		expect(problems).toEqual([]);
		expect(factory?.model).toBe("sonnet");
		expect(factory?.limits).toEqual({
			usd_per_run: 5,
			usd_per_day: 30,
			minutes_per_run: 45,
			review_rounds: 3,
		});
		expect(factory?.agents.worker?.tools).toEqual(["read"]);
		expect(factory?.automations.run).toMatchObject({
			can: [],
			concurrency: "issue",
			from: "maintainers",
		});
	});
});

describe("when", () => {
	it("accepts a word, a list or a map", () => {
		const forms = [
			"when: [pull_request.opened, pull_request.updated]",
			"when:\n  pull_request.opened:\n  pull_request.updated: {}",
		];
		for (const form of forms) {
			const { factory, problems } = loadFactory(
				minimal(`${form}\nagent: worker`),
			);
			expect(problems).toEqual([]);
			expect(factory?.automations.run?.when).toEqual([
				{ event: "pull_request.opened" },
				{ event: "pull_request.updated" },
			]);
		}
	});

	it("tells a factory written with `on` that the key is now `when`", () => {
		expect(messages(minimal("on: issue.opened\nagent: worker"))).toEqual([
			'automations/run/automation.md: the key "on" is now called "when"',
			"automations/run/automation.md: when is required",
		]);
	});

	it("suggests the closest event", () => {
		expect(messages(minimal("when: issue.label\nagent: worker"))).toEqual([
			'automations/run/automation.md: unknown event "issue.label" in when. Did you mean "issue.labeled"?',
		]);
	});

	it("allows labels only on labeled events, and needs a valid cron for schedule", () => {
		expect(
			messages(
				minimal(
					'when:\n  issue.opened: { labels: [x] }\n  schedule: { cron: "61 * * * *" }\nagent: worker',
				),
			),
		).toEqual([
			"automations/run/automation.md: when.issue.opened does not take labels; only issue.labeled, pull_request.labeled, linear.issue.labeled, issue.commented and pull_request.commented do",
			"automations/run/automation.md: when.schedule.cron: minute must be between 0 and 59, got 61",
		]);
	});

	it("reads opened_by on pull request events: the agent whose run opened the pull request", () => {
		const { factory, problems } = loadFactory(
			minimal(
				"when:\n  pull_request.opened: { opened_by: worker }\nagent: worker",
			),
		);
		expect(problems).toEqual([]);
		expect(factory?.automations.run?.when).toEqual([
			{ event: "pull_request.opened", openedBy: "worker" },
		]);
		expect(whenText(factory?.automations.run as never)).toBe(
			"pull_request.opened (opened by worker)",
		);
		// The pull requests of one agent narrow its comments enough: no warning.
		expect(
			messages(
				minimal(
					"when:\n  pull_request.commented: { opened_by: worker }\nagent: worker",
				),
			),
		).toEqual([]);
		expect(
			messages(
				minimal("when:\n  issue.opened: { opened_by: worker }\nagent: worker"),
			),
		).toEqual([
			"automations/run/automation.md: when.issue.opened does not take opened_by; only pull_request events do",
		]);
		expect(
			messages(
				minimal(
					"when:\n  pull_request.opened: { opened_by: workr }\nagent: worker",
				),
			),
		).toEqual([
			'automations/run/automation.md: when.pull_request.opened.opened_by: agent "workr" does not exist. Did you mean "worker"?',
		]);
	});

	it("reads reviewed_by: the agent that reviews the change before the pull request exists", () => {
		const reviewer = {
			"agents/checker/agent.md":
				"---\ndescription: Reviews\ntools: [read, commands]\n---\nReview.\n",
			"factory.yaml": `${FACTORY}commands: { test: npm test }\n`,
		};
		const { factory, problems } = loadFactory(
			minimal(
				"when: issue.opened\nagent: worker\nreviewed_by: checker\ncan: [create_pull_request]",
				reviewer,
			),
		);
		expect(problems).toEqual([]);
		expect(factory?.automations.run?.reviewedBy).toBe("checker");
		// Named only by reviewed_by, an agent is still used: no warning.
		expect(
			messages(
				minimal(
					"when: issue.opened\nagent: worker\nreviewed_by: chekcer\ncan: [create_pull_request]",
					reviewer,
				),
			),
		).toEqual([
			'automations/run/automation.md: reviewed_by: agent "chekcer" does not exist. Did you mean "checker"?',
			"agents/checker/agent.md: no automation uses this agent",
		]);
		expect(
			messages(
				minimal(
					"when: issue.opened\nagent: worker\nreviewed_by: worker\ncan: [create_pull_request]",
				),
			),
		).toEqual([
			"automations/run/automation.md: reviewed_by names worker, the agent of this automation: an agent does not review its own change; name another agent",
		]);
		expect(
			messages(
				minimal(
					"when: issue.opened\nagent: worker\nreviewed_by: checker\ncan: [add_comment]",
					reviewer,
				),
			),
		).toEqual([
			"automations/run/automation.md: reviewed_by reviews code before it leaves the machine, and this automation publishes none: can has neither create_pull_request nor push_to_pull_request",
		]);
		expect(
			messages(
				minimal(
					"when: issue.opened\nagent: worker\nreviewed_by: checker\ncan: [create_pull_request]",
					{
						"agents/checker/agent.md":
							"---\ndescription: Reviews\ntools: [read, edit]\n---\nReview.\n",
					},
				),
			),
		).toEqual([
			"automations/run/automation.md: reviewed_by names checker, which can edit files: a reviewer reads the change, it never changes it; remove edit from its tools",
		]);
	});

	it("needs at least one event", () => {
		expect(messages(minimal("when: []\nagent: worker"))).toEqual([
			"automations/run/automation.md: when needs at least one event",
		]);
	});

	it("says each misplaced filter of a trigger, in a fixed order", () => {
		expect(
			messages(
				minimal(
					'when:\n  issue.opened: { mentions: "@x", webhook: w, query: q, ignore_paths: [a], cron: "0 9 * * 1", labels: [x] }\n  webhook.received: { labels: [] }\n  schedule: { labels: [y] }\nagent: worker',
				),
			).map((m) => m.replace("automations/run/automation.md: ", "")),
		).toEqual([
			"when.issue.opened does not take labels; only issue.labeled, pull_request.labeled, linear.issue.labeled, issue.commented and pull_request.commented do",
			"when.issue.opened does not take a cron; only schedule does",
			"when.issue.opened does not take ignore_paths; only pull_request events do",
			"when.issue.opened does not take a query; only sentry.issue.created does",
			"when.issue.opened does not take a webhook; only webhook.received does",
			"when.issue.opened does not take mentions; only issue.commented and pull_request.commented do",
			"when.webhook.received.labels is empty: list at least one label, or remove labels to start on any label",
			"when.webhook.received needs the webhook's name, for example { webhook: deploy-failed }",
			"when.schedule does not take labels; only issue.labeled, pull_request.labeled, linear.issue.labeled, issue.commented and pull_request.commented do",
			'when.schedule needs a cron, for example { cron: "0 9 * * 1" }',
		]);
	});
});

describe("can and tools", () => {
	it("suggests the closest word", () => {
		expect(
			messages(
				minimal("when: issue.opened\nagent: worker\ncan: [add_coment]", {
					"agents/worker/agent.md":
						"---\ndescription: D\ntools: [read, bash]\n---\nDo.\n",
				}),
			),
		).toEqual([
			'agents/worker/agent.md: unknown tool "bash" in tools. Use one of: read, edit, shell, web, commands',
			'automations/run/automation.md: unknown permission "add_coment" in can. Did you mean "add_comment"?',
		]);
	});

	it("refuses empty label lists and a repeated word", () => {
		expect(
			messages(
				minimal(
					"when:\n  issue.labeled: { labels: [] }\nagent: worker\ncan:\n  - add_labels: []\n  - add_comment\n  - add_comment",
				),
			),
		).toEqual([
			"automations/run/automation.md: when.issue.labeled.labels is empty: list at least one label, or remove labels to start on any label",
			"automations/run/automation.md: can.add_labels is empty: list at least one label, or write add_labels alone to allow any label",
			"automations/run/automation.md: can lists add_comment twice; keep one",
		]);
	});

	it("takes a list of labels only for add_labels, remove_labels, create_issue and create_pull_request", () => {
		expect(
			messages(
				minimal(
					"when: issue.opened\nagent: worker\ncan:\n  - add_comment: [x]",
				),
			),
		).toEqual([
			"automations/run/automation.md: can.add_comment does not take a list of labels; only add_labels, remove_labels, create_issue and create_pull_request do",
		]);
		expect(
			messages(
				minimal(
					'when:\n  schedule: { cron: "0 9 * * 1" }\nagent: worker\ncan:\n  - create_issue: [security-unit]',
				),
			),
		).toEqual([]);
	});

	it("refuses an automation that listens to a label it puts on the issues it opens", () => {
		expect(
			messages(
				minimal(
					"when:\n  issue.labeled: { labels: [unit] }\nagent: worker\ncan:\n  - create_issue: [Unit, finding]",
				),
			),
		).toEqual([
			"automations/run/automation.md: can.create_issue puts the label Unit on the issues it opens, which starts this automation again",
		]);
		expect(
			messages(
				minimal(
					"when: issue.labeled\nagent: worker\ncan:\n  - create_issue: [finding]",
				),
			),
		).toEqual([
			"automations/run/automation.md: can.create_issue puts labels on the issues it opens, and when issue.labeled has no labels filter, so they start this automation again",
		]);
		expect(
			messages(
				minimal(
					"when:\n  issue.labeled: { labels: [unit] }\nagent: worker\ncan:\n  - create_issue: [finding]",
				),
			),
		).toEqual([]);
	});
});

describe("rules", () => {
	it("refuses an automation that would start itself again", () => {
		expect(
			messages(
				minimal(
					"when:\n  issue.labeled: { labels: [go] }\n  pull_request.updated:\nagent: worker\ncan:\n  - push_to_pull_request\n  - add_labels: [go]",
				),
			),
		).toEqual([
			"automations/run/automation.md: can.push_to_pull_request updates a pull request, which starts this automation again (when pull_request.updated)",
			"automations/run/automation.md: can.add_labels can add the label go, which starts this automation again",
		]);
	});

	it("sees a label it adds as the one it listens to, whatever the case", () => {
		expect(
			messages(
				minimal(
					"when:\n  issue.labeled: { labels: [Go] }\nagent: worker\ncan:\n  - add_labels: [go]",
				),
			),
		).toEqual([
			"automations/run/automation.md: can.add_labels can add the label go, which starts this automation again",
		]);
	});

	it("keeps openfabriq:working to the engine: no trigger listens to it, no permission lists it", () => {
		expect(
			messages(
				minimal(
					"when:\n  pull_request.labeled: { labels: [OpenFabriq:Working] }\nagent: worker\ncan:\n  - remove_labels: [openfabriq:working]\n  - add_comment",
				),
			),
		).toEqual([
			"automations/run/automation.md: when.pull_request.labeled listens to openfabriq:working, the label the engine puts while a run works: it never starts anything",
			"automations/run/automation.md: can.remove_labels lists openfabriq:working, the label the engine puts while a run works: only the engine puts it and takes it off",
		]);
	});

	it("refuses pushing to a pull request whose failed checks start the automation", () => {
		expect(
			messages(
				minimal(
					'when:\n  pull_request.checks_failed:\n  pull_request.commented: { mentions: "@openfabriq" }\n  default_branch.updated:\nagent: worker\ncan: [push_to_pull_request]',
				),
			),
		).toEqual([
			"automations/run/automation.md: can.push_to_pull_request runs the checks again, which can start this automation again (when pull_request.checks_failed)",
		]);
	});

	it("treats an unrestricted add_labels as able to add any label", () => {
		expect(
			messages(
				minimal("when: issue.labeled\nagent: worker\ncan: [add_labels]"),
			),
		).toEqual([
			"automations/run/automation.md: can.add_labels can add labels, and when issue.labeled has no labels filter, so any label starts this automation again",
		]);
		expect(
			messages(
				minimal(
					"when:\n  issue.labeled: { labels: [go, Ready] }\nagent: worker\ncan: [add_labels]",
				),
			),
		).toEqual([
			"automations/run/automation.md: can.add_labels can add any label, including go, Ready, which starts this automation again. List the labels it may add",
		]);
	});

	it("refuses a permission that none of the automation's events can use", () => {
		expect(
			messages(
				minimal(
					'when:\n  issue.opened:\n  schedule: { cron: "0 9 * * 1" }\nagent: worker\ncan: [push_to_pull_request, add_comment]',
				),
			),
		).toEqual([
			"automations/run/automation.md: can.push_to_pull_request fits none of the events in when (issue.opened, schedule): only on a pull request",
		]);
		expect(
			messages(
				minimal(
					"when: pull_request.changes_requested\nagent: worker\ncan: [create_pull_request]",
				),
			),
		).toEqual([
			"automations/run/automation.md: can.create_pull_request fits none of the events in when (pull_request.changes_requested): not from a pull request",
		]);
		expect(
			messages(
				minimal(
					'when:\n  schedule: { cron: "0 9 * * 1" }\nagent: worker\ncan: [add_comment, create_issue]',
				),
			),
		).toEqual([
			"automations/run/automation.md: can.add_comment fits none of the events in when (schedule): this run has no issue or pull request",
		]);
	});

	it("closes only an issue with close_issue and only a pull request with close_pr", () => {
		expect(
			messages(
				minimal(
					"when: [issue.opened, pull_request.opened]\nagent: worker\ncan: [close_issue, close_pr]",
				),
			),
		).toEqual([]);
		expect(
			messages(
				minimal(
					'when:\n  issue.labeled:\n  schedule: { cron: "0 9 * * 1" }\nagent: worker\ncan: [close_issue, close_pr]',
				),
			),
		).toEqual([
			"automations/run/automation.md: can.close_pr fits none of the events in when (issue.labeled, schedule): only on a pull request",
		]);
		expect(
			messages(
				minimal(
					"when: [pull_request.opened, default_branch.updated]\nagent: worker\ncan: [close_issue]",
				),
			),
		).toEqual([
			"automations/run/automation.md: can.close_issue fits none of the events in when (pull_request.opened, default_branch.updated): only on an issue",
		]);
	});

	it("merges a pull request only under conditions the factory wrote", () => {
		const loaded = loadFactory(
			minimal(
				'when: pull_request.opened\nagent: worker\ncan:\n  - merge_pull_request: { labels: ["risk:low"], only_paths: ["docs/**"], except_paths: ["docs/legal/**"] }',
			),
		);
		expect(loaded.problems).toEqual([]);
		expect(loaded.factory?.automations.run?.can).toEqual([
			{
				action: "merge_pull_request",
				merge: {
					labels: ["risk:low"],
					only_paths: ["docs/**"],
					except_paths: ["docs/legal/**"],
				},
			},
		]);
		const needsCondition =
			'automations/run/automation.md: can.merge_pull_request needs at least one condition: labels, only_paths or except_paths, for example { only_paths: ["docs/**"] }';
		expect(
			messages(
				minimal(
					"when: pull_request.opened\nagent: worker\ncan: [merge_pull_request]",
				),
			),
		).toEqual([needsCondition]);
		expect(
			messages(
				minimal(
					"when: pull_request.opened\nagent: worker\ncan:\n  - merge_pull_request: [risk:low]",
				),
			),
		).toEqual([needsCondition]);
		expect(
			messages(
				minimal(
					'when: issue.opened\nagent: worker\ncan:\n  - add_comment: { paths: ["docs/**"] }',
				),
			),
		).toEqual([
			"automations/run/automation.md: can.add_comment does not take conditions; only merge_pull_request does",
		]);
		expect(
			messages(
				minimal(
					'when: [issue.labeled, issue.opened]\nagent: worker\ncan:\n  - merge_pull_request: { paths: ["docs/**"] }',
				),
			),
		).toEqual([
			"automations/run/automation.md: can.merge_pull_request fits none of the events in when (issue.labeled, issue.opened): only on a pull request",
		]);
		expect(
			messages(
				minimal(
					'when: pull_request.opened\nagent: worker\nfrom: anyone\ncan:\n  - merge_pull_request: { paths: ["docs/**"] }',
				),
			),
		).toEqual([
			"automations/run/automation.md: can.merge_pull_request is refused with from: anyone: a run started by someone who is not a maintainer never merges",
		]);
	});

	it("reads paths, the old name of only_paths, and refuses both at once", () => {
		const loaded = loadFactory(
			minimal(
				'when: pull_request.opened\nagent: worker\ncan:\n  - merge_pull_request: { paths: ["docs/**"] }',
			),
		);
		expect(loaded.problems).toEqual([]);
		expect(loaded.factory?.automations.run?.can).toEqual([
			{ action: "merge_pull_request", merge: { only_paths: ["docs/**"] } },
		]);
		expect(
			messages(
				minimal(
					'when: pull_request.opened\nagent: worker\ncan:\n  - merge_pull_request: { only_paths: ["docs/**"], paths: ["src/**"] }',
				),
			),
		).toEqual([
			"automations/run/automation.md: can.merge_pull_request gives both only_paths and paths, its old name: keep only_paths",
		]);
	});

	it("starts on a pull request in conflict, and may push its resolution", () => {
		expect(
			messages(
				minimal(
					"when: pull_request.conflicted\nagent: worker\ncan: [push_to_pull_request, add_comment]",
				),
			),
		).toEqual([]);
	});

	it("suggests nothing when factory.yaml has nothing to choose from", () => {
		expect(
			messages(
				minimal(
					"when:\n  webhook.received: { webhook: deploy }\nagent: worker\ncan: [create_issue]",
					{
						"agents/worker/agent.md":
							"---\ndescription: D\nmcp:\n  sentry: [search_issues]\n---\nDo.\n",
					},
				),
			),
		).toEqual([
			'agents/worker/agent.md: mcp.sentry: no server "sentry" in factory.yaml.',
			'automations/run/automation.md: when.webhook.received names "deploy", which is not in webhooks of factory.yaml.',
		]);
	});

	it("refuses a maintainer written with @: GitHub never sends the @", () => {
		expect(
			messages({
				...minimal("when: issue.opened\nagent: worker"),
				"factory.yaml": FACTORY.replace("[alice]", '[alice, "@bob"]'),
			}),
		).toEqual([
			'factory.yaml: maintainers lists "@bob": a GitHub login, without @, like bob',
		]);
	});

	it("checks repository and agent names, and refuses the old board key", () => {
		expect(
			messages({
				...minimal("when: issue.opened\nagent: workr"),
				"factory.yaml": `${FACTORY.replace("acme/app", "app")}board: [worker, ghost]\n`,
			}),
		).toEqual([
			'factory.yaml: the key "board" is no longer needed: the studio orders agents along the workflow',
			'factory.yaml: repository: must look like "owner/name", got "app"',
			'automations/run/automation.md: agent "workr" does not exist. Did you mean "worker"?',
			"agents/worker/agent.md: no automation uses this agent",
		]);
	});
});

describe("files", () => {
	it("reports an automation folder without automation.md, and keys of every object", () => {
		expect(
			messages(
				minimal("when: issue.opened\nagent: worker\nconstructor: x", {
					"automations/y/automaton.md": "---\nwhen: issue.opened\n---\n",
				}),
			),
		).toEqual([
			"automations/y: missing automations/y/automation.md",
			'automations/run/automation.md: unknown key "constructor". Use one of: when, agent, reviewed_by, can, concurrency, from',
		]);
	});

	it("refuses an agent or automation folder whose name a branch cannot carry", () => {
		const files = minimal("when: issue.opened\nagent: worker");
		expect(
			messages({
				...files,
				"automations/Nightly Check/automation.md":
					files["automations/run/automation.md"] ?? "",
				"agents/My_Agent/agent.md": AGENT,
			}),
		).toEqual([
			"agents/My_Agent: an agent's name is its folder's: lowercase letters, digits and -, like reviewer",
			"automations/Nightly Check: an automation's name is its folder's: lowercase letters, digits and -, like nightly-check",
			"agents/My_Agent/agent.md: no automation uses this agent",
		]);
	});

	it("reads a file that starts with a byte order mark", () => {
		expect(
			messages(
				minimal("when: issue.opened\nagent: worker", {
					"agents/worker/agent.md": `\uFEFF${AGENT}`,
				}),
			),
		).toEqual([]);
	});

	it("needs factory.yaml", () => {
		expect(messages({})).toEqual([
			"factory.yaml: missing; every factory starts with it",
		]);
	});

	it("reports invalid YAML and a missing header", () => {
		expect(
			messages(
				minimal("when: issue.opened\nagent: worker", {
					"agents/worker/agent.md": "Just prose.\n",
					"automations/other/automation.md": "---\nwhen: [\n---\nGo.\n",
				}),
			),
		).toEqual([
			"agents/worker/agent.md: must start with a header between two --- lines",
			expect.stringMatching(
				/^automations\/other\/automation\.md: invalid YAML: /,
			),
		]);
	});
});

it("reports every problem of an invalid factory at once", () => {
	const files = readFolder(
		join(ROOT, "fixtures/invalid/many-problems/openfabriq"),
	);
	const { factory, problems } = loadFactory(files);
	expect(factory).toBeUndefined();
	expect(problems.map((p) => `${p.level} ${p.file}: ${p.message}`)).toEqual([
		"error agents/flat.md: an agent is a folder: move it to agents/flat/agent.md",
		'error factory.yaml: unknown key "maintainer". Did you mean "maintainers"?',
		'error factory.yaml: the key "board" is no longer needed: the studio orders agents along the workflow',
		'error factory.yaml: repository: must look like "owner/name", got "not-a-repo"',
		"error factory.yaml: maintainers is required",
		"error agents/empty: missing agents/empty/agent.md",
		"error factory.yaml: learning.schedule: needs 5 fields (minute hour day month weekday), got 2",
		'error agents/coder/agent.md: unknown tool "bash" in tools. Use one of: read, edit, shell, web, commands',
		'error automations/bad-event/automation.md: unknown event "issue.label" in when. Did you mean "issue.labeled"?',
		'error automations/bad-event/automation.md: unknown permission "add_coment" in can. Did you mean "add_comment"?',
		'error automations/bad-event/automation.md: agent "codr" does not exist. Did you mean "coder"?',
		"error automations/loop/automation.md: can.push_to_pull_request updates a pull request, which starts this automation again (when pull_request.updated)",
		"error automations/loop/automation.md: can.add_labels can add the label needs-review, which starts this automation again",
		'error automations/no-cron/automation.md: when.schedule needs a cron, for example { cron: "0 9 * * 1" }',
		"error automations/no-cron/automation.md: when.issue.opened does not take labels; only issue.labeled, pull_request.labeled, linear.issue.labeled, issue.commented and pull_request.commented do",
		'error automations/no-cron/automation.md: unknown value "everything" in concurrency. Use one of: issue, repository',
		"warning agents/orphan/agent.md: no automation uses this agent",
	]);
});

describe("setup and ignore_paths", () => {
	it("reads a list of setup commands and pull request path filters", () => {
		const { factory, problems } = loadFactory(
			readFolder(join(ROOT, "fixtures/valid/setup-and-ignore/openfabriq")),
		);
		expect(problems).toEqual([]);
		expect(factory?.setup).toEqual([
			"pnpm install --frozen-lockfile",
			"pnpm build",
		]);
		expect(factory?.automations.review?.when).toEqual([
			{
				event: "pull_request.opened",
				ignore_paths: ["openfabriq/**", "docs/*.md"],
			},
			{ event: "pull_request.updated", ignore_paths: ["openfabriq/**"] },
		]);
	});

	it("turns a single setup command into a list", () => {
		const { factory } = loadFactory(
			minimal("when: issue.opened\nagent: worker", {
				"factory.yaml": `${FACTORY}setup: pnpm install\n`,
			}),
		);
		expect(factory?.setup).toEqual(["pnpm install"]);
	});

	it("refuses an empty setup and ignore_paths outside pull request events", () => {
		const files = readFolder(
			join(ROOT, "fixtures/invalid/misplaced-filters/openfabriq"),
		);
		expect(loadFactory(files).problems.map((p) => p.message)).toEqual([
			expect.stringMatching(/^setup: /),
			"when.issue.opened does not take ignore_paths; only pull_request events do",
		]);
	});
});

describe("a comment that mentions the factory", () => {
	it("reads mentions on comment events, and refuses it elsewhere", () => {
		const ok = loadFactory(
			minimal(
				'when:\n  pull_request.commented: { mentions: "@openfabriq" }\n  issue.commented: { mentions: "/factory" }\nagent: worker',
			),
		);
		expect(ok.problems).toEqual([]);
		expect(Object.values(ok.factory?.automations ?? {})[0]?.when).toEqual([
			{ event: "pull_request.commented", mentions: "@openfabriq" },
			{ event: "issue.commented", mentions: "/factory" },
		]);
		const plain = loadFactory(
			minimal("when: pull_request.commented\nagent: worker"),
		);
		expect(plain.factory).toBeDefined();
		expect(plain.problems).toEqual([
			{
				level: "warning",
				file: "automations/run/automation.md",
				message:
					'when.pull_request.commented has no mentions: every comment of a maintainer on a pull request starts it. Add mentions: "@openfabriq" to start it only when the factory is asked',
			},
		]);
		const misplaced = loadFactory(
			minimal(
				'when:\n  issue.opened: { mentions: "@openfabriq" }\nagent: worker',
			),
		);
		expect(misplaced.problems.map((p) => p.message)).toEqual([
			"when.issue.opened does not take mentions; only issue.commented and pull_request.commented do",
		]);
	});
});

describe("a comment on a labeled issue or pull request", () => {
	it("reads labels on comment events, with or without mentions, and says it in words", () => {
		const ok = loadFactory(
			minimal(
				'when:\n  issue.commented: { labels: [migration:decision] }\n  pull_request.commented: { labels: [a, b], mentions: "@openfabriq" }\nagent: worker',
			),
		);
		// A label filter narrows pull request comments enough: no warning.
		expect(ok.problems).toEqual([]);
		const automation = Object.values(ok.factory?.automations ?? {})[0];
		expect(automation?.when).toEqual([
			{ event: "issue.commented", labels: ["migration:decision"] },
			{
				event: "pull_request.commented",
				labels: ["a", "b"],
				mentions: "@openfabriq",
			},
		]);
		expect(automation && whenText(automation)).toBe(
			"issue.commented (labeled migration:decision), pull_request.commented (labeled a or b, mentions @openfabriq)",
		);
	});
});

describe("the harness: commands and checks", () => {
	const HARNESS = `${FACTORY}commands:\n  test: npm test\n  lint: npm run lint\n  format: npx prettier --write\nchecks: [test, lint]\n`;

	it("reads named commands, the checks, and the commands tool", () => {
		const { factory, problems } = loadFactory(
			minimal("when: issue.opened\nagent: worker", {
				"factory.yaml": HARNESS,
				"agents/worker/agent.md":
					"---\ndescription: Reviews\ntools: [read, commands]\n---\nReview.\n",
			}),
		);
		expect(problems).toEqual([]);
		expect(factory?.commands).toEqual({
			test: "npm test",
			lint: "npm run lint",
			format: "npx prettier --write",
		});
		expect(factory?.checks).toEqual(["test", "lint"]);
		expect(factory?.agents.worker?.tools).toEqual(["read", "commands"]);
	});

	it("refuses unknown command names, and the commands tool without commands", () => {
		expect(
			messages(
				minimal("when: issue.opened\nagent: worker", {
					"factory.yaml": `${FACTORY}commands:\n  test: npm test\nchecks: [test, build]\n`,
				}),
			),
		).toEqual(['factory.yaml: checks lists "build", which is not in commands']);
		expect(
			messages(
				minimal("when: issue.opened\nagent: worker", {
					"agents/worker/agent.md":
						"---\ndescription: Reviews\ntools: [read, commands]\n---\nReview.\n",
				}),
			),
		).toEqual([
			"agents/worker/agent.md: tools has commands, but factory.yaml names no commands",
		]);
	});
});

describe("env and secrets", () => {
	it("reads values, numbers as text, and secret names", () => {
		const { factory, problems } = loadFactory(
			minimal("when: issue.opened\nagent: worker", {
				"factory.yaml": `${FACTORY}env:\n  NODE_ENV: test\n  PORT: 3000\nsecrets: [DATABASE_URL, STRIPE_TEST_KEY]\n`,
			}),
		);
		expect(problems).toEqual([]);
		expect(factory?.env).toEqual({ NODE_ENV: "test", PORT: "3000" });
		expect(factory?.secrets).toEqual(["DATABASE_URL", "STRIPE_TEST_KEY"]);
	});

	it("refuses the engine's own variables, a name in both, and odd names", () => {
		expect(
			messages(
				minimal("when: issue.opened\nagent: worker", {
					"factory.yaml": `${FACTORY}env:\n  GH_TOKEN: x\n  API_URL: http://localhost\nsecrets: [ANTHROPIC_API_KEY, API_URL]\n`,
				}),
			),
		).toEqual([
			"factory.yaml: env.GH_TOKEN belongs to the engine; a factory cannot give it to its commands",
			"factory.yaml: secrets lists ANTHROPIC_API_KEY, which belongs to the engine; a factory cannot give it to its commands",
			"factory.yaml: API_URL is in both env and secrets; keep it in one",
		]);
		expect(
			messages(
				minimal("when: issue.opened\nagent: worker", {
					"factory.yaml": `${FACTORY}env:\n  NODE_OPTIONS: --require ./x.js\n  LD_PRELOAD: x.so\n  DYLD_INSERT_LIBRARIES: x.dylib\n  NODE_ENV: test\n`,
				}),
			),
		).toEqual(
			["NODE_OPTIONS", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES"].map(
				(name) =>
					`factory.yaml: env.${name} changes how programs load code; a factory cannot set it`,
			),
		);
		expect(
			messages(
				minimal("when: issue.opened\nagent: worker", {
					"factory.yaml": `${FACTORY}secrets: [my-key]\n`,
				}),
			),
		).toEqual([
			expect.stringMatching(/^factory\.yaml: secrets\.0: a variable name/),
		]);
	});
});

describe("timezone", () => {
	it("reads a time zone, and refuses one that does not exist", () => {
		expect(
			loadFactory(
				minimal("when: issue.opened\nagent: worker", {
					"factory.yaml": `${FACTORY}timezone: Europe/Paris\n`,
				}),
			).factory?.timezone,
		).toBe("Europe/Paris");
		expect(
			messages(
				minimal("when: issue.opened\nagent: worker", {
					"factory.yaml": `${FACTORY}timezone: Paris\n`,
				}),
			),
		).toEqual([
			'factory.yaml: timezone: "Paris" is not a time zone; use a name like Europe/Paris or UTC',
		]);
	});
});

describe("signature", () => {
	it("signs by default, turns off with false, and refuses any other word", () => {
		const files = (yaml: string) =>
			minimal("when: issue.opened\nagent: worker", {
				"factory.yaml": `${FACTORY}${yaml}`,
			});
		const read = (yaml: string) => loadFactory(files(yaml)).factory?.signature;
		expect(read("")).toBeUndefined();
		expect(read("signature: true\n")).toBeUndefined();
		expect(read("signature: false\n")).toBe(false);
		expect(messages(files("signature: no thanks\n"))).toEqual([
			"factory.yaml: signature: is true or false; false leaves out the line that says what openfabriq wrote",
		]);
	});
});

describe("MCP servers", () => {
	const SERVERS = `${FACTORY}mcp:\n  sentry:\n    url: https://mcp.sentry.dev/mcp\n    secret: MCP_SENTRY_TOKEN\n  test-db:\n    command: npx -y @modelcontextprotocol/server-postgres\n    secrets: [TEST_DATABASE_URL]\n`;
	const withAgent = (header: string, yaml = SERVERS) =>
		loadFactory(
			minimal("when: issue.opened\nagent: worker", {
				"factory.yaml": yaml,
				"agents/worker/agent.md": `---\ndescription: Does things\n${header}\n---\nDo things.\n`,
			}),
		);

	it("reads the servers of the factory and the tools each agent may call", () => {
		const { factory, problems } = withAgent(
			"mcp:\n  sentry: [search_issues, get_issue_details]",
		);
		expect(problems).toEqual([]);
		expect(factory?.mcp).toEqual({
			sentry: { url: "https://mcp.sentry.dev/mcp", secret: "MCP_SENTRY_TOKEN" },
			"test-db": {
				command: "npx -y @modelcontextprotocol/server-postgres",
				secrets: ["TEST_DATABASE_URL"],
			},
		});
		expect(factory?.agents.worker?.mcp).toEqual({
			sentry: ["search_issues", "get_issue_details"],
		});
	});

	it("refuses a server it cannot connect, a secret of the engine, and GitHub", () => {
		const yaml = `${FACTORY}mcp:\n  openfabriq:\n    url: https://a.dev/mcp\n  Bad_Name:\n    url: https://a.dev/mcp\n  both:\n    url: https://a.dev/mcp\n    command: run-it\n  neither:\n    secret: KNOWN\n  engine-secret:\n    url: https://a.dev/mcp\n    secret: GH_TOKEN\n  engine-secrets:\n    command: run-it\n    secrets: [OK_TOKEN, OPENFABRIQ_LINEAR_API_KEY]\n  mixed:\n    command: run-it\n    secret: KNOWN\n  remote:\n    url: https://a.dev/mcp\n    secrets: [KNOWN]\n  github:\n    url: https://api.githubcopilot.com/mcp/\n  github-dot:\n    url: https://api.githubcopilot.com./mcp/\n  github-local:\n    command: docker run -i ghcr.io/github/github-mcp-server\n`;
		expect(
			messages({
				...minimal("when: issue.opened\nagent: worker"),
				"factory.yaml": yaml,
			}),
		).toEqual([
			"factory.yaml: mcp.openfabriq is the engine's own server; choose another name",
			"factory.yaml: mcp.Bad_Name: a server name is lowercase letters, digits and -, like sentry or test-db",
			"factory.yaml: mcp.both has both url and command; a server is either one",
			"factory.yaml: mcp.neither needs url (a remote server) or command (a server run on this machine)",
			"factory.yaml: mcp.engine-secret names GH_TOKEN, which belongs to the engine; a factory cannot give it to a server",
			"factory.yaml: mcp.engine-secrets names OPENFABRIQ_LINEAR_API_KEY, which belongs to the engine; a factory cannot give it to a server",
			"factory.yaml: mcp.mixed.secret is for a remote server; a server run by command takes secrets: [...]",
			"factory.yaml: mcp.remote.secrets is for a server run by command; a remote server takes one secret",
			"factory.yaml: mcp.github is a GitHub server; agents never write to GitHub, the engine does",
			"factory.yaml: mcp.github-dot is a GitHub server; agents never write to GitHub, the engine does",
			"factory.yaml: mcp.github-local is a GitHub server; agents never write to GitHub, the engine does",
		]);
	});

	it("names every secret once: the commands' and the servers'", () => {
		const yaml = SERVERS.replace(
			"mcp:",
			"secrets: [DATABASE_URL, MCP_SENTRY_TOKEN]\nmcp:",
		);
		const { factory } = withAgent("tools: [read]", yaml);
		expect(factory && secretNames(factory)).toEqual([
			"DATABASE_URL",
			"MCP_SENTRY_TOKEN",
			"TEST_DATABASE_URL",
		]);
	});

	it("refuses an MCP secret that is also in env", () => {
		expect(
			messages({
				...minimal("when: issue.opened\nagent: worker"),
				"factory.yaml": `${FACTORY}env:\n  API_URL: https://api.test\nmcp:\n  s:\n    url: https://a.dev/mcp\n    secret: API_URL\n`,
			}),
		).toEqual([
			"factory.yaml: API_URL is in both env and mcp.s; keep it in one",
		]);
		// Dots inside a name are fine; a part made of dots only is not.
		expect(
			messages({
				...minimal("when: issue.opened\nagent: worker"),
				"factory.yaml": FACTORY.replace("acme/app", "acme/.app.v2"),
			}),
		).toEqual([]);
	});

	it("refuses an agent that names a server the factory does not declare, or no tool", () => {
		const problems = (header: string) =>
			withAgent(header).problems.map((p) => `${p.file}: ${p.message}`);
		expect(problems("mcp:\n  sentri: [search_issues]")).toEqual([
			'agents/worker/agent.md: mcp.sentri: no server "sentri" in factory.yaml. Did you mean "sentry"?',
		]);
		expect(problems("mcp:\n  sentry: []")).toEqual([
			"agents/worker/agent.md: mcp.sentry: Too small: expected array to have >=1 items",
		]);
	});
});

// Each value is checked whole, not only its start or its end (found by mutation testing).
describe("values checked whole", () => {
	const withYaml = (yaml: string) =>
		messages(
			minimal("when: issue.opened\nagent: worker", { "factory.yaml": yaml }),
		);
	const withAgentFile = (agent: string, yaml = FACTORY) =>
		messages(
			minimal("when: issue.opened\nagent: worker", {
				"factory.yaml": yaml,
				"agents/worker/agent.md": agent,
			}),
		);

	it("reports a factory.yaml that is not YAML", () => {
		expect(withYaml("name: [\n")).toEqual([
			expect.stringMatching(/^factory\.yaml: invalid YAML: /),
		]);
	});

	it("refuses a repository that is not exactly owner/name", () => {
		for (const repository of [
			"https://github.com/acme/app",
			"acme/app/extra",
			"../app",
			"acme/..",
			"./app",
		])
			expect(withYaml(FACTORY.replace("acme/app", repository))).toEqual([
				`factory.yaml: repository: must look like "owner/name", got "${repository}"`,
			]);
	});

	it("refuses a command or variable name with its own reason", () => {
		for (const name of ["Test", "test!"])
			expect(withYaml(`${FACTORY}commands:\n  "${name}": npm test\n`)).toEqual([
				`factory.yaml: commands.${name}: a command name is a lowercase word, like test or lint`,
			]);
		expect(withYaml(`${FACTORY}env:\n  my-var: x\n`)).toEqual([
			"factory.yaml: env.my-var: a variable name is letters, digits and _, like DATABASE_URL",
		]);
	});

	it("refuses an agent with no body, or a header that is not keys", () => {
		expect(withAgentFile("---\ndescription: Does things\n---\n")).toEqual([
			"agents/worker/agent.md: the body is empty: describe the agent's job below the header",
		]);
		expect(withAgentFile("---\n- description\n---\nDo.\n")).toEqual([
			"agents/worker/agent.md: must be a list of keys",
		]);
	});

	it("refuses an unknown value in from", () => {
		expect(
			messages(minimal("when: issue.opened\nagent: worker\nfrom: everyone")),
		).toEqual([
			'automations/run/automation.md: unknown value "everyone" in from. Use one of: maintainers, factory, anyone',
			"agents/worker/agent.md: no automation uses this agent",
		]);
	});

	it("takes http and https servers with several secrets, and refuses other protocols and tool names", () => {
		const yaml = `${FACTORY}secrets: [A, B]\nmcp:\n  local:\n    url: http://localhost:3000/mcp\n  db:\n    command: run-db\n    secrets: [A, B]\nintegrations:\n  sentry:\n    organization: acme\n    project: app\n    url: https://sentry.acme.dev//\n`;
		const { factory, problems } = loadFactory(
			minimal("when: issue.opened\nagent: worker", { "factory.yaml": yaml }),
		);
		expect(problems).toEqual([]);
		expect(factory?.mcp?.db).toEqual({
			command: "run-db",
			secrets: ["A", "B"],
		});
		expect(factory?.sentry?.url).toBe("https://sentry.acme.dev");
		expect(
			withYaml(`${FACTORY}mcp:\n  files:\n    url: ftp://a.dev/mcp\n`),
		).toEqual([expect.stringMatching(/^factory\.yaml: mcp/)]);
		for (const tool of ["get issue", "!get"])
			expect(
				withAgentFile(
					`---\ndescription: Does things\nmcp:\n  local: ["${tool}"]\n---\nDo.\n`,
					yaml,
				),
			).toEqual([
				expect.stringContaining(
					"a tool name is letters, digits, _ and -, like get_issue",
				),
			]);
	});
});

describe("integrations", () => {
	const withFactory = (yaml: string) =>
		minimal("when: issue.opened\nagent: worker", {
			"factory.yaml": `${FACTORY}${yaml}`,
		});

	it("reads Slack, Linear and Sentry under integrations", () => {
		const { factory, problems } = loadFactory(
			withFactory(
				"integrations:\n  slack:\n    channel: '#factory'\n  linear:\n    team: ENG\n  sentry:\n    organization: acme\n    project: app\n",
			),
		);
		expect(problems).toEqual([]);
		expect(factory?.slack).toEqual({ channel: "factory" });
		expect(factory?.linear).toEqual({ team: "ENG" });
		expect(factory?.sentry).toEqual({ organization: "acme", project: "app" });
	});

	it("says where a key of the old format goes now", () => {
		expect(messages(withFactory("slack:\n  channel: factory\n"))).toEqual([
			'factory.yaml: the key "slack" now goes under integrations',
		]);
		expect(
			messages(
				withFactory(
					"linear:\n  team: ENG\nsentry:\n  organization: a\n  project: b\n",
				),
			),
		).toEqual([
			'factory.yaml: the key "linear" now goes under integrations',
			'factory.yaml: the key "sentry" now goes under integrations',
		]);
	});

	it("refuses an unknown integration, and checks each one's keys", () => {
		expect(
			messages(withFactory("integrations:\n  slak:\n    channel: factory\n")),
		).toEqual([
			'factory.yaml: integrations: unknown integration "slak". Did you mean "slack"?',
		]);
		expect(
			messages(withFactory("integrations:\n  linear:\n    teams: ENG\n")),
		).toEqual([
			"factory.yaml: integrations.linear.team: Invalid input: expected string, received undefined",
			'factory.yaml: integrations.linear: Unrecognized key: "teams"',
		]);
	});

	it("suggests the closest key for a typo under limits", () => {
		expect(messages(withFactory("limits:\n  usd_per_runs: 3\n"))).toEqual([
			'factory.yaml: limits: unknown key "usd_per_runs". Did you mean "usd_per_run"?',
		]);
	});
});

describe("scripts", () => {
	it("reads commands and setup lines that run a script of the factory", () => {
		const { factory, problems } = loadFactory(
			readFolder(join(ROOT, "fixtures/valid/scripts/openfabriq")),
		);
		expect(problems).toEqual([]);
		expect(factory?.setup).toEqual(["scripts/prepare.sh --quiet"]);
		expect(factory?.commands?.report).toBe("scripts/report.mjs > report.json");
	});

	it("refuses a missing script, a script without #!, a test, a path that leaves scripts/, another language", () => {
		expect(
			messages(readFolder(join(ROOT, "fixtures/invalid/scripts/openfabriq"))),
		).toEqual([
			"factory.yaml: setup: scripts/missing.sh is not in openfabriq/scripts/. To run a file of the repository, write ./scripts/missing.sh",
			"factory.yaml: setup: scripts/../escape.sh leaves openfabriq/scripts/",
			"factory.yaml: commands.bare: scripts/bare.sh must start with a line like #!/bin/sh, which says what runs it",
			"factory.yaml: commands.tested: scripts/test/report.test.mjs is a test of the scripts; a command cannot run it",
			"factory.yaml: commands.python: scripts/tool.py is not a script: a script is a .sh or .mjs file",
			"scripts/tool.py: a script is a .sh or .mjs file; scripts/test/ takes any file",
		]);
	});

	it("knows the script a command starts with, and only that one", () => {
		expect(scriptOf("scripts/a.sh --flag && scripts/b.sh")).toBe(
			"scripts/a.sh",
		);
		expect(scriptOf("scripts/a.sh;echo done")).toBe("scripts/a.sh");
		expect(scriptOf("./scripts/a.sh")).toBeUndefined();
		expect(scriptOf("sh scripts/a.sh")).toBeUndefined();
		expect(scriptOf("pnpm test")).toBeUndefined();
	});
});
