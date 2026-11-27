import {
	BookOpen,
	Bot,
	Columns3,
	LayoutDashboard,
	ListChecks,
	MessageSquare,
	Settings2,
	Sprout,
	Workflow as WorkflowIcon,
} from "lucide-react";

/** The pages of the menu, in its order. */
export const PAGES = [
	{ id: "overview", label: "Overview", icon: LayoutDashboard },
	{ id: "board", label: "Board", icon: Columns3 },
	{ id: "runs", label: "Runs", icon: ListChecks },
	{ id: "agents", label: "Agents", icon: Bot },
	{ id: "workflow", label: "Workflow", icon: WorkflowIcon },
	{ id: "wiki", label: "Wiki", icon: BookOpen },
	{ id: "learning", label: "Learning", icon: Sprout },
	{ id: "settings", label: "Factory settings", icon: Settings2 },
	{ id: "chat", label: "Chat", icon: MessageSquare },
] as const;

/** A page's name in the menu, or its id when the menu has no such page. */
export const pageLabel = (id: string) =>
	PAGES.find((p) => p.id === id)?.label ?? id;
