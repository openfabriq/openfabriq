import { useState } from "react";
import { askForRun } from "../lib/engine-run.js";

/**
 * A button that asks the engine for a run: whether it was just asked (until the server's next read
 * says so), why it was refused, and its confirmation.
 */
export function useEngineRun(
	path: Parameters<typeof askForRun>[0],
	project: string | undefined,
) {
	const [justAsked, setJustAsked] = useState(false);
	const [failure, setFailure] = useState<string>();
	const [confirming, setConfirming] = useState(false);
	const ask = async (refetch: () => Promise<unknown>) => {
		if (!project) return;
		setConfirming(false);
		setFailure(undefined);
		setJustAsked(true);
		const refused = await askForRun(path, project);
		if (refused) setFailure(refused);
		// The server knows of the request once it answered: its next read holds the button from then.
		else await refetch();
		setJustAsked(false);
	};
	return { justAsked, failure, confirming, setConfirming, ask };
}
