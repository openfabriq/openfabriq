import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { claudeHooks, claudeTools } from "../../src/agent/claude.js";
import type { EngineTool } from "../../src/agent/port.js";
import { type CommandRun, harness } from "../../src/run/harness.js";

const COMMANDS = {
	test: "npm test",
	lint: "npm run lint",
};

function setup(
	options: {
		failing?: string[];
		changed?: boolean;
		uncommitted?: boolean;
		agentCommands?: boolean;
		checks?: string[];
		commit?: (change: { message: string; files: string[] }) => Promise<void>;
	} = {},
) {
	const executed: string[] = [];
	const log: CommandRun[] = [];
	const failing = new Set(options.failing ?? []);
	const h = harness({
		commands: COMMANDS,
		checks: options.checks ?? ["test", "lint"],
		agentCommands: options.agentCommands ?? false,
		execute: async (command) => {
			executed.push(command);
			return failing.has(command)
				? { ok: false, output: `${command}: 1 failed\nexpected 2, got 3` }
				: { ok: true, output: "all good" };
		},
		...(options.commit ? { commit: options.commit } : {}),
		changed: async () => ({
			uncommitted: options.uncommitted ?? false,
			ahead: (options.changed ?? true) ? 1 : 0,
		}),
		log: (r) => log.push(r),
		now: () => new Date("2026-11-03T02:00:00Z"),
	});
	const signal = new AbortController().signal;
	const stop = async () =>
		(await claudeHooks(h.stop).Stop?.[0]?.hooks[0]?.(
			{ hook_event_name: "Stop", stop_hook_active: false } as never,
			undefined,
			{ signal },
		)) as SyncHookJSONOutput | undefined;
	const anyTool = async () =>
		(await claudeHooks(h.stop).PostToolUse?.[0]?.hooks[0]?.(
			{
				hook_event_name: "PostToolUse",
				tool_name: "Bash",
				tool_input: { command: "sed -i '' s/a/b/ lib/tasks.ts" },
			} as never,
			"tool-1",
			{ signal },
		)) as SyncHookJSONOutput | undefined;
	return { h, executed, log, stop, anyTool };
}

/** A tool as Claude Code calls it: through the adapter's MCP server. */
const served = (tool: EngineTool | undefined) => ({
	...tool,
	handler: async (args: never, extra: unknown) =>
		(
			claudeTools(tool ? [tool] : []).server.instance as unknown as {
				_registeredTools: Record<
					string,
					{
						handler: (
							args: never,
							extra: unknown,
						) => Promise<{
							content: { type: string; text: string }[];
							isError?: boolean;
						}>;
					}
				>;
			}
		)._registeredTools[tool?.name ?? ""]?.handler(args, extra),
});

describe("harness", () => {
	it("offers run_command only to an agent with the commands tool, and runs named commands only", async () => {
		expect(setup().h.tools).toEqual([]);
		const { h, executed, log } = setup({
			agentCommands: true,
			failing: ["npm run lint"],
		});
		const runCommand = served(h.tools[0]);
		expect(runCommand?.name).toBe("run_command");
		expect(runCommand?.description).toContain("test: npm test");
		const passed = await runCommand?.handler({ name: "test" } as never, {});
		expect(passed?.content[0]).toEqual({
			type: "text",
			text: "test passed.\nall good",
		});
		const failed = await runCommand?.handler({ name: "lint" } as never, {});
		expect(failed?.isError).toBe(true);
		expect(executed).toEqual(["npm test", "npm run lint"]);
		expect(log.map((r) => [r.kind, r.name, r.ok])).toEqual([
			["command", "test", true],
			["command", "lint", false],
		]);
	});

	it("runs no check when the agent changed nothing", async () => {
		const { h, executed, stop } = setup({ changed: false });
		expect(await stop()).toEqual({});
		expect(await h.gate()).toBeUndefined();
		expect(executed).toEqual([]);
	});

	it("blocks the agent's stop on a failed check, twice at most, then the gate refuses", async () => {
		const { h, executed, stop, log } = setup({ failing: ["npm run lint"] });
		const first = await stop();
		expect(first).toMatchObject({ decision: "block" });
		expect(first?.reason).toContain('The check "lint" failed (npm run lint)');
		expect(first?.reason).toContain("expected 2, got 3");
		expect(await stop()).toMatchObject({ decision: "block" });
		// Two rounds of fixes spent: the agent may stop, and the engine refuses its code.
		expect(await stop()).toEqual({});
		expect(await h.gate()).toBe('the check "lint" failed (npm run lint)');
		// Each pass stops at the first failing check; the gate runs its own pass.
		expect(executed.filter((c) => c === "npm test")).toHaveLength(4);
		expect(log.every((r) => r.kind === "check")).toBe(true);
	});

	it("trusts a pass at the agent's last stop, and checks again when the agent stopped otherwise", async () => {
		const passing = setup();
		expect(await passing.stop()).toEqual({});
		expect(await passing.h.gate()).toBeUndefined();
		expect(passing.executed).toEqual(["npm test", "npm run lint"]);

		// No stop hook ran (budget, timeout): the gate runs the checks itself.
		const stopped = setup({ failing: ["npm test"] });
		expect(await stopped.h.gate()).toBe('the check "test" failed (npm test)');
		expect(stopped.executed).toEqual(["npm test"]);
	});

	it("checks again when the agent kept working after a passing stop", async () => {
		const { h, executed, stop, anyTool } = setup();
		await stop();
		await anyTool();
		expect(await h.gate()).toBeUndefined();
		expect(executed.filter((c) => c === "npm test")).toHaveLength(2);
	});

	it("blocks a stop with uncommitted changes, and the gate refuses them", async () => {
		const { h, executed, stop } = setup({ uncommitted: true });
		expect((await stop())?.reason).toMatch(/^Some changes are not committed/);
		expect(await h.gate()).toBe(
			"changes were left uncommitted: only commits are published",
		);
		expect(executed).toEqual([]);
	});

	it("offers commit to an agent without a shell, and says why nothing was committed", async () => {
		expect(setup().h.tools.map((t) => t.name)).toEqual([]);
		const committed: { message: string; files: string[] }[] = [];
		const { h, stop } = setup({
			uncommitted: true,
			commit: async (change) => {
				if (change.files.includes("../x")) throw new Error("not inside");
				committed.push(change);
			},
		});
		const commit = served(h.tools[0]);
		expect(commit?.name).toBe("commit");
		const done = await commit?.handler(
			{
				message: "chore(deps): weekly updates",
				files: ["package.json"],
			} as never,
			{},
		);
		expect(done?.isError).toBeUndefined();
		expect(committed).toEqual([
			{ message: "chore(deps): weekly updates", files: ["package.json"] },
		]);
		const refused = await commit?.handler(
			{ message: "x", files: ["../x"] } as never,
			{},
		);
		expect(refused?.isError).toBe(true);
		expect(refused?.content[0]).toEqual({
			type: "text",
			text: "Nothing committed: not inside",
		});
		expect((await stop())?.reason).toMatch(
			/Call commit with the files you propose/,
		);
	});
});
