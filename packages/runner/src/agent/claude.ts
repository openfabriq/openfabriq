import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
	createSdkMcpServer,
	type HookCallback,
	type HookCallbackMatcher,
	type HookEvent,
	type Options,
	query,
	type SandboxSettings,
	type SDKResultMessage,
	type SDKSystemMessage,
	tool,
} from "@anthropic-ai/claude-agent-sdk";
import {
	describeTool,
	networkSites,
	OUTPUT_TOOL_PREFIX,
	type Tool,
} from "@openfabriq/core";
import { errorText } from "../files.js";
import { engineSecretPaths } from "../state/secrets.js";
import { prepareClaudeAuth } from "./env.js";
import { insideOnly, realPath, webInNetwork } from "./guard.js";
import { lockedDownOptions } from "./locked-down.js";
import { claudeMcpTools, unavailableMcp } from "./mcp.js";
import type {
	AgentLauncher,
	AgentResult,
	AgentRun,
	EngineTool,
	Stop,
} from "./port.js";
import { repoSettings } from "./repo-settings.js";
import { runTemp, settingsFolder, shellSandbox } from "./sandbox.js";

/** The engine's tools, served to Claude Code as the openfabriq MCP server: mcp__openfabriq__<tool>. */
export function claudeTools(tools: EngineTool[]) {
	return {
		server: createSdkMcpServer({
			name: "openfabriq",
			tools: tools.map((t) =>
				tool(t.name, t.description, t.schema, async (args) => {
					const answer = await t.run(args);
					return {
						content: [{ type: "text" as const, text: answer.text }],
						...(answer.isError ? { isError: true } : {}),
					};
				}),
			),
		}),
		names: tools.map((t) => `${OUTPUT_TOOL_PREFIX}${t.name}`),
	};
}

/** The factory's harness as Claude Code hooks: a stop it refuses with the reason, and any tool after it. */
export function claudeHooks(
	stop: Stop,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
	return {
		PostToolUse: [
			{
				hooks: [
					async () => {
						stop.afterTool();
						return {};
					},
				],
			},
		],
		Stop: [
			{
				hooks: [
					async () => {
						const reason = await stop.check();
						return reason === undefined ? {} : { decision: "block", reason };
					},
				],
				...(stop.timeoutSeconds ? { timeout: stop.timeoutSeconds } : {}),
			},
		],
	};
}

const TOOLS: Record<Tool, string[]> = {
	read: ["Read", "Grep", "Glob"],
	edit: ["Edit", "Write"],
	shell: ["Bash"],
	web: ["WebFetch", "WebSearch"],
	// The engine's run_command tool, served with the output tools.
	commands: [],
};

/**
 * Pre-approved under dontAsk. Read, Grep and Glob are not: pre-approved, they read outside the
 * working directory; without, dontAsk lets them read inside it only.
 */
const PRE_APPROVED = new Set([
	"Edit",
	"Write",
	"Bash",
	"WebFetch",
	"WebSearch",
]);

let claudePath: string | undefined;
export const claudeExecutable = () => {
	claudePath ??= spawnSync("which", ["claude"], {
		encoding: "utf8",
	}).stdout.trim();
	return claudePath;
};

