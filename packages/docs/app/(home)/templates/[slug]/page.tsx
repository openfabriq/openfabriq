import { createMarkdownRenderer } from "fumadocs-core/content/md";
import { rehypeCode, remarkGfm } from "fumadocs-core/mdx-plugins";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { ArrowLeft, ArrowRight, Bot, ExternalLink, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ComponentProps } from "react";
import { JsonLd } from "@/components/json-ld";
import { CopyCommand } from "@/components/landing/copy-command";
import { FullscreenImage } from "@/components/templates/fullscreen-image";
import { TemplateCard } from "@/components/templates/template-card";
import { GITHUB } from "@/lib/layout.shared";
import { absolute, breadcrumbList, pageMetadata } from "@/lib/site";
import {
	CATEGORIES,
	cardOf,
	installCommand,
	type Template,
	template,
	templates,
} from "@/lib/templates";

const { MarkdownServer } = createMarkdownRenderer({
	remarkPlugins: [remarkGfm],
	rehypePlugins: [
		[
			rehypeCode,
			{
				themes: { light: "github-light-default", dark: "github-dark-default" },
			},
		],
	],
});

export function generateStaticParams() {
	return templates().map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string }>;
}): Promise<Metadata> {
	const t = template((await params).slug);
	if (!t) return {};
	return pageMetadata({
		title: t.title,
		description: t.does,
		path: `/templates/${t.slug}/`,
	});
}

/** A README link, from where it is written (examples/<name>/) to where the reader is. */
function href(t: Template, to: string) {
	if (/^[a-z]+:/i.test(to) || to.startsWith("#")) return to;
	const sibling = to.match(/^\.\.\/\d+-([^/]+)\/?$/)?.[1];
	if (sibling) return `/templates/${sibling}/`;
	return `${GITHUB}/blob/main/examples/${t.name}/${to.replace(/^\.\//, "")}`;
}

export default async function TemplatePage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const t = template((await params).slug);
	if (!t) notFound();
	const category = CATEGORIES.find((c) => c.id === t.category);
	const others = templates().filter(
		(o) => o.category === t.category && o.name !== t.name,
	);
	// The image is the page's figure: the README's own <img> would be raw HTML here.
	const readme = t.readme.replace(/^<img src="workflow\.png"[^>]*>\s*$/m, "");
	const source = `${GITHUB}/tree/main/examples/${t.name}`;
	const workflowAlt = `The workflow of ${t.title}: the events that start it, its agents and what they write.`;

	return (
		<main className="w-full bg-of-ground pb-28">
			<JsonLd
				data={breadcrumbList([
					{ name: "Templates", url: absolute("/templates/") },
					{ name: t.title, url: absolute(`/templates/${t.slug}/`) },
				])}
			/>
			<div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
				<nav
					aria-label="Breadcrumb"
					className="flex items-center pt-10 text-sm leading-5"
				>
					<Link
						href="/templates/"
						className="group inline-flex items-center gap-1.5 text-fd-muted-foreground hover:text-fd-foreground"
					>
						<ArrowLeft
							className="size-4 transition-transform duration-300 group-hover:-translate-x-0.5"
							aria-hidden
						/>
						Templates
					</Link>
					<span className="mx-2 text-fd-muted-foreground/60" aria-hidden>
						/
					</span>
					<span className="text-fd-muted-foreground">{category?.title}</span>
				</nav>

				<header className="grid grid-cols-[minmax(0,1fr)] gap-10 pt-8 pb-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-16">
					<div>
						<h1 className="text-4xl leading-[1.04] font-semibold tracking-[-0.04em] text-balance sm:text-6xl">
							{t.title}
						</h1>
						<p className="mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-fd-muted-foreground sm:text-xl">
							{t.does}
						</p>
					</div>
					<aside className="self-start rounded-2xl border border-of-line bg-of-panel p-5 shadow-of-2 lg:sticky lg:top-[calc(var(--fd-nav-height,3.5rem)+1.5rem)] lg:row-span-2">
						<p className="text-sm font-medium">Copy it into your repository</p>
						<CopyCommand
							command={installCommand(t)}
							tone="quiet"
							wrap
							className="mt-3 text-xs"
						/>
						<p className="mt-3 text-xs leading-relaxed text-fd-muted-foreground">
							Then work through <em>Make it yours</em>, and run{" "}
							<code className="font-mono">openfabriq plan</code>.
						</p>
						<dl className="mt-5 flex flex-col gap-4 border-t border-of-line pt-5 text-sm">
							<div>
								<dt className="text-xs text-fd-muted-foreground">Starts on</dt>
								<dd className="mt-1.5 flex flex-wrap gap-1.5">
									{t.startsOn.map((s) => (
										<span
											key={s}
											className="rounded-md bg-of-sunken px-1.5 py-0.5 font-mono text-[11px]"
										>
											{s}
										</span>
									))}
								</dd>
							</div>
							<div>
								<dt className="text-xs text-fd-muted-foreground">Writes</dt>
								<dd className="mt-1">{t.writes}</dd>
							</div>
							<div>
								<dt className="sr-only">Size</dt>
								<dd className="flex gap-5 text-fd-muted-foreground">
									<span className="flex items-center gap-1.5">
										<Bot className="size-4" aria-hidden />
										{t.agents} agent{t.agents === 1 ? "" : "s"}
									</span>
									<span className="flex items-center gap-1.5">
										<Zap className="size-4" aria-hidden />
										{t.automations} automation{t.automations === 1 ? "" : "s"}
									</span>
								</dd>
							</div>
						</dl>
						<a
							href={source}
							className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-of-line py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent"
						>
							See the files on GitHub
							<ExternalLink className="size-3.5" aria-hidden />
						</a>
					</aside>

					<div className="min-w-0">
						{t.workflowWidth !== null && (
							// The button sits beside the figure: inside, the dark theme's filter would invert it.
							<div className="group relative mb-14">
								<figure className="of-diagram overflow-hidden rounded-2xl border border-zinc-200 bg-[#f3f4f6] p-6 sm:p-10">
									{/* biome-ignore lint/performance/noImgElement: a static export has no image optimizer. */}
									<img
										src={`/templates/${t.slug}/workflow.png`}
										alt={workflowAlt}
										width={t.workflowWidth}
										className="mx-auto h-auto max-w-full"
									/>
								</figure>
								<FullscreenImage
									src={`/templates/${t.slug}/workflow.png`}
									alt={workflowAlt}
									cover
								/>
							</div>
						)}
						<article className="prose max-w-none">
							<MarkdownServer
								components={{
									...defaultMdxComponents,
									a: ({ href: to = "", ...props }: ComponentProps<"a">) => (
										<a href={href(t, to)} {...props} />
									),
								}}
							>
								{readme}
							</MarkdownServer>
						</article>
					</div>
				</header>

				{others.length > 0 && (
					<section
						aria-labelledby="more"
						className="border-t border-of-line pt-16"
					>
						<div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
							<h2 id="more" className="text-2xl font-semibold tracking-tight">
								More in {category?.title}
							</h2>
							<Link
								href="/templates/"
								className="group inline-flex items-center gap-1.5 text-sm font-medium text-fd-muted-foreground transition-colors hover:text-fd-foreground"
							>
								All templates
								<ArrowRight
									className="size-4 transition-transform duration-300 group-hover:translate-x-0.5"
									aria-hidden
								/>
							</Link>
						</div>
						<div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
							{others.slice(0, 3).map((o) => (
								<TemplateCard key={o.name} t={cardOf(o)} />
							))}
						</div>
					</section>
				)}
			</div>
		</main>
	);
}
