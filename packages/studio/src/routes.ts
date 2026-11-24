import type { IncomingMessage, ServerResponse } from "node:http";
import type { Factory, FactoryFiles } from "@openfabriq/core";
import {
	listProjects,
	loadApplied,
	MAX_SEARCH,
	notLoadedText,
	type RunRecord,
	readRuns,
	searchWiki,
	WIKI_NOT_FETCHED,
	WIKI_OFF,
	wikiPage,
} from "@openfabriq/runner";
import { agentsView } from "./agents/agents.js";
import { agentOrderByProject } from "./board/agent-order.js";
import { boardColumns, subjectsToAsk } from "./board/board.js";
import { listThreads, readThread, threadsDir } from "./chat/threads.js";
import { matchPath } from "./http/match-path.js";
import { improvementUrls, learningOf, lessonOf } from "./learning/learning.js";
import { githubPullDiff } from "./learning/pull-diff.js";
import {
	PERIODS,
	type Period,
	pullRequestUrls,
	runsInPeriod,
} from "./metrics/metrics.js";
import { projectsMetrics } from "./metrics/projects.js";
import { runWithSubjectState } from "./runs/run-detail.js";
import { settingsOf } from "./settings/settings.js";
import { ASK_NEEDED_AGAIN_MS } from "./subjects/cached-states.js";
import type { SubjectStates } from "./subjects/subject-state.js";
import { wikiOf } from "./wiki/wiki.js";
import { workflowOf } from "./workflow/workflow.js";

// Every route of the studio's API, in one place: the reads, which answer JSON, then the writes,
// which answer on their own. The server sends 404 for any other path under /api/, 405 for any
// other method.

/** What a read answers, sent as JSON. */
export interface Reply {
	status: number;
	body: unknown;
}

const ok = (body: unknown): Reply => ({ status: 200, body });
const error = (status: number, message: string): Reply => ({
	status,
	body: { error: message },
});

/** A GET under /api/, its project already checked. */
interface ReadRequest {
	url: URL;
	/** The `:name` parts of the path. */
	params: Record<string, string>;
	projects: string[];
	/** The project of `?project=`, when asked. */
	project?: string | undefined;
	runs: () => RunRecord[];
}

type ReadRoute = (request: ReadRequest) => Reply | Promise<Reply>;

/** Asks, with a cache, whether the subjects of some runs are still open. */
type AskSubjects = (
	urls: string[],
	maxAgeMs?: number,
) => Promise<SubjectStates>;

/** The period a page asks for, or its default; undefined when it asks for no period. */
const periodOf = (url: URL, fallback: Period): Period | undefined => {
	const asked = url.searchParams.get("period") ?? fallback;
	return PERIODS.find((p) => p === asked);
};

const noPeriod = () => error(400, `period is one of ${PERIODS.join(", ")}.`);

/** A page of one project: the one asked, or the only one. */
const forProject =
	(
		route: (repository: string, request: ReadRequest) => Reply | Promise<Reply>,
	): ReadRoute =>
	(request) => {
		const { projects, project } = request;
		const repository =
			project ?? (projects.length === 1 ? projects[0] : undefined);
		return repository
			? route(repository, request)
			: error(400, "Choose a project.");
	};

/** A page of a project's applied factory, loaded once: the page, or why the factory does not load. */
const ofFactory = (
	page: (
		repository: string,
		applied: { files: FactoryFiles; factory: Factory },
	) => unknown,
): ReadRoute =>
	forProject(async (repository) => {
		const applied = loadApplied(repository);
		return applied?.factory
			? ok(
					await page(repository, {
						files: applied.files,
						factory: applied.factory,
					}),
				)
			: error(404, notLoadedText(repository, applied));
	});

