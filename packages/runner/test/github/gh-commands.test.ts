import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pins the gh command each method of the adapter builds, and how it reads the answer.
interface Call {
	command: string;
	args: string[];
	input?: unknown;
}
const calls: Call[] = [];
// What gh prints, by call; `failures` makes the next calls fail with that stderr.
let answer: (args: string[]) => unknown = () => ({});
let failures: string[] = [];
vi.mock("../../src/exec.js", () => ({
	exec: async (
		command: string,
		args: string[],
		options: { input?: string } = {},
	) => {
		calls.push({
			command,
			args,
			...(options.input !== undefined
				? { input: JSON.parse(options.input) }
				: {}),
		});
		const failure = failures.shift();
		if (failure) throw new Error(`gh ${args.join(" ")}: ${failure}`);
		const out = answer(args);
		return typeof out === "string" ? out : JSON.stringify(out);
	},
}));
let gh: typeof import("../../src/github/gh.js").gh;

beforeEach(async () => {
	vi.useFakeTimers();
	// The write queue and the cached user live in the module: a fresh one per test.
	vi.resetModules();
	({ gh } = await import("../../src/github/gh.js"));
	calls.length = 0;
	answer = () => ({});
	failures = [];
});
afterEach(() => vi.useRealTimers());

/** Waits for a call, letting the write queue's gaps pass. */
async function settle<T>(promise: Promise<T>): Promise<T> {
	const done = promise.then(
		(value) => ({ value }),
		(error: unknown) => ({ error }),
	);
	await vi.advanceTimersByTimeAsync(10_000);
	const result = (await done) as { value?: T; error?: unknown };
	if ("error" in result) throw result.error;
	return result.value as T;
}

const api = (path: string, ...rest: string[]) => ["api", path, ...rest];
const pages = (path: string) => api(path, "--paginate", "--slurp");
const writing = (method: string, path: string) =>
	api(path, "-X", method, "--input", "-");

