import { resourceFolder } from "@openfabriq/core";
import { ChevronRight, FileText } from "lucide-react";
import { useState } from "react";
import { FileDialog } from "../../components/file-dialog.js";
import { MarkdownDoc } from "../../components/markdown.js";
import { Tabs } from "../../components/tabs.js";
import { useAgentHue } from "../../hooks/use-agent-hue.js";
import { useApi } from "../../hooks/use-api.js";
import { query } from "../../lib/api.js";
import { agentHref, learningHref, pageHref } from "../../lib/route.js";
import type {
	LearningAnswer,
	ProjectAgents,
	RunRecord,
} from "../../lib/types.js";
import { agentLearningLine } from "../learning/learning-view.js";
import { Automations, Figures, RecentRuns } from "./AgentActivity.js";
import { Harness, McpServers, Skills, Tools } from "./AgentResources.js";
import { agentTab, agentTabs } from "./agent-facts.js";

export type AgentInfo = ProjectAgents["agents"][number];

/** One agent, in tabs: what starts it, what it may use, its brief and its runs. */
export function AgentDetail({
	data,
	agent,
	runs,
	project,
	tab,
}: {
	data: ProjectAgents;
	agent: AgentInfo;
	runs: RunRecord[];
	project: string;
	tab: string | undefined;
}) {
	const tabs = agentTabs(agent, runs.length);
	const current = agentTab(tab, tabs);
	return (
		<>
			<AgentHeader
				agent={agent}
				project={project}
				repository={data.repository}
			/>
			<Figures data={data} agent={agent} runs={runs} />
			<LearningLine agent={agent.name} project={project} />

			<Tabs
				label="Agent"
				tabs={tabs}
				current={current}
				href={(t) => agentHref(agent.name, project, t)}
			/>

			{current === "automations" && (
				<Automations data={data} agent={agent} runs={runs} project={project} />
			)}
			{current === "resources" && (
				<div className="space-y-4">
					<div className="grid gap-4 lg:grid-cols-2">
						<Tools agent={agent} />
						<McpServers data={data} agent={agent} />
					</div>
					<Harness data={data} agent={agent} />
				</div>
			)}
			{current === "skills" && <Skills agent={agent} />}
			{current === "brief" && (
				<MarkdownDoc
					title="Brief"
					path={`openfabriq/${resourceFolder("agents", agent.name, agent.area)}/agent.md`}
					text={agent.instructions}
					defaultOpen
				/>
			)}
			{current === "runs" && (
				<RecentRuns agent={agent} runs={runs} project={project} />
			)}
		</>
	);
}

/** Learning's word on this agent, like "3 failures, 1 improvement to review", leading to the Learning page. */
function LearningLine({ agent, project }: { agent: string; project: string }) {
	const line = agentLearningLine(
		useApi<LearningAnswer>(`/api/learning${query({ project })}`, 60_000).data
			?.byAgent,
		agent,
	);
	return line ? (
		<p className="-mt-4 mb-8 text-sm text-fg-2">
			Learning:{" "}
			<a href={learningHref({ project })} className="text-fg">
				{line}
			</a>
		</p>
	) : null;
}

/** Its name, its color and what it is for, under a breadcrumb on a phone; its agent.md in a modal. */
function AgentHeader({
	agent,
	project,
	repository,
}: {
	agent: AgentInfo;
	project: string;
	repository: string;
}) {
	const agentHue = useAgentHue();
	const [reading, setReading] = useState(false);
	const path = `openfabriq/${resourceFolder("agents", agent.name, agent.area)}/agent.md`;
	return (
		<>
			<nav
				aria-label="Breadcrumb"
				// The app's header carries it from tablets up.
				className="mb-6 flex items-center gap-1.5 text-sm text-fg-2 md:hidden"
			>
				<a
					href={pageHref("agents", project)}
					className="no-underline hover:text-fg"
				>
					Agents
				</a>
				<ChevronRight className="size-3.5 text-fg-3" aria-hidden />
				<span className="text-fg">{agent.name}</span>
			</nav>

			<header className="mb-6 flex items-start gap-4">
				<span
					aria-hidden
					className="mt-0.5 flex size-12 shrink-0 items-center justify-center rounded-2xl"
					style={{
						background: `color-mix(in oklch, ${agentHue(agent.name)} 16%, transparent)`,
					}}
				>
					<span
						className="size-4 rounded-[5px]"
						style={{ background: agentHue(agent.name) }}
					/>
				</span>
				<div className="min-w-0">
					<h1 className="text-2xl font-semibold tracking-[-0.02em]">
						{agent.name}
					</h1>
					<p className="mt-1 max-w-[70ch] text-fg-2">{agent.description}</p>
				</div>
				{/* The engine's own agents have no file to show. */}
				{agent.source && (
					<button
						type="button"
						className="btn ml-auto shrink-0"
						aria-haspopup="dialog"
						onClick={() => setReading(true)}
					>
						<FileText className="size-3.5 text-fg-2" aria-hidden />
						agent.md
					</button>
				)}
			</header>
			{agent.source && (
				<FileDialog
					open={reading}
					path={path}
					note="as last applied"
					text={agent.source}
					repository={repository}
					onClose={() => setReading(false)}
				/>
			)}
		</>
	);
}
