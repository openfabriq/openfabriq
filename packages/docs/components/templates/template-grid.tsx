"use client";

import { Search, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { TemplateCard, type TemplateSummary } from "./template-card";

/** A template as the bank lists it: its card, and what the search and the filter read. */
export interface TemplateListing extends TemplateSummary {
	category: string;
	writes: string;
}

interface Category {
	id: string;
	title: string;
	text: string;
}

const normalize = (s: string) =>
	s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Every word of the query appears somewhere in what the card says. */
function matchesQuery(t: TemplateListing, query: string) {
	const haystack = normalize(
		[t.name, t.title, t.does, t.writes, ...t.startsOn].join(" "),
	);
	return normalize(query)
		.split(/\s+/)
		.filter(Boolean)
		.every((word) => haystack.includes(word));
}

/** The template bank: search, a category filter, and the cards grouped by category. */
export function TemplateGrid({
	templates,
	categories,
}: {
	templates: TemplateListing[];
	categories: readonly Category[];
}) {
	const [query, setQuery] = useState("");
	const [category, setCategory] = useState<string>("all");
	const deferred = useDeferredValue(query);
	const input = useRef<HTMLInputElement>(null);

	// "/" jumps to the search, as on GitHub.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			if (e.key !== "/" || target.closest("input, textarea, [contenteditable]"))
				return;
			e.preventDefault();
			input.current?.focus();
		};
		addEventListener("keydown", onKey);
		return () => removeEventListener("keydown", onKey);
	}, []);

	const found = useMemo(
		() =>
			templates.filter(
				(t) =>
					(category === "all" || t.category === category) &&
					matchesQuery(t, deferred),
			),
		[templates, category, deferred],
	);
	const groups = categories
		.map((c) => ({ ...c, items: found.filter((t) => t.category === c.id) }))
		.filter((g) => g.items.length > 0);

	return (
		<div>
			<div className="sticky top-[var(--fd-nav-height,3.5rem)] z-20 -mx-4 border-b border-of-line bg-of-ground/85 px-4 py-4 backdrop-blur-md sm:-mx-6 sm:px-6">
				<div className="flex flex-col gap-3 md:flex-row md:items-center">
					<label className="relative flex h-11 flex-1 items-center md:max-w-sm">
						<span className="sr-only">Search the templates</span>
						<Search
							className="pointer-events-none absolute left-3.5 size-4 text-fd-muted-foreground"
							aria-hidden
						/>
						<input
							ref={input}
							type="search"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Search: review, Sentry, schedule…"
							className="h-full w-full rounded-xl border border-of-line bg-of-panel pr-10 pl-10 text-sm shadow-of-1 transition-[border-color,box-shadow] outline-none placeholder:text-fd-muted-foreground focus:border-fd-primary/50 focus:ring-4 focus:ring-fd-primary/10 [&::-webkit-search-cancel-button]:hidden"
						/>
						{query ? (
							<button
								type="button"
								onClick={() => {
									setQuery("");
									input.current?.focus();
								}}
								className="absolute right-2 flex size-7 items-center justify-center rounded-md text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground"
								aria-label="Clear the search"
							>
								<X className="size-4" aria-hidden />
							</button>
						) : (
							<kbd className="pointer-events-none absolute right-3 rounded border border-of-line px-1.5 font-mono text-[11px] text-fd-muted-foreground">
								/
							</kbd>
						)}
					</label>
					<fieldset className="-mx-4 flex min-w-0 gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0">
						<legend className="sr-only">Category</legend>
						{[{ id: "all", title: "All" }, ...categories].map((c) => {
							const on = c.id === category;
							const n =
								c.id === "all"
									? templates.length
									: templates.filter((t) => t.category === c.id).length;
							return (
								<button
									key={c.id}
									type="button"
									aria-pressed={on}
									onClick={() => setCategory(c.id)}
									className={`flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors duration-200 ${on ? "border-fd-foreground bg-fd-foreground text-fd-background" : "border-of-line bg-of-panel text-fd-muted-foreground hover:border-fd-foreground/30 hover:text-fd-foreground"}`}
								>
									{c.title}
									<span
										className={`tnum text-xs ${on ? "opacity-70" : "opacity-60"}`}
									>
										{n}
									</span>
								</button>
							);
						})}
					</fieldset>
				</div>
			</div>

			<p className="sr-only" aria-live="polite">
				{found.length} template{found.length === 1 ? "" : "s"} found
			</p>

			{groups.length === 0 ? (
				<div className="flex flex-col items-center py-24 text-center">
					<p className="text-lg font-medium">No template matches “{query}”.</p>
					<p className="mt-2 max-w-md text-fd-muted-foreground">
						Try a trigger such as{" "}
						<code className="of-inline-code">schedule</code> or a service such
						as Slack, or describe your own factory to{" "}
						<code className="of-inline-code">openfabriq init</code>
					</p>
					<button
						type="button"
						onClick={() => {
							setQuery("");
							setCategory("all");
						}}
						className="mt-6 rounded-lg border border-of-line px-4 py-2 text-sm font-medium hover:bg-fd-accent"
					>
						Show every template
					</button>
				</div>
			) : (
				groups.map((g) => (
					<section key={g.id} aria-labelledby={`cat-${g.id}`} className="pt-14">
						<div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
							<h2
								id={`cat-${g.id}`}
								className="text-2xl font-semibold tracking-tight"
							>
								{g.title}
							</h2>
							<p className="text-fd-muted-foreground">{g.text}</p>
						</div>
						<div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
							{g.items.map((t) => (
								<TemplateCard key={t.name} t={t} />
							))}
						</div>
					</section>
				))
			)}
		</div>
	);
}
