import { resourceFolder } from "../factory/files.js";
import { networkText } from "../factory/network.js";
import { listOrNothing, permissionText, whenText } from "../factory/text.js";
import type {
	Agent,
	Automation,
	Factory,
	FactoryFiles,
} from "../factory/types.js";
import { includesName } from "../vocabulary.js";
import { factoryLabels } from "./labels.js";
import { fileChanges } from "./topics/files.js";
import {
	integrationChanges,
	maintainerChanges,
	webhooks,
} from "./topics/gates.js";
import {
	envAndSecretChanges,
	harnessChanges,
	mcpServers,
} from "./topics/machine.js";
import {
	mcpTools,
	mentions,
	networkGains,
	powerGains,
} from "./topics/powers.js";
import {
	diffFields,
	identity,
	learning,
	repositoryAndLimitChanges,
	signatureChange,
	timezoneChange,
	wiki,
} from "./topics/settings.js";
import type { PlanTopic } from "./topics/topic.js";

export interface Plan {
	security: string[];
	agents: string[];
	automations: string[];
	settings: string[];
	labels: string[];
	counts: { add: number; change: number; remove: number };
}

/** The topics of the plan, in the order their lines are read in each section. */
const TOPICS: ((
	before: Factory | undefined,
	after: Factory,
	files: { before: FactoryFiles; after: FactoryFiles },
) => PlanTopic)[] = [
	identity,
	repositoryAndLimitChanges,
	harnessChanges,
	envAndSecretChanges,
	mcpServers,
	timezoneChange,
	signatureChange,
	webhooks,
	integrationChanges,
	maintainerChanges,
	powerGains,
	networkGains,
	(_before, _after, files) => fileChanges(files.before, files.after),
	wiki,
	learning,
	mentions,
];

/** The line of an agent or automation that moved to another folder of openfabriq/. */
function moved(
	kind: "agents" | "automations",
	a: Agent | Automation,
	b: Agent | Automation,
): string[] {
	return a.area === b.area
		? []
		: [`moved to ${resourceFolder(kind, b.name, b.area)}`];
}

function agentChanges(a: Agent, b: Agent): string[] {
	return [
		...moved("agents", a, b),
		...(a.description !== b.description ? ["description changed"] : []),
		...diffFields([
			["model", a.model ?? "default", b.model ?? "default"],
			["tools", listOrNothing(a.tools), listOrNothing(b.tools)],
			["skills", listOrNothing(a.skills), listOrNothing(b.skills)],
			["mcp", listOrNothing(mcpTools(a)), listOrNothing(mcpTools(b))],
			[
				"network",
				a.network ? networkText(a.network) : "default",
				b.network ? networkText(b.network) : "default",
			],
		]),
		...(a.instructions !== b.instructions ? ["instructions changed"] : []),
	];
}

function automationChanges(a: Automation, b: Automation): string[] {
	return [
		...moved("automations", a, b),
		...diffFields([
			["when", whenText(a), whenText(b)],
			["agent", a.agent, b.agent],
			["reviewed by", a.reviewedBy ?? "nobody", b.reviewedBy ?? "nobody"],
			[
				"can",
				listOrNothing(a.can.map(permissionText)),
				listOrNothing(b.can.map(permissionText)),
			],
			["concurrency", a.concurrency, b.concurrency],
			["from", a.from, b.from],
		]),
		...(a.instructions !== b.instructions ? ["instructions changed"] : []),
	];
}

/** The lines for the items added, removed or changed, by name, and how many of each. */
function diffByName<T>(
	before: Record<string, T>,
	after: Record<string, T>,
	describe: (item: T) => string,
	changes: (a: T, b: T) => string[],
) {
	const lines: string[] = [];
	const counts = { add: 0, change: 0, remove: 0 };
	for (const name of Object.keys({ ...before, ...after }).sort()) {
		const a = before[name];
		const b = after[name];
		if (!a && b) {
			lines.push(`+ ${name}: ${describe(b)}`);
			counts.add++;
		} else if (a && !b) {
			lines.push(`- ${name}`);
			counts.remove++;
		} else if (a && b) {
			const diff = changes(a, b);
			if (diff.length) {
				lines.push(`~ ${name}: ${diff.join("; ")}`);
				counts.change++;
			}
		}
	}
	return { lines, counts };
}

/** The factory as its files write it: without what the engine adds, the wiki's and learning's agents and the answer to mentions. */
function withoutEngineAdditions(factory: Factory): Factory {
	const engines = (name: string) => factory.agents[name]?.builtIn === true;
	return {
		...factory,
		agents: Object.fromEntries(
			Object.entries(factory.agents).filter(([name]) => !engines(name)),
		),
		automations: Object.fromEntries(
			Object.entries(factory.automations).filter(
				([, a]) => !a.builtIn && !engines(a.agent),
			),
		),
	};
}

export function planChanges(
	beforeAsLoaded: Factory | undefined,
	afterAsLoaded: Factory,
	existingLabels: readonly string[],
	files: { before: FactoryFiles | undefined; after: FactoryFiles },
): Plan {
	const before = beforeAsLoaded && withoutEngineAdditions(beforeAsLoaded);
	const after = withoutEngineAdditions(afterAsLoaded);
	const topics = TOPICS.map((topic) =>
		topic(before, after, { before: files.before ?? {}, after: files.after }),
	);
	const security = topics.flatMap((t) => t.security);
	const settings = topics.flatMap((t) => t.settings);

	const agents = diffByName(
		before?.agents ?? {},
		after.agents,
		(a) => a.description,
		agentChanges,
	);
	const automations = diffByName(
		before?.automations ?? {},
		after.automations,
		(a) =>
			`when ${whenText(a)} → ${a.agent}${a.reviewedBy ? `, reviewed by ${a.reviewedBy}` : ""}, can ${listOrNothing(a.can.map(permissionText))}`,
		automationChanges,
	);
	return {
		security,
		agents: agents.lines,
		automations: automations.lines,
		settings,
		labels: factoryLabels(after).filter(
			(l) => !includesName(existingLabels, l),
		),
		counts: {
			add: agents.counts.add + automations.counts.add,
			change: agents.counts.change + automations.counts.change,
			remove: agents.counts.remove + automations.counts.remove,
		},
	};
}
