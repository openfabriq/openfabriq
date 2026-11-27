import {
	appendFileSync,
	closeSync,
	existsSync,
	fstatSync,
	mkdirSync,
	openSync,
	readSync,
} from "node:fs";
import { join } from "node:path";
import type { SourceKind } from "@openfabriq/core";
import { jsonLines } from "../files.js";
import type { Outcome } from "../run/outputs/review.js";
import { listProjects, projectDir } from "./projects.js";

export type RunStatus =
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "skipped";

/** One run. runs.jsonl gets a line at each status change; the last line of an id wins. */
export interface RunRecord {
	id: string;
	repository: string;
	automation: string;
	agent: string;
	event: string;
	label?: string;
	number?: number;
	isPullRequest: boolean;
	/** A schedule's planned time: later than queuedAt's minute when it was caught up. */
	scheduledFor?: string;
	/** Who asked for a manual run, with `openfabriq run`. */
	manual?: string;
	/** Who requested the changes a run on pull_request.changes_requested answers: learning counts only a maintainer's. */
	requestedBy?: string;
	title?: string;
	url?: string;
	status: RunStatus;
	reason?: string;
	queuedAt: string;
	startedAt?: string;
	endedAt?: string;
	durationMs?: number;
	costUsd?: number;
	tokens?: { input: number; output: number };
	turns?: number;
	model?: string;
	outputs: Outcome[];
	/** Names of the variables its setup and commands got, and the secrets missing on the machine; never a value. */
	variables?: { env: string[]; secrets: string[]; missing: string[] };
	/** MCP tools and servers the agent listed but did not get, like "sentry (failed)" or "sentry.get_issue". */
	mcpUnavailable?: string[];
	/** No maintainer started it: what it wrote starts only low-risk or `from: factory` automations. */
	untrusted?: boolean;
	/** Where the run comes from, for people: "#12", "#factory", "ENG-123". */
	source?: {
		kind: SourceKind;
		label: string;
		url?: string;
	};
}

const journal = (repository: string) =>
	join(projectDir(repository), "runs.jsonl");

export function appendRun(record: RunRecord): void {
	mkdirSync(projectDir(record.repository), { recursive: true });
	appendFileSync(journal(record.repository), `${JSON.stringify(record)}\n`);
}

/** Whether a run no maintainer started pushed to this pull request: its head holds that run's commits. */
export const untrustedPushTo = (runs: RunRecord[], number: number): boolean =>
	runs.some(
		(run) =>
			run.untrusted === true &&
			run.number === number &&
			run.outputs.some(
				(o) => o.action === "push_to_pull_request" && o.status === "applied",
			),
	);

/** The run that opened this pull request, or this issue: the one that created it, by its address. */
export const openingRun = (
	runs: RunRecord[],
	number: number,
	isPullRequest = true,
): RunRecord | undefined => {
	const [action, path] = isPullRequest
		? (["create_pull_request", "pull"] as const)
		: (["create_issue", "issues"] as const);
	return runs.find((run) =>
		run.outputs.some(
			(o) =>
				o.action === action &&
				o.status === "applied" &&
				o.url?.endsWith(`/${path}/${number}`),
		),
	);
};

/** The agent whose run opened this pull request, or this issue. */
export const openerOf = (
	runs: RunRecord[],
	number: number,
	isPullRequest = true,
): string | undefined => openingRun(runs, number, isPullRequest)?.agent;

/** What was read of a journal: up to its last whole line, and its runs by id, in the order of their first line. */
interface JournalRead {
	ino: number;
	/** Its first bytes: a journal deleted and written again under the same inode starts otherwise. */
	head: Buffer;
	offset: number;
	byId: Map<string, RunRecord>;
}

const HEAD_BYTES = 256;
const reads = new Map<string, JournalRead>();

function bytes(fd: number, from: number, to: number): Buffer {
	const buffer = Buffer.alloc(to - from);
	let read = 0;
	while (read < buffer.length) {
		const n = readSync(fd, buffer, read, buffer.length - read, from + read);
		if (n === 0) break;
		read += n;
	}
	return buffer.subarray(0, read);
}

/**
 * A journal's runs by id, the last line of each winning. The journal only grows and every run,
 * merge, event and studio poll reads it: only the lines written since the last read are parsed.
 */
function runsById(file: string): Map<string, RunRecord> | undefined {
	if (!existsSync(file)) {
		reads.delete(file);
		return undefined;
	}
	const fd = openSync(file, "r");
	try {
		const { size, ino } = fstatSync(fd);
		let last = reads.get(file);
		if (
			!last ||
			last.ino !== ino ||
			size < last.offset ||
			!bytes(fd, 0, last.head.length).equals(last.head)
		)
			last = { ino, head: Buffer.alloc(0), offset: 0, byId: new Map() };
		const added = bytes(fd, last.offset, size);
		// Half a line, written when the engine stopped or being written now, waits: the line before it stands.
		const whole = added.lastIndexOf(0x0a) + 1;
		for (const record of jsonLines<RunRecord>(
			added.subarray(0, whole).toString("utf8"),
		))
			last.byId.set(record.id, record);
		last.offset += whole;
		if (last.head.length < HEAD_BYTES)
			last.head = bytes(fd, 0, Math.min(HEAD_BYTES, last.offset));
		reads.set(file, last);
		return last.byId;
	} finally {
		closeSync(fd);
	}
}

/** The runs of one project, or of all, latest first. */
export function readRuns(repository?: string): RunRecord[] {
	const repositories = repository
		? [repository]
		: listProjects().map((p) => p.repository);
	const byId = new Map<string, RunRecord>();
	for (const repo of repositories)
		for (const [id, record] of runsById(journal(repo)) ?? [])
			byId.set(id, record);
	// Reversed first: a run queued again after a stop keeps its queuedAt, and the stable sort puts it before the interrupted one.
	return [...byId.values()]
		.reverse()
		.sort((a, b) => b.queuedAt.localeCompare(a.queuedAt));
}

/** Cost of the runs that ended today, in the machine's local day. */
export function costToday(repository: string, now = new Date()): number {
	const today = now.toDateString();
	return readRuns(repository)
		.filter((r) => r.endedAt && new Date(r.endedAt).toDateString() === today)
		.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
}
