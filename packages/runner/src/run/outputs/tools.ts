import {
	type Action,
	type Automation,
	misfit,
	type SubjectKind,
} from "@openfabriq/core";
import { z } from "zod";
import { type EngineTool, engineTool } from "../../agent/port.js";
import { CLOSE_REASONS, type CloseReason } from "../../github/github.js";

export type Proposal =
	| { action: "add_comment"; body: string }
	| { action: "add_labels"; labels: string[] }
	| { action: "remove_labels"; labels: string[] }
	| {
			action: "create_pull_request";
			title: string;
			body: string;
			/** From can.create_pull_request, never from the agent. */
			labels?: string[];
	  }
	| { action: "push_to_pull_request"; summary: string }
	| { action: "request_changes"; body: string }
	| {
			action: "create_issue";
			title: string;
			body: string;
			/** From can.create_issue, never from the agent. */
			labels?: string[];
	  }
	| {
			action: "close_issue";
			/** GitHub's reason; left out, GitHub says completed. */
			reason?: CloseReason;
	  }
	| { action: "close_pr" }
	| { action: "merge_pull_request" };

export interface Subject {
	number?: number | undefined;
	/** What the run is about; a Slack, Linear or Sentry run comments (and on Linear labels) there. */
	kind: SubjectKind;
}

const recorded = {
	text: "Recorded. The engine applies it after the run, if the factory allows it.",
};

/**
 * One tool per word of `can` that fits the subject. A tool adds a proposal to `proposals` and
 * writes nothing. `extra` are the engine's other tools for the run, served next to them.
 */
export function outputTools(
	automation: Automation,
	subject: Subject,
	extra: EngineTool[] = [],
) {
	const proposals: Proposal[] = [];
	const propose = (p: Proposal) => {
		proposals.push(p);
	};
	const allowed = (action: Action) =>
		automation.can.find((p) => p.action === action);
	const where =
		subject.kind === "slack"
			? "the Slack thread"
			: subject.kind === "linear"
				? "the Linear issue"
				: subject.kind === "sentry"
					? "the Sentry issue, as a note"
					: "the issue or pull request";
	const labelsNote = (action: Action) => {
		const labels = allowed(action)?.labels;
		return labels ? ` Allowed labels: ${labels.join(", ")}.` : "";
	};
	const all = [
		engineTool({
			name: "add_comment",
			description:
				subject.kind === "slack"
					? "Reply in the Slack thread."
					: `Post a comment on ${where}.`,
			schema: { body: z.string().min(1) },
			run: async ({ body }) => {
				propose({ action: "add_comment", body });
				return recorded;
			},
		}),
		engineTool({
			name: "add_labels",
			description: `Add labels to ${where}.${labelsNote("add_labels")}`,
			schema: { labels: z.array(z.string()).min(1) },
			run: async ({ labels }) => {
				propose({ action: "add_labels", labels });
				return recorded;
			},
		}),
		engineTool({
			name: "remove_labels",
			description: `Remove labels from ${where}.${labelsNote("remove_labels")}`,
			schema: { labels: z.array(z.string()).min(1) },
			run: async ({ labels }) => {
				propose({ action: "remove_labels", labels });
				return recorded;
			},
		}),
		engineTool({
			name: "create_pull_request",
			description:
				"Open a pull request with the commits you made in the working directory. Commit with git first; the engine pushes the branch.",
			schema: { title: z.string().min(1), body: z.string().min(1) },
			run: async ({ title, body }) => {
				propose({ action: "create_pull_request", title, body });
				return recorded;
			},
		}),
		engineTool({
			name: "push_to_pull_request",
			description:
				"Push the commits you made in the working directory to this pull request. Commit with git first.",
			schema: { summary: z.string().min(1) },
			run: async ({ summary }) => {
				propose({ action: "push_to_pull_request", summary });
				return recorded;
			},
		}),
		engineTool({
			name: "request_changes",
			description:
				"Publish a review that requests changes on this pull request.",
			schema: { body: z.string().min(1) },
			run: async ({ body }) => {
				propose({ action: "request_changes", body });
				return recorded;
			},
		}),
		engineTool({
			name: "create_issue",
			description: "Open a new issue in the repository.",
			schema: { title: z.string().min(1), body: z.string().min(1) },
			run: async ({ title, body }) => {
				propose({ action: "create_issue", title, body });
				return recorded;
			},
		}),
		// No number to give: closing reaches only the run's own subject.
		engineTool({
			name: "close_issue",
			description:
				"Close this issue. Explain why in a comment first. The reason: completed (done), not_planned (it will not be done), or duplicate (the work goes on in another issue).",
			schema: {
				reason: z.enum(CLOSE_REASONS).optional(),
			},
			run: async ({ reason }) => {
				propose({ action: "close_issue", ...(reason ? { reason } : {}) });
				return recorded;
			},
		}),
		engineTool({
			name: "close_pr",
			description:
				"Close this pull request without merging it. Explain why in a comment first.",
			schema: {},
			run: async () => {
				propose({ action: "close_pr" });
				return recorded;
			},
		}),
		// The engine merges only if the factory's conditions and its own locks hold.
		engineTool({
			name: "merge_pull_request",
			description:
				"Ask the engine to merge this pull request. It merges only if the factory's conditions and its own checks hold; otherwise a person merges. Add your labels and your review comment first.",
			schema: {},
			run: async () => {
				propose({ action: "merge_pull_request" });
				return recorded;
			},
		}),
	];
	const tools = all.filter((t) => {
		const action = t.name as Action;
		return (
			allowed(action) !== undefined &&
			misfit(action, subject.kind) === undefined
		);
	});
	return {
		/** The output tools that fit, then the engine's others for the run. */
		tools: [...tools, ...extra],
		actions: tools.map((t) => t.name as Action),
		propose,
		/** What the agent proposed, filled as it calls the tools. */
		proposals,
	};
}
