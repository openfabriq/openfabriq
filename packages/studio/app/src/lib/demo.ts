/// <reference types="vite/client" />

// The demo build (`vite build --mode demo`), shown in an iframe on the docs' landing: the same
// app, with no server. Its reads come from answers recorded from a made-up factory
// (scripts/docs-demo.ts), its chat replays one recorded answer to any question, its other writes
// are refused, and its clock is the recording's.

export const DEMO = import.meta.env.MODE === "demo";

interface Recorded {
	/** When the answers were recorded: the demo's clock starts there. */
	recordedAt: number;
	/** Each read the app makes (`/api/runs?project=…`) → its file, next to index.json. */
	paths: Record<string, string>;
	/** The chat's answer, as the server streamed it, next to index.json. */
	chat: string;
}

const answer = (status: number, error: string) =>
	Response.json({ error }, { status });

/** The recorded answer streamed again, one event at a time, as the chat reads it. */
function replay(events: string, signal?: AbortSignal | null): Response {
	const chunks = events.split(/(?<=\n\n)/);
	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			for (const chunk of chunks) {
				await new Promise((ok) => setTimeout(ok, 40));
				if (signal?.aborted)
					return controller.error(new DOMException("Stopped", "AbortError"));
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		},
	});
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

/** Before the app starts: reads from the recording, and the clock set back to it. */
export async function startDemo(): Promise<void> {
	const recorded = (await (await fetch("api/index.json")).json()) as Recorded;
	const realFetch = window.fetch.bind(window);
	window.fetch = (input, init) => {
		const path = typeof input === "string" ? input : String(input);
		if (!path.startsWith("/api/")) return realFetch(input, init);
		if (path === "/api/chat" && init?.method === "POST")
			return realFetch(`api/${recorded.chat}`)
				.then((res) => res.text())
				.then((events) => replay(events, init.signal));
		if ((init?.method ?? "GET") !== "GET")
			return Promise.resolve(
				answer(403, "This is a demo: it only reads the example factory."),
			);
		const file = recorded.paths[path];
		return file
			? realFetch(`api/${file}`)
			: Promise.resolve(answer(404, "This demo does not have this page."));
	};

	// The runs say "2h ago" as they did when recorded, whenever the demo is opened.
	const shift = Date.now() - recorded.recordedAt;
	const RealDate = Date;
	class DemoDate extends RealDate {
		constructor(...args: unknown[]) {
			if (args.length) super(...(args as [number]));
			else super(RealDate.now() - shift);
		}
		static override now() {
			return RealDate.now() - shift;
		}
	}
	globalThis.Date = DemoDate as DateConstructor;
}

/** In the landing's iframe, whether the docs around it are dark; undefined opened on its own. */
export function parentDark(): boolean | undefined {
	try {
		if (window.parent === window) return undefined;
		return window.parent.document.documentElement.classList.contains("dark");
	} catch {
		return undefined;
	}
}

/** Calls `update` each time the docs around the demo change theme; returns how to stop. */
export function watchParentTheme(update: (dark: boolean) => void) {
	if (parentDark() === undefined) return () => {};
	const observer = new MutationObserver(() => update(parentDark() ?? false));
	observer.observe(window.parent.document.documentElement, {
		attributeFilter: ["class"],
	});
	return () => observer.disconnect();
}
