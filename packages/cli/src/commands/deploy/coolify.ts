import { lookup as dnsLookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import { errorText, readSecrets, type Secrets } from "@openfabriq/runner";
import { PACKAGE_JSON } from "../../paths.js";
import type { CommandResult } from "../../result.js";
import { type ConnectDeps, isSafeUrl } from "../connect/shared.js";

// openfabriq deploy coolify: the engine on your Coolify, through Coolify's API, from what this
// machine already holds: the GitHub App saved by "openfabriq connect github". It asks only for
// Coolify's address and token and a Claude credential, masked, and never prints a secret.

export interface DeployDeps extends ConnectDeps {
	confirm(question: string): Promise<boolean>;
	/** The GitHub repository of the current folder, owner/name, when it has one. */
	repository(): Promise<string | undefined>;
	env?: NodeJS.ProcessEnv;
	sleep?: (ms: number) => Promise<void>;
	/** The IPv4 address of a host name, to check that the studio's domain points at the server. */
	lookup?: (host: string) => Promise<string>;
	/** This CLI's version: the server runs the engine of the same release. */
	version?: string;
}

/** The engine's sources: Coolify builds its docker-compose.yml from them. */
const ENGINE = "https://github.com/openfabriq/openfabriq";
const POLL_MS = 10_000;
/** A first build of the engine's image takes several minutes on a small server. */
const DEPLOY_TRIES = 180;
const LOG_TRIES = 12;
/** As the studio requires of OPENFABRIQ_STUDIO_PASSWORD. */
const MIN_PASSWORD = 16;
/** The engine's service in docker-compose.yml, and the port its studio serves. */
const STUDIO_PORT = 4311;

/** The studio on a domain: people sign in with a password, with GitHub, or both. */
export interface Studio {
	url: string;
	password?: string;
	github?: { client_id: string; client_secret: string };
}

type Claude = {
	name: "ANTHROPIC_API_KEY" | "CLAUDE_CODE_OAUTH_TOKEN";
	value: string;
};
interface Named {
	uuid: string;
	name: string;
	description?: string | null;
}

/** A Coolify server: its address, or a name for the machine Coolify itself runs on. */
interface Server extends Named {
	ip?: string;
}

/** Where a server answers on the Internet: Coolify's own host is named host.docker.internal or localhost. */
export const serverHost = (server: Server, coolifyUrl: string) =>
	!server.ip ||
	["host.docker.internal", "localhost", "127.0.0.1"].includes(server.ip)
		? new URL(coolifyUrl).hostname
		: server.ip;

/** An address the studio accepts as OPENFABRIQ_STUDIO_URL: https and a host, nothing after. */
export function studioOrigin(given: string): string | undefined {
	const url = URL.canParse(given) ? new URL(given) : undefined;
	return url?.protocol === "https:" &&
		url.pathname === "/" &&
		!url.search &&
		!url.hash &&
		!url.username &&
		!url.password
		? url.origin
		: undefined;
}

/** owner/name in a GitHub remote, https or ssh. */
export function githubRepository(remote: string): string | undefined {
	return /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(
		remote.trim(),
	)?.[1];
}

/** A token from `claude setup-token` uses the subscription; anything else is an API key. */
export const claudeCredential = (value: string): Claude => ({
	name: value.startsWith("sk-ant-oat")
		? "CLAUDE_CODE_OAUTH_TOKEN"
		: "ANTHROPIC_API_KEY",
	value,
});

/** The variables of docker-compose.yml the engine needs; secrets are locked, hidden in Coolify. */
export function engineVariables(input: {
	repositories: string[];
	github: { app_id: string; private_key: string };
	claude: Claude;
	studio?: Studio | undefined;
}) {
	const variable = (key: string, value: string, secret = false) => ({
		key,
		value,
		is_literal: true,
		is_preview: false,
		...(secret ? { is_shown_once: true } : {}),
	});
	return [
		variable("OPENFABRIQ_REPOSITORIES", input.repositories.join(",")),
		variable("GITHUB_APP_ID", input.github.app_id),
		// One line, as the compose file wants it.
		variable(
			"GITHUB_APP_PRIVATE_KEY",
			Buffer.from(input.github.private_key).toString("base64"),
			true,
		),
		variable(input.claude.name, input.claude.value, true),
		...(input.studio
			? [variable("OPENFABRIQ_STUDIO_URL", input.studio.url)]
			: []),
		...(input.studio?.password
			? [variable("OPENFABRIQ_STUDIO_PASSWORD", input.studio.password, true)]
			: []),
		...(input.studio?.github
			? [
					variable("GITHUB_APP_CLIENT_ID", input.studio.github.client_id),
					variable(
						"GITHUB_APP_CLIENT_SECRET",
						input.studio.github.client_secret,
						true,
					),
				]
			: []),
	];
}

/** Any text shown to the person, with every secret replaced. */
export const scrub = (text: string, secrets: string[]) =>
	secrets
		.filter((s) => s.length >= 8)
		.reduce((t, s) => t.replaceAll(s, "••••"), text);

/** The engine's log lines worth showing: what doctor finds missing, and each factory's state. */
export const logFindings = (logs: string) =>
	logs
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => /✗|✓|was not applied/.test(line));

