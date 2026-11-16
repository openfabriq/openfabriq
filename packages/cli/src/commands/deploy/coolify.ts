import { setTimeout as wait } from "node:timers/promises";
import { errorText, readSecrets } from "@openfabriq/runner";
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
}

/** The engine's sources: Coolify builds its docker-compose.yml from them. */
const ENGINE = "https://github.com/openfabriq/openfabriq";
const POLL_MS = 10_000;
/** A first build of the engine's image takes several minutes on a small server. */
const DEPLOY_TRIES = 180;
const LOG_TRIES = 12;

type Claude = {
	name: "ANTHROPIC_API_KEY" | "CLAUDE_CODE_OAUTH_TOKEN";
	value: string;
};
interface Named {
	uuid: string;
	name: string;
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
		return (await res.json()) as T;
	};
}

/** One of `items`: the only one, or the one the person picks by number. */
async function pick<T extends Named>(
	what: string,
	items: T[],
	deps: DeployDeps,
): Promise<T | undefined> {
	if (items.length <= 1) return items[0];
	deps.print(
		`${what}:\n${items.map((item, i) => `  ${i + 1}. ${item.name}`).join("\n")}`,
	);
	const answer = Number(
		(
			await deps.ask(
				`Which ${what.toLowerCase().replace(/s$/, "")} (1-${items.length}): `,
			)
		).trim(),
	);
	return items[answer - 1];
}

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
	const url = (
		env.COOLIFY_URL ?? (await deps.ask("Coolify's address (https://…): "))
	)
		.trim()
		.replace(/\/+$/, "")
		.replace(/\/api\/v1$/, "");
	// Asked, never a flag: a flag stays in the shell history and shows in ps.
	const token = (
		env.COOLIFY_TOKEN ??
		(await deps.ask(
			"Coolify API token (abilities read, write, deploy, read:sensitive): ",
			{ secret: true },
		))
	).trim();
	if (!isSafeUrl(url) || !token)
		return {
			code: 1,
			output:
				"Coolify's https address and an API token are needed. Nothing was created.",
		};
	const api = coolify(url, token, deps);
	try {
		await api("GET", "/version");
	} catch (error) {
		const status = error instanceof CoolifyError ? error.status : undefined;
		const source = env.COOLIFY_TOKEN ? " (the token of $COOLIFY_TOKEN)" : "";
		const why =
			status === 401
				? `Coolify at ${url} does not know the token${source}: check it was copied whole, or make a new one in Keys & Tokens.`
				: status === 403
					? `Coolify at ${url} refused the token${source}: turn on Settings › Advanced › API Access, and give the token the abilities read, write, deploy and read:sensitive.`
					: `Coolify did not answer at ${url} (${errorText(error)}).`;
		return { code: 1, output: `${why} Nothing was created.` };
	}

	const fromEnv = env.CLAUDE_CODE_OAUTH_TOKEN
		? "CLAUDE_CODE_OAUTH_TOKEN"
		: env.ANTHROPIC_API_KEY
			? "ANTHROPIC_API_KEY"
			: undefined;
	if (fromEnv) deps.print(`Claude: the credential in $${fromEnv}.`);
	const given = (
		env.CLAUDE_CODE_OAUTH_TOKEN ??
		env.ANTHROPIC_API_KEY ??
		(await deps.ask(
			'Claude for the engine: a token from "claude setup-token" (your subscription) or an Anthropic API key: ',
			{ secret: true },
		))
	).trim();
	if (!given)
		return {
			code: 1,
			output: "The engine needs a Claude credential. Nothing was created.",
		};
	const claude = claudeCredential(given);
	const secrets = [token, claude.value, github.private_key];
	const shown = (text: string) => scrub(text, secrets);

	const here = await deps.repository().catch(() => undefined);
	const repositories = (
		await deps.ask(
			"GitHub repositories the engine runs (owner/name, comma-separated): ",
			here ? { initial: here } : {},
		)
	)
		.split(",")
		.map((r) => r.trim())
		.filter(Boolean);
	if (
		!repositories.length ||
		repositories.some((r) => !/^[\w.-]+\/[\w.-]+$/.test(r))
	)
		return {
			code: 1,
			output:
				"The repositories are owner/name, comma-separated. Nothing was created.",
		};

	try {
		const server = await pick(
			"Servers",
			await api<Named[]>("GET", "/servers"),
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

		deps.print(
			`The engine will run ${repositories.join(", ")} as the GitHub App ${github.slug ?? github.app_id}, with ${claude.name === "CLAUDE_CODE_OAUTH_TOKEN" ? "your Claude subscription" : "an Anthropic API key"}: the application ${name}, built from ${ENGINE} (main), on ${server.name}, in ${project.name} › ${environment.name}.`,
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
				git_branch: "main",
				build_pack: "dockercompose",
				docker_compose_location: "/docker-compose.yml",
				base_directory: "/",
				name,
				instant_deploy: false,
			},
		);
		await api("PATCH", `/applications/${uuid}/envs/bulk`, {
			data: engineVariables({
				repositories,
				github: { app_id: github.app_id, private_key: github.private_key },
				claude,
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
					"Left for you, in the documentation's Docker page: the studio's domain and password, and the relay for Slack and Linear. A factory's own secrets: openfabriq secret set <NAME> --project <owner/repo>, in the application's terminal in Coolify.",
					"If you made the Coolify token only for this, delete it in Coolify (Keys & Tokens).",
				].join("\n"),
			),
		};
	} catch (error) {
		return {
			code: 1,
			output: shown(`Coolify refused a step (${errorText(error)}).`),
		};
	}
}

export async function deployCommand(
	target: string | undefined,
	deps: DeployDeps,
): Promise<CommandResult> {
	if (target === "coolify") return deployCoolify(deps);
	return { code: 1, output: "Usage: openfabriq deploy coolify" };
}
