import { cronWords } from "@openfabriq/core";
import { capitalized, money, serverWhere } from "../../lib/format.js";
import type { FactorySettings } from "../../lib/types.js";

// What the settings page says about each key of factory.yaml, in words.

/** One thing of a list setting: a command, a variable, a secret, a server. */
export interface Item {
	name: string;
	detail?: string;
	/** Known only for what lives on this machine: secrets, tokens, the relay. */
	ready?: boolean;
	/** The command that makes it ready. */
	fix?: string;
	/** A word of warning that goes with this item only. */
	warning?: string;
}

export interface Row {
	label: string;
	/** Where it is written in factory.yaml; none for what lives on this machine only. */
	key?: string;
	/** A single value; `items` for a list, neither when the setting is absent. */
	value?: string;
	mono?: boolean;
	items?: Item[];
	/** What it does, for someone who has never read the engine. */
	note: string;
	ready?: boolean;
	fix?: string;
}

export interface Section {
	id: string;
	title: string;
	intro: string;
	rows: Row[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The factory's settings, section by section, as the page shows them. */
export function settingsSections(s: FactorySettings): Section[] {
	return [
		factorySection(s),
		limitsSection(s),
		harnessSection(s),
		variablesSection(s),
		connectionsSection(s),
	];
}

function factorySection(s: FactorySettings): Section {
	return {
		id: "factory",
		title: "Factory",
		intro: "What the factory works on, and whose actions start it.",
		rows: [
			{
				label: "Repository",
				key: "repository",
				value: s.repository,
				mono: true,
				note: "The GitHub repository it reads issues and pull requests from, and writes to. It touches no other.",
			},
			{
				label: "Maintainers",
				key: "maintainers",
				items: s.maintainers.map((name) => ({ name })),
				note: "Only their actions start work, unless an automation lets anyone start it.",
			},
			{
				label: "Default model",
				key: "model",
				value: s.model,
				mono: true,
				note: "The Claude model agents use, unless an agent's own file names another.",
			},
			{
				label: "Time zone",
				key: "timezone",
				value: s.timezone ?? "This machine's",
				note: s.timezone
					? "Schedules are read in this time zone."
					: "Not set: schedules follow this machine's clock.",
			},
			{
				label: "Wiki",
				key: "wiki",
				...(s.wiki
					? { value: `${s.wiki.folder}/`, mono: true }
					: { value: "Off" }),
				note: s.wiki
					? `The engine keeps this map of the code up to date ${s.wiki.refresh === "after_merge" ? "after each merge" : "when you ask on the Wiki page"}, by pull request.`
					: "wiki: false: the engine keeps no map of the code for the agents.",
			},
			{
				label: "Learning",
				key: "learning",
				value: s.learning ? capitalized(cronWords(s.learning.schedule)) : "Off",
				note: s.learning
					? "On this schedule, the engine studies the agents' mistakes and proposes the rules that would avoid them, by pull request. A rule a person merges applies on its own."
					: "learning: false: the engine proposes no rule from the agents' mistakes. It still counts them on the Learning page.",
			},
			{
				label: "Signature",
				key: "signature",
				value: s.signature === false ? "Off" : "On",
				note:
					s.signature === false
						? "signature: false: what the factory writes on GitHub does not say an agent wrote it."
						: "What the factory writes on GitHub ends with a line saying openfabriq wrote it, with the agent and the automation.",
			},
		],
	};
}

function limitsSection(s: FactorySettings): Section {
	return {
		id: "limits",
		title: "Limits",
		intro: "Where the engine stops a run, or stops starting new ones.",
		rows: [
			{
				label: "Cost per run",
				key: "limits.usd_per_run",
				value: money(s.limits.usd_per_run),
				note: "A run stops once it has cost this much.",
			},
			{
				label: "Cost per day",
				key: "limits.usd_per_day",
				value: money(s.limits.usd_per_day),
				note: "Once the factory has cost this much today, new runs are skipped until tomorrow.",
			},
			{
				label: "Time per run",
				key: "limits.minutes_per_run",
				value: `${s.limits.minutes_per_run} min`,
				note: "A run stops after this long, setup included.",
			},
			{
				label: "Review rounds",
				key: "limits.review_rounds",
				value: plural(s.limits.review_rounds, "round"),
				note: "After this many rounds of requested changes on one pull request, it goes to a person.",
			},
		],
	};
}

function harnessSection(s: FactorySettings): Section {
	const commands = s.commands ?? {};
	return {
		id: "harness",
		title: "Commands and checks",
		intro:
			"What runs on this machine around the agents, in each run's own copy of the code.",
		rows: [
			{
				label: "Setup",
				key: "setup",
				...(s.setup ? { items: s.setup.map((name) => ({ name })) } : {}),
				note: s.setup
					? "Runs before every agent, in this order, to get the code ready."
					: "Agents start on the code as it is.",
			},
			{
				label: "Commands",
				key: "commands",
				...(s.commands
					? {
							items: Object.entries(commands).map(([name, command]) => ({
								name,
								detail: command,
							})),
						}
					: {}),
				note: s.commands
					? "Agents allowed to run commands can run these, by name, and nothing else."
					: "Agents cannot run the project's commands by name.",
			},
			{
				label: "Checks",
				key: "checks",
				...(s.checks
					? {
							items: s.checks.map((name) => ({
								name,
								...(commands[name] ? { detail: commands[name] } : {}),
							})),
						}
					: {}),
				note: s.checks
					? "Before an agent's code leaves this machine, the engine runs these. A failing check goes back to the agent, twice at most; code that still fails is not published."
					: "Code an agent changes is published without the engine testing it.",
			},
		],
	};
}

function variablesSection(s: FactorySettings): Section {
	const secrets = Object.keys(s.ready.secrets);
	return {
		id: "variables",
		title: "Variables and secrets",
		intro: "Values given to the code that runs on this machine.",
		rows: [
			{
				label: "Variables",
				key: "env",
				...(s.env
					? {
							items: Object.entries(s.env).map(([name, value]) => ({
								name,
								detail: value,
							})),
						}
					: {}),
				note: s.env
					? "Setup, commands and agents get them. They are written in the repository, so anyone who reads it sees them."
					: "No variable is given to setup, commands or agents.",
			},
			{
				label: "Secrets",
				key: "secrets",
				...(secrets.length ? { items: secrets.map(secretItem(s)) } : {}),
				note: secrets.length
					? "Only their names are in the repository; their values stay on this machine. Setup, commands and MCP servers get them; agents never see them."
					: "No secret is given to setup or commands.",
			},
		],
	};
}

/** A secret by name: whether it is set on this machine, and the MCP server it serves. */
function secretItem(s: FactorySettings): (name: string) => Item {
	const mcpSecret = new Map(
		Object.entries(s.mcp ?? {}).flatMap(([server, m]) =>
			"url" in m
				? m.secret
					? [[m.secret, server] as const]
					: []
				: (m.secrets ?? []).map((n) => [n, server] as const),
		),
	);
	return (name) => {
		const ready = s.ready.secrets[name] ?? false;
		const server = mcpSecret.get(name);
		return {
			name,
			...(server
				? {
						detail: `${s.secrets?.includes(name) ? "also " : ""}for the MCP server ${server}`,
					}
				: {}),
			ready,
			...(ready
				? {}
				: { fix: `openfabriq secret set ${name} --project ${s.repository}` }),
		};
	};
}

function connectionsSection(s: FactorySettings): Section {
	const relayed = s.ready.relayNeeded || s.ready.relay;
	return {
		id: "connections",
		title: "Connections",
		intro: "Where work can come from, and what agents can reach.",
		rows: [
			{
				label: "GitHub",
				value: "Always on",
				note: "Issues, pull requests and comments, through the gh command you are signed in with.",
			},
			connectionRow(
				"slack",
				"Slack",
				s.ready.slack,
				s.slack && {
					value: `#${s.slack.channel}`,
					mono: true,
					note: "People in this channel can mention the factory, and it answers there.",
				},
			),
			connectionRow(
				"linear",
				"Linear",
				s.ready.linear,
				s.linear && {
					value: `Team ${s.linear.team}`,
					note: "Issues of this team can start automations.",
				},
			),
			connectionRow(
				"sentry",
				"Sentry",
				s.ready.sentry,
				s.sentry && {
					value: `${s.sentry.organization}/${s.sentry.project}`,
					mono: true,
					note: `New errors of this project${s.sentry.url ? `, on ${s.sentry.url},` : ""} can start automations.`,
				},
			),
			{
				label: "Webhooks",
				key: "webhooks",
				...(s.webhooks
					? {
							items: Object.entries(s.webhooks).map(([name, hook]) => ({
								name,
								detail:
									hook.signature === "none"
										? "not signed"
										: `signed (${hook.signature})`,
								...(hook.signature === "none"
									? {
											warning:
												"Anyone who has its address can start automations.",
										}
									: {}),
							})),
						}
					: {}),
				note: s.webhooks
					? "Another service can start work by calling these addresses, through the relay."
					: "No other service can start work by calling an address.",
			},
			{
				label: "MCP servers",
				key: "mcp",
				...(s.mcp
					? {
							items: Object.entries(s.mcp).map(([name, m]) => ({
								name,
								detail: serverWhere(m),
							})),
						}
					: {}),
				note: s.mcp
					? "Extra tools agents can call. An agent uses only the servers its own file lists."
					: "Agents have only their own tools.",
			},
			...(relayed
				? [
						{
							label: "Relay",
							value: s.ready.relay ? "Connected" : "Not connected",
							ready: s.ready.relay,
							...(s.ready.relay ? {} : { fix: "openfabriq connect relay" }),
							note: "Your own small server on the Internet. It receives events from Slack, Linear, Sentry and webhooks, and this machine fetches them.",
						},
					]
				: []),
		],
	};
}

/**
 * A service the factory reads, connected on this machine by `openfabriq connect <service>`:
 * what it reads there when factory.yaml names it, else that it does not read it.
 */
function connectionRow(
	service: "slack" | "linear" | "sentry",
	label: string,
	ready: boolean,
	named: { value: string; mono?: boolean; note: string } | undefined,
): Row {
	return {
		label,
		key: `integrations.${service}`,
		...(named
			? {
					value: named.value,
					...(named.mono ? { mono: true } : {}),
					ready,
					...(ready ? {} : { fix: `openfabriq connect ${service}` }),
				}
			: {}),
		note: named?.note ?? `The factory does not read ${label}.`,
	};
}

/** What is not ready on this machine, by name: for the line at the top of the page. */
export function missing(sections: Section[]): string[] {
	return sections.flatMap((section) =>
		section.rows.flatMap((row) => [
			...(row.ready === false ? [row.label] : []),
			...(row.items ?? [])
				.filter((item) => item.ready === false)
				.map((item) => item.name),
		]),
	);
}
