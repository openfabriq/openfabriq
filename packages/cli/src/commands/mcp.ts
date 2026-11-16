// openfabriq mcp: the chat's read-only tools for an MCP client (Claude Code, Claude Desktop), on
// stdio. It writes, starts and applies nothing.

import { factoryMcpServer, serveStdio } from "@openfabriq/runner";
import { appChatTools, askSubject, cachedStates } from "@openfabriq/studio";
import type { CommandResult } from "../result.js";

export async function mcpCommand(): Promise<CommandResult> {
	// stdout carries the protocol only.
	console.log = console.error;
	// What the board and the numbers ask about pull requests, as the studio does: read only.
	const states = cachedStates(askSubject());
	await serveStdio(
		factoryMcpServer((repository) => appChatTools(repository, states)),
	);
	return { code: 0, output: "" };
}
