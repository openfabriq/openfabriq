import { execFileSync, spawn } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LEARNING_FOLDER, type Network } from "@openfabriq/core";
import { expect, it } from "vitest";
import { parseHeads } from "../../src/workspace/hardened-git.js";
import {
	tail,
	withoutSandboxNoise,
} from "../../src/workspace/sandboxed-commands.js";
import { parseNumstat, workspace } from "../../src/workspace/workspace.js";

const dir = () => mkdtempSync(join(tmpdir(), "openfabriq-setup-"));
const env = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
/** Where a project's clone would be: its cache goes beside it. */
const clone = () => join(dir(), "repo");

// The engine's secrets, which its commands never read: the sandbox is set up at the first command.
const engineHome = dir();
process.env.OPENFABRIQ_HOME = engineHome;
writeFileSync(join(engineHome, "secrets.json"), "{}");
writeFileSync(join(engineHome, "viewer-token"), "token");

it("runs a setup command in the worktree", async () => {
	await expect(
		workspace.setup(clone(), dir(), "test -w . && echo ok", env, 5000, []),
	).resolves.toBeUndefined();
});

it("rejects with the exit code and the end of the output", async () => {
	const error = await workspace
		.setup(
			clone(),
			dir(),
			"echo boom >&2; sleep 0.1; for i in $(seq 1 30); do echo line $i; done; exit 3",
			env,
			5000,
			[],
		)
		.catch((e: Error) => e);
	expect(String(error)).toMatch(/^Error: exited with code 3\n/);
	expect(String(error)).toContain("line 30");
	expect(String(error)).not.toContain("line 10\n");
	expect(String(error).split("\n")).toHaveLength(21);
});

it("stops a command that runs too long", async () => {
	await expect(
		workspace.setup(clone(), dir(), "sleep 5", env, 100, []),
	).rejects.toThrow(/^stopped after 0 minutes/);
});

it("keeps the last lines of an output", () => {
	expect(tail("a\nb\nc\n", 2)).toBe("b\nc");
});

it("reads each branch's commit from ls-remote's lines", () => {
	expect(
		parseHeads("1a2b\trefs/heads/main\n3c4d\trefs/heads/feature/x\n"),
	).toEqual(
		new Map([
			["main", "1a2b"],
			["feature/x", "3c4d"],
		]),
	);
	expect(parseHeads("")).toEqual(new Map());
});

it("runs a command without rejecting when it fails", async () => {
	expect(await workspace.run(clone(), dir(), "echo ok", env, 5000, [])).toEqual(
		{
			ok: true,
			output: "ok\n",
		},
	);
	const failed = await workspace.run(
		clone(),
		dir(),
		"echo boom; exit 2",
		env,
		5000,
		[],
	);
	expect(failed).toEqual({ ok: false, output: "exited with code 2\nboom" });
});

it("stops at the timeout even when a process left the group holds the output", async () => {
	const started = Date.now();
	const result = await workspace.run(
		clone(),
		dir(),
		`perl -MPOSIX -e 'POSIX::setsid(); sleep 3' & sleep 5`,
		env,
		100,
		[],
	);
	expect(result.ok).toBe(false);
	expect(result.output).toMatch(/^stopped after/);
	expect(Date.now() - started).toBeLessThan(2000);
});