export const claudeAgent: AgentLauncher = async (run) => {
	const repo = repoSettings(
		run.cwd,
		run.env,
		run.tools.includes("web") && run.network !== "any",
	);
	if (repo.refused)
		return {
			status: "failed",
			reason: repo.refused,
			costUsd: 0,
			turns: 0,
			tokens: { input: 0, output: 0 },
		};
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), run.timeoutMs);
	let temp: string | undefined;
	let init: SDKSystemMessage | undefined;
	let result: SDKResultMessage | undefined;
	let caught: Caught | undefined;
	let reachedModel = false;
	try {
		const auth = prepareClaudeAuth(run.env);
		// The run's own temp folder: Claude Code's default, /tmp/claude-<uid>, is shared by every run and
		// every Claude Code session of the user (VULN-013).
		temp = runTemp();
		mkdirSync(settingsFolder(temp));
		const plugin = run.plugin ? [realPath(run.plugin)] : [];
		try {
			const options = queryOptions(run, {
				executable: claudeExecutable(),
				auth,
				repoEnv: repo.env,
				temp,
				plugin,
				// Bash runs in Claude Code's sandbox: it cannot read the engine's secrets.
				...(run.tools.includes("shell")
					? {
							sandbox: shellSandbox(
								run.cwd,
								temp,
								engineSecretPaths(),
								run.network,
							),
						}
					: {}),
				// Read also the run's own temp folder: on Linux the shell leaves its screenshots there, and Read is how
				// the agent sees an image. On macOS that path is too long for Claude Code, which uses the shared one.
				guard: insideOnly(run.cwd, [...plugin, temp]),
				abort,
			});
			for await (const message of query({ prompt: run.prompt, options })) {
				appendFileSync(run.transcript, `${JSON.stringify(message)}\n`);
				if (message.type === "system" && message.subtype === "init")
					init = message;
				if (message.type === "result") result = message;
				if (message.type === "assistant") reachedModel = true;
				if (message.type === "assistant" && run.onStep)
					for (const block of message.message.content)
						if (block.type === "tool_use")
							run.onStep(describeTool(block.name, block.input));
			}
		} catch (error) {
			caught = { error, aborted: abort.signal.aborted };
		}
	} finally {
		clearTimeout(timer);
		if (temp) rmSync(temp, { recursive: true, force: true });
	}
	return agentResult(run, {
		...(init ? { init } : {}),
		...(result ? { result } : {}),
		...(caught ? { caught } : {}),
		reachedModel,
	});
};

/** Why Claude Code stopped before its end: the run's time limit aborted it, or an error. */
interface Caught {
	error: unknown;
	aborted: boolean;
}

/**
 * What Claude Code is started with for a run. `plugin` is the factory's plugin folder, as a real
 * path; `guard` keeps the file tools inside the worktree; `sandbox` is for an agent with shell.
 */
export function queryOptions(
	run: AgentRun,
	given: {
		executable: string;
		auth: { env: Record<string, string>; apiKeyHelper?: string };
		repoEnv: Record<string, string>;
		temp: string;
		plugin: string[];
		sandbox?: SandboxSettings;
		guard: HookCallback;
		abort: AbortController;
	},
): Options {
	const { auth, temp, plugin } = given;
	const sites = networkSites(run.network);
	// A search sends the agent's words to any site's index: only for an agent that reaches any site.
	const builtIn = run.tools
		.flatMap((t) => TOOLS[t])
		.filter((t) => t !== "WebSearch" || sites === "any");
	// WebFetch is not in the shell's sandbox: its permission rules keep it to the agent's sites.
	const preApproved = builtIn
		.filter((t) => PRE_APPROVED.has(t))
		.flatMap((t) =>
			t === "WebFetch" && sites !== "any"
				? sites.map((site) => `WebFetch(domain:${site})`)
				: [t],
		);
	// The run's temp folder, where the shell leaves its screenshots: blockReadsExemptPaths lets Read
	// there but allows nothing, and under dontAsk only an allow rule does ("//" is the filesystem's root).
	if (builtIn.includes("Read")) preApproved.push(`Read(/${temp}/**)`);
	// So are the files beside a skill's SKILL.md (its references, its examples), by the path Claude
	// Code names the skill's folder with and by its real one: /var is a link to /private/var on macOS.
	if (builtIn.includes("Read"))
		for (const folder of new Set([
			...plugin,
			...(run.plugin ? [resolve(run.plugin)] : []),
		]))
			preApproved.push(`Read(/${folder}/**)`);
	const outputs = claudeTools(run.outputs.tools);
	const hooks = run.stop ? claudeHooks(run.stop) : undefined;
	// The repo's hooks never run, even for a read-only agent: they come from the pull request's branch.
	return lockedDownOptions(
		{
			where: {
				pathToClaudeCodeExecutable: given.executable,
				cwd: run.cwd,
				env: {
					...auth.env,
					CLAUDE_CODE_TMPDIR: temp,
					XDG_CONFIG_HOME: settingsFolder(temp),
				},
			},
			// File tools stay in the worktree; the repo's env cannot set Claude Code's own.
			settings: {
				// The engine signs what it writes: Claude Code's own line would repeat it in every pull request,
				// and its Co-Authored-By trailer in every commit.
				attribution: { commit: "", pr: "", sessionUrl: false },
				// The shell's sandbox gives the network through HTTPS_PROXY only, which Node's fetch ignores without this.
				env: {
					...given.repoEnv,
					...(given.sandbox ? { NODE_USE_ENV_PROXY: "1" } : {}),
				},
				// Reads only: blockWritesOutsideWorkingDirectories let a pre-approved Write out. The run's temp
				// folder is exempt, as in the guard: Read is how the agent sees the shell's screenshots there.
				permissions: {
					blockReadsOutsideWorkingDirectories: true,
					blockReadsExemptPaths: [...plugin, temp],
				},
			},
			session: {
				...(given.sandbox ? { sandbox: given.sandbox } : {}),
				hooks: {
					...hooks,
					PreToolUse: [
						...(hooks?.PreToolUse ?? []),
						{ hooks: [given.guard] },
						...(builtIn.includes("WebFetch") && sites !== "any"
							? [{ hooks: [webInNetwork(run.network, run.onRefused)] }]
							: []),
					],
				},
				systemPrompt: {
					type: "preset",
					preset: "claude_code",
					append: run.instructions,
				},
				model: run.model,
				// Without Skill, the factory's skills are loaded but the agent cannot open them.
				tools: run.plugin ? [...builtIn, "Skill"] : builtIn,
				allowedTools: [
					...preApproved,
					...outputs.names,
					// Only the tools the agent lists: under dontAsk, its servers' other tools are refused.
					...(run.mcp ? claudeMcpTools(run.mcp) : []),
				],
				...(run.plugin ? { skills: "all" as const } : {}),
				mcpServers: { ...run.mcp?.servers, openfabriq: outputs.server },
				plugins: run.plugin ? [{ type: "local", path: run.plugin }] : [],
			},
			limits: { maxBudgetUsd: run.budgetUsd, persistSession: false },
			control: { abortController: given.abort },
		},
		auth,
	);
}

