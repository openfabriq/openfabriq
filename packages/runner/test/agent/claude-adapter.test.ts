import { describe, expect, it } from "vitest";
import { z } from "zod";
import { claudeHooks, claudeTools } from "../../src/agent/claude.js";
import { engineTool, type Stop } from "../../src/agent/port.js";
import { afterToolHook, servedTools, stopHook } from "./served.js";

// The Claude adapter alone: how the engine's tools and its stop become Claude Code's MCP server and hooks.

describe("claudeTools", () => {
	const echo = engineTool({
		name: "echo",
		description: "Say it back.",
		schema: { text: z.string().min(1) },
		run: async ({ text }) =>
			text === "fail" ? { text: "No.", isError: true } : { text },
	});

	it("serves each tool under the openfabriq server, with its description and schema", () => {
		expect(claudeTools([echo]).names).toEqual(["mcp__openfabriq__echo"]);
		const served = servedTools([echo]).echo;
		expect(served?.description).toBe("Say it back.");
		expect(served?.inputSchema && z.toJSONSchema(served.inputSchema)).toEqual(
			expect.objectContaining({
				properties: { text: { type: "string", minLength: 1 } },
				required: ["text"],
			}),
		);
	});

	it("answers with the tool's text, and marks an error only when the tool says so", async () => {
		const served = servedTools([echo]).echo;
		expect(await served?.handler({ text: "hi" }, {})).toEqual({
			content: [{ type: "text", text: "hi" }],
		});
		expect(await served?.handler({ text: "fail" }, {})).toEqual({
			content: [{ type: "text", text: "No." }],
			isError: true,
		});
	});
});

describe("claudeHooks", () => {
	const stop = (reason: string | undefined, timeoutSeconds?: number) => {
		const seen = { afterTool: 0 };
		const value: Stop = {
			check: async () => reason,
			afterTool: () => {
				seen.afterTool++;
			},
			...(timeoutSeconds ? { timeoutSeconds } : {}),
		};
		return { value, seen };
	};

	it("lets the agent finish when the check agrees, and refuses its stop with the reason otherwise", async () => {
		expect(await stopHook(stop(undefined).value)).toEqual({});
		expect(await stopHook(stop("The check failed.").value)).toEqual({
			decision: "block",
			reason: "The check failed.",
		});
	});

	it("tells the harness after every tool call", async () => {
		const { value, seen } = stop(undefined);
		expect(await afterToolHook(value)).toEqual({});
		await afterToolHook(value);
		expect(seen.afterTool).toBe(2);
	});

	it("gives the Stop hook a timeout only when the stop has one", () => {
		expect(
			claudeHooks(stop(undefined).value).Stop?.[0]?.timeout,
		).toBeUndefined();
		expect(claudeHooks(stop(undefined, 90).value).Stop?.[0]?.timeout).toBe(90);
	});
});
