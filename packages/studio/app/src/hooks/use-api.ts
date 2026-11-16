import { useQuery } from "@tanstack/react-query";
import { OFFLINE } from "../lib/api.js";
import { DEMO } from "../lib/demo.js";

/** The server's answer: its data, or the error it gave. */
type Answer<T> = { data: T } | { error: string };

/** One read of `path`; throws only when the server does not answer. */
async function read<T>(path: string): Promise<Answer<T>> {
	const res = await fetch(path);
	const body = (await res.json()) as T & { error?: string };
	return res.ok
		? { data: body }
		: { error: body.error ?? `${res.status} ${res.statusText}` };
}

const dataOf = <T>(answer: Answer<T> | undefined): T | undefined =>
	answer && "data" in answer ? answer.data : undefined;

/**
 * Reads a JSON endpoint of the local server, again every `refreshMs` when given: a number, or
 * what the latest data asks for (a run that works is read more often). A refresh keeps the
 * data on screen, and so does a server that stops answering (with OFFLINE); only a new path
 * starts from nothing. Two components that read the same path share the reads. `refetch` reads
 * again at once, after a write; it resolves once that answer is on screen.
 */
export function useApi<T>(
	path: string | undefined,
	refreshMs?: number | ((data: T | undefined) => number | undefined),
): {
	data?: T;
	error?: string;
	loading: boolean;
	refetch: () => Promise<void>;
} {
	const query = useQuery({
		queryKey: [path],
		queryFn: () => read<T>(path ?? ""),
		enabled: path !== undefined,
		// The demo's answers are recorded files: reading them again changes nothing.
		refetchInterval: (q) =>
			(!DEMO &&
				(typeof refreshMs === "function"
					? refreshMs(dataOf(q.state.data))
					: refreshMs)) ||
			false,
	});
	const answer = query.data;
	const data = dataOf(answer);
	const error = query.isError
		? OFFLINE
		: answer && "error" in answer
			? answer.error
			: undefined;
	return {
		...(data !== undefined ? { data } : {}),
		...(error ? { error } : {}),
		loading: path !== undefined && query.isPending,
		refetch: async () => {
			await query.refetch();
		},
	};
}
