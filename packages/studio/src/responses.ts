import type { agentsView } from "./agents/agents.js";
import type { learningOf, lessonOf } from "./learning/learning.js";
import type { projectsMetrics } from "./metrics/projects.js";
import type { runWithSubjectState } from "./runs/run-detail.js";
import type { wikiOf } from "./wiki/wiki.js";
import type { workflowOf } from "./workflow/workflow.js";

// What the GET routes of the API answer, typed from the functions that build the answers: the
// app reads these types, so a change here that the app does not follow breaks its typecheck.

/** GET /api/run */
export type RunDetail = Awaited<ReturnType<typeof runWithSubjectState>>;
/** GET /api/agents */
export type ProjectAgents = ReturnType<typeof agentsView>;
/** GET /api/metrics: one entry per project. */
export type ProjectMetrics = ReturnType<typeof projectsMetrics>[number];
/** GET /api/workflow */
export type Workflow = ReturnType<typeof workflowOf>;
/** GET /api/wiki */
export type WikiAnswer = Awaited<ReturnType<typeof wikiOf>>;
/** GET /api/learning */
export type LearningAnswer = ReturnType<typeof learningOf>;
/** GET /api/learning/:id */
export type LessonAnswer = NonNullable<Awaited<ReturnType<typeof lessonOf>>>;
