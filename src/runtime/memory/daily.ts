import type { MemoryPaths } from "./file.js";
import { daysWithEntriesArray as days } from "./human.js";
import { readFileSafe } from "./file.js";

export interface DailyNote {
	/** Path relative to the memory directory, with forward slashes. */
	path: string;
	date: string;
	content: string;
	label: string;
	header: string;
	entries: string[];
}

/** Which days the memory directory holds a daily note for, ascending. */
/** Which days `notes/daily/` holds an .md file for, ascending. Accepts a bare directory or memoryPaths(). */
export function daysWithEntries(input: string | MemoryPaths): string[] {
	try {
		if (typeof input === "string") {
			const base = input.endsWith("daily") || input.endsWith("notes") ? input : `${input}/notes/daily`;
			return days(base);
		}
		return days(input.daily);
	} catch {
		return [];
	}
}

/** The daily notes, newest first, each read as sentences. */
export function listDailyNotes(paths: MemoryPaths, limit = 14): DailyNote[] {
	const names = daysWithEntries(paths);
	const files = names.slice(-limit).reverse();
	const notes: DailyNote[] = [];
	for (const name of files) {
		const content = readFileSafe(`${paths.daily}/${name}.md`) ?? "";
		const entries = content
			.split(/\r?\n/)
			.filter((line) => line.trim().startsWith("- "))
			.map((line) => line.replace(/^\-\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}Z?\s*/, "").trim())
			.filter(Boolean);
		if (entries.length === 0) continue;
		notes.push({
			path: `notes/daily/${name}.md`,
			date: name,
			content,
			label: name,
			header: `Daily note — ${name}`,
			entries,
		});
	}
	return notes;
}
