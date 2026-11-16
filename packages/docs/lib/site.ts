import type { Metadata } from "next";
import { source } from "@/lib/source";
import { CATEGORIES, templates } from "@/lib/templates";

/** Where the site is served: OPENFABRIQ_SITE_URL for a fork, the project's own address otherwise. */
export const SITE_URL = (
	process.env.OPENFABRIQ_SITE_URL ?? "https://openfabriq.dev"
).replace(/\/$/, "");

export const SITE_NAME = "openfabriq";

/** The home page's title and description, also the site's defaults. */
export const HOME = {
	title: "openfabriq: your AI software factory, as code",
	description:
		"AI agents on your GitHub repository, described in readable files, run with Claude Code on your machine or your team's server, writing only what you allowed.",
};

/** A page's address, absolute, as the site serves it: with its trailing slash. */
export const absolute = (path: string) =>
	new URL(path.endsWith("/") ? path : `${path}/`, SITE_URL).toString();

/** The card a shared link shows, drawn by app/og/ for each page. */
export const ogImage = (path: string) =>
	`/og${path.endsWith("/") ? path : `${path}/`}image.png`;

/**
 * A page's metadata: its title and description, its one address (canonical), and the card that
 * social networks and chat apps show for a link to it. A page's openGraph replaces the layout's,
 * so every field is written here.
 */
export function pageMetadata({
	title,
	description,
	path,
}: {
	title: string;
	description: string;
	path: string;
}): Metadata {
	return {
		title,
		description,
		alternates: { canonical: absolute(path) },
		openGraph: {
			type: path === "/" ? "website" : "article",
			siteName: SITE_NAME,
			locale: "en_US",
			url: absolute(path),
			title,
			description,
			images: [{ url: ogImage(path), width: 1200, height: 630, alt: title }],
		},
	};
}

/** A documentation page's section, and the section's first page: sections have no page of their own. */
export function sectionOf(url: string) {
	for (const node of source.getPageTree().children) {
		if (node.type !== "folder") continue;
		const pages = node.children.flatMap((c) => (c.type === "page" ? [c] : []));
		if (pages.some((c) => c.url === url))
			return { name: String(node.name), first: pages[0].url };
	}
}

/**
 * A documentation page's title for the browser tab and search results: with its section when
 * another page has the same title ("Agents · Studio", "Agents · Factory"), so each is told apart.
 */
export function docsTitle(title: string, url: string) {
	const shared = source
		.getPages()
		.some((p) => p.url !== url && p.data.title === title);
	const section = shared && sectionOf(url)?.name;
	return section ? `${title} · ${section}` : title;
}

export interface SitePage {
	path: string;
	title: string;
	description: string;
	/** Where the page sits, shown on its card: "Templates", "Get started"… */
	section: string;
	lastModified?: Date;
}

/** Every page worth finding: for the sitemap and the cards. */
export function sitePages(): SitePage[] {
	return [
		{ path: "/", ...HOME, section: "Open source · Apache-2.0" },
		{
			path: "/templates/",
			title: "Templates",
			description: TEMPLATES_DESCRIPTION,
			section: "Templates",
		},
		...templates().map((t) => ({
			path: `/templates/${t.slug}/`,
			title: t.title,
			description: t.does,
			section: `Templates · ${CATEGORIES.find((c) => c.id === t.category)?.title}`,
		})),
		...source.getPages().map((p) => ({
			path: `${p.url}/`.replace(/\/+$/, "/"),
			title: p.data.title,
			description: p.data.description ?? "",
			section: sectionOf(p.url)?.name ?? "Documentation",
			lastModified: p.data.lastModified,
		})),
	];
}

export const TEMPLATES_DESCRIPTION =
	"Ready-to-use factories for openfabriq: reviews, triage, CI, dependencies, security, Slack, Sentry, site migrations. One command copies one into your repository.";

/** A page's trail from the home page, for search results: schema.org's BreadcrumbList. */
export function breadcrumbList(trail: { name: string; url: string }[]) {
	return {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [{ name: "Home", url: absolute("/") }, ...trail].map(
			(item, i) => ({
				"@type": "ListItem",
				position: i + 1,
				name: item.name,
				item: item.url,
			}),
		),
	};
}
