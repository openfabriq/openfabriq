// The wiki page's logic, pure: page names, the order of the list, where a link goes.

import type { EngineRun, WikiMatch, WikiView } from "@openfabriq/runner";

export type { EngineRun, WikiMatch, WikiView };

/** "areas/payment-flows.md" → "Payment flows"; index.md → "Index". */
export function pageName(page: string): string {
	const base = (page.split("/").pop() ?? page).replace(/\.md$/i, "");
	const words = base.replace(/[-_]+/g, " ").trim();
	return words ? words[0]?.toUpperCase() + words.slice(1) : page;
}

/** A page's name: the one index.md gives it, else its file's. */
export const pageTitle = (page: string, titles: Record<string, string>) =>
	page === "index.md" ? "Overview" : (titles[page] ?? pageName(page));

/** "how-it-fits-together" → "how-it-fits-together", "The app!" → "the-app": an id for a heading. */
export const slug = (text: string) =>
	text
		.toLowerCase()
		.replace(/[`*_]/g, "")
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "");

/**
 * A page split for reading: its text, without the header for the agent, and the files of its
 * Sources section, which the page lists apart: one path per line reads as a run-on paragraph.
 */
export function splitPage(text: string): { body: string; sources: string[] } {
	const page = withoutHeader(text);
	const at = page.search(/^##\s+Sources\s*$/im);
	if (at === -1) return { body: page, sources: [] };
	const sources = page
		.slice(at)
		.split("\n")
		.slice(1)
		.map((l) =>
			l
				.replace(/^\s*[-*+]\s+/, "")
				.replace(/`/g, "")
				.trim(),
		)
		.filter(Boolean);
	return { body: page.slice(0, at).trimEnd(), sources };
}

/** The page's sections (## headings outside code), for its table of contents. */
export function sections(body: string): { text: string; id: string }[] {
	const out: { text: string; id: string }[] = [];
	let fenced = false;
	for (const line of body.split("\n")) {
		if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
		const heading = fenced ? null : /^##\s+(.+?)\s*#*\s*$/.exec(line);
		if (heading?.[1]) {
			const text = plainText(heading[1]);
			out.push({ text, id: slug(text) });
		}
	}
	return out;
}

/** The pages in the order the list shows them. */
const readingOrder = (pages: string[]) =>
	pageGroups(pages).flatMap((g) => g.pages);

/** The pages before and after this one, in reading order. */
export function neighbors(
	pages: string[],
	page: string,
): { previous?: string; next?: string } {
	const order = readingOrder(pages);
	const at = order.indexOf(page);
	if (at === -1) return {};
	const previous = order[at - 1];
	const next = order[at + 1];
	return {
		...(previous ? { previous } : {}),
		...(next ? { next } : {}),
	};
}

// The plan of the engine's wiki skill, in the order a newcomer reads it; other pages follow.
const PLAN = [
	"index.md",
	"start-here.md",
	"how-it-fits-together.md",
	"built-with.md",
	"where-things-live.md",
	"ways-in.md",
	"making-a-change.md",
	"glossary.md",
];
const rank = (page: string) => {
	const at = PLAN.indexOf(page);
	return at === -1 ? PLAN.length : at;
};

/** The pages in the order a newcomer reads them: the plan's, the others, then each folder. */
export function pageGroups(
	pages: string[],
): { folder: string | undefined; pages: string[] }[] {
	const sorted = [...pages].sort(
		(a, b) => rank(a) - rank(b) || a.localeCompare(b),
	);
	const groups = new Map<string | undefined, string[]>();
	for (const page of sorted) {
		const slash = page.lastIndexOf("/");
		const folder = slash === -1 ? undefined : page.slice(0, slash);
		groups.set(folder, [...(groups.get(folder) ?? []), page]);
	}
	return [...groups].map(([folder, pages]) => ({ folder, pages }));
}

/**
 * A line of Markdown as a reader sees it, for search results: no heading or list marks, no
 * emphasis or code ticks, links and images reduced to their text, table cells joined.
 */
