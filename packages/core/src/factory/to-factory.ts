import type { Signature } from "../vocabulary.js";
import type { Layout } from "./files.js";
import type { FactoryShape, Parsed } from "./schema.js";
import type { Agent, Automation, Factory, Wiki } from "./types.js";

/** The factory factory.yaml describes, or undefined while one of its required keys is missing. */
export function toFactory(
	fields: Parsed<typeof FactoryShape>,
	read: {
		wiki: Wiki | undefined;
		layout: Layout;
		agents: Record<string, Agent>;
		automations: Record<string, Automation>;
	},
): Factory | undefined {
	const { name, repository, maintainers, model, limits } = fields;
	if (!name || !repository || !maintainers || !model || !limits)
		return undefined;
	// The engine keeps them flat; factory.yaml groups them.
	const { slack, linear, sentry } = fields.integrations ?? {};
	return {
		name,
		...(fields.description ? { description: fields.description } : {}),
		repository,
		maintainers,
		model,
		limits,
		...(fields.setup ? { setup: fields.setup } : {}),
		...(fields.commands ? { commands: fields.commands } : {}),
		...(fields.checks ? { checks: fields.checks } : {}),
		...(fields.skills ? { importedSkills: fields.skills } : {}),
		...(fields.env ? { env: fields.env } : {}),
		...(fields.secrets ? { secrets: fields.secrets } : {}),
		...(fields.network ? { network: fields.network } : {}),
		...(fields.timezone ? { timezone: fields.timezone } : {}),
		...(slack ? { slack } : {}),
		...(linear ? { linear } : {}),
		...(sentry
			? {
					sentry: {
						organization: sentry.organization,
						project: sentry.project,
						...(sentry.url ? { url: sentry.url } : {}),
					},
				}
			: {}),
		// factoryProblems has checked each signature.
		...(fields.webhooks
			? {
					webhooks: fields.webhooks as Record<string, { signature: Signature }>,
				}
			: {}),
		...(fields.mcp
			? {
					mcp: Object.fromEntries(
						Object.entries(fields.mcp).map(([server, s]) => [
							server,
							s.url
								? { url: s.url, ...(s.secret ? { secret: s.secret } : {}) }
								: {
										command: s.command ?? "",
										...(s.secrets ? { secrets: s.secrets } : {}),
									},
						]),
					),
				}
			: {}),
		...(read.wiki ? { wiki: read.wiki } : {}),
		...(fields.signature === false ? { signature: false as const } : {}),
		...(fields.answer_mentions === false
			? { answerMentions: false as const }
			: {}),
		skills: [...read.layout.skillFolders.keys()]
			.filter((folder) => folder.startsWith("skills/"))
			.map((folder) => folder.slice("skills/".length)),
		...(read.layout.areaSkills.size
			? {
					areaSkills: Object.fromEntries(
						[...read.layout.areaSkills]
							.sort(([a], [b]) => (a < b ? -1 : 1))
							.map(([area, skills]) => [area, [...skills].sort()]),
					),
				}
			: {}),
		agents: read.agents,
		automations: read.automations,
	};
}
