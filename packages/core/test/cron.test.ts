import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCron } from "../src/cron/parse.js";
import { dueRun, nextRun } from "../src/cron/schedule.js";
import { cronWords } from "../src/cron/words.js";
import { example, load, ROOT } from "./helpers.js";

describe("parseCron", () => {
	it("accepts numbers, ranges, lists and steps", () => {
		for (const cron of [
			"0 9 * * 1",
			"*/15 * * * *",
			"0 9-17 * * 1-5",
			"0 0 1,15 * *",
			"0 0 * * 7",
		]) {
			expect(parseCron(cron)).toHaveProperty("fields");
		}
	});

	it("explains what is wrong", () => {
		expect(parseCron("* * *")).toEqual({
			error: "needs 5 fields (minute hour day month weekday), got 3",
		});
		expect(parseCron("61 * * * *")).toEqual({
			error: "minute must be between 0 and 59, got 61",
		});
		expect(parseCron("0 9 * * mon")).toEqual({
			error: 'weekday: "mon" is not a number',
		});
		expect(parseCron("0 1-2-3 * * *")).toEqual({
			error: 'hour: "1-2-3" is not a range',
		});
		expect(parseCron("1/2/3 * * * *")).toEqual({
			error: 'minute: "1/2/3" has more than one step',
		});
	});

	it("refuses a date that never comes, February counting 29 days", () => {
		expect(parseCron("0 9 31 2 *")).toEqual({
			error: "never runs: February has no day 31",
		});
		expect(parseCron("0 9 30,31 2 *")).toEqual({
			error: "never runs: February has no day 30 or 31",
		});
		expect(parseCron("0 9 31 4,6 *")).toEqual({
			error: "never runs: April and June have no day 31",
		});
		expect(parseCron("0 9 29 2 *")).toHaveProperty("fields");
		expect(parseCron("0 9 31 4,5 *")).toHaveProperty("fields");
		// With a weekday too, either one runs it.
		expect(parseCron("0 9 31 2 1")).toHaveProperty("fields");
	});

	it("reads each field into the values it runs at", () => {
		const read = (expression: string) => {
			const cron = parseCron(expression);
			return "error" in cron
				? cron
				: {
						fields: cron.fields.map((values) => [...values]),
						restricted: cron.restricted,
					};
		};
		// A field that starts with * is not restricted, even with a step.
		expect(read("5/20 1-3,7 */10 2-12/5 7")).toEqual({
			fields: [[5, 25, 45], [1, 2, 3, 7], [1, 11, 21, 31], [2, 7, 12], [0]],
			restricted: [true, true, false, true, true],
		});
		expect(read(" 0  9 * * 1-5 ")).toEqual({
			fields: [
				[0],
				[9],
				Array.from({ length: 31 }, (_, i) => i + 1),
				Array.from({ length: 12 }, (_, i) => i + 1),
				[1, 2, 3, 4, 5],
			],
			restricted: [true, true, false, false, true],
		});
		expect(read("0 0 * * 0,7")).toMatchObject({
			fields: [[0], [0], expect.anything(), expect.anything(), [0]],
		});
	});

	it("explains every way a field can be wrong, at the first wrong item", () => {
		expect(
			[
				"",
				"0 0 0 * *",
				"0 24 * * *",
				"*/0 * * * *",
				"0 0 * * 5-1",
				"1/x * * * *",
				"1- * * * *",
				"1,x,99 * * * *",
				"0 0 1 13 *",
				"0 0 1 1 8",
				"0 0 1-2-3/x * *",
				"0 0 */x * *",
				"0 0 0-x * *",
			].map((expression) => parseCron(expression)),
		).toEqual([
			{ error: "needs 5 fields (minute hour day month weekday), got 1" },
			{ error: "day must be between 1 and 31, got 0" },
			{ error: "hour must be between 0 and 23, got 24" },
			{ error: 'minute: "*/0" is empty' },
			{ error: 'weekday: "5-1" is empty' },
			{ error: 'minute: "x" is not a number' },
			{ error: 'minute: "" is not a number' },
			{ error: 'minute: "x" is not a number' },
			{ error: "month must be between 1 and 12, got 13" },
			{ error: "weekday must be between 0 and 7, got 8" },
			{ error: 'day: "1-2-3/x" is not a range' },
			{ error: 'day: "x" is not a number' },
			{ error: 'day: "x" is not a number' },
		]);
	});
});

