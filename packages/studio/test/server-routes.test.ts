import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	appendRun,
	projectDir,
	type RunRecord,
	readFactoryFolder,
	studioTokenPath,
	writeApplied,
} from "@openfabriq/runner";
import { afterAll, beforeAll, expect, it } from "vitest";
import { cookieName } from "../src/access/session.js";
import { startStudio } from "../src/server.js";

// Two projects, one whose applied factory no longer loads: the routes that need one project.
const REPO = "acme/task-app";
const BROKEN = "acme/broken";
const ISSUE = "https://github.com/acme/task-app/issues/9";
const PR = "https://github.com/acme/task-app/pull/7";
const LOST = "https://github.com/acme/broken/issues/3";
const temp = (name: string) => mkdtempSync(join(tmpdir(), name));
const write = (path: string, text: string) => {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
};
const git = (dir: string, ...args: string[]) =>
	execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();

let server: ReturnType<typeof startStudio>;
let empty: ReturnType<typeof startStudio>;
let base: string;
let cookie: string;
let emptyCookie: string;
let head: string;
const asked: string[] = [];

const run = (r: Partial<RunRecord> & { id: string }): RunRecord => ({
	repository: REPO,
	automation: "implement-ready-issues",
	agent: "implementer",
	event: "issue.labeled",
	isPullRequest: false,
	status: "succeeded",
	queuedAt: "2026-11-01T10:00:00.000Z",
	outputs: [],
	...r,
});

beforeAll(async () => {
	process.env.OPENFABRIQ_HOME = temp("openfabriq-home-");
	// The fixture's factory, with its wiki on.
	const files = readFactoryFolder(
		join(import.meta.dirname, "../../../fixtures/valid/sdlc/openfabriq"),
	);
	files["factory.yaml"] += "wiki: true\n";
	writeApplied(REPO, files);
	writeApplied(BROKEN, { "factory.yaml": "name: Broken\n" });
	appendRun(
		run({
			id: "run-a",
			number: 9,
			url: ISSUE,
			status: "failed",
			endedAt: "2026-11-01T10:05:00.000Z",
		}),
	);
	appendRun(
		run({
			id: "run-b",
			automation: "review-pull-requests",
			agent: "reviewer",
			event: "pull_request.opened",
			number: 7,
			isPullRequest: true,
			url: PR,
			queuedAt: "2026-11-01T11:00:00.000Z",
			endedAt: "2026-11-01T11:05:00.000Z",
			outputs: [
				{ action: "add_comment", summary: "Review", status: "applied" },
			],
		}),
	);
	appendRun(
		run({
			id: "run-c",
			repository: BROKEN,
			number: 3,
			url: LOST,
			status: "failed",
			queuedAt: "2026-11-01T12:00:00.000Z",
			endedAt: "2026-11-01T12:05:00.000Z",
		}),
	);
	// The engine's clone, with the wiki committed at the default branch's head.
	const clone = join(projectDir(REPO), "repo");
	mkdirSync(clone, { recursive: true });
	git(clone, "init", "-q", "-b", "main");
	git(clone, "config", "user.email", "t@t");
	git(clone, "config", "user.name", "t");
	write(join(clone, "wiki/index.md"), "# Index\n\n- [Payments](payments.md)\n");
	write(
		join(clone, "wiki/payments.md"),
		"# Payments\n\nCharges go through Stripe.\n",
	);
	git(clone, "add", "-A");
	git(clone, "commit", "-q", "-m", "wiki");
	head = git(clone, "rev-parse", "HEAD");
	write(
		join(projectDir(REPO), "cursor.json"),
		JSON.stringify({ branch: head }),
	);

	const app = temp("openfabriq-app-");
	writeFileSync(join(app, "index.html"), "<!doctype html><title>app</title>");
	server = startStudio(0, app, {
		subjectState: async (url) => {
			asked.push(url);
			if (url === ISSUE) return { merged: false, open: true };
			if (url === LOST) return undefined;
			return { merged: true, open: false };
		},
	});
	// Each server writes its own token to the same file.
	const serverToken = readFileSync(studioTokenPath(), "utf8");
	// An app folder without its build.
	empty = startStudio(0, temp("openfabriq-app-"));
	const emptyToken = readFileSync(studioTokenPath(), "utf8");
	await Promise.all(
		[server, empty].map((s) => new Promise((ok) => s.once("listening", ok))),
	);
	const named = (s: typeof server, token: string) =>
		`${cookieName((s.address() as AddressInfo).port)}=${token}`;
	cookie = named(server, serverToken);
	emptyCookie = named(empty, emptyToken);
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
	server.close();
	empty.close();
});

