import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	connectGithub,
	githubAppManifest,
	manifestPage,
	newAppUrl,
} from "../../../src/commands/connect/github.js";
import { home, saved } from "./helpers.js";

describe("githubAppManifest", () => {
	it("asks for a private app without webhook, with only the permissions the engine uses", () => {
		const manifest = githubAppManifest({
			redirectUrl: "http://127.0.0.1:5000/callback",
			org: "acme",
		});
		expect(manifest).toMatchObject({
			name: "acme-factory",
			public: false,
			redirect_url: "http://127.0.0.1:5000/callback",
			hook_attributes: { active: false },
			default_events: [],
			default_permissions: {
				metadata: "read",
				contents: "write",
				issues: "write",
				pull_requests: "write",
				checks: "read",
				statuses: "read",
				actions: "read",
			},
		});
		expect(manifest.default_permissions).not.toHaveProperty("workflows");
		expect(
			githubAppManifest({ redirectUrl: "x", workflows: true })
				.default_permissions,
		).toHaveProperty("workflows", "write");
		expect(manifest).not.toHaveProperty("callback_urls");
	});

	it("sends who signs in with GitHub back to the studio's address, when given", () => {
		expect(
			githubAppManifest({
				redirectUrl: "x",
				studioUrl: "https://factory.example.com",
			}).callback_urls,
		).toEqual(["https://factory.example.com/auth/github/callback"]);
	});

	it("posts to the account's new app page, or the organization's", () => {
		expect(newAppUrl("s1")).toBe(
			"https://github.com/settings/apps/new?state=s1",
		);
		expect(newAppUrl("s1", "acme")).toBe(
			"https://github.com/organizations/acme/settings/apps/new?state=s1",
		);
	});

	it("escapes the manifest in the form's field", () => {
		const page = manifestPage("https://github.com/settings/apps/new?state=s", {
			description: `a "quoted" <b>`,
		});
		expect(page).toContain(
			'value="{&quot;description&quot;:&quot;a \\&quot;quoted\\&quot; &lt;b&gt;&quot;}"',
		);
	});
});

describe("connectGithub", () => {
	it("serves the manifest, exchanges GitHub's code, saves the key, then sends the browser to the install page", async () => {
		let opened = "";
		const printed: string[] = [];
		const done = connectGithub(
			{
				ask: async () => "",
				print: (text) => printed.push(text),
				exec: async (_command, args) => {
					opened = args[0] ?? "";
					return "";
				},
				fetch: (async (url: string, init?: RequestInit) => {
					expect(url).toBe(
						"https://api.github.com/app-manifests/the-code/conversions",
					);
					expect(init?.method).toBe("POST");
					return new Response(
						JSON.stringify({
							id: 42,
							slug: "openfabriq-acme",
							pem: "PEM",
							client_id: "Iv1.client",
							client_secret: "client-secret",
						}),
						{ status: 201 },
					);
				}) as typeof fetch,
			},
			{ org: "acme", url: "https://factory.example.com/" },
		);
		while (!opened) await new Promise((r) => setTimeout(r, 5));
		const page = await (await fetch(opened)).text();
		const state = /state=([0-9a-f]+)/.exec(page)?.[1];
		expect(page).toContain("organizations/acme/settings/apps/new");
		expect(page).toContain("https://factory.example.com/auth/github/callback");
		// A wrong state is not GitHub's answer.
		expect((await fetch(`${opened}callback?code=x&state=wrong`)).status).toBe(
			404,
		);
		// Another name for 127.0.0.1 is another site: refused.
		const { request } = await import("node:http");
		const rebound = await new Promise<number>((resolve) =>
			request(opened, { headers: { Host: "evil.example:80" } }, (res) =>
				resolve(res.statusCode ?? 0),
			).end(),
		);
		expect(rebound).toBe(421);
		const back = await fetch(`${opened}callback?code=the-code&state=${state}`, {
			redirect: "manual",
		});
		expect(back.status).toBe(302);
		expect(back.headers.get("location")).toBe(
			"https://github.com/apps/openfabriq-acme/installations/new",
		);
		const result = await done;
		expect(result.code).toBe(0);
		expect(saved().github).toEqual({
			app_id: "42",
			slug: "openfabriq-acme",
			private_key: "PEM",
			client_id: "Iv1.client",
			client_secret: "client-secret",
			studio_url: "https://factory.example.com",
		});
		expect(statSync(join(home, "secrets.json")).mode & 0o777).toBe(0o600);
		expect(result.output).toContain("GITHUB_APP_ID=42");
		expect(result.output).toContain(
			`GITHUB_APP_PRIVATE_KEY=${Buffer.from("PEM").toString("base64")}`,
		);
		expect(result.output).toContain("GITHUB_APP_CLIENT_ID=Iv1.client");
		expect(result.output).toContain("GITHUB_APP_CLIENT_SECRET=client-secret");
		// The key is in the command's result, never in what it prints along the way.
		expect(printed.join("\n")).not.toContain("PEM");
	});

	it("still gives the key when it cannot save it: GitHub shows it only once", async () => {
		writeFileSync(join(home, "secrets.json"), "{ not json");
		let opened = "";
		const done = connectGithub({
			ask: async () => "",
			print: () => {},
			exec: async (_command, args) => {
				opened = args[0] ?? "";
				return "";
			},
			fetch: (async () =>
				new Response(
					JSON.stringify({ id: 42, slug: "openfabriq-acme", pem: "PEM" }),
					{ status: 201 },
				)) as typeof fetch,
		});
		while (!opened) await new Promise((r) => setTimeout(r, 5));
		const state = /state=([0-9a-f]+)/.exec(
			await (await fetch(opened)).text(),
		)?.[1];
		const back = await fetch(`${opened}callback?code=c&state=${state}`, {
			redirect: "manual",
		});
		expect(back.status).toBe(302);
		const result = await done;
		expect(result.code).toBe(1);
		expect(result.output).toMatch(/could not be saved/);
		expect(result.output).toContain(
			`GITHUB_APP_PRIVATE_KEY=${Buffer.from("PEM").toString("base64")}`,
		);
	});

	it("saves nothing when GitHub does not come back", async () => {
		const result = await connectGithub({
			ask: async () => "",
			print: () => {},
			exec: async () => "",
			timeoutMs: 10,
		});
		expect(result.code).toBe(1);
		expect(() => saved()).toThrow();
	});

	it("prints a repository's token only in app mode", async () => {
		expect(
			await connectGithub(
				{ ask: async () => "", print: () => {} },
				{ action: "token", repository: "not a repo" },
			),
		).toMatchObject({ code: 1 });
	});
});

it("refuses a studio address that is not https", async () => {
	const result = await connectGithub(
		{ ask: async () => "", print: () => undefined },
		{ url: "http://factory.example.com" },
	);
	expect(result.code).toBe(1);
	expect(result.output).toMatch(/^Usage/);
});
