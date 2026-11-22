import { exec } from "@openfabriq/runner";
import { expect, it, vi } from "vitest";
import { githubSubjectState } from "../../src/subjects/github.js";

vi.mock("@openfabriq/runner", async (original) => ({
	...(await original<typeof import("@openfabriq/runner")>()),
	exec: vi.fn(),
}));

const PR = "https://github.com/acme/task-app/pull/7";

it("asks gh about an issue with gh issue, about a pull request with gh pr", async () => {
	const run = vi.mocked(exec);
	run.mockResolvedValueOnce('{"state":"CLOSED","labels":[]}');
	expect(
		await githubSubjectState("https://github.com/acme/app/issues/4"),
	).toEqual({ merged: false, open: false, needsHuman: false });
	run.mockResolvedValueOnce(
		'{"state":"MERGED","labels":[{"name":"Needs-Human"}],"mergedAt":"2026-10-09T10:00:00Z"}',
	);
	expect(await githubSubjectState(PR)).toEqual({
		merged: true,
		mergedAt: "2026-10-09T10:00:00Z",
		open: false,
		needsHuman: true,
	});
	// An issue has no merge date to ask for.
	expect(run.mock.calls.map((c) => [c[1]?.[0], c[1]?.at(-1)])).toEqual([
		["issue", "state,labels"],
		["pr", "state,labels,mergedAt"],
	]);
	run.mockRejectedValueOnce(new Error("gh: not found"));
	expect(await githubSubjectState(PR)).toBeUndefined();
});
