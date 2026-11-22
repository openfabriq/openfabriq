import { join } from "node:path";
import {
	IMPORTED_SKILLS,
	machineNeeds,
	readImportedSkills,
	sentenceList,
	skillPlace,
	unlistedSites,
} from "@openfabriq/core";
import {
	errorText,
	exec,
	type GitHubApp,
	githubApp,
	recentRefusals,
	skillFiles,
	skillHash,
} from "@openfabriq/runner";
import type { CommandResult } from "../result.js";
import { secretWarnings } from "../secret-warnings.js";
import { missingPrerequisites } from "./prerequisites.js";
import { checkFactoryFolder } from "./validate.js";

// What this machine lacks for the factory: read only, it installs and runs nothing of the factory.

/** On Linux, the agents' shell and the commands run in bubblewrap's sandbox: program → apt package. */
const LINUX_SANDBOX = { bwrap: "bubblewrap", socat: "socat", rg: "ripgrep" };

export async function doctorCommand(
	dir: string,
	run = exec,
	platform = process.platform,
	app:
		| Pick<GitHubApp, "installed" | "login" | "installUrl">
		| undefined = githubApp(),
): Promise<CommandResult> {
	// The shell's own lookup: PATH, and builtins such as cd or test.
	const found = (program: string) =>
		run("sh", ["-c", 'command -v "$1"', "sh", program]).then(
			() => true,
			() => false,
		);
	// Sentences, each with the command that fixes it.
	const lacking = await missingPrerequisites(run, app !== undefined);
	if (platform === "linux") {
		const absent = [];
		for (const [program, apt] of Object.entries(LINUX_SANDBOX))
			if (!(await found(program))) absent.push(apt);
		if (absent.length > 0)
			lacking.push(
				`The sandbox of the agents' shell and the commands needs ${sentenceList(absent)}: sudo apt install ${absent.join(" ")}`,
			);
	}
	const lines = lacking.length
		? lacking.map((line) => `✗ ${line}`)
		: ["✓ Claude Code, the GitHub CLI and git are ready"];

	const notInstalled: string[] = [];
	const checked = checkFactoryFolder(dir);
	if (!checked.ok) lines.push("", checked.result.output);
	else {
		const { folder, factory, files } = checked;
		if (app) {
			const line = await appLine(app, factory.repository);
			if (line.startsWith("✗")) lacking.push(line);
			lines.push(line);
		}
		const needs = machineNeeds(factory, files);
		const there: string[] = [];
		for (const [program, where] of Object.entries(needs.programs).sort())
			if (await found(program)) there.push(program);
			else {
				notInstalled.push(program);
				lines.push(
					`✗ ${program} is not installed: ${sentenceList(where)} run${where.length === 1 ? "s" : ""} it`,
				);
			}
		if (there.length) lines.push(`✓ found ${sentenceList(there)}`);
		// A secret is set after apply: said, not a failure.
		for (const line of secretWarnings([factory])) lines.push(`! ${line}`);
		lines.push(...networkLines(factory, files));
		// A skill whose programs are all there is said ready in a line; the others keep their own words.
		const unsure: [string, string][] = [];
		for (const [skill, text] of Object.entries(needs.skills)) {
			const own = Object.entries(needs.programs)
				.filter(([, where]) => where.includes(skill))
				.map(([program]) => program);
			if (own.length && own.every((p) => there.includes(p)))
				lines.push(
					`✓ ${skill}: ${sentenceList(own)} ${own.length === 1 ? "is" : "are"} installed`,
				);
			else unsure.push([skill, text]);
		}
		if (unsure.length)
			lines.push(
				"",
				"The skills say what they need (doctor looks up the programs they install; check the rest yourself):",
				...unsure.map(([skill, text]) => `! ${skill}: ${text}`),
			);
		lines.push(...(await importedSkillLines(folder, files, run)));
		lines.push(
			"",
			lacking.length || notInstalled.length
				? `This machine lacks what is marked ✗ for ${folder}. Install it, then run "openfabriq doctor" again.`
				: `This machine has the programs ${folder} runs.`,
		);
	}
	return {
		code: lacking.length || notInstalled.length || !checked.ok ? 1 : 0,
		output: lines.join("\n"),
	};
}