it("runs the engine's commands in a sandbox: no secrets, writes in the worktree, its temp folder and the project's cache only", async () => {
	const project = dir();
	const wt = join(project, "worktrees", "run-1");
	mkdirSync(wt, { recursive: true });
	const tries = {
		"read the engine's secrets": `cat ${join(engineHome, "secrets.json")}`,
		"read the studio token": `cat ${join(engineHome, "viewer-token")}`,
		"write beside the worktree": `touch ${join(project, "outside.txt")}`,
		"write the worktree": "touch here.txt",
		"write its temp folder": 'touch "$TMPDIR/t"',
		"write npm's cache":
			'mkdir -p "$npm_config_cache" && touch "$npm_config_cache/t"',
		"open a Unix socket in its temp folder": `node -e 'require("net").createServer().listen(process.env.TMPDIR + "/s.sock", () => process.exit(0)).on("error", () => process.exit(1))'`,
		"write pnpm's store":
			'mkdir -p "$npm_config_store_dir" && touch "$npm_config_store_dir/t"',
		"write the home's settings folder":
			'mkdir -p "$HOME/.config/openfabriq-test"',
		"write its own settings folder": 'mkdir "$XDG_CONFIG_HOME/tool"',
		"let Node's fetch follow the proxy, as curl does": `test "$NODE_USE_ENV_PROXY" = 1 && echo "$HTTPS_PROXY" | grep -Eq '^http://[^ ]*localhost:[0-9]+$'`,
	};
	const script = Object.entries(tries)
		.map(
			([what, command]) =>
				`if ${command} >/dev/null 2>&1; then echo "${what}: yes"; else echo "${what}: no"; fi`,
		)
		.join("\n");
	const result = await workspace.run(
		join(project, "repo"),
		wt,
		script,
		env,
		30_000,
		[],
	);
	expect(result.output.trim().split("\n")).toEqual([
		"read the engine's secrets: no",
		"read the studio token: no",
		"write beside the worktree: no",
		"write the worktree: yes",
		"write its temp folder: yes",
		"write npm's cache: yes",
		// On Linux too: agent-browser's daemon listens on one; the machine's sockets stay hidden.
		"open a Unix socket in its temp folder: yes",
		"write pnpm's store: yes",
		"write the home's settings folder: no",
		"write its own settings folder: yes",
		"let Node's fetch follow the proxy, as curl does: yes",
	]);
	expect(readdirSync(join(project, "cache")).sort()).toEqual([
		"npm",
		"pnpm-store",
	]);
}, 60_000);

it("gives a command of a run no maintainer started a cache of its own, never the project's", async () => {
	const project = dir();
	const wt = join(project, "worktrees", "run-1");
	mkdirSync(wt, { recursive: true });
	const plant =
		'mkdir -p "$npm_config_cache/_npx" "$npm_config_store_dir" "$XDG_CACHE_HOME" && touch "$npm_config_cache/_npx/planted" && echo "$npm_config_cache"';
	const untrusted = await workspace.run(
		join(project, "repo"),
		wt,
		plant,
		env,
		30_000,
		[],
		undefined,
		true,
	);
	expect(untrusted.ok).toBe(true);
	expect(untrusted.output.trim()).not.toContain(join(project, "cache"));
	expect(existsSync(join(project, "cache", "npm", "_npx", "planted"))).toBe(
		false,
	);
	// The project's cache, which setup reads with the factory's secrets, holds nothing it wrote.
	const trusted = await workspace.run(
		join(project, "repo"),
		wt,
		'ls "$npm_config_cache/_npx" 2>/dev/null; echo "$npm_config_cache"',
		env,
		30_000,
		[],
	);
	expect(trusted.output.trim()).toBe(join(project, "cache", "npm"));
}, 60_000);

it("gives each command its own network, side by side: the proxy refuses a site off its list (403) and lets a listed one through (502: .invalid does not exist)", async () => {
	const reach = (sites: string[]) =>
		sites
			.map(
				(site) =>
					`curl -s -o /dev/null -w '${site} %{http_connect}\\n' --max-time 10 https://${site}`,
			)
			.join("; ")
			.concat("; true");
	const run = (sites: string[], network: Network) =>
		workspace
			.run(clone(), dir(), reach(sites), env, 30_000, network)
			.then((r) =>
				r.output
					.trim()
					.split("\n")
					.filter((line) => /\.invalid \d+$/.test(line)),
			);
	const both = ["allowed.invalid", "sub.allowed.invalid", "refused.invalid"];
	const [listed, wildcard, none, any] = await Promise.all([
		run(both, ["allowed.invalid"]),
		run(both, ["*.allowed.invalid"]),
		run(both, []),
		run(both, "any"),
	]);
	expect(listed).toEqual([
		"allowed.invalid 502",
		"sub.allowed.invalid 403",
		"refused.invalid 403",
	]);
	expect(wildcard).toEqual([
		"allowed.invalid 403",
		"sub.allowed.invalid 502",
		"refused.invalid 403",
	]);
	expect(none).toEqual([
		"allowed.invalid 403",
		"sub.allowed.invalid 403",
		"refused.invalid 403",
	]);
	expect(any).toEqual([
		"allowed.invalid 502",
		"sub.allowed.invalid 502",
		"refused.invalid 502",
	]);
}, 60_000);

