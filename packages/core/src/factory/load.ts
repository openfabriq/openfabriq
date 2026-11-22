import { CONCURRENCY, FROM } from "../vocabulary.js";
import { isOneOf, suggested, unknownWord } from "../words.js";
import { agentProblems, parseTools } from "./agent-rules.js";
import { answerMentionsNameClashes } from "./answer-mentions.js";
import { automationProblems } from "./automation-rules.js";
import { parseCan } from "./can.js";
import { factoryProblems } from "./factory-rules.js";
import {
	duplicateNames,
	grantingSkills,
	type Layout,
	misnamedFolders,
	misplacedAreas,
	misplacedFiles,
	missingFiles,
	readYaml,
	scanLayout,
	splitArea,
	splitFrontMatter,
} from "./files.js";
import { importedSkillsProblems } from "./imported.js";
import {
	AgentShape,
	AutomationShape,
	FactoryShape,
	type Parsed,
	parseFields,
	type Shape,
} from "./schema.js";
import { scriptProblems } from "./scripts.js";
import { toFactory } from "./to-factory.js";
import type {
	Agent,
	Automation,
	Factory,
	FactoryFiles,
	Problem,
} from "./types.js";
import { parseWhen } from "./when.js";
import { readWiki, wikiNameClashes } from "./wiki.js";

type Fields = Parsed<typeof FactoryShape>;
/** A problem of one file, before loadFactory says whether it is an error or a warning. */
type Found = Omit<Problem, "level">;

const inFile = (file: string, messages: string[]): Found[] =>
	messages.map((message) => ({ file, message }));

/**
 * Reads an openfabriq/ folder: the factory it describes, or none while it has an error, and every
 * problem found, errors first.
 */
export function loadFactory(files: FactoryFiles): {
	factory?: Factory;
	problems: Problem[];
} {
	const errors: Found[] = [];
	const warnings: Found[] = [];

	const layout = scanLayout(files);
	errors.push(...misplacedFiles(files));
	const { fields, problems: factoryYaml } = readFactoryYaml(files);
	errors.push(
		...factoryYaml,
		...missingFiles(layout),
		...misnamedFolders(layout),
		...misplacedAreas(files, layout),
		...duplicateNames(layout),
		...grantingSkills(files, layout),
		...importedSkillsProblems(files, layout),
	);
	const { wiki, problems: wikiProblems } = readWiki(
		fields.wiki,
		files["wiki.md"],
	);
	errors.push(...inFile("factory.yaml", wikiProblems));
	if (!wiki && files["wiki.md"] !== undefined)
		warnings.push({
			file: "wiki.md",
			message:
				"the wiki is off, so this file is not read: add wiki: true to factory.yaml to turn it on",
		});
	errors.push(...wikiNameClashes(layout));

	const agentFiles = [...layout.agentFiles].sort();
	const agents: Record<string, Agent> = {};
	for (const [name, path] of agentFiles) {
		const { agent, problems } = readAgent(name, files[path], fields, layout);
		errors.push(...inFile(path, problems));
		if (agent) agents[name] = withArea(agent, path, layout);
	}
	const automations: Record<string, Automation> = {};
	for (const [name, path] of [...layout.automationFiles].sort()) {
		const { automation, problems } = readAutomation(
			name,
			files[path],
			fields,
			layout,
		);
		errors.push(...inFile(path, problems));
		if (!automation) continue;
		automations[name] = withArea(automation, path, layout);
		// Comments on a pull request are mostly people talking to each other; on the pull requests
		// of one agent, or carrying a label, they are about that work.
		if (
			automation.when.some(
				(t) =>
					t.event === "pull_request.commented" &&
					!t.mentions &&
					!t.labels &&
					!t.openedBy,
			)
		)
			warnings.push({
				file: path,
				message:
					'when.pull_request.commented has no mentions: every comment of a maintainer on a pull request starts it. Add mentions: "@openfabriq" to start it only when the factory is asked',
			});
	}
	errors.push(
		...answerMentionsNameClashes(layout.automationFiles, Object.keys(agents)),
	);
	for (const [name, automation] of Object.entries(automations)) {
		const reviewer = agents[automation.reviewedBy ?? ""];
		if (reviewer?.tools.includes("edit"))
			errors.push({
				file: layout.automationFiles.get(name) ?? name,
				message: `reviewed_by names ${reviewer.name}, which can edit files: a reviewer reads the change, it never changes it; remove edit from its tools`,
			});
	}
	const used = new Set(
		Object.values(automations).flatMap((a) => [
			a.agent,
			...(a.reviewedBy ? [a.reviewedBy] : []),
		]),
	);
	for (const [name, path] of agentFiles)
		if (!used.has(name))
			warnings.push({ file: path, message: "no automation uses this agent" });

	const problems: Problem[] = [
		...errors.map((found) => ({ level: "error" as const, ...found })),
		...warnings.map((found) => ({ level: "warning" as const, ...found })),
	];
	const factory =
		errors.length === 0
			? toFactory(fields, { wiki, layout, agents, automations })
			: undefined;
	return factory ? { factory, problems } : { problems };
}

/** An agent or automation with the area its file is in. */
function withArea<T extends { area?: string }>(
	item: T,
	path: string,
	layout: Layout,
): T {
	const { area } = splitArea(path, layout.areas);
	return area ? { ...item, area } : item;
}

