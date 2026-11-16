import type { ReactNode } from "react";

// The parts of the format, one tab each, with the file each one shows first.
export const TABS: {
	id: string;
	label: string;
	file: string;
	title: string;
	text: ReactNode;
}[] = [
	{
		id: "factory.yaml",
		label: "Factory",
		file: "factory.yaml",
		title: "One file says where the factory works, and what it may spend.",
		text: "The repository, the people whose actions start it, the checks that prove a change, the services it listens to, and the spending limits.",
	},
	{
		id: "agents",
		label: "Agents",
		file: "agents/implementer/agent.md",
		title: "Agents are job descriptions.",
		text: "A role, an input, an output and a procedure, in Markdown. The header sets the tools the agent may use on the machine. Anyone on the team can read it, and change it in a pull request.",
	},
	{
		id: "automations",
		label: "Automations",
		file: "automations/implement-ready-issues/automation.md",
		title:
			"An automation says when work starts, who does it, and what may be written.",
		text: (
			<>
				Here, a label, a new production error and a failed deploy each start an
				agent, and <code className="of-inline-code">reviewed_by</code> has a
				reviewer read the change before the pull request opens. The engine
				writes only what <code className="of-inline-code">can</code> lists.
			</>
		),
	},
	{
		id: "skills",
		label: "Skills",
		file: "skills/writing-for-maintainers/SKILL.md",
		title: "Skills are know-how an agent loads when it needs it.",
		text: "How to write for your maintainers, how to test first. Shared by every agent in skills/, or private to one, in its folder. Conventions for all work stay in your CLAUDE.md.",
	},
];

// How long each tab stays before the tour moves on.
export const DURATION = 9000;

/** A skill belongs to the Skills tab wherever it is, shared or inside an agent's folder. */
export const tabOf = (path: string) =>
	path.split("/").includes("skills")
		? TABS.findIndex((t) => t.id === "skills")
		: Math.max(
				0,
				TABS.findIndex((t) => t.id === path.split("/")[0]),
			);