describe("reads", () => {
	it("currentUser asks once, and again after a failure", async () => {
		failures = ["boom"];
		answer = () => ({ login: "octocat" });
		await expect(settle(gh.currentUser())).rejects.toThrow(/boom/);
		expect(await settle(gh.currentUser())).toBe("octocat");
		expect(await settle(gh.currentUser())).toBe("octocat");
		expect(calls).toEqual([
			{ command: "gh", args: api("user") },
			{ command: "gh", args: api("user") },
		]);
	});

	it("defaultBranch", async () => {
		answer = () => ({ default_branch: "trunk" });
		expect(await settle(gh.defaultBranch("acme/app"))).toBe("trunk");
		expect(calls).toEqual([{ command: "gh", args: api("repos/acme/app") }]);
	});

	it("labels pages through every label", async () => {
		answer = () => [[{ name: "bug" }], [{ name: "docs" }]];
		expect(await settle(gh.labels("acme/app"))).toEqual(["bug", "docs"]);
		expect(calls).toEqual([
			{ command: "gh", args: pages("repos/acme/app/labels?per_page=100") },
		]);
	});

	it("clone", async () => {
		answer = () => "";
		await settle(gh.clone("acme/app", "/tmp/clone"));
		expect(calls).toEqual([
			{
				command: "gh",
				args: ["repo", "clone", "acme/app", "/tmp/clone", "--", "--quiet"],
			},
		]);
	});

	it("issuesUpdatedSince", async () => {
		answer = () => [[{ number: 1 }], [{ number: 2 }]];
		expect(
			await settle(gh.issuesUpdatedSince("acme/app", "2026-11-09T10:00:00Z")),
		).toEqual([{ number: 1 }, { number: 2 }]);
		expect(calls).toEqual([
			{
				command: "gh",
				args: pages(
					"repos/acme/app/issues?state=open&sort=updated&direction=asc&per_page=100&since=2026-11-09T10%3A00%3A00Z",
				),
			},
		]);
	});

	it("timeline", async () => {
		answer = () => [[{ event: "labeled" }]];
		expect(await settle(gh.timeline("acme/app", 7))).toEqual([
			{ event: "labeled" },
		]);
		expect(calls).toEqual([
			{
				command: "gh",
				args: pages("repos/acme/app/issues/7/timeline?per_page=100"),
			},
		]);
	});

	it("openPulls keeps what the engine reads", async () => {
		answer = () => [
			{
				number: 3,
				headRefOid: "abc",
				statusCheckRollup: [{ state: "SUCCESS" }],
				author: { login: "alice" },
				body: "plain",
				mergeable: "MERGEABLE",
				baseRefName: "main",
				autoMergeRequest: { enabledAt: "now" },
			},
			{ number: 4, headRefOid: "def", statusCheckRollup: null, author: null },
		];
		expect(await settle(gh.openPulls("acme/app"))).toEqual([
			{
				number: 3,
				sha: "abc",
				author: "alice",
				checks: [{ state: "SUCCESS" }],
				mergeable: "MERGEABLE",
				base: "main",
				autoMerge: true,
			},
			{ number: 4, sha: "def", author: "", checks: null },
		]);
		expect(calls).toEqual([
			{
				command: "gh",
				args: [
					"pr",
					"list",
					"-R",
					"acme/app",
					"--state",
					"open",
					"--limit",
					"500",
					"--json",
					"number,headRefOid,statusCheckRollup,author,body,mergeable,baseRefName,autoMergeRequest",
				],
			},
		]);
	});

	it("commitAuthor, empty when GitHub knows no user", async () => {
		answer = () => ({ author: { login: "bob" } });
		expect(await settle(gh.commitAuthor("acme/app", "abc"))).toBe("bob");
		answer = () => ({ author: null });
		expect(await settle(gh.commitAuthor("acme/app", "abc"))).toBe("");
		expect(calls.map((c) => c.args)).toEqual([
			api("repos/acme/app/commits/abc"),
			api("repos/acme/app/commits/abc"),
		]);
	});

	it("branchHead encodes the branch", async () => {
		answer = () => ({ sha: "f00" });
		expect(await settle(gh.branchHead("acme/app", "release/1"))).toBe("f00");
		expect(calls.map((c) => c.args)).toEqual([
			api("repos/acme/app/commits/release%2F1"),
		]);
	});

	it("changedFiles", async () => {
		answer = () => [[{ filename: "a.ts" }], [{ filename: "b.ts" }]];
		expect(await settle(gh.changedFiles("acme/app", 5))).toEqual([
			"a.ts",
			"b.ts",
		]);
		expect(calls.map((c) => c.args)).toEqual([
			pages("repos/acme/app/pulls/5/files?per_page=100"),
		]);
	});

	it("commitFiles lists renames twice, and nothing past 300 files", async () => {
		answer = () => ({
			files: [
				{ filename: "a.ts" },
				{ filename: "new.ts", previous_filename: "old.ts" },
			],
		});
		expect(await settle(gh.commitFiles("acme/app", "aaa..bbb"))).toEqual([
			"a.ts",
			"new.ts",
			"old.ts",
		]);
		answer = () => ({});
		expect(await settle(gh.commitFiles("acme/app", "aaa..bbb"))).toEqual([]);
		answer = () => ({
			files: Array.from({ length: 300 }, (_, i) => ({ filename: `${i}` })),
		});
		expect(await settle(gh.commitFiles("acme/app", "aaa..bbb"))).toBe(
			undefined,
		);
		expect(calls.map((c) => c.args)).toEqual(
			Array(3).fill(api("repos/acme/app/compare/aaa...bbb")),
		);
	});

	it("jobLog returns the text as is", async () => {
		answer = () => "line 1\nline 2\n";
		expect(await settle(gh.jobLog("acme/app", "99"))).toBe("line 1\nline 2\n");
		expect(calls.map((c) => c.args)).toEqual([
			api("repos/acme/app/actions/jobs/99/logs"),
		]);
	});

	it("subject reads an issue or a pull request with their fields", async () => {
		answer = () => ({ number: 8 });
		expect(await settle(gh.subject("acme/app", 8, false))).toEqual({
			number: 8,
		});
		await settle(gh.subject("acme/app", 9, true));
		expect(calls.map((c) => c.args)).toEqual([
			[
				"issue",
				"view",
				"8",
				"-R",
				"acme/app",
				"--json",
				"number,title,body,author,labels,comments,state,url",
			],
			[
				"pr",
				"view",
				"9",
				"-R",
				"acme/app",
				"--json",
				"number,title,body,author,labels,comments,state,url,reviews,headRefName,baseRefName,headRepositoryOwner,isCrossRepository,closingIssuesReferences,files,statusCheckRollup,headRefOid,changedFiles,mergeStateStatus,mergedAt",
			],
		]);
	});

	it("reviews", async () => {
		answer = () => [[{ state: "APPROVED", body: "", user: null }]];
		expect(await settle(gh.reviews("acme/app", 4))).toEqual([
			{ state: "APPROVED", body: "", user: null },
		]);
		expect(calls.map((c) => c.args)).toEqual([
			pages("repos/acme/app/pulls/4/reviews?per_page=100"),
		]);
	});

	it("mergeMethod takes squash, then merge, then rebase", async () => {
		const method = (repo: Record<string, boolean>) => {
			answer = () => repo;
			return settle(gh.mergeMethod("acme/app"));
		};
		expect(
			await method({
				allow_squash_merge: true,
				allow_merge_commit: true,
				allow_rebase_merge: true,
			}),
		).toBe("squash");
		expect(
			await method({ allow_merge_commit: true, allow_rebase_merge: true }),
		).toBe("merge");
		expect(await method({ allow_rebase_merge: true })).toBe("rebase");
		expect(await method({})).toBe(undefined);
		expect(calls.map((c) => c.args)).toEqual(
			Array(4).fill(api("repos/acme/app")),
		);
	});
});

