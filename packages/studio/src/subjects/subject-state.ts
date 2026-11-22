/**
 * Whether a run's subject (a pull request, a GitHub issue, a Linear or Sentry issue) is done:
 * the board, the numbers and the run page read it. Undefined when nobody could tell.
 */
export interface SubjectState {
	merged: boolean;
	/** When a pull request was merged, as GitHub says. */
	mergedAt?: string;
	/** Still open: it may yet be merged or closed, so it is asked about again. */
	open: boolean;
	/** Still carries `needs-human`; undefined where the subject has no labels (Linear, Sentry). */
	needsHuman?: boolean;
}

/** The states of some subjects, by URL. */
export type SubjectStates = Record<string, SubjectState | undefined>;

/** Asks, read only, about one subject by its URL. */
export type AskSubject = (url: string) => Promise<SubjectState | undefined>;
