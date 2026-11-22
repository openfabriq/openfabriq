// @vitest-environment happy-dom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../../app/src/App.js";
import { WithQueries } from "./query.js";

// The frame around every page: which project, the tab's title, the menus, what they read and how often.

const PROJECTS = ["acme/a", "acme/b"];
const BOARD = {
	stages: [
		{ id: "waiting", cards: [] },
		{ id: "working", cards: [{}, {}] },
		{ id: "needs-you", cards: [{}] },
		{ id: "done", cards: [] },
	],
	agents: [{ name: "reviewer", working: 2, waiting: 0, runs: 3 }],
};
let fetched: string[];

beforeEach(() => {
	vi.useFakeTimers();
	fetched = [];
	localStorage.clear();
	window.location.hash = "";
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path: string) => {
			fetched.push(path);
			const reply = (status: number, body: unknown) => ({
				ok: status === 200,
				status,
				statusText: "",
				json: async () => body,
			});
			if (path === "/api/projects") return reply(200, PROJECTS);
			if (path.startsWith("/api/board")) return reply(200, BOARD);
			if (path.startsWith("/api/runs")) return reply(200, []);
			return reply(404, { error: "No." });
		}),
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

/** Lets the timers run for `ms`, and every answer they ask for arrive. */
const wait = async (ms: number) => {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
};

async function show(hash: string) {
	window.location.hash = hash;
	render(<App />, { wrapper: WithQueries });
	await wait(0);
	await wait(0);
}

/** Both menus, link by link: where it goes, whether it is the page shown, and what it says. */
const menus = () =>
	[...document.querySelectorAll('nav[aria-label="Pages"] a')].map(
		(a) =>
			`${a.getAttribute("href")} ${a.getAttribute("aria-current") ?? "-"} ${a.textContent}`,
	);

it("moves to the project chosen last time, without a new entry in the history", async () => {
	localStorage.setItem("openfabriq.project", "acme/b");
	// Replaced, not pushed: the back button never returns to the address without the project.
	const replace = vi.spyOn(window.location, "replace");
	await show("#/runs");
	expect(replace.mock.calls).toEqual([["#/runs?project=acme%2Fb"]]);
	expect(window.location.hash).toBe("#/runs?project=acme%2Fb");
});

it("takes the first project when the address names one it does not know, and remembers it", async () => {
	await show("#/runs?project=nobody%2Fx&agent=reviewer");
	expect(window.location.hash).toBe("#/runs?project=acme%2Fa&agent=reviewer");
	expect(localStorage.getItem("openfabriq.project")).toBe("acme/a");
});

it("names the tab and the breadcrumb after the page and what is open in it", async () => {
	await show("#/runs?project=acme%2Fa");
	expect(document.title).toBe("Runs · openfabriq");
	cleanup();
	await show("#/run/r1?project=acme%2Fa");
	expect(document.title).toBe("r1 · Runs · openfabriq");
	expect(
		document.querySelector('nav[aria-label="Breadcrumb"]')?.textContent,
	).toBe("acme/aRunsr1");
	cleanup();
	await show("#/overview?project=acme%2Fa&view=cost");
	expect(document.title).toBe("Cost and return · Overview · openfabriq");
});

it("links every page of both menus to the project shown, the board with what works and what needs you", async () => {
	await show("#/run/r1?project=acme%2Fa");
	expect(menus()).toMatchInlineSnapshot(`
		[
		  "#/overview?project=acme%2Fa - Overview",
		  "#/board?project=acme%2Fa - Board21",
		  "#/runs?project=acme%2Fa page Runs",
		  "#/agents?project=acme%2Fa - Agents",
		  "#/workflow?project=acme%2Fa - Workflow",
		  "#/wiki?project=acme%2Fa - Wiki",
		  "#/learning?project=acme%2Fa - Learning",
		  "#/settings?project=acme%2Fa - Factory settings",
		  "#/chat?project=acme%2Fa - Chat",
		  "#/overview?project=acme%2Fa - Overview",
		  "#/board?project=acme%2Fa - Board",
		  "#/runs?project=acme%2Fa page Runs",
		  "#/agents?project=acme%2Fa - Agents",
		  "#/workflow?project=acme%2Fa - Workflow",
		  "#/wiki?project=acme%2Fa - Wiki",
		  "#/learning?project=acme%2Fa - Learning",
		  "#/settings?project=acme%2Fa - Factory settings",
		  "#/chat?project=acme%2Fa - Chat",
		]
	`);
	expect(screen.getByTitle("2 working")).toBeTruthy();
	expect(screen.getByTitle("1 need you")).toBeTruthy();
});

it("goes to the same page of another project, keeping the overview's period", async () => {
	await show("#/overview?project=acme%2Fa&period=30d");
	const [select] = screen.getAllByRole("combobox", { name: "Project" });
	if (!select) throw new Error("no project select");
	fireEvent.change(select, { target: { value: "acme/b" } });
	expect(window.location.hash).toBe("#/overview?project=acme%2Fb&period=30d");
});

/** The sidebar's theme button, by what it says now. */
const themeButton = (theme: string) => {
	const [button] = screen.getAllByRole("button", { name: `Theme: ${theme}` });
	if (!button) throw new Error(`no button for the ${theme} theme`);
	return button;
};

/** A system set to dark mode. */
const systemDark = () =>
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({
			matches: true,
			addEventListener: () => {},
			removeEventListener: () => {},
		})),
	);

it("opens light with nothing saved, even when the system is dark", async () => {
	systemDark();
	await show("#/runs?project=acme%2Fa");
	expect(themeButton("light")).toBeTruthy();
	expect(document.documentElement.dataset.theme).toBe("light");
	for (const meta of document.querySelectorAll('meta[name="theme-color"]'))
		expect(meta.getAttribute("content")).toBe("#f9fafb");
});

it("turns the theme from light to dark, the system's, and back, and keeps the choice across a reload", async () => {
	systemDark();
	await show("#/runs?project=acme%2Fa");
	fireEvent.click(themeButton("light"));
	await wait(0);
	expect(document.documentElement.dataset.theme).toBe("dark");
	expect(localStorage.getItem("openfabriq-theme")).toBe("dark");
	fireEvent.click(themeButton("dark"));
	await wait(0);
	// The system's theme is saved by name: an empty key now means light.
	expect(localStorage.getItem("openfabriq-theme")).toBe("system");
	expect(document.documentElement.dataset.theme).toBe("dark");
	cleanup();
	await show("#/runs?project=acme%2Fa");
	expect(themeButton("system")).toBeTruthy();
	expect(document.documentElement.dataset.theme).toBe("dark");
	fireEvent.click(themeButton("system"));
	await wait(0);
	expect(document.documentElement.dataset.theme).toBe("light");
	expect(localStorage.getItem("openfabriq-theme")).toBe("light");
});

it("keeps a dark theme saved before", async () => {
	localStorage.setItem("openfabriq-theme", "dark");
	await show("#/runs?project=acme%2Fa");
	expect(themeButton("dark")).toBeTruthy();
	expect(document.documentElement.dataset.theme).toBe("dark");
});

it("reads the projects and the boards at their own pace", async () => {
	await show("#/runs?project=acme%2Fa");
	fetched.length = 0;
	await wait(30_000);
	const counts: Record<string, number> = {};
	for (const path of fetched) counts[path] = (counts[path] ?? 0) + 1;
	expect(counts).toMatchInlineSnapshot(`
		{
		  "/api/board": 1,
		  "/api/board?project=acme%2Fa": 6,
		  "/api/projects": 6,
		  "/api/runs?project=acme%2Fa": 6,
		}
	`);
});
