/**
 * Ramo session store.
 *
 * Owns the on-disk session format: an append-only JSON Lines file where every
 * entry carries an id and a parent id, so the session is a tree rather than a
 * single list. Branching, forking, navigating the tree and exporting all read
 * from that tree.
 *
 * Derived from Pi 1.4.0 (`third_party/pi/packages/coding-agent/src/core/session-manager.ts`,
 * MIT licensed, Copyright (c) 2025 Mario Zechner). The entry vocabulary is the
 * same, so a session written by either implementation stays readable, but this is
 * Ramo's own implementation with Ramo's own types.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { TranscriptMessage, Usage } from "./types.js";

/** The version written into new session headers. */
export const CURRENT_SESSION_VERSION = 3;

export interface SessionHeader {
	type: "session";
	version?: number;
	id: string;
	timestamp: string;
	cwd: string;
	parentSession?: string;
}

interface SessionEntryBase {
	id: string;
	parentId: string | null;
	timestamp: string;
}

export interface MessageEntry extends SessionEntryBase {
	type: "message";
	message: TranscriptMessage;
}

export interface CompactionEntry extends SessionEntryBase {
	type: "compaction";
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	estimatedTokensAfter?: number;
	usage?: Usage;
}

export interface SessionInfoEntry extends SessionEntryBase {
	type: "session_info";
	name?: string;
}

export interface LabelEntry extends SessionEntryBase {
	type: "label";
	targetId: string;
	label?: string;
}

export interface ModelChangeEntry extends SessionEntryBase {
	type: "model_change";
	provider: string;
	modelId: string;
}

export interface ThinkingLevelChangeEntry extends SessionEntryBase {
	type: "thinking_level_change";
	thinkingLevel: string;
}

export interface CustomEntry extends SessionEntryBase {
	type: "custom";
	customType: string;
	data?: unknown;
}

export interface BranchSummaryEntry extends SessionEntryBase {
	type: "branch_summary";
	fromId: string;
	summary: string;
}

export type SessionEntry =
	| MessageEntry
	| CompactionEntry
	| SessionInfoEntry
	| LabelEntry
	| ModelChangeEntry
	| ThinkingLevelChangeEntry
	| CustomEntry
	| BranchSummaryEntry;

/**
 * Omit over a union, applied to each member.
 *
 * A plain `Omit` on a union collapses it to the common keys, which would drop the
 * payload of every entry type that carries something unique.
 */
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

/** An entry before the store fills in its identity and position. */
export type SessionEntryDraft = DistributiveOmit<SessionEntry, "id" | "parentId" | "timestamp">;

export type SessionFileEntry = SessionHeader | SessionEntry;

/** One node of the session tree. */
export interface SessionTreeNode {
	entry: SessionEntry;
	children: SessionTreeNode[];
	label?: string;
}

/** A session as the interface lists it. */
export interface SessionSummary {
	path: string;
	id: string;
	cwd: string;
	name?: string;
	parentSessionPath?: string;
	created: Date;
	modified: Date;
	messageCount: number;
	firstMessage?: string;
}

function newId(): string {
	return crypto.randomUUID();
}

function now(): string {
	return new Date().toISOString();
}

/** The file name of a session, sortable by creation time. */
export function sessionFileName(id: string, timestamp = new Date()): string {
	const stamp = timestamp.toISOString().replace(/:/g, "-").replace(/\./g, "-");
	return `${stamp}_${id}.jsonl`;
}

/**
 * An append-only session file.
 *
 * The whole file is read into memory and written back as a whole. Sessions are
 * small enough for that, and it keeps the tree consistent even when a branch is
 * rewritten.
 */
export class SessionStore {
	readonly path: string;
	readonly id: string;
	readonly cwd: string;
	private header: SessionHeader;
	private entries: SessionEntry[] = [];
	/**
	 * The entry the current branch ends at.
	 *
	 * Navigating the tree moves this pointer; new entries are appended after it,
	 * so a branch continues where the user left it.
	 */
	private currentLeafId: string | undefined;

