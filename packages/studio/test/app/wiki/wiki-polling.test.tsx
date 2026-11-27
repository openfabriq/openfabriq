// @vitest-environment happy-dom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Wiki } from "../../../app/src/features/wiki/Wiki.js";
import type { EngineRun } from "../../../app/src/features/wiki/wiki-view.js";
import { WithQueries } from "../query.js";

// How often the wiki page reads /api/wiki: every 10 s, every 3 s while a run waits or works.

let run: EngineRun | null;
let reads = 0;
const posts: string[] = [];

beforeEach(() => {
	vi.useFakeTimers();
	reads = 0;
	posts.length = 0;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path: string, init?: RequestInit) => {
			if (init?.method === "POST") {
				posts.push(path);
				return { ok: true, json: async () => ({}) };
			}
			if (path.startsWith("/api/wiki?")) reads++;
			return {
				ok: true,
				json: async () => ({
					wiki: { folder: "wiki", refresh: "manual", pages: [], titles: {} },
					usdPerRun: 2,
					run,
				}),
			};
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

it("reads the wiki every 10 s while nothing runs", async () => {
	run = null;
	render(<Wiki project="acme/shop" />, { wrapper: WithQueries });
	await wait(0);
	expect(reads).toBe(1);
	await wait(9999);
	expect(reads).toBe(1);
	await wait(1);
	expect(reads).toBe(2);
	await wait(10_000);
	expect(reads).toBe(3);
});

it("reads it every 3 s while its run waits or works, then every 10 s again", async () => {
	run = { state: "running", id: "w1", at: "2026-11-03T10:00:00.000Z" };
	render(<Wiki project="acme/shop" />, { wrapper: WithQueries });
	await wait(0);
	// The first answer says a run works: the page reads every 3 s.
	expect(reads).toBe(1);
	await wait(3000);
	expect(reads).toBe(2);
	await wait(3000);
	expect(reads).toBe(3);
	run = { state: "succeeded", id: "w1", at: "2026-11-03T10:05:00.000Z" };
	await wait(3000);
	// Over: every 10 s from that answer on.
	expect(reads).toBe(4);
	await wait(9999);
	expect(reads).toBe(4);
	await wait(1);
	expect(reads).toBe(5);
});

it("reads it every 3 s from the moment a person asks for a run", async () => {
	run = null;
	render(<Wiki project="acme/shop" />, { wrapper: WithQueries });
	await wait(0);
	expect(reads).toBe(1);
	run = { state: "asked" };
	fireEvent.click(screen.getByRole("button", { name: "Generate the wiki" }));
	fireEvent.click(
		screen.getByRole("button", { name: "Generate", hidden: true }),
	);
	await wait(0);
	expect(posts).toEqual(["/api/wiki/refresh"]);
	// Read again once the server took the request, then every 3 s.
	expect(reads).toBe(2);
	await wait(3000);
	expect(reads).toBe(3);
	await wait(3000);
	expect(reads).toBe(4);
});

it("keeps the button off until the server answers with the run it was asked for", async () => {
	run = null;
	let answerPost: () => void = () => {};
	const reply = (body: unknown) => ({ ok: true, json: async () => body });
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path: string, init?: RequestInit) => {
			if (init?.method === "POST") {
				posts.push(path);
				// The server knows of the request only once it answers the POST.
				return new Promise((ok) => {
					answerPost = () => {
						run = { state: "asked" };
						ok(reply({}));
					};
				});
			}
			return reply({
				wiki: { folder: "wiki", refresh: "manual", pages: [], titles: {} },
				usdPerRun: 2,
				run,
			});
		}),
	);
	render(<Wiki project="acme/shop" />, { wrapper: WithQueries });
	await wait(0);
	fireEvent.click(screen.getByRole("button", { name: "Generate the wiki" }));
	fireEvent.click(
		screen.getByRole("button", { name: "Generate", hidden: true }),
	);
	// A read answers before the server knows of the request: the button stays off.
	await wait(0);
	const writing = () =>
		screen.getByRole("button", {
			name: "Writing the wiki…",
		}) as HTMLButtonElement;
	expect(writing().disabled).toBe(true);
	await act(async () => answerPost());
	await wait(0);
	expect(writing().disabled).toBe(true);
	expect(posts).toEqual(["/api/wiki/refresh"]);
});