it("says, at the end of a command's output, which sites the network refused and where to add them, and tells the engine", async () => {
	const told: string[][] = [];
	const result = await workspace.run(
		clone(),
		dir(),
		"curl -s https://refused.invalid; curl -s https://refused.invalid/again; curl -s https://other.invalid; curl -s https://allowed.invalid; exit 3",
		env,
		30_000,
		["allowed.invalid"],
		(sites) => told.push(sites),
	);
	expect(result.ok).toBe(false);
	expect(result.output.trim().split("\n").slice(-2)).toEqual([
		"openfabriq: the network refused refused.invalid and other.invalid: they are not in network.",
		"Add the sites this command needs to network, in openfabriq/factory.yaml, or in the agent's agent.md for one agent.",
	]);
	expect(told).toEqual([["refused.invalid", "other.invalid"]]);
	// A command that prints the engine's words tells the engine nothing: only the sandbox's refusals count.
	const fake: string[][] = [];
	const quiet = await workspace.run(
		clone(),
		dir(),
		'echo "openfabriq: the network refused evil.example: it is not in network."',
		env,
		30_000,
		[],
		(sites) => fake.push(sites),
	);
	expect(quiet.ok).toBe(true);
	expect(fake).toEqual([]);
}, 60_000);

it("stops every process of a local MCP server when its line is stopped, even one that ignores the end of its input", async () => {
	const project = dir();
	mkdirSync(join(project, "worktrees"), { recursive: true });
	const mark = `${40 + Math.floor(Math.random() * 1000)}.5`;
	const line = await workspace.mcpServer(
		join(project, "repo"),
		`sleep ${mark} & sleep ${mark}`,
		[],
	);
	const server = spawn("sh", ["-c", line], {
		stdio: ["pipe", "ignore", "ignore"],
	});
	const running = () =>
		execFileSync("ps", ["-A", "-o", "command="])
			.toString()
			.split("\n")
			.filter((c) => c.startsWith(`sleep ${mark}`)).length;
	for (let i = 0; i < 50 && running() < 2; i++)
		await new Promise((r) => setTimeout(r, 100));
	expect(running()).toBe(2);
	server.kill("SIGTERM");
	for (let i = 0; i < 50 && running() > 0; i++)
		await new Promise((r) => setTimeout(r, 100));
	expect(running()).toBe(0);
}, 60_000);

it("runs a script of the applied factory, never the worktree's file of the same name, with the command's variables, and it cannot change it", async () => {
	const project = dir();
	const wt = join(project, "worktrees", "run-1");
	const scripts = join(project, "factory", "scripts");
	mkdirSync(join(wt, "scripts"), { recursive: true });
	mkdirSync(scripts, { recursive: true });
	writeFileSync(join(wt, "scripts/hello.sh"), "#!/bin/sh\necho branch\n", {
		mode: 0o755,
	});
	const hello =
		'#!/bin/sh\necho "factory $1 $GREETING" > out.txt\n{ echo changed >> "$0"; } 2>/dev/null || echo "kept unchanged"\n';
	writeFileSync(join(scripts, "hello.sh"), hello, { mode: 0o755 });
	const result = await workspace.run(
		join(project, "repo"),
		wt,
		"scripts/hello.sh world && cat out.txt",
		{ ...env, GREETING: "hi" },
		30_000,
		[],
	);
	expect(result).toEqual({
		ok: true,
		output: "kept unchanged\nfactory world hi\n",
	});
	expect(readFileSync(join(scripts, "hello.sh"), "utf8")).toBe(hello);
}, 60_000);

