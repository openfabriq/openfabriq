import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFactory } from "../../src/factory/load.js";
import type { FactoryFiles } from "../../src/factory/types.js";
import { ROOT, readFolder } from "../helpers.js";

const FACTORY = "name: F\nrepository: acme/app\nmaintainers: [alice]\n";
const AGENT = "---\ndescription: Does things\n---\nDo things.\n";
const AUTOMATION =
	"---\nwhen: [issue.opened]\nagent: worker\ncan: [add_comment]\n---\nGo.\n";
const BASE: FactoryFiles = {
	"factory.yaml": FACTORY,
	"agents/worker/agent.md": AGENT,
	"automations/a/automation.md": AUTOMATION,
	"qa/agents/tester/agent.md": AGENT,
};
const skill = (header: string) =>
	`---\nname: s\ndescription: A skill\n${header}---\nDo it well.\n`;

const errors = (files: FactoryFiles) =>
	loadFactory({ ...BASE, ...files })
		.problems.filter((p) => p.level === "error")
		.map((p) => `${p.file}: ${p.message}`);

describe("the factory's skills", () => {
	it("refuses a skill that grants itself tools, wherever it is", () => {
		const granting = skill("allowed-tools: Bash(git:*)\n");
		expect(
			errors({
				"skills/s/SKILL.md": granting,
				"qa/skills/s/SKILL.md": granting,
				"agents/worker/skills/s/SKILL.md": granting,
				"qa/agents/tester/skills/s/SKILL.md": skill(
					'"allowed-tools": [Read]\n',
				),
			}),
		).toEqual(
			[
				"agents/worker/skills/s",
				"qa/agents/tester/skills/s",
				"qa/skills/s",
				"skills/s",
			].map(
				(folder) =>
					`${folder}/SKILL.md: allowed-tools grants tools, but the factory lists the tools an agent may use: remove it, and add what the agent needs to its tools`,
			),
		);
	});

	it("leaves a skill without allowed-tools alone, and a mention in its body", () => {
		expect(
			errors({
				"skills/s/SKILL.md": `${skill("")}Never write allowed-tools: here.\n`,
				"skills/s/notes.md": "---\nallowed-tools: Bash\n---\n",
			}),
		).toEqual([]);
	});
});

describe("an invalid factory's skills", () => {
	it("refuses a skill that grants tools, an imported skill whose folder is gone, and a declared one for no agent", () => {
		const { factory, problems } = loadFactory(
			readFolder(join(ROOT, "fixtures/invalid/skills/openfabriq")),
		);
		expect(factory).toBeUndefined();
		expect(problems.map((p) => `${p.file}: ${p.message}`)).toEqual([
			"skills/grants/SKILL.md: allowed-tools grants tools, but the factory lists the tools an agent may use: remove it, and add what the agent needs to its tools",
			'imported-skills.json: lists skills/tdd, which is not a skill folder of the factory: run "openfabriq skill remove skills/tdd"',
			'factory.yaml: skills.review: agent "reviewer" does not exist. Use one of: worker',
		]);
	});
});
