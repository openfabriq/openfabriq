import {
	Brain,
	ChevronRight,
	FileInput,
	LoaderCircle,
	Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import { useOutputTitle } from "../../components/assistant-ui/output.js";
import { Code, Input } from "../../components/assistant-ui/tool-call.js";
import {
	actionOf,
	isOutput,
	summaryOf,
} from "../../components/assistant-ui/tool-parts.js";
import { Elapsed } from "../../components/badges.js";
import { Prose } from "../../components/markdown.js";
import { clock, duration } from "../../lib/format.js";
import { ICONS } from "../../lib/icons.js";
import type { RunRecord } from "../../lib/types.js";
import { engineLine } from "./engine-line.js";
import {
	type Entry,
	isOutputCall,
	sinceQueued,
	type ToolCall,
} from "./run-log.js";

// The lines of a run's log: a gesture of the engine, a tool the agent used, a step it took.

export function Row({
	time,
	clockAt,
	icon,
	children,
}: {
	time: string;
	clockAt?: string;
	icon: ReactNode;
	children: ReactNode;
}) {
	return (
		<li className="grid grid-cols-[44px_20px_minmax(0,1fr)] items-start gap-x-2.5 py-1">
			<span
				className="tnum pt-[7px] text-right text-2xs text-fg-3"
				title={clockAt ? clock(clockAt) : undefined}
			>
				{time}
			</span>
			<span className="flex h-8 items-center justify-center">{icon}</span>
			<div className="min-w-0">{children}</div>
		</li>
	);
}

const fold =
	"group/fold flex min-h-8 w-full cursor-pointer list-none items-center gap-2 rounded-md px-2 text-sm transition-colors duration-150 hover:bg-hover [&::-webkit-details-marker]:hidden";

export function Chevron() {
	return (
		<ChevronRight
			className="size-3.5 shrink-0 text-fg-3 transition-transform duration-150 group-open/fold:rotate-90"
			aria-hidden
		/>
	);
}

export function ToolRow({
	part,
	outputsHref,
	replaced = false,
}: {
	part: ToolCall;
	outputsHref: string;
	/** A pull request or push the agent proposed again after a review: the engine applied the later one. */
	replaced?: boolean;
}) {
	const { title, detail } = summaryOf(part);
	const outputTitle = useOutputTitle(part);
	const output = isOutput(part.toolName);
	const action = actionOf(part.toolName);
	if (output && replaced)
		return (
			<div className="flex min-h-8 items-center gap-2 rounded-md border border-dashed border-line-2 px-2.5 text-sm">
				<span className="shrink-0 font-medium text-fg-2">Replaced</span>
				<span className="shrink-0 font-medium text-fg-2">{title}</span>
				{detail && <span className="min-w-0 truncate text-fg-3">{detail}</span>}
				<span className="ml-auto hidden shrink-0 pl-2 text-xs text-fg-3 sm:inline">
					proposed again after the review
				</span>
				<span className="sr-only">{action}</span>
			</div>
		);
	if (output)
		return (
			<a
				href={outputsHref}
				className="flex min-h-8 items-center gap-2 rounded-md border border-accent-line bg-accent-soft px-2.5 text-sm no-underline transition-colors duration-150 hover:border-accent"
			>
				<span className="shrink-0 font-medium text-accent-text">Proposed</span>
				<span className="shrink-0 font-medium text-fg">{outputTitle}</span>
				{detail && <span className="min-w-0 truncate text-fg-2">{detail}</span>}
				<span className="ml-auto hidden shrink-0 pl-2 text-xs text-fg-2 sm:inline">
					See in Outputs
				</span>
				<span className="sr-only">{action}</span>
			</a>
		);
	return (
		<details>
			<summary className={fold}>
				<Chevron />
				<span className="shrink-0 font-medium text-fg">{title}</span>
				{detail && (
					<span className="min-w-0 truncate font-mono text-xs text-fg-2">
						{detail}
					</span>
				)}
				<span className="ml-auto flex shrink-0 items-center gap-2 pl-2 text-2xs">
					{part.isError && <span className="font-medium text-bad">failed</span>}
					{part.result === undefined ? (
						<LoaderCircle
							className="size-3.5 animate-spin text-fg-3"
							aria-label="Running"
						/>
					) : (
						part.durationMs !== undefined && (
							<span className="tnum text-fg-3">
								{duration(part.durationMs)}
							</span>
						)
					)}
				</span>
			</summary>
			<div className="space-y-2 pt-1 pr-2 pb-3 pl-7">
				<Input part={part} />
				{part.result !== undefined && (
					<Code tone={part.isError ? "bad" : undefined}>
						{part.result || "(no output)"}
					</Code>
				)}
			</div>
		</details>
	);
}

export function Working({ label, since }: { label: string; since: string }) {
	return (
		<p
			className="flex items-center gap-2 px-2 py-1.5 text-sm"
			aria-live="polite"
		>
			<span className="shimmer font-medium">{label}</span>
			<span className="tnum text-xs text-fg-3">
				<Elapsed since={since} />
			</span>
		</p>
	);
}

/** One line of the log: a gesture of the engine, or a step of the agent. */
export function EntryRow({
	e,
	run,
	outputsHref,
	replaced = false,
}: {
	e: Entry;
	run: RunRecord;
	outputsHref: string;
	/** A tool call: a proposal a later one replaced, after a review. */
	replaced?: boolean;
}) {
	const time = sinceQueued(run.queuedAt, e.at);
	const engine = engineLine(e, run);
	if (engine)
		return (
			<Row
				time={time}
				{...(e.at ? { clockAt: e.at } : {})}
				icon={
					<engine.icon
						className={`size-3.5 ${engine.tone === "bad" ? "text-bad" : engine.tone === "warn" ? "text-warn" : "text-fg-3"}`}
						aria-hidden
					/>
				}
			>
				<p
					className={`px-2 py-[6px] text-sm ${engine.tone === "bad" ? "text-bad" : "text-fg-2"}`}
				>
					{engine.text}
				</p>
			</Row>
		);
	switch (e.kind) {
		case "prompt":
			return (
				<Row
					time={time}
					{...(e.at ? { clockAt: e.at } : {})}
					icon={<FileInput className="size-3.5 text-fg-3" aria-hidden />}
				>
					<details>
						<summary className={fold}>
							<Chevron />
							<span className="font-medium text-fg">Prompt</span>
							<span className="truncate text-fg-2">
								what {run.agent} was given
							</span>
						</summary>
						{/* As sent: as Markdown, its <github-data> block would read as HTML and vanish. */}
						<pre className="mt-1 mb-2 ml-2 max-h-[32rem] overflow-auto rounded-lg border border-line bg-sunken px-4 py-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words text-fg-2">
							{e.text}
						</pre>
					</details>
				</Row>
			);
		case "reasoning":
			return (
				<Row
					time={time}
					{...(e.at ? { clockAt: e.at } : {})}
					icon={<Brain className="size-3.5 text-fg-3" aria-hidden />}
				>
					<details>
						<summary className={fold}>
							<Chevron />
							<span className="text-fg-2">Thinking</span>
						</summary>
						<p className="mt-1 mb-2 ml-2 border-l border-line-2 pl-4 text-sm whitespace-pre-wrap text-fg-2">
							{e.text}
						</p>
					</details>
				</Row>
			);
		case "text":
			return (
				<Row
					time={time}
					{...(e.at ? { clockAt: e.at } : {})}
					icon={
						<span
							className={`size-2 rounded-full ${e.person ? "border border-fg-3" : "bg-fg-3"}`}
							aria-hidden
						/>
					}
				>
					<div className="px-2 py-[5px]">
						{e.person && (
							<p className="mb-1 text-xs font-medium text-fg-2">
								A person wrote
							</p>
						)}
						<Prose className="prose-sm">{e.text}</Prose>
					</div>
				</Row>
			);
		case "tool": {
			const Icon = ICONS[actionOf(e.part.toolName)] ?? Wrench;
			return (
				<Row
					time={time}
					{...(e.at ? { clockAt: e.at } : {})}
					icon={
						<Icon
							className={`size-3.5 ${e.part.isError ? "text-bad" : isOutputCall(e.part) ? "text-accent-text" : "text-fg-2"}`}
							aria-hidden
						/>
					}
				>
					<ToolRow
						part={e.part}
						outputsHref={outputsHref}
						replaced={replaced}
					/>
				</Row>
			);
		}
	}
	return null;
}