it("runs a factory's local MCP server in the sandbox, from a folder of its own: never the worktree's code (VULN-011)", async () => {
	const project = dir();
	const wt = join(project, "worktrees", "run-1");
	mkdirSync(wt, { recursive: true });
	// A branch's .npmrc would decide what npx runs, if the server started in the worktree.
	writeFileSync(join(wt, ".npmrc"), "registry=https://attacker.test/\n");
	const tries = {
		"start in the worktree": `test "$(pwd -P)" = "$(cd ${wt} && pwd -P)"`,
		"read the engine's secrets": `cat ${join(engineHome, "secrets.json")}`,
		"write the worktree": `touch ${join(wt, "x")}`,
		"write npm's cache":
			'mkdir -p "$npm_config_cache" && touch "$npm_config_cache/t"',
		"write its temp folder": 'touch "$TMPDIR/t"',
		"let Node's fetch follow the proxy": 'test "$NODE_USE_ENV_PROXY" = 1',
	};
	const command = Object.entries(tries)
		.map(
			([what, c]) =>
				`if ${c} >/dev/null 2>&1; then echo "${what}: yes"; else echo "${what}: no"; fi`,
		)
		.join("\n");
	const line = await workspace.mcpServer(join(project, "repo"), command, []);
	// Claude Code starts the server in its own folder, the worktree, with "sh -c".
	const output = execFileSync("sh", ["-c", line], { cwd: wt, env }).toString();
	expect(output.trim().split("\n")).toEqual([
		"start in the worktree: no",
		"read the engine's secrets: no",
		"write the worktree: no",
		"write npm's cache: yes",
		"write its temp folder: yes",
		"let Node's fetch follow the proxy: yes",
	]);
	expect(existsSync(join(project, "mcp", "npm", "t"))).toBe(true);
}, 60_000);

const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
		cwd,
		stdio: "ignore",
	});

/** An origin with one commit on main, the engine's clone of it, and a run's worktree. */
async function worktree() {
	const origin = dir();
	git(origin, "-c", "init.defaultBranch=main", "init", "-q");
	writeFileSync(join(origin, "t.txt"), "hi");
	git(origin, "add", ".");
	git(origin, "commit", "-q", "-m", "start");
	const clone = join(dir(), "repo");
	execFileSync("git", ["clone", "-q", origin, clone]);
	const wt = join(dir(), "run-1");
	await workspace.create(clone, wt, "main");
	return { clone, wt };
}

it("hides the files the Linux sandbox mounts for a shell command, so git add -A goes through", async () => {
	const { wt } = await worktree();
	writeFileSync(join(wt, ".bashrc"), "");
	mkdirSync(join(wt, ".claude"));
	writeFileSync(join(wt, ".claude", "agents"), "");
	writeFileSync(join(wt, "b.txt"), "b");
	const status = execFileSync("git", ["status", "--porcelain"], {
		cwd: wt,
	}).toString();
	expect(status.trim()).toBe("?? b.txt");
});

it("leaves out the batch learning stages: no change to commit, none in the run's changed files", async () => {
	const { clone, wt } = await worktree();
	mkdirSync(join(wt, LEARNING_FOLDER, "failures"), { recursive: true });
	writeFileSync(join(wt, LEARNING_FOLDER, "README.md"), "# Learning batch\n");
	writeFileSync(join(wt, LEARNING_FOLDER, "failures", "r1-check.json"), "{}\n");
	expect(await workspace.changed(clone, wt, "main")).toEqual({
		uncommitted: false,
		ahead: 0,
	});
	expect(await workspace.changedFiles(clone, wt, "main")).toEqual([]);
});

it("tells whether the agent changed the worktree: files or commits", async () => {
	const { clone, wt } = await worktree();
	expect(await workspace.changed(clone, wt, "main")).toEqual({
		uncommitted: false,
		ahead: 0,
	});
	writeFileSync(join(wt, "a.txt"), "hi");
	expect(await workspace.changed(clone, wt, "main")).toEqual({
		uncommitted: true,
		ahead: 0,
	});
	git(wt, "add", ".");
	git(wt, "commit", "-q", "-m", "a");
	expect(await workspace.changed(clone, wt, "main")).toEqual({
		uncommitted: false,
		ahead: 1,
	});
});

it("puts the worktree back where a snapshot found it: a reviewer's commits and files go", async () => {
	const { clone, wt } = await worktree();
	writeFileSync(join(wt, "kept.txt"), "the agent's change");
	git(wt, "add", ".");
	git(wt, "commit", "-q", "-m", "agent");
	const restore = await workspace.snapshot(clone, wt);
	writeFileSync(join(wt, "kept.txt"), "changed by the reviewer");
	writeFileSync(join(wt, "new.txt"), "left by the reviewer");
	git(wt, "add", "new.txt");
	git(wt, "commit", "-q", "-m", "reviewer");
	writeFileSync(join(wt, "loose.txt"), "untracked");
	await restore();
	expect(readFileSync(join(wt, "kept.txt"), "utf8")).toBe("the agent's change");
	expect(existsSync(join(wt, "new.txt"))).toBe(false);
	expect(existsSync(join(wt, "loose.txt"))).toBe(false);
	expect(await workspace.changed(clone, wt, "main")).toEqual({
		uncommitted: false,
		ahead: 1,
	});
});

