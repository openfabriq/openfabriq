import { type Agent, type Factory, secretNames } from "@openfabriq/core";
import { secretValues } from "../state/factory-secrets.js";

/** How to reach one of the factory's MCP servers: remote over HTTP, or a local command. */
export type McpServer =
	| { type: "http"; url: string; headers?: Record<string, string> }
	| { command: string; args: string[]; env: Record<string, string> };

export interface AgentMcp {
	servers: Record<string, McpServer>;
	/** The tools the agent may call, as Claude Code names them: mcp__<server>__<tool>. */
	tools: string[];
}

/**
 * The factory's MCP servers this agent names, and the tools it lists. Secrets come from
 * the engine's environment, then the project's file: a remote server gets one as a
 * bearer token, a local one in its env. A local server runs in the sandbox of the engine's commands.
 */
export async function agentMcp(
	agent: Agent,
	factory: Factory,
	agentEnv: Record<string, string>,
	/** The shell line that runs a local server's command in the sandbox, outside the worktree (VULN-011). */
	sandboxed: (command: string) => Promise<string>,
	env: NodeJS.ProcessEnv = process.env,
): Promise<AgentMcp | undefined> {
	const entries = Object.entries(agent.mcp ?? {});
	if (!entries.length) return undefined;
	const values = secretValues(factory.repository, secretNames(factory), env);
	const servers: Record<string, McpServer> = {};
	for (const [name] of entries) {
		const server = factory.mcp?.[name];
		if (!server) continue;
		if ("url" in server) {
			const token = server.secret && values[server.secret];
			servers[name] = {
				type: "http",
				url: server.url,
				...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
			};
		} else {
			const secrets: Record<string, string> = {};
			for (const secret of server.secrets ?? []) {
				const value = values[secret];
				if (value !== undefined) secrets[secret] = value;
			}
			// Through sh, like setup and the commands: the line is written as in a terminal.
			servers[name] = {
				command: "sh",
				args: ["-c", await sandboxed(server.command)],
				env: { ...agentEnv, ...secrets },
			};
		}
	}
	return {
		servers,
		tools: entries.flatMap(([server, tools]) =>
			tools.map((tool) => `mcp__${server}__${tool}`),
		),
	};
}

/** The listed tools Claude Code did not offer, and the servers it could not connect: the run goes on without them. */
export function unavailableMcp(
	mcp: AgentMcp,
	init:
		| { tools: string[]; mcp_servers: { name: string; status: string }[] }
		| undefined,
): string[] {
	if (!init) return [];
	const failed = init.mcp_servers
		.filter((s) => s.name in mcp.servers && s.status !== "connected")
		.map((s) => `${s.name} (${s.status})`);
	const missing = mcp.tools
		.filter((t) => !init.tools.includes(t))
		.map((t) => t.replace(/^mcp__/, "").replace("__", "."));
	return [...failed, ...missing];
}
