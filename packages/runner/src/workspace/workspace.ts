import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Agent, Network } from "@openfabriq/core";
import { patchOf } from "./diff.js";
import {
	addWorktree,
	clearReplacedObjects,
	cloneGit,
	excludeSandboxMounts,
	fetchOrigin,
	GH_AUTH,
	git,
	originEnv,
	originHeads,
	restoreConfig,
	worktreeGit,
} from "./hardened-git.js";
import { buildPlugin } from "./plugin.js";
import { stopProcessesIn } from "./processes.js";
import { runSandboxed, sandboxedMcpServer } from "./sandboxed-commands.js";

/** A path the agent names for a commit: relative, inside the worktree, never into .git. */
export function plainPath(file: string): boolean {
	const parts = file.split(/[\\/]/);
	return (
		file.length > 0 &&
		!file.startsWith("/") &&
		!file.startsWith(":") &&
		!parts.includes("..") &&
		parts[0] !== ".git"
	);
}

/** A file the run changed, with its lines added and removed; a binary file has no counts. */
export interface ChangedFile {
	path: string;
	add?: number;
	del?: number;
	/** Its diff from the first hunk, as git prints it with three lines of context; "" when no line changed (a mode, an empty file). */
	patch?: string;
	/** Why a file recorded with diffs has none. A run recorded before diffs has neither field. */
	noPatch?: "binary" | "too large";
}

/** What a run keeps of its changed files: the first ones, and how many Git counted. */
export interface ChangedFiles {
	total: number;
	files: ChangedFile[];
}

/** git diff --numstat -z, without renames: "added\tremoved\tpath\0" per file, "-" for a binary file. */
export function parseNumstat(out: string): ChangedFile[] {
	return out
		.split("\0")
		.filter(Boolean)
		.map((record) => {
			const [add = "", del = "", ...name] = record.split("\t");
			const path = name.join("\t");
			return add === "-"
				? { path }
				: { path, add: Number(add), del: Number(del) };
		});
}