	private constructor(path: string, header: SessionHeader, entries: SessionEntry[]) {
		this.path = path;
		this.header = header;
		this.entries = entries;
		this.id = header.id;
		this.cwd = header.cwd;
	}

	/** Create a new session file. */
	static create(directory: string, cwd: string, options: { id?: string; parentSession?: string } = {}): SessionStore {
		fs.mkdirSync(directory, { recursive: true });
		const id = options.id ?? newId();
		const created = new Date();
		const header: SessionHeader = {
			type: "session",
			version: CURRENT_SESSION_VERSION,
			id,
			timestamp: created.toISOString(),
			cwd,
			...(options.parentSession ? { parentSession: options.parentSession } : {}),
		};
		const store = new SessionStore(path.join(directory, sessionFileName(id, created)), header, []);
		store.flush();
		return store;
	}

	/** Open an existing session file. */
	static open(file: string): SessionStore {
		const raw = fs.readFileSync(file, "utf-8");
		const lines = raw.split(/\r?\n/).filter((line) => line.trim());
		if (lines.length === 0) throw new Error("Session file is empty");
		const header = JSON.parse(lines[0]) as SessionHeader;
		if (header.type !== "session") throw new Error("Expected a session header");
		const entries: SessionEntry[] = [];
		for (const line of lines.slice(1)) {
			const entry = JSON.parse(line) as SessionEntry;
			if (entry && typeof entry.id === "string") entries.push(entry);
		}
		return new SessionStore(file, header, entries);
	}

	/** Find a session by id inside a directory. */
	static findById(directory: string, id: string): string | undefined {
		let files: string[];
		try {
			files = fs.readdirSync(directory).filter((name) => name.endsWith(".jsonl"));
		} catch {
			return undefined;
		}
		for (const name of files) {
			const file = path.join(directory, name);
			try {
				const header = JSON.parse(fs.readFileSync(file, "utf-8").split(/\r?\n/, 1)[0] ?? "") as SessionHeader;
				if (header.type === "session" && header.id === id) return file;
			} catch {
				// Skip files that are not readable sessions.
			}
		}
		return undefined;
	}

	/** List the sessions in a directory, newest first. */
	static list(directory: string, cwd?: string): SessionSummary[] {
		let files: string[];
		try {
			files = fs.readdirSync(directory).filter((name) => name.endsWith(".jsonl"));
		} catch {
			return [];
		}
		const sessions: SessionSummary[] = [];
		for (const name of files) {
			const file = path.join(directory, name);
			try {
				const store = SessionStore.open(file);
				if (cwd && store.cwd !== cwd) continue;
				const summary = store.summary();
				const first = store.branchMessages().find((message) => message.role === "user");
				sessions.push({
					...summary,
					firstMessage: first ? textOf(first) : undefined,
				});
			} catch {
				// Skip unreadable sessions.
			}
		}
		return sessions.sort((left, right) => right.created.getTime() - left.created.getTime());
	}

	/** A summary of this session. */
	summary(): SessionSummary {
		const created = new Date(this.header.timestamp);
		let modified = created;
		let messageCount = 0;
		for (const entry of this.entries) {
			const time = new Date(entry.timestamp);
			if (time > modified) modified = time;
			if (entry.type === "message") messageCount++;
		}
		return {
			path: this.path,
			id: this.id,
			cwd: this.cwd,
			parentSessionPath: this.header.parentSession,
			created,
			modified,
			messageCount,
		};
	}

	/** Every entry in the file. */
	allEntries(): SessionEntry[] {
		return [...this.entries];
	}

	/** The id of the last entry on the current branch. */
	leafId(): string | undefined {
		const branch = this.branchEntries();
		return branch[branch.length - 1]?.id;
	}

	/**
	 * Move the current branch to another entry.
	 *
	 * The entry must exist. Everything after it stays in the file, so the user
	 * can navigate back to it.
	 */
	setLeaf(entryId: string): void {
		if (!this.entries.some((entry) => entry.id === entryId)) throw new Error("The session entry was not found");
		this.currentLeafId = entryId;
	}

