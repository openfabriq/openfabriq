import { z } from "zod";
import { isTimeZone } from "../cron/schedule.js";
import { unknownWord } from "../words.js";
import { REPOSITORY } from "./imported.js";
import { isSite, type Network, PACKAGES } from "./network.js";
import type { DeclaredSkill } from "./types.js";

const label = z.string().min(1).max(50);
const variableName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, {
	error: "a variable name is letters, digits and _, like DATABASE_URL",
});

const REPOSITORY_ERROR = "is a GitHub repository, like mattpocock/skills";

const NETWORK_WORDS = ["none", "packages", "any"];

// none, packages, any, or a list of sites that may hold the word packages.
const network = z
	.union([z.string(), z.array(z.string())], {
		error:
			"is none, packages, any, or a list of sites, like [packages, docs.stripe.com]",
	})
	.superRefine((value, ctx) => {
		const problems =
			typeof value === "string"
				? NETWORK_WORDS.includes(value)
					? []
					: [
							`"${value}" is not none, packages or any; a list names sites, like [packages, docs.stripe.com]`,
						]
				: value.length === 0
					? ["an empty list reaches nothing: write none"]
					: value
							.filter((entry) => entry !== PACKAGES && !isSite(entry))
							.map(
								(entry) =>
									`"${entry}" is not a site: write a domain, like docs.stripe.com or *.sentry.io`,
							);
		for (const message of problems)
			ctx.addIssue({ code: "custom", message, input: value });
	})
	.transform((value): Network => {
		if (value === "any") return "any";
		if (value === "none") return [];
		if (value === "packages") return [PACKAGES];
		return [...new Set(value as string[])];
	});

export const FactoryShape = {
	name: z.string().min(1),
	description: z.string().optional(),
	// A part made of dots only (. or ..) would point outside the engine's folders.
	repository: z.string().regex(/^(?!\.+\/)[\w.-]+\/(?!\.+$)[\w.-]+$/, {
		error: (issue) =>
			`must look like "owner/name", got ${JSON.stringify(issue.input)}`,
	}),
	maintainers: z.array(z.string().min(1)).min(1),
	model: z.string().min(1).default("sonnet"),
	limits: z
		.strictObject({
			usd_per_run: z.number().positive().default(5),
			usd_per_day: z.number().positive().default(30),
			minutes_per_run: z.number().positive().default(45),
			review_rounds: z.int().positive().default(3),
		})
		.prefault({}),
	// One line or a list of lines, always a list once read.
	setup: z
		.union([z.string().min(1), z.array(z.string().min(1)).min(1)])
		.transform((s) => (typeof s === "string" ? [s] : s))
		.optional(),
	commands: z
		.record(
			z.string().regex(/^[a-z][a-z0-9_-]*$/, {
				error: "a command name is a lowercase word, like test or lint",
			}),
			z.string().min(1),
		)
		.optional(),
	checks: z.array(z.string().min(1)).min(1).optional(),
	env: z
		.record(
			variableName,
			z.union([z.string(), z.number(), z.boolean()]).transform(String),
		)
		.optional(),
	secrets: z.array(variableName).min(1).optional(),
	network: network.optional(),
	timezone: z
		.string()
		.refine(isTimeZone, {
			error: (issue) =>
				`${JSON.stringify(issue.input)} is not a time zone; use a name like Europe/Paris or UTC`,
		})
		.optional(),
	// The services the engine knows by name.
	integrations: z
		.strictObject(
			{
				slack: z
					.strictObject({
						// "#factory" needs quotes in YAML; accept it anyway.
						channel: z
							.string()
							.min(1)
							.transform((c) => c.replace(/^#/, "")),
					})
					.optional(),
				linear: z.strictObject({ team: z.string().min(1) }).optional(),
				sentry: z
					.strictObject({
						organization: z.string().min(1),
						project: z.string().min(1),
						url: z
							.url({ protocol: /^https?$/ })
							.transform((u) => u.replace(/\/+$/, ""))
							.optional(),
					})
					.optional(),
			},
			{
				error: (issue) =>
					issue.code === "unrecognized_keys"
						? issue.keys
								.map((key) =>
									unknownWord("integration", key, [
										"slack",
										"linear",
										"sentry",
									]),
								)
								.join("; ")
						: undefined,
			},
		)
		.optional(),
	// Names and signatures are checked in factory-rules.ts, one webhook at a time.
	webhooks: z
		.record(z.string(), z.strictObject({ signature: z.string().min(1) }))
		.optional(),
	// Public skills the factory imports, by name: the repository, or the repository and the agent
	// or area whose folder takes the skill. Checked against imported-skills.json in imported.ts.
	skills: z
		.record(
			z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
				error:
					"a skill's name is lowercase letters, digits and -, like code-review",
			}),
			z
				.union(
					[
						z.string().regex(REPOSITORY, { error: REPOSITORY_ERROR }),
						z.strictObject({
							from: z.string().regex(REPOSITORY, { error: REPOSITORY_ERROR }),
							agent: z.string().min(1).optional(),
							area: z.string().min(1).optional(),
						}),
					],
					{
						error:
							"is a GitHub repository, like mattpocock/skills, or { from: mattpocock/skills, agent: reviewer }",
					},
				)
				.refine((d) => typeof d === "string" || !(d.agent && d.area), {
					error:
						"takes agent or area, not both: an agent's skills are in its own folder",
				})
				.transform(
					(d): DeclaredSkill =>
						typeof d === "string"
							? { from: d }
							: {
									from: d.from,
									...(d.agent ? { agent: d.agent } : {}),
									...(d.area ? { area: d.area } : {}),
								},
				),
		)
		.optional(),
	// Off by default; true turns it on, on demand, in wiki/; the folder's rules are in wiki.ts.
	wiki: z
		.union(
			[
				z.boolean(),
				z.strictObject({
					folder: z
						.string()
						.min(1)
						.transform((f) => f.replace(/\/+$/, ""))
						.optional(),
					refresh: z.enum(["manual", "after_merge"]).optional(),
				}),
			],
			{
				error:
					"is true, false, or a folder and a refresh (manual or after_merge), like wiki: { folder: docs/wiki, refresh: after_merge }",
			},
		)
		.optional(),
	// Off by default; true turns it on, each week; the schedule's cron is checked in learning.ts.
	learning: z
		.union(
			[
				z.boolean(),
				z.strictObject(
					{ schedule: z.string().trim().min(1).optional() },
					{
						error: (issue) =>
							issue.code === "unrecognized_keys"
								? issue.keys
										.map((key) => unknownWord("key", key, ["schedule"]))
										.join("; ")
								: undefined,
					},
				),
			],
			{
				error:
					'is true, false, or a schedule, like learning: { schedule: "0 8 * * 1" }',
			},
		)
		.optional(),
	// On by default: an agent answers mentions on the pull requests it opened (answer-mentions.ts).
	answer_mentions: z
		.boolean({
			error:
				"is true or false; false: the engine no longer answers mentions of @openfabriq on its pull requests",
		})
		.optional(),
	// On by default: a line under what the factory writes on GitHub says openfabriq wrote it.
	signature: z
		.boolean({
			error:
				"is true or false; false leaves out the line that says what openfabriq wrote",
		})
		.optional(),
	// Names and the url/command choice are checked in factory-rules.ts, one server at a time.
	mcp: z
		.record(
			z.string(),
			z.strictObject({
				url: z.url({ protocol: /^https?$/ }).optional(),
				secret: variableName.optional(),
				command: z.string().min(1).optional(),
				secrets: z.array(variableName).min(1).optional(),
			}),
		)
		.optional(),
};