it("lists the files the agent's commits touched, both sides of a rename, never uncommitted ones", async () => {
	const { clone, wt } = await worktree();
	writeFileSync(join(wt, "a.txt"), "hi");
	git(wt, "add", ".");
	git(wt, "commit", "-q", "-m", "a");
	git(wt, "mv", "t.txt", "moved.txt");
	git(wt, "commit", "-q", "-m", "move");
	writeFileSync(join(wt, "loose.txt"), "not committed");
	expect((await workspace.touched(clone, wt, "main")).sort()).toEqual([
		"a.txt",
		"moved.txt",
		"t.txt",
	]);
});

it("lists the commits the run added since the start, up to the commit pushed", async () => {
	const { clone, wt } = await worktree();
	const head = () =>
		execFileSync("git", ["rev-parse", "HEAD"], { cwd: wt }).toString().trim();
	writeFileSync(join(wt, "a.txt"), "one");
	git(wt, "add", ".");
	git(wt, "commit", "-q", "-m", "a");
	const first = head();
	writeFileSync(join(wt, "a.txt"), "two");
	git(wt, "commit", "-q", "-am", "b");
	expect(await workspace.commitsSince(clone, wt, "main")).toEqual([
		head(),
		first,
	]);
	expect(await workspace.commitsSince(clone, wt, "main", first)).toEqual([
		first,
	]);
});

it("lists every file the run changed from the start commit, committed or not, with its line counts", async () => {
	const { clone, wt } = await worktree();
	writeFileSync(join(wt, "a.txt"), "one\ntwo\n");
	git(wt, "add", ".");
	git(wt, "commit", "-q", "-m", "a");
	// Written by the shell and never committed: still the run's.
	writeFileSync(join(wt, "loose.txt"), "x\n");
	writeFileSync(join(wt, "shot.png"), Buffer.from([0, 1, 2, 0]));
	git(wt, "rm", "-q", "t.txt");
	expect(await workspace.changedFiles(clone, wt, "main")).toEqual([
		{ path: "a.txt", add: 2, del: 0 },
		{ path: "loose.txt", add: 1, del: 0 },
		{ path: "shot.png" },
		{ path: "t.txt", add: 0, del: 1 },
	]);
});

it("reads one file's diff from the start commit, a file never added and a name like a pathspec included", async () => {
	const { clone, wt } = await worktree();
	writeFileSync(join(wt, "t.txt"), "hi\nthere\n");
	git(wt, "commit", "-q", "-am", "t");
	writeFileSync(join(wt, ":(glob)*.md"), "new\n");
	await workspace.changedFiles(clone, wt, "main");
	expect(await workspace.patch(clone, wt, "main", "t.txt")).toBe(
		"@@ -1 +1,2 @@\n-hi\n\\ No newline at end of file\n+hi\n+there\n",
	);
	expect(await workspace.patch(clone, wt, "main", ":(glob)*.md")).toBe(
		"@@ -0,0 +1 @@\n+new\n",
	);
});

it("reads git's numstat: counts, binary files without them, names as they are", () => {
	expect(parseNumstat("3\t1\tsrc/a b.ts\0-\t-\te/shot.png\0")).toEqual([
		{ path: "src/a b.ts", add: 3, del: 1 },
		{ path: "e/shot.png" },
	]);
	expect(parseNumstat("")).toEqual([]);
});

