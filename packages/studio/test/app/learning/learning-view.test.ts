import { expect, it } from "vitest";
import {
	agentLearningLine,
	candidateNote,
} from "../../../app/src/features/learning/learning-view.js";

it("says how far a candidate lesson is from its improvement", () => {
	expect(candidateNote(1, 1, 2)).toBe("1 failure, needs 2");
	expect(candidateNote(2, 1, 2)).toBe("2 failures in 1 run, needs 2 runs");
});

it("gives an agent's page one line, only when learning has something about it", () => {
	const byAgent = {
		coder: { failures: 3, toReview: 1 },
		writer: { failures: 1, toReview: 0 },
		quiet: { failures: 0, toReview: 0 },
	};
	expect(agentLearningLine(byAgent, "coder")).toBe(
		"3 failures, 1 improvement to review",
	);
	expect(agentLearningLine(byAgent, "writer")).toBe("1 failure");
	expect(agentLearningLine(byAgent, "quiet")).toBeUndefined();
	expect(agentLearningLine(byAgent, "other")).toBeUndefined();
	expect(agentLearningLine(undefined, "coder")).toBeUndefined();
});
