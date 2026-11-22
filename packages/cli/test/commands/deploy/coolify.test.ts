import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
	claudeCredential,
	type DeployDeps,
	deployCommand,
	engineVariables,
	githubRepository,
	logFindings,
	scrub,
} from "../../../src/commands/deploy/coolify.js";
import { home, printed } from "../connect/helpers.js";

const COOLIFY = "https://coolify.acme.dev";
const PEM =
	"-----BEGIN RSA PRIVATE KEY-----\nMIIEsecretkeybody\n-----END RSA PRIVATE KEY-----\n";
const withApp = (client: Record<string, string> = {}) =>
	writeFileSync(
		join(home, "secrets.json"),
		JSON.stringify({
			github: {
				app_id: "42",
				slug: "acme-factory",
				private_key: PEM,
				...client,
			},
		}),
	);

/** A fake Coolify: what each call asked, and its answers. */
function coolifyDeps(options: {
	answers: string[];
	versionStatus?: number;
	deployment?: string[];
	logs?: string;
	servers?: { uuid: string; name: string; ip?: string; description?: string }[];
	applications?: { name: string; git_repository: string }[];
	envsStatus?: number;
	addresses?: Record<string, string>;
}) {
	const calls: {
		method: string;
		path: string;
		body?: unknown;
		auth: string;
	}[] = [];
	const statuses = [...(options.deployment ?? ["in_progress", "finished"])];
	// As Coolify answers: JSON, except a string, sent as plain text (GET /version answers 4.7.5).
	const answer = (status: number, body: unknown) => {
		const text = typeof body === "string" ? body : JSON.stringify(body);
		return {
			ok: status < 300,
			status,
			json: async () => JSON.parse(text),
			text: async () => text,
		} as Response;
	};
	const deps: DeployDeps = {
		env: {},
		ask: async () => options.answers.shift() ?? "",
		print: (text) => printed.push(text),
		confirm: async () => true,
		repository: async () => "acme/web-app",
		sleep: async () => {},
		version: "1.2.3",
		// Every host at the same address, unless the test says otherwise.
		lookup: async (host) => options.addresses?.[host] ?? "203.0.113.10",
		fetch: (async (url: string, init: RequestInit) => {
			const path = url.replace(`${COOLIFY}/api/v1`, "");
			const method = init.method ?? "GET";
			calls.push({
				method,
				path,
				auth: (init.headers as Record<string, string>).Authorization ?? "",
				...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
			});
			if (path === "/version")
				return answer(options.versionStatus ?? 200, "4.7.5");
			if (path === "/servers")
				return answer(200, options.servers ?? [{ uuid: "s1", name: "main" }]);
			if (path === "/projects")
				return answer(200, [
					{ uuid: "p1", name: "infra" },
					{ uuid: "p2", name: "apps" },
				]);
			if (path === "/projects/p1" || path === "/projects/p2")
				return answer(200, {
					environments: [{ uuid: "e1", name: "production" }],
				});
			if (path === "/applications")
				return answer(200, options.applications ?? []);
			if (path === "/applications/public") return answer(201, { uuid: "app1" });
			if (path === "/applications/app1/envs/bulk")
				return answer(options.envsStatus ?? 201, { message: "refused" });
			if (path === "/deploy?uuid=app1")
				return answer(200, { deployments: [{ deployment_uuid: "d1" }] });
			if (path === "/deployments/d1")
				return answer(200, { status: statuses.shift() ?? "finished" });
			if (path.startsWith("/applications/app1/logs"))
				return answer(200, { logs: options.logs ?? "" });
			return answer(404, { message: "not found" });
		}) as typeof fetch,
	};
	return { deps, calls };
}

it("reads owner/name from a GitHub remote, https or ssh", () => {
	expect(githubRepository("https://github.com/acme/web-app.git\n")).toBe(
		"acme/web-app",
	);
	expect(githubRepository("git@github.com:acme/web.app.git")).toBe(
		"acme/web.app",
	);
	expect(
		githubRepository("https://gitlab.com/acme/web-app.git"),
	).toBeUndefined();
});

it("tells a subscription token from an API key", () => {
	expect(claudeCredential("sk-ant-oat01-x").name).toBe(
		"CLAUDE_CODE_OAUTH_TOKEN",
	);
	expect(claudeCredential("sk-ant-api03-x").name).toBe("ANTHROPIC_API_KEY");
});

