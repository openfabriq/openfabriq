import { BookOpen, ExternalLink } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { ConfirmRun, RunButton } from "../../components/engine-run.js";
import { Empty, ErrorNote, PageSkeleton } from "../../components/feedback.js";
import { PageHeader } from "../../components/page-layout.js";
import { useApi } from "../../hooks/use-api.js";
import { useEngineRun } from "../../hooks/use-engine-run.js";
import { query } from "../../lib/api.js";
import { isBusy } from "../../lib/engine-run.js";
import { wikiHref } from "../../lib/route.js";
import type { WikiAnswer } from "../../lib/types.js";
import { SearchPalette } from "./SearchPalette.js";
import { Contents, Neighbors, PageNav, Sources } from "./WikiNav.js";
import { RunNotice } from "./WikiRun.js";
import { WikiPageText } from "./WikiText.js";
import { InlineCode, PROSE_LINK } from "./wiki-ui.js";
import {
	githubUrl,
	neighbors,
	pageGroups,
	pageTitle,
	refreshWords,
	sections,
	splitPage,
	type WikiView,
	wikiNotice,
} from "./wiki-view.js";

/** The project's wiki, read at its default branch, with a search and the Refresh button. */
export function Wiki({
	project,
	page = "index.md",
	find,
}: {
	project: string | undefined;
	page?: string | undefined;
	find?: string | undefined;
}) {
	const { justAsked, failure, confirming, setConfirming, ask } = useEngineRun(
		"/api/wiki/refresh",
		project,
	);
	const { data, error, refetch } = useApi<WikiAnswer>(
		project ? `/api/wiki${query({ project })}` : undefined,
		// Read every 3 s while a run waits or works, so the page follows it.
		(latest) => (justAsked || isBusy(latest?.run) ? 3000 : 10_000),
	);
	const busy = justAsked || isBusy(data?.run);
	// The search opens over the page, with ⌘K (Ctrl+K) like most tools.
	const [searching, setSearching] = useState(false);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				setSearching(true);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
	const view = data?.wiki ?? undefined;
	const pageExists = view?.pages.includes(page) ?? false;
	// With the commit in its address, the page is read again when the wiki moves on.
	const pageAnswer = useApi<{ text: string }>(
		project && pageExists
			? `/api/wiki/page${query({ project, path: page, commit: view?.commit })}`
			: undefined,
	);

	const header = (description?: ReactNode, action?: ReactNode) => (
		<PageHeader title="Wiki" description={description}>
			{action}
		</PageHeader>
	);
	if (!project)
		return (
			<>
				{header()}
				<Empty icon={<BookOpen />} title="Choose a project">
					A wiki belongs to a factory. Pick a project in the menu.
				</Empty>
			</>
		);
	if (error && !data)
		return (
			<>
				{header()}
				<ErrorNote>{error}</ErrorNote>
			</>
		);
	if (!data) return <PageSkeleton />;
	if (!view)
		return (
			<>
				{header()}
				<Empty icon={<BookOpen />} title="The wiki is off">
					Add <InlineCode>{"wiki: true"}</InlineCode> to{" "}
					<InlineCode>{"openfabriq/factory.yaml"}</InlineCode>, then run{" "}
					<InlineCode>{"openfabriq apply"}</InlineCode>, to have the engine keep
					a map of the code for newcomers and agents.
				</Empty>
			</>
		);

	const github = (path: string) => githubUrl(project, view.commit, path);
	const wikiIntro = <WikiIntro project={project} view={view} />;
	const notGenerated = !view.pages.includes("index.md");
	const refreshControls = (
		<>
			<RunButton
				label={notGenerated ? "Generate the wiki" : "Update the wiki"}
				busyLabel="Writing the wiki…"
				busy={busy}
				onClick={() => setConfirming(true)}
			/>
			<ConfirmRun
				open={confirming}
				title={notGenerated ? "Generate the wiki?" : "Update the wiki?"}
				text={
					notGenerated
						? `An agent reads the whole repository, writes the pages in ${view.folder}/ and opens a pull request for you to review.`
						: "An agent rewrites the pages that the latest commits made out of date, then opens a pull request for you to review."
				}
				confirm={notGenerated ? "Generate" : "Update"}
				usdPerRun={data.usdPerRun}
				onCancel={() => setConfirming(false)}
				onConfirm={() => void ask(refetch)}
			/>
		</>
	);
	const status = wikiNotice(data.run, view);
	const notice = (
		<RunNotice notice={status} project={project} failure={failure} />
	);
	const cost =
		data.usdPerRun === undefined
			? ""
			: ` A run stops once it has used $${data.usdPerRun} of Claude, this factory's limit per run; the next run picks up where it stopped.`;
	if (notGenerated)
		return (
			<>
				{header(wikiIntro, refreshControls)}
				{notice}
				{!status && !justAsked && (
					<Empty icon={<BookOpen />} title="No wiki yet">
						Generate it with the button, or run{" "}
						<InlineCode>{`openfabriq run wiki --project ${project}`}</InlineCode>{" "}
						in a terminal. The engine reads the whole repository, writes the
						pages in <InlineCode>{`${view.folder}/`}</InlineCode> and opens a
						pull request; once you merge it, the wiki shows here.{cost}
					</Empty>
				)}
			</>
		);

	const title = (p: string) => pageTitle(p, view.titles);
	const { body, sources } = pageAnswer.data
		? splitPage(pageAnswer.data.text)
		: { body: "", sources: [] };
	const contents = sections(body);
	const { previous, next } = neighbors(view.pages, page);

	return (
		<>
			{header(wikiIntro, refreshControls)}
			{notice}
			<div className="grid gap-x-8 gap-y-6 md:grid-cols-[13.5rem_minmax(0,1fr)] xl:grid-cols-[13.5rem_minmax(0,1fr)_11rem]">
				<PageNav
					project={project}
					page={page}
					groups={pageGroups(view.pages)}
					title={title}
					onSearch={() => setSearching(true)}
				/>

				<article className="panel min-w-0 px-5 py-6 sm:px-10 sm:py-9">
					<div className="mb-6 flex items-center justify-between gap-4 text-xs text-fg-3">
						<span className="min-w-0 truncate font-mono">
							{view.folder}/{page}
						</span>
						<a
							href={github(`${view.folder}/${page}`)}
							target="_blank"
							rel="noreferrer noopener"
							className="inline-flex shrink-0 items-center gap-1 text-fg-3 no-underline hover:text-fg"
						>
							View on GitHub
							<ExternalLink className="size-3" aria-hidden />
						</a>
					</div>
					{!pageExists ? (
						<p className="text-sm text-fg-2">
							No page <InlineCode>{page}</InlineCode> in the wiki.{" "}
							<a
								href={wikiHref({ project, page: "index.md" })}
								className={PROSE_LINK}
							>
								Back to the overview
							</a>
						</p>
					) : pageAnswer.error ? (
						<ErrorNote>{pageAnswer.error}</ErrorNote>
					) : pageAnswer.data ? (
						<WikiPageText
							project={project}
							page={page}
							body={body}
							view={view}
							find={find}
						/>
					) : (
						<PageSkeleton />
					)}

					{sources.length > 0 && <Sources sources={sources} github={github} />}

					{(previous || next) && (
						<Neighbors
							project={project}
							previous={previous}
							next={next}
							title={title}
						/>
					)}
				</article>

				{contents.length > 1 && <Contents contents={contents} />}
			</div>
			<SearchPalette
				project={project}
				view={view}
				open={searching}
				onClose={() => setSearching(false)}
				onPick={(to, words) => {
					setSearching(false);
					window.location.hash = wikiHref({ project, page: to, find: words });
				}}
			/>
		</>
	);
}

/** Under the title: what the wiki is, when it updates, and the commit it shows. */
function WikiIntro({ project, view }: { project: string; view: WikiView }) {
	return (
		<>
			<span className="block">
				A map of the code for newcomers and agents, kept up to date by the
				engine.
			</span>
			<span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-3">
				<span>{refreshWords(view.refresh)}</span>
				{view.date && (
					<span>
						As of{" "}
						{new Date(view.date).toLocaleDateString(undefined, {
							dateStyle: "medium",
						})}
					</span>
				)}
				{view.commit && (
					<a
						href={githubUrl(project, view.commit, view.folder, "tree")}
						target="_blank"
						rel="noreferrer noopener"
						className="inline-flex items-center gap-1 text-fg-3 no-underline hover:text-fg"
					>
						{view.folder}/ on GitHub
						<ExternalLink className="size-3" aria-hidden />
					</a>
				)}
			</span>
		</>
	);
}
