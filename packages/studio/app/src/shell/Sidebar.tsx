import { LogOut } from "lucide-react";
import { useApi } from "../hooks/use-api.js";
import { DEMO } from "../lib/demo.js";
import { pageHref } from "../lib/route.js";
import type { Board } from "../lib/types.js";
import type { Frame } from "./frame.js";
import { LiveBadge } from "./LiveBadge.js";
import { LogoMark } from "./LogoMark.js";
import { ProjectSelect } from "./ProjectSelect.js";
import { PAGES } from "./pages.js";
import { ThemeButton } from "./ThemeButton.js";

/** Who is signed in, when the studio has a sign-in (a password, or GitHub). */
interface Me {
	login?: string;
	signOut: boolean;
}

/** From tablets up: the pages down the left, with what each has going on, the theme and who is signed in. */
export function Sidebar({
	projects,
	project,
	page,
	menuPage,
	theme,
	nextTheme,
	board,
	chatBusy,
}: Frame & { board: Board | undefined; chatBusy: boolean }) {
	const me = useApi<Me>("/api/me").data;
	return (
		<aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-sunken md:flex">
			<a
				href={pageHref("overview", project)}
				className="flex h-14 items-center gap-2.5 px-5 text-fg no-underline"
			>
				<LogoMark />
				<span className="text-base font-semibold tracking-[-0.02em]">
					openfabriq
				</span>
			</a>
			<div className="px-3 pb-3">
				<ProjectSelect
					projects={projects}
					project={project}
					page={page}
					className="w-full"
				/>
			</div>
			<nav aria-label="Pages" className="flex flex-col gap-0.5 px-3">
				{PAGES.map(({ id, label, icon: Icon }) => (
					<a
						key={id}
						href={pageHref(id, project)}
						aria-current={menuPage === id ? "page" : undefined}
						className={`group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm ${id === "chat" ? "mt-3" : ""} text-fg-2 no-underline transition-colors duration-150 hover:bg-hover hover:text-fg aria-[current]:bg-panel aria-[current]:font-medium aria-[current]:text-fg aria-[current]:shadow-1`}
					>
						<Icon
							className="size-4 text-fg-3 group-hover:text-fg-2 group-aria-[current]:text-accent-text"
							aria-hidden
						/>
						{label}
						<LiveBadge
							page={id}
							project={project}
							board={board}
							chatBusy={chatBusy}
						/>
					</a>
				))}
			</nav>
			<div className="mt-auto flex items-center justify-between border-t border-line px-3 py-2">
				<span className="truncate pl-2 font-mono text-2xs text-fg-3">
					{/* The demo is served by the docs' site; the studio, on this machine. */}
					{me?.login ?? (DEMO ? "127.0.0.1:4310" : location.host)}
				</span>
				<div className="flex shrink-0 items-center">
					{me?.signOut && (
						<form method="post" action="/logout">
							<button
								type="submit"
								title="Sign out"
								aria-label="Sign out"
								className="inline-flex size-8 items-center justify-center rounded-lg text-fg-2 transition-colors hover:bg-hover hover:text-fg"
							>
								<LogOut className="size-4" aria-hidden />
							</button>
						</form>
					)}
					<ThemeButton theme={theme} next={nextTheme} />
				</div>
			</div>
		</aside>
	);
}