/** The GET routes of the API, by path. */
export function readRoutes(
	subjectStates: AskSubjects,
	/** A pull request's diff on GitHub, for learning's improvements. */
	pullDiff: (
		repository: string,
		number: number,
	) => Promise<string | undefined> = githubPullDiff,
): Record<string, ReadRoute> {
	return {
		"/api/projects": ({ projects }) => ok(projects),
		"/api/runs": ({ runs }) => ok(runs()),
		"/api/board": async ({ runs, project, projects }) => {
			const all = runs();
			const states = await subjectStates(
				subjectsToAsk(all),
				ASK_NEEDED_AGAIN_MS,
			);
			return ok(
				boardColumns(
					all,
					agentOrderByProject(project ? [project] : projects),
					states,
				),
			);
		},
		"/api/run": async ({ url, runs }) => {
			const all = runs();
			const run = all.find((r) => r.id === url.searchParams.get("id"));
			if (!run) return error(404, "No such run.");
			return ok(await runWithSubjectState(run, all, subjectStates));
		},
		"/api/agents": ofFactory((repository, { files, factory }) =>
			agentsView(repository, files, factory, new Date()),
		),
		"/api/metrics": async ({ url, projects, project, runs }) => {
			const period = periodOf(url, "7d");
			if (!period) return noPeriod();
			const repositories = project ? [project] : projects;
			const all = runs();
			const states = await subjectStates(
				pullRequestUrls(runsInPeriod(all, period, new Date())),
			);
			return ok(projectsMetrics(repositories, all, period, states));
		},
		"/api/learning": async (request) => {
			const period = periodOf(request.url, "30d");
			if (!period) return noPeriod();
			return ofFactory(async (repository, { factory }) =>
				learningOf(
					repository,
					factory,
					request.runs(),
					period,
					new Date(),
					await subjectStates(improvementUrls(repository)),
				),
			)(request);
		},
		"/api/learning/:id": async (request) => {
			const found = await ofFactory(async (repository, { factory }) =>
				lessonOf(
					repository,
					factory.maintainers,
					request.runs(),
					request.params.id ?? "",
					pullDiff,
					await subjectStates(improvementUrls(repository)),
					new Date(),
				),
			)(request);
			return found.status === 200 && found.body === undefined
				? error(404, "No such lesson.")
				: found;
		},
		"/api/settings": ofFactory((repository, { factory, files }) =>
			settingsOf(repository, factory, files["factory.yaml"]),
		),
		"/api/wiki": forProject(async (repository) => ok(await wikiOf(repository))),
		"/api/wiki/page": forProject(async (repository, { url }) => {
			const path = url.searchParams.get("path") ?? "";
			const found = await wikiPage(repository, path);
			if ("text" in found) return ok({ text: found.text });
			return error(
				404,
				found.missing === "off"
					? WIKI_OFF
					: found.missing === "not fetched"
						? WIKI_NOT_FETCHED
						: "No such page.",
			);
		}),
		"/api/wiki/search": forProject(async (repository, { url }) => {
			const q = url.searchParams.get("q") ?? "";
			if (q.length > MAX_SEARCH)
				return error(400, `Search ${MAX_SEARCH} characters at most.`);
			return ok(await searchWiki(repository, q));
		}),
		"/api/workflow": ofFactory((repository, { factory }) =>
			workflowOf(repository, factory),
		),
		"/api/chats": forProject((repository) =>
			ok(listThreads(threadsDir(repository))),
		),
		"/api/chats/:id": forProject((repository, { params }) => {
			const thread = readThread(threadsDir(repository), params.id ?? "");
			return thread ? ok(thread) : error(404, "No such conversation.");
		}),
	};
}

/** A GET under /api/: never another project's data than the one asked. */
export async function answerRead(
	url: URL,
	routes: Record<string, ReadRoute>,
): Promise<Reply> {
	const projects = listProjects().map((p) => p.repository);
	const asked = url.searchParams.get("project");
	const project = projects.find((p) => p === asked);
	if (asked !== null && !project) return error(404, `No project ${asked}.`);
	for (const [pattern, route] of Object.entries(routes)) {
		const params = matchPath(pattern, url.pathname);
		if (params)
			return route({
				url,
				params,
				projects,
				project,
				runs: () => readRuns(project),
			});
	}
	return error(404, "Not found.");
}

/** A route that writes: it reads the request and answers on its own. */
export type WriteRoute = (
	req: IncomingMessage,
	res: ServerResponse,
) => Promise<void>;

/** The routes that write, by "METHOD /path": the chat, its conversations, the wiki's button, the sign-in. */
export function writeRoutes(handlers: {
	/** Only with a password. */
	login: WriteRoute | undefined;
	chat: { post: WriteRoute; remove: WriteRoute };
	refreshWiki: WriteRoute;
}): Record<string, WriteRoute> {
	return {
		...(handlers.login ? { "POST /login": handlers.login } : {}),
		"POST /api/chat": handlers.chat.post,
		"DELETE /api/chats/*": handlers.chat.remove,
		"POST /api/wiki/refresh": handlers.refreshWiki,
	};
}

/** The write route for this method and path, if any. */
export function findWrite(
	routes: Record<string, WriteRoute>,
	method: string | undefined,
	pathname: string,
): WriteRoute | undefined {
	for (const [route, write] of Object.entries(routes)) {
		const [routeMethod, pattern = ""] = route.split(" ");
		if (routeMethod === method && matchPath(pattern, pathname)) return write;
	}
	return undefined;
}
