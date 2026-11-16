import { readFileSync, rmSync } from "node:fs";
import {
	claudeAgent,
	claudeKeyPath,
	claudeLogin,
	closeHome,
	gh,
	githubApp,
	listProjects,
	readAppliedFactory,
	readSecrets,
	readWiki,
	startEngine,
	studioTokenPath,
	workspace,
} from "@openfabriq/runner";
import { startStudio, studioAccess } from "@openfabriq/studio";
import type { CommandLine } from "../../args.js";
import type { CommandResult } from "../../result.js";
import { secretWarnings } from "../../secret-warnings.js";
import { dim, paint, styled } from "../../ui.js";
import { type ApplyDeps, applyBeforeStart } from "../apply/index.js";
import { updateNotice } from "../update.js";
import {
	announce,
	plainStartLines,
	type StartFacts,
	signInAddress,
	wikiHint,
} from "./banner.js";
import { linearNotes, serviceClients } from "./connections.js";
import { keepAwake } from "./keep-awake.js";
import {
	gitIdentity,
	lockHome,
	readStartOptions,
	refusePortTaken,
} from "./preflight.js";

// openfabriq start: applies what changed in this repository, after a yes, then watches GitHub
// and runs the applied factories, with the studio, until Ctrl-C.

export async function startCommand(
	{ dir, values }: CommandLine,
	deps: ApplyDeps,
): Promise<CommandResult> {
	// A wrong option or a taken port stops here, before the plan asks for a yes.
	const options = await readStartOptions(values);
	const applied = await applyBeforeStart(dir, deps);
	if (applied) deps.print(`${applied}\n`);
	await start(options);
	return { code: 0, output: "" };
}

/** A line of the engine's log, after the time. */
function log(line: string) {
	const time = new Date().toLocaleTimeString();
	console.log(styled ? `${dim(time)} ${paint(line)}` : `${time} ${line}`);
}

async function start(options: {
	intervalMs?: number;
	maxRuns?: number;
	port: number;
}): Promise<void> {
	const { port, ...engineOptions } = options;
	// A bad password or address stops the engine before it starts, not the studio once it runs.
	const access = studioAccess(process.env);
	if (access.github && !githubApp())
		throw new Error(
			'sign-in with GitHub goes through the engine\'s GitHub App: set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY, or run "openfabriq connect github"',
		);
	// Again: the yes to the plan may have taken a while.
	await refusePortTaken(port);
	closeHome();
	const unlock = lockHome();
	process.once("exit", unlock);
	const projects = listProjects();
	if (projects.length === 0)
		throw new Error(
			'no project yet. Run "openfabriq apply" in a repository first.',
		);
	const identity = await gitIdentity();
	// The studio starts first; a run asked before the engine exists is taken at its first tick.
	let engine: ReturnType<typeof startEngine> | undefined;
	const studio = startStudio(port, undefined, {
		access,
		wake: () => engine?.wake(),
	});
	const signIn = signInAddress(access, port);
	await new Promise((resolve) => studio.once("listening", resolve));
	const facts: StartFacts = {
		// The address with the token is the only way into the studio: it becomes a cookie there.
		address: `http://127.0.0.1:${port}/?token=${readFileSync(studioTokenPath(), "utf8")}`,
		watching: projects.map((p) => p.repository),
		everySeconds: Math.round((options.intervalMs ?? 60_000) / 1000),
		claude: claudeLogin(),
		...(signIn ? { signIn } : {}),
	};
	// In a terminal, the studio's address leads, apart from the log; a pipe or Docker keeps the lines.
	if (styled) announce(facts);
	const awake = keepAwake();
	engine = startEngine({
		github: gh,
		launch: claudeAgent,
		workspace,
		identity,
		log,
		...(awake ? { keepAwake: awake } : {}),
		...connectServices(projects),
		...engineOptions,
	});
	if (!styled) for (const line of plainStartLines(facts)) log(line);
	// The key's file lives only as long as the engine has a key.
	if (!process.env.ANTHROPIC_API_KEY) rmSync(claudeKeyPath(), { force: true });
	engine.start();
	for (const { repository } of projects)
		void readWiki(repository)
			.then((view) => wikiHint(repository, view))
			.then(
				(line) => line && log(line),
				() => undefined,
			);
	// Never in the way: a slow or offline registry says nothing.
	void updateNotice().then((line) => line && log(`update: ${line}`));
	await untilInterrupted(engine, studio);
}

/** The clients of the services the applied factories listen to; logs what is missing first. */
function connectServices(projects: { repository: string }[]) {
	const factories = projects.flatMap(
		(p) => readAppliedFactory(p.repository) ?? [],
	);
	const secrets = readSecrets();
	for (const line of secretWarnings(factories)) log(line);
	const { clients, notes } = serviceClients(factories, secrets);
	for (const line of notes) log(line);
	void linearNotes(factories, clients.relay).then((lines) => {
		for (const line of lines) log(line);
	});
	return clients;
}

/** Until Ctrl-C: then no new run starts, and the studio closes. */
function untilInterrupted(
	engine: ReturnType<typeof startEngine>,
	studio: ReturnType<typeof startStudio>,
): Promise<void> {
	return new Promise<void>((resolve) => {
		process.once("SIGINT", () => {
			engine.stop();
			studio.close();
			log("stopped watching; running runs finish first");
			resolve();
		});
	});
}