class CoolifyError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

function coolify(url: string, token: string, deps: DeployDeps) {
	return async <T>(
		method: string,
		path: string,
		body?: unknown,
	): Promise<T> => {
		const res = await (deps.fetch ?? fetch)(`${url}/api/v1${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/json",
				...(body ? { "Content-Type": "application/json" } : {}),
			},
			...(body ? { body: JSON.stringify(body) } : {}),
		});
		if (!res.ok) {
			const text = (await res.text().catch(() => "")).slice(0, 300);
			throw new CoolifyError(
				res.status,
				`${method} ${path} answered ${res.status}${text ? `: ${text}` : ""}`,
			);
		}
		// Most routes answer JSON; /version answers its number as plain text.
		const text = await res.text();
		try {
			return JSON.parse(text) as T;
		} catch {
			return text as T;
		}
	};
}

/**
 * Asks until `check` accepts the answer (it returns why not, which is shown), three times at
 * most: a typo costs one question again, not the whole command.
 */
async function askValid(
	deps: DeployDeps,
	question: string,
	options: { secret?: boolean; initial?: string },
	check: (answer: string) => string | undefined | Promise<string | undefined>,
): Promise<string | undefined> {
	for (let tries = 0; tries < 3; tries++) {
		const answer = (await deps.ask(question, options)).trim();
		const why = await check(answer);
		if (why === undefined) return answer;
		deps.print(`✗ ${why}`);
	}
	return undefined;
}

/** One of `items`: the only one, or the one the person picks by number. */
async function pick<T extends Named>(
	what: string,
	items: T[],
	deps: DeployDeps,
): Promise<T | undefined> {
	if (items.length <= 1) return items[0];
	deps.print(
		`${what}:\n${items.map((item, i) => `  ${i + 1}. ${item.name}${item.description ? `: ${item.description}` : ""}`).join("\n")}`,
	);
	const answer = await askValid(
		deps,
		`Which ${what.toLowerCase().replace(/s$/, "")} (1-${items.length}): `,
		{},
		(a) =>
			items[Number(a) - 1]
				? undefined
				: `Answer a number from 1 to ${items.length}.`,
	);
	return answer === undefined ? undefined : items[Number(answer) - 1];
}

/** Coolify's address as given, without a trailing slash or the API's path. */
const coolifyAddress = (given: string) =>
	given
		.trim()
		.replace(/\/+$/, "")
		.replace(/\/api\/v1$/, "");

export async function deployCoolify(deps: DeployDeps): Promise<CommandResult> {
	const env = deps.env ?? process.env;
	const sleep = deps.sleep ?? wait;
	const github = readSecrets(env).github;
	if (!github?.app_id || !github.private_key)
		return {
			code: 1,
			output:
				'The engine works on GitHub as your team\'s GitHub App: run "openfabriq connect github" first, then this command again. Nothing was created.',
		};

	if (env.COOLIFY_URL || env.COOLIFY_TOKEN)
		deps.print(
			"Coolify: the address and token of $COOLIFY_URL and $COOLIFY_TOKEN, where set.",
		);
	const addressWhy = (a: string) =>
		isSafeUrl(coolifyAddress(a))
			? undefined
			: "Coolify's address is https://, such as https://coolify.example.com.";
	const given = env.COOLIFY_URL
		? env.COOLIFY_URL
		: await askValid(deps, "Coolify's address (https://…): ", {}, addressWhy);
	if (given === undefined || addressWhy(given))
		return {
			code: 1,
			output: `${addressWhy(given ?? "") ?? ""} Nothing was created.`.trim(),
		};
	const url = coolifyAddress(given);

	// Asked, never a flag: a flag stays in the shell history and shows in ps.
	const tokenWhy = async (token: string) => {
		if (!token)
			return "Paste the API token made in Coolify, under Keys & Tokens.";
		try {
			await coolify(url, token, deps)("GET", "/version");
			return undefined;
		} catch (error) {
			const status = error instanceof CoolifyError ? error.status : undefined;
			const source = env.COOLIFY_TOKEN ? " (the token of $COOLIFY_TOKEN)" : "";
			return status === 401
				? `Coolify at ${url} does not know the token${source}: check it was copied whole, or make a new one in Keys & Tokens.`
				: status === 403
					? `Coolify at ${url} refused the token${source}: turn on Settings › Advanced › API Access, and give the token the abilities read, write, deploy and read:sensitive.`
					: `Coolify did not answer at ${url} (${errorText(error)}).`;
		}
	};
	let token: string | undefined;
	if (env.COOLIFY_TOKEN) {
		const why = await tokenWhy(env.COOLIFY_TOKEN.trim());
		if (why) return { code: 1, output: `${why} Nothing was created.` };
		token = env.COOLIFY_TOKEN.trim();
	} else
		token = await askValid(
			deps,
			"Coolify API token (abilities read, write, deploy, read:sensitive): ",
			{ secret: true },
			tokenWhy,
		);
	if (!token)
		return {
			code: 1,
			output: "Coolify did not accept a token. Nothing was created.",
		};
	const api = coolify(url, token, deps);

	const fromEnv = env.CLAUDE_CODE_OAUTH_TOKEN
		? "CLAUDE_CODE_OAUTH_TOKEN"
		: env.ANTHROPIC_API_KEY
			? "ANTHROPIC_API_KEY"
			: undefined;
	if (fromEnv) deps.print(`Claude: the credential in $${fromEnv}.`);
	const credential =
		(env.CLAUDE_CODE_OAUTH_TOKEN ?? env.ANTHROPIC_API_KEY)?.trim() ||
		(await askValid(
			deps,
			'Claude for the engine: a token from "claude setup-token" (your subscription) or an Anthropic API key: ',
			{ secret: true },
			(a) =>
				a
					? undefined
					: 'Paste a token from "claude setup-token" (sk-ant-oat…) or an Anthropic API key (sk-ant-api…).',
		));
	if (!credential)
		return {
			code: 1,
			output: "The engine needs a Claude credential. Nothing was created.",
		};
	const claude = claudeCredential(credential);
	const secrets = [
		token,
		claude.value,
		github.private_key,
		Buffer.from(github.private_key).toString("base64"),
	];
	const shown = (text: string) => scrub(text, secrets);

	const here = await deps.repository().catch(() => undefined);
	const listed = await askValid(
		deps,
		"GitHub repositories the engine runs (owner/name, comma-separated): ",
		here ? { initial: here } : {},
		(a) => {
			const names = a
				.split(",")
				.map((r) => r.trim())
				.filter(Boolean);
			return names.length && names.every((r) => /^[\w.-]+\/[\w.-]+$/.test(r))
				? undefined
				: "The repositories are owner/name, comma-separated, such as acme/web-app.";
		},
	);
	if (listed === undefined)
		return {
			code: 1,
			output: "No repository for the engine. Nothing was created.",
		};
	const repositories = listed
		.split(",")
		.map((r) => r.trim())
		.filter(Boolean);

	const tag = `v${deps.version ?? (JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as { version: string }).version}`;
	let created: { name: string; uuid: string } | undefined;
	try {
		const server = await pick(
			"Servers",
			await api<Server[]>("GET", "/servers"),
			deps,
		);
		const project = await pick(
			"Projects",
			await api<Named[]>("GET", "/projects"),
			deps,
		);
		if (!server || !project)
			return {
				code: 1,
				output:
					"Coolify has no server or project to use, or none was picked. Nothing was created.",
			};
		const { environments = [] } = await api<{ environments?: Named[] }>(
			"GET",
			`/projects/${project.uuid}`,
		);
		const environment = await pick("Environments", environments, deps);
		if (!environment)
			return {
				code: 1,
				output: `The project ${project.name} has no environment. Nothing was created.`,
			};
		const name =
			(
				await deps.ask("Name of the application in Coolify: ", {
					initial: "openfabriq",
				})
			).trim() || "openfabriq";
		const studio = await askStudio(deps, github);
		if (typeof studio === "string") return { code: 1, output: studio };
		for (const secret of [studio?.password, studio?.github?.client_secret])
			if (secret) secrets.push(secret);
		// The studio's domain must reach this server's proxy, or the studio answers nothing.
		if (studio) {
			const lookup =
				deps.lookup ??
				(async (host: string) =>
					(await dnsLookup(host, { family: 4 })).address);
			const host = new URL(studio.url).hostname;
			const [domainAt, serverAt] = await Promise.all([
				lookup(host).catch(() => undefined),
				lookup(serverHost(server, url)).catch(() => undefined),
			]);
			if (domainAt && serverAt && domainAt !== serverAt) {
				deps.print(
					`✗ ${host} points at ${domainAt}, but ${server.name} is at ${serverAt}: the studio would answer nothing there. Pick the server ${host} points at, or point the domain at ${serverAt}.`,
				);
				if (!(await deps.confirm(`Deploy on ${server.name} anyway?`)))
					return { code: 1, output: "Nothing was created." };
			}
		}

		const running = (
			await api<{ name: string; git_repository?: string }[]>(
				"GET",
				"/applications",
			)
		).filter((app) => app.git_repository?.includes("openfabriq/openfabriq"));
		if (running.length) {
			deps.print(
				`✗ Coolify runs the engine already: ${running.map((app) => app.name).join(", ")}. Two engines on the same repositories would run every automation twice. Change or delete it in Coolify instead.`,
			);
			if (!(await deps.confirm("Create another engine anyway?")))
				return { code: 1, output: "Nothing was created." };
		}

		deps.print(
			`The engine will run ${repositories.join(", ")} as the GitHub App ${github.slug ?? github.app_id}, with ${claude.name === "CLAUDE_CODE_OAUTH_TOKEN" ? "your Claude subscription" : "an Anthropic API key"}: the application ${name}, built from ${ENGINE} (${tag}), on ${server.name}, in ${project.name} › ${environment.name}${studio ? `, its studio at ${studio.url}` : ""}.`,
		);
		if (!(await deps.confirm("Create it and deploy?")))
			return { code: 1, output: "Nothing was created." };

		const { uuid } = await api<{ uuid: string }>(
			"POST",
			"/applications/public",
			{
				project_uuid: project.uuid,
				server_uuid: server.uuid,
				environment_uuid: environment.uuid,
				git_repository: ENGINE,
				// A tag: the release this CLI is, so the server accepts what it validated.
				git_branch: tag,
				build_pack: "dockercompose",
				docker_compose_location: "/docker-compose.yml",
				base_directory: "/",
				name,
				instant_deploy: false,
				// Coolify's proxy sends the domain to that port of the engine, with a certificate.
				...(studio
					? {
							docker_compose_domains: [
								{ name: "engine", domain: `${studio.url}:${STUDIO_PORT}` },
							],
						}
					: {}),
			},
		);
		created = { name, uuid };
		await api("PATCH", `/applications/${uuid}/envs/bulk`, {
			data: engineVariables({
				repositories,
				github: { app_id: github.app_id, private_key: github.private_key },
				claude,
				studio,
			}),
		});
		deps.print(
			`✓ Application ${name} created (${uuid}), its variables set. Deploying: the first build takes a few minutes...`,
		);

		const { deployments = [] } = await api<{
			deployments?: { deployment_uuid: string }[];
		}>("POST", `/deploy?uuid=${uuid}`);
		const deployment = deployments[0]?.deployment_uuid;
		let status = "queued";
		for (let tries = 0; deployment && tries < DEPLOY_TRIES; tries++) {
			({ status } = await api<{ status: string }>(
				"GET",
				`/deployments/${deployment}`,
			));
			if (!["queued", "in_progress"].includes(status)) break;
			await sleep(POLL_MS);
		}
		if (status !== "finished")
			return {
				code: 1,
				output: shown(
					`The deployment of ${name} ended as "${status}". Its log is in Coolify, on the application's Deployments tab. The application stays, to fix and deploy again from Coolify.`,
				),
			};

		// The engine prints what doctor finds, then each factory's state, once it has started.
		let findings: string[] = [];
		for (let tries = 0; tries < LOG_TRIES && !findings.length; tries++) {
			await sleep(POLL_MS);
			const { logs = "" } = await api<{ logs?: string }>(
				"GET",
				`/applications/${uuid}/logs?lines=200`,
			).catch(() => ({ logs: "" }));
			findings = logFindings(logs);
		}
		return {
			code: findings.some(
				(line) => line.includes("✗") || line.includes("was not applied"),
			)
				? 1
				: 0,
			output: shown(
				[
					`The engine is deployed on ${server.name}: application ${name} in ${project.name} › ${environment.name}.`,
					...(findings.length
						? findings
						: ["It has not logged its checks yet: read its logs in Coolify."]),
					"",
					...(studio
						? [
								`Studio: ${studio.url}. ${signIn(studio)} Claude Desktop, claude.ai and Claude Code read the engine at ${studio.url}/mcp.`,
							]
						: [
								"The studio has no address: run this command again with one, or see the documentation's Docker page.",
							]),
					"Left for you, in the documentation's Docker page: the relay for Slack and Linear. A factory's own secrets: openfabriq secret set <NAME> --project <owner/repo>, in the application's terminal in Coolify.",
					"If you made the Coolify token only for this, delete it in Coolify (Keys & Tokens).",
				].join("\n"),
			),
		};
	} catch (error) {
		return {
			code: 1,
			output: shown(
				`Coolify refused a step (${errorText(error)}).${created ? ` The application ${created.name} (${created.uuid}) was created: fix it in Coolify, or delete it there before running this command again.` : " Nothing was created."}`,
			),
		};
	}
}