const get = async (path: string, to = base, sent = cookie) => {
	const res = await fetch(`${to}${path}`, { headers: { cookie: sent } });
	return {
		status: res.status,
		type: res.headers.get("content-type"),
		cache: res.headers.get("cache-control"),
		text: await res.text(),
	};
};
const json = async (path: string) => {
	const res = await get(path);
	return { status: res.status, body: JSON.parse(res.text) };
};

it("lists both projects", async () => {
	expect(await json("/api/projects")).toEqual({
		status: 200,
		body: [BROKEN, REPO],
	});
});

it("asks which project for the pages of one project", async () => {
	for (const route of [
		"agents",
		"settings",
		"wiki",
		"wiki/page?path=index.md",
		"wiki/search?q=Stripe",
		"workflow",
	])
		expect(await get(`/api/${route}`), route).toEqual({
			status: 400,
			type: "application/json",
			cache: "no-store",
			text: JSON.stringify({ error: "Choose a project." }),
		});
});

it("says why the applied factory no longer loads", async () => {
	for (const route of ["agents", "settings", "workflow"])
		expect(await json(`/api/${route}?project=${BROKEN}`), route).toEqual({
			status: 404,
			body: {
				error: `The factory applied to ${BROKEN} does not load: factory.yaml: repository is required. Run "openfabriq apply" again.`,
			},
		});
});

it("answers 404 for an API route it does not have, and asks which project for the conversations", async () => {
	expect(await get("/api/nothing")).toEqual({
		status: 404,
		type: "application/json",
		cache: "no-store",
		text: JSON.stringify({ error: "Not found." }),
	});
	for (const path of ["/api/chats", "/api/chats/some-id"])
		expect(await json(path), path).toEqual({
			status: 400,
			body: { error: "Choose a project." },
		});
	expect(await json("/api/chats?project=someone/else")).toEqual({
		status: 404,
		body: { error: "No project someone/else." },
	});
});

it("serves the board of every project, asking about the subjects that need someone", async () => {
	asked.length = 0;
	const { status, body } = await json("/api/board");
	expect(status).toBe(200);
	expect(asked.sort()).toEqual([LOST, ISSUE].sort());
	expect(
		body.stages.map((s: { id: string; cards: { run: { id: string } }[] }) => [
			s.id,
			s.cards.map((c) => c.run.id),
		]),
	).toEqual([
		["waiting", []],
		["working", []],
		["needs-you", ["run-c", "run-a"]],
		["done", ["run-b"]],
	]);
	expect(body.stages[2].cards[1]).toEqual({
		run: expect.objectContaining({ id: "run-a", url: ISSUE }),
		trail: [{ id: "run-a", agent: "implementer", status: "failed" }],
	});
	expect(body.agents).toEqual(
		[
			["triage", 0],
			["implementer", 2],
			["investigator", 0],
			["reviewer", 1],
			["rework", 0],
			["wiki", 0],
		].map(([name, runs]) => ({ name, working: 0, waiting: 0, runs })),
	);
	const one = await json(`/api/board?project=${BROKEN}`);
	expect(one.body.agents).toEqual([
		{ name: "implementer", working: 0, waiting: 0, runs: 1 },
	]);
});

it("answers 404 for a run it does not have", async () => {
	for (const path of ["/api/run?id=nothing", "/api/run"])
		expect(await json(path), path).toEqual({
			status: 404,
			body: { error: "No such run." },
		});
});

it("adds the subject's state to a run that asks someone to act, when it is known", async () => {
	asked.length = 0;
	const failed = await json("/api/run?id=run-a");
	expect(failed.status).toBe(200);
	expect(failed.body.story.attention).toEqual({ kind: "failed" });
	expect(failed.body.subjectState).toEqual({ merged: false, open: true });
	expect(Object.keys(failed.body)).toEqual([
		"run",
		"automationFile",
		"commands",
		"transcript",
		"story",
		"subjectState",
	]);
	const unknown = await json("/api/run?id=run-c");
	expect(unknown.body.story.attention).toEqual({ kind: "failed" });
	expect(unknown.body).not.toHaveProperty("subjectState");
	const done = await json("/api/run?id=run-b");
	expect(done.body.story).not.toHaveProperty("attention");
	expect(done.body).not.toHaveProperty("subjectState");
	expect(Object.keys(done.body)).toEqual([
		"run",
		"automationFile",
		"commands",
		"transcript",
		"story",
	]);
	// Asked about nothing: the board's questions were kept, and run-b needs no one.
	expect(asked).toEqual([]);
});

