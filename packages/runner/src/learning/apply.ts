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

// A rule of learning applies once a person merges its pull request: the engine applies its one
// file, as the default branch has it, without the rest of the repository's changes under
// openfabriq/, which wait for a person's `openfabriq apply`. Merging was the review: the guard
// already made sure the pull request changes only text, never a front matter.

const FOLDER = "openfabriq/";

/**
 * The applied factory with a merged rule's file as the default branch has it, or why that file
 * cannot apply on its own: not a file learning improves, not in the applied factory, or a front
 * matter that changed since the factory was applied, which only a person's apply may take.
 */
export function withMergedRule(
	applied: FactoryFiles,
	target: string,
	merged: string,
): FactoryFiles | { problem: string } {
	if (!target.startsWith(FOLDER) || !isImprovable(target))
		return { problem: `${target} is not a file learning improves` };
	const path = target.slice(FOLDER.length);
	const before = applied[path];
	if (before === undefined)
		return { problem: `${target} is not in the applied factory` };
	if (
		keepsFrontMatter(target) &&
		rawFrontMatter(before) !== rawFrontMatter(merged)
	)
		return {
			problem: `the front matter of ${target} changed since the factory was applied`,
		};
	const next = { ...applied, [path]: merged };
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
		/** A file of the repository as the default branch has it now, or undefined. */
		readMerged: (path: string) => Promise<string | undefined>;
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
		let merged = lesson.status === "promoted" && !appliedAt(lesson, applies);
		if (lesson.status === "proposed") {
			const pull = await pullState(deps.github, repository, number, deps.log);
			if (!pull) unread = true;
			const settled = pull && resolvedByPullRequest(lesson, pull, deps.now());
			if (!settled) continue;
			saveLessons(repository, [settled]);
			merged = settled.status === "promoted";
		}
		if (!merged) continue;
		const text = await deps.readMerged(lesson.target);
		const next =
			text === undefined
				? { problem: `${lesson.target} is not on the default branch` }
				: withMergedRule(
						readFactoryFolder(join(projectDir(repository), "factory")),
						lesson.target,
						text,
					);
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
