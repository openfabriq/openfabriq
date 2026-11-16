import { randomBytes } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
	errorText,
	exec,
	githubApp,
	readSecrets,
	secretsPath,
	writeSecrets,
} from "@openfabriq/runner";
import type { CommandResult } from "../../result.js";
import { type ConnectDeps, RESTART_START } from "./shared.js";

// openfabriq connect github: creates the team's own GitHub App from a manifest, saves its key on
// this machine, then opens its install page. The engine then works as that app, with a token per
// repository, instead of a person's login or a bot account's token.

/** What the engine does on a repository, and no more (checked on docs.github.com). */
const PERMISSIONS = {
	metadata: "read",
	contents: "write", // clone, push branches, merge
	issues: "write", // comment, label, open issues
	pull_requests: "write", // open, review, merge pull requests
	checks: "read", // the CI's check runs, which a fine-grained token cannot read
	statuses: "read", // the CI's commit statuses
	actions: "read", // a failed job's log
} as const;

const HOME = "https://github.com/openfabriq/openfabriq";

/** The app's manifest: private, no webhook (the engine polls), only the permissions it uses. */
export function githubAppManifest(options: {
	redirectUrl: string;
	org?: string;
	workflows?: boolean;
	/** The studio's https address: GitHub sends who signs in with it back there. */
	studioUrl?: string;
}) {
	return {
		// GitHub App names are unique on GitHub: the person changes it on the page if it is taken.
		name: `${options.org ?? "openfabriq"}-factory`.slice(0, 34),
		url: HOME,
		description: "The software factory of this team, run by openfabriq",
		public: false,
		redirect_url: options.redirectUrl,
		...(options.studioUrl
			? { callback_urls: [`${options.studioUrl}/auth/github/callback`] }
			: {}),
		// GitHub wants a webhook URL even when the webhook is off.
		hook_attributes: { url: HOME, active: false },
		default_events: [],
		default_permissions: {
			...PERMISSIONS,
			// Only when the factory changes CI files: a push touching .github/workflows/ needs it.
			...(options.workflows ? { workflows: "write" } : {}),
		},
	};
}

/** Where the manifest is posted: the person's account, or an organization they administer. */
export const newAppUrl = (state: string, org?: string) =>
	`https://github.com/${org ? `organizations/${encodeURIComponent(org)}/` : ""}settings/apps/new?state=${state}`;

const escapeHtml = (text: string) =>
	text
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");

/** The local page that posts the manifest to GitHub: a browser can only send it as a form. */
export function manifestPage(action: string, manifest: unknown): string {
	return `<!doctype html>
<meta charset="utf-8">
<title>openfabriq: create the GitHub App</title>
<form method="post" action="${escapeHtml(action)}">
<input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
<p>Sending the app's manifest to GitHub…</p>
<button type="submit">Continue on GitHub</button>
</form>
<script>document.forms[0].submit()</script>`;
}

export interface GitHubConnectDeps extends ConnectDeps {
	exec?: typeof exec;
	/** How long GitHub's answer is waited for; GitHub's code lasts an hour. */
	timeoutMs?: number;
}

