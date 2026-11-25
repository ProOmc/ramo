/**
 * The file-backed memory subsystem's storage layer.
 *
 * MEMORY.md is the source of truth: one prose file, kept small. The daily
 * notes are the raw input (one file per day, prose entries). Detail lives in
 * `topics/*.md`, written by the nightly dream without asking, and never
 * injected wholesale into a prompt.
 *
 * One code-level invariant is kept on purpose: nothing is ever silently
 * lost. Every write keeps a dated copy (`history/MEMORY-<date>.md`) and a
 * git commit, so rollback is `git revert` and the audit trail is `git log`.
 * The second invariant is that secrets are never recorded — a credential is
 * removed and reported, never written.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { Bm25Index, tokenise } from "./tokenise.js";

export const SECTION_ORDER = [
	"## About you",
	"## Facts",
	"## Preferences",
	"## Commitments",
	"## Projects",
	"## Notes about Muse",
] as const;

/**
 * Memory size tiers.
 *
 * The tier is an explicit property of the model profile, never derived from the
 * context window: the desktop declares one context for both Fast and Smart, so
 * a context-derived tier would collapse them into the same budget.
 *
 * `target` is what the dreamer aims at. `max` is the hard cap the injection is
 * held to; a dream replacement above it is refused and the previous file kept.
 */
export type MemoryTierName = "fast" | "standard" | "deep";

export interface MemoryTierBudget {
	target: number;
	max: number;
}

export const MEMORY_TIERS: Record<MemoryTierName, MemoryTierBudget> = {
	fast: { target: 1000, max: 1500 },
	standard: { target: 1500, max: 2000 },
	deep: { target: 6000, max: 8000 },
};

/** The standard tier's numbers, kept for existing imports. */
export const DEFAULT_HOT_TOKENS = MEMORY_TIERS.standard.target;
export const MAX_HOT_TOKENS = MEMORY_TIERS.standard.max;

/** Normalise a profile's `memoryTier`; anything unknown falls back to standard. */
export function memoryTier(value: unknown): MemoryTierName {
	const text = String(value ?? "").trim().toLowerCase();
	return text === "fast" || text === "deep" || text === "standard" ? text : "standard";
}

export interface MemoryPaths {
	dir: string;
	hot: string;
	daily: string;
	topics: string;
	dreams: string;
	history: string;
	quarantine: string;
	inbox: string;
	ui: string;
	/** Dream intermediates (merged/compressed drafts). Never injected. */
	staging: string;
}

export function memoryPaths(dir: string): MemoryPaths {
	return {
		dir,
		hot: path.join(dir, "MEMORY.md"),
		daily: path.join(dir, "notes", "daily"),
		topics: path.join(dir, "topics"),
		dreams: path.join(dir, "dreams"),
		history: path.join(dir, "history"),
		quarantine: path.join(dir, "quarantine"),
		inbox: path.join(dir, "inbox"),
		ui: path.join(dir, "ui.json"),
		staging: path.join(dir, "staging"),
	};
}

export function ensureLayout(dir: string): void {
	for (const sub of ["notes", "notes/daily", "topics", "dreams", "history", "quarantine", "inbox", "staging"]) {
		fs.mkdirSync(path.join(dir, sub), { recursive: true });
	}
	const gitMarker = path.join(dir, ".git");
	if (!fs.existsSync(gitMarker)) {
		try {
			execFileSync("git", ["init", "-q", dir], { stdio: "ignore", windowsHide: true });
			execFileSync("git", ["-C", dir, "config", "user.name", "Ramo Memory"], { stdio: "ignore", windowsHide: true });
			execFileSync("git", ["-C", dir, "config", "user.email", "ramo-memory@localhost"], { stdio: "ignore", windowsHide: true });
			writeGitIgnore(dir);
			execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore", windowsHide: true });
			execFileSync("git", ["-C", dir, "commit", "-q", "-m", "memory: initial layout"], { stdio: "ignore", windowsHide: true });
		} catch {
			// No git available: the dated `history/` copies still guarantee rollback.
		}
	}
}

function writeGitIgnore(dir: string): void {
	const file = path.join(dir, ".gitignore");
	const keep = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
	const needed = ["inbox/", "ui.json", "staging/", ".gitignore"];
	const missing = needed.filter((entry) => !keep.split(/\r?\n/).includes(entry));
	if (missing.length) {
		try {
			fs.writeFileSync(file, `${keep}${keep.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`);
		} catch {
			// Best effort; the history
		}
	}
}

