"use client";

import { Check, ChevronRight, Copy, SquareTerminal, X } from "lucide-react";
import { useRef } from "react";
import { useCopy } from "@/hooks/use-copy";
import { cn } from "@/lib/cn";
import { INSTALL_PROMPT } from "@/lib/install-prompt";
import { MACHINE_PROMPT, SETUP_PROMPT } from "@/lib/setup-prompt";

const PROMPTS = {
	setup: SETUP_PROMPT,
	machine: MACHINE_PROMPT,
	install: INSTALL_PROMPT,
};

/**
 * Copies a prompt, to paste into Claude Code: by default the one that sets openfabriq up in a
 * repository; `machine` only installs openfabriq on this machine; `install` installs the engine on a server over SSH. As a banner, the prompt can be read first; compact (the setup prompt only), it is one
 * line that links to where it can be read.
 */
export function CopyPrompt({
	className,
	compact = false,
	kind = "setup",
}: {
	className?: string;
	compact?: boolean;
	kind?: keyof typeof PROMPTS;
}) {
	const prompt = PROMPTS[kind];
	const [copied, copy] = useCopy(prompt);
	const reading = useRef<HTMLDialogElement>(null);
	const icon = copied ? (
		<Check className="of-digit size-4 text-of-ok" aria-hidden />
	) : (
		<Copy className="size-4" aria-hidden />
	);
	const announce = (
		<span className="sr-only" aria-live="polite">
			{copied ? "Prompt copied to the clipboard" : ""}
		</span>
	);
	if (compact)
		return (
			<>
				<div
					className={cn(
						"flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-fd-muted-foreground",
						className,
					)}
				>
					Or let Claude Code set it up:
					{/* The action and its "read it first" wrap together, never apart. */}
					<span className="inline-flex items-center gap-x-1.5 whitespace-nowrap">
						<button
							type="button"
							onClick={copy}
							className="inline-flex items-center gap-1.5 rounded-md px-1 font-medium text-fd-foreground underline-offset-4 hover:underline"
						>
							{icon}
							{copied ? "Copied" : "Copy the prompt"}
						</button>
						<span aria-hidden>·</span>
						<button
							type="button"
							onClick={() => reading.current?.showModal()}
							className="underline-offset-4 hover:text-fd-foreground hover:underline"
						>
							Read it first
						</button>
					</span>
					{announce}
				</div>
				{/* Reading what you will paste into your agent, then copying it: one short, focused task. */}
				{/* biome-ignore lint/a11y/useKeyWithClickEvents: the backdrop click is a mouse shortcut; Escape and the close button serve the keyboard */}
				<dialog
					ref={reading}
					aria-labelledby="setup-prompt-title"
					onClick={(e) => {
						if (e.target === reading.current) reading.current.close();
					}}
					className="m-auto w-[calc(100%-2rem)] max-w-2xl overflow-hidden rounded-2xl border border-of-line bg-of-panel p-0 text-fd-foreground shadow-of-3 backdrop:bg-black/50 backdrop:backdrop-blur-sm"
				>
					<div className="flex items-start gap-4 border-b border-of-line px-5 py-4">
						<div className="min-w-0 flex-1">
							<h2
								id="setup-prompt-title"
								className="text-[17px] font-semibold tracking-[-0.025em]"
							>
								The setup prompt
							</h2>
							<p className="mt-1 text-sm leading-relaxed text-pretty text-fd-muted-foreground">
								Paste it into Claude Code, in your repository. It installs
								openfabriq and what it needs, writes a first factory with you
								and saves it once you say yes. You then run one command:
								openfabriq start.
							</p>
						</div>
						<form method="dialog">
							<button
								type="submit"
								aria-label="Close the prompt"
								className="flex size-8 items-center justify-center rounded-lg text-fd-muted-foreground transition-colors hover:bg-of-sunken hover:text-fd-foreground"
							>
								<X className="size-4" aria-hidden />
							</button>
						</form>
					</div>
					<pre className="max-h-[55vh] overflow-auto bg-of-sunken/60 px-5 py-4 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
						{prompt}
					</pre>
					<div className="flex justify-end border-t border-of-line px-5 py-3">
						<button
							type="button"
							onClick={copy}
							className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-fd-foreground px-4 text-sm font-medium text-fd-background shadow-of-2 transition-opacity hover:opacity-90"
						>
							{icon}
							{copied ? "Copied" : "Copy the prompt"}
						</button>
					</div>
				</dialog>
			</>
		);
	return (
		<div
			className={cn(
				"not-prose rounded-xl border border-of-line bg-of-sunken",
				className,
			)}
		>
			<div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-5 sm:pl-5">
				<SquareTerminal
					className="hidden size-5 shrink-0 text-fd-muted-foreground sm:block"
					aria-hidden
				/>
				<p className="min-w-0 flex-1 text-[15px] leading-relaxed text-pretty text-fd-muted-foreground">
					{kind === "install" ? (
						<>
							<strong className="font-medium text-fd-foreground">
								Let Claude Code install it on your server.
							</strong>{" "}
							Paste one prompt into Claude Code on your computer: it sets the
							server up over SSH and starts the engine. It never asks for your
							tokens: you type them into{" "}
							<code className="of-inline-code">.env</code> yourself.
						</>
					) : kind === "machine" ? (
						<>
							<strong className="font-medium text-fd-foreground">
								Let your coding agent install it.
							</strong>{" "}
							One prompt for Claude Code checks your machine, installs
							openfabriq and checks your logins. It never logs in or installs
							system packages for you: it tells you the command.
						</>
					) : (
						<>
							<strong className="font-medium text-fd-foreground">
								Let your coding agent set it up.
							</strong>{" "}
							One prompt for Claude Code installs openfabriq and what it needs,
							writes a first factory with you and saves it. You then run one
							command: <code className="of-inline-code">openfabriq start</code>
						</>
					)}
				</p>
				<button
					type="button"
					onClick={copy}
					className="inline-flex h-10 shrink-0 items-center justify-center gap-2 self-start rounded-xl border border-of-line bg-of-panel px-4 text-sm font-medium whitespace-nowrap shadow-of-1 transition-colors hover:border-fd-foreground/30 sm:self-auto"
				>
					{icon}
					{copied ? "Copied" : "Copy the prompt"}
				</button>
				{announce}
			</div>
			<details className="group border-t border-of-line">
				<summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-2.5 text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground sm:pl-5 [&::-webkit-details-marker]:hidden">
					<ChevronRight
						className="size-3.5 transition-transform duration-200 group-open:rotate-90"
						aria-hidden
					/>
					Read the prompt
				</summary>
				<pre className="max-h-96 overflow-auto border-t border-of-line px-4 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap sm:px-5">
					{prompt}
				</pre>
			</details>
		</div>
	);
}
