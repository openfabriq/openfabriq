import { Info } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { axisTicks, percent } from "./overview-figures.js";

// The overview's building blocks: its cards and figures, and its charts.

/** A bar cut in parts, in proportion: what a whole is made of. */
export function Shares({
	label,
	parts,
}: {
	label: string;
	parts: { key: string; value: number; color: string }[];
}) {
	const total = parts.reduce((sum, p) => sum + p.value, 0);
	return (
		<div
			role="img"
			aria-label={label}
			className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-sunken"
		>
			{parts
				.filter((p) => p.value > 0)
				.map((p) => (
					<span
						key={p.key}
						className="h-full min-w-1"
						style={{ width: percent(p.value, total), background: p.color }}
					/>
				))}
		</div>
	);
}

const dayLabel = (day: string, long = false) =>
	new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", {
		...(long ? { weekday: "short" } : {}),
		day: "numeric",
		month: "short",
	});

/** The lines of a chart's axis, from 0 at the bottom to the last tick at the top, each with its value. */
function Axis({
	ticks,
	format,
}: {
	ticks: number[];
	format: (value: number) => string;
}) {
	const top = ticks.at(-1) ?? 1;
	return ticks.map((t) => (
		<div
			key={t}
			className="absolute inset-x-0 flex items-center gap-2"
			style={{ top: `${(1 - t / top) * 100}%` }}
		>
			<span className="tnum w-12 -translate-y-1/2 text-right text-2xs text-fg-3">
				{format(t)}
			</span>
			<span
				className={`flex-1 -translate-y-1/2 ${t === 0 ? "h-px bg-line-2" : "border-t border-dashed border-line"}`}
			/>
		</div>
	));
}

/** The first and last days under a chart. */
function DayRange({ days }: { days: string[] }) {
	if (days.length === 0) return null;
	return (
		<div
			className={`tnum mt-2 ml-14 flex text-2xs text-fg-3 ${days.length === 1 ? "justify-center" : "justify-between"}`}
		>
			<span>{dayLabel(days[0] ?? "")}</span>
			{days.length > 1 && <span>{dayLabel(days.at(-1) ?? "")}</span>}
		</div>
	);
}

/** One series over time: columns from one baseline, a tooltip per column. */
export function PerDay({
	days,
	format,
	color,
	unit,
	minStep,
	partColor,
}: {
	days: {
		day: string;
		value: number;
		runs?: number;
		/** The column cut in parts, bottom first: what the day's value is made of. */
		parts?: { key: string; value: number }[];
	}[];
	format: (value: number) => string;
	color: string;
	/** The color of each part, when the days have parts. */
	partColor?: (key: string) => string;
	/** A word after the value in the tooltip, when `format` does not say it. */
	unit?: string;
	/** The smallest step between two lines of the axis, in the series' own unit. */
	minStep?: number;
}) {
	const [hover, setHover] = useState<number>();
	const max = Math.max(...days.map((d) => d.value), 0);
	const ticks = axisTicks(max, minStep);
	const top = ticks.at(-1) ?? 1;
	const shown = hover === undefined ? undefined : days[hover];
	return (
		<div className="flex flex-1 flex-col">
			<div className="relative min-h-40 flex-1">
				<Axis ticks={ticks} format={format} />
				<div
					className="absolute inset-y-0 right-0 left-14 flex items-end"
					onPointerLeave={() => setHover(undefined)}
				>
					{days.map((d, i) => (
						<button
							type="button"
							key={d.day}
							aria-label={`${dayLabel(d.day, true)}: ${format(d.value)}${unit ? ` ${unit}` : ""}`}
							onPointerEnter={() => setHover(i)}
							onFocus={() => setHover(i)}
							onBlur={() => setHover(undefined)}
							className="flex h-full min-w-0 flex-1 items-end justify-center px-px focus-visible:outline-offset-0"
						>
							<span
								className={`flex w-full max-w-5 flex-col-reverse overflow-hidden rounded-t-[3px] transition-opacity duration-150 ${hover !== undefined && hover !== i ? "opacity-40" : ""}`}
								style={{
									height:
										d.value > 0 ? `max(${(d.value / top) * 100}%, 3px)` : "1px",
									background:
										d.value > 0 && !d.parts?.length ? color : "var(--line-2)",
								}}
							>
								{d.parts?.map((part) => (
									<span
										key={part.key}
										className="block w-full"
										style={{
											flexGrow: part.value,
											background: partColor?.(part.key) ?? color,
										}}
									/>
								))}
							</span>
						</button>
					))}
				</div>
				{shown && hover !== undefined && (
					<div
						className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-panel px-3 py-2 shadow-pop"
						style={{
							left: `calc(56px + (100% - 56px) * ${(hover + 0.5) / days.length})`,
						}}
					>
						<div className="tnum text-sm font-semibold whitespace-nowrap text-fg">
							{format(shown.value)}
							{unit && ` ${unit}`}
						</div>
						<div className="tnum text-xs whitespace-nowrap text-fg-2">
							{dayLabel(shown.day, true)}
							{shown.runs !== undefined &&
								` · ${shown.runs} ${shown.runs === 1 ? "run" : "runs"}`}
						</div>
						{shown.parts?.map((part) => (
							<div
								key={part.key}
								className="tnum mt-1 flex items-center gap-1.5 text-xs whitespace-nowrap text-fg-2"
							>
								<span
									className="size-2 rounded-full"
									style={{ background: partColor?.(part.key) ?? color }}
									aria-hidden
								/>
								{part.key} {format(part.value)}
							</div>
						))}
					</div>
				)}
			</div>
			<DayRange days={days.map((d) => d.day)} />
		</div>
	);
}

