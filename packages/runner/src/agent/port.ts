import type { Network, Tool, ToolSummary } from "@openfabriq/core";
import type { z } from "zod";
import type { Verdict } from "../run/internal-review.js";
import type { Proposal } from "../run/outputs/tools.js";
import type { AgentMcp } from "./mcp.js";

// The engine's port to an agent engine: what a run gives it and what it says back. Nothing here
// belongs to one engine: an adapter (claude.ts) turns the tools and the stop into its own.

/** What an engine tool answers the agent. */
export interface ToolAnswer {
	text: string;
	/** The call failed: the agent is told so. */
	isError?: boolean;
}

/** One of the engine's tools for a run: an output, run_command, commit, or the reviewer's verdict. */
export interface EngineTool<Shape extends z.ZodRawShape = z.ZodRawShape> {
	name: string;
	description: string;
	/** Its arguments, checked before `run` sees them. */
	schema: Shape;
	run: (args: z.infer<z.ZodObject<Shape>>) => Promise<ToolAnswer>;
}

/** An engine tool, typed by its schema where it is written and by any schema where it is served. */
export const engineTool = <Shape extends z.ZodRawShape>(
	tool: EngineTool<Shape>,
): EngineTool => tool as unknown as EngineTool;

/** The factory's harness at the agent's stop. */
export interface Stop {
	/** The agent wants to finish: undefined lets it, a reason sends it back to work with that reason. */
	check: () => Promise<string | undefined>;
	/** After any tool call: the code may have changed since a passing stop. */
	afterTool: () => void;
	/** How long `check` may take, in seconds: a review runs in it. */
	timeoutSeconds?: number;
}

export interface AgentRun {
	prompt: string;
	instructions: string;
	cwd: string;
	model: string;
	tools: Tool[];
	/** What its shell and web tool reach. */
	network: Network;
	/** Told the sites the network refused the web tool. */
	onRefused?: (sites: string[]) => void;
	/**
	 * The output tools; `propose` is what they call. A fake launcher, in the tests, calls it
	 * directly, as the agent would through a tool.
	 */
	outputs: {
		tools: EngineTool[];
		propose: (p: Proposal) => void;
		/** A reviewer's verdict tool calls it (reviewed_by); a fake reviewer, in the tests, calls it directly. */
		review?: (verdict: Verdict) => void;
	};
	plugin?: string;
	/** The factory's MCP servers this agent names, and the tools it may call. */
	mcp?: AgentMcp;
	/** The factory's harness: the checks at the agent's stop. */
	stop?: Stop;
	budgetUsd: number;
	timeoutMs: number;
	/** The agent's environment: credential-free, with the factory's env and never its secrets. */
	env: Record<string, string>;
	transcript: string;
	/** Each tool call of the agent, as it comes: a delegated Linear run shows them. */
	onStep?(step: ToolSummary): void;
}

export interface AgentResult {
	status: "succeeded" | "failed";
	reason?: string;
	costUsd: number;
	turns: number;
	tokens: { input: number; output: number };
	model?: string;
	/** Listed MCP tools and servers the agent engine could not offer: the run went on without them. */
	mcpUnavailable?: string[];
}

export type AgentLauncher = (run: AgentRun) => Promise<AgentResult>;
