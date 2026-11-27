import { createHash } from "node:crypto";
import {
	appendFileSync,
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	type Factory,
	type FactoryFiles,
	isScript,
	loadFactory,
	type Problem,
	withAnswerMentions,
	withLearning,
	withWiki,
} from "@openfabriq/core";
import {
	jsonLines,
	readFactoryFolder,
	readJsonIfExists,
	writeFileAtomic,
} from "../files.js";

export interface ProjectState {
	repository: string;
	appliedAt: string;
	fingerprint: string;
}

export function home(): string {
	return process.env.OPENFABRIQ_HOME ?? join(homedir(), ".openfabriq");
}

/**
 * The engine's folder, closed to other users of the machine: transcripts, clones of private
 * repositories and chats are under it, and folders made without a mode are open to all (VULN-014).
 */
export function closeHome(): void {
	mkdirSync(home(), { recursive: true, mode: 0o700 });
	chmodSync(home(), 0o700);
}

/** The studio's chat token: a secret the agents' commands never read. Its file keeps its first name, viewer-token, so existing installs keep theirs. */
export const studioTokenPath = () => join(home(), "viewer-token");

export function projectDir(repository: string): string {
	return join(home(), "projects", ...repository.split("/"));
}

/** The folder of what a run kept: its transcript, commands, reviews, changed files. */
export const runDir = (repository: string, id: string) =>
	join(projectDir(repository), "runs", id);

/** A file a run kept, or undefined when it kept none. */
export function readRunFile(
	repository: string,
	id: string,
	name: string,
): string | undefined {
	const path = join(runDir(repository, id), name);
	return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

function readState(repository: string): ProjectState | undefined {
	return readJsonIfExists<ProjectState>(
		join(projectDir(repository), "state.json"),
	);
}

/** The copy of openfabriq/ made by the last apply: what the engine runs. */
export function readAppliedFiles(repository: string): FactoryFiles | undefined {
	const dir = join(projectDir(repository), "factory");
	return existsSync(dir) ? readFactoryFolder(dir) : undefined;
}

/**
 * The applied factory's files, the factory with the engine's wiki and learning agents when they are on and its
 * answer to mentions on the agents' pull requests, and
 * the problems found loading it; undefined when none is applied.
 */
export function loadApplied(
	repository: string,
): { files: FactoryFiles; factory?: Factory; problems: Problem[] } | undefined {
	const files = readAppliedFiles(repository);
	if (!files) return undefined;
	const { factory, problems } = loadFactory(files);
	return factory
		? {
				files,
				factory: withAnswerMentions(withLearning(withWiki(factory))),
				problems,
			}
		: { files, problems };
}

/** The applied factory, or undefined when none is applied or it no longer loads. */
export const readAppliedFactory = (repository: string): Factory | undefined =>
	loadApplied(repository)?.factory;

/** Why a repository has no factory to run, for people: none applied, or its first error. */
export function notLoadedText(
	repository: string,
	applied: ReturnType<typeof loadApplied>,
): string {
	const error = applied?.problems.find((p) => p.level === "error");
	return error
		? `The factory applied to ${repository} does not load: ${error.file}: ${error.message}. Run "openfabriq apply" again.`
		: `No factory is applied to ${repository}. Run "openfabriq apply" in its repository.`;
}

export function fingerprint(files: FactoryFiles): string {
	const hash = createHash("sha256");
	for (const path of Object.keys(files).sort())
		hash.update(`${path}\0${files[path]}\0`);
	return hash.digest("hex").slice(0, 12);
}

/** An apply of the factory: all of it by a person, or the rules of learning the engine applied on their own. */
export interface Apply {
	at: string;
	/** The lessons whose rule the engine applied alone; none for a person's apply. */
	lessons?: string[];
}

export function writeApplied(
	repository: string,
	files: FactoryFiles,
	now = new Date(),
	/** The engine applies learning's merged rules on their own: which lessons. */
	lessons?: string[],
): ProjectState {
	const dir = projectDir(repository);
	const staging = join(dir, "factory.new");
	rmSync(staging, { recursive: true, force: true });
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(staging, path)), { recursive: true });
		// Scripts run as files: their #! line says what runs them.
		writeFileSync(join(staging, path), content, {
			mode: isScript(path) ? 0o755 : 0o644,
		});
	}
	rmSync(join(dir, "factory"), { recursive: true, force: true });
	renameSync(staging, join(dir, "factory"));
	const state = {
		repository,
		appliedAt: now.toISOString(),
		fingerprint: fingerprint(files),
	};
	writeFileAtomic(
		join(dir, "state.json"),
		`${JSON.stringify(state, null, 2)}\n`,
	);
	// Every apply, kept: learning tells from it when a merged improvement started to run.
	appendFileSync(
		join(dir, "applies.jsonl"),
		`${JSON.stringify({ at: state.appliedAt, fingerprint: state.fingerprint, ...(lessons ? { lessons } : {}) })}\n`,
	);
	return state;
}

/** When the factory of a project was applied, oldest first: since the engine keeps them. */
export function readApplies(repository: string): Apply[] {
	const file = join(projectDir(repository), "applies.jsonl");
	return existsSync(file)
		? jsonLines<Apply>(readFileSync(file, "utf8")).map((a) => ({
				at: a.at,
				...(a.lessons ? { lessons: a.lessons } : {}),
			}))
		: [];
}

export function listProjects(): ProjectState[] {
	const root = join(home(), "projects");
	if (!existsSync(root)) return [];
	// Folders only: a .DS_Store is not a project.
	const folders = (dir: string) =>
		readdirSync(dir, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name);
	return folders(root)
		.flatMap((owner) =>
			folders(join(root, owner)).map((name) => readState(`${owner}/${name}`)),
		)
		.filter((state): state is ProjectState => state !== undefined);
}
