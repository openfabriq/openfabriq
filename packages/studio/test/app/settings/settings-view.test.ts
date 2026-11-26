import { describe, expect, it } from "vitest";
import {
	missing,
	type Row,
	settingsSections,
} from "../../../app/src/features/settings/settings-view.js";
import type { FactorySettings } from "../../../app/src/lib/types.js";

const bare: FactorySettings = {
	name: "Shop factory",
	repository: "acme/shop",
	maintainers: ["ada"],
	model: "sonnet",
	yaml: "name: Shop factory\n",
	limits: {
		usd_per_run: 5,
		usd_per_day: 30,
		minutes_per_run: 45,
		review_rounds: 1,
	},
	ready: {
		secrets: {},
		relayNeeded: false,
		relay: false,
		slack: false,
		linear: false,
		sentry: false,
	},
};

const row = (s: FactorySettings, label: string): Row | undefined =>
	settingsSections(s)
		.flatMap((section) => section.rows)
		.find((r) => r.label === label);

it("says each limit in words, with its key in factory.yaml", () => {
	expect(row(bare, "Cost per run")).toMatchObject({
		key: "limits.usd_per_run",
		value: "$5.00",
	});
	expect(row(bare, "Time per run")?.value).toBe("45 min");
	expect(row(bare, "Review rounds")?.value).toBe("1 round");
});

it("says what an absent setting means instead of showing a value", () => {
	expect(row(bare, "Checks")).toEqual({
		label: "Checks",
		key: "checks",
		note: "Code an agent changes is published without the engine testing it.",
	});
	expect(row(bare, "Slack")).not.toHaveProperty("value");
	expect(row(bare, "Time zone")).toMatchObject({
		value: "This machine's",
		note: "Not set: schedules follow this machine's clock.",
	});
	// The relay is shown only when the factory needs it, or it is connected.
	expect(row(bare, "Relay")).toBeUndefined();
	expect(missing(settingsSections(bare))).toEqual([]);
});

it("names what is missing on this machine and the command that sets it", () => {
	const s: FactorySettings = {
		...bare,
		commands: { test: "npm test" },
		checks: ["test"],
		secrets: ["STRIPE_KEY"],
		slack: { channel: "factory" },
		linear: { team: "ENG" },
		mcp: { docs: { url: "https://mcp.example.com", secret: "DOCS_TOKEN" } },
		ready: {
			...bare.ready,
			secrets: { STRIPE_KEY: false, DOCS_TOKEN: true },
			relayNeeded: true,
		},
	};
	expect(row(s, "Checks")?.items).toEqual([
		{ name: "test", detail: "npm test" },
	]);
	expect(row(s, "Secrets")?.items).toEqual([
		{
			name: "STRIPE_KEY",
			ready: false,
			fix: "openfabriq secret set STRIPE_KEY --project acme/shop",
		},
		{ name: "DOCS_TOKEN", detail: "for the MCP server docs", ready: true },
	]);
	expect(row(s, "Slack")).toMatchObject({
		value: "#factory",
		ready: false,
		fix: "openfabriq connect slack",
	});
	expect(row(s, "Linear")).toMatchObject({
		value: "Team ENG",
		ready: false,
		fix: "openfabriq connect linear",
	});
	expect(row(s, "Relay")).toMatchObject({
		value: "Not connected",
		fix: "openfabriq connect relay",
	});
	expect(missing(settingsSections(s))).toEqual([
		"STRIPE_KEY",
		"Slack",
		"Linear",
		"Relay",
	]);
});

it("says when a secret serves both the commands and an MCP server", () => {
	const s: FactorySettings = {
		...bare,
		secrets: ["DATABASE_URL"],
		mcp: { db: { command: "npx db-mcp", secrets: ["DATABASE_URL"] } },
		ready: { ...bare.ready, secrets: { DATABASE_URL: true } },
	};
	expect(row(s, "Secrets")?.items?.[0]?.detail).toBe(
		"also for the MCP server db",
	);
});

it("warns about a webhook that is not signed", () => {
	const s: FactorySettings = {
		...bare,
		webhooks: {
			deploy: { signature: "standard" },
			open: { signature: "none" },
		},
	};
	expect(row(s, "Webhooks")?.items).toEqual([
		{ name: "deploy", detail: "signed (standard)" },
		{
			name: "open",
			detail: "not signed",
			warning: "Anyone who has its address can start automations.",
		},
	]);
});

