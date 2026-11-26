import { expect, it } from "vitest";
import {
	duration,
	linkText,
	outputHeadline,
	placeOf,
	runTitle,
	serverWhere,
} from "../../../app/src/lib/format.js";
import type { RunRecord } from "../../../app/src/lib/types.js";

it("names where a link leads", () => {
	expect(placeOf("https://github.com/acme/shop/issues/4")).toBe("GitHub");
	expect(placeOf("https://acme.slack.com/archives/C1/p1")).toBe("Slack");
	expect(placeOf("https://linear.app/acme/issue/ENG-1")).toBe("Linear");
	expect(placeOf("https://acme.sentry.io/issues/9/")).toBe("Sentry");
	expect(placeOf("https://git.acme.dev/x")).toBe("git.acme.dev");
	expect(placeOf("not a url")).toBe("its site");
});

it("says what an output's link opens, in words a person reads", () => {
	const repo = "https://github.com/acme/shop";
	expect(linkText(`${repo}/pull/51`)).toBe("Open PR #51");
	expect(linkText(`${repo}/issues/4`)).toBe("Open issue #4");
	expect(linkText(`${repo}/issues/4#issuecomment-9`)).toBe("Open comment");
	expect(linkText(`${repo}/pull/51#issuecomment-9`)).toBe("Open comment");
	expect(linkText(`${repo}/pull/51#pullrequestreview-3`)).toBe("Open review");
	expect(linkText("https://acme.slack.com/archives/C1/p1")).toBe(
		"Open on Slack",
	);
	expect(linkText("https://linear.app/acme/issue/ENG-1")).toBe(
		"Open on Linear",
	);
});

it("drops the subject a title starts with, since the page shows it just before", () => {
	const run = {
		automation: "investigate-sentry-errors",
		event: "sentry.issue.created",
		isPullRequest: false,
		source: { kind: "sentry", label: "WEB-APP-3F" },
		title: "WEB-APP-3F TypeError: cart is undefined",
	} as RunRecord;
	expect(runTitle(run)).toBe("TypeError: cart is undefined");
	expect(runTitle({ ...run, title: "WEB-APP-3Fx kept" })).toBe(
		"WEB-APP-3Fx kept",
	);
	expect(runTitle({ ...run, number: 4, title: "Add a counter" })).toBe(
		"Add a counter",
	);
	const { title: _, ...untitled } = run;
	expect(runTitle(untitled)).toBe("investigate-sentry-errors");
});

it("says where an MCP server runs", () => {
	expect(serverWhere({ url: "https://mcp.example.com", secret: "T" })).toBe(
		"https://mcp.example.com",
	);
	expect(serverWhere({ command: "npx db-mcp", secrets: ["DB"] })).toBe(
		"runs on this machine: npx db-mcp",
	);
});

it("reads an output's summary without its heading marks", () => {
	expect(outputHeadline("## Not done\nThe tests fail")).toBe(
		"Not done\nThe tests fail",
	);
	expect(outputHeadline("#\nA title")).toBe("A title");
	expect(outputHeadline("#hashtag")).toBe("#hashtag");
	expect(outputHeadline("Add a counter")).toBe("Add a counter");
});

it("writes a duration, under a second as <1s rather than 0s", () => {
	expect(duration(undefined)).toBe("—");
	expect(duration(23)).toBe("<1s");
	expect(duration(1_533)).toBe("2s");
	expect(duration(125_000)).toBe("2m 05s");
});
