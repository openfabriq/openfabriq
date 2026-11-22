import type { IncomingMessage, ServerResponse } from "node:http";
import {
	readAppliedFactory,
	readWiki,
	requestWikiRun,
	wikiRun,
} from "@openfabriq/runner";
import { z } from "zod";
import { jsonAnswer, refuse, send } from "../http/answer.js";
import { readAppPost } from "../http/app-post.js";

const MAX_BODY = 4 * 1024;

/** What GET /api/wiki sends: the wiki, a run's limit, and the wiki's latest run, which the page and its button wait on. */
export async function wikiOf(repository: string) {
	const wiki = await readWiki(repository);
	return {
		wiki: wiki ?? null,
		usdPerRun: readAppliedFactory(repository)?.limits.usd_per_run,
		run: wikiRun(repository) ?? null,
	};
}
const Body = z.strictObject({ project: z.string() });

/**
 * POST /api/wiki/refresh, the studio's Refresh button: a manual run of the engine's
 * wiki, with the chat's protections; the server has already checked Host and the cookie.
 */
export async function refreshWiki(
	req: IncomingMessage,
	res: ServerResponse,
	deps: {
		projects: () => string[];
		url?: URL;
		request?: typeof requestWikiRun;
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
	const asked = (deps.request ?? requestWikiRun)(read.body.project);
	if (asked === "off")
		return refuse(
			res,
			409,
			"This factory's wiki is off: add wiki: true to factory.yaml.",
		);
	if (asked === "busy")
		return refuse(res, 409, "The wiki is already being updated.");
	deps.wake?.();
	send(res, jsonAnswer(202, { asked: true }));
}
