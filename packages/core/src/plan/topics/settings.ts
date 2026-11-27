import { learningText } from "../../factory/learning.js";
import type { Factory, Limits } from "../../factory/types.js";
import { wikiText } from "../../factory/wiki.js";
import type { PlanTopic } from "./topic.js";

// The factory's own settings: its name, repository and limits, the time zone, the signature, the wiki, learning.

/** The fields that changed, as `field a → b`. */
export function diffFields(pairs: [string, string, string][]): string[] {
	return pairs
		.filter(([, a, b]) => a !== b)
		.map(([field, a, b]) => `${field} ${a} → ${b}`);
}

/** The factory's name, description and default model. */
export function identity(
	before: Factory | undefined,
	after: Factory,
): PlanTopic {
	const settings = before
		? diffFields([
				["name", before.name, after.name],
				[
					"description",
					before.description ?? "none",
					after.description ?? "none",
				],
				["model", before.model, after.model],
			]).map((line) => `~ ${line.replace(" ", ": ")}`)
		: [];
	return { security: [], settings };
}

/** The repository the factory works on, and how much a run may spend. */
export function repositoryAndLimitChanges(
	before: Factory | undefined,
	after: Factory,
): PlanTopic {
	const security: string[] = [];
	const settings: string[] = [];
	if (before && before.repository !== after.repository)
		security.push(`~ repository: ${before.repository} → ${after.repository}`);
	for (const key of Object.keys(after.limits) as (keyof Limits)[]) {
		const a = before?.limits[key];
		const b = after.limits[key];
		if (a !== undefined && b > a)
			security.push(`~ limit ${key} raised: ${a} → ${b}`);
		if (a !== undefined && b < a)
			settings.push(`~ limit ${key} lowered: ${a} → ${b}`);
	}
	return { security, settings };
}

/** The time zone of the schedules: changing it moves every schedule. */
export function timezoneChange(
	before: Factory | undefined,
	after: Factory,
): PlanTopic {
	const settings: string[] = [];
	if (before?.timezone !== after.timezone) {
		if (!before?.timezone && after.timezone)
			settings.push(
				`+ timezone ${after.timezone}: schedules read in this time zone`,
			);
		else if (before?.timezone && !after.timezone)
			settings.push(
				`- timezone ${before.timezone}: schedules read in the machine's time zone`,
			);
		else settings.push(`~ timezone ${before?.timezone} → ${after.timezone}`);
	}
	return { security: [], settings };
}

/** The visible line under what the factory writes on GitHub. */
export function signatureChange(
	before: Factory | undefined,
	after: Factory,
): PlanTopic {
	const settings: string[] = [];
	if ((before?.signature ?? true) !== (after.signature ?? true))
		settings.push(
			after.signature === false
				? "- signature: what the factory writes on GitHub no longer says openfabriq wrote it"
				: "+ signature: what the factory writes on GitHub says openfabriq wrote it",
		);
	return { security: [], settings };
}

/** The wiki's agent is the engine's: plan says what it does in one line. */
export function wiki(before: Factory | undefined, after: Factory): PlanTopic {
	const wikiBefore = before?.wiki ? wikiText(before.wiki) : undefined;
	const wikiAfter = after.wiki ? wikiText(after.wiki) : undefined;
	if (wikiBefore === wikiAfter && before?.wiki?.pages === after.wiki?.pages)
		return { security: [], settings: [] };
	const line = !wikiAfter
		? "- wiki: off"
		: `${wikiBefore ? "~" : "+"} wiki: ${wikiAfter}${
				wikiBefore === wikiAfter ? " (its pages changed)" : ""
			}`;
	return { security: [], settings: [line] };
}

/** Learning's agent is the engine's: plan says what it does in one line. */
export function learning(
	before: Factory | undefined,
	after: Factory,
): PlanTopic {
	const was = before?.learning && learningText(before.learning);
	const is = after.learning && learningText(after.learning);
	if (was === is) return { security: [], settings: [] };
	return {
		security: [],
		settings: [is ? `${was ? "~" : "+"} learning: ${is}` : "- learning: off"],
	};
}
