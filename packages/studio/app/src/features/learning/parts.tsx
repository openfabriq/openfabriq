import type { FailureKind } from "@openfabriq/runner";
import {
	FlaskConical,
	GitPullRequestArrow,
	Info,
	MessageSquareWarning,
	ScanEye,
} from "lucide-react";
import { type ReactNode, useId } from "react";
import { ago } from "../../lib/format.js";
import type { LearningAnswer } from "../../lib/types.js";

// What the Learning page and a lesson's page share: the kinds of mistake, how a rule is shown,
// whom it is for, and how dates and counts are said.

export type Row = LearningAnswer["toReview"][number];

/** Each kind of mistake: a mark, a color from the palette. */
export const KINDS: Record<
	FailureKind,
	{ icon: typeof FlaskConical; tone: string; bar: string }
> = {
	check: { icon: FlaskConical, tone: "text-bad", bar: "bg-bad" },
	review: { icon: ScanEye, tone: "text-warn", bar: "bg-warn" },
	checks_failed: {
		icon: GitPullRequestArrow,
		tone: "text-accent-text",
		bar: "bg-accent",
	},
	changes_requested: {
		icon: MessageSquareWarning,
		tone: "text-fg-2",
		bar: "bg-fg-3",
	},
};
export const KIND_ORDER = Object.keys(KINDS) as FailureKind[];

/** The kinds of mistake, as a person says them. */
export const SAID: Record<FailureKind, string> = {
	check: "Check kept failing",
	review: "Review asked for changes",
	checks_failed: "Red checks on GitHub",
	changes_requested: "Maintainer asked for changes",
};

/** The kinds of mistake in one word, for a legend; `SAID` says them in full. */
export const SHORT: Record<FailureKind, string> = {
	check: "Check",
	review: "Review",
	checks_failed: "GitHub",
	changes_requested: "Maintainer",
};

/** "once", "twice", "3 times". */
export const times = (n: number) =>
	n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;

/** How long ago, without the time of day once it is a date. */
export const since = (iso: string) => ago(iso).replace(/, \d{1,2}:\d{2}$/, "");

/** Whom a rule is for: the agent whose agent.md it goes into, or the skill. */
export function owner(target: string): { label: string; agent?: string } {
	const parts = target.split("/");
	const agent = parts.indexOf("agents");
	if (agent >= 0 && parts.at(-1) === "agent.md") {
		const name = parts[agent + 1] ?? "";
		return { label: name, agent: name };
	}
	const automation = parts.indexOf("automations");
	if (automation >= 0 && parts.at(-1) === "automation.md")
		return { label: `${parts[automation + 1]} automation` };
	const skill = parts.indexOf("skills");
	return { label: skill >= 0 ? `${parts[skill + 1]} skill` : target };
}

/** What a word means, one hover or focus away: an info mark, and its tooltip above or below. */
export function InfoTip({
	label,
	side = "above",
	align = "start",
	children,
}: {
	/** The word it explains, for a screen reader: "About Seen". */
	label: string;
	side?: "above" | "below";
	/** Which edge of the mark the tooltip lines up with: "end" near the right of the page. */
	align?: "start" | "end";
	children: ReactNode;
}) {
	const id = useId();
	return (
		<span className="group/tip relative inline-flex align-[-2px]">
			<button
				type="button"
				aria-label={`About ${label}`}
				aria-describedby={id}
				className="inline-flex size-4 cursor-help items-center justify-center rounded-full text-fg-3 transition-colors duration-150 hover:text-fg focus-visible:text-fg"
			>
				<Info className="size-3.5" aria-hidden />
			</button>
			<span
				id={id}
				role="tooltip"
				className={`pointer-events-none invisible absolute z-30 w-64 rounded-xl border border-line bg-panel px-3.5 py-3 text-left text-xs leading-5 font-normal text-pretty text-fg-2 normal-case opacity-0 shadow-pop transition-[opacity,translate,visibility] duration-150 ease-out group-focus-within/tip:visible group-focus-within/tip:translate-y-0 group-focus-within/tip:opacity-100 group-hover/tip:visible group-hover/tip:translate-y-0 group-hover/tip:opacity-100 ${side === "above" ? "bottom-full mb-2 translate-y-1" : "top-full mt-2 -translate-y-1"} ${align === "start" ? "left-0" : "right-0"}`}
			>
				{children}
			</span>
		</span>
	);
}

/** What "Seen" counts, in a sentence. */
export const SEEN_HINT = (threshold: number) =>
	`In how many separate runs this mistake happened. Learning proposes a rule once it is seen in ${threshold}. A run whose review and then checks both caught it counts once.`;

/** What a mistake is, in a sentence. */
export const MISTAKE_HINT =
	"Each time an agent's work was not right the first time: a check that kept failing, the review or a maintainer that asked for changes, or red checks on GitHub. Not a failed run: the work may well have passed once fixed.";

export const inlineCode = (text: string) => (
	<code className="rounded-md bg-panel px-1.5 py-0.5 font-mono text-xs whitespace-nowrap text-fg ring-1 ring-line">
		{text}
	</code>
);

/** A rule as people write it: `code` in backticks shown as code. */
export function Code({ text }: { text: string }) {
	return (
		<>
			{text.split(/(`[^`]+`)/).map((part, i) =>
				part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
					<code
						// biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed text
						key={i}
						className="rounded bg-sunken px-1 py-px font-mono text-[0.86em] ring-1 ring-line"
					>
						{part.slice(1, -1)}
					</code>
				) : (
					part
				),
			)}
		</>
	);
}

/** How many runs a lesson was seen in, out of the threshold. */
export function Pips({
	value,
	of,
	waits,
}: {
	value: number;
	of: number;
	waits: boolean;
}) {
	return (
		<span
			className="inline-flex gap-1"
			role="img"
			aria-label={`${value} of ${of}`}
		>
			{Array.from({ length: Math.max(of, value) }, (_, i) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: positions
					key={i}
					className={`h-1.5 w-4 rounded-full ${i < value ? (waits ? "bg-warn" : "bg-accent") : "bg-line-2"}`}
				/>
			))}
		</span>
	);
}
