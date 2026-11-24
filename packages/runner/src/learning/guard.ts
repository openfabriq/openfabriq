import { IMPORTED_SKILLS, rawFrontMatter } from "@openfabriq/core";
import {
	importedFolders,
	importedProblem,
	isImprovable,
	keepsFrontMatter,
} from "./lessons.js";

/**
 * Why the engine will not publish learning's commits, or undefined: they change the text of the
 * factory's own skills and the body of its agent.md and SKILL.md files only. An agent never
 * proposes more rights for itself: the front matter (tools, network, model, a skill's
 * allowed-tools) stays as it is, and a skill imported from a public repository stays as its source.
 */
export async function outsideLearning(
	touched: string[],
	/** The file when the run started, and at HEAD: undefined where it does not exist. */
	versions: (path: string) => Promise<{ start?: string; head?: string }>,
): Promise<string | undefined> {
	const outside = touched.filter((p) => !isImprovable(p));
	if (outside.length)
		return `learning's commits change ${outside.join(", ")}: an improvement changes the Markdown of the factory's skills and the body of its agent.md files only`;
	// The lock as the run found it: learning's commits never change it, an improvable file never is.
	const imported = importedFolders(
		(await versions(`openfabriq/${IMPORTED_SKILLS}`)).start,
	);
	for (const path of touched) {
		const kept = importedProblem(path, imported);
		if (kept) return `learning's commits change ${kept}`;
		const { start, head } = await versions(path);
		if (head === undefined)
			return `learning's commits remove ${path}: an improvement adds to the factory's text, it never removes a file`;
		if (!keepsFrontMatter(path)) continue;
		const before = start === undefined ? undefined : rawFrontMatter(start);
		const after = rawFrontMatter(head);
		if (before === undefined || after === undefined || before !== after)
			return `learning's commits change the front matter of ${path}, or add it: an improvement changes the body of an existing agent.md or SKILL.md only`;
	}
	return undefined;
}
