import { engineRun, readAppliedFactory, readWiki } from "@openfabriq/runner";

/** What GET /api/wiki sends: the wiki, a run's limit, and the wiki's latest run, which the page and its button wait on. */
export async function wikiOf(repository: string) {
	const wiki = await readWiki(repository);
	return {
		wiki: wiki ?? null,
		usdPerRun: readAppliedFactory(repository)?.limits.usd_per_run,
		run: engineRun(repository, "wiki") ?? null,
	};
}
