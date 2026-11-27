import { SIGNATURES } from "../vocabulary.js";
import { isOneOf, suggested, unknownWord } from "../words.js";
import { changesLoading, isEngineVariable } from "./env.js";
import type { FactoryShape, Parsed } from "./schema.js";

/** A webhook, MCP server, agent or automation name: it goes in URLs, branch names and labels. */
export const NAME = /^[a-z][a-z0-9-]*$/;

/** What factory.yaml asks that the rest of the factory, or the engine, refuses. */
export function factoryProblems(fields: Parsed<typeof FactoryShape>): string[] {
	const problems: string[] = [];
	// GitHub sends logins without @: a maintainer written with one would never start anything.
	for (const login of fields.maintainers ?? [])
		if (login.startsWith("@"))
			problems.push(
				`maintainers lists "${login}": a GitHub login, without @, like ${login.replace(/^@+/, "")}`,
			);
	// checks name commands; they never repeat one.
	for (const name of fields.checks ?? [])
		if (!Object.hasOwn(fields.commands ?? {}, name))
			problems.push(
				suggested(
					`checks lists "${name}", which is not in commands.`,
					name,
					Object.keys(fields.commands ?? {}),
				),
			);
	// A factory never hands the engine's tokens back to its commands.
	for (const name of Object.keys(fields.env ?? {}))
		if (isEngineVariable(name))
			problems.push(
				`env.${name} belongs to the engine; a factory cannot give it to its commands`,
			);
		else if (changesLoading(name))
			problems.push(
				`env.${name} changes how programs load code; a factory cannot set it`,
			);
	for (const name of fields.secrets ?? []) {
		if (isEngineVariable(name))
			problems.push(
				`secrets lists ${name}, which belongs to the engine; a factory cannot give it to its commands`,
			);
		if (Object.hasOwn(fields.env ?? {}, name))
			problems.push(`${name} is in both env and secrets; keep it in one`);
	}
	for (const [name, webhook] of Object.entries(fields.webhooks ?? {})) {
		if (!NAME.test(name))
			problems.push(
				`webhooks.${name}: a webhook name is lowercase letters, digits and -, like deploy-failed`,
			);
		if (!isOneOf(SIGNATURES, webhook.signature))
			problems.push(
				unknownWord(
					"signature",
					webhook.signature,
					SIGNATURES,
					`webhooks.${name}.signature`,
				),
			);
	}
	problems.push(...mcpProblems(fields));
	return problems;
}

/** A GitHub MCP server would let an agent write to GitHub, which only the engine does. */
const GITHUB_MCP = /(^|\.)(github\.com|githubcopilot\.com)$/;
const isGitHubServer = (server: {
	url?: string | undefined;
	command?: string | undefined;
}) =>
	// A name may end with a dot: api.githubcopilot.com. is the same server.
	(server.url !== undefined &&
		GITHUB_MCP.test(new URL(server.url).hostname.replace(/\.$/, ""))) ||
	/github-mcp-server|server-github/.test(server.command ?? "");

/** The factory's MCP servers, one at a time. */
function mcpProblems(fields: Parsed<typeof FactoryShape>): string[] {
	const problems: string[] = [];
	for (const [name, server] of Object.entries(fields.mcp ?? {})) {
		const at = `mcp.${name}`;
		if (!NAME.test(name))
			problems.push(
				`${at}: a server name is lowercase letters, digits and -, like sentry or test-db`,
			);
		else if (name === "openfabriq")
			problems.push(`${at} is the engine's own server; choose another name`);
		if (server.url && server.command)
			problems.push(`${at} has both url and command; a server is either one`);
		else if (!server.url && !server.command)
			problems.push(
				`${at} needs url (a remote server) or command (a server run on this machine)`,
			);
		else if (server.command && server.secret)
			problems.push(
				`${at}.secret is for a remote server; a server run by command takes secrets: [...]`,
			);
		else if (server.url && server.secrets)
			problems.push(
				`${at}.secrets is for a server run by command; a remote server takes one secret`,
			);
		// Declared here only, it goes to this server alone.
		for (const secret of [server.secret ?? [], server.secrets ?? []].flat())
			if (isEngineVariable(secret))
				problems.push(
					`${at} names ${secret}, which belongs to the engine; a factory cannot give it to a server`,
				);
			else if (Object.hasOwn(fields.env ?? {}, secret))
				problems.push(`${secret} is in both env and ${at}; keep it in one`);
		if (isGitHubServer(server))
			problems.push(
				`${at} is a GitHub server; agents never write to GitHub, the engine does`,
			);
	}
	return problems;
}