/** The points of a series, in runs broken where a value is missing; x and y in percent of the box. */
function segments(values: (number | undefined)[], top: number) {
	const out: [number, number][][] = [];
	let run: [number, number][] | undefined;
	values.forEach((v, i) => {
		if (v === undefined) {
			run = undefined;
			return;
		}
		if (!run) {
			run = [];
			out.push(run);
		}
		run.push([((i + 0.5) / values.length) * 100, (1 - v / top) * 100]);
	});
	return out;
}

const linePath = (runs: [number, number][][]) =>
	runs
		.map((r) => r.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" "))
		.join(" ");

/** The area between each run of points and the baseline. */
const areaPath = (runs: [number, number][][]) =>
	runs
		.map(
			(r) =>
				`M${r[0]?.[0]} 100 ${r.map(([x, y]) => `L${x} ${y}`).join(" ")} L${r.at(-1)?.[0]} 100 Z`,
		)
		.join(" ");

/** How a series is marked in the legend and the tooltip: a dash when its line is dashed, a dot otherwise. */
function SeriesMark({
	color,
	dashed,
}: {
	color: string;
	dashed?: boolean | undefined;
}) {
	return dashed ? (
		<span
			aria-hidden
			className="w-3.5 shrink-0 border-t-2 border-dashed"
			style={{ borderColor: color }}
		/>
	) : (
		<span
			aria-hidden
			className="size-2 shrink-0 rounded-full"
			style={{ background: color }}
		/>
	);
}

/**
 * A few series over time, as lines on one axis, with a tooltip per day. The first series leads:
 * drawn on top, thicker, the area under it tinted. A value missing breaks its line; a lone point
 * is still shown, as a dot.
 */
