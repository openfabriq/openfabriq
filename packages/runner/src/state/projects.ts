import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
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

export function writeApplied(
	repository: string,
	files: FactoryFiles,
	now = new Date(),
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
	return state;
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
