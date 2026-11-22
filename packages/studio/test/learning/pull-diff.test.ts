import { expect, it } from "vitest";
import { diffFiles } from "../../src/learning/pull-diff.js";

it("cuts a pull request's diff into its files and their hunks", () => {
	const diff = [
		"diff --git a/openfabriq/agents/coder/agent.md b/openfabriq/agents/coder/agent.md",
		"index 1..2 100644",
		"--- a/openfabriq/agents/coder/agent.md",
		"+++ b/openfabriq/agents/coder/agent.md",
		"@@ -3,2 +3,3 @@",
		" Code.",
		"+Run the tests.",
		" ## Done",
		"diff --git a/openfabriq/skills/old/SKILL.md b/openfabriq/skills/old/SKILL.md",
		"deleted file mode 100644",
		"--- a/openfabriq/skills/old/SKILL.md",
		"+++ /dev/null",
		"@@ -1 +0,0 @@",
		"-# Old",
		"",
	].join("\n");
	const files = diffFiles(diff);
	expect(files.map((f) => [f.path, f.add, f.del, f.hunks?.length])).toEqual([
		["openfabriq/agents/coder/agent.md", 1, 0, 1],
		["openfabriq/skills/old/SKILL.md", 0, 1, 1],
	]);
	expect(files[0]?.hunks?.[0]?.lines.map((l) => l.type)).toEqual([
		" ",
		"+",
		" ",
	]);
	expect(diffFiles("")).toEqual([]);
});
