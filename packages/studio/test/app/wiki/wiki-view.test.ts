import { expect, it } from "vitest";
import {
	highlight,
	neighbors,
	pageGroups,
	pageName,
	pageTitle,
	paletteItems,
	plainText,
	sections,
	splitPage,
	type WikiView,
	wikiLink,
	wikiNotice,
	withoutHeader,
} from "../../../app/src/features/wiki/wiki-view.js";
import { isBusy } from "../../../app/src/lib/engine-run.js";

const view: WikiView = {
	folder: "docs/wiki",
	refresh: "manual",
	commit: "3f2a9c1",
	pages: ["index.md", "glossary.md", "areas/payments.md", "areas/users.md"],
	titles: { "areas/payments.md": "Payments and SEPA" },
};
const link = (href: string, page = "areas/payments.md") =>
	wikiLink(href, { page, view, repository: "acme/shop" });

it("names a page from its file", () => {
	expect(pageName("areas/payment-flows.md")).toBe("Payment flows");
	expect(pageName("index.md")).toBe("Index");
});

it("lists the index first, then the top-level pages, then each folder", () => {
	expect(pageGroups(view.pages)).toEqual([
		{ folder: undefined, pages: ["index.md", "glossary.md"] },
		{ folder: "areas", pages: ["areas/payments.md", "areas/users.md"] },
	]);
});

it("keeps a link to another page in the studio", () => {
	expect(link("users.md")).toEqual({ kind: "page", page: "areas/users.md" });
	expect(link("../glossary.md#charge")).toEqual({
		kind: "page",
		page: "glossary.md",
		anchor: "charge",
	});
	expect(link("#flow")).toEqual({ kind: "anchor", anchor: "flow" });
});

it("opens a file of the repository on GitHub, at the commit shown", () => {
	expect(link("../../../src/pay.ts")).toEqual({
		kind: "external",
		href: "https://github.com/acme/shop/blob/3f2a9c1/src/pay.ts",
	});
	expect(link("missing.md")).toEqual({
		kind: "external",
		href: "https://github.com/acme/shop/blob/3f2a9c1/docs/wiki/areas/missing.md",
	});
	expect(link("https://stripe.com/docs")).toEqual({
		kind: "external",
		href: "https://stripe.com/docs",
	});
});

it("makes no link of anything else: the page comes from an agent", () => {
	expect(link("javascript:alert(1)")).toBeUndefined();
	expect(link("JaVaScRiPt:alert(1)")).toBeUndefined();
	expect(link("data:text/html,x")).toBeUndefined();
	expect(link("//evil.example/x")).toBeUndefined();
	expect(link("../../../../../etc/passwd")).toBeUndefined();
	expect(link("%E0%A4%A")).toBeUndefined();
	expect(link("")).toBeUndefined();
});

it("orders the pages like the wiki skill's plan, then the others", () => {
	expect(
		pageGroups(["zebra.md", "glossary.md", "start-here.md", "index.md"])[0]
			?.pages,
	).toEqual(["index.md", "start-here.md", "glossary.md", "zebra.md"]);
});

it("drops the header the wiki's agent reads, and only a header", () => {
	expect(withoutHeader("---\ncommit: 3f2a9c1\n---\n\n# Shop\n")).toBe(
		"\n# Shop\n",
	);
	expect(withoutHeader("# Shop\n\n---\n\nmore\n")).toBe(
		"# Shop\n\n---\n\nmore\n",
	);
});

it("says where the latest run stands, and when nobody can start another one", () => {
	const shown = { ...view, date: "2026-11-06T10:00:00Z" };
	expect(wikiNotice(null, shown)).toBeUndefined();
	expect(wikiNotice({ state: "asked" }, shown)).toEqual({ kind: "asked" });
	expect(
		wikiNotice(
			{ state: "running", id: "w1", at: "2026-11-06T11:00:00Z" },
			shown,
		),
	).toEqual({ kind: "running", id: "w1", since: "2026-11-06T11:00:00Z" });
	const ended = {
		state: "succeeded" as const,
		id: "w1",
		pullRequest: "https://github.com/acme/shop/pull/7",
	};
	expect(wikiNotice({ ...ended, at: "2026-11-06T11:00:00Z" }, shown)).toEqual({
		kind: "merge",
		pullRequest: "https://github.com/acme/shop/pull/7",
	});
	// The commit's date comes with its offset: 11:30+01:00 is 10:30Z, before the run.
	expect(
		wikiNotice(
			{ ...ended, at: "2026-11-06T10:40:00Z" },
			{ ...view, date: "2026-11-06T11:30:00+01:00" },
		),
	).toEqual({
		kind: "merge",
		pullRequest: "https://github.com/acme/shop/pull/7",
	});
	// Merged: the commit shown comes after the run.
	expect(
		wikiNotice({ ...ended, at: "2026-11-06T09:00:00Z" }, shown),
	).toBeUndefined();
	expect(
		wikiNotice(
			{
				state: "failed",
				id: "w2",
				at: "2026-11-06T11:00:00Z",
				reason: "usd_per_run reached",
			},
			shown,
		),
	).toEqual({ kind: "failed", id: "w2", reason: "usd_per_run reached" });
	expect(isBusy({ state: "asked" })).toBe(true);
	expect(isBusy({ state: "queued", id: "w", at: "" })).toBe(true);
	expect(isBusy({ ...ended, at: "" })).toBe(false);
	expect(isBusy(null)).toBe(false);
});

