import { useEffect, useState, useSyncExternalStore } from "react";
import { DEMO, parentDark, watchParentTheme } from "../lib/demo.js";

export type Theme = "system" | "light" | "dark";
/** The button's cycle, from the default: the studio is drawn light first. */
const THEMES: Theme[] = ["light", "dark", "system"];

/** The theme the person chose, kept on this machine, and the button's next choice. */
export function useTheme(): [Theme, () => void] {
	const [theme, setTheme] = useState<Theme>(() => {
		// In the docs' landing, the demo takes the docs' theme.
		const docs = DEMO ? parentDark() : undefined;
		if (docs !== undefined) return docs ? "dark" : "light";
		try {
			const saved = localStorage.getItem("openfabriq-theme");
			return saved === "dark" || saved === "system" ? saved : "light";
		} catch {
			return "light";
		}
	});
	useEffect(() => {
		const media = matchMedia("(prefers-color-scheme: dark)");
		const apply = () => {
			const dark = theme === "dark" || (theme === "system" && media.matches);
			document.documentElement.dataset.theme = dark ? "dark" : "light";
			// The browser's bar follows the theme picked here, not only the system's (--bg).
			for (const meta of document.querySelectorAll('meta[name="theme-color"]'))
				meta.setAttribute("content", dark ? "#0c0d0f" : "#f9fafb");
		};
		apply();
		try {
			// "system" is saved by name: no key means light, the default.
			localStorage.setItem("openfabriq-theme", theme);
		} catch {
			// private windows: the choice lasts until the tab closes
		}
		media.addEventListener("change", apply);
		return () => media.removeEventListener("change", apply);
	}, [theme]);
	useEffect(
		() =>
			DEMO
				? watchParentTheme((dark) => setTheme(dark ? "dark" : "light"))
				: undefined,
		[],
	);
	return [
		theme,
		() =>
			setTheme(
				(t) => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length] ?? "light",
			),
	];
}

const subscribeTheme = (update: () => void) => {
	const observer = new MutationObserver(update);
	observer.observe(document.documentElement, {
		attributeFilter: ["data-theme"],
	});
	return () => observer.disconnect();
};
const isDark = () => document.documentElement.dataset.theme === "dark";

/** Whether the page is drawn dark now, whatever chose it. */
export const useDark = () => useSyncExternalStore(subscribeTheme, isDark);
