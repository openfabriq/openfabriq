import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	type Automation,
	type EventName,
	eventSource,
	type Factory,
	type FactoryEvent,
	LEARNING,
	WIKI,
} from "@openfabriq/core";
import { writeFileAtomic } from "../files.js";
import { type RunRecord, readRuns } from "../state/journal.js";
import { projectDir, readAppliedFactory } from "../state/projects.js";
import { loadQueue, type QueuedRun, queuedRun } from "./queue.js";

/** A manual run, asked with `openfabriq run`, waiting for the engine to take it. */
export interface RunRequest {
	id: string;
	automation: string;
	number?: number;
	isPullRequest: boolean;
	/** Who asked: the git user name of the machine. */
	by: string;
	at: string;
}

const requestsDir = (repository: string) =>
	join(projectDir(repository), "requests");

export function requestRun(repository: string, request: RunRequest): void {
	// Atomic: the engine never reads half a request.
	writeFileAtomic(
		join(requestsDir(repository), `${request.id}.json`),
		JSON.stringify(request),
	);
}

/** The waiting requests of a project, with their files. */
function readRequests(repository: string): [file: string, RunRequest][] {
	const dir = requestsDir(repository);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.map((name) => {
			const file = join(dir, name);
			return [file, JSON.parse(readFileSync(file, "utf8")) as RunRequest];
		});
}

/** The automations asked and not yet taken, without taking them. */
const waiting = (repository: string): string[] =>
	readRequests(repository).map(([, request]) => request.automation);

/** The engine's own automations a person can run from the studio, and whether the factory turns each on. */
const ENGINE_RUNS = {
	[WIKI]: (factory: Factory) => Boolean(factory.wiki),
	[LEARNING]: (factory: Factory) => Boolean(factory.learning),
};
export type EngineAutomation = keyof typeof ENGINE_RUNS;

/**
 * A studio button: a manual run of the engine's wiki or learning, like `openfabriq run wiki`,
 * unless the factory leaves it off, or one is already asked, queued or running.
 */
export function requestEngineRun(
	repository: string,
	automation: EngineAutomation,
	now = new Date(),
): "asked" | "busy" | "off" {
	const factory = readAppliedFactory(repository);
	if (!factory || !ENGINE_RUNS[automation](factory)) return "off";
	const { queued, running } = loadQueue(repository);
	if (
		waiting(repository).includes(automation) ||
		[...queued, ...running].some((r) => r.automation === automation)
	)
		return "busy";
	requestRun(repository, {
		id: randomUUID(),
		automation,
		isPullRequest: false,
		by: "studio",
		at: now.toISOString(),
	});
	return "asked";
}

/** Where the latest run of the engine's wiki or learning stands, for the studio: asked, queued, running, or ended. */
export type EngineRun =
	| { state: "asked" }
	| {
			state: RunRecord["status"];
			id: string;
			/** When it was queued, started or ended, whichever is latest. */
			at: string;
			reason?: string;
			/** The pull request it opened. */
			pullRequest?: string;
	  };

export function engineRun(
	repository: string,
	automation: EngineAutomation,
): EngineRun | undefined {
	if (waiting(repository).includes(automation)) return { state: "asked" };
	const run = readRuns(repository).find((r) => r.automation === automation);
	if (!run) return undefined;
	const opened = run.outputs.find(
		(o) => o.action === "create_pull_request" && o.status === "applied",
	)?.url;
	return {
		state: run.status,
		id: run.id,
		at: run.endedAt ?? run.startedAt ?? run.queuedAt,
		...(run.reason ? { reason: run.reason } : {}),
		...(opened ? { pullRequest: opened } : {}),
	};
}

/** The waiting requests of a project, removed as they are taken: each one is taken once. */
export function takeRequests(repository: string): RunRequest[] {
	return readRequests(repository).map(([file, request]) => {
		rmSync(file);
		return request;
	});
}

const repoWide = (event: EventName) =>
	event === "schedule" || event === "default_branch.updated";

/**
 * The event of a manual run: the automation's own trigger that fits the request (the whole
 * repository, an issue or a pull request), or why none does.
 */
export function manualEvent(
	automation: Automation,
	request: RunRequest,
): FactoryEvent | string {
	const name = automation.name;
	const base = {
		key: `manual:${request.id}`,
		actor: request.by,
		at: request.at,
	};
	// Only the engine's wiki, on demand, has no trigger: it runs on the whole repository.
	if (automation.when.length === 0)
		return request.number === undefined
			? { ...base, event: "default_branch.updated", isPullRequest: false }
			: `${name} runs on the whole repository: no --issue or --pr`;
	const triggers = automation.when.filter(
		(t) => eventSource(t.event) === "github",
	);
	if (triggers.length === 0)
		return `${name} only starts from Slack, Linear, Sentry or a webhook: it cannot be run manually`;
	const onIssue = triggers.some((t) => t.event.startsWith("issue."));
	const onPull = triggers.some((t) => t.event.startsWith("pull_request."));
	const needs = (pull: boolean) =>
		pull
			? `${name} starts on a pull request: pass --pr <number>`
			: `${name} starts on an issue: pass --issue <number>`;
	if (request.number === undefined) {
		const trigger = triggers.find((t) => repoWide(t.event));
		if (!trigger) return needs(onPull && !onIssue);
		return { ...base, event: trigger.event, isPullRequest: false };
	}
	const trigger = triggers.find((t) =>
		t.event.startsWith(request.isPullRequest ? "pull_request." : "issue."),
	);
	if (!trigger)
		return onIssue || onPull
			? needs(!request.isPullRequest)
			: `${name} runs on the whole repository: no --issue or --pr`;
	return {
		...base,
		event: trigger.event,
		...(trigger.labels?.[0] ? { label: trigger.labels[0] } : {}),
		number: request.number,
		isPullRequest: request.isPullRequest,
	};
}

/** A manual request taken: the run to queue like any event, or why the factory cannot run it. */
export type ManualRun = ({ run: QueuedRun } | { refused: string }) & {
	/** Removes the request: once its run is queued, or its refusal said, never before. */
	taken: () => void;
};

/** Takes the manual requests waiting, in the order they are read; the factory is asked for only when one waits. */
export function manualRuns(repo: string, applied: () => Factory): ManualRun[] {
	const requests = readRequests(repo);
	if (requests.length === 0) return [];
	const factory = applied();
	return requests.map(([file, request]) => {
		const taken = () => rmSync(file, { force: true });
		const automation = Object.hasOwn(factory.automations, request.automation)
			? factory.automations[request.automation]
			: undefined;
		if (!automation)
			return {
				refused: `${request.automation} is not in the applied factory`,
				taken,
			};
		const event = manualEvent(automation, request);
		if (typeof event === "string") return { refused: event, taken };
		return { run: queuedRun(repo, automation, event), taken };
	});
}