it("shows a search result as a reader sees it, without Markdown", () => {
	expect(plainText("# Task app")).toBe("Task app");
	expect(
		plainText(
			"- [lib/tasks.ts](../../lib/tasks.ts): `Task` type, lazy `getDb()` creating table `tasks`",
		),
	).toBe("lib/tasks.ts: Task type, lazy getDb() creating table tasks");
	expect(
		plainText(
			"- **Task**: `{id, title, done}`, in [lib/tasks.ts](../lib/tasks.ts).",
		),
	).toBe("Task: {id, title, done}, in lib/tasks.ts.");
	expect(
		plainText(
			"| SQLite via `node:sqlite` | Node >= 22.13 | [lib/tasks.ts](../lib/tasks.ts) |",
		),
	).toBe("SQLite via node:sqlite · Node >= 22.13 · lib/tasks.ts");
	expect(plainText("1. Run *pnpm test* then ~~npm~~ <b>pnpm</b>")).toBe(
		"Run pnpm test then npm pnpm",
	);
	expect(plainText("snake_case_name stays")).toBe("snake_case_name stays");
	expect(plainText("> a quote")).toBe("a quote");
});

it("names a page as the index links it, the index itself Overview", () => {
	expect(pageTitle("areas/payments.md", view.titles)).toBe("Payments and SEPA");
	expect(pageTitle("areas/users.md", view.titles)).toBe("Users");
	expect(pageTitle("index.md", view.titles)).toBe("Overview");
});

it("lists a page's sources apart, one file each, whatever their marks", () => {
	expect(
		splitPage(
			"---\ncommit: a\n---\n# Task app\n\nText.\n\n## Sources\n\nlib/tasks.ts\n- `app/page.tsx`\n* app/actions.ts\n",
		),
	).toEqual({
		body: "# Task app\n\nText.",
		sources: ["lib/tasks.ts", "app/page.tsx", "app/actions.ts"],
	});
	expect(splitPage("# No sources\n")).toEqual({
		body: "# No sources\n",
		sources: [],
	});
});

it("finds a page's sections, not the ## inside code", () => {
	expect(
		sections(
			"# Title\n## The app\n```\n## not a heading\n```\n## The **factory**\n",
		),
	).toEqual([
		{ text: "The app", id: "the-app" },
		{ text: "The factory", id: "the-factory" },
	]);
});

it("gives the pages before and after, in reading order", () => {
	expect(neighbors(view.pages, "glossary.md")).toEqual({
		previous: "index.md",
		next: "areas/payments.md",
	});
	expect(neighbors(view.pages, "index.md")).toEqual({ next: "glossary.md" });
	expect(neighbors(view.pages, "areas/users.md")).toEqual({
		previous: "areas/payments.md",
	});
});

it("lists in the palette the pages by name, then the lines of text", () => {
	expect(paletteItems("", view, [])).toEqual([
		{ kind: "page", page: "index.md" },
		{ kind: "page", page: "glossary.md" },
		{ kind: "page", page: "areas/payments.md" },
		{ kind: "page", page: "areas/users.md" },
	]);
	expect(
		paletteItems("SEPA", view, [
			{ page: "glossary.md", line: 4, text: "SEPA: a bank transfer" },
			{ page: "areas/payments.md", line: 1, text: "# Payments and SEPA" },
		]),
	).toEqual([
		{ kind: "page", page: "areas/payments.md" },
		{
			kind: "line",
			page: "glossary.md",
			line: 4,
			text: "SEPA: a bank transfer",
		},
	]);
});

it("marks the words searched in a line, any case", () => {
	expect(
		highlight("Charges go through Stripe; stripe again", "stripe"),
	).toEqual([
		{ text: "Charges go through ", match: false },
		{ text: "Stripe", match: true },
		{ text: "; ", match: false },
		{ text: "stripe", match: true },
		{ text: " again", match: false },
	]);
	expect(highlight("nothing", "")).toEqual([{ text: "nothing", match: false }]);
});