/** How people sign in to the studio, said once it is deployed. */
const signIn = (studio: Studio) =>
	[
		studio.github &&
			"Whoever can write to the repositories signs in with their GitHub account.",
		studio.password &&
			(studio.github
				? "The password you typed opens it too."
				: "The password you typed opens it."),
	]
		.filter(Boolean)
		.join(" ");

/** The studio's password, typed twice; undefined after three tries. */
async function askPassword(deps: DeployDeps): Promise<string | undefined> {
	for (let tries = 0; tries < 3; tries++) {
		const password = await askValid(
			deps,
			`The studio's password (${MIN_PASSWORD} characters or more, kept only in Coolify): `,
			{ secret: true },
			(a) =>
				a.length >= MIN_PASSWORD
					? undefined
					: `The password needs ${MIN_PASSWORD} characters or more, for example from openssl rand -base64 24.`,
		);
		if (password === undefined) return undefined;
		const again = (
			await deps.ask("The same password again: ", { secret: true })
		).trim();
		if (again === password) return password;
		deps.print("✗ The two passwords differ: type it again.");
	}
	return undefined;
}

/**
 * The GitHub App's client, for sign-in with GitHub: the one "connect github --url" saved, or the
 * one the person copies from the app's settings, once its callback URL is set.
 */
