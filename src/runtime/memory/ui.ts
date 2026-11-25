/**
 * The projection the interface reads. MEMORY.md is the truth on disk; the
 * projection is a read-only copy that the UI consumes. Nothing is ever read
 * back out of the projection as if it were authoritative.
 */

import fs from "node:fs";
import path from "node:path";

import { estimateTokens, injectionCap, memoryTier, type MemoryPaths, type MemoryTierName } from "./file.js";
import { MEMORY_TOOLS_LINE, selectPrompt } from "./prompt.js";
import { listDailyNotes } from "./daily.js";
import type { DreamSummary } from "./dream.js";

export const PROJECTION_VERSION = 3;

export interface MemoryUiSearchFact {
	id: string;
	text: string;
	rank: number;
	arms: string[];
	raised: string[];
	lowered: string[];
	superseded: boolean;
}

export interface MemoryUiSearch {
	query: string;
	at: string;
	facts: MemoryUiSearchFact[];
	arms: { arm: string; status: string; reason: string; candidates: number }[];
	interval: null;
	history: boolean;
}

export interface MemoryUiHotSection {
	name: string;
	body: string;
}

export interface MemoryUiHot {
	text: string;
	tokens: number;
	sections: MemoryUiHotSection[];
	skippedProtected: string[];
}

export interface MemoryUiNoteLink {
	target: string;
	label: string;
}

export interface MemoryUiNoteGroup {
	heading: string;
	facts: string[];
	links: MemoryUiNoteLink[];
}

export interface MemoryUiNote {
	path: string;
	name: string;
	description: string;
	groups: MemoryUiNoteGroup[];
}

export interface MemoryUiTimelineEntry {
	id: string;
	text: string;
	kind: "memory";
	subject: string;
	predicate: string;
	object: null;
	validFrom: string;
	validUntil: null;
	recordedAt: string;
	confidence: number;
	superseded: boolean;
	retracted: boolean;
	quote: null;
	source: string;
	sessionId: null;
	tags: string[];
	recordedLabel: string;
	status: string;
}

export interface MemoryUiDaily {
	path: string;
	date: string;
	label: string;
	header: string;
	entries: { time: string; text: string }[];
}

export interface MemoryUiDream {
	id: string;
	startedAt: string;
	model: string;
	status: string;
	created: number;
	retracted: number;
	merged: number;
	conflicts: number;
}

export interface MemoryUiProjection {
	version: number;
	generatedAt: string;
	/** The injection cap of the selected tier, in estimated tokens. */
	budget: number;
	/** The tier the injection was selected for. */
	tier: MemoryTierName;
	status: {
		facts: number;
		history: number;
		notes: number;
		lastRenderedAt: string | null;
		lastDreamAt: string | null;
		/** Estimated tokens of the whole MEMORY.md file. */
		estimatedTokens: number;
		/** Estimated tokens actually injected for the selected tier. Never above `budget`. */
		injectedTokens: number;
		embedding: { available: boolean; model: string | null; reason: string };
	};
	hot: MemoryUiHot;
	index: string;
	notes: MemoryUiNote[];
	daily: MemoryUiDaily[];
	timeline: MemoryUiTimelineEntry[];
	dreams: MemoryUiDream[];
	search: MemoryUiSearch | null;
	command: null;
}

function splitSections(markdown: string): MemoryUiHotSection[] {
	const lines = String(markdown ?? "").split(/\r?\n/);
	const sections: { name: string; body: string[] }[] = [];
	let current: { name: string; body: string[] } | null = null;
	for (const raw of lines) {
		const heading = /^##\s+(.+)$/.exec(raw.trim());
		if (heading) {
			if (current) sections.push({ name: current.name, body: current.body });
			current = { name: heading[1].trim(), body: [] };
			continue;
		}
		if (current) current.body.push(raw);
	}
	if (current) sections.push({ name: current.name, body: current.body });
	return sections.map((s) => ({ name: s.name, body: s.body.join("\n").trim() }));
}

