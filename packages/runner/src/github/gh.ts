import { HANDOFF_LABEL, sameName, WORKING_LABEL } from "@openfabriq/core";
import { type ExecOptions, exec } from "../exec.js";
import { errorText } from "../files.js";
import { githubApp, githubEnv } from "./app.js";
import type { GitHub, Review } from "./github.js";
import { type IssueItem, type TimelineItem, untrusted } from "./timeline.js";
import { write } from "./write-queue.js";

/** gh for this repository: in app mode, with the repository's installation token. */
async function run(
	repository: string,
	args: string[],
	options: ExecOptions = {},
): Promise<string> {
	const call = async () => {
		const env = await githubEnv(repository);
		return exec("gh", args, env ? { ...options, env } : options);
	};
	const app = githubApp();
	try {
		return await call();
	} catch (error) {
		// A token GitHub revoked (the app installed again): a new one, once. A refused call wrote nothing.
		if (!app || !/Bad credentials|HTTP 401/.test(errorText(error))) throw error;
		app.forget(repository);
		return call();
	}
}

/** A login as REST gives it: gh's GraphQL names an app's bot app/<slug>, REST <slug>[bot]. */
export const restLogin = (login: string) =>
	login.startsWith("app/") ? `${login.slice(4)}[bot]` : login;

/** The gh CLI's answer, as JSON; a write waits its turn in the write queue. */
async function api<T>(
	path: string,
	options: { method?: string; input?: unknown; paginate?: boolean } = {},
): Promise<T> {
	const args = ["api", path];
	if (options.method) args.push("-X", options.method);
	if (options.paginate) args.push("--paginate", "--slurp");
	if (options.input !== undefined) args.push("--input", "-");
	// Every path but the user's is under repos/<owner>/<name>.
	const repository = /^repos\/([^/]+\/[^/?]+)/.exec(path)?.[1] ?? "";
	const call = () =>
		run(
			repository,
			args,
			options.input !== undefined
				? { input: JSON.stringify(options.input) }
				: {},
		);
	const out = await (options.method ? write(call) : call());
	const data = out.trim() ? (JSON.parse(out) as unknown) : undefined;
	return (options.paginate ? (data as unknown[][]).flat() : data) as T;
}

const SUBJECT_FIELDS = "number,title,body,author,labels,comments,state,url";

// The gh user does not change while the engine runs: asked once (a failure is asked again).
let me: Promise<string> | undefined;

/** A label's color on GitHub: the kinds of work and the steps a person acts on stand out, the rest stays quiet. */
const LABEL_COLORS: Record<string, string> = {
	[HANDOFF_LABEL]: "d93f0b",
	[WORKING_LABEL]: "1d76db",
	"ready-to-merge": "0e8a16",
	"risk:low": "c2e0c6",
	"risk:medium": "fbca04",
	"risk:high": "b60205",
	"needs-info": "d876e3",
	bug: "d73a4a",
	feature: "0e8a16",
	docs: "0075ca",
	chore: "cfd3d7",
};
export const labelColor = (name: string) =>
	LABEL_COLORS[name.toLowerCase()] ?? "c5def5";

/** Whether a commit is red: its combined status, or one of its check runs, failed. */
export const isRed = (
	status: { state: string },
	checkRuns: { conclusion: string | null }[],
) =>
	// With no status at all, GitHub says "pending", never "failure".
	["failure", "error"].includes(status.state) ||
	checkRuns.some((r) =>
		["failure", "timed_out", "startup_failure"].includes(r.conclusion ?? ""),
	);

