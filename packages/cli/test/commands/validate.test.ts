import { join } from "node:path";
import { expect, it } from "vitest";
import { validateCommand } from "../../src/commands/validate.js";

const ROOT = join(import.meta.dirname, "../../../..");

it("accepts a repository root or its openfabriq/ folder", () => {
	const result = validateCommand(join(ROOT, "fixtures/valid/sdlc"));
	expect(result.code).toBe(0);
	expect(result.output).toMatch(/is valid: 5 agents, 5 automations$/);
	expect(
		validateCommand(join(ROOT, "examples/01-quickstart/openfabriq")).code,
	).toBe(0);
});

it("lists every problem and fails", () => {
	const result = validateCommand(join(ROOT, "fixtures/invalid/many-problems"));
	expect(result.code).toBe(1);
	expect(result.output).toContain(
		'✗ factory.yaml: unknown key "maintainer". Did you mean "maintainers"?',
	);
	expect(result.output).toContain(
		"! agents/orphan/agent.md: no automation uses this agent",
	);
	expect(result.output).toContain(
		"✗ factory.yaml: learning.schedule: needs 5 fields (minute hour day month weekday), got 2",
	);
	expect(result.output).toMatch(/16 errors in .*many-problems\/openfabriq$/);
});

it("explains when there is no factory", () => {
	expect(validateCommand(join(ROOT, "nowhere"))).toEqual({
		code: 1,
		output: expect.stringContaining('Run "openfabriq init"'),
	});
});

it("never reads a folder that holds no factory, like a whole repository", () => {
	// The CLI's package: no openfabriq/ folder, no factory.yaml, and node_modules.
	expect(validateCommand(join(ROOT, "packages/cli"))).toEqual({
		code: 1,
		output: expect.stringContaining('Run "openfabriq init"'),
	});
});