it("serves the metrics of each project, its name when its factory loads", async () => {
	const { status, body } = await json("/api/metrics?period=all");
	expect(status).toBe(200);
	expect(
		body.map((p: { repository: string; name?: string; metrics: object }) => [
			p.repository,
			p.name,
			Object.keys(p),
		]),
	).toEqual([
		[BROKEN, undefined, ["repository", "metrics"]],
		[REPO, "Task app factory", ["repository", "name", "metrics"]],
	]);
	expect(body[1].metrics.runs.total).toBe(2);
	expect(body[0].metrics.runs.total).toBe(1);
	expect(await json("/api/metrics?period=1y")).toEqual({
		status: 400,
		body: { error: "period is one of 7d, 30d, all." },
	});
});

it("serves the wiki, its pages and its search", async () => {
	expect(await json(`/api/wiki?project=${REPO}`)).toEqual({
		status: 200,
		body: {
			wiki: {
				folder: "wiki",
				refresh: "manual",
				commit: head.slice(0, 7),
				date: expect.any(String),
				pages: ["index.md", "payments.md"],
				titles: { "payments.md": "Payments" },
			},
			usdPerRun: expect.any(Number),
			run: null,
		},
	});
	expect(await json(`/api/wiki?project=${BROKEN}`)).toEqual({
		status: 200,
		body: { wiki: null, run: null },
	});
	expect(await json(`/api/wiki/page?project=${REPO}&path=payments.md`)).toEqual(
		{
			status: 200,
			body: { text: "# Payments\n\nCharges go through Stripe.\n" },
		},
	);
	for (const path of ["missing.md", "../repo/wiki/index.md", ""])
		expect(
			await json(`/api/wiki/page?project=${REPO}&path=${path}`),
			path,
		).toEqual({ status: 404, body: { error: "No such page." } });
	expect(await json(`/api/wiki/search?project=${REPO}&q=stripe`)).toEqual({
		status: 200,
		body: [
			{ page: "payments.md", line: 3, text: "Charges go through Stripe." },
		],
	});
	expect(await json(`/api/wiki/search?project=${REPO}`)).toEqual({
		status: 200,
		body: [],
	});
	expect(
		(await json(`/api/wiki/search?project=${REPO}&q=${"a".repeat(200)}`))
			.status,
	).toBe(200);
	expect(
		await json(`/api/wiki/search?project=${REPO}&q=${"a".repeat(201)}`),
	).toEqual({
		status: 400,
		body: { error: "Search 200 characters at most." },
	});
});

it("says the app is not built when its folder has no index.html", async () => {
	const to = `http://127.0.0.1:${(empty.address() as AddressInfo).port}`;
	for (const path of ["/", "/assets/main.js"])
		expect(await get(path, to, emptyCookie), path).toEqual({
			status: 503,
			type: "text/plain",
			cache: "no-store",
			text: 'The studio is not built. Run "pnpm build".',
		});
	expect((await get("/missing.js")).status).toBe(404);
	expect((await get("/missing.js")).type).toBe("text/plain");
});

/** One request as the server answers it: status, the headers every answer carries, and the body of what is not a 200. */
async function answered(
	method: string,
	path: string,
	{ signedIn = true, type }: { signedIn?: boolean; type?: string } = {},
): Promise<string> {
	const res = await fetch(`${base}${path}`, {
		method,
		redirect: "manual",
		headers: {
			...(signedIn ? { cookie } : {}),
			...(type ? { "content-type": type } : {}),
		},
	});
	const text = await res.text();
	const token = cookie.split("=")[1] ?? "";
	return [
		`${method} ${path}`,
		res.status,
		res.headers.get("content-type"),
		res.headers.get("cache-control"),
		res.headers.get("location"),
		res.headers
			.get("set-cookie")
			?.replace(token, "<token>")
			.replace(/^openfabriq-\d+=/, "openfabriq-<port>="),
		[
			res.headers.get("x-frame-options"),
			res.headers.get("content-security-policy"),
			res.headers.get("x-robots-tag"),
		].join(", "),
		res.status === 200 ? `${text.length > 0 ? "a body" : "no body"}` : text,
	]
		.filter((part) => part !== null && part !== undefined)
		.join(" | ");
}