export const gh: GitHub = {
	currentUser() {
		// An installation token has no user: the app's bot is the engine's account.
		const app = githubApp();
		me ??= (
			app
				? app.login()
				: api<{ login: string }>("user").then((user) => user.login)
		).catch((error: unknown) => {
			me = undefined;
			throw error;
		});
		return me;
	},
	async defaultBranch(repository) {
		return (await api<{ default_branch: string }>(`repos/${repository}`))
			.default_branch;
	},
	async labels(repository) {
		const labels = await api<{ name: string }[]>(
			`repos/${repository}/labels?per_page=100`,
			{ paginate: true },
		);
		return labels.map((l) => l.name);
	},
	async createLabel(repository, name) {
		const color = labelColor(name);
		await write(() =>
			run(repository, [
				"label",
				"create",
				name,
				"-R",
				repository,
				"--color",
				color,
				"--description",
				sameName(name, WORKING_LABEL)
					? "openfabriq is working on this"
					: "Used by openfabriq",
				"--force",
			]),
		);
	},
	async clone(repository, dir) {
		await run(repository, ["repo", "clone", repository, dir, "--", "--quiet"]);
	},

	async issuesUpdatedSince(repository, since) {
		return api<IssueItem[]>(
			`repos/${repository}/issues?state=open&sort=updated&direction=asc&per_page=100&since=${encodeURIComponent(since)}`,
			{ paginate: true },
		);
	},
	async timeline(repository, number) {
		return api<TimelineItem[]>(
			`repos/${repository}/issues/${number}/timeline?per_page=100`,
			{ paginate: true },
		);
	},
	async openPulls(repository) {
		const out = await run(repository, [
			"pr",
			"list",
			"-R",
			repository,
			"--state",
			"open",
			"--limit",
			"500",
			"--json",
			"number,headRefOid,statusCheckRollup,author,body,mergeable,baseRefName,autoMergeRequest",
		]);
		const pulls = JSON.parse(out) as {
			number: number;
			headRefOid: string;
			statusCheckRollup: unknown;
			author: { login: string } | null;
			body?: string;
			mergeable?: string;
			baseRefName?: string;
			autoMergeRequest?: unknown;
		}[];
		return pulls.map((p) => ({
			number: p.number,
			sha: p.headRefOid,
			author: restLogin(p.author?.login ?? ""),
			checks: p.statusCheckRollup,
			...untrusted(p.body),
			...(p.mergeable ? { mergeable: p.mergeable } : {}),
			...(p.baseRefName ? { base: p.baseRefName } : {}),
			...(p.autoMergeRequest ? { autoMerge: true } : {}),
		}));
	},
	async commitAuthor(repository, sha) {
		const commit = await api<{ author: { login: string } | null }>(
			`repos/${repository}/commits/${sha}`,
		);
		return commit.author?.login ?? "";
	},
	async branchHead(repository, branch) {
		return (
			await api<{ sha: string }>(
				`repos/${repository}/commits/${encodeURIComponent(branch)}`,
			)
		).sha;
	},
	async changedFiles(repository, number) {
		// REST lists up to 3000 files, where gh pr view --json files stops at 100.
		const files = await api<{ filename: string }[]>(
			`repos/${repository}/pulls/${number}/files?per_page=100`,
			{ paginate: true },
		);
		return files.map((f) => f.filename);
	},
	async commitFiles(repository, commits) {
		const [before, after] = commits.split("..");
		const { files = [] } = await api<{
			files?: { filename: string; previous_filename?: string }[];
		}>(`repos/${repository}/compare/${before}...${after}`);
		// GitHub's compare lists 300 files at most: past that, nobody can tell, so the caller runs.
		if (files.length >= 300) return undefined;
		return files.flatMap((f) =>
			f.previous_filename ? [f.filename, f.previous_filename] : [f.filename],
		);
	},
	async jobLog(repository, jobId) {
		// Plain text, not JSON: GitHub redirects to the log file.
		return run(repository, [
			"api",
			`repos/${repository}/actions/jobs/${jobId}/logs`,
		]);
	},

	async subject(repository, number, isPullRequest) {
		const fields = isPullRequest
			? `${SUBJECT_FIELDS},reviews,headRefName,baseRefName,headRepositoryOwner,isCrossRepository,closingIssuesReferences,files,statusCheckRollup,headRefOid,changedFiles,mergeStateStatus,mergedAt`
			: SUBJECT_FIELDS;
		const out = await run(repository, [
			isPullRequest ? "pr" : "issue",
			"view",
			String(number),
			"-R",
			repository,
			"--json",
			fields,
		]);
		const subject = JSON.parse(out) as Record<string, unknown> & {
			author?: { login?: string };
		};
		if (subject.author?.login)
			subject.author = {
				...subject.author,
				login: restLogin(subject.author.login),
			};
		return subject;
	},
	async reviews(repository, number) {
		return api<Review[]>(
			`repos/${repository}/pulls/${number}/reviews?per_page=100`,
			{ paginate: true },
		);
	},

	async comment(repository, number, body) {
		const comment = await api<{ html_url: string }>(
			`repos/${repository}/issues/${number}/comments`,
			{
				method: "POST",
				input: { body },
			},
		);
		return comment.html_url;
	},
	async addLabels(repository, number, labels) {
		await api(`repos/${repository}/issues/${number}/labels`, {
			method: "POST",
			input: { labels },
		});
	},
	async removeLabel(repository, number, label) {
		return api(
			`repos/${repository}/issues/${number}/labels/${encodeURIComponent(label)}`,
			{ method: "DELETE" },
		).then(
			() => true,
			(error: unknown) => {
				// Already absent is no failure; GitHub down or refusing is: the label stays on.
				if (/HTTP 404/.test(String(error))) return false;
				throw error;
			},
		);
	},
	async createPullRequest(repository, pull) {
		return (
			await api<{ html_url: string }>(`repos/${repository}/pulls`, {
				method: "POST",
				input: pull,
			})
		).html_url;
	},
	async review(repository, number, body, changesRequested) {
		const post = (event: string) =>
			api<{ html_url: string }>(`repos/${repository}/pulls/${number}/reviews`, {
				method: "POST",
				input: { event, body },
			});
		if (!changesRequested) return (await post("COMMENT")).html_url;
		// GitHub refuses REQUEST_CHANGES on your own pull request: fall back to a comment review (see markers.ts).
		return (
			await post("REQUEST_CHANGES").catch((error: unknown) => {
				// Only that refusal, a 422 (gh may print its status without GitHub's words): any other
				// error, a 5xx or the network, is the run's to report.
				if (!/own pull request|\(HTTP 422\)/i.test(String(error))) throw error;
				return post("COMMENT");
			})
		).html_url;
	},
	async createIssue(repository, issue) {
		return (
			await api<{ html_url: string }>(`repos/${repository}/issues`, {
				method: "POST",
				input: issue,
			})
		).html_url;
	},
	async mergeMethod(repository) {
		const repo = await api<{
			allow_squash_merge?: boolean;
			allow_merge_commit?: boolean;
			allow_rebase_merge?: boolean;
		}>(`repos/${repository}`);
		if (repo.allow_squash_merge) return "squash";
		if (repo.allow_merge_commit) return "merge";
		if (repo.allow_rebase_merge) return "rebase";
		return undefined;
	},
	async branchRed(repository, branch) {
		const ref = encodeURIComponent(branch);
		const [status, runs] = await Promise.all([
			api<{ state: string }>(`repos/${repository}/commits/${ref}/status`),
			api<{ check_runs: { conclusion: string | null }[] }>(
				`repos/${repository}/commits/${ref}/check-runs?per_page=100`,
			),
		]);
		return isRed(status, runs.check_runs);
	},
	async merge(repository, number, { sha, method, auto }) {
		// Never --admin: a branch protection stays the last guard.
		await write(() =>
			run(repository, [
				"pr",
				"merge",
				String(number),
				"-R",
				repository,
				`--${method}`,
				"--match-head-commit",
				sha,
				...(auto ? ["--auto"] : []),
			]),
		);
	},
	async disableAutoMerge(repository, number) {
		try {
			await write(() =>
				run(repository, [
					"pr",
					"merge",
					String(number),
					"-R",
					repository,
					"--disable-auto",
				]),
			);
		} catch (error) {
			// GitHub may refuse to turn off an auto-merge that is off already: what counts is that it is off.
			const out = await run(repository, [
				"pr",
				"view",
				String(number),
				"-R",
				repository,
				"--json",
				"autoMergeRequest",
			]).catch(() => {
				throw error;
			});
			if ((JSON.parse(out) as { autoMergeRequest?: unknown }).autoMergeRequest)
				throw error;
		}
	},
	async close(repository, number, isPullRequest, reason) {
		await api(
			`repos/${repository}/${isPullRequest ? "pulls" : "issues"}/${number}`,
			{
				method: "PATCH",
				input: {
					state: "closed",
					...(reason && !isPullRequest ? { state_reason: reason } : {}),
				},
			},
		);
	},
};
