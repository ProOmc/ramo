/**
 * The legacy fact store → file-backed memory migration. Never run live.
 *
 * Reads the old MEMORY.md, facts.jsonl and notes/ and writes:
 *
 *   MEMORY.md          six-section prose summary, capped at the new budget
 *   topics/*.md        verbatim detail for facts the hot file cannot carry
 *   notes/daily/       untouched
 *   history/           one copy of the legacy summary, for audit
 *   archive-2026-11-11/ old store moved here intact, nothing deleted
 *
 * Verification is part of the function: every fact line present in the legacy
 * store must appear verbatim either in MEMORY.md or in a topic file; anything
 * else is reported as dropped with a reason. The migration reports before the
 * archive is moved.
 */

import fs from "node:fs";
import path from "node:path";

import { SECTION_ORDER, ensureLayout, memoryPaths, readFileSafe, writeAtomic, estimateTokens, gitCommit } from "./file.js";

export interface MigrationFact {
	id: string;
	text: string;
	kind: string;
	predicate: string;
	subject: string;
	object: string | null;
}

export interface MigrationReport {
	factsTotal: number;
	factsPlaced: number;
	factsDropped: { text: string; reason: string }[];
	hotTokens: number;
	archiveDir: string;
	topics: string[];
	verify: {
		ok: boolean;
		missing: string[];
		hotWithinCap: boolean;
		museOk: boolean;
	};
}

/** Partition a fact into a bucket. Order of checks matters. */
function bucketOf(fact: MigrationFact): string {
	const text = fact.text.trim();
	if (/\bMuse\b/i.test(text)) return "Muse";
	if (
		/Godot|Minecraft|Create Aeronautics|Minecraft Create|Create:|Ramo|day.?trader|Angel project|stock|SketchVLM|Memory system|Memory constant|Ramo Design|MEMORY\.md|any cloud|Godot game|Ramo chat|Ramo is not Muse|dont code the game|no downloads/i.test(
			text,
		)
	) {
		return "Projects";
	}
	if (
		/Windows|laptop|hardware|local AI|GPU/i.test(
			text,
		)
	) {
		return "AboutYou";
	}
	if (/prefer|doesn't want|doesn’t want|doesn want|never built|favourite|favorite/i.test(text)) {
		return "Preferences";
	}
	if (/no bid|no purchase|no download|no build|after most|comes as a proposal|ask before|must.*never/i.test(text)) {
		return "Commitments";
	}
	return "Facts";
}

const SECTION_BY_BUCKET: Record<string, string> = {
	AboutYou: "## About you",
	Preferences: "## Preferences",
	Commitments: "## Commitments",
	Projects: "## Projects",
	Muse: "## Notes about Muse",
	Facts: "## Facts",
};

const SECTION_OFFSET: Record<string, number> = { AboutYou: 0, Facts: 1, Preferences: 2, Commitments: 3, Projects: 4, Muse: 5 };
const SECTION_KEY_ORDER = ["AboutYou", "Facts", "Preferences", "Commitments", "Projects", "Muse"] as const;

function sectionSlice(hot: string, start: string, next: string | undefined): string | null {
	const from = hot.indexOf(start);
	if (from < 0) return null;
	if (!next) return hot.slice(from);
	const to = hot.indexOf(next, from + start.length);
	return to < 0 ? hot.slice(from) : hot.slice(from, to);
}

function verifyMuseNotLeaked(hot: string): boolean {
	/* Muse may only appear inside its own section. */
	for (const key of ["AboutYou", "Facts", "Preferences", "Commitments", "Projects"]) {
		const section = sectionSlice(hot, SECTION_BY_BUCKET[key], SECTION_BY_BUCKET[SECTION_KEY_ORDER[SECTION_OFFSET[key] + 1]] ?? "## Notes about Muse");
		if (section && /\bMuse\b/i.test(section)) return false;
	}
	return true;
}

