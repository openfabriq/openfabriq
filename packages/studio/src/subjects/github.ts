import { HANDOFF_LABEL, includesName } from "@openfabriq/core";
import { exec, githubEnv } from "@openfabriq/runner";
import type { SubjectState } from "./subject-state.js";

const GH_TIMEOUT_MS = 30_000;

/** Asks GitHub, read only, whether a pull request was merged, or whether it or an issue is still open. Undefined when gh cannot tell. */
export async function githubSubjectState(
	url: string,
): Promise<SubjectState | undefined> {
	const { pathname } = new URL(url);
	const kind = pathname.includes("/issues/") ? "issue" : "pr";
	try {
		// In app mode, the token of the repository in the address.
		const env = await githubEnv(pathname.split("/").slice(1, 3).join("/"));
		const fields = kind === "pr" ? "state,labels,mergedAt" : "state,labels";
		const { state, labels, mergedAt } = JSON.parse(
			await exec("gh", [kind, "view", url, "--json", fields], {
				...(env ? { env } : {}),
				// Four asked at a time: one frozen gh would hold the board and the metrics for good.
				timeoutMs: GH_TIMEOUT_MS,
			}),
		) as {
			state: string;
			labels: { name: string }[];
			mergedAt?: string | null;
		};
		return {
			merged: state === "MERGED",
			...(mergedAt ? { mergedAt } : {}),
			open: state === "OPEN",
			needsHuman: includesName(
				labels.map((l) => l.name),
				HANDOFF_LABEL,
			),
		};
	} catch {
		return undefined;
	}
}