it("answers every route, method and odd path as it always did", async () => {
	const token = cookie.split("=")[1] ?? "";
	const p = `project=${encodeURIComponent(REPO)}`;
	const requests: [string, string, { signedIn?: boolean; type?: string }?][] = [
		["GET", "/api/projects"],
		["GET", "/api/projects", { signedIn: false }],
		["GET", "/api/runs"],
		["GET", "/api/board"],
		["GET", `/api/board?${p}`],
		["GET", "/api/run?id=run-a"],
		["GET", "/api/run?id=nothing"],
		["GET", `/api/agents?${p}`],
		["GET", "/api/metrics"],
		["GET", "/api/metrics?period=1y"],
		["GET", `/api/settings?${p}`],
		["GET", `/api/wiki?${p}`],
		["GET", `/api/wiki/page?${p}&path=index.md`],
		["GET", `/api/wiki/page?${p}&path=nothing.md`],
		["GET", `/api/wiki/search?${p}&q=Stripe`],
		["GET", `/api/workflow?${p}`],
		["GET", `/api/chats?${p}`],
		["GET", `/api/chats/some-id?${p}`],
		["GET", `/api/chats/?${p}`],
		["GET", `/api/chats/a/b?${p}`],
		["GET", "/api/projects/"],
		["GET", "/api/nothing?project=someone/else"],
		["GET", "/api/%"],
		["GET", "/"],
		["GET", "/", { signedIn: false }],
		["GET", "/index.html"],
		["GET", "/missing.js"],
		["GET", "/%"],
		["GET", `/runs?token=${token}&x=1`, { signedIn: false }],
		["GET", "/api/projects?token=wrong", { signedIn: false }],
		["HEAD", "/api/board"],
		["PUT", "/api/board"],
		["POST", "/api/board"],
		["DELETE", "/api/board"],
		["PATCH", "/api/projects"],
		["POST", "/login"],
		["POST", "/api/chat"],
		["POST", "/api/chat", { signedIn: false }],
		["POST", "/api/wiki/refresh"],
		["POST", "/api/wiki/refresh", { type: "application/json" }],
		["DELETE", `/api/chats?${p}`],
		["DELETE", `/api/chats/?${p}`],
		["DELETE", `/api/chats/nothing?${p}`],
		["DELETE", `/api/chats/a/b?${p}`],
		["DELETE", "/api/chats/nothing?project=someone/else"],
	];
	const lines: string[] = [];
	for (const [method, path, options] of requests)
		lines.push(await answered(method, path, options));
	expect(lines.join("\n").replaceAll(token, "<token>")).toMatchInlineSnapshot(`
		"GET /api/projects | 200 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | a body
		GET /api/projects | 401 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | {"error":"Open the studio from the address that \\"openfabriq start\\" printed, the one with ?token=."}
		GET /api/runs | 200 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | a body
		GET /api/board | 200 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | a body
		GET /api/board?project=acme%2Ftask-app | 200 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | a body
		GET /api/run?id=run-a | 200 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | a body
		GET /api/run?id=nothing | 404 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | {"error":"No such run."}
		GET /api/agents?project=acme%2Ftask-app | 200 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | a body
		GET /api/metrics | 200 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | a body
		GET /api/metrics?period=1y | 400 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | {"error":"period is one of 7d, 30d, all."}
		GET /api/settings?project=acme%2Ftask-app | 200 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | a body
		GET /api/wiki?project=acme%2Ftask-app | 200 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | a body
		GET /api/wiki/page?project=acme%2Ftask-app&path=index.md | 200 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | a body
		GET /api/wiki/page?project=acme%2Ftask-app&path=nothing.md | 404 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | {"error":"No such page."}
		GET /api/wiki/search?project=acme%2Ftask-app&q=Stripe | 200 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | a body
		GET /api/workflow?project=acme%2Ftask-app | 200 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | a body
		GET /api/chats?project=acme%2Ftask-app | 200 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | a body
		GET /api/chats/some-id?project=acme%2Ftask-app | 404 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | {"error":"No such conversation."}
		GET /api/chats/?project=acme%2Ftask-app | 404 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | {"error":"Not found."}
		GET /api/chats/a/b?project=acme%2Ftask-app | 404 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | {"error":"Not found."}
		GET /api/projects/ | 404 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | {"error":"Not found."}
		GET /api/nothing?project=someone/else | 404 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | {"error":"No project someone/else."}
		GET /api/% | 404 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | {"error":"Not found."}
		GET / | 200 | text/html; charset=utf-8 | no-store | DENY, frame-ancestors 'none', noindex, nofollow | a body
		GET / | 401 | text/plain; charset=utf-8 | no-store | DENY, frame-ancestors 'none', noindex, nofollow | Open the studio from the address that "openfabriq start" printed, the one with ?token=.
		GET /index.html | 200 | text/html; charset=utf-8 | no-store | DENY, frame-ancestors 'none', noindex, nofollow | a body
		GET /missing.js | 404 | text/plain | no-store | DENY, frame-ancestors 'none', noindex, nofollow | Not found.
		GET /% | 400 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | {"error":"URIError: URI malformed"}
		GET /runs?token=<token>&x=1 | 303 | no-store | /runs?x=1 | openfabriq-<port>=<token>; HttpOnly; SameSite=Strict; Path=/ | DENY, frame-ancestors 'none', noindex, nofollow | 
		GET /api/projects?token=wrong | 401 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | {"error":"Open the studio from the address that \\"openfabriq start\\" printed, the one with ?token=."}
		HEAD /api/board | 405 | text/plain | no-store | DENY, frame-ancestors 'none', noindex, nofollow | 
		PUT /api/board | 405 | text/plain | no-store | DENY, frame-ancestors 'none', noindex, nofollow | Read only.
		POST /api/board | 405 | text/plain | no-store | DENY, frame-ancestors 'none', noindex, nofollow | Read only.
		DELETE /api/board | 405 | text/plain | no-store | DENY, frame-ancestors 'none', noindex, nofollow | Read only.
		PATCH /api/projects | 405 | text/plain | no-store | DENY, frame-ancestors 'none', noindex, nofollow | Read only.
		POST /login | 405 | text/plain | no-store | DENY, frame-ancestors 'none', noindex, nofollow | Read only.
		POST /api/chat | 415 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | {"error":"Send { project, message, threadId } with a non-empty message as application/json."}
		POST /api/chat | 401 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | {"error":"Open the studio from the address that \\"openfabriq start\\" printed, the one with ?token=."}
		POST /api/wiki/refresh | 415 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | {"error":"Send { project } as application/json."}
		POST /api/wiki/refresh | 400 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | {"error":"Expected JSON { project }."}
		DELETE /api/chats?project=acme%2Ftask-app | 405 | text/plain | no-store | DENY, frame-ancestors 'none', noindex, nofollow | Read only.
		DELETE /api/chats/?project=acme%2Ftask-app | 404 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | {"error":"No such conversation."}
		DELETE /api/chats/nothing?project=acme%2Ftask-app | 404 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | {"error":"No such conversation."}
		DELETE /api/chats/a/b?project=acme%2Ftask-app | 404 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | {"error":"No such conversation."}
		DELETE /api/chats/nothing?project=someone/else | 404 | application/json | no-store | DENY, frame-ancestors 'none', noindex, nofollow | {"error":"No project someone/else."}"
	`);
});

