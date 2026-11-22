"use client";

import { Check, CircleDot, Inbox, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAutoplay } from "@/hooks/use-autoplay";
import { formatDuration } from "@/lib/format";
import { AgentTag } from "../agent-tag";
import { PlayPauseButton } from "../play-pause-button";
import { RollingNumber } from "../rolling-number";
import { WindowFrame } from "../window-frame";
import { LogRow } from "./log-row";
import {
	COST_PER_STEP,
	clockOf,
	LOG,
	OUTPUTS,
	type OutputState,
	outputState,
	START,
} from "./run-script";

// How an output looks at each step: proposed by the agent, then applied or refused by the engine.
const OUTPUT_STATE: Record<
	OutputState,
	{ box: string; tone: string; icon: typeof Check | null; label: string }
> = {
	proposed: {
		box: "border-of-line bg-of-panel",
		tone: "text-fd-primary",
		icon: null,
		label: "Proposed",
	},
	applied: {
		box: "border-of-ok/30 bg-of-ok-soft",
		tone: "text-of-ok",
		icon: Check,
		label: "Applied",
	},
	refused: {
		box: "border-of-bad/30 bg-of-bad-soft",
		tone: "text-of-bad",
		icon: X,
		label: "Refused",
	},
};

/** A run in the studio, as it happens: the log grows, then the engine applies what it allows. */
export function RunDemo() {
	const { ref, reduced, paused, setPaused, running } =
		useAutoplay<HTMLDivElement>("-10% 0px");
	const [shown, setShown] = useState(START);

	// The effect only runs the timer; with less motion, the finished run shows.
	useEffect(() => {
		if (!running) return;
		// After the last line, the finished run stays a while, then plays again.
		const wait = shown >= LOG.length ? 6000 : 950;
		const id = setTimeout(
			() => setShown((n) => (n >= LOG.length ? START : n + 1)),
			wait,
		);
		return () => clearTimeout(id);
	}, [running, shown]);

	const visible = reduced ? LOG.length : shown;
	const log = LOG.slice(0, visible);
	const last = log.at(-1);
	const done = visible >= LOG.length;
	const status = visible === 0 ? "Queued" : done ? "Succeeded" : "Working";
	const seconds = last?.at ?? 0;
	const cost = (log.length * COST_PER_STEP).toFixed(2);

	return (
		<div ref={ref}>
			<WindowFrame
				title="acme/web-app › Runs › implement-44"
				example
				bar={
					<PlayPauseButton
						paused={paused}
						onClick={() => setPaused((p) => !p)}
						what="the run"
					/>
				}
			>
				<div aria-hidden className="bg-of-ground">
					<div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-of-line px-5 pt-5 pb-4 sm:px-7">
						<div className="min-w-0">
							<p className="flex items-start gap-2 text-lg leading-snug font-semibold tracking-tight text-balance sm:text-xl">
								<CircleDot className="mt-1 size-5 shrink-0 text-fd-muted-foreground" />
								<span>
									<span className="mr-2 whitespace-nowrap text-fd-muted-foreground">
										Issue #44
									</span>
									Export fails for accounts with more than 1,000 tasks
								</span>
							</p>
							<p className="mt-2 flex items-center gap-3 text-xs">
								<StatusPill status={status} />
								<AgentTag name="implementer" />
							</p>
						</div>
						<dl className="flex gap-6 text-sm">
							<div className="flex gap-2">
								<dt className="text-fd-muted-foreground">Duration</dt>
								<dd className="font-medium">
									<RollingNumber value={formatDuration(seconds)} />
								</dd>
							</div>
							<div className="flex gap-2">
								<dt className="text-fd-muted-foreground">Cost</dt>
								<dd className="font-medium">
									<RollingNumber value={`$${cost}`} />
								</dd>
							</div>
						</dl>
					</div>
					<div className="grid lg:grid-cols-[minmax(0,1fr)_20rem]">
						<div className="relative h-[22rem] overflow-hidden sm:h-[27rem] px-3 sm:px-5 [mask-image:linear-gradient(to_bottom,transparent,black_4rem)]">
							<ol className="absolute inset-x-3 bottom-0 flex flex-col pb-4 sm:inset-x-5">
								{log.map((entry, i) => (
									<LogRow
										// biome-ignore lint/suspicious/noArrayIndexKey: a fixed script, played in order.
										key={i}
										entry={entry}
									/>
								))}
								{!done && visible > 0 && (
									<li className="flex items-center gap-3 px-2 py-2 text-sm text-fd-muted-foreground">
										<span className="tnum w-9 text-xs">{clockOf(seconds)}</span>
										<span className="flex gap-1">
											<span className="size-1.5 animate-pulse rounded-full bg-fd-primary" />
											<span className="size-1.5 animate-pulse rounded-full bg-fd-primary [animation-delay:150ms]" />
											<span className="size-1.5 animate-pulse rounded-full bg-fd-primary [animation-delay:300ms]" />
										</span>
									</li>
								)}
							</ol>
						</div>
						<div className="border-t border-of-line bg-of-panel/60 p-5 lg:border-t-0 lg:border-l">
							<p className="flex items-center gap-2 text-sm font-medium">
								<Inbox className="size-4 text-fd-muted-foreground" />
								Outputs
							</p>
							<p className="mt-1 text-xs text-fd-muted-foreground">
								The agent proposes. The engine runs the checks, then applies
								only what
								<code className="of-inline-code mx-1">can</code>allows.
							</p>
							{outputState(log, 0) === null && (
								<p className="mt-4 rounded-xl border border-dashed border-of-line px-3 py-4 text-center text-xs text-fd-muted-foreground">
									Nothing proposed yet.
								</p>
							)}
							<ul className="mt-4 flex flex-col gap-2">
								{OUTPUTS.map((o, i) => {
									const state = outputState(log, i);
									if (!state) return null;
									return (
										<li
											key={o.action}
											className={`of-enter rounded-xl border p-3 text-sm transition-colors duration-500 ${OUTPUT_STATE[state].box}`}
										>
											<span className="flex items-center gap-2 font-medium">
												<o.icon className="size-4 shrink-0" />
												{o.action}
												<OutputBadge key={state} state={state} />
											</span>
											<span className="mt-1 block text-xs text-fd-muted-foreground">
												{o.detail}
											</span>
										</li>
									);
								})}
							</ul>
						</div>
					</div>
				</div>
			</WindowFrame>
			<p className="sr-only">
				An example run: the implementer reads the code, writes a failing test,
				fixes the export, and proposes a pull request, a comment and to remove
				the bug label. The engine runs the checks, has the reviewer read the
				change, writes the pull request and the comment, and refuses to remove
				the label: the automation may only remove ready-for-agent.
			</p>
		</div>
	);
}

function StatusPill({
	status,
}: {
	status: "Queued" | "Working" | "Succeeded";
}) {
	const tone =
		status === "Succeeded"
			? "bg-of-ok-soft text-of-ok"
			: status === "Working"
				? "bg-of-accent-soft text-fd-primary"
				: "bg-of-sunken text-fd-muted-foreground";
	return (
		<span
			key={status}
			className={`of-enter inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium ${tone}`}
		>
			<span
				className={`size-1.5 rounded-full bg-current ${status === "Working" ? "of-pulse" : ""}`}
			/>
			{status}
		</span>
	);
}

function OutputBadge({ state }: { state: OutputState }) {
	const { tone, icon: Icon, label } = OUTPUT_STATE[state];
	return (
		<span
			className={`of-enter ml-auto flex items-center gap-1 text-xs ${tone}`}
		>
			{Icon && <Icon className="size-3.5" />}
			{label}
		</span>
	);
}
