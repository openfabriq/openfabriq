import {
	AuiIf,
	ComposerPrimitive,
	useAui,
	useAuiState,
} from "@assistant-ui/react";
import { ArrowUp, FolderGit2, Square } from "lucide-react";
import { pageHref } from "../../lib/route.js";

/** Where the person writes: the suggested next message, the project, send or stop. */
export function Composer({
	project,
	projects,
}: {
	project: string;
	projects: string[];
}) {
	const aui = useAui();
	// The suggested next message shows in the empty input, like Claude Code's.
	const suggestion = useAuiState((s) =>
		s.composer.text ? undefined : s.thread.suggestions[0]?.prompt,
	);
	return (
		<ComposerPrimitive.Root className="rounded-2xl border border-line bg-panel shadow-pop transition-colors focus-within:border-line-2">
			<ComposerPrimitive.Input
				rows={1}
				autoFocus
				// A stable name: the placeholder changes with the suggestion.
				aria-label="Message"
				placeholder={
					suggestion ?? "Ask about the factory, its agents or its runs"
				}
				onKeyDown={(e) => {
					if (suggestion && (e.key === "Tab" || e.key === "ArrowRight")) {
						e.preventDefault();
						aui.composer().setText(suggestion);
					}
				}}
				className="block max-h-48 min-h-12 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-base text-fg outline-none placeholder:text-fg-3"
			/>
			<div className="flex items-center gap-2 px-2.5 pb-2.5">
				<label className="flex min-w-0 items-center gap-1.5 rounded-lg border border-transparent px-2 py-1 text-xs text-fg-2 transition-colors focus-within:border-line hover:bg-hover hover:text-fg">
					<FolderGit2 className="size-3.5 shrink-0" aria-hidden />
					<span className="sr-only">Project</span>
					<select
						value={project}
						onChange={(e) => {
							window.location.hash = pageHref("chat", e.target.value);
						}}
						className="min-w-0 cursor-pointer truncate bg-transparent font-mono text-xs outline-none"
					>
						{projects.map((p) => (
							<option key={p} value={p}>
								{p}
							</option>
						))}
					</select>
				</label>
				<span className="ml-auto hidden text-2xs text-fg-3 sm:inline">
					{suggestion
						? "Tab to use the suggestion · Enter to send"
						: "Enter to send · Shift Enter for a new line"}
				</span>
				<AuiIf condition={(s) => !s.thread.isRunning}>
					<ComposerPrimitive.Send
						aria-label="Send"
						className="ml-auto inline-flex size-8 items-center justify-center rounded-lg bg-ink text-ink-fg transition-opacity hover:opacity-90 disabled:opacity-25 sm:ml-0"
					>
						<ArrowUp className="size-4" aria-hidden />
					</ComposerPrimitive.Send>
				</AuiIf>
				<AuiIf condition={(s) => s.thread.isRunning}>
					<ComposerPrimitive.Cancel
						aria-label="Stop the answer"
						title="Stop"
						className="ml-auto inline-flex size-8 items-center justify-center rounded-lg bg-ink text-ink-fg transition-opacity hover:opacity-90 sm:ml-0"
					>
						<Square className="size-3 fill-current" aria-hidden />
					</ComposerPrimitive.Cancel>
				</AuiIf>
			</div>
		</ComposerPrimitive.Root>
	);
}
