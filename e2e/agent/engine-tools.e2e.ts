import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FactoryFiles } from "@openfabriq/core";
import {
	claudeAgent,
	projectDir,
	type RunRecord,
	requestRun,
} from "@openfabriq/runner";
import { beforeEach, expect, it } from "vitest";
import { settled, testEngine } from "../support/engine.js";
import { fakeGitHub } from "../support/github.js";
import { applyProject, freshHome, originBranches } from "../support/home.js";
import { toolCalls } from "../support/transcript.js";

// The engine's own tools, with a real agent (haiku): the reviewer's verdict and the way back to the
// author (reviewed_by), the commit tool of an agent without a shell, and run_command. The prompts
// leave the agent no choice: what is checked is what the engine does with the calls.

const REPO = "acme/app";
let origin: string;

beforeEach(() => {
	freshHome();
});

async function runOnce(
	files: FactoryFiles,
	automation: string,
): Promise<{ run: RunRecord; writes: string[] }> {
	({ origin } = applyProject(REPO, files));
	requestRun(REPO, {
		id: `req-${Date.now()}`,
		automation,
		isPullRequest: false,
		by: "e2e",
		at: new Date().toISOString(),
	});
	const { github, writes } = fakeGitHub();
	const engine = testEngine(github, claudeAgent);
	engine.start();
	const runs = await settled(engine, REPO, 1);
	engine.stop();
	const run = runs[0];
	if (!run) throw new Error("no run");
	return { run, writes };
}

const runFile = (run: RunRecord, name: string) =>
	readFileSync(join(projectDir(REPO), "runs", run.id, name), "utf8");

/** A file of the branch the engine pushed, read on the origin; undefined when it is not there. */
function onOrigin(prefix: string, path: string): string | undefined {
	const branch = originBranches(origin).find((b) => b.startsWith(prefix));
	if (!branch) return undefined;
	try {
		return execFileSync("git", ["show", `${branch}:${path}`], {
			cwd: origin,
			encoding: "utf8",
			stdio: "pipe",
		});
	} catch {
		return undefined;
	}
}

it("sends the reviewer's needs_changes back to the author, and opens the pull request once it approves", async () => {
	const { run, writes } = await runOnce(
		{
			"factory.yaml": `name: E2E
repository: ${REPO}
maintainers: [alice]
model: haiku
`,
			"agents/writer/agent.md":
				"---\ndescription: Writes a note\ntools: [read, edit, shell]\n---\nYou make the change asked, commit it with git, and open a pull request. When a reviewer asks for changes, you make exactly the change it asks, commit it with git, and finish.\n",
			"agents/reviewer/agent.md":
				'---\ndescription: Reviews the note\ntools: [read, shell]\n---\nYou review the change by reading NOTE.md, and you call submit_review once. If NOTE.md contains the word "draft", the verdict is needs_changes, with one blocking finding: file NOTE.md, problem "the note still says draft", suggestion "replace the word draft with final". Otherwise the verdict is approved, with risk low and the summary "The note is final.".\n',
			"automations/write-note/automation.md": `---
when:
  schedule: { cron: "0 3 * * *" }
agent: writer
reviewed_by: reviewer
can: [create_pull_request]
---
Create the file NOTE.md containing the single line "draft note". Commit it with git (message "Add NOTE.md"). Then open a pull request titled "Add NOTE.md", and finish.

A reviewer reads your change when you finish. Its findings come before this task: when it asks you to change NOTE.md, change it as it says, commit with git, and finish again.
`,
		},
		"write-note",
	);
	expect(run.status).toBe("succeeded");
	const rounds = JSON.parse(runFile(run, "reviews.json")) as {
		verdict: string;
		findings: { blocking: boolean }[];
	}[];
	// The first verdict went back to the author through the stop; the last let the change out. A
	// model may need one more round to fix it: the factory allows three.
	expect(rounds[0]?.verdict).toBe("needs_changes");
	expect(rounds[0]?.findings.some((f) => f.blocking)).toBe(true);
	expect(rounds.at(-1)?.verdict).toBe("approved");
	expect(rounds.length).toBeLessThanOrEqual(3);
	// The approved verdict's risk goes on the pull request, with ready-to-merge.
	expect(writes).toEqual([
		expect.stringMatching(
			/^pull request openfabriq\/write-note-.+: Add NOTE\.md/,
		),
		"labels #7: ready-to-merge, risk:low",
	]);
	// What left is the author's fix, not its first version.
	expect(onOrigin("openfabriq/write-note-", "NOTE.md")).toMatch(/final/);
});

it("commits through the commit tool for an agent without a shell, and pushes only the files it names", async () => {
	const { run, writes } = await runOnce(
		{
			"factory.yaml": `name: E2E
repository: ${REPO}
maintainers: [alice]
model: haiku
`,
			"agents/editor/agent.md":
				"---\ndescription: Edits files without a shell\ntools: [read, edit]\n---\nYou make the change asked with your file tools, commit it with the commit tool, and open a pull request.\n",
			"automations/write-note/automation.md": `---
when:
  schedule: { cron: "0 3 * * *" }
agent: editor
can: [create_pull_request]
---
Create the file NOTE.md containing the single line "hello from the factory", and the file scratch.txt containing "scratch". Then call the commit tool with the message "Add NOTE.md" and the files ["NOTE.md"] only. Then open a pull request titled "Add NOTE.md", and finish.
`,
		},
		"write-note",
	);
	expect(run.status).toBe("succeeded");
	const commits = toolCalls(REPO, run.id).filter(
		(c) => c.name === "mcp__openfabriq__commit",
	);
	expect(commits.length).toBeGreaterThan(0);
	expect(commits.at(-1)?.error).toBe(false);
	expect(writes).toEqual([
		expect.stringMatching(
			/^pull request openfabriq\/write-note-.+: Add NOTE\.md/,
		),
	]);
	expect(onOrigin("openfabriq/write-note-", "NOTE.md")).toContain(
		"hello from the factory",
	);
	// The file it did not name was discarded: it never left the machine.
	expect(onOrigin("openfabriq/write-note-", "scratch.txt")).toBeUndefined();
});

it("runs a named command for an agent through run_command, and logs it", async () => {
	const { run, writes } = await runOnce(
		{
			"factory.yaml": `name: E2E
repository: ${REPO}
maintainers: [alice]
model: haiku
commands:
  greet: echo "greeting-from-the-engine"
`,
			"agents/diagnostician/agent.md":
				"---\ndescription: Runs the project's commands\ntools: [read, commands]\n---\nYou run the project's commands with run_command and report what they print.\n",
			"automations/greet/automation.md": `---
when:
  schedule: { cron: "0 3 * * *" }
agent: diagnostician
can: [create_issue]
---
Run the command greet with run_command. Then open an issue titled "Greeting" whose body is the output of the command, and finish.
`,
		},
		"greet",
	);
	expect(run.status).toBe("succeeded");
	const calls = toolCalls(REPO, run.id).filter(
		(c) => c.name === "mcp__openfabriq__run_command",
	);
	expect(calls.length).toBeGreaterThan(0);
	expect(calls[0]?.result).toContain("greet passed");
	expect(calls[0]?.result).toContain("greeting-from-the-engine");
	// The engine ran it itself, and kept it in the run's command log.
	const logged = runFile(run, "commands.jsonl")
		.trim()
		.split("\n")
		.map((l) => JSON.parse(l) as { kind: string; name: string; ok: boolean });
	expect(logged).toContainEqual(
		expect.objectContaining({ kind: "command", name: "greet", ok: true }),
	);
	expect(writes).toEqual(["issue: Greeting"]);
});
