"use client";

import { buttonVariants } from "fumadocs-ui/components/ui/button";
import { LinkItem } from "fumadocs-ui/layouts/shared";
import {
	SearchTrigger,
	type SearchTriggerProps,
} from "fumadocs-ui/layouts/shared/slots/search-trigger";
import { ThemeSwitch } from "fumadocs-ui/layouts/shared/slots/theme-switch";
import { cn } from "@/lib/cn";
import { GITHUB_LINK } from "@/lib/layout.shared";

export function GitHubButton({ className }: { className?: string }) {
	return (
		<LinkItem
			item={GITHUB_LINK}
			aria-label={GITHUB_LINK.label}
			className={cn(
				buttonVariants({ variant: "ghost", size: "icon" }),
				className,
			)}
		>
			{GITHUB_LINK.icon}
		</LinkItem>
	);
}

/**
 * The home header's search button below `lg`, with the theme switch and GitHub before it on a
 * phone, so they sit in the bar rather than in the menu. Fumadocs has no slot for the bar's
 * mobile actions; this one is placed right before the menu button.
 */
export function MobileSearchTrigger(props: SearchTriggerProps) {
	return (
		<>
			<div className="flex items-center gap-1 sm:hidden">
				<ThemeSwitch />
				<GitHubButton />
			</div>
			<SearchTrigger {...props} />
		</>
	);
}
