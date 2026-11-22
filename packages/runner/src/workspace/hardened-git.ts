import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { LEARNING_FOLDER } from "@openfabriq/core";
import { exec } from "../exec.js";
import { writeFileAtomic } from "../files.js";
import { githubApp, githubEnv } from "../github/app.js";
import { repositoryOfRemote } from "./git.js";

// The agent has a shell in a worktree of the engine's clone, so it can write the clone's shared .git:
// hooks, refs, replaced objects; its sandbox denies the config, origin's refs and packed-refs. The engine
// never runs hooks or fsmonitor, never reads replaced objects, and still puts back the config it trusts
// before each of its git commands.
const SAFE = [
	"--no-replace-objects",
	"-c",
	"core.hooksPath=/dev/null",
	"-c",
	"core.fsmonitor=false",
];
// gh's login for fetch and push, never the machine's helpers: a server (Docker) has no other git login.
// Over HTTPS even when gh cloned over SSH (git_protocol ssh): a helper never serves SSH, and the
// person's SSH key would push instead of the app's token.
export const GH_AUTH = [
	"-c",
	"credential.helper=",
	"-c",
	"credential.helper=!gh auth git-credential",
	"-c",
	"url.https://github.com/.insteadOf=git@github.com:",
	"-c",
	"url.https://github.com/.insteadOf=ssh://git@github.com/",
];

export const git = (cwd: string, args: string[], env?: NodeJS.ProcessEnv) =>
	exec("git", [...SAFE, ...args], { cwd, ...(env ? { env } : {}) });

/**
 * git in a run's worktree, from the engine: with the clone's trusted config, and the worktree's own
 * git dir named explicitly, so a `.git` the agent replaced or a filter it configured never runs.
 */
export function worktreeGit(
	clone: string,
	dir: string,
	args: string[],
	env?: NodeJS.ProcessEnv,
) {
	restoreConfig(clone);
	const admin = join(clone, ".git/worktrees", basename(dir));
	// Atomic: a rename replaces a link the agent put there, where a write would follow it.
	writeFileAtomic(join(admin, "commondir"), "../..\n");
	return git(dir, [`--git-dir=${admin}`, `--work-tree=${dir}`, ...args], env);
}

/** The file of the clone's trusted config: copied beside the clone from its config the first time. */
function ensureTrustedConfig(clone: string): string {
	const saved = join(clone, "..", "git-config.trusted");
	if (!existsSync(saved))
		writeFileSync(saved, readFileSync(join(clone, ".git/config")));
	return saved;
}

/** git in the engine's clone, read-only callers included: with its trusted config, no hook, no fsmonitor. */
export function cloneGit(clone: string, args: string[]): Promise<string> {
	restoreConfig(clone);
	return git(clone, args);
}

export function restoreConfig(clone: string) {
	// Atomic: another run's git never reads half a config.
	writeFileAtomic(
		join(clone, ".git/config"),
		readFileSync(ensureTrustedConfig(clone)),
	);
}

// On Linux, Claude Code's sandbox mounts /dev/null on the protected paths it denies, in the worktree,
// for each shell command: `git add -A` would stop on them. Ignored, they stay out of commits.
// The list of @anthropic-ai/sandbox-runtime (DANGEROUS_FILES and directories), which it does not export,
// and all of .claude/, whose protected paths change with each version of Claude Code. Tracked files
// stay tracked: an exclude only hides untracked ones.
const SANDBOX_MOUNTS = [
	".gitconfig",
	".gitmodules",
	".bashrc",
	".bash_profile",
	".zshrc",
	".zprofile",
	".profile",
	".ripgreprc",
	".mcp.json",
	".vscode",
	".idea",
	".claude/",
];

/**
 * The clone's info/exclude, written whole and atomically: never read, so a link the agent put there
 * leaks nothing. With the sandbox's mounts, the batch learning's runs find staged: never committed,
 * and no change the checks would ask the agent to commit.
 */
export function excludeSandboxMounts(clone: string) {
	writeFileAtomic(
		join(clone, ".git/info/exclude"),
		`${[...SANDBOX_MOUNTS, `${LEARNING_FOLDER}/`].join("\n")}\n`,
	);
}

/**
 * The environment of git's calls to origin: in app mode, the token of the clone's repository, read
 * from its trusted config; otherwise gh's own login.
 */
export async function originEnv(
	clone: string,
): Promise<NodeJS.ProcessEnv | undefined> {
	if (!githubApp()) return undefined;
	const url = await cloneGit(clone, ["config", "--get", "remote.origin.url"]);
	return githubEnv(repositoryOfRemote(url) ?? "");
}

export const fetchOrigin = async (clone: string) =>
	git(
		clone,
		[...GH_AUTH, "fetch", "--quiet", "--prune", "origin"],
		await originEnv(clone),
	);

/** Deletes the replaced objects an earlier agent left: they would show in this agent's own git. */
export async function clearReplacedObjects(clone: string): Promise<void> {
	const replaced = await git(clone, [
		"for-each-ref",
		"--format=delete %(refname)",
		"refs/replace",
	]);
	if (replaced)
		await exec("git", [...SAFE, "update-ref", "--stdin"], {
			cwd: clone,
			input: replaced,
		});
}

/** `<commit>\trefs/heads/<branch>` lines, as ls-remote prints them: each branch's commit. */
export function parseHeads(out: string): Map<string, string> {
	return new Map(
		out
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const [sha, ref] = line.split("\t") as [string, string];
				return [ref.replace(/^refs\/heads\//, ""), sha];
			}),
	);
}

/**
 * Where origin's branches are, from origin itself: an agent of another run can write
 * refs/remotes in the shared .git, even between the engine's fetch and its read.
 */
export async function originHeads(clone: string): Promise<Map<string, string>> {
	return parseHeads(
		await git(
			clone,
			[...GH_AUTH, "ls-remote", "origin", "refs/heads/*"],
			await originEnv(clone),
		),
	);
}

export async function addWorktree(
	clone: string,
	dir: string,
	commit: string,
): Promise<void> {
	await git(clone, ["worktree", "add", "--quiet", "--detach", dir, commit]);
}
