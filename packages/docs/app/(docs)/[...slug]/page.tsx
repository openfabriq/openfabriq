import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { getMDXComponents } from "@/components/mdx";
import { SiteFooter } from "@/components/site-footer";
import {
	absolute,
	breadcrumbList,
	docsTitle,
	pageMetadata,
	sectionOf,
} from "@/lib/site";
import { source } from "@/lib/source";

interface Props {
	params: Promise<{ slug: string[] }>;
}

export default async function Page(props: Props) {
	const { slug } = await props.params;
	const page = source.getPage(slug);
	if (!page) notFound();

	const MDX = page.data.body;
	const section = sectionOf(page.url);
	return (
		<DocsPage
			toc={page.data.toc}
			full={page.data.full}
			footer={{ children: <SiteFooter inline /> }}
		>
			<JsonLd
				data={breadcrumbList([
					...(section && section.first !== page.url
						? [{ name: section.name, url: absolute(section.first) }]
						: []),
					{ name: page.data.title, url: absolute(page.url) },
				])}
			/>
			<DocsTitle className="text-balance text-3xl tracking-tight sm:text-4xl">
				{page.data.title}
			</DocsTitle>
			<DocsDescription className="mb-10 max-w-[35rem] text-pretty leading-relaxed">
				{page.data.description}
			</DocsDescription>
			<DocsBody>
				<MDX
					components={getMDXComponents({ a: createRelativeLink(source, page) })}
				/>
			</DocsBody>
		</DocsPage>
	);
}

export function generateStaticParams() {
	return source.generateParams();
}

export async function generateMetadata(props: Props): Promise<Metadata> {
	const { slug } = await props.params;
	const page = source.getPage(slug);
	if (!page) notFound();
	return pageMetadata({
		title: docsTitle(page.data.title, page.url),
		description: page.data.description ?? "",
		path: page.url,
	});
}