export interface Workspace {
	/** A fresh worktree on `ref` (a branch of origin), detached. */
	create(clone: string, dir: string, ref: string): Promise<void>;
	/** origin's branches, up to date in the clone: the studio reads the wiki there. */
	fetch(clone: string): Promise<void>;
	/** A file at a commit the clone fetched (a sha, `<sha>^`, `origin/<branch>`); undefined when it is not there. */
	show(clone: string, ref: string, path: string): Promise<string | undefined>;
	remove(clone: string, dir: string): Promise<void>;
	commitsAhead(clone: string, dir: string, base: string): Promise<number>;
	/** The commits the run added since origin/base, up to `commit` (HEAD unless given). */
	commitsSince(
		clone: string,
		dir: string,
		base: string,
		commit?: string,
	): Promise<string[]>;
	/**
	 * Stops what the agents left running in the worktree, and returns the commit their work now is:
	 * the one judged, then pushed, whatever a process that got away commits after.
	 */
	settle(clone: string, dir: string): Promise<string>;
	/** Pushes `commit` (HEAD unless given) to origin's `branch`. */
	push(
		clone: string,
		dir: string,
		branch: string,
		commit?: string,
	): Promise<void>;
	/**
	 * Commits exactly these files of the worktree, as `identity`, for an agent without a shell, then
	 * discards every other change, files git ignores aside. Rejects when a path is not a plain path
	 * inside the worktree, or when the files hold no change.
	 */
	commit(
		clone: string,
		dir: string,
		change: { message: string; files: string[] },
		identity: { name: string; email: string },
	): Promise<void>;
	/**
	 * Runs a setup command of factory.yaml in the worktree, in the sandbox.
	 * Rejects with the end of its output when it fails or runs longer than timeoutMs.
	 */
	setup(
		clone: string,
		dir: string,
		command: string,
		env: Record<string, string>,
		timeoutMs: number,
		/** The sites it reaches. */
		network: Network,
		/** Told the sites the network refused it. */
		refused?: (sites: string[]) => void,
		/** Caches of its own, not the project's: it runs code a run no maintainer started wrote. */
		ownCache?: boolean,
	): Promise<void>;
	/**
	 * Runs a command of the factory's harness in the worktree, in the sandbox.
	 * Never rejects for a failed command: `ok` says how it ended, `output` is its output, or why
	 * and its end.
	 */
	run(
		clone: string,
		dir: string,
		command: string,
		env: Record<string, string>,
		timeoutMs: number,
		/** The sites it reaches. */
		network: Network,
		/** Told the sites the network refused it. */
		refused?: (sites: string[]) => void,
		/**
		 * A command of a run no maintainer started: package caches of its own, gone with the command,
		 * never the project's, which setup reads with the factory's secrets.
		 */
		ownCache?: boolean,
	): Promise<{ ok: boolean; output: string }>;
	/** What the agent left: changes not committed (the checks would judge files that are not pushed), and commits ahead of origin/base. */
	changed(
		clone: string,
		dir: string,
		base: string,
	): Promise<{ uncommitted: boolean; ahead: number }>;
	/**
	 * Every file the run changed since origin/base was at its start, in its commits or left in the
	 * worktree, files git ignores aside. Marks new files in the worktree's index: call it last.
	 */
	changedFiles(
		clone: string,
		dir: string,
		base: string,
	): Promise<ChangedFile[]>;
	/** One file's diff since origin/base was at the start, from its first hunk: after changedFiles, which marks new files. */
	patch(
		clone: string,
		dir: string,
		base: string,
		path: string,
	): Promise<string>;
	/** The files the agent's commits touched since origin/base: both sides of a rename. */
	touched(clone: string, dir: string, base: string): Promise<string[]>;
	/** A file where origin/base was at the start, and at HEAD; undefined where it does not exist. */
	versions(
		clone: string,
		dir: string,
		base: string,
		path: string,
	): Promise<{ start?: string; head?: string }>;
	/**
	 * Whether HEAD contains where origin/branch was when the run started: a conflict merged in.
	 * With `at`, whether origin/at contained it at the start: the base was already in the pull request.
	 */
	contains(
		clone: string,
		dir: string,
		branch: string,
		at?: string,
	): Promise<boolean>;
	/**
	 * Where HEAD is now, and a function that puts the worktree back there: what a reviewer's shell
	 * changed or committed goes.
	 */
	snapshot(clone: string, dir: string): Promise<() => Promise<void>>;
	/** Among these files, those that still hold a conflict marker at HEAD. */
	conflictMarkers(
		clone: string,
		dir: string,
		files: string[],
	): Promise<string[]>;
	/**
	 * A local Claude Code plugin with the shared skills, those of the agent's area and the agent's
	 * own skills, or, for an agent the engine provides, the engine's skills.
	 */
	plugin(
		factoryDir: string,
		agent: Pick<Agent, "name" | "area" | "builtIn">,
		dir: string,
	): string | undefined;
	/**
	 * The shell line Claude Code runs for a local MCP server of the factory: in the sandbox
	 * of the engine's commands, from the project's own MCP folder, never the worktree, whose files
	 * (.npmrc, node_modules) come from the branch (VULN-011). Rejects when the sandbox cannot start.
	 */
	mcpServer(clone: string, command: string, network: Network): Promise<string>;
}

