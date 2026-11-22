import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectDir, recordRefusals, skillHash } from "@openfabriq/runner";
import { expect, it } from "vitest";
import { doctorCommand } from "../../src/commands/doctor.js";

const examples = join(import.meta.dirname, "../../../../examples");

/** A machine where claude, gh and git are ready, and only the programs named exist. */
const machine =
	(programs: string[]) => async (command: string, args: string[]) => {
		if (command === "sh" && !programs.includes(args.at(-1) ?? ""))
			throw new Error("sh: exit 1");
		return "";
	};

it("says which program of the factory is missing, and which lines run it", async () => {
	const result = await doctorCommand(
		join(examples, "25-wordpress-maintenance"),
		machine(["find"]),
		"darwin",
	);
	expect(result.code).toBe(1);
	expect(result.output).toContain(
		"✗ composer is not installed: setup, command outdated and command update run it",
	);
	expect(result.output).toContain("✓ found find");
	expect(result.output).not.toContain("bubblewrap");
});

it("says a skill is ready when every program it installs is there, without repeating its needs", async () => {
	const result = await doctorCommand(
		join(examples, "02-sdlc"),
		machine(["npm", "agent-browser"]),
		"darwin",
	);
	expect(result.code).toBe(0);
	expect(result.output).toContain(
		"✓ skills/browser-evidence: agent-browser is installed",
	);
	expect(result.output).not.toContain("! skills/browser-evidence");
	expect(result.output).toContain("This machine has the programs");
});

it("looks up the program a skill installs, and fails without it", async () => {
	const result = await doctorCommand(
		join(examples, "09-ui-check"),
		machine(["pnpm"]),
		"darwin",
	);
	expect(result.code).toBe(1);
	expect(result.output).toContain(
		"✗ agent-browser is not installed: skills/browser-evidence runs it",
	);
	// Missing: the skill's own words say how to install it.
	expect(result.output).toContain(
		"! skills/browser-evidence: Needs agent-browser and Playwright's headless Chrome",
	);
});

it("checks the Linux sandbox's tools on Linux", async () => {
	const result = await doctorCommand(
		join(examples, "02-sdlc"),
		machine(["npm", "agent-browser", "bwrap"]),
		"linux",
	);
	expect(result.code).toBe(1);
	expect(result.output).toContain(
		"✗ The sandbox of the agents' shell and the commands needs socat and ripgrep: sudo apt install socat ripgrep",
	);
});

it("checks the machine alone outside a factory", async () => {
	const result = await doctorCommand(
		mkdtempSync(join(tmpdir(), "openfabriq-doctor-")),
		machine([]),
		"darwin",
	);
	expect(result.code).toBe(1);
	expect(result.output).toContain(
		"✓ Claude Code, the GitHub CLI and git are ready",
	);
	expect(result.output).toContain("No factory in");
});

it("names a secret the factory declares and this machine does not have, without failing", async () => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
	const result = await doctorCommand(
		join(examples, "23-sentry-autofix"),
		machine(["pnpm", "agent-browser"]),
		"darwin",
	);
	expect(result.code).toBe(0);
	expect(result.output).toContain(
		'! acme/web-app: MCP_SENTRY_TOKEN not set on this machine; the commands or MCP servers that need it will fail. Set it with "openfabriq secret set MCP_SENTRY_TOKEN"',
	);
});

it("names the sites the factory calls and its network does not reach, and those its last runs were refused", async () => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
	const repo = mkdtempSync(join(tmpdir(), "openfabriq-doctor-"));
	mkdirSync(join(repo, "openfabriq/agents/worker"), { recursive: true });
	mkdirSync(join(repo, "openfabriq/automations/go"), { recursive: true });
	writeFileSync(
		join(repo, "openfabriq/factory.yaml"),
		"name: F\nrepository: acme/app\nmaintainers: [alice]\ncommands:\n  pay: curl https://api.stripe.com/v1/x\n",
	);
	writeFileSync(
		join(repo, "openfabriq/agents/worker/agent.md"),
		"---\ndescription: Works\ntools: [read, commands]\n---\nWork.\n",
	);
	writeFileSync(
		join(repo, "openfabriq/automations/go/automation.md"),
		"---\nwhen: issue.opened\nagent: worker\n---\nGo.\n",
	);
	const run = join(projectDir("acme/app"), "runs", "run-1");
	mkdirSync(run, { recursive: true });
	recordRefusals(run, "command", ["hooks.slack.com"]);
	const result = await doctorCommand(repo, machine(["curl"]), "darwin");
	expect(result.code).toBe(0);
	expect(result.output).toContain(
		"! api.stripe.com is in command pay, but network does not reach it: add it to network if the factory calls it",
	);
	expect(result.output).toContain(
		"! hooks.slack.com was refused in 1 of the last runs (latest: run-1): add it to network if the factory needs it",
	);
});

