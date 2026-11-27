// Development only: the answers of the studio's API for the landing's demo, from the made-up data
// of docs-seed.ts. Walks every page of the studio a link reaches, notes each read it makes, then
// saves each answer into packages/docs/public/studio-demo/api/, with index.json mapping each path
// to its file, and one answer of the chat (chat.txt). The demo build of the studio (`pnpm --filter @openfabriq/studio build:demo`) reads
// them instead of a server. Needs `pnpm build` and the `dev-browser` CLI.
//
//   pnpm --filter @openfabriq/studio docs-demo     then `dev-browser stop`

import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const { origin, p, REPO, relay, server, token, url } = await import(
	"./docs-seed.ts"
);

const starts = [
	"overview",
	"overview?view=cost",
	"board",
	"runs",
	"agents",
	"workflow",
	"wiki",
	"learning",
	"chat",
	"settings",
].map((page) => `#/${page}${page.includes("?") ? "&" : "?"}${p}`);

// Runs in dev-browser's sandbox (QuickJS, Playwright pages), not in Node.
const script = `
const page = await browser.newPage();
await page.setViewportSize({ width: 1440, height: 900 });
const reads = new Set();
page.on("request", (r) => {
	// No URL in the sandbox: the path is what follows the origin.
	const path = r.url().slice(${JSON.stringify(origin)}.length);
	if (r.method() === "GET" && path.startsWith("/api/")) reads.add(path);
});
const queue = ${JSON.stringify(starts)};
const seen = new Set(queue);
while (queue.length && seen.size < 400) {
	const hash = queue.shift();
	await page.goto("about:blank");
	await page.goto(${JSON.stringify(url)} + hash);
	await page.waitForLoadState("networkidle");
	await page.waitForTimeout(300);
	const links = await page.$$eval("a[href^='#/']", (as) => as.map((a) => a.getAttribute("href")));
	for (const link of links) if (!seen.has(link)) { seen.add(link); queue.push(link); }
}
console.log("pages " + seen.size + ", reads " + reads.size);
await writeFile("docs-demo-reads.json", JSON.stringify([...reads]));
`;
const saved = join(homedir(), ".dev-browser/tmp/docs-demo-reads.json");
rmSync(saved, { force: true });
const browser = spawn(
	"dev-browser",
	["--headless", "--browser", "openfabriq-docs", "--timeout", "600"],
	{ stdio: ["pipe", "inherit", "inherit"] },
);
browser.stdin.end(script);
const status = await new Promise<number>((ok) => {
	browser.on("error", (error) => {
		console.error(`dev-browser: ${error.message}`);
		ok(1);
	});
	browser.on("close", (code) => ok(code ?? 1));
});

// dev-browser's sandbox may fail as it closes, once the reads are saved: the file is what counts.
if (existsSync(saved)) {
	const reads: string[] = JSON.parse(readFileSync(saved, "utf8"));
	const out = join(import.meta.dirname, "../../docs/public/studio-demo/api");
	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });
	const paths: Record<string, string> = {};
	for (const [i, path] of reads.sort().entries()) {
		const res = await fetch(origin + path, {
			headers: { cookie: `openfabriq-${new URL(origin).port}=${token}` },
		});
		if (!res.ok) continue;
		const file = `${i}.json`;
		writeFileSync(join(out, file), await res.text());
		paths[path] = file;
	}
	// The chat's answer, streamed by the seed's fake chat: the demo replays it to any question.
	const chat = await fetch(`${origin}/api/chat`, {
		method: "POST",
		headers: {
			cookie: `openfabriq-${new URL(origin).port}=${token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			project: REPO,
			threadId: crypto.randomUUID(),
			message: "What failed this week, and what should I do about it?",
		}),
	});
	if (!chat.ok) throw new Error(`The chat did not answer: ${chat.status}`);
	writeFileSync(join(out, "chat.txt"), await chat.text());
	// The demo shows the times of the runs as they were when recorded.
	writeFileSync(
		join(out, "index.json"),
		`${JSON.stringify({ recordedAt: Date.now(), chat: "chat.txt", paths }, null, "\t")}\n`,
	);
	console.log(`Saved ${Object.keys(paths).length} answers in ${out}`);
}
server.close();
relay.close();
process.exit(existsSync(saved) ? 0 : status || 1);
