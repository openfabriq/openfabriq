import { isImprovable } from "./lessons.js";

/** The header of an agent.md as written, between its two --- lines; undefined without one. */
const frontMatter = (text: string) =>
	/^﻿?---\r?\n([\s\S]*?)\r?\n?---(?:\r?\n|$)/.exec(text)?.[1];

/**
 * Why the engine will not publish learning's commits, or undefined: they change the text of the
 * factory's skills and the body of its agent.md files only. An agent never proposes more rights
 * for itself: its tools, network, model and description stay as they are.
 */
export async function outsideLearning(
	touched: string[],
	/** The file when the run started, and at HEAD: undefined where it does not exist. */
	versions: (path: string) => Promise<{ start?: string; head?: string }>,
): Promise<string | undefined> {
	const outside = touched.filter((p) => !isImprovable(p));
	if (outside.length)
		return `learning's commits change ${outside.join(", ")}: an improvement changes the Markdown of the factory's skills and the body of its agent.md files only`;
	for (const path of touched.filter((p) => p.endsWith("/agent.md"))) {
		const { start, head } = await versions(path);
		const before = start === undefined ? undefined : frontMatter(start);
		const after = head === undefined ? undefined : frontMatter(head);
		if (before === undefined || after === undefined || before !== after)
			return `learning's commits change the front matter of ${path}, or add or remove it: an improvement changes the body of an agent.md only`;
	}
	return undefined;
}
