import type { EngineRun } from "@openfabriq/runner";
import { OFFLINE } from "./api.js";

// The studio's buttons that ask the engine for a run of its wiki or of learning.

/** Whether a run waits or works: then nobody can start another one. */
export const isBusy = (run: EngineRun | null | undefined) =>
	run?.state === "asked" || run?.state === "queued" || run?.state === "running";

/** Asks the engine for a run, like `openfabriq run`; undefined when asked, else why not. */
export async function askForRun(
	path: "/api/wiki/refresh" | "/api/learning/run",
	project: string,
): Promise<string | undefined> {
	try {
		const res = await fetch(path, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ project }),
		});
		if (res.ok) return undefined;
		const body = (await res.json()) as { error?: string };
		return body.error ?? `${res.status} ${res.statusText}`;
	} catch {
		return OFFLINE;
	}
}