/** factory.yaml's fields, and its problems: its own, its rules', and its scripts', which are on their own files. */
function readFactoryYaml(files: FactoryFiles): {
	fields: Fields;
	problems: Found[];
} {
	const text = files["factory.yaml"];
	const problems: string[] = [];
	let fields: Fields = {};
	if (text === undefined)
		problems.push("missing; every factory starts with it");
	else {
		const raw = readYaml(text);
		if (typeof raw === "string") problems.push(raw);
		else {
			const parsed = parseFields(FactoryShape, raw.value);
			fields = parsed.fields;
			problems.push(...parsed.problems);
		}
	}
	problems.push(...factoryProblems(fields));
	const lines: [string, string][] = [
		...(fields.setup ?? []).map((line): [string, string] => ["setup", line]),
		...Object.entries(fields.commands ?? {}).map(
			([name, line]): [string, string] => [`commands.${name}`, line],
		),
	];
	return {
		fields,
		problems: [
			...inFile("factory.yaml", problems),
			...scriptProblems(lines, files),
		],
	};
}

/** The header's fields and the body of an agent.md or automation.md, unless its header is broken. */
function readHeader<S extends Shape>(
	shape: S,
	text: string | undefined,
): { header?: { fields: Parsed<S>; body: string }; problems: string[] } {
	const split = splitFrontMatter(text ?? "");
	if (typeof split === "string") return { problems: [split] };
	const { fields, problems } = parseFields(shape, split.header);
	return { header: { fields, body: split.body }, problems };
}

/** The agent an agent.md describes, unless a problem prevents it, and its problems. */
function readAgent(
	name: string,
	text: string | undefined,
	factory: Fields,
	layout: Layout,
): { agent?: Agent; problems: string[] } {
	const { header, problems } = readHeader(AgentShape, text);
	if (!header) return { problems };
	const { fields, body } = header;
	const { tools, problems: toolProblems } = parseTools(fields.tools);
	problems.push(
		...toolProblems,
		...agentProblems(
			{ tools, mcp: fields.mcp, network: fields.network, body },
			factory,
		),
	);
	// Required: parseFields has said it is missing.
	if (fields.description === undefined) return { problems };
	return {
		agent: {
			name,
			description: fields.description,
			...(fields.model ? { model: fields.model } : {}),
			tools,
			instructions: body,
			skills: [...(layout.agentSkills.get(name) ?? [])].sort(),
			...(fields.mcp ? { mcp: fields.mcp } : {}),
			...(fields.network ? { network: fields.network } : {}),
		},
		problems,
	};
}

/** The automation an automation.md describes, unless a problem prevents it, and its problems. */
function readAutomation(
	name: string,
	text: string | undefined,
	factory: Fields,
	layout: Layout,
): { automation?: Automation; problems: string[] } {
	const { header, problems } = readHeader(AutomationShape, text);
	if (!header) return { problems };
	const { fields, body } = header;
	const { when, problems: whenProblems } =
		fields.when === undefined
			? { when: [], problems: [] }
			: parseWhen(fields.when);
	const { can, problems: canProblems } = parseCan(fields.can ?? []);
	problems.push(...whenProblems, ...canProblems);
	for (const t of when)
		if (t.openedBy && !layout.agentFiles.has(t.openedBy))
			problems.push(
				suggested(
					`when.${t.event}.opened_by: agent "${t.openedBy}" does not exist.`,
					t.openedBy,
					[...layout.agentFiles.keys()],
				),
			);
	if (fields.agent !== undefined && !layout.agentFiles.has(fields.agent))
		problems.push(
			suggested(`agent "${fields.agent}" does not exist.`, fields.agent, [
				...layout.agentFiles.keys(),
			]),
		);
	const reviewer = fields.reviewed_by;
	if (reviewer !== undefined && !layout.agentFiles.has(reviewer))
		problems.push(
			suggested(`reviewed_by: agent "${reviewer}" does not exist.`, reviewer, [
				...layout.agentFiles.keys(),
			]),
		);
	else if (reviewer !== undefined && reviewer === fields.agent)
		problems.push(
			`reviewed_by names ${reviewer}, the agent of this automation: an agent does not review its own change; name another agent`,
		);
	// The schema's defaults, again for a value it refused: one problem, not a second one.
	const concurrency = fields.concurrency ?? "issue";
	const knownConcurrency = isOneOf(CONCURRENCY, concurrency);
	if (!knownConcurrency)
		problems.push(
			unknownWord("value", concurrency, CONCURRENCY, "concurrency"),
		);
	const from = fields.from ?? "maintainers";
	const knownFrom = isOneOf(FROM, from);
	if (!knownFrom) problems.push(unknownWord("value", from, FROM, "from"));
	// agent is required: parseFields has said it is missing.
	if (fields.agent === undefined || !knownConcurrency || !knownFrom)
		return { problems };
	const automation: Automation = {
		name,
		when,
		agent: fields.agent,
		...(reviewer ? { reviewedBy: reviewer } : {}),
		can,
		concurrency,
		from,
		instructions: body,
	};
	problems.push(...automationProblems(automation, factory));
	return { automation, problems };
}
