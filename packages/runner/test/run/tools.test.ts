import { type Automation, OUTPUT_TOOL_PREFIX } from "@openfabriq/core";
import { expect, it } from "vitest";
import { claudeTools } from "../../src/agent/claude.js";
import { outputTools } from "../../src/run/outputs/tools.js";

/** The tools as the MCP server registered them: what Claude Code calls. */
type Registered = Record<
	string,
	{ handler: (args: unknown, extra: unknown) => Promise<unknown> }
>;

const automation = {
	name: "triage",
	can: [{ action: "add_comment" }, { action: "add_labels", labels: ["bug"] }],
} as unknown as Automation;

it("records what the agent proposes through the server's tools, and writes nothing", async () => {
	const outputs = outputTools(automation, { number: 4, kind: "issue" });
	const served = claudeTools(outputs.tools);
	expect(served.names).toEqual([
		`${OUTPUT_TOOL_PREFIX}add_comment`,
		`${OUTPUT_TOOL_PREFIX}add_labels`,
	]);
	const tools = (
		served.server.instance as unknown as { _registeredTools: Registered }
	)._registeredTools;
	const answer = await tools.add_comment?.handler({ body: "Looks good." }, {});
	await tools.add_labels?.handler({ labels: ["bug"] }, {});
	expect(answer).toEqual({
		content: [
			{
				type: "text",
				text: "Recorded. The engine applies it after the run, if the factory allows it.",
			},
		],
	});
	expect(outputs.proposals).toEqual([
		{ action: "add_comment", body: "Looks good." },
		{ action: "add_labels", labels: ["bug"] },
	]);
	expect(Object.keys(tools)).toEqual(["add_comment", "add_labels"]);
});