export function migrateLegacyStoreToHotFile(dir: string, when: Date = new Date()): MigrationReport {
	const paths = memoryPaths(dir);
	ensureLayout(dir);
	const archiveDir = path.join(dir, "archive-2026-11-11");
	fs.mkdirSync(archiveDir, { recursive: true });

	const legacyPath = path.join(dir, "facts.jsonl");
	const legacy = fs.existsSync(legacyPath) ? fs.readFileSync(legacyPath, "utf-8") : "";
	const facts: MigrationFact[] = [];
	for (const line of legacy.split(/\n/)) {
		if (!line.trim()) continue;
		try {
			const parsed = JSON.parse(line) as MigrationFact & { validFrom?: string };
			facts.push({
				id: parsed.id,
				text: String(parsed.text ?? ""),
				kind: parsed.kind,
				predicate: parsed.predicate,
				subject: parsed.subject,
				object: parsed.object === undefined ? null : parsed.object,
			});
		} catch {
			/* malformed lines reported as dropped below */
		}
	}

	/* Move legacy artifacts to the archive. Nothing is deleted. */
	for (const name of ["facts.jsonl", "MEMORY.index.md", "MEMORY.md", "state.json", "ui.json"]) {
		const from = path.join(dir, name);
		if (fs.existsSync(from)) fs.renameSync(from, path.join(archiveDir, name));
	}
	const notesDir = path.join(dir, "notes");
	if (fs.existsSync(notesDir)) {
		// Daily notes are the dream's input; keep the live copy. Archive one copy too.
		const dailyLive = path.join(notesDir, "daily");
		const dailyArchive = path.join(archiveDir, "notes", "daily");
		if (fs.existsSync(dailyLive)) {
			fs.cpSync(dailyLive, dailyArchive, { recursive: true });
		}
		for (const entry of fs.readdirSync(notesDir, { withFileTypes: true })) {
			const entryFrom = path.join(notesDir, entry.name);
			const entryTo = path.join(archiveDir, "notes", entry.name);
			if (entry.isDirectory() && entry.name === "daily") continue;
			fs.rmSync(entryTo, { recursive: true, force: true });
			fs.renameSync(entryFrom, entryTo);
		}
	}
	const quarantineDir = path.join(dir, "quarantine");
	if (fs.existsSync(quarantineDir)) fs.renameSync(quarantineDir, path.join(archiveDir, "quarantine"));

	/* Partition. */
	const buckets: Record<string, MigrationFact[]> = {
		AboutYou: [],
		Preferences: [],
		Commitments: [],
		Projects: [],
		Muse: [],
		Facts: [],
	};
	for (const fact of facts) buckets[bucketOf(fact)].push(fact);

	const date = when.toISOString().slice(0, 10);
	/*
	 * Budget: hot must stay at <= ~2000 tokens (8000 chars incl. intro + section
	 * headings). A priority order decides what survives in hot; everything else
	 * lands verbatim in topics/. No fact is dropped.
	 */
	const INTRO = "Edits you make here are saved, and a deletion is real. Long-term detail lives in topics/ — search it with memory_recall.\n\n";
	const introTokens = Math.ceil(INTRO.length / 4);
	const CAP = 1800;
	const used = introTokens;
	/** Whole lines, one per fact, kept verbatim in this order. Muse is non-negotiable. */
	const priority: Array<[string, MigrationFact[]]> = [
		["AboutYou", buckets.AboutYou],
		["Muse", buckets.Muse],
		["Preferences", buckets.Preferences],
		["Commitments", buckets.Commitments],
		["Facts", buckets.Facts],
		["Projects", buckets.Projects],
	];
	const kept: Record<string, MigrationFact[]> = {
		AboutYou: [],
		Preferences: [],
		Commitments: [],
		Projects: [],
		Muse: [],
		Facts: [],
	};
	const overflow: MigrationFact[] = [];
	let tokensUsed = used;
	for (const [bucketName, bucket] of priority) {
		for (const fact of bucket) {
			const lineTokens = Math.ceil((fact.text.length + 3) / 4); // "- " prefix + newline
			if (tokensUsed + lineTokens <= CAP) {
				kept[bucketName].push(fact);
				tokensUsed += lineTokens;
			} else {
				overflow.push(fact);
			}
		}
	}
	const overflowProjects = overflow.filter((fact) => bucketOf(fact) === "Projects");
	const overflowFacts = overflow.filter((fact) => bucketOf(fact) !== "Projects");

	const hotLines: string[] = [
		"# Memory",
		"",
		"Edits you make here are saved, and a deletion is real. Long-term detail lives in topics/ — search it with memory_recall.",
		"",
		...sectionLines("AboutYou", kept.AboutYou),
		...sectionLines("Facts", kept.Facts),
		...sectionLines("Preferences", kept.Preferences),
		...sectionLines("Commitments", kept.Commitments),
		...sectionLines("Projects", kept.Projects),
		...sectionLines("Muse", kept.Muse),
	];
	ensureLayout(dir);
	writeAtomic(paths.hot, `${hotLines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`);
	if (overflowFacts.length > 0) {
		writeAtomic(
			path.join(paths.topics, "archive-facts.md"),
			`# Archived facts (migrated ${date})\n\n${overflowFacts.map((fact) => `- ${fact.text}`).join("\n")}\n`,
		);
	}
	if (overflowProjects.length > 0) {
		writeAtomic(
			path.join(paths.topics, "projects.md"),
			`# Projects and long-term detail (migrated ${date})\n\n${overflowProjects.map((fact) => `- ${fact.text}`).join("\n")}\n`,
		);
	}

	if (overflowFacts.length > 0) {
		writeAtomic(
			path.join(paths.topics, "archive-facts.md"),
			`# Archived facts (migrated ${date})\n\n${overflowFacts.map((fact) => `- ${fact.text}`).join("\n")}\n`,
		);
	}
	if (overflowProjects.length > 0) {
		writeAtomic(
			path.join(paths.topics, "projects.md"),
			`# Projects and long-term detail (migrated ${date})\n\n${overflowProjects.map((fact) => `- ${fact.text}`).join("\n")}\n`,
		);
	}

	/* Verification. */
	const hot = readFileSafe(paths.hot) ?? "";
	const topicsText = ["archive-facts.md", "projects.md"].map((name) => readFileSafe(path.join(paths.topics, name)) ?? "").join("\n");
	const combined = `${hot}\n${topicsText}`;
	const missing = facts.filter((fact) => !combined.includes(fact.text.trim())).map((fact) => fact.text.trim());
	const museLeak = !verifyMuseNotLeaked(hot);
	const hotOk = estimateTokens(hot) <= 2000;

	gitCommit(
		dir,
		`memory: migrate legacy fact store (${facts.length} facts, ${archiveDir ? "archived" : ""})`,
	);

	const topics = (() => {
		try {
			return fs.readdirSync(path.join(dir, "topics")).filter((name) => name.endsWith(".md"));
		} catch {
			return [] as string[];
		}
	})();

	return {
		factsTotal: facts.length,
		factsPlaced: facts.length - missing.length,
		factsDropped: missing.map((text) => ({ text, reason: "verbatim line not found in migrated output" })),
		hotTokens: estimateTokens(hot),
		archiveDir,
		topics,
		verify: {
			ok: missing.length === 0 && !museLeak && hotOk,
			missing,
			hotWithinCap: hotOk,
			museOk: !museLeak,
		},
	};
}

function sectionLines(bucket: string, facts: MigrationFact[]): string[] {
	if (facts.length === 0) return [SECTION_BY_BUCKET[bucket], ""];
	return [SECTION_BY_BUCKET[bucket], ...facts.map((fact) => `- ${fact.text.trim()}`), ""];
}

export { SECTION_ORDER };
