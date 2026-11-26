import { join } from "node:path";
import {
	type Factory,
	type FactoryEvent,
	matchingAutomations,
	startedByMaintainer,
} from "@openfabriq/core";
import { errorText, readJsonIfExists } from "../files.js";
import { type Cursor, pollGitHub } from "../github/poll.js";
import { applyMergedRules } from "../learning/apply.js";
import type { RunDeps } from "../run/execute.js";
import { type Relay, usesRelay } from "../sources/relay.js";
import { sentryWatches } from "../sources/sentry/events.js";
import type { RunRecord } from "../state/journal.js";
import {
	listProjects,
	loadApplied,
	projectDir,
	readAppliedFactory,
} from "../state/projects.js";
import { diskJournal, type RunJournal } from "../state/run-journal.js";
import { cursorPath, writeCursor } from "./cursors.js";
import {
	labeledForUntrustedRun,
	pushedForUntrustedRun,
	withOpener,
} from "./provenance.js";
import { queuedRun } from "./queue.js";
import { relayEvents } from "./relay-events.js";
import { manualRuns } from "./requests.js";
import { type Factories, scheduler } from "./scheduler.js";
import { dueRuns, lastScheduleCheck, saveScheduleCheck } from "./schedules.js";

export interface EngineDeps extends Omit<RunDeps, "journal"> {
	/** The runs' history; the project's runs.jsonl when left out. */
	journal?: RunJournal;
	log: (line: string) => void;
	intervalMs?: number;
	maxRuns?: number;
	/** Local mode only: kept awake while at least one run works. */
	keepAwake?: (awake: boolean) => void;
	/** Present when the relay is connected: every service's events come through it. */
	relay?: Relay;
}

