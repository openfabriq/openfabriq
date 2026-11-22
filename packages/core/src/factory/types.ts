import type {
	Action,
	Concurrency,
	EventName,
	From,
	Signature,
	Tool,
} from "../vocabulary.js";
import type { Network } from "./network.js";

/** The files of an `openfabriq/` folder: path relative to the folder, with `/` separators → content. */
export type FactoryFiles = Record<string, string>;

export interface Problem {
	level: "error" | "warning";
	file: string;
	message: string;
}

export interface Limits {
	usd_per_run: number;
	usd_per_day: number;
	minutes_per_run: number;
	review_rounds: number;
}

export interface Agent {
	name: string;
	/** The folder of openfabriq/ it is in, like qa; absent at the root. */
	area?: string;
	description: string;
	model?: string;
	tools: Tool[];
	instructions: string;
	skills: string[];
	/** The tools this agent may call, by server of the factory's mcp. */
	mcp?: Record<string, string[]>;
	/** What its shell, web tool, commands and checks reach; the factory's when absent. */
	network?: Network;
	/** Provided by the engine, not written in openfabriq/: the wiki's and learning's agents. */
	builtIn?: true;
}

/** The project's wiki, kept by the engine's own agent. */
export interface Wiki {
	/** The folder of its pages in the repository, without a trailing slash. */
	folder: string;
	refresh: "manual" | "after_merge";
	/** openfabriq/wiki.md: the pages the maintainers add to the default plan. */
	pages?: string;
}

/** Learning: the engine's own agent studies the work that failed, on a schedule. */
export interface Learning {
	/** A cron, in the factory's time zone. */
	schedule: string;
}

/** A server of the factory: remote, with a bearer secret, or run on this machine with its secrets. */
export type McpServer =
	| { url: string; secret?: string }
	| { command: string; secrets?: string[] };

export interface Trigger {
	event: EventName;
	/** On *.labeled, the label just added; on *.commented, a label the issue or pull request carries. */
	labels?: string[];
	cron?: string;
	/** pull_request.* only: skip the pull request when every changed file matches one. */
	ignore_paths?: string[];
	/** sentry.issue.created only: a Sentry search, passed as is to Sentry. */
	query?: string;
	/** webhook.received only: the name of a webhook of factory.yaml. */
	webhook?: string;
	/** issue.commented and pull_request.commented only: a word the comment must contain, such as @openfabriq. */
	mentions?: string;
	/** pull_request.* only (opened_by): the agent whose run opened the pull request. */
	openedBy?: string;
	/** The engine's answer to mentions only, never written: the agent that answers on this pull request or issue. */
	answeredBy?: string;
}

/** merge_pull_request only: what the engine checks before it merges, on top of its own locks. */
export interface MergeConditions {
	/** One of these labels, added by this run or by the maintainer whose label started it. */
	labels?: string[];
	/** Every changed file matches one. Written paths, its old name, in older factories. */
	only_paths?: string[];
	/** No changed file matches one, even when it matches only_paths. */
	except_paths?: string[];
}

export interface Permission {
	action: Action;
	labels?: string[];
	merge?: MergeConditions;
}

export interface Automation {
	name: string;
	/** The folder of openfabriq/ it is in, like qa; absent at the root. */
	area?: string;
	when: Trigger[];
	agent: string;
	/** reviewed_by: the agent that reviews the change before it leaves the machine. */
	reviewedBy?: string;
	can: Permission[];
	concurrency: Concurrency;
	from: From;
	instructions: string;
	/** Provided by the engine, not written in openfabriq/: the wiki's, and the answer to mentions. */
	builtIn?: true;
}

export interface Factory {
	name: string;
	description?: string;
	repository: string;
	maintainers: string[];
	model: string;
	limits: Limits;
	/** Commands run in the worktree before the agent. */
	setup?: string[];
	/** The project's commands, by name: for agents with `commands`, and for checks. */
	commands?: Record<string, string>;
	/** Names of commands the engine runs before applying code an agent changed. */
	checks?: string[];
	/** Values for setup, commands and agents, written in the factory. */
	env?: Record<string, string>;
	/** Names of secrets taken from the engine's environment, for setup and commands only. */
	secrets?: string[];
	/** What agents and commands reach, unless an agent says otherwise; the package registries when absent. */
	network?: Network;
	/** The time zone of the schedules; the machine's when absent. */
	timezone?: string;
	/** The Slack channel where people mention the factory, and where it answers. */
	slack?: { channel: string };
	/** The key of the Linear team whose issues the factory reads. */
	linear?: { team: string };
	/** The Sentry project whose new issues the factory reads. */
	sentry?: { organization: string; project: string; url?: string };
	/** Webhooks the relay receives for the factory, by name. */
	webhooks?: Record<string, { signature: Signature }>;
	/** MCP servers agents may use, by name. */
	mcp?: Record<string, McpServer>;
	/** Absent when factory.yaml says `wiki: false`. */
	wiki?: Wiki;
	/** Absent unless factory.yaml turns learning on. */
	learning?: Learning;
	/** `false`: what the factory writes on GitHub leaves out the line saying openfabriq wrote it. */
	signature?: false;
	/** `false`: the engine no longer answers mentions of @openfabriq on the pull requests its agents opened. */
	answerMentions?: false;
	skills: string[];
	/** Area → the skills of its skills/ folder, for its agents; absent when no area has any. */
	areaSkills?: Record<string, string[]>;
	agents: Record<string, Agent>;
	automations: Record<string, Automation>;
}
