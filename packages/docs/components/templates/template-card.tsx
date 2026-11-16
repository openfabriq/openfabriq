import { ArrowUpRight, Bot, Zap } from "lucide-react";
import Link from "next/link";
import { CopyCommand } from "@/components/landing/copy-command";
import { FullscreenImage } from "./fullscreen-image";

export interface TemplateSummary {
	name: string;
	slug: string;
	title: string;
	does: string;
	startsOn: string[];
	hasWorkflow: boolean;
	/** How the card frames the graph: whole, its top (a tall one), its top-left corner (a wide one), or its left middle. */
	workflowFrame?: "whole" | "top" | "corner" | "left";
	agents: number;
	automations: number;
}

const FRAME = {
	whole: "max-h-full max-w-full object-contain",
	top: "h-full w-full object-cover object-top",
	corner:
		"absolute top-10 left-4 h-[180%] w-[180%] max-w-none object-cover object-left-top",
	left: "absolute top-1/2 left-4 h-[180%] w-[180%] max-w-none -translate-y-1/2 object-cover object-left",
} as const;

/** A template in a grid: its workflow, what it does, when it starts, and the command that copies it. */
export function TemplateCard({ t }: { t: TemplateSummary }) {
	return (
		<article className="group relative flex flex-col overflow-hidden rounded-2xl border border-of-line bg-of-panel shadow-of-1 transition-[box-shadow,border-color,translate] duration-300 ease-of hover:-translate-y-0.5 hover:border-fd-primary/30 hover:shadow-of-3">
			<div className="relative border-b border-of-line">
				{/* The image and its ground share one filter in the dark theme, so they stay one surface. */}
				<div className="of-diagram relative flex aspect-[16/9] items-center justify-center overflow-hidden bg-[#f3f4f6] p-5">
					{t.hasWorkflow ? (
						// biome-ignore lint/performance/noImgElement: a static export has no image optimizer.
						<img
							src={`/templates/${t.slug}/workflow.png`}
							alt=""
							loading="lazy"
							className={`transition-transform ${FRAME[t.workflowFrame ?? "whole"]} duration-500 ease-of group-hover:scale-[1.03]`}
						/>
					) : (
						<span className="font-mono text-xs text-zinc-500">openfabriq/</span>
					)}
				</div>
				{t.hasWorkflow && (
					<FullscreenImage
						src={`/templates/${t.slug}/workflow.png`}
						alt={`The workflow of ${t.title}`}
					/>
				)}
				<span className="absolute top-3 left-3 rounded-md bg-of-panel/90 px-1.5 py-0.5 font-mono text-[11px] text-fd-muted-foreground shadow-of-1 backdrop-blur">
					{t.name.split("-")[0]}
				</span>
			</div>
			<div className="flex flex-1 flex-col p-5">
				<h3 className="text-[17px] leading-snug font-semibold tracking-tight text-balance">
					<Link
						href={`/templates/${t.slug}/`}
						className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none group-has-[:focus-visible]:underline"
					>
						{t.title}
					</Link>
				</h3>
				<p className="mt-2 text-sm leading-relaxed text-pretty text-fd-muted-foreground">
					{t.does}
				</p>
				<p className="mt-4 flex flex-wrap gap-1.5">
					{t.startsOn.slice(0, 3).map((s) => (
						<span
							key={s}
							className="rounded-md bg-of-sunken px-1.5 py-0.5 font-mono text-[11px] text-fd-muted-foreground"
						>
							{s}
						</span>
					))}
				</p>
				<div className="mt-auto pt-5">
					<p className="mb-3 flex items-center gap-4 text-xs text-fd-muted-foreground">
						<span className="flex items-center gap-1.5">
							<Bot className="size-3.5" aria-hidden />
							{t.agents} agent{t.agents === 1 ? "" : "s"}
						</span>
						<span className="flex items-center gap-1.5">
							<Zap className="size-3.5" aria-hidden />
							{t.automations} automation{t.automations === 1 ? "" : "s"}
						</span>
						<ArrowUpRight
							className="ml-auto size-4 text-fd-primary opacity-0 transition-[opacity,translate] duration-300 group-hover:translate-x-0.5 group-hover:opacity-100"
							aria-hidden
						/>
					</p>
					<CopyCommand
						command={`openfabriq init --example ${t.name}`}
						tone="quiet"
						wrap
						className="relative z-10 text-xs"
					/>
				</div>
			</div>
		</article>
	);
}
