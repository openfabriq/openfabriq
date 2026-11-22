// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// The script of index.html that picks the theme before the first paint, run as the browser would.

const html = readFileSync(
	join(import.meta.dirname, "../../app/index.html"),
	"utf8",
);
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

/** Loads the page fresh on a system in dark or light mode; what it shows then. */
function paint(systemDark: boolean) {
	// The page as written, without running anything yet.
	document.documentElement.innerHTML = html.replace(/<!doctype html>/i, "");
	delete document.documentElement.dataset.theme;
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({ matches: systemDark })),
	);
	new Function(script)();
	return {
		theme: document.documentElement.dataset.theme,
		bar: Array.from(
			document.querySelectorAll('meta[name="theme-color"]'),
			(meta) => meta.getAttribute("content"),
		),
	};
}

it("paints light with nothing saved, even when the system is dark", () => {
	expect(script).not.toBe("");
	expect(paint(true)).toEqual({ theme: "light", bar: ["#f9fafb"] });
});

it("paints the choice saved, and the system's theme when that is the choice", () => {
	localStorage.setItem("openfabriq-theme", "dark");
	expect(paint(false)).toEqual({ theme: "dark", bar: ["#0c0d0f"] });
	localStorage.setItem("openfabriq-theme", "light");
	expect(paint(true)).toEqual({ theme: "light", bar: ["#f9fafb"] });
	localStorage.setItem("openfabriq-theme", "system");
	expect(paint(true)).toEqual({ theme: "dark", bar: ["#0c0d0f"] });
	expect(paint(false)).toEqual({ theme: "light", bar: ["#f9fafb"] });
});
