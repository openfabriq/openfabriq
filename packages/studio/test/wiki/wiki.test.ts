import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	projectDir,
	readFactoryFolder,
	studioTokenPath,
	writeApplied,
} from "@openfabriq/runner";
import { afterAll, beforeAll, expect, it } from "vitest";
import { cookieName } from "../../src/access/session.js";
import { startStudio } from "../../src/server.js";

const REPO = "acme/task-app";
let server: ReturnType<typeof startStudio>;
let port: number;
let token: string;
let wakes = 0;

beforeAll(async () => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
	// The fixture's factory, with its wiki on.
	const files = readFactoryFolder(
		join(import.meta.dirname, "../../../../fixtures/valid/sdlc/openfabriq"),
	);
	files["factory.yaml"] += "wiki: true\n";
	writeApplied(REPO, files);
	const app = mkdtempSync(join(tmpdir(), "openfabriq-app-"));
	writeFileSync(join(app, "index.html"), "<!doctype html>");
	server = startStudio(0, app, { wake: () => wakes++ });
	await new Promise((ok) => server.once("listening", ok));
	port = (server.address() as AddressInfo).port;
	token = readFileSync(studioTokenPath(), "utf8");
});
afterAll(() => {
	server.close();
});

function refresh(
	headers: Record<string, string> = {},
	body: unknown = { project: REPO },
): Promise<{ status: number; text: string }> {
	return new Promise((ok, ko) => {
		const req = request(
			{
				host: "127.0.0.1",
				port,
				method: "POST",
				path: "/api/wiki/refresh",
				headers: {
					host: `127.0.0.1:${port}`,
					cookie: `${cookieName(port)}=${token}`,
					"content-type": "application/json",
					...headers,
				},
			},
			(res) => {
				let text = "";
				res.on("data", (c) => {
					text += c;
				});
				res.on("end", () => ok({ status: res.statusCode ?? 0, text }));
			},
		);
		req.on("error", ko);
		req.end(JSON.stringify(body));
	});
}

const requests = () => {
	const dir = join(projectDir(REPO), "requests");
	try {
		return readdirSync(dir).map((f) =>
			JSON.parse(readFileSync(join(dir, f), "utf8")),
		);
	} catch {
		return [];
	}
};

it("shows the wiki's settings before it exists", async () => {
	const res = await fetch(`http://127.0.0.1:${port}/api/wiki?project=${REPO}`, {
		headers: { cookie: `${cookieName(port)}=${token}` },
	});
	expect(await res.json()).toEqual({
		wiki: { folder: "wiki", refresh: "manual", pages: [], titles: {} },
		usdPerRun: expect.any(Number),
		run: null,
	});
});

it("refuses a refresh that does not come from the studio's own page", async () => {
	expect((await refresh({ origin: "https://evil.example" })).status).toBe(403);
	expect((await refresh({ "content-type": "text/plain" })).status).toBe(415);
	expect((await refresh({ cookie: "" })).status).toBe(401);
	expect((await refresh({}, { project: "acme/other" })).status).toBe(404);
	expect(requests()).toEqual([]);
	expect(wakes).toBe(0);
});

it("asks the engine for one wiki run, like openfabriq run wiki, and not a second one", async () => {
	expect((await refresh()).status).toBe(202);
	expect(requests()).toEqual([
		expect.objectContaining({ automation: "wiki", by: "studio" }),
	]);
	// The engine takes it now, not at its next reading of GitHub.
	expect(wakes).toBe(1);
	// A reload of the page knows: the button stays off.
	const res = await fetch(`http://127.0.0.1:${port}/api/wiki?project=${REPO}`, {
		headers: { cookie: `${cookieName(port)}=${token}` },
	});
	expect((await res.json()).run).toEqual({ state: "asked" });
	const again = await refresh();
	expect(again.status).toBe(409);
	expect(again.text).toContain("already being updated");
	expect(requests()).toHaveLength(1);
	expect(wakes).toBe(1);
});