it("sees a file added by a merge commit itself", async () => {
	const { clone, wt } = await worktree();
	git(wt, "checkout", "-q", "-b", "side");
	writeFileSync(join(wt, "a.txt"), "hi");
	git(wt, "add", ".");
	git(wt, "commit", "-q", "-m", "a");
	git(wt, "checkout", "-q", "--detach", "origin/main");
	git(wt, "merge", "-q", "--no-ff", "--no-commit", "side");
	mkdirSync(join(wt, ".github/workflows"), { recursive: true });
	writeFileSync(join(wt, ".github/workflows/x.yml"), "on: push");
	git(wt, "add", ".");
	git(wt, "commit", "-q", "-m", "merge");
	expect((await workspace.touched(clone, wt, "main")).sort()).toEqual([
		".github/workflows/x.yml",
		"a.txt",
	]);
});

it("compares with where origin's branch was when the run started, not where the agent moved it", async () => {
	const { clone, wt } = await worktree();
	mkdirSync(join(wt, ".github/workflows"), { recursive: true });
	writeFileSync(join(wt, ".github/workflows/x.yml"), "on: push");
	git(wt, "add", ".");
	git(wt, "commit", "-q", "-m", "workflow");
	git(wt, "update-ref", "refs/remotes/origin/main", "HEAD");
	writeFileSync(join(wt, "b.txt"), "hi");
	git(wt, "add", ".");
	git(wt, "commit", "-q", "-m", "b");
	expect((await workspace.touched(clone, wt, "main")).sort()).toEqual([
		".github/workflows/x.yml",
		"b.txt",
	]);
	expect(await workspace.commitsAhead(clone, wt, "main")).toBe(2);
});

it("lists the names git would quote as they are, so a workflow with an accent is seen", async () => {
	const { clone, wt } = await worktree();
	mkdirSync(join(wt, ".github/workflows"), { recursive: true });
	writeFileSync(join(wt, ".github/workflows/déploy.yml"), "on: push");
	writeFileSync(join(wt, 'a"b.txt'), "hi");
	git(wt, "add", ".");
	git(wt, "commit", "-q", "-m", "a");
	writeFileSync(join(wt, "c.txt"), "hi");
	git(wt, "add", ".");
	git(wt, "commit", "-q", "-m", "c");
	expect((await workspace.touched(clone, wt, "main")).sort()).toEqual([
		".github/workflows/déploy.yml",
		'a"b.txt',
		"c.txt",
	]);
});

it("starts a run where origin says its branch is, even when another run's agent moves the clone's refs", async () => {
	const { clone, wt } = await worktree();
	const start = execFileSync("git", ["rev-parse", "HEAD"], { cwd: wt })
		.toString()
		.trim();
	// The first run's agent commits a workflow and puts origin/main of the shared .git on it,
	// right after each fetch: the race with the second run's create, won every time.
	mkdirSync(join(wt, ".github/workflows"), { recursive: true });
	writeFileSync(join(wt, ".github/workflows/x.yml"), "on: push");
	git(wt, "add", ".");
	git(wt, "commit", "-q", "-m", "workflow");
	const planted = execFileSync("git", ["rev-parse", "HEAD"], { cwd: wt })
		.toString()
		.trim();
	const real = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
	const bin = dir();
	writeFileSync(
		join(bin, "git"),
		`#!/bin/sh\n"${real}" "$@" || exit $?\ncase " $* " in *" fetch "*) "${real}" update-ref refs/remotes/origin/main ${planted};; esac\n`,
		{ mode: 0o755 },
	);
	const path = process.env.PATH;
	process.env.PATH = `${bin}:${path}`;
	try {
		const second = join(dir(), "run-2");
		await workspace.create(clone, second, "main");
		expect(
			execFileSync(real, ["rev-parse", "HEAD"], { cwd: second })
				.toString()
				.trim(),
		).toBe(start);
	} finally {
		process.env.PATH = path;
	}
});

it("ignores and clears the objects an agent replaced in the shared .git", async () => {
	const { clone, wt } = await worktree();
	const real = execFileSync("git", ["rev-parse", "origin/main:t.txt"], {
		cwd: wt,
		encoding: "utf8",
	}).trim();
	const evil = execFileSync("git", ["hash-object", "-w", "--stdin"], {
		cwd: wt,
		input: "evil",
		encoding: "utf8",
	}).trim();
	git(wt, "replace", real, evil);
	const next = join(dir(), "run-2");
	await workspace.create(clone, next, "main");
	expect(readFileSync(join(next, "t.txt"), "utf8")).toBe("hi");
	expect(
		execFileSync("git", ["for-each-ref", "refs/replace"], {
			cwd: clone,
			encoding: "utf8",
		}),
	).toBe("");
});