function git(dir: string, args: string[]): string | null {
	try {
		return String(execFileSync("git", ["-C", dir, ...args], { windowsHide: true, timeout: 20000 }));
	} catch {
		return null;
	}
}

export function gitCommit(dir: string, message: string): string | null {
	git(dir, ["add", "-A"]);
	const status = git(dir, ["status", "--porcelain"]);
	if (status !== null && status.trim().length === 0) return git(dir, ["rev-parse", "HEAD"]);
	git(dir, ["commit", "-q", "-m", message]);
	return git(dir, ["rev-parse", "HEAD"]);
}

export function gitLog(dir: string, limit = 10): { hash: string; message: string }[] {
	const raw = git(dir, ["log", `--max-count=${limit}`, "--format=%H%x00%s"]);
	if (!raw) return [];
	return raw.split(/\r?\n/).filter(Boolean).map((line) => {
		const [hash, message] = line.split("\0");
		return { hash: String(hash ?? "").slice(0, 12), message: String(message ?? "") };
	});
}

export function gitRevert(dir: string, commit: string): boolean {
	return git(dir, ["revert", "--no-edit", commit]) !== null;
}

/** Estimate tokens for prose, without pulling in a tokenizer. Chars-per-token 4.0. */
export function estimateTokens(text: string): number {
	const cleaned = String(text ?? "").replace(/\s+/g, " ").trim();
	if (!cleaned) return 0;
	return Math.ceil(cleaned.length / 4);
}

/** The dreamer's aim for a tier, in estimated tokens. */
export function hotBudget(tier: unknown = "standard"): number {
	return MEMORY_TIERS[memoryTier(tier)].target;
}

/** The hard cap the injected memory is held to, in estimated tokens. */
export function injectionCap(tier: unknown = "standard"): number {
	return MEMORY_TIERS[memoryTier(tier)].max;
}

export function readFileSafe(file: string): string | null {
	try {
		return fs.readFileSync(file, "utf-8");
	} catch {
		return null;
	}
}

export function writeAtomic(file: string, content: string): void {
	const dir = path.dirname(file);
	fs.mkdirSync(dir, { recursive: true });
	const tmp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}-${Date.now().toString(36)}`);
	fs.writeFileSync(tmp, content, "utf-8");
	for (let attempt = 0; attempt < 10; attempt += 1) {
		try {
			fs.renameSync(tmp, file);
			return;
		} catch {
			try {
				fs.copyFileSync(tmp, file);
				fs.rmSync(tmp, { force: true });
				return;
			} catch {
				// Windows may hold a handle to the destination open.
			}
			const until = Date.now() + 40;
			while (Date.now() < until) { /* small spin */ }
		}
	}
	throw new Error(`could not write ${file}`);
}

/** Keep the pre-change hot file for rollback. One copy per file per day. */
export function backupHot(dir: string, hotPath: string, when = new Date()): string | null {
	const current = readFileSafe(hotPath);
	if (current === null) return null;
	const day = dayOf(when);
	const target = path.join(dir, "history", `MEMORY-${day}.md`);
	try {
		fs.mkdirSync(path.join(dir, "history"), { recursive: true });
		fs.writeFileSync(target, current);
		return target;
	} catch {
		return null;
	}
}

export function dayOf(when = new Date()): string {
	const d = when instanceof Date && !Number.isNaN(when.getTime()) ? when : new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function dailyPath(dir: string, day = dayOf()): string {
	return path.join(dir, "notes", "daily", `${day}.md`);
}

export function readDailySince(dir: string, sinceIso: string | null, cap = 3): { day: string; content: string }[] {
	const out: { day: string; content: string }[] = [];
	let names: string[] = [];
	try {
		names = fs.readdirSync(path.join(dir, "notes", "daily")).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name)).sort();
	} catch {
		return out;
	}
	const since = sinceIso ? Date.parse(sinceIso) : 0;
	for (const name of names) {
		const content = readFileSafe(path.join(dir, "notes", "daily", name));
		if (content === null) continue;
		const stamp = Date.parse(`${name.slice(0, 10)}T00:00:00Z`);
		if (since > 0 && stamp < since - 86_400_000) continue;
		out.push({ day: name.slice(0, 10), content });
		if (out.length >= cap) break;
	}
	return out;
}

/** Append one prose entry (bullet line) to today's daily note. */
export function appendDailyEntry(dir: string, entry: string, when = new Date()): void {
	const file = dailyPath(dir, dayOf(when));
	const line = `- ${dayOf(when)} ${timeOf(when)} ${entry.trim()}\n`;
	fs.mkdirSync(path.dirname(file), { recursive: true });
	let header = "";
	if (!fs.existsSync(file) || fs.readFileSync(file, "utf-8").length === 0) {
		header = `# Daily note — ${dayOf(when)}\n\nRaw retention and changes for this day. Not injected wholesale into any prompt; the nightly dream reads it.\n\n`;
	}
	fs.appendFileSync(file, header + line);
}