export function plainText(line: string): string {
	return line
		.replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, "")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, "$1")
		.replace(/<[^>]+>/g, "")
		.replace(/(\*\*|__)(.+?)\1/g, "$2")
		.replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?![\w*])/g, "$1$2")
		.replace(/~~(.+?)~~/g, "$1")
		.replace(/`+([^`]*)`+/g, "$1")
		.replace(/^\|\s*|\s*\|$/g, "")
		.replace(/\s*\|\s*/g, " · ")
		.replace(/\s+/g, " ")
		.trim();
}

export const refreshWords = (refresh: WikiView["refresh"]) =>
	refresh === "after_merge"
		? "Updates after each merge"
		: "Updates when you ask";

/** What the page says above the wiki about its latest run, if anything. */
export type WikiNotice =
	| { kind: "asked" }
	| { kind: "queued" | "running"; id: string; since: string }
	| { kind: "merge"; pullRequest: string }
	| { kind: "failed"; id: string; reason?: string };

/**
 * The notice for the latest run: working, a pull request to merge (it ended after the commit the
 * page shows, so its pages are not there yet), or a failure. Nothing once the wiki shows its work.
 */
export function wikiNotice(
	run: EngineRun | null | undefined,
	view: WikiView,
): WikiNotice | undefined {
	if (!run) return undefined;
	if (run.state === "asked") return { kind: "asked" };
	if (run.state === "queued" || run.state === "running")
		return { kind: run.state, id: run.id, since: run.at };
	if (run.state === "failed")
		return {
			kind: "failed",
			id: run.id,
			...(run.reason ? { reason: run.reason } : {}),
		};
	// Dates, not text: git gives the commit's with its offset (+01:00), the journal in UTC.
	if (
		run.pullRequest &&
		(!view.date || Date.parse(run.at) > Date.parse(view.date))
	)
		return { kind: "merge", pullRequest: run.pullRequest };
	return undefined;
}

/** `a/b/../c` → `a/c`; undefined when it climbs above the repository's root. */
function normalize(parts: string[]): string | undefined {
	const out: string[] = [];
	for (const part of parts) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (out.length === 0) return undefined;
			out.pop();
		} else out.push(part);
	}
	return out.join("/");
}

export type WikiLink =
	| { kind: "page"; page: string; anchor?: string }
	| { kind: "anchor"; anchor: string }
	| { kind: "external"; href: string };

/** A page without its header (`commit:`, between two --- lines), which is for the wiki's agent. */
export const withoutHeader = (text: string) =>
	text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---[^\S\n]*(\r?\n|$)/, "");

/**
 * Where a link of a wiki page goes: another page stays in the studio, a file of the repository
 * opens on GitHub at the commit shown, an http(s) address opens as is. Anything else (javascript:,
 * data:, a path above the repository) is no link: the text comes from an agent.
 */
export function wikiLink(
	href: string,
	from: { page: string; view: WikiView; repository: string },
): WikiLink | undefined {
	// An empty href is what react-markdown leaves of a javascript: link.
	if (!href.trim()) return undefined;
	if (/^https?:\/\//i.test(href)) return { kind: "external", href };
	if (href.startsWith("#")) return { kind: "anchor", anchor: href.slice(1) };
	if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//"))
		return undefined;
	const [path = "", anchor] = href.split("#", 2);
	const { folder } = from.view;
	const here = from.page.split("/").slice(0, -1);
	let decoded: string;
	try {
		decoded = decodeURIComponent(path);
	} catch {
		return undefined;
	}
	const target = decoded.startsWith("/")
		? normalize(decoded.split("/"))
		: normalize([...folder.split("/"), ...here, ...decoded.split("/")]);
	if (target === undefined || target === "") return undefined;
	const inWiki = target.startsWith(`${folder}/`)
		? target.slice(folder.length + 1)
		: undefined;
	if (inWiki && from.view.pages.includes(inWiki))
		return { kind: "page", page: inWiki, ...(anchor ? { anchor } : {}) };
	return {
		kind: "external",
		href: `${githubUrl(from.repository, from.view.commit, target)}${anchor ? `#${anchor}` : ""}`,
	};
}

/** A file (blob) or folder (tree) of the repository on GitHub, at the wiki's commit. */
export const githubUrl = (
	repository: string,
	commit: string | undefined,
	path: string,
	kind: "blob" | "tree" = "blob",
) =>
	`https://github.com/${repository}/${kind}/${commit ?? "HEAD"}/${path
		.split("/")
		.map(encodeURIComponent)
		.join("/")}`;

/** What the search palette lists: pages whose name has the words, then lines of text that do. */
export type PaletteItem =
	| { kind: "page"; page: string }
	| { kind: "line"; page: string; line: number; text: string };

export function paletteItems(
	query: string,
	view: Pick<WikiView, "pages" | "titles">,
	matches: WikiMatch[],
): PaletteItem[] {
	const words = query.trim().toLowerCase();
	const order = readingOrder(view.pages);
	const named = order.filter(
		(page) =>
			!words || pageTitle(page, view.titles).toLowerCase().includes(words),
	);
	return [
		...named
			.slice(0, words ? 6 : 30)
			.map((page) => ({ kind: "page" as const, page })),
		...(words
			? matches
					// A page's own title is already listed under Pages.
					.filter(
						(m) =>
							plainText(m.text).toLowerCase() !==
							pageTitle(m.page, view.titles).toLowerCase(),
					)
					.map((m) => ({ kind: "line" as const, ...m }))
			: []),
	];
}

/** The text cut around the words searched, as typed, any case: the parts to mark. */
export function highlight(
	text: string,
	query: string,
): { text: string; match: boolean }[] {
	const words = query.trim();
	if (!words) return [{ text, match: false }];
	const lower = text.toLowerCase();
	const needle = words.toLowerCase();
	const parts: { text: string; match: boolean }[] = [];
	let from = 0;
	for (
		let at = lower.indexOf(needle);
		at !== -1;
		at = lower.indexOf(needle, from)
	) {
		if (at > from) parts.push({ text: text.slice(from, at), match: false });
		parts.push({ text: text.slice(at, at + needle.length), match: true });
		from = at + needle.length;
	}
	if (from < text.length) parts.push({ text: text.slice(from), match: false });
	return parts;
}
