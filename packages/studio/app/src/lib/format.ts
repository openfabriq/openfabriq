import type { McpServer, SourceKind } from "@openfabriq/core";
import type { RunRecord } from "./types.js";

/** "2 Nov, 00:08", in the machine's time zone. */
export const dateTime = (iso: string) =>
	new Date(iso).toLocaleString("en-GB", {
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	});

/** "00:08:12". */
export const clock = (iso: string) =>
	new Date(iso).toLocaleTimeString("en-GB", { hour12: false });

/** "just now", "5m ago", "3h ago", "2d ago", then the date: the units of `duration`. */
export function ago(iso: string, now = Date.now()): string {
	const s = (now - new Date(iso).getTime()) / 1000;
	if (s < 45) return "just now";
	if (s < 3600) return `${Math.round(s / 60)}m ago`;
	if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
	if (s < 7 * 86_400) return `${Math.round(s / 86_400)}d ago`;
	return dateTime(iso);
}

export const money = (usd?: number) =>
	usd === undefined
		? "—"
		: usd > 0 && usd < 0.01
			? "< $0.01"
			: `$${usd.toFixed(2)}`;

export const duration = (ms?: number) => {
	if (ms === undefined) return "—";
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
	return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};

export const tokens = (n: number) =>
	n >= 1_000_000
		? `${(n / 1_000_000).toFixed(1)}M`
		: n >= 1000
			? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
			: String(n);

/** "Issue #4", "PR #5", or what a run about the whole repository answers to. */
export const subject = (r: RunRecord) =>
	r.number !== undefined
		? `${r.isPullRequest ? "PR" : "Issue"} #${r.number}`
		: r.event === "default_branch.updated"
			? "Main branch"
			: r.event === "schedule"
				? "Schedule"
				: r.source
					? r.source.label
					: "Repository";

/** The run's title, without the subject it may start with: "ENG-12 Add a counter" beside "ENG-12". */
export const runTitle = (r: RunRecord) => {
	const title = r.title ?? r.automation;
	const prefix = `${subject(r)} `;
	return title.startsWith(prefix) ? title.slice(prefix.length) : title;
};

const PLACES: [string, string][] = [
	["github.com", "GitHub"],
	["slack.com", "Slack"],
	["linear.app", "Linear"],
	["sentry.io", "Sentry"],
];

/** Where a link leads, for "Open on …": "GitHub", "Slack", else the site's own name. */
export function placeOf(url: string): string {
	let host: string;
	try {
		host = new URL(url).hostname;
	} catch {
		return "its site";
	}
	const place = PLACES.find(([d]) => host === d || host.endsWith(`.${d}`));
	return place ? place[1] : host;
}

/** What an output's link opens: "Open PR #51", "Open comment", else "Open on Slack". */
export function linkText(url: string): string {
	if (placeOf(url) === "GitHub") {
		if (url.includes("#issuecomment-")) return "Open comment";
		if (url.includes("#pullrequestreview-")) return "Open review";
		const pr = url.match(/\/pull\/(\d+)$/)?.[1];
		if (pr) return `Open PR #${pr}`;
		const issue = url.match(/\/issues\/(\d+)$/)?.[1];
		if (issue) return `Open issue #${issue}`;
	}
	return `Open on ${placeOf(url)}`;
}

export const STATUSES = [
	"queued",
	"running",
	"succeeded",
	"failed",
	"skipped",
] as const;

const EVENT_WORDS: Record<string, string> = {
	"issue.opened": "An issue is opened",
	"issue.labeled": "An issue is labeled",
	"issue.commented": "Someone comments on an issue",
	"pull_request.opened": "A pull request is opened",
	"pull_request.updated": "A pull request gets new commits",
	"pull_request.labeled": "A pull request is labeled",
	"pull_request.changes_requested": "Changes are requested on a pull request",
	"pull_request.commented": "Someone comments on a pull request",
	"pull_request.checks_failed": "A pull request's checks fail",
	"pull_request.conflicted": "A pull request conflicts with its base",
	"default_branch.updated": "The default branch moves",
	schedule: "On a schedule",
	"slack.mentioned": "Someone mentions the factory in Slack",
	"linear.issue.labeled": "A Linear issue is labeled",
	"linear.issue.delegated": "A Linear issue is handed to openfabriq",
	"sentry.issue.created": "Sentry reports a new error",
	"webhook.received": "A webhook is received",
};

/** An event as the end of a sentence: "an issue is labeled", "someone mentions the factory in Slack". */
export const eventPhrase = (event: string) => {
	const words = EVENT_WORDS[event] ?? event;
	return words.charAt(0).toLowerCase() + words.slice(1);
};