export async function connectGithub(
	deps: GitHubConnectDeps,
	options: {
		org?: string;
		workflows?: boolean;
		/** The studio's https address, for sign-in with GitHub. */
		url?: string;
		/** "token owner/repo": prints an installation token, for a script such as Docker's entrypoint; "env": the server's variables. */
		action?: string;
		repository?: string;
	} = {},
): Promise<CommandResult> {
	if (options.action === "token") return printToken(options.repository);
	if (options.action === "env") return printEnv();
	const studioUrl =
		options.url && URL.canParse(options.url) ? new URL(options.url) : undefined;
	if (
		options.action !== undefined ||
		(options.url !== undefined &&
			(studioUrl?.protocol !== "https:" || studioUrl.pathname !== "/"))
	)
		return {
			code: 1,
			output:
				"Usage: openfabriq connect github [--org name] [--workflows] [--url https://studio.example.com] | connect github token owner/repo | connect github env",
		};
	const state = randomBytes(16).toString("hex");
	let answer: ((code: string, res: ServerResponse) => void) | undefined;
	const callback = new Promise<{ code: string; res: ServerResponse }>(
		(resolve) => {
			answer = (code, res) => resolve({ code, res });
		},
	);
	let page = "";
	const server = createServer((req, res) => {
		// Each answer closes its connection: the browser keeps none open, and the command can end.
		res.setHeader("Connection", "close");
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		const code = url.searchParams.get("code");
		// Only this address: a web page that renamed its domain to 127.0.0.1 never reads the state.
		if (req.headers.host !== new URL(origin).host) res.writeHead(421).end();
		else if (url.pathname === "/" && req.method === "GET") {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(page);
		} else if (
			url.pathname === "/callback" &&
			code &&
			url.searchParams.get("state") === state
		)
			answer?.(code, res);
		else res.writeHead(404).end();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	page = manifestPage(
		newAppUrl(state, options.org),
		githubAppManifest({
			redirectUrl: `${origin}/callback`,
			...(options.org ? { org: options.org } : {}),
			...(options.workflows ? { workflows: true } : {}),
			...(studioUrl ? { studioUrl: studioUrl.origin } : {}),
		}),
	);
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		deps.print(
			[
				`The engine as your own GitHub App, ${options.org ? `owned by ${options.org}` : "owned by your account"}: a token per repository, renewed by the engine, no person's login and no bot account.`,
				`Opening ${origin}/ : it sends the app's manifest to GitHub. Check the name, then "Create GitHub App". Waiting up to 10 minutes...`,
			].join("\n"),
		);
		await (deps.exec ?? exec)(
			process.platform === "darwin" ? "open" : "xdg-open",
			[`${origin}/`],
		).catch(() => undefined);
		const timeout = new Promise<undefined>((resolve) => {
			timer = setTimeout(
				() => resolve(undefined),
				deps.timeoutMs ?? 10 * 60_000,
			);
		});
		const back = await Promise.race([callback, timeout]);
		if (!back)
			return {
				code: 1,
				output:
					'GitHub did not come back within 10 minutes. Nothing was saved: run "openfabriq connect github" again.',
			};
		let app: {
			id: number;
			slug: string;
			pem: string;
			client_id?: string;
			client_secret?: string;
		};
		try {
			// The code is the credential here: the conversion needs no token.
			const response = await (deps.fetch ?? fetch)(
				`https://api.github.com/app-manifests/${encodeURIComponent(back.code)}/conversions`,
				{ method: "POST", headers: { Accept: "application/vnd.github+json" } },
			);
			app = (await response.json()) as typeof app;
			if (!response.ok || !app.id || !app.pem)
				throw new Error(`GitHub answered ${response.status}`);
		} catch (error) {
			back.res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
			back.res.end("The app was not saved: see the terminal.");
			return {
				code: 1,
				output: `GitHub did not give the app's key (${errorText(error)}). Nothing was saved: delete the app in GitHub's settings if it was created, then run "openfabriq connect github" again.`,
			};
		}
		// GitHub gives the key once: when it cannot be saved, the command still prints it.
		let notSaved: string | undefined;
		try {
			writeSecrets("github", {
				app_id: String(app.id),
				slug: app.slug,
				private_key: app.pem,
				// Kept for "deploy coolify", which gives the studio sign-in with GitHub.
				...(studioUrl && app.client_id && app.client_secret
					? {
							client_id: app.client_id,
							client_secret: app.client_secret,
							studio_url: studioUrl.origin,
						}
					: {}),
			});
		} catch (error) {
			notSaved = errorText(error);
		}
		const install = `https://github.com/apps/${app.slug}/installations/new`;
		// The same tab goes on to the install page.
		back.res.writeHead(302, { Location: install }).end();
		return {
			code: notSaved ? 1 : 0,
			output: [
				notSaved
					? `GitHub App ${app.slug} created (id ${app.id}), but its private key could not be saved in ${secretsPath()} (${notSaved}). Keep the two variables below: GitHub shows the key only once.`
					: `GitHub App ${app.slug} created (id ${app.id}); its private key is saved in ${secretsPath()}.`,
				`Now, in the page that opened (${install}), install it on the repositories the factory runs on.`,
				RESTART_START,
				"",
				...(notSaved
					? serverVariables({
							app_id: String(app.id),
							private_key: app.pem,
							...(studioUrl && app.client_id && app.client_secret
								? {
										client_id: app.client_id,
										client_secret: app.client_secret,
										studio_url: studioUrl.origin,
									}
								: {}),
						})
					: [
							`For a server: "openfabriq deploy coolify" takes the app from this machine. For Docker, "openfabriq connect github env >> .env" writes its variables (GITHUB_APP_ID=${app.id}, its key${studioUrl && app.client_id ? " and its client for sign-in with GitHub" : ""}) without showing them.`,
						]),
			].join("\n"),
		};
	} finally {
		clearTimeout(timer);
		server.close();
	}
}

/** The variables of a server's .env for the app: its id and key, and its client when there is one. */
function serverVariables(app: {
	app_id: string;
	private_key: string;
	client_id?: string;
	client_secret?: string;
	studio_url?: string;
}): string[] {
	return [
		"# The engine as the GitHub App; the key is the app's, keep it as secret as a password.",
		`GITHUB_APP_ID=${app.app_id}`,
		`GITHUB_APP_PRIVATE_KEY=${Buffer.from(app.private_key).toString("base64")}`,
		...(app.client_id && app.client_secret
			? [
					`# Sign-in with GitHub on ${app.studio_url ?? "the studio"}, with OPENFABRIQ_STUDIO_URL set to it.`,
					`GITHUB_APP_CLIENT_ID=${app.client_id}`,
					`GITHUB_APP_CLIENT_SECRET=${app.client_secret}`,
				]
			: []),
	];
}

/** The saved app's variables for a server's .env, alone: `openfabriq connect github env >> .env`. */
function printEnv(): CommandResult {
	const app = readSecrets().github;
	if (!app?.app_id || !app.private_key)
		return {
			code: 1,
			output:
				'No GitHub App on this machine: run "openfabriq connect github" first.',
		};
	return {
		code: 0,
		output: serverVariables({
			app_id: app.app_id,
			private_key: app.private_key,
			...(app.client_id ? { client_id: app.client_id } : {}),
			...(app.client_secret ? { client_secret: app.client_secret } : {}),
			...(app.studio_url ? { studio_url: app.studio_url } : {}),
		}).join("\n"),
	};
}

/** An installation token for one repository, printed alone: `GH_TOKEN=$(openfabriq connect github token owner/repo)`. */
async function printToken(
	repository: string | undefined,
): Promise<CommandResult> {
	if (!repository || !/^[^/\s]+\/[^/\s]+$/.test(repository))
		return {
			code: 1,
			output: "Usage: openfabriq connect github token owner/repo",
		};
	const app = githubApp();
	if (!app)
		return {
			code: 1,
			output:
				'No GitHub App: set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY, or run "openfabriq connect github".',
		};
	try {
		return { code: 0, output: await app.token(repository) };
	} catch (error) {
		return { code: 1, output: errorText(error) };
	}
}