export function Lines({
	days,
	series,
	format,
	max,
	minStep,
	detail,
	note,
}: {
	days: string[];
	series: {
		key: string;
		/** Its name in the legend and the tooltip; `total` follows it in the legend. */
		label: string;
		total?: string;
		color: string;
		/** The tint of the area under the line, for the leading series. */
		fill?: string;
		dashed?: boolean;
		values: (number | undefined)[];
	}[];
	format: (value: number) => string;
	/** The top of the axis when it is known, such as 1 for a share. */
	max?: number;
	minStep?: number;
	/** A line under the day in the tooltip. */
	detail?: (index: number) => string;
	/** What to read in the chart, after the legend. */
	note?: string;
}) {
	const [hover, setHover] = useState<number>();
	const highest =
		max ?? Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
	const ticks = axisTicks(highest, minStep);
	const top = ticks.at(-1) ?? 1;
	const at = (i: number) => `${((i + 0.5) / days.length) * 100}%`;
	return (
		<div className="flex flex-1 flex-col">
			<div className="relative min-h-40 flex-1">
				<Axis ticks={ticks} format={format} />
				<div
					className="absolute inset-y-0 right-0 left-14"
					onPointerLeave={() => setHover(undefined)}
				>
					{hover !== undefined && (
						<span
							aria-hidden
							className="absolute inset-y-0 w-px bg-line-2"
							style={{ left: at(hover) }}
						/>
					)}
					<svg
						aria-hidden
						className="absolute inset-0 size-full overflow-visible"
						viewBox="0 0 100 100"
						preserveAspectRatio="none"
					>
						{/* The leading series last, on top. */}
						{[...series].reverse().map((s, i, all) => {
							const runs = segments(s.values, top);
							const leads = i === all.length - 1;
							return (
								<g key={s.key}>
									{s.fill && <path d={areaPath(runs)} fill={s.fill} />}
									<path
										d={linePath(runs)}
										fill="none"
										stroke={s.color}
										strokeWidth={leads ? 2.5 : 2}
										strokeDasharray={s.dashed ? "5 4" : undefined}
										strokeLinejoin="round"
										strokeLinecap="round"
										vectorEffect="non-scaling-stroke"
									/>
								</g>
							);
						})}
					</svg>
					{series.flatMap((s) =>
						s.values.map((v, i) => {
							const lone =
								s.values[i - 1] === undefined && s.values[i + 1] === undefined;
							return v !== undefined && (lone || hover === i) ? (
								<span
									key={`${s.key}-${days[i]}`}
									aria-hidden
									className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel"
									style={{
										left: at(i),
										top: `${(1 - v / top) * 100}%`,
										background: s.color,
									}}
								/>
							) : null;
						}),
					)}
					<div className="absolute inset-0 flex">
						{days.map((day, i) => (
							<button
								type="button"
								key={day}
								aria-label={`${dayLabel(day, true)}: ${series
									.map(
										(s) =>
											`${s.label} ${s.values[i] === undefined ? "none" : format(s.values[i])}`,
									)
									.join(", ")}`}
								onPointerEnter={() => setHover(i)}
								onFocus={() => setHover(i)}
								onBlur={() => setHover(undefined)}
								className="h-full min-w-0 flex-1 focus-visible:outline-offset-0"
							/>
						))}
					</div>
				</div>
				{hover !== undefined && (
					<div
						className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-panel px-3 py-2 shadow-pop"
						style={{
							left: `calc(56px + (100% - 56px) * ${(hover + 0.5) / days.length})`,
						}}
					>
						<div className="tnum text-xs whitespace-nowrap text-fg-2">
							{dayLabel(days[hover] ?? "", true)}
							{detail && ` · ${detail(hover)}`}
						</div>
						{series.map((s) => {
							const v = s.values[hover];
							return (
								<div
									key={s.key}
									className="tnum mt-1 flex items-center gap-1.5 text-xs whitespace-nowrap text-fg-2"
								>
									<SeriesMark color={s.color} dashed={s.dashed} />
									{s.label}
									<span className="ml-auto pl-3 font-semibold text-fg">
										{v === undefined ? "—" : format(v)}
									</span>
								</div>
							);
						})}
					</div>
				)}
			</div>
			<DayRange days={days} />
			<ul className="tnum mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-2">
				{series.map((s) => (
					<li key={s.key} className="flex items-center gap-1.5">
						<SeriesMark color={s.color} dashed={s.dashed} />
						{s.label}
						{s.total && <span className="font-medium text-fg">{s.total}</span>}
					</li>
				))}
				{note && <li className="text-fg-3">{note}</li>}
			</ul>
		</div>
	);
}

/** What a figure means, one hover or focus away from its title. */
export function HelpNote({
	label,
	children,
}: {
	/** What the button says to a screen reader, such as "How autonomy is counted". */
	label: string;
	children: ReactNode;
}) {
	const id = useId();
	return (
		<span className="group/note inline-flex align-middle">
			<button
				type="button"
				aria-describedby={id}
				aria-label={label}
				className="inline-flex size-6 items-center justify-center rounded-md text-fg-3 transition-colors duration-150 hover:bg-hover hover:text-fg"
			>
				<Info className="size-4" aria-hidden />
			</button>
			<span
				id={id}
				role="tooltip"
				className="pointer-events-none invisible absolute inset-x-3 top-12 z-20 block translate-y-1 rounded-xl border border-line bg-panel px-3.5 py-3 text-xs font-normal tracking-normal text-pretty text-fg-2 opacity-0 shadow-pop transition-[opacity,translate,visibility] duration-150 ease-out group-focus-within/note:visible group-focus-within/note:translate-y-0 group-focus-within/note:opacity-100 group-hover/note:visible group-hover/note:translate-y-0 group-hover/note:opacity-100"
			>
				{children}
			</span>
		</span>
	);
}

/** A card of the overview: its name, an optional note, then what it shows. */
export function Card({
	title,
	note,
	action,
	className = "",
	children,
}: {
	title: string;
	note?: ReactNode;
	/** A control at the right of the title, such as a filter. */
	action?: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	return (
		<section
			className={`panel relative flex min-w-0 flex-col p-4 sm:p-5 ${className}`}
		>
			<div className="flex items-center justify-between gap-3">
				<h4 className="min-h-6 text-[13px] leading-6 font-medium text-pretty text-fg">
					{title}
					{note}
				</h4>
				{action}
			</div>
			{children}
		</section>
	);
}

/** A card's figure, and a line under it that says what it is made of. */
export function Figure({
	value,
	children,
}: {
	value: ReactNode;
	children?: ReactNode;
}) {
	return (
		<>
			<div className="tnum mt-1 text-2xl font-semibold tracking-[-0.025em] text-fg">
				{value}
			</div>
			{children && (
				<div className="tnum mt-1 text-xs text-pretty text-fg-2">
					{children}
				</div>
			)}
		</>
	);
}

export const none = <span className="text-fg-3">—</span>;