it("gives the compose file its variables, the key on one line and the secrets locked", () => {
	const variables = engineVariables({
		repositories: ["acme/web-app", "acme/api"],
		github: { app_id: "42", private_key: PEM },
		claude: claudeCredential("sk-ant-oat01-x"),
	});
	expect(variables.map((v) => [v.key, "is_shown_once" in v])).toEqual([
		["OPENFABRIQ_REPOSITORIES", false],
		["GITHUB_APP_ID", false],
		["GITHUB_APP_PRIVATE_KEY", true],
		["CLAUDE_CODE_OAUTH_TOKEN", true],
	]);
	expect(variables[0]?.value).toBe("acme/web-app,acme/api");
	expect(Buffer.from(variables[2]?.value ?? "", "base64").toString()).toBe(PEM);
	expect(variables[2]?.value).not.toContain("\n");
});

it("keeps doctor's findings and each factory's state from the engine's logs", () => {
	expect(
		logFindings(
			"starting\n✓ GitHub: the engine works as the app acme[bot]\n  ✗ composer is missing\nacme/api was not applied\nWatching",
		),
	).toEqual([
		"✓ GitHub: the engine works as the app acme[bot]",
		"✗ composer is missing",
		"acme/api was not applied",
	]);
	expect(
		scrub("token sk-ant-oat01-secret in a message", ["sk-ant-oat01-secret"]),
	).toBe("token •••• in a message");
});

it("needs the GitHub App of connect github, and calls Coolify only after that", async () => {
	const { deps, calls } = coolifyDeps({ answers: [] });
	expect(await deployCommand("coolify", deps)).toMatchObject({
		code: 1,
		output: expect.stringContaining('run "openfabriq connect github" first'),
	});
	expect(calls).toEqual([]);
});

it("says how to fix an unknown or a refused token, and creates nothing", async () => {
	withApp();
	// Asked three times, then the command stops.
	const unknown = coolifyDeps({
		answers: [COOLIFY, "ctok", "ctok2", "ctok3"],
		versionStatus: 401,
	});
	expect(await deployCommand("coolify", unknown.deps)).toEqual({
		code: 1,
		output: "Coolify did not accept a token. Nothing was created.",
	});
	expect(printed).toContain(
		"✗ Coolify at https://coolify.acme.dev does not know the token: check it was copied whole, or make a new one in Keys & Tokens.",
	);
	expect(unknown.calls.map((c) => c.path)).toEqual([
		"/version",
		"/version",
		"/version",
	]);
	const refused = coolifyDeps({ answers: [], versionStatus: 403 });
	refused.deps.env = { COOLIFY_URL: COOLIFY, COOLIFY_TOKEN: "ctok" };
	expect(await deployCommand("coolify", refused.deps)).toMatchObject({
		code: 1,
		output: expect.stringContaining(
			"refused the token (the token of $COOLIFY_TOKEN): turn on Settings › Advanced › API Access",
		),
	});
});

it("creates the application, sets its variables, deploys, and reports the engine's checks", async () => {
	withApp();
	const { deps, calls } = coolifyDeps({
		// Each wrong answer is asked again: the address, the project's number, the studio's
		// address, a short password, and a confirmation that differs.
		answers: [
			"coolify.acme.dev",
			`${COOLIFY}/`,
			"ctok",
			"sk-ant-oat01-secret",
			"acme/web-app",
			"9",
			"2",
			"factory",
			"http://factory.acme.dev",
			"https://factory.acme.dev/studio",
			"https://factory.acme.dev/",
			"2",
			"short",
			"a-studio-password-long-enough",
			"another-password-long-enough",
			"a-studio-password-long-enough",
			"a-studio-password-long-enough",
		],
		logs: "✓ GitHub: the engine works as the app acme-factory[bot], installed on acme/web-app\n✓ acme/web-app: factory applied",
	});
	const result = await deployCommand("coolify", deps);
	expect(result.code).toBe(0);
	expect(result.output).toContain(
		"The engine is deployed on main: application factory in apps › production.",
	);
	expect(result.output).toContain("✓ acme/web-app: factory applied");
	expect(printed.filter((line) => line.startsWith("✗"))).toEqual([
		"✗ Coolify's address is https://, such as https://coolify.example.com.",
		"✗ Answer a number from 1 to 2.",
		"✗ The studio's address is https:// and a domain, with no path, such as https://factory.example.com, or Enter for none.",
		"✗ The studio's address is https:// and a domain, with no path, such as https://factory.example.com, or Enter for none.",
		"✗ The password needs 16 characters or more, for example from openssl rand -base64 24.",
		"✗ The two passwords differ: type it again.",
	]);
	expect(result.output).toContain(
		"Studio: https://factory.acme.dev. The password you typed opens it. Claude Desktop, claude.ai and Claude Code read the engine at https://factory.acme.dev/mcp.",
	);
	expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
		"GET /version",
		"GET /servers",
		"GET /projects",
		"GET /projects/p2",
		"GET /applications",
		"POST /applications/public",
		"PATCH /applications/app1/envs/bulk",
		"POST /deploy?uuid=app1",
		"GET /deployments/d1",
		"GET /deployments/d1",
		"GET /applications/app1/logs?lines=200",
	]);
	expect(calls.every((c) => c.auth === "Bearer ctok")).toBe(true);
	expect(calls[5]?.body).toMatchObject({
		project_uuid: "p2",
		server_uuid: "s1",
		environment_uuid: "e1",
		git_repository: "https://github.com/openfabriq/openfabriq",
		git_branch: "v1.2.3",
		build_pack: "dockercompose",
		docker_compose_location: "/docker-compose.yml",
		name: "factory",
		instant_deploy: false,
		docker_compose_domains: [
			{ name: "engine", domain: "https://factory.acme.dev:4311" },
		],
	});
	const bulk = calls[6]?.body as { data: { key: string }[] } | undefined;
	const keys = bulk?.data.map((v) => v.key);
	expect(keys).toEqual([
		"OPENFABRIQ_REPOSITORIES",
		"GITHUB_APP_ID",
		"GITHUB_APP_PRIVATE_KEY",
		"CLAUDE_CODE_OAUTH_TOKEN",
		"OPENFABRIQ_STUDIO_URL",
		"OPENFABRIQ_STUDIO_PASSWORD",
	]);
	// No secret reaches the screen.
	const screen = [...printed, result.output].join("\n");
	for (const secret of [
		"ctok",
		"sk-ant-oat01-secret",
		"MIIEsecretkeybody",
		"a-studio-password-long-enough",
	])
		expect(screen).not.toContain(secret);
});

