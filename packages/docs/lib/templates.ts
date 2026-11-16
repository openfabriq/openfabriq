import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

// next build and next dev run in packages/docs: the examples are two folders up.
export const EXAMPLES = join(process.cwd(), "../../examples");

export const CATEGORIES = [
	{
		id: "start",
		title: "Getting started",
		text: "The whole format in a few files, then the full flow from issue to pull request.",
	},
	{
		id: "quality",
		title: "Review and quality",
		text: "Reviews, red checks, bugs proven by a test, changes checked in a real browser.",
	},
	{
		id: "maintenance",
		title: "Maintenance",
		text: "The work nobody schedules: dependencies, docs, release notes, triage, security.",
	},
	{
		id: "integrations",
		title: "Integrations",
		text: "Work that starts in Slack, in Sentry or from any service that sends a webhook.",
	},
	{
		id: "projects",
		title: "Projects",
		text: "Long projects driven by labels, such as a whole site migration.",
	},
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

/** What a person reads before opening a template: where it fits, what it does, when it starts, what it writes. */
const CATALOG: Record<
	string,
	{
		category: CategoryId;
		does: string;
		startsOn: string[];
		writes: string;
		/** For a wide graph whose work starts at its left middle, not its top-left corner: the card shows there. */
		startsMidLeft?: true;
	}
> = {
	"00-at-a-glance": {
		category: "start",
		does: "The whole format in a few files: issues and production errors become pull requests, failed deploys become issues.",
		startsOn: ["issue.labeled", "Sentry", "a webhook"],
		writes: "Pull requests, issues, comments",
	},
	"01-quickstart": {
		category: "start",
		does: "A maintainer labels an issue, an agent opens a pull request and changes it on a comment that mentions @openfabriq.",
		startsOn: ["issue.labeled", "pull_request.commented"],
		writes: "Pull request, commits, comment",
	},
	"02-sdlc": {
		category: "start",
		does: "The full flow: triage, investigation, implementation reviewed adversarially before the pull request exists, conflicts resolved, with checks and screenshots as proof.",
		startsOn: ["Issues", "pull requests", "Sentry", "a webhook"],
		writes: "Labels, comments, pull requests, issues",
	},
	"03-team-chat": {
		category: "start",
		does: "Work from Slack mentions and Linear issues; Sentry errors become issues.",
		startsOn: ["Slack", "Linear", "Sentry"],
		writes: "Replies, pull requests, issues",
	},
	"04-large-factory": {
		category: "start",
		does: "A dozen agents ordered by area: delivery at the root, then qa/, maintenance/ and security/, each folder with its agents and their automations.",
		startsOn: ["Issues", "pull requests", "schedules", "labels"],
		writes: "Pull requests reviewed before they open, issues, comments, labels",
	},
	"05-code-review": {
		category: "quality",
		does: "An advisory reviewer on every pull request, on another model.",
		startsOn: ["pull_request.opened", "pull_request.updated"],
		writes: "Comment, change request, ready-to-merge and a risk label",
	},
	"06-ci-doctor": {
		category: "quality",
		does: "Reads failed CI logs and comments the cause and the fix; fixes on request.",
		startsOn: ["pull_request.checks_failed", "a label"],
		writes: "Comment, labels, push on request",
	},
	"07-bug-reproducer": {
		category: "quality",
		does: "Proves a bug with a failing test before anyone fixes it.",
		startsOn: ["issue.labeled needs-repro"],
		writes: "Comment, reproduced or cannot-reproduce",
	},
	"08-test-coverage": {
		category: "quality",
		does: "Adds behavioral tests to the least-tested module, every night.",
		startsOn: ["schedule"],
		writes: "Pull request, or an issue when a test finds a bug",
	},
	"09-ui-check": {
		category: "quality",
		does: "Checks a pull request's change in a real browser, including phone width and keyboard.",
		startsOn: ["pull_request.labeled", "issue.labeled"],
		writes: "Comment, reproduced or cannot-reproduce",
	},
	"10-spec-first": {
		category: "quality",
		does: "A spec as a pull request, approved by a human, before any code.",
		startsOn: ["issue.labeled needs-spec", "ready-for-agent"],
		writes: "Spec PR, implementation PR reviewed against the spec",
	},
	"11-dependency-updates": {
		category: "maintenance",
		does: "Safe minor and patch updates in one pull request; major updates listed for a human.",
		startsOn: ["schedule, Monday"],
		writes: "Pull request",
	},
	"12-docs-drift": {
		category: "maintenance",
		does: "Keeps the README and docs in line with what was merged.",
		startsOn: ["default_branch.updated"],
		writes: "Docs pull request, or nothing",
	},
	"13-release-notes": {
		category: "maintenance",
		does: "Writes the week's CHANGELOG entry for users.",
		startsOn: ["schedule, Friday"],
		writes: "Pull request",
	},
	"14-issue-triage": {
		category: "maintenance",
		does: "Classifies, prioritizes and answers new issues; asks for what is missing.",
		startsOn: ["issue.opened", "issue.commented"],
		writes: "Labels, comment, a duplicate closed",
	},
	"15-security-audit": {
		category: "maintenance",
		does: "Weekly dependency audit and review of attack surfaces.",
		startsOn: ["schedule, Monday"],
		writes: "One issue per finding",
	},
	"16-security-review": {
		category: "maintenance",
		does: "A mapper picks the riskiest surfaces, a hunter per surface looks for flaws, a verifier on a stronger model tries to disprove each one.",
		startsOn: ["schedule, Monday", "issue.labeled"],
		writes: "One issue per confirmed finding",
	},
	"17-factory-tuner": {
		category: "maintenance",
		does: "Reads what people did with the factory's pull requests and proposes one change to an agent's brief a week, with the evidence.",
		startsOn: ["schedule, Monday"],
		writes: "Pull request on openfabriq/, or nothing",
	},
	"18-tech-debt-sweeper": {
		category: "maintenance",
		does: "One small mechanical cleanup per pull request.",
		startsOn: ["issue.labeled chore", "schedule"],
		writes: "Pull request, or a chore already done closed",
	},
	"19-living-wiki": {
		category: "maintenance",
		does: "Keeps a map of the code in wiki/ after each merge; a guide answers questions from it, the implementer starts from it.",
		startsOn: ["issue.labeled question", "ready-for-agent", "after each merge"],
		writes: "Comments, pull requests, wiki updates",
	},
	"20-seo-audit": {
		category: "maintenance",
		does: "A monthly SEO audit of the built site, with no paid service: safe fixes as a pull request on a label, the words left to a person.",
		startsOn: [
			"schedule, monthly",
			"issue.labeled seo-fix",
			"pull_request.labeled",
		],
		writes: "Audit issue, fixes PR, comment",
	},
	"21-slack-codebase-qa": {
		category: "integrations",
		does: "Answers questions about the code in Slack, read-only; files issues on request.",
		startsOn: ["slack.mentioned"],
		writes: "Thread reply, issue",
	},
	"22-linear-delivery": {
		category: "integrations",
		does: "A Linear label gets an implementation plan in the issue; assigning the issue to openfabriq gets a pull request.",
		startsOn: ["linear.issue.labeled needs-plan", "linear.issue.delegated"],
		writes: "Linear comments and labels, pull requests",
	},
	"23-sentry-autofix": {
		category: "integrations",
		does: "A new production error becomes a fix with a regression test, using Sentry's MCP server.",
		startsOn: ["sentry.issue.created"],
		writes: "Pull request, issue or Sentry note",
	},
	"24-deploy-failure-webhook": {
		category: "integrations",
		does: "A failed deploy or a downtime alert becomes an incident issue, or a revert.",
		startsOn: ["webhook.received"],
		writes: "Issue, revert pull request",
	},
	"25-wordpress-maintenance": {
		category: "projects",
		does: "Keeps a Composer-managed WordPress site up to date and safe: weekly updates, a daily WPScan watch, a fix per new vulnerability.",
		startsOn: ["schedule", "issue.labeled security-fix"],
		writes: "Update PRs, one issue per new vulnerability",
	},
	"26-webflow-to-astro": {
		category: "projects",
		does: "Moves a Webflow site to Astro from one plan you merge, each page checked against the old one before its pull request opens, while editors keep writing in Webflow, with a weekly content sync.",
		startsOn: [
			"A label on a migration issue",
			"pushes to the default branch",
			"pull requests",
			"schedule",
		],
		writes: "The plan's PR, ticket issues, reviewed PRs, sync PRs",
		startsMidLeft: true,
	},
	"27-framer-to-astro": {
		category: "projects",
		does: "Moves a Framer site, which exports no code, to Astro from one plan you merge: the agents read the published pages and a CMS export, check each page against the old one before its pull request opens, and hold no Framer key.",
		startsOn: [
			"A label on a migration issue",
			"pushes to the default branch",
			"pull requests",
		],
		writes: "The plan's PR, ticket issues, reviewed PRs, sync PRs",
		startsMidLeft: true,
	},
};

export interface Template {
	/** The folder in examples/, and the name `openfabriq init --example` takes. */
	name: string;
	/** The page's address: the name without its number. */
	slug: string;
	/** The README's title, without its number: "Code review, advisory only". */
	title: string;
	category: CategoryId;
	does: string;
	startsOn: string[];
	writes: string;
	/** The card shows a wide graph's left middle, where its work starts. */
	startsMidLeft?: true;
	/** The README without its title. */
	readme: string;
	/** The workflow image's width as the README shows it, or null when the template has none. */
	workflowWidth: number | null;
	agents: number;
	automations: number;
}

/** How many of a template's files are named `file`, at the root of openfabriq/ or in an area. */
const count = (name: string, file: string) =>
	readdirSync(join(EXAMPLES, name, "openfabriq"), { recursive: true }).filter(
		(path) => basename(String(path)) === file,
	).length;

function load(name: string): Template {
	const readme = readFileSync(join(EXAMPLES, name, "README.md"), "utf8");
	const [first, ...rest] = readme.split("\n");
	const entry = CATALOG[name];
	if (!entry) throw new Error(`examples/${name} is missing from CATALOG.`);
	const hasImage = existsSync(join(EXAMPLES, name, "workflow.png"));
	const width = readme.match(/<img src="workflow\.png" width="(\d+)"/)?.[1];
	return {
		name,
		slug: name.replace(/^\d+-/, ""),
		title: (first ?? name).replace(/^#\s*\d+:\s*/, ""),
		...entry,
		readme: rest.join("\n").trim(),
		workflowWidth: hasImage ? Number(width ?? 640) : null,
		agents: count(name, "agent.md"),
		automations: count(name, "automation.md"),
	};
}

// Read once per build: every page of the site lists them. In dev, a README edit shows on reload.
let cached: Template[] | undefined;

/** Every template, in catalog order, read from examples/ at build time. */
export function templates(): Template[] {
	if (process.env.NODE_ENV !== "production")
		return Object.keys(CATALOG).map(load);
	cached ??= Object.keys(CATALOG).map(load);
	return cached;
}

export function template(slug: string): Template | undefined {
	return templates().find((t) => t.slug === slug);
}

export const installCommand = (t: Pick<Template, "name">) =>
	`openfabriq init --example ${t.name}`;

/** The workflow image's pixels, from its PNG header, or null when the template has none. */
function pixelsOf(name: string) {
	const file = join(EXAMPLES, name, "workflow.png");
	if (!existsSync(file)) return null;
	const png = readFileSync(file);
	return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * What a card shows: no README, and how to frame the workflow image. A large graph is cut to
 * where the work starts: its top when it is tall, its top-left corner, enlarged, when it is wide.
 */
export function cardOf({
	readme,
	workflowWidth,
	startsMidLeft,
	...t
}: Template) {
	const pixels = workflowWidth === null ? null : pixelsOf(t.name);
	const large = (workflowWidth ?? 0) >= 900;
	return {
		...t,
		hasWorkflow: pixels !== null,
		workflowFrame:
			!pixels || !large
				? ("whole" as const)
				: pixels.height > pixels.width
					? ("top" as const)
					: startsMidLeft
						? ("left" as const)
						: ("corner" as const),
	};
}
