"use client";

import { Pause, Play } from "lucide-react";
import {
	type KeyboardEvent,
	type ReactNode,
	useId,
	useRef,
	useState,
} from "react";
import { useAutoplay } from "@/hooks/use-autoplay";
import { useInterval } from "@/hooks/use-interval";
import { closedAllBut, closeFolder, fileOf, foldersIn } from "@/lib/file-tree";
import { GITHUB } from "@/lib/layout.shared";
import { nextTabIndex } from "@/lib/tabs";
import { FileTree } from "./file-tree";
import { DURATION, TABS, tabOf } from "./tabs";

export interface FactoryFile {
	path: string;
	lang: string;
	code: ReactNode;
}

/**
 * The factory's real files, one tab per part of the format. The tour moves on by itself while
 * it is on screen; choosing a tab or a file stops it.
 */
export function FactoryTabs({
	files,
	example,
	repository,
	tour = true,
}: {
	files: FactoryFile[];
	example: string;
	repository: string;
	/** The tabs move on by themselves while on screen; off in the docs, where people read. */
	tour?: boolean;
}) {
	const autoplay = useAutoplay<HTMLDivElement>("-10% 0px");
	const { ref, reduced, paused, setPaused } = autoplay;
	const [selected, setSelected] = useState(TABS[0].file);
	const paths = files.map((f) => f.path);
	// The tree starts closed: a click on a folder, or a tab showing its file, opens a branch.
	const [closed, setClosed] = useState<ReadonlySet<string>>(
		() => new Set(foldersIn(paths)),
	);
	const openOnly = (path: string) => setClosed(closedAllBut(paths, path));
	const tabs = useRef<(HTMLButtonElement | null)[]>([]);
	const id = useId();

	const tab = tabOf(selected);
	const about = TABS[tab] ?? TABS[0];
	const running = tour && autoplay.running;
	useInterval(running, DURATION, () =>
		show(TABS[(tab + 1) % TABS.length].file),
	);

	const file = files.find((f) => f.path === selected) ?? files[0];
	// Opening a folder closes the others and shows the file it leads to, if any;
	// closing one closes what it holds.
	const toggle = (folder: string) => {
		if (closed.has(folder)) {
			const file = fileOf(paths, folder);
			return file ? choose(file) : openOnly(folder);
		}
		setClosed(closeFolder(paths, closed, folder));
	};

	// Showing a file leaves open only the folders that hold it.
	const show = (path: string) => {
		setSelected(path);
		openOnly(path);
	};
	const choose = (path: string) => {
		show(path);
		setPaused(true);
	};
	const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, i: number) => {
		const next = nextTabIndex(event.key, i, TABS.length);
		if (next === undefined) return;
		event.preventDefault();
		choose(TABS[next].file);
		tabs.current[next]?.focus();
	};

	return (
		<div ref={ref} className="not-prose text-base leading-normal">
			{/* The parts of the format sit above the window, as words: the window keeps the file. */}
			<div className="mb-4 flex items-center gap-3 sm:gap-4">
				<div
					role="tablist"
					aria-label="The parts of a factory"
					className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto rounded-xl border border-of-line bg-of-sunken/60 p-1 [scrollbar-width:none] sm:flex-none sm:gap-1"
				>
					{TABS.map((t, i) => {
						const on = i === tab;
						return (
							<button
								key={t.id}
								ref={(el) => {
									tabs.current[i] = el;
								}}
								id={`${id}-tab-${i}`}
								type="button"
								role="tab"
								aria-selected={on}
								aria-controls={`${id}-panel`}
								tabIndex={on ? 0 : -1}
								onClick={() => choose(t.file)}
								onKeyDown={(e) => onTabKey(e, i)}
								className={`relative h-9 flex-auto shrink-0 overflow-hidden rounded-lg px-2 text-[13px] whitespace-nowrap sm:flex-none transition-[color,background-color,box-shadow] duration-300 sm:px-4 sm:text-[15px] ${on ? "bg-of-panel font-medium text-fd-foreground shadow-of-1" : "text-fd-muted-foreground hover:text-fd-foreground"}`}
							>
								{t.label}
								{on && (
									<span
										aria-hidden
										className="absolute inset-x-3 bottom-1 h-0.5 overflow-hidden rounded-full bg-of-accent-line"
									>
										<span
											key={selected}
											className="absolute inset-0 origin-left bg-fd-primary"
											style={
												running
													? {
															animation: `of-progress ${DURATION}ms linear both`,
														}
													: undefined
											}
										/>
									</span>
								)}
							</button>
						);
					})}
				</div>
				{tour && !reduced && (
					<button
						type="button"
						onClick={() => setPaused((p) => !p)}
						aria-label={paused ? "Play the tour" : "Pause the tour"}
						className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-lg border border-of-line bg-of-panel text-fd-muted-foreground shadow-of-1 transition-colors hover:text-fd-foreground"
					>
						{paused ? (
							<Play className="size-3.5" aria-hidden />
						) : (
							<Pause className="size-3.5" aria-hidden />
						)}
					</button>
				)}
			</div>

			<div
				id={`${id}-panel`}
				role="tabpanel"
				aria-labelledby={`${id}-tab-${tab}`}
				className="overflow-hidden rounded-2xl border border-of-line bg-of-panel shadow-of-3"
			>
				{/* Wide: the tree, then what the part is, in the left column; the file fills the right. */}
				<div className="grid md:h-[35rem] md:grid-cols-[20rem_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)_auto]">
					<FileTree
						paths={paths}
						closed={closed}
						selected={selected}
						label={`Files of examples/${example}`}
						repository={repository}
						onFolder={toggle}
						onFile={choose}
					/>
					<div className="order-last border-t border-of-line bg-of-sunken/40 px-6 py-6 md:order-none md:col-start-1 md:row-start-2 md:border-r">
						<div key={about.id} className="of-enter">
							<p className="text-[16px] leading-snug font-semibold text-balance text-fd-foreground">
								{about.title}
							</p>
							<p className="mt-2.5 text-[14px] leading-relaxed text-pretty text-fd-muted-foreground">
								{about.text}
							</p>
						</div>
					</div>
					<div className="flex min-h-0 min-w-0 flex-col md:col-start-2 md:row-span-2 md:row-start-1">
						<div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-of-line px-6 font-mono text-xs text-fd-muted-foreground">
							<span className="truncate">{file?.path}</span>
							<span className="shrink-0 tracking-wider uppercase">
								{file?.lang === "yaml" ? "YAML" : "Markdown"}
							</span>
						</div>
						<div
							key={file?.path}
							className="of-enter of-code of-code-surface of-notes not-fumadocs-codeblock max-h-[26rem] min-h-0 flex-1 overflow-auto md:max-h-none [&_pre]:py-5"
						>
							{file?.code}
						</div>
					</div>
				</div>
			</div>
			<p className="mt-4 text-[13px] text-fd-muted-foreground">
				The real files of{" "}
				<a
					href={`${GITHUB}/tree/main/examples/${example}`}
					className="font-mono text-[0.95em] underline decoration-of-line underline-offset-4 hover:text-fd-foreground hover:decoration-current"
				>
					examples/{example}
				</a>
				. Select a file to read it.
			</p>
		</div>
	);
}