it("never writes through a link the agent put in the worktree's git dir", async () => {
	const { clone, wt } = await worktree();
	const victim = join(dir(), "victim");
	writeFileSync(victim, "keep me");
	const commondir = join(clone, ".git/worktrees/run-1/commondir");
	rmSync(commondir);
	symlinkSync(victim, commondir);
	await workspace.changed(clone, wt, "main");
	expect(readFileSync(victim, "utf8")).toBe("keep me");
});

it("knows where a run started only between create and remove", async () => {
	const { clone, wt } = await worktree();
	await expect(
		workspace.commitsAhead(clone, join(dir(), "run-9"), "main"),
	).rejects.toThrow(/^no start commit for origin\/main in /);
	await expect(workspace.touched(clone, wt, "nope")).rejects.toThrow(
		`no start commit for origin/nope in ${wt}`,
	);
	await workspace.remove(clone, wt);
	await expect(workspace.commitsAhead(clone, wt, "main")).rejects.toThrow(
		`no start commit for origin/main in ${wt}`,
	);
	// Not false: there is no start commit to compare with.
	await expect(workspace.contains(clone, wt, "main")).rejects.toThrow(
		"no start commit",
	);
});

it("stops what the agent left running, then pushes the commit it settled on, not a later HEAD", async () => {
	const { clone, wt } = await worktree();
	const commit = (name: string) => {
		writeFileSync(join(wt, name), name);
		git(wt, "add", name);
		git(wt, "-c", "user.name=a", "-c", "user.email=a@a", "commit", "-qm", name);
	};
	commit("judged.txt");
	const left = spawn("sleep", ["30"], { cwd: wt });
	const exited = new Promise((ok) => left.on("exit", ok));
	let judged = "";
	try {
		judged = await workspace.settle(clone, wt);
		await exited;
	} finally {
		left.kill();
	}
	expect(left.signalCode).toBe("SIGKILL");
	commit("later.txt");
	await workspace.push(clone, wt, "feature", judged);
	const origin = execFileSync("git", ["remote", "get-url", "origin"], {
		cwd: clone,
		encoding: "utf8",
	}).trim();
	expect(
		execFileSync("git", ["rev-parse", "feature"], {
			cwd: origin,
			encoding: "utf8",
		}).trim(),
	).toBe(judged);
});

it("removes a worktree and its entry in the clone", async () => {
	const { clone, wt } = await worktree();
	writeFileSync(join(wt, "a.txt"), "left by the agent");
	await workspace.remove(clone, wt);
	expect(existsSync(wt)).toBe(false);
	expect(
		execFileSync("git", ["worktree", "list"], { cwd: clone, encoding: "utf8" }),
	).not.toContain(wt);
	expect(readdirSync(join(clone, "..", "trash"))).toEqual([]);
});

it("never runs what the agent put in the clone's git config, nor follows its .git", async () => {
	const { clone, wt } = await worktree();
	const ran = join(dir(), "ran");
	// What an agent with a shell can do: a clean filter runs during `git status`.
	appendFileSync(
		join(clone, ".git/config"),
		`[filter "x"]\n\tclean = touch ${ran}; cat\n`,
	);
	writeFileSync(join(wt, ".gitattributes"), "* filter=x\n");
	writeFileSync(join(wt, "t.txt"), "ho"); // same size: git reads it, through the filter
	expect((await workspace.changed(clone, wt, "main")).uncommitted).toBe(true);
	expect(existsSync(ran)).toBe(false);
	// A .git pointer to another repository is ignored.
	const other = dir();
	git(other, "init", "-q");
	writeFileSync(join(wt, ".git"), `gitdir: ${join(other, ".git")}\n`);
	expect(await workspace.changed(clone, wt, "main")).toEqual({
		uncommitted: true,
		ahead: 0,
	});
});

