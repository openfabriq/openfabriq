import {
	type BaseLayoutProps,
	type IconItemType,
	resolveLinkItems,
} from "fumadocs-ui/layouts/shared";
import { Logo } from "@/components/logo";

// Set by next.config.mjs from repository.mjs: the root package.json, or OPENFABRIQ_REPOSITORY.
export const GITHUB = process.env.OPENFABRIQ_GITHUB_URL ?? "";

/** The GitHub icon link Fumadocs adds for `githubUrl`. */
export const GITHUB_LINK = resolveLinkItems({
	githubUrl: GITHUB,
})[0] as IconItemType;

export function baseOptions(): BaseLayoutProps {
	return {
		nav: { title: <Logo /> },
		githubUrl: GITHUB,
		links: [
			{
				text: "Documentation",
				url: "/getting-started/what-is-openfabriq/",
				active: "none",
			},
			{ text: "Templates", url: "/templates/", active: "nested-url" },
		],
	};
}