	/** Rewind the branch to its root, before any entry was recorded. */
	resetLeaf(): void {
		this.currentLeafId = "";
	}

	/** The entry the current branch ends at. */
	currentLeaf(): string | undefined {
		return this.currentLeafId;
	}

	/**
	 * The entries from the root to the given leaf.
	 *
	 * The tree is walked from the leaf through its parents, then reversed.
	 */
	branchEntries(leafId?: string): SessionEntry[] {
		const byId = new Map(this.entries.map((entry) => [entry.id, entry]));
		const target = leafId ?? this.currentLeafId;
		let current = target === "" ? undefined : target ? byId.get(target) : this.entries[this.entries.length - 1];
		const branch: SessionEntry[] = [];
		const seen = new Set<string>();
		while (current && !seen.has(current.id)) {
			seen.add(current.id);
			branch.push(current);
			current = current.parentId ? byId.get(current.parentId) : undefined;
		}
		return branch.reverse();
	}

	/** The messages of the current branch, without the compaction records. */
	branchMessages(leafId?: string): TranscriptMessage[] {
		return this.branchEntries(leafId)
			.filter((entry): entry is MessageEntry => entry.type === "message")
			.map((entry) => entry.message);
	}

	/** The compaction records on the current branch. */
	branchCompactions(leafId?: string): CompactionEntry[] {
		return this.branchEntries(leafId).filter((entry): entry is CompactionEntry => entry.type === "compaction");
	}

	/** The session tree, for the interface's tree view. */
	tree(): SessionTreeNode[] {
		const byParent = new Map<string | null, SessionEntry[]>();
		for (const entry of this.entries) {
			const list = byParent.get(entry.parentId) ?? [];
			list.push(entry);
			byParent.set(entry.parentId, list);
		}
		const labels = new Map<string, string>();
		for (const entry of this.entries) {
			if (entry.type === "label" && entry.label) labels.set(entry.targetId, entry.label);
		}
		const build = (parentId: string | null): SessionTreeNode[] =>
			(byParent.get(parentId) ?? []).map((entry) => ({
				entry,
				children: build(entry.id),
				...(labels.has(entry.id) ? { label: labels.get(entry.id) } : {}),
			}));
		return build(null);
	}

	/** Append an entry to the current branch. */
	append(entry: SessionEntryDraft & { id?: string; parentId?: string | null }): SessionEntry {
		const complete = {
			...entry,
			id: entry.id ?? newId(),
			parentId: entry.parentId === undefined ? (this.leafId() ?? null) : entry.parentId,
			timestamp: now(),
		} as SessionEntry;
		this.entries.push(complete);
		this.currentLeafId = complete.id;
		this.flush();
		return complete;
	}

	/** Append a message to the current branch. */
	appendMessage(message: TranscriptMessage, parentId?: string | null): MessageEntry {
		return this.append({ type: "message", message, ...(parentId === undefined ? {} : { parentId }) }) as MessageEntry;
	}

	/** Record a compaction. */
	appendCompaction(
		compaction: { summary: string; firstKeptEntryId: string; tokensBefore: number; estimatedTokensAfter?: number; usage?: Usage },
		parentId?: string | null,
	): CompactionEntry {
		return this.append({ type: "compaction", ...compaction, ...(parentId === undefined ? {} : { parentId }) }) as CompactionEntry;
	}

	/** Remove one entry (used when its recorded undo is consumed). */
	removeEntry(entryId: string): void {
		this.entries = this.entries.filter((entry) => entry.id !== entryId);
		if (this.currentLeafId === entryId) this.currentLeafId = undefined;
		this.flush();
	}

	/** Set the display name of the session. */
	setName(name: string): void {
		this.append({ type: "session_info", name });
	}

	/** The display name of the session, if one was set. */
	name(): string | undefined {
		for (let index = this.entries.length - 1; index >= 0; index--) {
			const entry = this.entries[index];
			if (entry.type === "session_info") return entry.name;
		}
		return undefined;
	}