/** As a GitHub App: whether it is installed on the factory's repository. */
async function appLine(
	app: Pick<GitHubApp, "installed" | "login" | "installUrl">,
	repository: string,
): Promise<string> {
	try {
		const login = await app.login();
		return (await app.installed(repository))
			? `✓ GitHub: the engine works as the app ${login}, installed on ${repository}`
			: `✗ GitHub: the app ${login} is not installed on ${repository}: install it at ${await app.installUrl()}`;
	} catch (error) {
		return `✗ GitHub: the app's key does not work (${errorText(error)}): check GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY, or run "openfabriq connect github" again`;
	}
}

/**
 * The sites the factory names and its network does not reach, then those its last runs were
 * refused: said, not a failure, since a site may be named without being called.
 */
function networkLines(
	factory: Parameters<typeof unlistedSites>[0],
	files: Parameters<typeof unlistedSites>[1],
): string[] {
	const named = Object.entries(unlistedSites(factory, files)).map(
		([site, where]) =>
			`! ${site} is in ${sentenceList(where)}, but network does not reach it: add it to network if the factory calls it`,
	);
	const refused = recentRefusals(factory.repository).map(
		({ site, runs, lastRun }) =>
			`! ${site} was refused in ${runs} of the last runs (latest: ${lastRun}): add it to network if the factory needs it`,
	);
	return named.length || refused.length
		? [...named, ...refused]
		: [
				"✓ network reaches every site the factory names, and no site was refused in its last runs",
			];
}

/**
 * Each imported skill: changed by hand since it was imported, and with a newer version upstream.
 * Said, not a failure: GitHub may be out of reach, and an update is a pull request of its own.
 */
async function importedSkillLines(
	folder: string,
	files: Record<string, string>,
	run: typeof exec,
): Promise<string[]> {
	const text = files[IMPORTED_SKILLS];
	const read = text === undefined ? undefined : readImportedSkills(text);
	// validate has said what is wrong with the file.
	if (!read || Array.isArray(read)) return [];
	const lines: string[] = [];
	for (const [key, entry] of Object.entries(read.skills).sort()) {
		const { source, ref, commit, skillPath } = entry;
		const edited =
			skillHash(skillFiles(join(folder, key))) !== entry.computedHash;
		if (edited)
			lines.push(
				`! ${key}: changed since it was imported from ${source}: put it back as it was, and adapt it in the agent's own body instead; "openfabriq skill update" will not update it until then`,
			);
		// The skill's folder in its repository; a skill at the root is the whole repository.
		const path = skillPath.includes("/")
			? skillPath.slice(0, skillPath.lastIndexOf("/"))
			: "";
		const lastCommitOnSkill = (at: string) =>
			run("gh", [
				"api",
				`repos/${source}/commits?sha=${encodeURIComponent(at)}&per_page=1${path ? `&path=${encodeURIComponent(path)}` : ""}`,
				"-q",
				'.[0].sha // ""',
			]).then((out) => out.trim());
		try {
			const latest = await lastCommitOnSkill(ref);
			const pinned = await lastCommitOnSkill(commit);
			if (!latest)
				lines.push(`! ${key}: ${source} no longer has ${skillPath} on ${ref}`);
			else if (latest !== pinned)
				lines.push(
					`! ${key}: ${source} has a newer version on ${ref}: run "openfabriq skill update ${skillPlace(key)?.name ?? key}" for a pull request that updates it`,
				);
			else if (!edited)
				lines.push(`✓ ${key}: as imported from ${source}, and up to date`);
		} catch (error) {
			lines.push(
				`! ${key}: could not ask ${source} for a newer version (${errorText(error).split("\n")[0]})`,
			);
		}
	}
	return lines;
}
