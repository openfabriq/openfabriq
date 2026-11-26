import { Loader2, Play, RefreshCw } from "lucide-react";
import { type ReactNode, useId, useRef } from "react";
import { useModalDialog } from "../hooks/use-modal-dialog.js";

// Asking the engine for a run of its wiki or of learning: the button, its confirmation, and the
// box of the notice that follows the run.

/** Off while a run waits or works: one at a time. */
export function RunButton({
	label,
	busyLabel,
	busy,
	icon = "refresh",
	onClick,
}: {
	label: string;
	busyLabel: string;
	busy: boolean;
	icon?: "refresh" | "play";
	onClick: () => void;
}) {
	const Icon = icon === "play" ? Play : RefreshCw;
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={busy}
			className="inline-flex h-8.5 items-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-medium text-ink-fg shadow-1 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
		>
			{busy ? (
				<Loader2 className="size-3.5 animate-spin" aria-hidden />
			) : (
				<Icon className="size-3.5" aria-hidden />
			)}
			{busy ? busyLabel : label}
		</button>
	);
}

/**
 * Asked before a run: it spends Claude usage, so the person says yes knowing what it does and what
 * it may cost. Cancel has the focus: Enter alone never starts a run.
 */
export function ConfirmRun({
	open,
	title,
	text,
	confirm,
	usdPerRun,
	onCancel,
	onConfirm,
}: {
	open: boolean;
	title: string;
	text: string;
	confirm: string;
	usdPerRun: number | undefined;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	const cancel = useRef<HTMLButtonElement>(null);
	const dialog = useModalDialog(open, () => cancel.current?.focus());
	const titleId = useId();
	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: a click on the backdrop cancels; Escape does by keyboard
		<dialog
			ref={dialog}
			aria-labelledby={titleId}
			onClose={onCancel}
			onClick={(e) => {
				if (e.target === dialog.current) onCancel();
			}}
			className="wiki-dialog mx-auto mt-[18vh] w-[min(28rem,calc(100%-2rem))] max-w-none rounded-xl border border-line bg-panel p-0 text-fg shadow-pop backdrop:bg-ink/25"
		>
			<div className="px-5 pt-5 pb-4">
				<h2 id={titleId} className="text-base font-semibold text-fg">
					{title}
				</h2>
				<p className="mt-2 text-sm text-pretty text-fg-2">{text}</p>
				{usdPerRun !== undefined && (
					<p className="mt-3 rounded-lg bg-sunken px-3 py-2 text-sm text-fg-2">
						It uses Claude, and stops at{" "}
						<span className="font-medium text-fg tnum">${usdPerRun}</span>, this
						factory&rsquo;s limit per run.
					</p>
				)}
			</div>
			<div className="flex justify-end gap-2 border-t border-line bg-sunken px-5 py-3">
				<button
					ref={cancel}
					type="button"
					onClick={onCancel}
					className="h-8.5 rounded-lg px-3 text-sm font-medium text-fg-2 transition-colors duration-150 hover:bg-hover hover:text-fg"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={onConfirm}
					className="h-8.5 rounded-lg bg-ink px-3 text-sm font-medium text-ink-fg shadow-1 transition-opacity hover:opacity-90"
				>
					{confirm}
				</button>
			</div>
		</dialog>
	);
}

/** The tones of a run's notice: working, done, failed. */
export const NOTICE_TONES = {
	working: "border-accent-line bg-accent-soft text-fg",
	done: "border-ok/30 bg-ok-soft text-fg",
	failed: "border-line bg-panel text-fg",
};

/** Where a run stands, in a box above the page. */
export function NoticeBox({
	tone,
	icon,
	children,
}: {
	tone: keyof typeof NOTICE_TONES;
	icon: ReactNode;
	children: ReactNode;
}) {
	return (
		<div
			role="status"
			className={`mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${NOTICE_TONES[tone]}`}
		>
			<span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span>
			<p className="min-w-0 text-pretty">{children}</p>
		</div>
	);
}
