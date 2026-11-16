import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { errorText, readJsonIfExists, writeFileAtomic } from "../files.js";
import { factorySecretsDir } from "./factory-secrets.js";
import { home, studioTokenPath } from "./projects.js";

// Tokens for Slack and Sentry, and the relay's, stay on this machine: in ~/.openfabriq/secrets.json,
// readable by the user only, or in environment variables that win over the file. Never in
// openfabriq/, never in an agent's environment (credentialFreeEnv strips them).

export interface Secrets {
	/** Mentions come through the relay; the bot token reads threads and replies. */
	slack?: { bot_token?: string };
	/** Linear's app token stays in the relay, which refreshes it. */
	relay?: { url: string; token: string };
	/** url: the Sentry the token was tested against, for information. */
	sentry?: { token?: string; url?: string };
	/** The GitHub App "openfabriq connect github" created; GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY win. */
	github?: {
		app_id?: string;
		slug?: string;
		private_key?: string;
		/** With `connect github --url`: the app's client for sign-in with GitHub, and the studio it comes back to. */
		client_id?: string;
		client_secret?: string;
		studio_url?: string;
	};
}

const ENV: [keyof Secrets, string, string][] = [
	["slack", "bot_token", "OPENFABRIQ_SLACK_BOT_TOKEN"],
	["sentry", "token", "OPENFABRIQ_SENTRY_TOKEN"],
];

export const secretsPath = () => join(home(), "secrets.json");

/** What no command or agent shell of a run reads: the engine's tokens, the chat's, and every project's secret values. */
export const engineSecretPaths = () => [
	secretsPath(),
	studioTokenPath(),
	factorySecretsDir(),
];

function readFile(): Secrets {
	try {
		return readJsonIfExists<Secrets>(secretsPath()) ?? {};
	} catch (error) {
		throw new Error(
			`${secretsPath()} is not valid JSON (${errorText(error)}); fix it, or delete it and run "openfabriq connect" again`,
		);
	}
}

export function readSecrets(env: NodeJS.ProcessEnv = process.env): Secrets {
	const secrets = readFile();
	for (const [service, key, name] of ENV) {
		const value = env[name];
		if (value)
			(secrets as Record<string, Record<string, string>>)[service] = {
				...(secrets[service] as Record<string, string> | undefined),
				[key]: value,
			};
	}
	return secrets;
}

/** Merges one service's secrets into the file, readable and writable by the user only. */
export function writeSecrets<K extends keyof Secrets>(
	service: K,
	values: NonNullable<Secrets[K]>,
): void {
	const secrets = { ...readFile(), [service]: values };
	mkdirSync(home(), { recursive: true, mode: 0o700 });
	writeFileAtomic(
		secretsPath(),
		`${JSON.stringify(secrets, null, 2)}\n`,
		0o600,
	);
}
