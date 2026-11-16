#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { errorText, gh, localGit } from "@openfabriq/runner";
import { type CommandLine, readCommandLine, reportsHowItWent } from "./args.js";
import {
	type ApplyDeps,
	applyCommand,
	planCommand,
} from "./commands/apply/index.js";
import { connectCommand } from "./commands/connect/index.js";
import { doctorCommand } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { mcpCommand } from "./commands/mcp.js";
import { checkPrerequisites, ghLogin } from "./commands/prerequisites.js";
import { runCommand } from "./commands/run.js";
import { secretCommand } from "./commands/secret.js";
import { startCommand } from "./commands/start/index.js";
import { statusCommand } from "./commands/status.js";
import { updateCommand } from "./commands/update.js";
import { validateCommand } from "./commands/validate.js";
import { nodeTooOld } from "./node-version.js";
import { PACKAGE_JSON } from "./paths.js";
import { copyToClipboard, terminalAsk, terminalConfirm } from "./prompts.js";
import type { CommandResult } from "./result.js";
import { canAsk, header, outcome, paintUsage, print, styled } from "./ui.js";

const USAGE = `Usage: openfabriq <command> [folder]

Commands:
  init [folder] [--example name]
                           set up openfabriq/ in a conversation with Claude Code,
                           or copy an example without AI (see examples/: 01-quickstart, 02-sdlc…)
  validate [folder]        check the openfabriq/ files
  doctor [folder]          say what this machine lacks to run the factory; installs nothing
  plan [folder]            show what apply would change, security first
  apply [folder] [--yes] [--project owner/repo]
                           apply the plan: labels on GitHub, then this machine runs the factory;
                           with --project, refuse a factory.yaml that names another repository
  start [folder] [--interval s] [--port n]
                           watch GitHub and run the applied factories every 60 s (Ctrl-C to stop),
                           and serve the studio on 127.0.0.1:4310 (or --port); in a repository,
                           first applies what changed, after a yes
  run <automation> [--issue n | --pr n] [--project owner/repo]
                           ask "start" to run an automation now (a manual run)
  status                   runs in progress, waiting and recent
  mcp                      the factories, runs, numbers and board, read only, for an MCP
                           client such as Claude Code or Claude Desktop (stdio)
  connect github [--org name] [--workflows] [--url u]
                           create your team's GitHub App for the engine, instead of a person's
                           login or token: a token per repository; --workflows lets it push CI files;
                           --url, the studio's https address, for sign-in with GitHub
  connect github token <owner/repo>
                           print the app's token for one repository, valid for an hour
  connect relay [--url u]  deploy the relay on your Cloudflare account, or check one already
                           running at u (on Cloudflare or self-hosted): its token is asked
  connect slack|linear|sentry  connect a service through the relay: everything it sends waits
                           there, even while this machine sleeps
  connect webhook <name>   let the relay receive a webhook of factory.yaml; --remove to stop
  secret set <NAME> [--project owner/repo]
                           keep the value of a secret the factory declares, on this machine only
  update                   install the latest openfabriq, or say how when it came another way
  --version, -v            print the installed version

[folder] is a repository root or its openfabriq/ folder (default: current folder).`;

async function main(line: CommandLine): Promise<CommandResult> {
	const { command, dir, positionals, values } = line;
	if (values.version)
		return {
			code: 0,
			output: `openfabriq ${(JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as { version: string }).version}`,
		};
	// The mark and the name, where a command starts a conversation or a long run, and over the usage.
	if (styled && ["init", "start", "connect", undefined].includes(command))
		console.log(header(command && [command, positionals[1]].join(" ").trim()));
	// validate, doctor, status, connect and init --example work without Claude Code or GitHub.
	if (
		["plan", "apply", "start", "run"].includes(command ?? "") ||
		(command === "init" && !values.example)
	) {
		const missing = await checkPrerequisites({
			interactive: canAsk,
			confirm: terminalConfirm,
			ghLogin,
		});
		if (missing) return missing;
	}
	const deps: ApplyDeps = {
		github: gh,
		git: localGit,
		confirm: terminalConfirm,
		print,
	};
	switch (command) {
		case "init":
			return initCommand(dir, values.example);
		case "validate":
			return validateCommand(dir);
		case "doctor":
			return doctorCommand(dir);
		case "plan":
			return planCommand(dir, deps);
		case "apply":
			return applyCommand(dir, deps, values.yes, values.project);
		case "start":
			return startCommand(line, deps);
		case "status":
			return statusCommand();
		case "mcp":
			return mcpCommand();
		case "update":
			return updateCommand();
		case "run":
			return runCommand(line);
		case "connect":
			return connectCommand(
				positionals[1],
				{
					ask: terminalAsk,
					print,
					copy: copyToClipboard,
				},
				{
					...(values.url ? { url: values.url } : {}),
					remove: values.remove,
					...(positionals[2] ? { name: positionals[2] } : {}),
					...(positionals[3] ? { repository: positionals[3] } : {}),
					...(values.org ? { org: values.org } : {}),
					workflows: values.workflows,
				},
			);
		case "secret":
			return secretCommand(
				{
					action: positionals[1],
					name: positionals[2],
					extra: positionals.slice(3),
					...(values.project ? { project: values.project } : {}),
				},
				{ ask: terminalAsk, env: process.env },
			);
		default:
			return { code: command ? 1 : 0, output: USAGE };
	}
}

(async () => {
	const line = readCommandLine(process.argv.slice(2));
	const tooOld = nodeTooOld(process.versions.node);
	if (tooOld)
		return { command: line.command, result: { code: 1, output: tooOld } };
	return { command: line.command, result: await main(line) };
})().then(
	({ command, result }) => {
		console.log(
			!styled
				? result.output
				: result.output === USAGE
					? paintUsage(USAGE)
					: outcome(result, reportsHowItWent(command)),
		);
		process.exitCode = result.code;
	},
	(error: unknown) => {
		const message = `openfabriq: ${errorText(error)}`;
		console.error(
			styled ? outcome({ code: 1, output: message }, true) : message,
		);
		process.exitCode = 1;
	},
);
