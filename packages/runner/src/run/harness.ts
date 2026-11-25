import { z } from "zod";
import { engineTool, type Stop } from "../agent/port.js";
import { errorText } from "../files.js";
import { tail } from "../workspace/sandboxed-commands.js";
import { changesRequested, type InternalReview } from "./internal-review.js";

/** One command the engine ran for a run: by the agent, or as a check. */
export interface CommandRun {
	kind: "command" | "check";
	name: string;
	command: string;
	ok: boolean;
	/** The end of its output. */
	output: string;
	durationMs: number;
	at: string;
}

export type Execute = (
	command: string,
) => Promise<{ ok: boolean; output: string }>;

const UNCOMMITTED =
	"Some changes are not committed. Commit them, or discard them, then finish: only commits are published, and the checks judge the files.";
const UNCOMMITTED_TOOL =
	"Some changes are not committed. Call commit with the files you propose (it discards the others), then finish: only commits are published.";

/** Rounds of fixes an agent gets when a check fails at its stop. */
const CHECK_ROUNDS = 2;

/**
 * The factory's harness for one run: the `run_command` tool, and the checks, at the agent's stop and once more before the engine applies code. The engine runs
 * every command itself; the agent only learns what came out.
 */
export function harness(input: {
	commands: Record<string, string>;
	checks: string[];
	/** The agent has the `commands` tool. */
	agentCommands: boolean;
	execute: Execute;
	/**
	 * For an agent that edits files without a shell: commits exactly these files and discards the
	 * rest, offered as the `commit` tool. Rejects with why, for the agent.
	 */
	commit?: (change: { message: string; files: string[] }) => Promise<void>;
	/** What the agent left: the checks only judge changed code; they judge files, the engine pushes commits. */
	changed: () => Promise<{ uncommitted: boolean; ahead: number }>;
	log: (run: CommandRun) => void;
	now: () => Date;
	/**
	 * reviewed_by: at a stop with committed code that passes the checks, and a pull request or push
	 * proposed (`wanted`), the reviewer reads it; `needs_changes` goes back to the agent.
	 */
	review?: { wanted: () => boolean; reviews: InternalReview };
	/** How long a stop may take, in seconds: a review runs in it. */
	stopTimeoutSeconds?: number;
}) {
	const { commands, checks, execute, log, now } = input;
	let rounds = 0;
	// A pass at the agent's last stop is the engine's own run of the checks: no need to run them again.
	let passedAtStop = false;
	const review = input.review;

	async function run(
		kind: CommandRun["kind"],
		name: string,
		command: string,
		where: Execute = execute,
	) {
		const started = now();
		const result = await where(command);
		const entry: CommandRun = {
			kind,
			name,
			command,
			ok: result.ok,
			output: tail(result.output),
			durationMs: now().getTime() - started.getTime(),
			at: started.toISOString(),
		};
		log(entry);
		return entry;
	}

	/** The first failing check, or undefined when all pass. */
	async function runChecks(
		where: Execute = execute,
	): Promise<CommandRun | undefined> {
		for (const name of checks) {
			const result = await run("check", name, commands[name] ?? "", where);
			if (!result.ok) return result;
		}
		return undefined;
	}

	/** At the agent's stop: undefined lets it finish, a reason sends it back to work. */
	const check = async (): Promise<string | undefined> => {
		if (checks.length === 0 && !review) return undefined;
		const { uncommitted: dirty, ahead } = await input.changed();
		if (!dirty && ahead === 0) return undefined;
		if (checks.length > 0) {
			const failed = dirty ? undefined : await runChecks();
			if (dirty || failed) {
				if (rounds >= CHECK_ROUNDS) return undefined;
				rounds += 1;
				return failed
					? `The check "${failed.name}" failed (${failed.command}). Fix it, then finish.\n\n${failed.output}`
					: input.commit
						? UNCOMMITTED_TOOL
						: UNCOMMITTED;
			}
			passedAtStop = true;
		}
		// Uncommitted work is never reviewed: it is not what leaves, and nobody reading it, a person takes over.
		if (!review || dirty || !review.wanted()) return undefined;
		const round = await review.reviews.run();
		if (
			round.verdict !== "needs_changes" ||
			review.reviews.rounds.length >= review.reviews.limit
		)
			return undefined;
		return changesRequested(round, review.reviews.limit);
	};

	const names = Object.keys(commands);
	const tools =
		input.agentCommands && names.length > 0
			? [
					engineTool({
						name: "run_command",
						description: `Run one of the project's named commands in the working directory, and get the end of its output. Only these exist: ${Object.entries(
							commands,
						)
							.map(([n, c]) => `${n}: ${c}`)
							.join("; ")}.`,
						schema: { name: z.enum(names as [string, ...string[]]) },
						run: async ({ name }) => {
							const result = await run("command", name, commands[name] ?? "");
							return {
								text: `${name} ${result.ok ? "passed" : "failed"}.\n${result.output}`,
								...(result.ok ? {} : { isError: true }),
							};
						},
					}),
				]
			: [];

	const commit = input.commit;
	const commitTools = commit
		? [
				engineTool({
					name: "commit",
					description:
						"Commit the files you propose, with a message: only commits are published. Name every file of your change, relative to the working directory: every other change in the working directory is discarded, such as a working file a command wrote.",
					schema: {
						message: z.string().min(1),
						files: z.array(z.string().min(1)).min(1),
					},
					run: async (change) => {
						try {
							await commit(change);
							return {
								text: `Committed ${change.files.length} file${change.files.length === 1 ? "" : "s"}; every other change was discarded.`,
							};
						} catch (error) {
							return {
								text: `Nothing committed: ${errorText(error)}`,
								isError: true,
							};
						}
					},
				}),
			]
		: [];

	const stop: Stop = {
		check,
		// Any tool after a passing stop means the code may have changed: check it again.
		afterTool: () => {
			passedAtStop = false;
		},
		...(input.stopTimeoutSeconds
			? { timeoutSeconds: input.stopTimeoutSeconds }
			: {}),
	};

	return {
		tools: [...tools, ...commitTools],
		stop,
		/**
		 * Every check before a merge, where `where` runs them: undefined, or why one failed. No default:
		 * the agent's own worktree is never where a merge's checks run.
		 */
		async beforeMerge(where: Execute): Promise<string | undefined> {
			const failed = await runChecks(where);
			return failed && `the check "${failed.name}" failed (${failed.command})`;
		},
		/** The engine's decision before applying code: undefined, or why the code is refused. */
		async gate(): Promise<string | undefined> {
			if (checks.length === 0) return undefined;
			const { uncommitted, ahead } = await input.changed();
			if (!uncommitted && ahead === 0) return undefined;
			if (uncommitted)
				return "changes were left uncommitted: only commits are published";
			if (passedAtStop) return undefined;
			const failed = await runChecks();
			return failed && `the check "${failed.name}" failed (${failed.command})`;
		},
	};
}