/** The engine's worktrees, and where origin's branches were when each was created. */
export function createWorkspace(): Workspace {
	// Where origin's branches were when each run started. Refs in the shared .git are the agent's to move,
	// so the engine compares with these commits, kept in its own memory.
	const bases = new Map<string, Map<string, string>>();
	function baseOf(dir: string, branch: string): string {
		const sha = bases.get(dir)?.get(branch);
		if (!sha) throw new Error(`no start commit for origin/${branch} in ${dir}`);
		return sha;
	}

	// Runs share a clone: fetch, worktree add and remove, and push go one at a time per clone.
	const queues = new Map<string, Promise<unknown>>();
	function oneAtATime<T>(clone: string, task: () => Promise<T>): Promise<T> {
		const next = (queues.get(clone) ?? Promise.resolve()).then(task, task);
		queues.set(
			clone,
			next.catch(() => undefined),
		);
		return next;
	}

	const self: Workspace = {
		show(clone, ref, path) {
			return cloneGit(clone, ["show", `${ref}:${path}`]).catch(() => undefined);
		},
		fetch(clone) {
			return oneAtATime(clone, async () => {
				// apply makes the clone: until then, there is nothing to fetch.
				if (!existsSync(join(clone, ".git"))) return;
				restoreConfig(clone);
				await fetchOrigin(clone);
			});
		},
		create(clone, dir, ref) {
			return oneAtATime(clone, async () => {
				restoreConfig(clone);
				excludeSandboxMounts(clone);
				await clearReplacedObjects(clone);
				// Asked before the fetch, which brings those commits; one force-pushed away in between fails the create.
				const heads = await originHeads(clone);
				await fetchOrigin(clone);
				bases.set(dir, heads);
				await addWorktree(clone, dir, baseOf(dir, ref));
			});
		},
		async remove(clone, dir) {
			// A dev server or a browser the agent started would keep its port and outlive the run.
			await stopProcessesIn(dir);
			// Under the lock only a rename and a prune: deleting a big worktree holds no other run back.
			const trash = join(
				clone,
				"..",
				"trash",
				`${basename(dir)}.${randomBytes(4).toString("hex")}`,
			);
			await oneAtATime(clone, async () => {
				restoreConfig(clone);
				if (existsSync(dir)) {
					mkdirSync(join(trash, ".."), { recursive: true });
					renameSync(dir, trash);
				}
				await git(clone, ["worktree", "prune"]);
			});
			bases.delete(dir);
			await rm(trash, { recursive: true, force: true });
		},
		async commitsAhead(clone, dir, base) {
			return Number(
				(
					await worktreeGit(clone, dir, [
						"rev-list",
						"--count",
						`${baseOf(dir, base)}..HEAD`,
					])
				).trim(),
			);
		},
		async commitsSince(clone, dir, base, commit = "HEAD") {
			return (
				await worktreeGit(clone, dir, [
					"rev-list",
					`${baseOf(dir, base)}..${commit}`,
				])
			)
				.split("\n")
				.filter(Boolean);
		},
		async settle(clone, dir) {
			await stopProcessesIn(dir);
			return (await worktreeGit(clone, dir, ["rev-parse", "HEAD"])).trim();
		},
		push(clone, dir, branch, commit = "HEAD") {
			return oneAtATime(clone, async () => {
				await worktreeGit(
					clone,
					dir,
					[
						...GH_AUTH,
						"push",
						"--quiet",
						"--no-verify",
						"origin",
						`${commit}:refs/heads/${branch}`,
					],
					await originEnv(clone),
				);
			});
		},
		async commit(clone, dir, { message, files }, identity) {
			const wrong = files.find((file) => !plainPath(file));
			if (wrong !== undefined)
				throw new Error(
					`"${wrong}" is not a path inside the working directory: name files relative to it, without "..".`,
				);
			// Literal paths: a name the agent gives never expands into other files.
			await worktreeGit(clone, dir, [
				"add",
				"--",
				...files.map((file) => `:(literal)${file}`),
			]);
			const staged = await worktreeGit(clone, dir, [
				"diff",
				"--cached",
				"--name-only",
			]);
			if (!staged.trim())
				throw new Error("these files hold no change: nothing to commit.");
			await worktreeGit(
				clone,
				dir,
				[
					"-c",
					"commit.gpgsign=false",
					"commit",
					"--quiet",
					"--no-verify",
					"-m",
					message,
				],
				{
					...process.env,
					GIT_AUTHOR_NAME: identity.name,
					GIT_AUTHOR_EMAIL: identity.email,
					GIT_COMMITTER_NAME: identity.name,
					GIT_COMMITTER_EMAIL: identity.email,
				},
			);
			// Everything else the agent changed is not proposed: it goes, so the checks judge the commit alone.
			await worktreeGit(clone, dir, ["reset", "--hard", "--quiet"]);
			await worktreeGit(clone, dir, ["clean", "-d", "--force", "--quiet"]);
		},
		async setup(
			clone,
			dir,
			command,
			env,
			timeoutMs,
			network,
			refused,
			ownCache,
		) {
			const result = await self.run(
				clone,
				dir,
				command,
				env,
				timeoutMs,
				network,
				refused,
				ownCache,
			);
			if (!result.ok) throw new Error(result.output);
		},
		async snapshot(clone, dir) {
			const head = (
				await worktreeGit(clone, dir, ["rev-parse", "HEAD"])
			).trim();
			return async () => {
				await worktreeGit(clone, dir, ["reset", "--hard", "--quiet", head]);
				await worktreeGit(clone, dir, ["clean", "-d", "--force", "--quiet"]);
			};
		},
		async changed(clone, dir, base) {
			const status = await worktreeGit(clone, dir, ["status", "--porcelain"]);
			return {
				uncommitted: status.trim() !== "",
				ahead: await self.commitsAhead(clone, dir, base),
			};
		},
		async changedFiles(clone, dir, base) {
			// Intent to add: a new file the agent never staged shows in the diff with its lines.
			await worktreeGit(clone, dir, ["add", "--all", "--intent-to-add"]);
			return parseNumstat(
				await worktreeGit(clone, dir, [
					"diff",
					"-z",
					"--no-renames",
					"--numstat",
					baseOf(dir, base),
				]),
			);
		},
		async patch(clone, dir, base, path) {
			return patchOf(
				await worktreeGit(clone, dir, [
					"diff",
					"-U3",
					"--no-renames",
					"--no-color",
					"--no-ext-diff",
					"--no-textconv",
					baseOf(dir, base),
					"--",
					`:(literal)${path}`,
				]),
			);
		},
		async touched(clone, dir, base) {
			const start = baseOf(dir, base);
			// Each commit's files, and the whole difference of trees: a merge commit lists no files in a log.
			// -z gives names as they are: git quotes unusual ones otherwise, and a quoted workflow would
			// slip past the check on .github/workflows/.
			const names = [
				await worktreeGit(clone, dir, [
					"log",
					"-z",
					"--no-renames",
					"--name-only",
					"--format=",
					`${start}..HEAD`,
				]),
				await worktreeGit(clone, dir, [
					"diff",
					"-z",
					"--no-renames",
					"--name-only",
					start,
					"HEAD",
				]),
			].join("\0");
			// git log -z ends its records with a newline after the last NUL.
			return [
				...new Set(
					names
						.split("\0")
						.map((name) => (name.startsWith("\n") ? name.slice(1) : name))
						.filter(Boolean),
				),
			];
		},
		async versions(clone, dir, base, path) {
			const show = (commit: string) =>
				worktreeGit(clone, dir, ["show", `${commit}:${path}`]).then(
					(text): string | undefined => text,
					() => undefined,
				);
			const [start, head] = await Promise.all([
				show(baseOf(dir, base)),
				show("HEAD"),
			]);
			return {
				...(start !== undefined ? { start } : {}),
				...(head !== undefined ? { head } : {}),
			};
		},
		async contains(clone, dir, branch, at) {
			return worktreeGit(clone, dir, [
				"merge-base",
				"--is-ancestor",
				baseOf(dir, branch),
				at === undefined ? "HEAD" : baseOf(dir, at),
			]).then(
				() => true,
				() => false,
			);
		},
		async conflictMarkers(clone, dir, files) {
			if (files.length === 0) return [];
			// The whole commit, then the run's files: a file name is never read as a pathspec
			// (`:(exclude)*` would hide them all), and no list is too long for the command line.
			const found = await worktreeGit(clone, dir, [
				"grep",
				"-l",
				"-z",
				"-E",
				"^(<<<<<<<|>>>>>>>)( |$)",
				"HEAD",
			]).catch((error: unknown) => {
				// Exit 1 is "nothing matches"; any other failure must not read as "no conflict".
				if (/exited with code 1,/.test(String(error))) return "";
				throw error;
			});
			const touched = new Set(files);
			return found
				.split("\0")
				.map((name) => name.replace(/^HEAD:/, ""))
				.filter((name) => touched.has(name));
		},
		run: runSandboxed,
		mcpServer: sandboxedMcpServer,
		plugin: buildPlugin,
	};
	return self;
}

export const workspace = createWorkspace();
