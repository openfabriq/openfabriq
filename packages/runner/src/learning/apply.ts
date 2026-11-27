import { join } from "node:path";
import {
	type FactoryFiles,
	loadFactory,
	rawFrontMatter,
} from "@openfabriq/core";
import { readFactoryFolder } from "../files.js";
import type { GitHub } from "../github/github.js";
import { projectDir, readApplies, writeApplied } from "../state/projects.js";
import {
	appliedAt,
	isImprovable,
	keepsFrontMatter,
	type Lesson,
	pullState,
	readLessons,
	resolvedByPullRequest,
	saveLessons,
} from "./lessons.js";

// A rule of learning applies once a person merges its pull request: the engine applies the rule
// and nothing else, its file as the merge commit has it, when the applied factory has that file as
// it was just before the merge. Any other change, of that file or of the rest of openfabriq/,
// waits for a person's `openfabriq apply`. Merging was the review: the guard already made sure
// the pull request changes only text, never a front matter.

const FOLDER = "openfabriq/";

/**
 * The applied factory with a merged rule's file as its merge commit has it, or why the rule cannot
 * apply on its own: not a file learning improves, not in the applied factory, a file that changed
 * since the factory was applied (the merge would bring that change too), a front matter that the
 * pull request changed, or a factory that would not load.
 */
export function withMergedRule(
	applied: FactoryFiles,
	target: string,
	/** The file just before the merge, and at the merge commit. */
	file: { before: string | undefined; merged: string | undefined },
): FactoryFiles | { problem: string } {
	if (!target.startsWith(FOLDER) || !isImprovable(target))
		return { problem: `${target} is not a file learning improves` };
	const path = target.slice(FOLDER.length);
	const current = applied[path];
	if (current === undefined)
		return { problem: `${target} is not in the applied factory` };
	if (file.merged === undefined)
		return { problem: `${target} is not in the merge commit` };
	if (file.before !== current)
		return {
			problem: `${target} changed in the repository since the factory was applied, and only the rule may apply on its own`,
		};
	if (
		keepsFrontMatter(target) &&
		rawFrontMatter(current) !== rawFrontMatter(file.merged)
	)
		return {
			problem: `the pull request changed the front matter of ${target}`,
		};
	const next = { ...applied, [path]: file.merged };
	const error = loadFactory(next).problems.find((p) => p.level === "error");
	return error
		? { problem: `the factory would not load: ${error.file}: ${error.message}` }
		: next;
}

/**
 * The rules of learning merged and not applied yet, each applied on its own: those GitHub now says
 * merged, and those already promoted without an apply of their own or of the whole factory (a
 * batch saw the merge first, or reading the file failed). A closed pull request declines its
 * lesson. Returns the lessons applied, and whether a pull request could not be read, to look
 * again. A rule that cannot apply on its own waits for a person's `openfabriq apply`, and the log
 * says why.
 */
export async function applyMergedRules(
	repository: string,
	deps: {
		github: Pick<GitHub, "subject">;
		/** A file of the repository at a commit (`<sha>` or `<sha>^`), or undefined where it is not. */
		readAt: (commit: string, path: string) => Promise<string | undefined>;
		log: (line: string) => void;
		now: () => Date;
	},
): Promise<{ applied: Lesson[]; unread: boolean }> {
	const applies = readApplies(repository);
	const applied: Lesson[] = [];
	let unread = false;
	for (const lesson of readLessons(repository)) {
		const number = lesson.improvement?.number;
		if (number === undefined) continue;
		let merged: Lesson | undefined =
			lesson.status === "promoted" && !appliedAt(lesson, applies)
				? lesson
				: undefined;
		if (lesson.status === "proposed") {
			const pull = await pullState(deps.github, repository, number, deps.log);
			if (!pull) unread = true;
			const settled = pull && resolvedByPullRequest(lesson, pull, deps.now());
			if (!settled) continue;
			saveLessons(repository, [settled]);
			if (settled.status === "promoted") merged = settled;
		}
		if (!merged) continue;
		const commit = merged.mergeCommit;
		const next = commit
			? withMergedRule(
					readFactoryFolder(join(projectDir(repository), "factory")),
					lesson.target,
					{
						before: await deps.readAt(`${commit}^`, lesson.target),
						merged: await deps.readAt(commit, lesson.target),
					},
				)
			: { problem: "GitHub did not say which commit merged it" };
		if ("problem" in next) {
			deps.log(
				`${repository}: learning's rule ${lesson.id} (#${number}) is merged, not applied: ${next.problem}. Run "openfabriq apply".`,
			);
			continue;
		}
		writeApplied(repository, next, deps.now(), [lesson.id]);
		applied.push(lesson);
		deps.log(
			`${repository}: applied learning's rule ${lesson.id} (#${number}) to ${lesson.target}`,
		);
	}
	return { applied, unread };
}