function notesFromTopics(topicsDir: string, paths: MemoryPaths): MemoryUiNote[] {
	const out: MemoryUiNote[] = [];
	let names: string[] = [];
	try {
		names = fs.readdirSync(topicsDir).filter((n) => n.endsWith(".md"));
	} catch {
		return out;
	}
	for (const name of names) {
		const text = (() => {
			try {
				return fs.readFileSync(path.join(topicsDir, name), "utf-8");
			} catch {
				return "";
			}
		})();
		const first = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? name;
		const splits: MemoryUiNoteGroup[] = [];
		const heading = /^##\s+(.+)$/;
		const lines = text.split(/\r?\n/);
		let groupName = "Notes";
		let buffer: string[] = [];
		const flush = () => {
			const facts = buffer.filter((l) => /^\s*-\s+/.test(l)).map((l) => l.replace(/^\s*-\s+/, "").trim()).filter(Boolean);
			const links = buffer.flatMap((l) => Array.from(l.matchAll(/\[([^\]]+)\]\(topics\/([^)]+)\)/g)).map((m) => ({ label: m[1], target: m[2] })));
			if (facts.length || links.length) splits.push({ heading: groupName, facts, links });
			buffer = [];
		};
		for (const raw of lines) {
			const match = heading.exec(raw.trim());
			if (match) { flush(); groupName = match[1].trim(); continue; }
			buffer.push(raw);
		}
		flush();
		out.push({
			path: `topics/${name}`,
			name: name.replace(/\.md$/, ""),
			description: first.replace(/^#\s+/, "").slice(0, 140),
			groups: splits,
		});
	}
	return out;
}

function hotTimeline(hot: string): MemoryUiTimelineEntry[] {
	const out: MemoryUiTimelineEntry[] = [];
	String(hot ?? "")
		.split(/\r?\n/)
		.forEach((raw, index) => {
			const m = /^\s*-\s+(.*\S)\s*$/.exec(raw);
			if (!m) return;
			out.push({
				id: `m${index}`,
				text: m[1].trim(),
				kind: "memory",
				subject: "person:user",
				predicate: "stated",
				object: null,
				validFrom: new Date().toISOString(),
				validUntil: null,
				recordedAt: new Date().toISOString(),
				confidence: 1,
				superseded: false,
				retracted: false,
				quote: null,
				source: "memory",
				sessionId: null,
				tags: [],
				recordedLabel: "memory",
				status: "current",
			});
		});
	return out;
}

export interface ProjectionOptions {
	paths: MemoryPaths;
	search: MemoryUiSearch | null;
	dreams: DreamSummary[];
	tier?: string | null;
	lastRenderedAt?: string | null;
}

export function buildProjection(options: ProjectionOptions): MemoryUiProjection {
	const { paths, dreams } = options;
	const tier = memoryTier(options.tier ?? null);
	const budget = injectionCap(tier);
	const hot = (() => {
		try {
			return fs.readFileSync(paths.hot, "utf-8");
		} catch {
			return "# Memory\n\n(Nothing yet. Retained conversations will fill this file.)\n";
		}
	})();
	const sections = splitSections(hot);
	const topicsDir = path.join(paths.dir, "topics");
	const notes = notesFromTopics(topicsDir, paths);
	const dailyNotes = listDailyNotes(paths, 14);
	const daily: MemoryUiDaily[] = dailyNotes.map((note) => ({
		path: note.path,
		date: note.date,
		label: note.date,
		header: note.header,
		entries: note.entries.map((entry) => ({ time: "", text: entry })),
	}));
	const timeline = hotTimeline(hot);
	const timelineCount = timeline.length;
	const state = (() => {
		try {
			return JSON.parse(fs.readFileSync(path.join(paths.dir, "state.json"), "utf-8")) as { lastDreamAt?: string | null };
		} catch {
			return {} as { lastDreamAt?: string | null };
		}
	})();
	const hotTokens = estimateTokens(hot);
	const selection = selectPrompt(hot, { budget, toolsLine: MEMORY_TOOLS_LINE });
	const dreamsOut: MemoryUiDream[] = dreams.map((dream) => {
		const added = dream.changelog.filter((l) => /^Added:/i.test(l)).length;
		const changed = dream.changelog.filter((l) => /^Changed:/i.test(l)).length;
		const removed = dream.changelog.filter((l) => /^Removed:/i.test(l)).length;
		return {
			id: dream.id,
			startedAt: dream.startedAt,
			model: dream.model,
			status: dream.status,
			created: added,
			retracted: removed,
			merged: changed,
			conflicts: 0,
		};
	});
	return {
		version: PROJECTION_VERSION,
		generatedAt: new Date().toISOString(),
		budget,
		tier,
		status: {
			facts: timelineCount,
			history: 0,
			notes: notes.length,
			lastRenderedAt: options.lastRenderedAt ?? null,
			lastDreamAt: state.lastDreamAt ?? null,
			estimatedTokens: hotTokens,
			injectedTokens: selection.tokens,
			embedding: { available: false, model: null, reason: "semantic arm removed; search is lexical over the files" },
		},
		hot: { text: hot, tokens: hotTokens, sections, skippedProtected: [] },
		index: "",
		notes,
		daily,
		timeline,
		dreams: dreamsOut,
		search: options.search,
		command: null,
	};
}
