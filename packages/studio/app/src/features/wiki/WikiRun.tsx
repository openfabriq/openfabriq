import { CircleAlert, GitPullRequest, Loader2 } from "lucide-react";
import { Elapsed } from "../../components/badges.js";
import { NoticeBox } from "../../components/engine-run.js";
import { runHref } from "../../lib/route.js";
import { PROSE_LINK } from "./wiki-ui.js";
import type { WikiNotice } from "./wiki-view.js";

// Following a run of the wiki: the notice above the wiki.

/** Where the latest run of the wiki stands, above the wiki. */
export function RunNotice({
	notice,
	project,
	failure,
}: {
	notice: WikiNotice | undefined;
	project: string;
	failure: string | undefined;
}) {
	const runLink = (id: string) => (
		<a
			href={runHref(id, { project })}
			className={`whitespace-nowrap ${PROSE_LINK}`}
		>
			See the run
		</a>
	);
	const working = (
		<Loader2 className="animate-spin text-accent-text" aria-hidden />
	);
	const failed = <CircleAlert className="text-bad" aria-hidden />;
	if (failure)
		return (
			<NoticeBox tone="failed" icon={failed}>
				{failure}
			</NoticeBox>
		);
	switch (notice?.kind) {
		case "asked":
			return (
				<NoticeBox tone="working" icon={working}>
					Asked. The engine starts writing the wiki within a minute.
				</NoticeBox>
			);
		case "queued":
			return (
				<NoticeBox tone="working" icon={working}>
					Waiting for its turn: the engine runs a few agents at a time.{" "}
					{runLink(notice.id)}
				</NoticeBox>
			);
		case "running":
			return (
				<NoticeBox tone="working" icon={working}>
					The engine is writing the wiki, for <Elapsed since={notice.since} />{" "}
					so far. It opens a pull request when it is done. {runLink(notice.id)}
				</NoticeBox>
			);
		case "merge":
			return (
				<NoticeBox
					tone="done"
					icon={<GitPullRequest className="text-ok" aria-hidden />}
				>
					The wiki is written.{" "}
					<a
						href={notice.pullRequest}
						target="_blank"
						rel="noreferrer noopener"
						className={PROSE_LINK}
					>
						Merge its pull request
					</a>{" "}
					and the pages show here, within a minute.
				</NoticeBox>
			);
		case "failed":
			return (
				<NoticeBox tone="failed" icon={failed}>
					The last update did not finish
					{notice.reason ? `: ${notice.reason}` : ""}. {runLink(notice.id)}
				</NoticeBox>
			);
		default:
			return null;
	}
}
