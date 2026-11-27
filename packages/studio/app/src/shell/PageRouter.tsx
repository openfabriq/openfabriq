import { lazy } from "react";
import { Agents } from "../features/agents/Agents.js";
import { Board } from "../features/board/Board.js";
import { Learning } from "../features/learning/Learning.js";
import { Overview } from "../features/overview/Overview.js";
import { Runs } from "../features/runs/Runs.js";
import { Settings } from "../features/settings/Settings.js";
import { Wiki } from "../features/wiki/Wiki.js";
import type { Board as BoardData } from "../lib/types.js";

// The conversation and graph pages carry assistant-ui and React Flow: loaded when opened.
const RunPage = lazy(() =>
	import("../features/run-detail/RunPage.js").then((m) => ({
		default: m.RunPage,
	})),
);
const Chat = lazy(() =>
	import("../features/chat/Chat.js").then((m) => ({ default: m.Chat })),
);
const Workflow = lazy(() =>
	import("../features/workflow/Workflow.js").then((m) => ({
		default: m.Workflow,
	})),
);

/** The page the address asks for, with its parameters. */
export function PageRouter({
	path,
	params,
	project,
	projects,
	board,
}: {
	path: string[];
	params: URLSearchParams;
	project: string | undefined;
	/** The projects, which the chat lists. */
	projects: string[];
	/** The project's board, which the frame reads already: the overview shows it too. */
	board: BoardData | undefined;
}) {
	const param = (name: string) => params.get(name) ?? undefined;
	switch (path[0] ?? "overview") {
		case "runs":
			return (
				<Runs
					project={project}
					agent={param("agent")}
					status={param("status")}
				/>
			);
		case "run":
			return path[1] ? (
				<RunPage id={path[1]} project={project} tab={param("tab")} />
			) : null;
		case "agents":
			return <Agents project={project} name={path[1]} tab={param("tab")} />;
		case "chat":
			return <Chat project={project} projects={projects} />;
		case "board":
			return <Board project={project} agent={param("agent")} />;
		case "workflow":
			return <Workflow project={project} area={param("area")} />;
		case "settings":
			return <Settings project={project} tab={param("tab")} />;
		case "learning":
			return <Learning project={project} lesson={path[1]} tab={param("tab")} />;
		case "wiki":
			return (
				<Wiki project={project} page={param("page")} find={param("find")} />
			);
		default:
			return (
				<Overview
					project={project}
					period={param("period")}
					view={param("view")}
					board={board}
				/>
			);
	}
}
