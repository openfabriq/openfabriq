import { query } from "./api.js";

// No routing library: a handful of pages, read from the hash.

/** `#/run/abc?project=o/r` → { path: ["run", "abc"], params }. */
export function readHash(hash: string) {
	const [path = "", search = ""] = hash.slice(1).split("?");
	return {
		path: path.split("/").filter(Boolean).map(decodeURIComponent),
		params: new URLSearchParams(search),
	};
}

/** The link to a run's page: `#/run/<id>?project=…&tab=…`. */
export const runHref = (
	id: string,
	params: { project?: string | undefined; tab?: string | undefined } = {},
) => `#/run/${encodeURIComponent(id)}${query(params)}`;

/** The link to an agent's page: `#/agents/<name>?project=…&tab=…`. */
export const agentHref = (
	name: string,
	project: string | undefined,
	tab?: string,
) => `#/agents/${encodeURIComponent(name)}${query({ project, tab })}`;

/** The link to a tab of the factory's settings: `#/settings?project=…&tab=…`. */
export const settingsHref = (project: string | undefined, tab?: string) =>
	`#/settings${query({ project, tab })}`;

type Param = string | undefined;

/** The runs, filtered by agent and status: `#/runs?project=…&agent=…&status=…`. */
export const runsHref = (to: {
	project: Param;
	agent?: Param;
	status?: Param;
}) =>
	`#/runs${query({ project: to.project, agent: to.agent, status: to.status })}`;

/** The board, maybe one agent's lane: `#/board?project=…&agent=…`. */
export const boardHref = (to: { project: Param; agent?: Param }) =>
	`#/board${query({ project: to.project, agent: to.agent })}`;

/** The workflow, maybe seen from one area: `#/workflow?project=…&area=…`. */
export const workflowHref = (to: { project: Param; area?: Param }) =>
	`#/workflow${query({ project: to.project, area: to.area })}`;

/** The overview over a period, in one view; the caller leaves the defaults out. */
export const overviewHref = (to: {
	project: Param;
	period?: Param;
	view?: Param;
}) =>
	`#/overview${query({ project: to.project, period: to.period, view: to.view })}`;

/** A page of the wiki, maybe with the words to find on it: `#/wiki?project=…&page=…&find=…`. */
export const wikiHref = (to: { project: Param; page?: Param; find?: Param }) =>
	`#/wiki${query({ project: to.project, page: to.page, find: to.find })}`;

/** The Learning page over a period, or one lesson's improvement: `#/learning/<id>?project=…`. */
export const learningHref = (to: {
	project: Param;
	lesson?: Param;
	period?: Param;
}) =>
	`#/learning${to.lesson ? `/${encodeURIComponent(to.lesson)}` : ""}${query({ project: to.project, period: to.period })}`;

/** The page of the menu a page belongs to: a run's page is under Runs. */
export const menuPageOf = (page: string) => (page === "run" ? "runs" : page);

/** A page of the menu, for one project: `#/board?project=…`. */
export const pageHref = (page: string, project: string | undefined) =>
	`#/${page}${query({ project })}`;

/** The parameters that mean the same in every project: the overview's period and view, the runs' status. */
const KEPT_ACROSS_PROJECTS = ["period", "view", "status"] as const;

/**
 * The same page of the menu for another project, with the parameters that still mean something
 * there; an agent, a run or a wiki page belongs to its project and is left behind.
 */
export function projectSwitchHref(
	page: string,
	params: URLSearchParams,
	project: string,
): string {
	const kept = Object.fromEntries(
		KEPT_ACROSS_PROJECTS.map((name) => [name, params.get(name) ?? undefined]),
	);
	return `#/${menuPageOf(page)}${query({ project, ...kept })}`;
}

/** Whether a page waits for the list of projects before it shows: those that need it, and any without a project. */
export const waitsForProjects = (
	page: string,
	projects: string[] | undefined,
	project: string | undefined,
) =>
	(!projects &&
		["agents", "chat", "workflow", "wiki", "learning", "settings"].includes(
			page,
		)) ||
	(!project && !projects);

/** What the breadcrumb names after the page: the run or agent open, or the overview's view. */
export function crumbDetail(
	path: string[],
	params: URLSearchParams,
): string | undefined {
	const page = path[0] ?? "overview";
	if (page === "run" || page === "agents" || page === "learning")
		return path[1];
	if (page === "overview")
		return params.get("view") === "cost" ? "Cost and return" : "Productivity";
	return undefined;
}

/** The tab's title, the most precise first: `r1 · Runs · openfabriq`. */
export const pageTitle = (page: string, detail: string | undefined) =>
	[detail, page, "openfabriq"].filter(Boolean).join(" · ");

/** The project, the page, and what is open in it: each step but the last leads back up. */
export function crumbs(
	project: string | undefined,
	page: { id: string; label: string },
	detail: string | undefined,
): { label: string; href?: string }[] {
	return [
		{ label: project ?? "No project", href: pageHref("overview", project) },
		{ label: page.label, href: pageHref(page.id, project) },
		...(detail ? [{ label: detail }] : []),
	];
}

/** One project at a time: the one asked if it exists, else the last one chosen, else the first. */
export function chooseProject(
	asked: string | undefined,
	projects: string[],
	remembered: string | undefined,
): string | undefined {
	if (asked && projects.includes(asked)) return asked;
	if (remembered && projects.includes(remembered)) return remembered;
	return projects[0];
}

/** The same page, for `project`: the address the studio moves to when it chooses one. */
export function withProject(
	path: string[],
	params: URLSearchParams,
	project: string,
): string {
	const next = new URLSearchParams(params);
	next.set("project", project);
	const page = path.length
		? path.map(encodeURIComponent).join("/")
		: "overview";
	return `#/${page}?${next.toString()}`;
}