it("tells whether a branch contains its base as it was at the start, and finds conflict markers left", async () => {
	const origin = dir();
	git(origin, "-c", "init.defaultBranch=main", "init", "-q");
	writeFileSync(join(origin, "t.txt"), "hi");
	git(origin, "add", ".");
	git(origin, "commit", "-q", "-m", "start");
	git(origin, "branch", "feature");
	writeFileSync(join(origin, "u.txt"), "new on main");
	git(origin, "add", ".");
	git(origin, "commit", "-q", "-m", "main moves");
	const clone = join(dir(), "repo");
	execFileSync("git", ["clone", "-q", origin, clone]);
	const wt = join(dir(), "run-2");
	await workspace.create(clone, wt, "feature");
	expect(await workspace.contains(clone, wt, "main")).toBe(false);
	git(wt, "merge", "-q", "--no-edit", "origin/main");
	expect(await workspace.contains(clone, wt, "main")).toBe(true);
	// The pull request's branch, as it was at the start: the agent merged main in, it was not there before.
	expect(await workspace.contains(clone, wt, "main", "feature")).toBe(false);
	expect(await workspace.contains(clone, wt, "feature", "main")).toBe(true);
	writeFileSync(
		join(wt, "c.txt"),
		"<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> main\n",
	);
	writeFileSync(join(wt, "d.md"), "Title\n=======\n");
	git(wt, "add", ".");
	git(wt, "commit", "-q", "-m", "left markers");
	expect(
		await workspace.conflictMarkers(clone, wt, ["c.txt", "d.md", "t.txt"]),
	).toEqual(["c.txt"]);
	expect(await workspace.conflictMarkers(clone, wt, [])).toEqual([]);
	// A file name is a name, never a pathspec that would hide the others.
	expect(
		await workspace.conflictMarkers(clone, wt, [":(exclude)*", "c.txt"]),
	).toEqual(["c.txt"]);
	expect(await workspace.conflictMarkers(clone, wt, ["t.txt"])).toEqual([]);
});

it("commits exactly the files an agent without a shell names, and discards the rest", async () => {
	const { clone, wt } = await worktree();
	writeFileSync(join(wt, ".gitignore"), "node_modules/\n");
	git(wt, "add", ".gitignore");
	git(wt, "commit", "-q", "-m", "ignore");
	writeFileSync(join(wt, "t.txt"), "changed");
	writeFileSync(join(wt, "kept.txt"), "proposed");
	writeFileSync(join(wt, "factory-history.md"), "a working file");
	mkdirSync(join(wt, "node_modules"));
	writeFileSync(join(wt, "node_modules", "dep.js"), "");
	await workspace.commit(
		clone,
		wt,
		{ message: "chore: propose kept.txt", files: ["kept.txt"] },
		{ name: "Engine", email: "engine@example.com" },
	);
	const show = execFileSync(
		"git",
		["log", "-1", "--format=%an <%ae> %s", "--name-only"],
		{ cwd: wt },
	).toString();
	expect(show.trim().split("\n").filter(Boolean)).toEqual([
		"Engine <engine@example.com> chore: propose kept.txt",
		"kept.txt",
	]);
	expect(readFileSync(join(wt, "t.txt"), "utf8")).toBe("hi");
	expect(existsSync(join(wt, "factory-history.md"))).toBe(false);
	// What git ignores stays: the installed dependencies the checks need.
	expect(existsSync(join(wt, "node_modules", "dep.js"))).toBe(true);
	expect(await workspace.changed(clone, wt, "main")).toEqual({
		uncommitted: false,
		ahead: 2,
	});
});

it("commits nothing for a path outside the worktree, or files without a change", async () => {
	const { clone, wt } = await worktree();
	const identity = { name: "Engine", email: "engine@example.com" };
	for (const file of [
		"../outside.txt",
		"/etc/hosts",
		".git/config",
		":(glob)*",
	])
		await expect(
			workspace.commit(clone, wt, { message: "x", files: [file] }, identity),
		).rejects.toThrow("not a path inside the working directory");
	await expect(
		workspace.commit(clone, wt, { message: "x", files: ["t.txt"] }, identity),
	).rejects.toThrow("hold no change");
});

it("leaves out the lines the macOS sandbox prints for each certificate", () => {
	expect(
		withoutSandboxNoise(
			"ERROR: failed to copy trust settings of system certificate-25291\nfound 3 vulnerabilities\nERROR: failed to copy trust settings of system certificate-25291",
		),
	).toBe("found 3 vulnerabilities");
});
