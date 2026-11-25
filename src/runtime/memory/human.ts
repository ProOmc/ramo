import fs from "node:fs";

/** Simple display helpers for the memory projection. */

export interface HumanNote {
	name: string;
	description: string;
	path: string;
}

export function humanDay(isoDay: string): string {
	const [year, month, day] = isoDay.split("-").map(Number);
	const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
	return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

export function humanTime(value: Date, timeZone?: string): string {
	return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", ...(timeZone ? { timeZone } : {}) }).format(value);
}

export function humanDateTime(value: string | number | Date, timeZone?: string): string {
	const date = value instanceof Date ? value : new Date(value);
	if (!Number.isFinite(date.getTime())) return "unknown";
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		...(timeZone ? { timeZone } : {}),
	}).format(date);
}

/** Which days `notes/daily/` holds an .md file for, ascending. */
export function daysWithEntriesArray(dailyDir: string): string[] {
	let names: string[] = [];
	try {
		names = fs.readdirSync(dailyDir);
	} catch {
		return [];
	}
	return names
		.filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
		.map((name) => name.replace(/\.md$/, ""))
		.sort();
}