async function askClient(
	deps: DeployDeps,
	github: Secrets["github"],
	url: string,
): Promise<{ client_id: string; client_secret: string } | undefined> {
	const callback = `${url}/auth/github/callback`;
	const settings = `https://github.com/settings/apps/${github?.slug ?? "<the app>"} (for an organization's app: its Settings › Developer settings › GitHub Apps)`;
	if (github?.client_id && github.client_secret) {
		if (github.studio_url !== url)
			deps.print(
				`The app comes back to ${github.studio_url ?? "another address"}: in its settings, ${settings}, under Identifying and authorizing users, add the Redirect URI ${callback}, then Save changes.`,
			);
		return { client_id: github.client_id, client_secret: github.client_secret };
	}
	deps.print(
		`Sign-in with GitHub goes through the app ${github?.slug ?? ""}. In its settings, ${settings}, under Identifying and authorizing users: add the Redirect URI ${callback}, Save changes, then Generate a new client secret.`,
	);
	const client_id = await askValid(deps, "The app's Client ID: ", {}, (a) =>
		a ? undefined : "Copy the Client ID shown in the app's settings.",
	);
	if (!client_id) return undefined;
	const client_secret = await askValid(
		deps,
		"Its client secret: ",
		{ secret: true },
		(a) => (a ? undefined : "Paste the client secret you generated."),
	);
	return client_secret ? { client_id, client_secret } : undefined;
}