	/**
	 * Create a branched copy of this session.
	 *
	 * The copy holds every entry up to the branch point, so the new session can
	 * continue from there without touching the original.
	 */
	createBranch(entryId?: string): SessionStore {
		const branch = this.branchEntries(entryId);
		const header: SessionHeader = {
			type: "session",
			version: CURRENT_SESSION_VERSION,
			id: newId(),
			timestamp: now(),
			cwd: this.cwd,
			parentSession: this.path,
		};
		const directory = path.dirname(this.path);
		const store = new SessionStore(path.join(directory, sessionFileName(header.id)), header, []);
		// Reuse the original ids so the tree of the copy matches the original, and
		// the branch point keeps its parent.
		store.entries = branch.map((entry) => ({ ...entry }));
		store.flush();
		return store;
	}

	/** The whole file as text, one JSON entry per line. */
	export(): string {
		const lines = [JSON.stringify(this.header), ...this.entries.map((entry) => JSON.stringify(entry))];
		return lines.join("\n") + "\n";
	}

	/** Write the file. */
	flush(): void {
		fs.mkdirSync(path.dirname(this.path), { recursive: true });
		const temporary = `${this.path}.tmp`;
		fs.writeFileSync(temporary, this.export(), "utf-8");
		fs.renameSync(temporary, this.path);
	}

	/** Remove the file. */
	remove(): void {
		try {
			fs.unlinkSync(this.path);
		} catch {
			// The file may already be gone.
		}
	}
}

/**
 * Parse an exported session.
 *
 * The parent of every entry must already exist, so a file with a broken tree is
 * rejected instead of loading as a session with missing history.
 */
export function parseSession(text: string): { header: SessionHeader; entries: SessionEntry[] } {
	const lines = text.split(/\r?\n/).filter((line) => line.trim());
	if (lines.length === 0) throw new Error("Expected a session file");
	const header = JSON.parse(lines[0]) as SessionHeader;
	if (header.type !== "session") throw new Error("Expected a session header");
	if (!Array.isArray(lines) || lines.length > 100000) throw new Error("Invalid session entries");
	const entries: SessionEntry[] = [];
	const ids = new Set<string>();
	for (const line of lines.slice(1)) {
		const entry = JSON.parse(line) as SessionEntry;
		if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.type !== "string") {
			throw new Error("Invalid session entries");
		}
		if (typeof entry.id !== "string" || ids.has(entry.id)) throw new Error("Invalid or duplicate session entry ID");
		if (entry.parentId && !ids.has(entry.parentId)) throw new Error("Invalid session parent");
		ids.add(entry.id);
		entries.push(entry);
	}
	return { header, entries };
}

/** Write a parsed session into a directory under a new id. */
export function importSession(directory: string, text: string, cwd: string): string {
	const { header, entries } = parseSession(text);
	const id = newId();
	const created = new Date();
	const newHeader: SessionHeader = {
		type: "session",
		version: CURRENT_SESSION_VERSION,
		id,
		timestamp: created.toISOString(),
		cwd,
		parentSession: header.parentSession,
	};
	fs.mkdirSync(directory, { recursive: true });
	const file = path.join(directory, sessionFileName(id, created));
	const lines = [JSON.stringify(newHeader), ...entries.map((entry) => JSON.stringify(entry))];
	fs.writeFileSync(file, lines.join("\n") + "\n", "utf-8");
	return id;
}

/** The text of a message. */
export function textOf(message: TranscriptMessage): string {
	if (message.role === "user") {
		if (typeof message.content === "string") return message.content;
		return message.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n");
	}
	if (message.role === "assistant") {
		return message.content
			.filter((block): block is { type: "text"; text: string } => block.type === "text")
			.map((block) => block.text)
			.join("");
	}
	if (message.role === "toolResult") {
		return message.content
			.filter((block): block is { type: "text"; text: string } => block.type === "text")
			.map((block) => block.text)
			.join("\n");
	}
	return message.content;
}
