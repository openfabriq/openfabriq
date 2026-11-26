import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withLearning } from "../../src/factory/learning.js";
import { loadFactory } from "../../src/factory/load.js";
import type { FactoryFiles } from "../../src/factory/types.js";
import { planChanges } from "../../src/plan/plan.js";
import { load, NO_FILES, ROOT, readFolder } from "../helpers.js";

const FACTORY = "name: F\nrepository: acme/app\nmaintainers: [alice]\n";
const files = (yaml = "", extra: FactoryFiles = {}): FactoryFiles => ({
	"factory.yaml": FACTORY + yaml,
	"agents/worker/agent.md": "---\ndescription: Does things\n---\nDo things.\n",
	"automations/run/automation.md":
		"---\nwhen: issue.opened\nagent: worker\n---\nGo.\n",
	...extra,
});
const ON = "learning: true\n";
const messages = (f: FactoryFiles) =>
	loadFactory(f).problems.map((p) => `${p.file}: ${p.message}`);

describe("learning", () => {
	it("loads a factory that learns on its own schedule, with no problem", () => {
		const fixture = loadFactory(
			readFolder(join(ROOT, "fixtures/valid/learning/openfabriq")),
		);
		expect(fixture.problems).toEqual([]);
		expect(fixture.factory?.learning).toEqual({ schedule: "0 2 * * *" });
	});

	it("is off by default; true turns it on, each Monday at 08:00", () => {
		expect(load(files()).learning).toBeUndefined();
		expect(load(files(ON)).learning).toEqual({ schedule: "0 8 * * 1" });
		expect(load(files("learning: false\n")).learning).toBeUndefined();
	});

	it("takes its own schedule", () => {
		expect(
			load(files('learning:\n  schedule: "0 2 * * *"\n')).learning,
		).toEqual({ schedule: "0 2 * * *" });
	});

	it("refuses a broken schedule and an unknown key", () => {
		expect(messages(files('learning:\n  schedule: "0 8 * *"\n'))).toEqual([
			"factory.yaml: learning.schedule: needs 5 fields (minute hour day month weekday), got 4",
		]);
		expect(messages(files("learning:\n  every: week\n"))).toEqual([
			'factory.yaml: learning: unknown key "every". Use one of: schedule',
		]);
		expect(messages(files("learning: weekly\n"))).toEqual([
			'factory.yaml: learning: is true, false, or a schedule, like learning: { schedule: "0 8 * * 1" }',
		]);
	});

	it("reserves the name learning, even when learning is off", () => {
		expect(
			messages(
				files("", {
					"agents/learning/agent.md": "---\ndescription: Mine\n---\nMine.\n",
					"automations/learning/automation.md":
						"---\nwhen: issue.opened\nagent: learning\n---\nGo.\n",
				}),
			),
		).toEqual([
			"agents/learning/agent.md: an agent cannot be called learning: the engine's learning uses that name. Rename it",
			"automations/learning/automation.md: an automation cannot be called learning: the engine's learning uses that name. Rename it",
		]);
	});

	it("gives the engine an agent on its schedule that only opens pull requests", () => {
		const factory = withLearning(load(files(ON)));
		expect(factory.agents.learning).toMatchObject({
			builtIn: true,
			tools: ["read", "edit", "shell"],
			skills: ["learning"],
		});
		expect(factory.automations.learning).toMatchObject({
			when: [{ event: "schedule", cron: "0 8 * * 1" }],
			agent: "learning",
			can: [{ action: "create_pull_request" }],
			concurrency: "repository",
			builtIn: true,
		});
		expect(withLearning(load(files())).agents.learning).toBeUndefined();
	});

	it("plan says what learning does, in one line", () => {
		const plan = (before: string | undefined, after: string) =>
			planChanges(
				before === undefined ? undefined : load(files(before)),
				load(files(after)),
				[],
				NO_FILES,
			).settings.filter((l) => l.includes("learning"));
		expect(plan(undefined, ON)).toEqual([
			"+ learning: each week the engine studies the work that failed, and proposes improvements to skills, agent.md and automation.md, by pull request only",
		]);
		expect(plan(ON, ON)).toEqual([]);
		expect(plan(undefined, "")).toEqual([]);
		expect(plan(ON, "")).toEqual(["- learning: off"]);
		expect(plan(ON, 'learning:\n  schedule: "0 2 * * *"\n')).toEqual([
			"~ learning: every day at 02:00 the engine studies the work that failed, and proposes improvements to skills, agent.md and automation.md, by pull request only",
		]);
	});

	it("plan ignores the agent the engine adds", () => {
		const factory = load(files(ON));
		expect(
			planChanges(withLearning(factory), factory, [], NO_FILES),
		).toMatchObject({ agents: [], automations: [], settings: [] });
	});
});
