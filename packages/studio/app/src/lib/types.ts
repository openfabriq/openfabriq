import type {
	CommandRun,
	Hunk,
	ReviewRound,
	RunRecord,
} from "@openfabriq/runner";
import type { Schedule } from "../../../src/agents/agents.js";
import type { SkillDoc } from "../../../src/agents/skills.js";
import type { Board, BoardCard, Stage } from "../../../src/board/board.js";
import type { Metrics, Period } from "../../../src/metrics/metrics.js";
import type { ShownFile, ShownFiles } from "../../../src/runs/run-files.js";
import type { RunStory } from "../../../src/runs/story.js";
import type { Transcript } from "../../../src/runs/transcript.js";
import type { FactorySettings } from "../../../src/settings/settings.js";

// What the local server answers, endpoint by endpoint.

export type {
	LearningAnswer,
	LessonAnswer,
	ProjectAgents,
	ProjectMetrics,
	RunDetail,
	WikiAnswer,
	Workflow,
} from "../../../src/responses.js";
export type {
	Board,
	BoardCard,
	CommandRun,
	FactorySettings,
	Hunk,
	Metrics,
	Period,
	ReviewRound,
	RunRecord,
	RunStory,
	Schedule,
	ShownFile,
	ShownFiles,
	SkillDoc,
	Stage,
	Transcript,
};