it("says the network reaches every site a template calls", async () => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
	const result = await doctorCommand(
		join(examples, "25-wordpress-maintenance"),
		machine(["composer", "find", "php", "curl", "xargs"]),
		"darwin",
	);
	expect(result.output).toContain(
		"✓ network reaches every site the factory names, and no site was refused in its last runs",
	);
});

it("as a GitHub App, says whether it is installed on the factory's repository", async () => {
	const app = (installed: boolean) => ({
		login: async () => "openfabriq-acme[bot]",
		installed: async () => installed,
		installUrl: async () =>
			"https://github.com/apps/openfabriq-acme/installations/new",
	});
	const dir = join(examples, "02-sdlc");
	const there = await doctorCommand(
		dir,
		machine(["npm", "agent-browser"]),
		"darwin",
		app(true),
	);
	expect(there.code).toBe(0);
	expect(there.output).toMatch(
		/✓ GitHub: the engine works as the app openfabriq-acme\[bot\], installed on \S+\/\S+/,
	);
	const missing = await doctorCommand(
		dir,
		machine(["npm", "agent-browser"]),
		"darwin",
		app(false),
	);
	expect(missing.code).toBe(1);
	expect(missing.output).toContain("is not installed on");
	expect(missing.output).toContain(
		"install it at https://github.com/apps/openfabriq-acme/installations/new",
	);
});

it("says an imported skill changed by hand, out of date, up to date, or out of reach", async () => {
	const dir = mkdtempSync(join(tmpdir(), "doctor-skills-"));
	const skill = "---\nname: s\ndescription: S\n---\nDo.\n";
	const files: Record<string, string> = {
		"factory.yaml": "name: F\nrepository: acme/app\nmaintainers: [alice]\n",
		"agents/a/agent.md": "---\ndescription: A\n---\nGo.\n",
		"automations/x/automation.md":
			"---\nwhen: [issue.opened]\nagent: a\ncan: [add_comment]\n---\nGo.\n",
	};
	const hash = skillHash([
		{ path: "SKILL.md", content: new TextEncoder().encode(skill) },
	]);
	const entry = (source: string) => ({
		source,
		sourceType: "github",
		ref: "main",
		commit: "a".repeat(40),
		skillPath: "skills/s/SKILL.md",
		computedHash: hash,
	});
	const skills: Record<string, unknown> = {};
	for (const [key, source] of [
		["skills/fresh", "acme/fresh"],
		["skills/stale", "acme/stale"],
		["agents/a/skills/far", "acme/far"],
		["skills/edited", "acme/edited"],
	] as const) {
		files[`${key}/SKILL.md`] = key === "skills/edited" ? "mine\n" : skill;
		skills[key] = entry(source);
	}
	files["imported-skills.json"] = JSON.stringify({ version: 1, skills });
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(join(dir, path, ".."), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
	const asked: string[] = [];
	const run = async (command: string, args: string[]) => {
		if (command !== "gh") return "";
		const url = args[1] ?? "";
		asked.push(url);
		if (url.startsWith("repos/acme/far/")) throw new Error("HTTP 404\nmore");
		const pinned = url.includes("sha=aaaa");
		return url.startsWith("repos/acme/stale/") && !pinned ? "new\n" : "old\n";
	};
	const result = await doctorCommand(dir, run, "darwin");
	expect(result.output).toContain(
		"! skills/edited: changed since it was imported from acme/edited",
	);
	expect(result.output).toContain(
		'! skills/stale: acme/stale has a newer version on main: run "openfabriq skill add acme/stale stale" for a pull request that updates it',
	);
	expect(result.output).toContain(
		"✓ skills/fresh: as imported from acme/fresh, and up to date",
	);
	expect(result.output).toContain(
		"! agents/a/skills/far: could not ask acme/far for a newer version (HTTP 404)",
	);
	expect(asked).toContain(
		`repos/acme/fresh/commits?sha=main&per_page=1&path=skills%2Fs`,
	);
	// Said, not a failure.
	expect(result.code).toBe(0);
});