/** Where an MCP server of the factory runs: its address, or the command this machine runs. */
export const serverWhere = (server: McpServer) =>
	"url" in server ? server.url : `runs on this machine: ${server.command}`;

/** An output's summary without the Markdown heading marks it may start with. */
export const outputHeadline = (summary: string) =>
	summary.replace(/^#+\s+/, "");

export const ACTION_WORDS: Record<string, string> = {
	add_comment: "Comment",
	add_labels: "Add labels",
	remove_labels: "Remove labels",
	create_pull_request: "Open a pull request",
	push_to_pull_request: "Push to the pull request",
	request_changes: "Request changes",
	create_issue: "Open an issue",
	close_issue: "Close the issue",
	close_pr: "Close the pull request",
	merge_pull_request: "Merge the pull request",
};

/** Each event in two or three words, for the automation diagrams. */
export const EVENT_SHORT: Record<string, string> = {
	"issue.opened": "Issue opened",
	"issue.labeled": "Issue labeled",
	"issue.commented": "Issue comment",
	"pull_request.opened": "PR opened",
	"pull_request.updated": "PR updated",
	"pull_request.labeled": "PR labeled",
	"pull_request.changes_requested": "Changes requested",
	"pull_request.commented": "PR comment",
	"pull_request.checks_failed": "Checks failed",
	"pull_request.conflicted": "PR in conflict",
	"default_branch.updated": "Push to main",
	schedule: "Schedule",
	"slack.mentioned": "Slack mention",
	"linear.issue.labeled": "Linear label",
	"linear.issue.delegated": "Linear delegation",
	"sentry.issue.created": "Sentry error",
	"webhook.received": "Webhook",
};

/** Each output in one or two words, for the automation diagrams. */
export const ACTION_SHORT: Record<string, string> = {
	add_comment: "Comment",
	add_labels: "Label",
	remove_labels: "Unlabel",
	create_pull_request: "Open PR",
	push_to_pull_request: "Push commits",
	request_changes: "Request changes",
	create_issue: "Open issue",
	close_issue: "Close issue",
	close_pr: "Close PR",
	merge_pull_request: "Merge PR",
};

/**
 * A run started in Slack, Linear or Sentry answers there: its comment is a reply in the Slack
 * thread, a comment or labels on the Linear issue, a note on the Sentry issue. Its pull
 * requests and issues stay on GitHub.
 */
const SOURCE_OUTPUTS: Partial<Record<SourceKind, Record<string, string>>> = {
	slack: { add_comment: "Slack reply" },
	linear: {
		add_comment: "Linear comment",
		add_labels: "Linear labels",
		remove_labels: "Remove Linear labels",
	},
	sentry: { add_comment: "Sentry note" },
};

/** Whether the run writes on GitHub only: not a run from Slack, Linear or Sentry, which answers there. */
export const fromGitHub = (source?: SourceKind) =>
	!source || !SOURCE_OUTPUTS[source];

/** An output's name where its run's source writes it, if not on GitHub. */
export const sourceOutput = (action: string, source?: SourceKind) =>
	source ? SOURCE_OUTPUTS[source]?.[action] : undefined;

/** A run's output in words: "Slack reply" for a run from Slack, "Comment" for one from GitHub. */
export const outputWords = (action: string, source?: SourceKind) =>
	sourceOutput(action, source) ?? ACTION_WORDS[action] ?? action;

/** A run's output in one or two words, for its summary graph. */
export const outputShort = (action: string, source?: SourceKind) =>
	sourceOutput(action, source) ?? ACTION_SHORT[action] ?? action;

/**
 * A Markdown text as a short plain preview: its first heading as a title, and the first
 * words of its prose, without the marks (#, **, `, list bullets, link targets).
 */
export function markdownPreview(text: string): {
	title?: string;
	excerpt: string;
} {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	const heading = lines.find((l) => /^#{1,6}\s+\S/.test(l));
	const title = heading?.replace(/^#{1,6}\s+/, "").trim();
	const prose = lines
		.filter((l) => l.trim() && !/^#{1,6}\s/.test(l) && !/^```/.test(l))
		.map((l) =>
			l
				.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "")
				.replace(/^>\s?/, "")
				.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
				.replace(/[*_`]+/g, "")
				.trim(),
		)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
	const excerpt =
		prose.length > 280 ? `${prose.slice(0, 279).trimEnd()}…` : prose;
	return title ? { title, excerpt } : { excerpt };
}

/** "every Monday" → "Every Monday": a phrase that starts a line. */
export const capitalized = (text: string) =>
	text.charAt(0).toUpperCase() + text.slice(1);
