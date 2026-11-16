import { HomeLayout } from "fumadocs-ui/layouts/home";
import { FullSearchTrigger } from "fumadocs-ui/layouts/shared/slots/search-trigger";
import type { ReactNode } from "react";
import { GitHubButton, MobileSearchTrigger } from "@/components/home-header";
import { SiteFooter } from "@/components/site-footer";
import { baseOptions, GITHUB_LINK } from "@/lib/layout.shared";

export default function Layout({ children }: { children: ReactNode }) {
	const options = baseOptions();
	return (
		<HomeLayout
			{...options}
			// On a phone, GitHub and the theme switch sit in the bar (MobileSearchTrigger), not in the menu.
			githubUrl={undefined}
			links={[
				...(options.links ?? []),
				{ ...GITHUB_LINK, on: "nav" },
				{
					type: "custom",
					on: "menu",
					secondary: true,
					children: <GitHubButton className="max-sm:hidden" />,
				},
			]}
			themeSwitch={{ className: "max-sm:hidden" }}
			slots={{
				searchTrigger: { sm: MobileSearchTrigger, full: FullSearchTrigger },
			}}
		>
			{children}
			<SiteFooter />
		</HomeLayout>
	);
}