/** How the run went, from what Claude Code said (its init and its result) or why it stopped. */
export function agentResult(
	run: Pick<AgentRun, "budgetUsd" | "timeoutMs" | "mcp">,
	ended: {
		init?: SDKSystemMessage;
		result?: SDKResultMessage;
		caught?: Caught;
		/** Claude Code answered at least once: the session spent money, even without a result. */
		reachedModel?: boolean;
	},
): AgentResult {
	const { init, result, caught } = ended;
	let reason = caught
		? caught.aborted
			? `stopped after ${Math.round(run.timeoutMs / 60000)} minutes (minutes_per_run)`
			: errorText(caught.error)
		: undefined;
	const usage = Object.values(result?.modelUsage ?? {});
	const failed = result?.subtype !== "success" || reason !== undefined;
	const mcpUnavailable = run.mcp ? unavailableMcp(run.mcp, init) : [];
	if (!reason && !result) reason = "Claude Code ended without a result";
	if (!reason && result && result.subtype !== "success")
		reason =
			result.subtype === "error_max_budget_usd"
				? `stopped at the cost limit of ${run.budgetUsd} USD (usd_per_run)`
				: `${result.subtype}${result.errors.length ? `: ${result.errors.join("; ")}` : ""}`;
	return {
		status: failed ? "failed" : "succeeded",
		...(reason ? { reason } : {}),
		// Stopped without a result, a session that reached the model counts its whole budget: what it spent is unknown.
		costUsd: result?.total_cost_usd ?? (ended.reachedModel ? run.budgetUsd : 0),
		turns: result?.num_turns ?? 0,
		tokens: {
			input: usage.reduce(
				(s, u) =>
					s +
					u.inputTokens +
					u.cacheReadInputTokens +
					u.cacheCreationInputTokens,
				0,
			),
			output: usage.reduce((s, u) => s + u.outputTokens, 0),
		},
		...(init?.model ? { model: init.model } : {}),
		...(mcpUnavailable.length ? { mcpUnavailable } : {}),
	};
}
