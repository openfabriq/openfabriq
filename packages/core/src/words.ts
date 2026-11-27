// Words for people: a list in a sentence, and a suggestion for an unknown word.

/** `a`, `a and b`, `a, b and c` (or `a, b or c`). */
export const sentenceList = (
	items: readonly string[],
	word: "and" | "or" = "and",
) =>
	items.length < 2
		? items.join("")
		: `${items.slice(0, -1).join(", ")} ${word} ${items.at(-1)}`;

export function isOneOf<T extends string>(
	list: readonly T[],
	word: string,
): word is T {
	return (list as readonly string[]).includes(word);
}

/** Letters to add, remove or change, or neighbours to swap, to turn a into b: "tset" is one from "test". */
function distance(a: string, b: string): number {
	let beforePrevious: number[] = [];
	let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++) {
			current[j] = Math.min(
				(previous[j] ?? 0) + 1,
				(current[j - 1] ?? 0) + 1,
				(previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
				current[j] = Math.min(
					current[j] ?? 0,
					(beforePrevious[j - 2] ?? 0) + 1,
				);
		}
		beforePrevious = previous;
		previous = current;
	}
	return previous[b.length] ?? 0;
}

/** `Did you mean "issue.labeled"?`, the full list when nothing is close, or nothing when there is nothing to choose from. */
function suggestion(word: string, options: readonly string[]): string {
	if (options.length === 0) return "";
	const best = options
		.map((option) => ({ option, d: distance(word, option) }))
		.sort((x, y) => x.d - y.d)[0];
	if (best && best.d <= Math.max(1, Math.floor(word.length / 3)))
		return `Did you mean "${best.option}"?`;
	return `Use one of: ${options.join(", ")}`;
}

/** A sentence, then the suggestion for a word when there is one. */
export const suggested = (
	sentence: string,
	word: string,
	options: readonly string[],
) => [sentence, suggestion(word, options)].filter(Boolean).join(" ");

/** `unknown event "issue.label" in when. Did you mean "issue.labeled"?` */
export const unknownWord = (
	kind: string,
	word: string,
	options: readonly string[],
	where?: string,
) =>
	suggested(
		`unknown ${kind} "${word}"${where ? ` in ${where}` : ""}.`,
		word,
		options,
	);