export function startEngine(given: EngineDeps) {
	const deps = { ...given, journal: given.journal ?? diskJournal };
	const now = deps.now ?? (() => new Date());
	const factories: Factories = new Map();
	// Four runs at once, all projects together: a server of 8 GB holds them, browsers included.
	const scheduled = scheduler(deps, deps.maxRuns ?? 4, factories);
	let engineAccounts: string[] = [];
	let lastMinute = "";
	let timer: NodeJS.Timeout | undefined;
	let ticking = false;
	/** The projects whose merged rules of learning wait for a look, and those being looked at. */
	const rulesToApply = new Set<string>();
	const applyingRules = new Set<string>();
	let stopped = false;
	let lastSentryWatches = "";
	const warned = new Set<string>();
	const warnOnce = (line: string) => {
		if (warned.has(line)) return;
		warned.add(line);
		deps.log(line);
	};

	function queueFor(repo: string, factory: Factory, given: FactoryEvent) {
		// Read once per event, and only when a check needs it.
		let journal: RunRecord[] | undefined;
		const runsOf = () => (journal ??= deps.journal.read(repo));
		const marked =
			labeledForUntrustedRun(repo, given, engineAccounts, runsOf) ||
			pushedForUntrustedRun(given, runsOf)
				? { ...given, fromUntrustedRun: true }
				: given;
		const event = withOpener(factory, marked, runsOf);
		const untrusted = !startedByMaintainer(factory, event, engineAccounts);
		for (const automation of matchingAutomations(
			factory,
			event,
			engineAccounts,
		))
			scheduled.add(queuedRun(repo, automation, event, untrusted), factory);
	}

	const appliedFactory = (repo: string) =>
		factories.get(repo)?.factory ?? readAppliedFactory(repo);
	const handleRelayBatch = relayEvents({
		deps,
		appliedFactory,
		queue: queueFor,
		warn: warnOnce,
		now,
		pump: () => scheduled.pump(),
	});

	/** The relay runs the factories' Sentry searches; it is told again when they change. */
	async function watchSentry() {
		const { relay, sentry } = deps;
		if (!relay || !sentry) return;
		const watches = sentryWatches(
			[...factories.values()].map((f) => f.factory),
			sentry.origin,
		);
		const text = JSON.stringify(watches);
		if (text === lastSentryWatches) return;
		await relay.watchSentry(watches);
		lastSentryWatches = text;
	}

	async function poll(repo: string) {
		const applied = loadApplied(repo);
		const factory = applied?.factory;
		if (!factory) {
			const error = applied?.problems.find((p) => p.level === "error");
			deps.log(
				error
					? `${repo}: the applied factory does not load (${error.file}: ${error.message}); run "openfabriq apply" again`
					: `${repo}: no factory is applied; run "openfabriq apply"`,
			);
			return;
		}
		const first = !factories.has(repo);
		const defaultBranch =
			factories.get(repo)?.defaultBranch ??
			(await deps.github.defaultBranch(repo));
		factories.set(repo, { factory, defaultBranch });
		// The clone fetches for runs; the studio reads the wiki there too, so it follows the
		// default branch at start and after each merge, the engine's own included.
		const clone = join(projectDir(repo), "repo");
		const fetchClone = () =>
			deps.workspace.fetch(clone).then(
				() => true,
				(error) => {
					deps.log(
						`${repo}: could not fetch the default branch: ${errorText(error)}`,
					);
					return false;
				},
			);
		if (first && factory.wiki) void fetchClone();
		const polled = await pollGitHub(repo, factory, defaultBranch, {
			github: deps.github,
			now,
			saved: readJsonIfExists<Cursor>(cursorPath(repo)),
			engineMerges: () => deps.journal.engineMerges(repo),
		});
		// The cursor moves once the events are queued: if queueing fails, the next poll reads them again.
		for (const { number, reason } of polled.autoMergeStillOn)
			deps.log(
				`${repo} #${number}: GitHub kept the engine's auto-merge (${reason}); tried again at the next poll`,
			);
		for (const event of polled.events) queueFor(repo, factory, event);
		writeCursor(cursorPath(repo), polled.cursor);
		// After a merge, the wiki reads the default branch in the clone. Learning's merged rules apply
		// from it too, each on its own: one look at a time per project, looked at again until GitHub
		// and the clone answered.
		if (polled.headMoved && factory.learning) rulesToApply.add(repo);
		if (rulesToApply.has(repo) && !applyingRules.has(repo)) {
			rulesToApply.delete(repo);
			applyingRules.add(repo);
			void fetchClone()
				.then(async (fetched) => {
					const { unread } = fetched
						? await applyMergedRules(repo, {
								github: deps.github,
								readMerged: (path) =>
									deps.workspace.show(clone, defaultBranch, path),
								log: deps.log,
								now,
							})
						: { unread: true };
					if (unread) rulesToApply.add(repo);
				})
				.catch((error: unknown) => {
					deps.log(`${repo}: learning's rules: ${errorText(error)}`);
					rulesToApply.add(repo);
				})
				.finally(() => applyingRules.delete(repo));
		} else if (polled.headMoved && factory.wiki) void fetchClone();
	}

	async function tick() {
		if (ticking || stopped) return;
		ticking = true;
		try {
			scheduled.restore();
			if (engineAccounts.length === 0)
				engineAccounts = [await deps.github.currentUser()];
			for (const { repository: repo } of listProjects()) {
				await poll(repo).catch((error: unknown) =>
					deps.log(`${repo}: ${errorText(error)}`),
				);
			}
			await watchSentry().catch((error: unknown) =>
				deps.log(`sentry: ${errorText(error)}`),
			);
			const minute = now().toISOString().slice(0, 16);
			if (minute !== lastMinute) {
				lastMinute = minute;
				// One project's corrupt file stops its own schedules only.
				for (const [repo, { factory }] of factories)
					try {
						const checkedAt = now();
						const since = lastScheduleCheck(repo, checkedAt);
						for (const run of dueRuns(repo, factory, since, checkedAt))
							scheduled.add(run, factory);
						saveScheduleCheck(repo, checkedAt);
					} catch (error) {
						deps.log(`${repo}: schedules: ${errorText(error)}`);
					}
			}
			takeManualRuns();
		} catch (error) {
			// Offline at start, a corrupt file: said, and tried again at the next tick.
			deps.log(`tick: ${errorText(error)}`);
		} finally {
			ticking = false;
		}
	}

	/** Queues the waiting manual runs and starts what fits; synchronous, so a tick and a wake never take one twice. */
	function takeManualRuns() {
		for (const [repo, polled] of factories)
			try {
				// Read again when a request waits: an apply during the poll comes with its own manual run.
				let applied: Factory | undefined;
				const factory = () =>
					(applied ??= loadApplied(repo)?.factory ?? polled.factory);
				for (const manual of manualRuns(repo, factory)) {
					if ("refused" in manual)
						deps.log(`${repo}: manual run refused: ${manual.refused}`);
					else scheduled.add(manual.run, factory());
					manual.taken();
				}
				// The run starts with the factory it was checked against, not the one polled before the apply.
				if (applied) factories.set(repo, { ...polled, factory: applied });
			} catch (error) {
				deps.log(`${repo}: manual runs: ${errorText(error)}`);
			}
		scheduled.pump();
	}

	return {
		tick,
		/**
		 * The studio asked for a run: take it now rather than at the next tick, without reading
		 * GitHub. Before the first tick there is no factory yet, and the tick takes it.
		 */
		wake() {
			if (stopped) return;
			try {
				takeManualRuns();
			} catch (error) {
				deps.log(`wake: ${errorText(error)}`);
			}
		},
		/** For tests and the relay listener. */
		relayed: handleRelayBatch,
		start() {
			void tick();
			timer = setInterval(() => void tick(), deps.intervalMs ?? 60_000);
			const applied = listProjects().flatMap(
				(p) => readAppliedFactory(p.repository) ?? [],
			);
			if (applied.some(usesRelay))
				deps.relay?.listen(handleRelayBatch, deps.log);
		},
		stop() {
			stopped = true; // the running runs end; no other starts
			scheduled.stop();
			if (timer) clearInterval(timer);
			deps.relay?.stop();
		},
		status: scheduled.status,
	};
}