export function timeOf(when = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(when.getUTCHours())}:${pad(when.getUTCMinutes())}Z`;
}

/** Look for credential-like strings anywhere in prose. Never written. */
export function findSecret(text: string): string | null {
	const patterns: { name: string; re: RegExp }[] = [
		{ name: "OpenAI key", re: /sk-[A-Za-z0-9_-]{20,}/ },
		{ name: "AWS access key", re: /AKIA[0-9A-Z]{16}/ },
		{ name: "Google API key", re: /AIza[0-9A-Za-z_-]{30,}/ },
		{ name: "GitHub token", re: /gh[pousr]_[A-Za-z0-9]{30,}/ },
		{ name: "private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
		{ name: "Slack token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
	];
	for (const { name, re } of patterns) {
		if (re.test(text)) return name;
	}
	return null;
}

export interface SearchHit {
	path: string;
	line: string;
	lineNumber: number;
	score: number;
	contextStart: number;
	contextEnd: number;
}

/**
 * Lexical search over the markdown files.
 *
 * The arm is line-granular on purpose: BM25 over whole bullets is what makes an
 * exact number or threshold findable, and the memory file is dense with both.
 * Every line with at least one token becomes one BM25 document; a hit is mapped
 * back to its file and line so the caller keeps `file:line` provenance.
 */
export function searchMarkdown(dir: string, query: string, limit = 12): SearchHit[] {
	const files: { path: string; text: string }[] = [];
	const hot = readFileSafe(path.join(dir, "MEMORY.md"));
	if (hot) files.push({ path: "MEMORY.md", text: hot });
	collect(dir, "topics", files);
	collect(dir, "notes", files);
	const documents: {
		id: string;
		text: string;
		path: string;
		line: string;
		lineNumber: number;
		totalLines: number;
	}[] = [];
	for (const entry of files) {
		const lines = entry.text.split(/\r?\n/);
		for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
			const line = lines[lineIndex];
			if (tokenise(line).length === 0) continue;
			documents.push({
				id: `${entry.path}:${lineIndex + 1}`,
				text: line,
				path: entry.path,
				line,
				lineNumber: lineIndex + 1,
				totalLines: lines.length,
			});
		}
	}
	if (documents.length === 0) return [];
	const index = new Bm25Index(documents);
	const byId = new Map(documents.map((document) => [document.id, document]));
	return index.search(query, limit).map(({ id, score }) => {
		const document = byId.get(id);
		if (!document) return null;
		return {
			path: document.path,
			line: document.line,
			lineNumber: document.lineNumber,
			score,
			contextStart: Math.max(0, document.lineNumber - 2),
			contextEnd: Math.min(document.totalLines - 1, document.lineNumber),
		};
	}).filter((hit): hit is SearchHit => hit !== null);
}

function collect(dir: string, sub: string, files: { path: string; text: string }[]): void {
	const target = path.join(dir, sub);
	try {
		for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
			const full = path.join(target, entry.name);
			if (entry.isDirectory()) {
				collect(dir, path.join(sub, entry.name), files);
				continue;
			}
			if (entry.isFile() && entry.name.endsWith(".md")) {
				const text = readFileSafe(full);
				if (text) files.push({ path: path.join(sub, entry.name).split(path.sep).join("/"), text });
			}
		}
	} catch {
		/* absent directory */
	}
}

/** Count of bullet-like lines for UI stats. */
export function countBullets(markdown: string): number {
	return String(markdown ?? "")
		.split(/\r?\n/)
		.filter((line) => /^\s*[-*]\s+\S/.test(line)).length;
}