it("serves learning: its numbers, its lessons and one lesson's improvement, read-only", async () => {
	appendRun(
		run({
			id: "run-check",
			number: 9,
			url: ISSUE,
			status: "failed",
			reason: 'the check "test" failed (npm test)',
			endedAt: "2026-11-02T10:05:00.000Z",
		}),
	);
	const lesson = {
		id: "L1",
		cause: "tests are not run",
		rule: "Run the tests before you finish.",
		target: "openfabriq/agents/implementer/agent.md",
		status: "proposed",
		failures: [
			{
				id: "run-check:check",
				agent: "implementer",
				at: "2026-11-02T10:05:00.000Z",
			},
			{ id: "old:check", agent: "implementer", at: "2026-10-01T00:00:00.000Z" },
		],
		improvement: {
			url: `${PR.slice(0, -1)}12`,
			number: 12,
			run: "run-l",
			at: "2026-11-03T00:00:00.000Z",
		},
		createdAt: "2026-11-02T00:00:00.000Z",
		updatedAt: "2026-11-03T00:00:00.000Z",
	};
	write(join(projectDir(REPO), "lessons.jsonl"), `${JSON.stringify(lesson)}\n`);
	const p = `project=${encodeURIComponent(REPO)}`;
	const { status, body } = await json(`/api/learning?${p}&period=all`);
	expect(status).toBe(200);
	expect(body.learning).toBeUndefined();
	expect(body.numbers).toEqual({
		failures: 1,
		lessons: 1,
		toReview: 1,
		cameBack: 0,
	});
	expect(body.toReview.map((l: { id: string }) => l.id)).toEqual(["L1"]);
	expect(body.byAgent).toEqual({ implementer: { failures: 1, toReview: 1 } });
	const detail = await json(`/api/learning/L1?${p}`);
	expect(detail.body).toMatchObject({
		id: "L1",
		targetUrl: `https://github.com/${REPO}/blob/HEAD/openfabriq/agents/implementer/agent.md`,
		failures: [
			{ id: "run-check:check", summary: 'the check "test" failed (npm test)' },
			{ id: "old:check" },
		],
	});
	expect(await json(`/api/learning/L9?${p}`)).toEqual({
		status: 404,
		body: { error: "No such lesson." },
	});
	expect((await json(`/api/learning?${p}&period=1y`)).status).toBe(400);
});