it("stops at a failed deployment and keeps the application to fix in Coolify", async () => {
	withApp();
	const { deps } = coolifyDeps({
		answers: [COOLIFY, "ctok", "sk-ant-api03-k", "acme/web-app", "1", ""],
		deployment: ["in_progress", "failed"],
	});
	expect(await deployCommand("coolify", deps)).toMatchObject({
		code: 1,
		output: expect.stringContaining('ended as "failed"'),
	});
});

it("creates nothing when the person says no", async () => {
	withApp();
	const { deps, calls } = coolifyDeps({
		answers: [COOLIFY, "ctok", "sk-ant-api03-k", "acme/web-app", "1", ""],
	});
	deps.confirm = async () => false;
	expect(await deployCommand("coolify", deps)).toEqual({
		code: 1,
		output: "Nothing was created.",
	});
	expect(calls.some((c) => c.method !== "GET")).toBe(false);
});

it("stops before creating anything when the studio's password is never confirmed", async () => {
	withApp();
	const { deps, calls } = coolifyDeps({
		answers: [
			COOLIFY,
			"ctok",
			"sk-ant-api03-k",
			"acme/web-app",
			"1",
			"",
			"https://factory.acme.dev",
			"2",
			...Array.from({ length: 3 }, (_, i) => [
				"a-studio-password-long-enough",
				`not-the-same-password-${i}`,
			]).flat(),
		],
	});
	expect(await deployCommand("coolify", deps)).toEqual({
		code: 1,
		output: "No password for the studio. Nothing was created.",
	});
	expect(calls.some((c) => c.method !== "GET")).toBe(false);
});

/** The variables a run gave Coolify, by name. */
const variables = (calls: { path: string; body?: unknown }[]) => {
	const bulk = calls.find((c) => c.path.endsWith("/envs/bulk"))?.body as
		| { data: { key: string; value: string }[] }
		| undefined;
	return Object.fromEntries((bulk?.data ?? []).map((v) => [v.key, v.value]));
};
const BEFORE_STUDIO = [
	COOLIFY,
	"ctok",
	"sk-ant-api03-k",
	"acme/web-app",
	"1",
	"",
];

it("gives the studio sign-in with GitHub from the client connect github saved, without a password", async () => {
	withApp({
		client_id: "Iv1.client",
		client_secret: "client-secret-value",
		studio_url: "https://factory.acme.dev",
	});
	const { deps, calls } = coolifyDeps({
		answers: [...BEFORE_STUDIO, "https://factory.acme.dev", "1"],
	});
	const result = await deployCommand("coolify", deps);
	expect(result.code).toBe(0);
	expect(result.output).toContain(
		"Studio: https://factory.acme.dev. Whoever can write to the repositories signs in with their GitHub account. Claude Desktop",
	);
	expect(variables(calls)).toMatchObject({
		OPENFABRIQ_STUDIO_URL: "https://factory.acme.dev",
		GITHUB_APP_CLIENT_ID: "Iv1.client",
		GITHUB_APP_CLIENT_SECRET: "client-secret-value",
	});
	expect(variables(calls)).not.toHaveProperty("OPENFABRIQ_STUDIO_PASSWORD");
	expect([...printed, result.output].join("\n")).not.toContain(
		"client-secret-value",
	);
});

