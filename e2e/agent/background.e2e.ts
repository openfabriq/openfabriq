import { spawnSync } from "node:child_process";
import { claudeAgent, requestRun } from "@openfabriq/runner";
import { afterEach, beforeEach, expect, it } from "vitest";
import { settled, testEngine } from "../support/engine.js";
import { fakeGitHub } from "../support/github.js";
import { applyProject, freshHome } from "../support/home.js";

// A command the agent's shell leaves running in the background, with a real agent (haiku): once the
// run has ended, nothing the agent started may still run on the machine.

const REPO = "acme/app";
const MARKER = `openfabriq-e2e-left-${Math.random().toString(36).slice(2)}`;

const left = () =>
	spawnSync("pgrep", ["-f", MARKER], { encoding: "utf8" })
		.stdout.split("\n")
		.filter(Boolean);

beforeEach(() => {
	freshHome();
});

afterEach(() => {
	// Whatever the test finds, it leaves nothing behind.
	for (const pid of left()) process.kill(Number(pid));
});

it("leaves no process of the agent running once its run has ended", async () => {
	applyProject(REPO, {
		"factory.yaml": `name: E2E
repository: ${REPO}
maintainers: [alice]
model: haiku
`,
		"agents/starter/agent.md":
			"---\ndescription: Starts a command\ntools: [read, shell]\n---\nYou run the command asked, exactly as written, and do what the task says next.\n",
		"automations/start/automation.md": `---
when:
  schedule: { cron: "0 3 * * *" }
agent: starter
can: [create_issue]
---
Run this exact command with your shell, as written: it starts in the background and returns at once.

nohup node -e "setTimeout(() => {}, 120000)" ${MARKER} >/dev/null 2>&1 &

Then open an issue titled "Started", and finish. Do not wait for the command, and do not stop it.
`,
	});
	requestRun(REPO, {
		id: `req-${Date.now()}`,
		automation: "start",
		isPullRequest: false,
		by: "e2e",
		at: new Date().toISOString(),
	});
	const { github, writes } = fakeGitHub();
	const engine = testEngine(github, claudeAgent);
	// Seen while the run goes on: the command did start, so its absence afterwards means something.
	let seenRunning = false;
	const watch = setInterval(() => {
		if (left().length > 0) seenRunning = true;
	}, 200);
	engine.start();
	const [run] = await settled(engine, REPO, 1).finally(() =>
		clearInterval(watch),
	);
	engine.stop();
	expect(run?.status).toBe("succeeded");
	// The agent did start it: the issue says so.
	expect(writes).toEqual(["issue: Started"]);
	expect(seenRunning).toBe(true);
	expect(left()).toEqual([]);
});