describe("the Slack, Linear and Sentry rows", () => {
	it("say the factory does not read a service it is not connected to", () => {
		expect(row(bare, "Slack")).toEqual({
			label: "Slack",
			key: "integrations.slack",
			note: "The factory does not read Slack.",
		});
		expect(row(bare, "Linear")).toEqual({
			label: "Linear",
			key: "integrations.linear",
			note: "The factory does not read Linear.",
		});
		expect(row(bare, "Sentry")).toEqual({
			label: "Sentry",
			key: "integrations.sentry",
			note: "The factory does not read Sentry.",
		});
	});

	const connected: FactorySettings = {
		...bare,
		slack: { channel: "factory" },
		linear: { team: "ENG" },
		sentry: { organization: "acme", project: "web" },
	};

	it("name the channel, the team and the project, with the command to connect them", () => {
		expect(row(connected, "Slack")).toEqual({
			label: "Slack",
			key: "integrations.slack",
			value: "#factory",
			mono: true,
			ready: false,
			fix: "openfabriq connect slack",
			note: "People in this channel can mention the factory, and it answers there.",
		});
		expect(row(connected, "Linear")).toEqual({
			label: "Linear",
			key: "integrations.linear",
			value: "Team ENG",
			ready: false,
			fix: "openfabriq connect linear",
			note: "Issues of this team can start automations.",
		});
		expect(row(connected, "Sentry")).toEqual({
			label: "Sentry",
			key: "integrations.sentry",
			value: "acme/web",
			mono: true,
			ready: false,
			fix: "openfabriq connect sentry",
			note: "New errors of this project can start automations.",
		});
	});

	it("give no command once connected, and name a self-hosted Sentry", () => {
		const ready: FactorySettings = {
			...connected,
			sentry: {
				organization: "acme",
				project: "web",
				url: "https://sentry.acme.dev",
			},
			ready: { ...bare.ready, slack: true, linear: true, sentry: true },
		};
		expect(row(ready, "Slack")).toEqual({
			label: "Slack",
			key: "integrations.slack",
			value: "#factory",
			mono: true,
			ready: true,
			note: "People in this channel can mention the factory, and it answers there.",
		});
		expect(row(ready, "Linear")).toEqual({
			label: "Linear",
			key: "integrations.linear",
			value: "Team ENG",
			ready: true,
			note: "Issues of this team can start automations.",
		});
		expect(row(ready, "Sentry")).toEqual({
			label: "Sentry",
			key: "integrations.sentry",
			value: "acme/web",
			mono: true,
			ready: true,
			note: "New errors of this project, on https://sentry.acme.dev, can start automations.",
		});
	});
});

it("keeps the order of the sections and their rows", () => {
	expect(
		settingsSections(bare).map((s) => [
			s.id,
			s.title,
			...s.rows.map((r) => r.label),
		]),
	).toEqual([
		[
			"factory",
			"Factory",
			"Repository",
			"Maintainers",
			"Default model",
			"Time zone",
			"Wiki",
			"Learning",
			"Signature",
		],
		[
			"limits",
			"Limits",
			"Cost per run",
			"Cost per day",
			"Time per run",
			"Review rounds",
		],
		["harness", "Commands and checks", "Setup", "Commands", "Checks"],
		["variables", "Variables and secrets", "Variables", "Secrets"],
		[
			"connections",
			"Connections",
			"GitHub",
			"Slack",
			"Linear",
			"Sentry",
			"Webhooks",
			"MCP servers",
		],
	]);
});

it("lists the setup, the commands, the variables and the MCP servers", () => {
	const s: FactorySettings = {
		...bare,
		timezone: "Europe/Paris",
		setup: ["npm ci"],
		commands: { test: "npm test" },
		checks: ["test", "lint"],
		env: { NODE_ENV: "test" },
		mcp: {
			docs: { url: "https://mcp.example.com" },
			db: { command: "npx db-mcp" },
		},
		ready: { ...bare.ready, relay: true },
	};
	expect(row(s, "Time zone")).toEqual({
		label: "Time zone",
		key: "timezone",
		value: "Europe/Paris",
		note: "Schedules are read in this time zone.",
	});
	expect(row(s, "Setup")?.items).toEqual([{ name: "npm ci" }]);
	expect(row(s, "Commands")?.items).toEqual([
		{ name: "test", detail: "npm test" },
	]);
	expect(row(s, "Checks")?.items).toEqual([
		{ name: "test", detail: "npm test" },
		{ name: "lint" },
	]);
	expect(row(s, "Variables")?.items).toEqual([
		{ name: "NODE_ENV", detail: "test" },
	]);
	expect(row(s, "MCP servers")?.items).toEqual([
		{ name: "docs", detail: "https://mcp.example.com" },
		{ name: "db", detail: "runs on this machine: npx db-mcp" },
	]);
	expect(row(s, "Relay")).toEqual({
		label: "Relay",
		value: "Connected",
		ready: true,
		note: "Your own small server on the Internet. It receives events from Slack, Linear, Sentry and webhooks, and this machine fetches them.",
	});
});

it("says whether the engine keeps a wiki, and whether what it writes on GitHub is signed", () => {
	expect(row(bare, "Wiki")).toEqual({
		label: "Wiki",
		key: "wiki",
		value: "Off",
		note: "wiki: false: the engine keeps no map of the code for the agents.",
	});
	expect(
		row(
			{ ...bare, wiki: { folder: "docs/wiki", refresh: "after_merge" } },
			"Wiki",
		),
	).toMatchObject({
		value: "docs/wiki/",
		mono: true,
		note: "The engine keeps this map of the code up to date after each merge, by pull request.",
	});
	expect(
		row({ ...bare, wiki: { folder: "wiki", refresh: "manual" } }, "Wiki")?.note,
	).toBe(
		"The engine keeps this map of the code up to date when you ask on the Wiki page, by pull request.",
	);
	expect(row(bare, "Learning")).toMatchObject({
		key: "learning",
		value: "Off",
	});
	expect(
		row({ ...bare, learning: { schedule: "0 8 * * 1" } }, "Learning"),
	).toMatchObject({ value: "Every Monday at 08:00" });
	expect(row(bare, "Signature")).toEqual({
		label: "Signature",
		key: "signature",
		value: "On",
		note: "What the factory writes on GitHub ends with a line saying openfabriq wrote it, with the agent and the automation.",
	});
	expect(row({ ...bare, signature: false }, "Signature")).toMatchObject({
		value: "Off",
		note: "signature: false: what the factory writes on GitHub does not say an agent wrote it.",
	});
});