describe("nextRun", () => {
	it("reads the machine's local time, Sunday as 0 or 7", () => {
		const saturday9 = new Date(2026, 9, 31, 9, 0);
		const sunday9 = new Date(2026, 10, 1, 9, 0);
		const monday9 = new Date(2026, 10, 2, 9, 0);
		expect(nextRun("0 9 * * 1", saturday9)).toEqual(monday9);
		expect(nextRun("0 9 * * 7", saturday9)).toEqual(sunday9);
		expect(nextRun("*/15 9-17 * * 1-5", new Date(2026, 10, 2, 17, 40))).toEqual(
			new Date(2026, 10, 2, 17, 45),
		);
		expect(nextRun("*/15 9-17 * * 1-5", new Date(2026, 10, 2, 17, 45))).toEqual(
			new Date(2026, 10, 3, 9, 0),
		);
	});
});

describe("schedules in a time zone", () => {
	const at = (iso: string) => new Date(iso);

	it("reads a cron in the factory's time zone, whatever the machine's", () => {
		// 01:00 UTC is 02:00 in Paris in November (UTC+1).
		expect(
			nextRun("0 2 * * *", at("2026-11-03T00:30:00Z"), "Europe/Paris"),
		).toEqual(at("2026-11-03T01:00:00Z"));
		expect(nextRun("0 2 * * *", at("2026-11-03T00:30:00Z"), "UTC")).toEqual(
			at("2026-11-03T02:00:00Z"),
		);
	});

	it("finds the next run, strictly after a moment", () => {
		expect(
			nextRun("0 2 * * *", at("2026-11-03T10:00:00Z"), "Europe/Paris"),
		).toEqual(at("2026-11-04T01:00:00Z"));
		expect(
			nextRun("0 2 * * *", at("2026-11-04T01:00:00Z"), "Europe/Paris"),
		).toEqual(at("2026-11-05T01:00:00Z"));
		// Monday 9:00 in New York (UTC-5 in November), from a Tuesday.
		expect(
			nextRun("0 9 * * 1", at("2026-11-03T15:00:00Z"), "America/New_York"),
		).toEqual(at("2026-11-09T14:00:00Z"));
		expect(nextRun("0 0 1 * *", at("2026-11-03T00:00:00Z"), "UTC")).toEqual(
			at("2026-12-01T00:00:00Z"),
		);
	});

	it("runs a missed schedule once, for the latest time it was due", () => {
		const since = at("2026-11-01T12:00:00Z");
		// Three nights missed: one run, for the last one.
		expect(
			dueRun("0 2 * * *", since, at("2026-11-04T08:12:00Z"), "Europe/Paris"),
		).toEqual(at("2026-11-04T01:00:00Z"));
		// Nothing due since the last check.
		expect(
			dueRun(
				"0 2 * * *",
				at("2026-11-04T01:00:30Z"),
				at("2026-11-04T08:12:00Z"),
				"Europe/Paris",
			),
		).toBeUndefined();
		// Due this very minute.
		expect(
			dueRun(
				"0 2 * * *",
				at("2026-11-04T00:59:30Z"),
				at("2026-11-04T01:00:30Z"),
				"Europe/Paris",
			),
		).toEqual(at("2026-11-04T01:00:00Z"));
	});

	it("finds the latest run however old the last check is", () => {
		expect(
			dueRun(
				"* * * * *",
				at("2020-01-01T00:00:00Z"),
				at("2026-11-04T08:12:30Z"),
				"UTC",
			),
		).toEqual(at("2026-11-04T08:12:00Z"));
	});

	it("keeps schedules right across both daylight-saving nights", () => {
		const paris = "Europe/Paris";
		// Spring 2026-03-29 has 23 hours: the next midnight is that same night, not a year later.
		expect(nextRun("0 0 30 3 *", at("2026-03-28T23:30:00Z"), paris)).toEqual(
			at("2026-03-29T22:00:00Z"),
		);
		// A laptop asleep over that weekend still owes Monday's run.
		expect(
			dueRun(
				"0 0 * * 1",
				at("2026-03-28T20:00:00Z"),
				at("2026-03-30T06:00:00Z"),
				paris,
			),
		).toEqual(at("2026-03-29T22:00:00Z"));
		// Autumn 2026-10-25 repeats 02:00-03:00: the cron runs once, the first time.
		expect(nextRun("30 2 * * *", at("2026-10-24T23:00:00Z"), paris)).toEqual(
			at("2026-10-25T00:30:00Z"),
		);
		expect(nextRun("30 2 * * *", at("2026-10-25T00:30:00Z"), paris)).toEqual(
			at("2026-10-26T01:30:00Z"),
		);
	});

	it("runs a time the spring night skips once, at the first minute after the gap", () => {
		const paris = "Europe/Paris";
		// 2026-03-29 the clock jumps from 02:00 to 03:00 (01:00 UTC): 02:30 runs at 03:00.
		expect(nextRun("30 2 * * *", at("2026-03-28T23:00:00Z"), paris)).toEqual(
			at("2026-03-29T01:00:00Z"),
		);
		expect(nextRun("30 2 * * *", at("2026-03-29T01:00:00Z"), paris)).toEqual(
			at("2026-03-30T00:30:00Z"),
		);
		// A laptop asleep that night still owes it.
		expect(
			dueRun(
				"30 2 * * *",
				at("2026-03-28T23:00:00Z"),
				at("2026-03-29T06:00:00Z"),
				paris,
			),
		).toEqual(at("2026-03-29T01:00:00Z"));
		// Times inside the gap and 03:00 itself make one run, not two.
		expect(
			nextRun("0,30 2,3 * * *", at("2026-03-28T23:00:00Z"), paris),
		).toEqual(at("2026-03-29T01:00:00Z"));
		expect(
			nextRun("0,30 2,3 * * *", at("2026-03-29T01:00:00Z"), paris),
		).toEqual(at("2026-03-29T01:30:00Z"));
		// Lord Howe jumps 30 minutes, from 02:00 to 02:30 (15:30 UTC the day before).
		expect(
			nextRun("15 2 * * *", at("2026-10-03T12:00:00Z"), "Australia/Lord_Howe"),
		).toEqual(at("2026-10-03T15:30:00Z"));
		// From a moment inside the night, the gap before the first minute counts too.
		expect(nextRun("30 2 * * *", at("2026-03-29T00:59:30Z"), paris)).toEqual(
			at("2026-03-29T01:00:00Z"),
		);
	});

	it("keeps every schedule of the examples on its day and hour all year", () => {
		const parts = (date: Date, timeZone: string) =>
			Object.fromEntries(
				new Intl.DateTimeFormat("en-CA", {
					timeZone,
					hourCycle: "h23",
					year: "numeric",
					month: "2-digit",
					day: "2-digit",
					hour: "2-digit",
					minute: "2-digit",
				})
					.formatToParts(date)
					.map((p) => [p.type, p.value]),
			);
		const schedules = readdirSync(join(ROOT, "examples")).flatMap((name) => {
			const factory = load(example(name));
			return Object.values(factory.automations).flatMap((a) =>
				a.when.flatMap((t) =>
					t.cron ? [[t.cron, factory.timezone ?? "UTC"] as const] : [],
				),
			);
		});
		expect(schedules.length).toBeGreaterThan(10);
		for (const [cron, timeZone] of schedules) {
			// Daily, weekly or monthly: the examples restrict the day of the month or of the week, never both.
			const [minute, hour, monthDay, , weekday] = cron
				.split(" ")
				.map((field) => (field === "*" ? undefined : Number(field)));
			const runs: string[] = [];
			let run = nextRun(cron, at("2025-12-31T23:59:00Z"), timeZone);
			for (
				;
				run && run < at("2026-12-31T00:00:00Z");
				run = nextRun(cron, run, timeZone)
			) {
				const p = parts(run, timeZone);
				runs.push(`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`);
			}
			const wanted: string[] = [];
			for (let d = 0; d < 364; d++) {
				const day = new Date(Date.UTC(2026, 0, 1 + d));
				if (
					(monthDay === undefined || day.getUTCDate() === monthDay) &&
					(weekday === undefined || day.getUTCDay() === weekday)
				) {
					const date = day.toISOString().slice(0, 10);
					// 02:00 does not exist in Paris that night: the run comes at 03:00.
					const time =
						date === "2026-03-29" && hour === 2
							? "03:00"
							: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
					wanted.push(`${date} ${time}`);
				}
			}
			expect(runs, `${cron} in ${timeZone}`).toEqual(wanted);
		}
	});

	it("runs once in a zone whose clock goes back 30 minutes", () => {
		const lordHowe = "Australia/Lord_Howe";
		// 2026-04-05 at 02:00 the clock goes back to 01:30: 01:45 comes twice, at 14:45 and 15:15 UTC.
		expect(nextRun("45 1 * * *", at("2026-04-04T14:45:00Z"), lordHowe)).toEqual(
			at("2026-04-05T15:15:00Z"),
		);
		expect(
			dueRun(
				"45 1 * * *",
				at("2026-04-04T14:45:00Z"),
				at("2026-04-04T16:00:00Z"),
				lordHowe,
			),
		).toBeUndefined();
	});

	it("runs once in a zone whose clock goes back 2 hours", () => {
		// Troll, in Antarctica: 2026-10-25 at 03:00 the clock goes back to 01:00, so 02:30 comes
		// twice, at 00:30 and 02:30 UTC.
		expect(
			nextRun("30 2 * * *", at("2026-10-25T00:30:00Z"), "Antarctica/Troll"),
		).toEqual(at("2026-10-26T02:30:00Z"));
	});

	it("says a cron in words when it can, and as written otherwise", () => {
		expect(cronWords("0 2 * * *")).toBe("every day at 02:00");
		expect(cronWords("30 9 * * 1")).toBe("every Monday at 09:30");
		expect(cronWords("0 9 * * 1-5")).toBe("every weekday at 09:00");
		expect(cronWords("0 9 * * 1,3")).toBe(
			"every Monday and Wednesday at 09:00",
		);
		expect(cronWords("0 0 1 * *")).toBe("on day 1 of every month at 00:00");
		expect(cronWords("15 * * * *")).toBe("every hour at :15");
		expect(cronWords("*/1 * * * *")).toBe("every minute");
		expect(cronWords("*/15 * * * *")).toBe("every 15 minutes");
		// */45 runs at :00 and :45, not every 45 minutes: only a step that divides the hour is said in words.
		expect(cronWords("*/45 * * * *")).toBe("*/45 * * * *");
		expect(cronWords("*/7 * * * *")).toBe("*/7 * * * *");
		expect(cronWords("*/30 * * * *")).toBe("every 30 minutes");
		expect(cronWords("0 9-17 * * 1-5")).toBe("0 9-17 * * 1-5");
	});
});