export const AgentShape = {
	description: z.string().min(1),
	model: z.string().min(1).optional(),
	tools: z.array(z.string()).default(["read"]),
	mcp: z
		.record(
			z.string(),
			z
				.array(
					z.string().regex(/^[\w-]+$/, {
						error: "a tool name is letters, digits, _ and -, like get_issue",
					}),
				)
				.min(1),
		)
		.optional(),
	network: network.optional(),
};

export const AutomationShape = {
	when: z.union([
		z.string(),
		z.array(z.string()),
		z.record(
			z.string(),
			z.union([
				z.null(),
				z.strictObject({
					labels: z.array(label).optional(),
					cron: z.string().optional(),
					ignore_paths: z.array(z.string().min(1)).min(1).optional(),
					query: z.string().min(1).optional(),
					webhook: z.string().min(1).optional(),
					mentions: z.string().trim().min(1).optional(),
					opened_by: z.string().trim().min(1).optional(),
				}),
			]),
		),
	]),
	agent: z.string().min(1),
	reviewed_by: z.string().trim().min(1).optional(),
	can: z
		.array(
			z.union([
				z.string(),
				z.record(
					z.string(),
					z.union([
						z.array(label),
						// merge_pull_request's conditions.
						z.strictObject({
							labels: z.array(label).min(1).optional(),
							only_paths: z.array(z.string().min(1)).min(1).optional(),
							// The old name of only_paths, still read.
							paths: z.array(z.string().min(1)).min(1).optional(),
							except_paths: z.array(z.string().min(1)).min(1).optional(),
						}),
					]),
				),
			]),
		)
		.default([]),
	concurrency: z.string().default("issue"),
	from: z.string().default("maintainers"),
};

export type Shape = Record<string, z.ZodType>;
export type Parsed<S extends Shape> = Partial<z.output<z.ZodObject<S>>>;

/** Keys of an older format, and where they went. */
const MOVED: Record<string, string> = {
	on: 'is now called "when"',
	slack: "now goes under integrations",
	linear: "now goes under integrations",
	sentry: "now goes under integrations",
	board: "is no longer needed: the studio orders agents along the workflow",
};

/** Checks each key on its own, so that one bad key does not hide the problems of the others. */
export function parseFields<S extends Shape>(
	shape: S,
	raw: unknown,
): { fields: Parsed<S>; problems: string[] } {
	const input = raw ?? {};
	if (typeof input !== "object" || Array.isArray(input))
		return { fields: {}, problems: ["must be a list of keys"] };
	const problems: string[] = [];
	const values = input as Record<string, unknown>;
	for (const key of Object.keys(values))
		if (Object.hasOwn(shape, key)) continue;
		else if (Object.hasOwn(MOVED, key))
			problems.push(`the key "${key}" ${MOVED[key]}`);
		else problems.push(unknownWord("key", key, Object.keys(shape)));
	const out: Record<string, unknown> = {};
	for (const [key, schema] of Object.entries(shape)) {
		const result = schema.safeParse(values[key]);
		if (result.success) {
			if (result.data !== undefined) out[key] = result.data;
		} else if (values[key] === undefined) problems.push(`${key} is required`);
		else
			for (const issue of result.error.issues)
				problems.push(
					`${[key, ...issue.path].join(".")}: ${
						// A bad key of a map: Zod says "Invalid key in record", the key's own rule says why.
						(issue.code === "invalid_key" && issue.issues[0]?.message) ||
						issue.message
					}`,
				);
	}
	return { fields: out as Parsed<S>, problems };
}
