import { sentenceList } from "../words.js";

// A cron in words, for the studio and the CLI.

const DAY_NAMES = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];

/** A cron in words for the common shapes ("every day at 02:00"); as written otherwise. */
export function cronWords(expression: string): string {
	const parts = expression.trim().split(/\s+/);
	if (parts.length !== 5) return expression;
	const [minute = "", hour = "", day = "", month = "", weekday = ""] = parts;
	const number = (text: string) => /^\d+$/.test(text);
	const pad = (text: string) => text.padStart(2, "0");
	if (
		minute.startsWith("*/") &&
		// A step that does not divide the hour starts again at :00: */45 runs at :00 and :45.
		60 % Number(minute.slice(2)) === 0 &&
		[hour, day, month, weekday].every((p) => p === "*")
	)
		return minute === "*/1"
			? "every minute"
			: `every ${minute.slice(2)} minutes`;
	if (
		number(minute) &&
		hour === "*" &&
		day === "*" &&
		month === "*" &&
		weekday === "*"
	)
		return `every hour at :${pad(minute)}`;
	if (!number(minute) || !number(hour) || month !== "*") return expression;
	const time = `${pad(hour)}:${pad(minute)}`;
	if (day === "*" && weekday === "*") return `every day at ${time}`;
	if (number(day) && weekday === "*")
		return `on day ${day} of every month at ${time}`;
	if (day !== "*") return expression;
	if (weekday === "1-5") return `every weekday at ${time}`;
	const days = weekday.split(",");
	if (!days.every(number)) return expression;
	const names = days.map((d) => DAY_NAMES[Number(d) % 7] ?? d);
	return `every ${sentenceList(names)} at ${time}`;
}
