import "./global.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { HOME, SITE_NAME, SITE_URL } from "@/lib/site";

// Geist's files, through next/font: preloaded, with a fallback sized like them, so the text does not move when they arrive.
const sans = localFont({
	src: [
		{
			path: "../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
			style: "normal",
		},
		{
			path: "../node_modules/@fontsource-variable/geist/files/geist-latin-wght-italic.woff2",
			style: "italic",
		},
	],
	weight: "100 900",
	variable: "--font-geist",
});
const mono = localFont({
	src: "../node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2",
	weight: "100 900",
	variable: "--font-geist-mono",
	adjustFontFallback: false,
});

// The site's defaults; each page sets its own title, description, address and card (lib/site.ts).
export const metadata: Metadata = {
	metadataBase: new URL(SITE_URL),
	title: { template: `%s · ${SITE_NAME}`, default: HOME.title },
	description: HOME.description,
	applicationName: SITE_NAME,
	authors: [{ name: "Matthieu Guirlinger", url: "https://guirlinger.com/en/" }],
	twitter: { card: "summary_large_image" },
	alternates: {
		types: { "text/plain": [{ url: "/llms.txt", title: "llms.txt" }] },
	},
};

export const viewport: Viewport = {
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "#ffffff" },
		{ media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
	],
};

// Audience statistics with Plausible and Cloudflare Web Analytics, without cookies, only when the build that publishes the site sets them.
const PLAUSIBLE_SCRIPT = process.env.PLAUSIBLE_SCRIPT;
const CLOUDFLARE_ANALYTICS_TOKEN = process.env.CLOUDFLARE_ANALYTICS_TOKEN;

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html
			lang="en"
			className={`${sans.variable} ${mono.variable}`}
			suppressHydrationWarning
		>
			{(PLAUSIBLE_SCRIPT || CLOUDFLARE_ANALYTICS_TOKEN) && (
				<head>
					{PLAUSIBLE_SCRIPT && (
						<script
							defer
							data-domain={new URL(SITE_URL).host}
							src={PLAUSIBLE_SCRIPT}
						/>
					)}
					{CLOUDFLARE_ANALYTICS_TOKEN && (
						<script
							defer
							src="https://static.cloudflareinsights.com/beacon.min.js"
							data-cf-beacon={JSON.stringify({
								token: CLOUDFLARE_ANALYTICS_TOKEN,
							})}
						/>
					)}
				</head>
			)}
			<body className="flex min-h-screen flex-col">
				<RootProvider search={{ options: { type: "static" } }}>
					{children}
				</RootProvider>
			</body>
		</html>
	);
}
