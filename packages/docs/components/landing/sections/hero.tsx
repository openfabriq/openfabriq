import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { exampleFactory } from "@/lib/example-code";
import { CopyCommand } from "../copy-command";
import { CopyPrompt } from "../copy-prompt";
import { FactoryTabs } from "../factory-tabs";
import { VideoButton } from "../video-button";
import { INSTALL } from "./install";

const EXAMPLE = "00-at-a-glance";

/** The promise, the way in, and the real files of a factory. */
export async function Hero() {
	const files = await exampleFactory(EXAMPLE);
	return (
		<section
			aria-labelledby="hero"
			className="mx-auto w-full max-w-7xl px-4 pt-14 pb-20 sm:px-6 sm:pt-20 sm:pb-28"
		>
			<h1
				id="hero"
				className="text-[2.9rem] leading-[0.98] font-semibold tracking-[-0.04em] text-balance sm:text-7xl xl:text-[5rem]"
			>
				Your software factory, as code.
			</h1>
			<p className="mt-5 max-w-[42rem] text-lg leading-relaxed text-pretty text-fd-muted-foreground sm:text-xl">
				Describe your AI agents, and what triggers them, in a folder of your
				repository.{" "}
				<span className="font-semibold text-fd-foreground">openfabriq</span>{" "}
				runs them on your machine or your team's server, with Claude Code on
				your subscription or an API key, and writes to GitHub only what you
				allowed.
			</p>
			{/* The way in: one action, its command beside it, the prompt as the alternative right under. */}
			<div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
				<Link
					href="/getting-started/quickstart/"
					className="group inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-fd-foreground px-5 text-[15px] font-medium whitespace-nowrap text-fd-background shadow-of-2 transition-[opacity,box-shadow] hover:opacity-90"
				>
					Get started
					<ArrowRight
						className="size-4 transition-transform duration-300 group-hover:translate-x-0.5"
						aria-hidden
					/>
				</Link>
				<CopyCommand command={INSTALL} className="sm:w-[24.5rem]" />
			</div>
			<CopyPrompt compact className="mt-4" />
			{/* What supports the decision, quieter: the film, then the fine print. */}
			<div className="mt-5 flex flex-col gap-x-8 gap-y-4 sm:flex-row sm:flex-wrap sm:items-center">
				<VideoButton />
				<p className="text-sm leading-relaxed text-fd-muted-foreground">
					Open source, Apache-2.0 · macOS and Linux · Also on npm:{" "}
					<code className="font-mono text-[0.92em] whitespace-nowrap text-fd-foreground">
						npm install -g openfabriq
					</code>
				</p>
			</div>
			<div className="mt-8">
				<FactoryTabs
					files={files}
					example={EXAMPLE}
					repository="acme/web-app"
				/>
			</div>
		</section>
	);
}
