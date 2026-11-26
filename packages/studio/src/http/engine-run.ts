import type { IncomingMessage, ServerResponse } from "node:http";
import { type EngineAutomation, requestEngineRun } from "@openfabriq/runner";
import { z } from "zod";
import { jsonAnswer, refuse, send } from "./answer.js";
import { readAppPost } from "./app-post.js";

const MAX_BODY = 4 * 1024;
const Body = z.strictObject({ project: z.string() });

/** What the studio says when the factory leaves the automation off, or a run of it already waits or works. */
const REFUSALS: Record<EngineAutomation, { off: string; busy: string }> = {
	wiki: {
		off: "This factory's wiki is off: add wiki: true to factory.yaml.",
		busy: "The wiki is already being updated.",
	},
	learning: {
		off: "Learning is off: add learning: true to factory.yaml.",
		busy: "Learning is already studying the mistakes.",
	},
};

/**
 * POST /api/wiki/refresh and POST /api/learning/run, the studio's buttons: a manual run of the
 * engine's wiki or learning, with the chat's protections; the server has already checked Host and
 * the cookie.
 */
export async function askEngineRun(
	automation: EngineAutomation,
	req: IncomingMessage,
	res: ServerResponse,
	deps: {
		projects: () => string[];
		url?: URL;
		request?: typeof requestEngineRun;
		wake?: () => void;
	},
): Promise<void> {
	const read = await readAppPost(req, {
		schema: Body,
		expected: "{ project }",
		max: MAX_BODY,
		projects: deps.projects,
		url: deps.url,
	});
	if ("error" in read) return refuse(res, read.status, read.error);
	const asked = (deps.request ?? requestEngineRun)(
		read.body.project,
		automation,
	);
	if (asked !== "asked") return refuse(res, 409, REFUSALS[automation][asked]);
	deps.wake?.();
	send(res, jsonAnswer(202, { asked: true }));
}
