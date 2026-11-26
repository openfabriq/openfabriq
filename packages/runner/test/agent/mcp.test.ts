import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFactory } from "@openfabriq/core";
import { describe, expect, it } from "vitest";
import {
	agentMcp,
	claudeMcpTools,
	unavailableMcp,
} from "../../src/agent/mcp.js";

const { factory, problems } = loadFactory({
	"factory.yaml":
		"name: F\nrepository: acme/app\nmaintainers: [alice]\nsecrets: [MCP_TOKEN, DB_URL, ABSENT]\nmcp:\n  sentry:\n    url: https://mcp.sentry.dev/mcp\n    secret: MCP_TOKEN\n  db:\n    command: npx -y server-postgres --read-only\n    secrets: [DB_URL, ABSENT]\n  docs:\n    url: https://docs.dev/mcp\n    secret: ABSENT\n  unused:\n    url: https://unused.dev/mcp\n",
	"agents/worker/agent.md":
		"---\ndescription: Works\nmcp:\n  sentry: [get_issue, search_issues]\n  db: [query]\n  docs: [search]\n---\nWork.\n",
	"agents/plain/agent.md": "---\ndescription: Plain\n---\nWork.\n",
	"automations/a/automation.md":
		"---\nwhen: issue.opened\nagent: worker\n---\nGo.\n",
	"automations/b/automation.md":
		"---\nwhen: issue.opened\nagent: plain\n---\nGo.\n",
});
if (!factory) throw new Error(JSON.stringify(problems));
const values = { MCP_TOKEN: "tok", DB_URL: "postgres://x", OTHER: "no" };
// No project secrets file: the values come from the environment given.
process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));

const sandboxed = async (command: string) => `sandboxed: ${command}`;

describe("an agent's MCP servers", () => {
	it("gives the agent only the servers it names, with their secrets, and lists its tools", async () => {
		const mcp = await agentMcp(
			factory.agents.worker as never,
			factory,
			{ PATH: "/bin" },
			sandboxed,
			values,
		);
		expect(mcp).toEqual({
			servers: {
				sentry: {
					type: "http",
					url: "https://mcp.sentry.dev/mcp",
					headers: { Authorization: "Bearer tok" },
				},
				db: {
					command: "sh",
					// In the sandbox of the engine's commands, never from the worktree (VULN-011).
					args: ["-c", "sandboxed: npx -y server-postgres --read-only"],
					env: { PATH: "/bin", DB_URL: "postgres://x" },
				},
				// A secret missing on the machine: no header; start already names it.
				docs: { type: "http", url: "https://docs.dev/mcp" },
			},
			tools: {
				sentry: ["get_issue", "search_issues"],
				db: ["query"],
				docs: ["search"],
			},
		});
		expect(
			await agentMcp(
				factory.agents.plain as never,
				factory,
				{},
				sandboxed,
				values,
			),
		).toBeUndefined();
	});

	it("names the servers that did not connect and the tools they do not offer", async () => {
		const mcp = await agentMcp(
			factory.agents.worker as never,
			factory,
			{},
			sandboxed,
			values,
		);
		if (!mcp) throw new Error("no mcp");
		// As Claude Code names them: what the adapter allows.
		expect(claudeMcpTools(mcp)).toEqual([
			"mcp__sentry__get_issue",
			"mcp__sentry__search_issues",
			"mcp__db__query",
			"mcp__docs__search",
		]);
		expect(
			unavailableMcp(mcp, {
				tools: ["Read", "mcp__sentry__get_issue", "mcp__db__query"],
				mcp_servers: [
					{ name: "openfabriq", status: "connected" },
					{ name: "sentry", status: "connected" },
					{ name: "db", status: "connected" },
					{ name: "docs", status: "failed" },
				],
			}),
		).toEqual(["docs (failed)", "sentry.search_issues", "docs.search"]);
		expect(unavailableMcp(mcp, undefined)).toEqual([]);
	});
});
