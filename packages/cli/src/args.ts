import { parseArgs } from "node:util";

/** The command, its folder and its flags, wherever the flags stand on the line. */
export function readCommandLine(args: string[]) {
	const { positionals, values } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			yes: { type: "boolean", default: false },
			example: { type: "string" },
			interval: { type: "string" },
			port: { type: "string" },
			issue: { type: "string" },
			pr: { type: "string" },
			project: { type: "string" },
			url: { type: "string" },
			remove: { type: "boolean", default: false },
			org: { type: "string" },
			agent: { type: "string" },
			area: { type: "string" },
			workflows: { type: "boolean", default: false },
			help: { type: "boolean", short: "h", default: false },
			version: { type: "boolean", short: "v", default: false },
		},
	});
	const [given, dir = "."] = positionals;
	// --help, -h and help print the usage, as no command does.
	const command = values.help || given === "help" ? undefined : given;
	return { command, dir, positionals, values };
}

export type CommandLine = ReturnType<typeof readCommandLine>;

/** Commands whose output says how they went: in a terminal, it is led by ✓ (or ✗ on failure). */
const REPORTS = [
	"init",
	"apply",
	"connect",
	"deploy",
	"secret",
	"skill",
	"update",
];

export const reportsHowItWent = (command: string | undefined) =>
	REPORTS.includes(command ?? "");