it("says where to set the callback when the saved client comes back to another address", async () => {
	withApp({
		client_id: "Iv1.client",
		client_secret: "client-secret-value",
		studio_url: "https://old.acme.dev",
	});
	const { deps } = coolifyDeps({
		answers: [...BEFORE_STUDIO, "https://factory.acme.dev", "1"],
	});
	await deployCommand("coolify", deps);
	expect(printed.join("\n")).toContain(
		"The app comes back to https://old.acme.dev: in its settings, https://github.com/settings/apps/acme-factory",
	);
	expect(printed.join("\n")).toContain(
		"add the Redirect URI https://factory.acme.dev/auth/github/callback, then Save changes.",
	);
});

it("asks for the app's client, then the password, for both ways of signing in", async () => {
	withApp();
	const { deps, calls } = coolifyDeps({
		answers: [
			...BEFORE_STUDIO,
			"https://factory.acme.dev",
			"3",
			"Iv1.typed",
			"typed-client-secret",
			"a-studio-password-long-enough",
			"a-studio-password-long-enough",
		],
	});
	const result = await deployCommand("coolify", deps);
	expect(result.code).toBe(0);
	expect(printed.join("\n")).toContain(
		"add the Redirect URI https://factory.acme.dev/auth/github/callback, Save changes, then Generate a new client secret.",
	);
	expect(variables(calls)).toMatchObject({
		GITHUB_APP_CLIENT_ID: "Iv1.typed",
		GITHUB_APP_CLIENT_SECRET: "typed-client-secret",
		OPENFABRIQ_STUDIO_PASSWORD: "a-studio-password-long-enough",
	});
	expect(result.output).toContain(
		"Whoever can write to the repositories signs in with their GitHub account. The password you typed opens it too.",
	);
	const screen = [...printed, result.output].join("\n");
	for (const secret of ["typed-client-secret", "a-studio-password-long-enough"])
		expect(screen).not.toContain(secret);
});

it("warns when the studio's domain points at another server than the one picked", async () => {
	withApp();
	const answers = [
		...BEFORE_STUDIO.slice(0, 4),
		"2", // the server: edge
		"1", // the project
		"", // the name
		"https://factory.acme.dev",
		"2",
		"a-studio-password-long-enough",
		"a-studio-password-long-enough",
	];
	const setup = {
		servers: [
			{
				uuid: "s1",
				name: "main",
				ip: "host.docker.internal",
				description: "where Coolify runs",
			},
			{ uuid: "s2", name: "edge", ip: "100.78.30.108" },
		],
		addresses: {
			"factory.acme.dev": "149.202.58.224",
			"coolify.acme.dev": "149.202.58.224",
			"100.78.30.108": "100.78.30.108",
		},
	};
	const refused = coolifyDeps({ answers: [...answers], ...setup });
	refused.deps.confirm = async (question) => !question.includes("anyway");
	expect(await deployCommand("coolify", refused.deps)).toEqual({
		code: 1,
		output: "Nothing was created.",
	});
	expect(printed.join("\n")).toContain("  1. main: where Coolify runs");
	expect(printed).toContain(
		"✗ factory.acme.dev points at 149.202.58.224, but edge is at 100.78.30.108: the studio would answer nothing there. Pick the server factory.acme.dev points at, or point the domain at 100.78.30.108.",
	);
	expect(refused.calls.some((c) => c.method !== "GET")).toBe(false);
	// Coolify's own host is where Coolify answers: no warning there.
	printed.length = 0;
	const main = coolifyDeps({
		answers: answers.map((a, i) => (i === 4 ? "1" : a)),
		...setup,
	});
	expect((await deployCommand("coolify", main.deps)).code).toBe(0);
	expect(printed.join("\n")).not.toContain("points at");
});

it("asks before a second engine on Coolify, and creates nothing on a no", async () => {
	withApp();
	const { deps, calls } = coolifyDeps({
		answers: [...BEFORE_STUDIO],
		applications: [
			{ name: "factory", git_repository: "openfabriq/openfabriq" },
		],
	});
	deps.confirm = async (question) => !question.includes("another engine");
	expect(await deployCommand("coolify", deps)).toEqual({
		code: 1,
		output: "Nothing was created.",
	});
	expect(printed).toContain(
		"✗ Coolify runs the engine already: factory. Two engines on the same repositories would run every automation twice. Change or delete it in Coolify instead.",
	);
	expect(calls.some((c) => c.method !== "GET")).toBe(false);
});

it("names the application it created when a later step fails", async () => {
	withApp();
	const { deps } = coolifyDeps({
		answers: [...BEFORE_STUDIO],
		envsStatus: 422,
	});
	const result = await deployCommand("coolify", deps);
	expect(result.code).toBe(1);
	expect(result.output).toContain(
		"The application openfabriq (app1) was created: fix it in Coolify, or delete it there before running this command again.",
	);
});
