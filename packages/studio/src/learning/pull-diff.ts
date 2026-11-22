import { exec, githubEnv, parseHunks } from "@openfabriq/runner";
import type { ShownFile } from "../runs/run-files.js";

const GH_TIMEOUT_MS = 30_000;

/** A pull request's diff as GitHub has it now, read only; undefined when gh cannot tell. */
export async function githubPullDiff(
	repository: string,
	number: number,
): Promise<string | undefined> {
	try {
		// In app mode, the token of the repository.
		const env = await githubEnv(repository);
		return await exec(
			"gh",
			["pr", "diff", String(number), "-R", repository, "--color", "never"],
			{ ...(env ? { env } : {}), timeoutMs: GH_TIMEOUT_MS },
		);
	} catch {
		return undefined;
	}
}

/** A unified diff of several files, as the studio shows a run's: each file and its hunks. */
export function diffFiles(diff: string): ShownFile[] {
	return diff
		.split(/^(?=diff --git )/m)
		.filter((part) => part.startsWith("diff --git "))
		.map((part) => {
			const added = /^\+\+\+ b\/(.+)$/m.exec(part)?.[1];
			const removed = /^--- a\/(.+)$/m.exec(part)?.[1];
			const path =
				added ?? removed ?? /^diff --git a\/.+ b\/(.+)$/m.exec(part)?.[1] ?? "";
			const first = part.search(/^@@ /m);
			const lines = part.split("\n");
			return {
				path,
				add: lines.filter((l) => l.startsWith("+") && !l.startsWith("+++"))
					.length,
				del: lines.filter((l) => l.startsWith("-") && !l.startsWith("---"))
					.length,
				...(first >= 0 ? { hunks: parseHunks(part.slice(first)) } : {}),
			};
		});
}
