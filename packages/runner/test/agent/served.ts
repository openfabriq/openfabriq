import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { z } from "zod";
import { claudeHooks, claudeTools } from "../../src/agent/claude.js";
import type { EngineTool, Stop } from "../../src/agent/port.js";

// The engine's tools and its stop as Claude Code meets them, through the Claude adapter: the tests
// that check what the agent is offered and told go through it, as a run does.

/** A tool as the adapter's MCP server registered it. */
export interface ServedTool {
	description?: string;
	inputSchema?: z.ZodType;
	handler: (
		args: unknown,
		extra: unknown,
	) => Promise<{
		content: { type: string; text: string }[];
		isError?: boolean;
	}>;
}

/**
 * The engine's tools as Claude Code calls them, by name. `_registeredTools` is a private field of the
 * MCP SDK's McpServer: an update of that SDK can break this helper without any change in behavior.
 */
export const servedTools = (tools: EngineTool[]): Record<string, ServedTool> =>
	(
		claudeTools(tools).server.instance as unknown as {
			_registeredTools: Record<string, ServedTool>;
		}
	)._registeredTools;

const signal = () => ({ signal: new AbortController().signal });

/** What the Stop hook answers Claude Code when the agent wants to finish: {} lets it. */
export const stopHook = async (
	stop: Stop | undefined,
): Promise<SyncHookJSONOutput | undefined> =>
	(await (stop && claudeHooks(stop).Stop?.[0]?.hooks[0])?.(
		{ hook_event_name: "Stop", stop_hook_active: false } as never,
		undefined,
		signal(),
	)) as SyncHookJSONOutput | undefined;

/** What the PostToolUse hook answers after any tool call. */
export const afterToolHook = async (
	stop: Stop | undefined,
): Promise<SyncHookJSONOutput | undefined> =>
	(await (stop && claudeHooks(stop).PostToolUse?.[0]?.hooks[0])?.(
		{ hook_event_name: "PostToolUse" } as never,
		"tool-1",
		signal(),
	)) as SyncHookJSONOutput | undefined;