/** The studio's https address and how people sign in, or none, or why they are refused. */
async function askStudio(
	deps: DeployDeps,
	github: Secrets["github"],
): Promise<Studio | undefined | string> {
	const given = await askValid(
		deps,
		"The studio's address, on a domain that points at the server (https://…, Enter for none): ",
		{},
		(a) =>
			!a || studioOrigin(a)
				? undefined
				: "The studio's address is https:// and a domain, with no path, such as https://factory.example.com, or Enter for none.",
	);
	if (given === undefined)
		return "No valid address for the studio. Nothing was created.";
	if (!given) return undefined;
	const url = studioOrigin(given) ?? given;
	const mode = await pick(
		"Sign-in modes",
		[
			{
				uuid: "github",
				name: "With GitHub: whoever can write to the repositories",
			},
			{ uuid: "password", name: "With a password" },
			{ uuid: "both", name: "Both" },
		],
		deps,
	);
	if (!mode) return "No way to sign in to the studio. Nothing was created.";
	const studio: Studio = { url };
	if (mode.uuid !== "password") {
		const client = await askClient(deps, github, url);
		if (!client)
			return "No client for sign-in with GitHub. Nothing was created.";
		studio.github = client;
	}
	if (mode.uuid !== "github") {
		const password = await askPassword(deps);
		if (!password) return "No password for the studio. Nothing was created.";
		studio.password = password;
	}
	return studio;
}

export async function deployCommand(
	target: string | undefined,
	deps: DeployDeps,
): Promise<CommandResult> {
	if (target === "coolify") return deployCoolify(deps);
	return { code: 1, output: "Usage: openfabriq deploy coolify" };
}