describe("writes", () => {
	it("createLabel with its color", async () => {
		answer = () => "";
		await settle(gh.createLabel("acme/app", "risk:high"));
		await settle(gh.createLabel("acme/app", "custom"));
		await settle(gh.createLabel("acme/app", "openfabriq:working"));
		expect(calls.map((c) => c.args)).toEqual([
			[
				"label",
				"create",
				"risk:high",
				"-R",
				"acme/app",
				"--color",
				"b60205",
				"--description",
				"Used by openfabriq",
				"--force",
			],
			[
				"label",
				"create",
				"custom",
				"-R",
				"acme/app",
				"--color",
				"c5def5",
				"--description",
				"Used by openfabriq",
				"--force",
			],
			[
				"label",
				"create",
				"openfabriq:working",
				"-R",
				"acme/app",
				"--color",
				"1d76db",
				"--description",
				"openfabriq is working on this",
				"--force",
			],
		]);
	});

	it("comment", async () => {
		answer = () => ({ html_url: "https://github.com/c/1" });
		expect(await settle(gh.comment("acme/app", 2, "hello"))).toBe(
			"https://github.com/c/1",
		);
		expect(calls).toEqual([
			{
				command: "gh",
				args: writing("POST", "repos/acme/app/issues/2/comments"),
				input: { body: "hello" },
			},
		]);
	});

	it("addLabels", async () => {
		await settle(gh.addLabels("acme/app", 2, ["bug", "docs"]));
		expect(calls).toEqual([
			{
				command: "gh",
				args: writing("POST", "repos/acme/app/issues/2/labels"),
				input: { labels: ["bug", "docs"] },
			},
		]);
	});

	it("removeLabel encodes the label and ignores an absent one, saying it was not on it", async () => {
		failures = ["Label does not exist (HTTP 404)"];
		expect(await settle(gh.removeLabel("acme/app", 2, "risk:low"))).toBe(false);
		expect(calls).toEqual([
			{
				command: "gh",
				args: api("repos/acme/app/issues/2/labels/risk%3Alow", "-X", "DELETE"),
			},
		]);
	});

	it("removeLabel fails when GitHub fails: the label is still on", async () => {
		failures = ["Bad credentials (HTTP 401)"];
		await expect(
			settle(gh.removeLabel("acme/app", 2, "risk:high")),
		).rejects.toThrow("HTTP 401");
	});

	it("createPullRequest", async () => {
		answer = () => ({ html_url: "https://github.com/acme/app/pull/3" });
		const pull = {
			title: "t",
			body: "b",
			head: "openfabriq/1-r",
			base: "main",
		};
		expect(await settle(gh.createPullRequest("acme/app", pull))).toBe(
			"https://github.com/acme/app/pull/3",
		);
		expect(calls).toEqual([
			{
				command: "gh",
				args: writing("POST", "repos/acme/app/pulls"),
				input: pull,
			},
		]);
	});

	it("review comments, or requests changes", async () => {
		answer = () => ({ html_url: "https://github.com/r/1" });
		expect(await settle(gh.review("acme/app", 3, "fine", false))).toBe(
			"https://github.com/r/1",
		);
		expect(await settle(gh.review("acme/app", 3, "fix it", true))).toBe(
			"https://github.com/r/1",
		);
		const path = "repos/acme/app/pulls/3/reviews";
		expect(calls).toEqual([
			{
				command: "gh",
				args: writing("POST", path),
				input: { event: "COMMENT", body: "fine" },
			},
			{
				command: "gh",
				args: writing("POST", path),
				input: { event: "REQUEST_CHANGES", body: "fix it" },
			},
		]);
	});

	it("review falls back to a comment when GitHub refuses changes on one's own pull request", async () => {
		answer = () => ({ html_url: "https://github.com/r/2" });
		failures = [
			"Unprocessable Entity: Review Can not request changes on your own pull request (HTTP 422)",
		];
		expect(await settle(gh.review("acme/app", 3, "fix it", true))).toBe(
			"https://github.com/r/2",
		);
		expect(calls.map((c) => c.input)).toEqual([
			{ event: "REQUEST_CHANGES", body: "fix it" },
			{ event: "COMMENT", body: "fix it" },
		]);
	});

	it("review falls back on a 422 even when gh prints only its status", async () => {
		answer = () => ({ html_url: "https://github.com/r/3" });
		failures = ["gh: Unprocessable Entity (HTTP 422)"];
		expect(await settle(gh.review("acme/app", 3, "fix it", true))).toBe(
			"https://github.com/r/3",
		);
		expect(calls).toHaveLength(2);
	});

	it("review does not turn another refusal into a comment", async () => {
		failures = ["HTTP 502: Bad Gateway"];
		await expect(
			settle(gh.review("acme/app", 3, "fix it", true)),
		).rejects.toThrow(/HTTP 502/);
		expect(calls.map((c) => c.input)).toEqual([
			{ event: "REQUEST_CHANGES", body: "fix it" },
		]);
	});

	it("createIssue", async () => {
		answer = () => ({ html_url: "https://github.com/acme/app/issues/4" });
		const issue = { title: "t", body: "b", labels: ["bug"] };
		expect(await settle(gh.createIssue("acme/app", issue))).toBe(
			"https://github.com/acme/app/issues/4",
		);
		expect(calls).toEqual([
			{
				command: "gh",
				args: writing("POST", "repos/acme/app/issues"),
				input: issue,
			},
		]);
	});

	it("close: a reason for issues only", async () => {
		await settle(gh.close("acme/app", 4, false));
		await settle(gh.close("acme/app", 4, false, "not_planned"));
		await settle(gh.close("acme/app", 5, true, "duplicate"));
		expect(calls).toEqual([
			{
				command: "gh",
				args: writing("PATCH", "repos/acme/app/issues/4"),
				input: { state: "closed" },
			},
			{
				command: "gh",
				args: writing("PATCH", "repos/acme/app/issues/4"),
				input: { state: "closed", state_reason: "not_planned" },
			},
			{
				command: "gh",
				args: writing("PATCH", "repos/acme/app/pulls/5"),
				input: { state: "closed" },
			},
		]);
	});

	it("merge at the head commit, never with --admin", async () => {
		answer = () => "";
		await settle(
			gh.merge("acme/app", 6, { sha: "abc", method: "squash", auto: false }),
		);
		await settle(
			gh.merge("acme/app", 6, { sha: "def", method: "rebase", auto: true }),
		);
		expect(calls.map((c) => c.args)).toEqual([
			[
				"pr",
				"merge",
				"6",
				"-R",
				"acme/app",
				"--squash",
				"--match-head-commit",
				"abc",
			],
			[
				"pr",
				"merge",
				"6",
				"-R",
				"acme/app",
				"--rebase",
				"--match-head-commit",
				"def",
				"--auto",
			],
		]);
	});

	it("disableAutoMerge", async () => {
		answer = () => "";
		await settle(gh.disableAutoMerge("acme/app", 6));
		expect(calls.map((c) => c.args)).toEqual([
			["pr", "merge", "6", "-R", "acme/app", "--disable-auto"],
		]);
	});

	it("disableAutoMerge accepts a refusal when the auto-merge is already off, and only then", async () => {
		const disable = ["pr", "merge", "6", "-R", "acme/app", "--disable-auto"];
		const view = [
			"pr",
			"view",
			"6",
			"-R",
			"acme/app",
			"--json",
			"autoMergeRequest",
		];
		// Off already: the engine wanted it off, the push may go.
		failures = ["auto-merge is not enabled"];
		answer = () => ({ autoMergeRequest: null });
		await settle(gh.disableAutoMerge("acme/app", 6));
		expect(calls.map((c) => c.args)).toEqual([disable, view]);
		// Still on: the refusal stands.
		calls.length = 0;
		failures = ["HTTP 502"];
		answer = () => ({
			autoMergeRequest: { enabledAt: "2026-11-10T08:00:00Z" },
		});
		await expect(settle(gh.disableAutoMerge("acme/app", 6))).rejects.toThrow(
			/HTTP 502/,
		);
		expect(calls.map((c) => c.args)).toEqual([disable, view]);
		// Unknown, the state could not be read: the refusal stands too.
		calls.length = 0;
		failures = ["HTTP 502", "HTTP 502"];
		await expect(settle(gh.disableAutoMerge("acme/app", 6))).rejects.toThrow(
			/HTTP 502/,
		);
	});
});
