import { stageCount } from "../features/board/board-view.js";
import { useApi } from "../hooks/use-api.js";
import { query } from "../lib/api.js";
import type { Board, LearningAnswer, Stage } from "../lib/types.js";

/** Learning's improvements waiting for a person to review them on GitHub. */
function ToReview({ project }: { project: string | undefined }) {
	const count = useApi<LearningAnswer>(
		`/api/learning${query({ project })}`,
		60_000,
	).data?.numbers.toReview;
	return count ? (
		<span
			className="tnum ml-auto rounded-full bg-accent-soft px-1.5 py-px text-2xs font-medium text-accent-text"
			title={`${count} improvement${count === 1 ? "" : "s"} to review`}
		>
			{count}
		</span>
	) : null;
}

/** What a page has going on right now, next to its name: work in progress, work for you. */
export function LiveBadge({
	page,
	project,
	board,
	chatBusy,
}: {
	page: string;
	project: string | undefined;
	board: Board | undefined;
	chatBusy: boolean;
}) {
	if (page === "learning") return <ToReview project={project} />;
	const count = (stage: Stage) => (board ? stageCount(board, stage) : 0);
	if (page === "chat")
		return chatBusy ? (
			<span
				className="ml-auto size-1.5 rounded-full bg-accent"
				title="Answering"
				style={{ animation: "pulse-soft 1.4s ease-in-out infinite" }}
			/>
		) : null;
	if (page !== "board") return null;
	const working = count("working");
	const needs = count("needs-you");
	return (
		<span className="tnum ml-auto flex items-center gap-1.5 text-2xs font-medium">
			{working > 0 && (
				<span
					className="flex items-center gap-1 text-accent-text"
					title={`${working} working`}
				>
					<span className="size-1.5 rounded-full bg-current" />
					{working}
				</span>
			)}
			{needs > 0 && (
				<span
					className="rounded-full bg-warn-soft px-1.5 py-px text-warn"
					title={`${needs} need you`}
				>
					{needs}
				</span>
			)}
		</span>
	);
}