describe("cron edges", () => {
	const at = (iso: string) => new Date(iso);

	it("reads extra spaces like one", () => {
		expect(parseCron(" 0  9 * *  * ")).toEqual(parseCron("0 9 * * *"));
		expect(cronWords(" 0  9 * *  * ")).toBe("every day at 09:00");
	});

	it("refuses a bad step, a half number, a zero day and an empty range", () => {
		for (const [cron, error] of [
			["*/x * * * *", 'minute: "x" is not a number'],
			["*/ * * * *", 'minute: "*/" has no step after /'],
			["5/ * * * *", 'minute: "5/" has no step after /'],
			["0 9a * * *", 'hour: "9a" is not a number'],
			["0 a9 * * *", 'hour: "a9" is not a number'],
			["0 0 0 * *", "day must be between 1 and 31, got 0"],
			["*/0 * * * *", 'minute: "*/0" is empty'],
			["0 5-1 * * *", 'hour: "5-1" is empty'],
			["0 9 31 9,11 *", "never runs: September and November have no day 31"],
		])
			expect(parseCron(cron as string), cron).toEqual({ error });
		// April has a day 30, so the cron runs on it.
		expect(parseCron("0 9 30,31 4 *")).toHaveProperty("fields");
	});

	it("reads 7 as Sunday only in the weekday field", () => {
		expect(nextRun("0 7 * * *", at("2026-11-03T00:00:00Z"), "UTC")).toEqual(
			at("2026-11-03T07:00:00Z"),
		);
	});

	it("runs on Fridays and Saturdays in a time zone, and on a day or a weekday when both are set", () => {
		const tuesday = at("2026-11-03T10:00:00Z");
		expect(nextRun("0 9 * * 5", tuesday, "UTC")).toEqual(
			at("2026-11-06T09:00:00Z"),
		);
		expect(nextRun("0 9 * * 6", tuesday, "UTC")).toEqual(
			at("2026-11-07T09:00:00Z"),
		);
		// Day 4 or a Friday: Wednesday the 4th comes first, then Friday the 6th.
		expect(nextRun("0 9 4 * 5", tuesday, "UTC")).toEqual(
			at("2026-11-04T09:00:00Z"),
		);
		expect(nextRun("0 9 4 * 5", at("2026-11-04T10:00:00Z"), "UTC")).toEqual(
			at("2026-11-06T09:00:00Z"),
		);
	});

	it("needs both a day and a weekday when one of them starts with *", () => {
		const tuesday = at("2026-11-03T10:00:00Z");
		// Mondays that are odd days: the 9th, then the 23rd (the 16th is even).
		expect(nextRun("0 9 */2 * 1", tuesday, "UTC")).toEqual(
			at("2026-11-09T09:00:00Z"),
		);
		expect(nextRun("0 9 */2 * 1", at("2026-11-09T10:00:00Z"), "UTC")).toEqual(
			at("2026-11-23T09:00:00Z"),
		);
		// The 15th when it is a Sunday, Tuesday, Thursday or Saturday: 2026-11-15 is a Sunday.
		expect(nextRun("0 9 15 * */2", tuesday, "UTC")).toEqual(
			at("2026-11-15T09:00:00Z"),
		);
		// Both restricted without *: either one.
		expect(nextRun("0 9 1-7 * 1", at("2026-11-08T10:00:00Z"), "UTC")).toEqual(
			at("2026-11-09T09:00:00Z"),
		);
		// A day that never comes, now that the weekday no longer adds any: refused.
		expect(parseCron("0 9 31 2 */2")).toEqual({
			error: "never runs: February has no day 31",
		});
	});

	it("reads the month in the machine's local time", () => {
		expect(nextRun("0 0 1 3 *", new Date(2026, 10, 3))).toEqual(
			new Date(2027, 2, 1),
		);
	});

	it("never runs an invalid cron, and owes a run due this very minute", () => {
		expect(nextRun("0 9 * *", at("2026-11-03T00:00:00Z"))).toBeUndefined();
		expect(
			dueRun("0 9 * *", at("2026-11-03T00:00:00Z"), at("2026-11-04T00:00:00Z")),
		).toBeUndefined();
		expect(
			dueRun(
				"0 2 * * *",
				at("2026-11-04T00:59:30Z"),
				at("2026-11-04T01:00:00Z"),
				"Europe/Paris",
			),
		).toEqual(at("2026-11-04T01:00:00Z"));
	});

	it("keeps in words only the shapes it describes exactly", () => {
		for (const cron of [
			"0 9 * * * *",
			"*/5 9 * * *",
			"5 * 1 * *",
			"5 * * 6 *",
			"5 * * * 1",
			"0 9 * 6 *",
			"0 9 1 * 1",
			"0 9 1-5 * 1",
			"0 9 * * 1,2-3",
		])
			expect(cronWords(cron)).toBe(cron);
		expect(cronWords("0 9 * * 0,2,4,5,6")).toBe(
			"every Sunday, Tuesday, Thursday, Friday and Saturday at 09:00",
		);
	});
});
