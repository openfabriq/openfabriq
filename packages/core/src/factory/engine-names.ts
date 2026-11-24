import type { Problem } from "./types.js";

/** The name of the wiki's agent and automation, reserved in every factory. */
export const WIKI = "wiki";
/** The name of learning's agent and automation, reserved in every factory. */
export const LEARNING = "learning";

/** Whether a name is one of the engine's agents and automations: the wiki's, learning's. */
export const isEngineName = (name: string) =>
	name === WIKI || name === LEARNING;

/** Whether this agent is the engine's own of that name, not one of the factory called like it. */
export const isEngineAgent = (
	agent: { name: string; builtIn?: boolean },
	name: typeof WIKI | typeof LEARNING,
) => agent.builtIn === true && agent.name === name;

/** Agents and automations called like one of the engine's (the wiki, learning): the name is reserved, even with it off. */
export function reservedNameClashes(
	layout: {
		agentFiles: Map<string, string>;
		automationFiles: Map<string, string>;
	},
	name: typeof WIKI | typeof LEARNING,
): Omit<Problem, "level">[] {
	return (
		[
			["an agent", layout.agentFiles],
			["an automation", layout.automationFiles],
		] as const
	).flatMap(([kind, names]) => {
		const file = names.get(name);
		return file === undefined
			? []
			: [
					{
						file,
						message: `${kind} cannot be called ${name}: the engine's ${name} uses that name. Rename it`,
					},
				];
	});
}
