// Development only: every studio screenshot of the docs, from the made-up data of docs-seed.ts,
// saved into packages/docs/public/screenshots/studio/. Needs `pnpm build` and the `dev-browser` CLI.
//
//   pnpm --filter @openfabriq/studio docs-screenshots     then `dev-browser stop`

import { spawn } from "node:child_process";
import { copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const { p, relay, server, url } = await import("./docs-seed.ts");

// name → [page, the heading to scroll to]
const pages: Record<string, [string, string?]> = {
	overview: [`#/overview?${p}`],
	"overview-cost": [`#/overview?${p}&view=cost`],
	board: [`#/board?${p}`],
	runs: [`#/runs?${p}`],
	run: [`#/run/implement-44?${p}`],
	"run-logs": [`#/run/implement-44?${p}&tab=logs`],
	"run-outputs": [`#/run/implement-56?${p}&tab=outputs`],
	"run-slack": [`#/run/slack-export?${p}`],
	"run-linear": [`#/run/linear-eng-142?${p}`],
	"run-sentry": [`#/run/sentry-web-app-3f?${p}`],
	"run-webhook": [`#/run/webhook-deploy-failed?${p}`],
	agents: [`#/agents?${p}`],
	agent: [`#/agents/implementer?${p}`],
	workflow: [`#/workflow?${p}`],
	settings: [`#/settings?${p}`],
	"settings-connections": [`#/settings?${p}&tab=connections`],
	wiki: [`#/wiki?${p}&page=how-it-fits-together.md`],
	learning: [`#/learning?${p}`],
	lesson: [`#/learning/L2?${p}`],
};
// Only the screenshots named on the command line, when some are: `docs-screenshots wiki wiki-search`.
const only = process.argv.slice(2);
const wanted = (name: string) => only.length === 0 || only.includes(name);
for (const name of Object.keys(pages)) if (!wanted(name)) delete pages[name];

// Runs in dev-browser's sandbox (QuickJS, Playwright pages), not in Node.
const script = `
const page = await browser.newPage();
await page.setViewportSize({ width: 1440, height: 900 });
const failures = [];
page.on("pageerror", (e) => failures.push("page error: " + e.message));
for (const [name, [hash, heading]] of Object.entries(${JSON.stringify(pages)})) {
	await page.goto("about:blank");
	await page.goto(${JSON.stringify(url)} + hash);
	await page.waitForSelector("h1");
	await page.waitForLoadState("networkidle");
	if (heading)
		await page.evaluate((text) => {
			const h = [...document.querySelectorAll("h2")].find((e) => e.textContent.trim() === text);
			window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 24);
		}, heading);
	// A wiki page's diagrams draw after the page.
	if (await page.$(".wiki-diagram")) await page.waitForSelector(".wiki-diagram svg");
	await page.waitForTimeout(1000);
	if (await page.evaluate(() => document.body.innerText.includes("could not be shown")))
		failures.push(name + ": could not be shown");
	await saveScreenshot(await page.screenshot(), "docs-" + name + ".png");
	console.log("ok " + name);
}
if (${wanted("chat")}) {
	await page.goto(${JSON.stringify(url)} + "#/chat?${p}");
	const box = page.getByRole("textbox").first();
	await box.waitFor();
	await box.fill("What failed this week, and what should I do about it?");
	await box.press("Enter");
	await page.getByText("relabel #49").waitFor({ timeout: 20000 });
	await page.waitForTimeout(1500);
	await saveScreenshot(await page.screenshot(), "docs-chat.png");
	console.log("ok chat");
}
if (${wanted("wiki-search")}) {
	await page.goto("about:blank");
	await page.goto(${JSON.stringify(url)} + "#/wiki?${p}");
	await page.waitForSelector("article h1");
	await page.getByRole("button", { name: /Search the wiki/ }).click();
	await page.keyboard.type("invoice");
	await page.getByText("In the text").waitFor();
	await page.waitForTimeout(800);
	await saveScreenshot(await page.screenshot(), "docs-wiki-search.png");
	console.log("ok wiki-search");
}
if (failures.length) throw new Error(failures.join("\\n"));
`;
const names = [...Object.keys(pages), "chat", "wiki-search"].filter(wanted);
const browser = spawn(
	"dev-browser",
	["--headless", "--browser", "openfabriq-docs", "--timeout", "240"],
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
server.close();
relay.close();
if (status === 0) {
	const out = join(import.meta.dirname, "../../docs/public/screenshots/studio");
	for (const name of names)
		copyFileSync(
			join(homedir(), ".dev-browser/tmp", `docs-${name}.png`),
			join(out, `${name}.png`),
		);
	console.log(`Saved ${names.length} screenshots in ${out}`);
}
process.exit(status);
