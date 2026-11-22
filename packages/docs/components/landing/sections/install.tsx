import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/logo";
import { GITHUB } from "@/lib/layout.shared";
import { WindowFrame } from "../window-frame";

const OWNER = GITHUB.split("/").at(-2) ?? "openfabriq";
export const INSTALL = `brew install ${OWNER}/tap/openfabriq`;

/** From install to a running factory; `children` close the section (the docs' map). */
export function Install({ children }: { children?: ReactNode }) {
	return (
		<section
			aria-labelledby="install"
			className="relative overflow-hidden py-24 sm:py-36"
		>
			<div className="mx-auto grid w-full max-w-7xl gap-14 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
				<div>
					<LogoMark className="size-12" />
					<h2
						id="install"
						className="mt-8 text-4xl font-semibold tracking-[-0.04em] text-balance sm:text-6xl"
					>
						From install to a running factory.
					</h2>
					<p className="mt-6 max-w-lg text-lg leading-relaxed text-pretty text-fd-muted-foreground">
						<code className="of-inline-code">init</code> opens a Claude Code
						session that reads your repository, asks a few questions and writes
						the folder. You review the plan, apply it, and start.
					</p>
					<div className="mt-9 flex flex-wrap gap-3">
						<Link
							href="/getting-started/quickstart/"
							className="group inline-flex h-11 items-center gap-2 rounded-xl bg-fd-foreground px-5 text-[15px] font-medium text-fd-background shadow-of-2 transition-opacity hover:opacity-90"
						>
							Read the quickstart
							<ArrowRight
								className="size-4 transition-transform duration-300 group-hover:translate-x-0.5"
								aria-hidden
							/>
						</Link>
						<a
							href={GITHUB}
							className="inline-flex h-11 items-center gap-2 rounded-xl border border-of-line bg-of-panel px-5 text-[15px] font-medium shadow-of-1 transition-colors hover:border-fd-foreground/30"
						>
							<svg
								viewBox="0 0 24 24"
								className="size-4 fill-current"
								aria-hidden
							>
								<path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.6.2 2.8.1 3.2.8.8 1.3 1.9 1.3 3.1 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1.1.9 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
							</svg>
							Star on GitHub
						</a>
					</div>
				</div>
				<WindowFrame title="Terminal">
					<ol className="flex flex-col gap-1 p-5 font-mono text-[13px] sm:p-6">
						{[
							[INSTALL, "once, on the engine's machine"],
							["cd your-repository", ""],
							["openfabriq init", "Claude Code writes openfabriq/ with you"],
							["openfabriq apply", "after reading the plan"],
							[
								"openfabriq start",
								"the engine, and the studio on 127.0.0.1:4310",
							],
						].map(([cmd, note]) => (
							<li key={cmd} className="flex flex-wrap gap-x-3 py-1.5">
								<span>
									<span className="text-fd-muted-foreground select-none">
										${" "}
									</span>
									{cmd}
								</span>
								{note && (
									<span className="text-fd-muted-foreground"># {note}</span>
								)}
							</li>
						))}
					</ol>
				</WindowFrame>
			</div>

			{children}
		</section>
	);
}
