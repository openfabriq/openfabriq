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
const withApp = () =>
	writeFileSync(
		join(home, "secrets.json"),
		JSON.stringify({
			github: { app_id: "42", slug: "acme-factory", private_key: PEM },
		}),
	);

/** A fake Coolify: what each call asked, and its answers. */
function coolifyDeps(options: {
	answers: string[];
	versionStatus?: number;
	deployment?: string[];
	logs?: string;
}) {
	const calls: {
		method: string;
		path: string;
		body?: unknown;
		auth: string;
	}[] = [];
	const statuses = [...(options.deployment ?? ["in_progress", "finished"])];
	const answer = (status: number, body: unknown) =>
		({
			ok: status < 300,
			status,
			json: async () => body,
			text: async () => JSON.stringify(body),
		}) as Response;
	const deps: DeployDeps = {
		env: {},
		ask: async () => options.answers.shift() ?? "",
		print: (text) => printed.push(text),
		confirm: async () => true,
		repository: async () => "acme/web-app",
		sleep: async () => {},
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
				return answer(200, [{ uuid: "s1", name: "main" }]);
			if (path === "/projects")
				return answer(200, [
					{ uuid: "p1", name: "infra" },
					{ uuid: "p2", name: "apps" },
				]);
			if (path === "/projects/p1" || path === "/projects/p2")
				return answer(200, {
					environments: [{ uuid: "e1", name: "production" }],
				});
			if (path === "/applications/public") return answer(201, { uuid: "app1" });
			if (path === "/applications/app1/envs/bulk") return answer(201, []);
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
	const unknown = coolifyDeps({
		answers: [COOLIFY, "ctok"],
		versionStatus: 401,
	});
	expect(await deployCommand("coolify", unknown.deps)).toMatchObject({
		code: 1,
		output: expect.stringContaining(
			"does not know the token: check it was copied whole",
		),
	});
	expect(unknown.calls.map((c) => c.path)).toEqual(["/version"]);
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
		// address, token, Claude, repositories (Enter keeps the current one), project 2, name
		answers: [
			`${COOLIFY}/`,
			"ctok",
			"sk-ant-oat01-secret",
			"acme/web-app",
			"2",
			"factory",
		],
		logs: "✓ GitHub: the engine works as the app acme-factory[bot], installed on acme/web-app\n✓ acme/web-app: factory applied",
	});
	const result = await deployCommand("coolify", deps);
	expect(result.code).toBe(0);
	expect(result.output).toContain(
		"The engine is deployed on main: application factory in apps › production.",
	);
	expect(result.output).toContain("✓ acme/web-app: factory applied");
	expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
		"GET /version",
		"GET /servers",
		"GET /projects",
		"GET /projects/p2",
		"POST /applications/public",
		"PATCH /applications/app1/envs/bulk",
		"POST /deploy?uuid=app1",
		"GET /deployments/d1",
		"GET /deployments/d1",
		"GET /applications/app1/logs?lines=200",
	]);
	expect(calls.every((c) => c.auth === "Bearer ctok")).toBe(true);
	expect(calls[4]?.body).toMatchObject({
		project_uuid: "p2",
		server_uuid: "s1",
		environment_uuid: "e1",
		git_repository: "https://github.com/openfabriq/openfabriq",
		git_branch: "main",
		build_pack: "dockercompose",
		docker_compose_location: "/docker-compose.yml",
		name: "factory",
		instant_deploy: false,
	});
	const bulk = calls[5]?.body as { data: { key: string }[] } | undefined;
	const keys = bulk?.data.map((v) => v.key);
	expect(keys).toEqual([
		"OPENFABRIQ_REPOSITORIES",
		"GITHUB_APP_ID",
		"GITHUB_APP_PRIVATE_KEY",
		"CLAUDE_CODE_OAUTH_TOKEN",
	]);
	// No secret reaches the screen.
	const screen = [...printed, result.output].join("\n");
	for (const secret of ["ctok", "sk-ant-oat01-secret", "MIIEsecretkeybody"])
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
