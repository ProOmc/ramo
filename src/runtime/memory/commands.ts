/**
 * The interface's command inbox.
 *
 * The renderer cannot write the store — it is sandboxed, and the store's
 * format belongs to the worker — and the worker-to-parent protocol is a fixed
 * boundary that gains no methods for this. So the interface sends commands as
 * files: the native host moves a file into the inbox and the worker applies
 * it. The host never interprets a command and never writes a fact; the worker
 * is the only executor and the only writer.
 *
 * A command file is written atomically, so the worker never reads half of
 * one. Once a command has been applied its file is renamed with a `.done`
 * suffix and the outcome is recorded beside it, so a command is applied once
 * even if the worker is restarted between the write and the read.
 */

import fs from "node:fs";
import path from "node:path";

export type MemoryCommandAction =
	| "edit-fact"
	| "add-fact"
	| "forget-fact"
	| "write-hot"
	| "dream"
	| "revert-dream"
	| "search";

export interface MemoryCommand {
	id: string;
	action: MemoryCommandAction;
	/** The fact an edit or a forget refers to. */
	factId?: string;
	/** The text a fact edit finds, or an added fact records, or a forget removes. */
	text?: string;
	/** The replacement text for an edit. */
	replace?: string;
	/** The whole file a `write-hot` command saves. */
	content?: string;
	/** The kind of an added fact. */
	kind?: string;
	/** The subject of an added fact. */
	subject?: string;
	/** Why a fact was forgotten. */
	reason?: string;
	/** The dream to revert. */
	dreamId?: string;
	/** The query of a search. */
	query?: string;
}

export interface MemoryCommandOutcome {
	id: string;
	action: string;
	ok: boolean;
	reason: string;
	at: string;
}

/** The inbox directory, beside the store's other files. */
export function inboxDir(memoryDir: string): string {
	return path.join(memoryDir, "inbox");
}

/** The file a command waits in. */
export function commandFile(memoryDir: string, id: string): string {
	return path.join(inboxDir(memoryDir), `${id}.json`);
}

/** The file a command's outcome is recorded in. */
export function outcomeFile(memoryDir: string, id: string): string {
	return path.join(inboxDir(memoryDir), `${id}.done.json`);
}

/**
 * Write a command into the inbox.
 *
 * The file is written under a temporary name and renamed, so a watcher never
 * sees a partial command.
 */
export function writeCommand(memoryDir: string, command: MemoryCommand): string {
	const dir = inboxDir(memoryDir);
	fs.mkdirSync(dir, { recursive: true });
	const target = commandFile(memoryDir, command.id);
	const temporary = `${target}.${process.pid}.tmp`;
	fs.writeFileSync(temporary, `${JSON.stringify(command)}\n`, "utf-8");
	fs.renameSync(temporary, target);
	return target;
}

/** Record a command's outcome and retire the command. */
export function writeOutcome(memoryDir: string, outcome: MemoryCommandOutcome): void {
	const dir = inboxDir(memoryDir);
	fs.mkdirSync(dir, { recursive: true });
	const target = outcomeFile(memoryDir, outcome.id);
	const temporary = `${target}.${process.pid}.tmp`;
	fs.writeFileSync(temporary, `${JSON.stringify(outcome)}\n`, "utf-8");
	fs.renameSync(temporary, target);
	try {
		fs.rmSync(commandFile(memoryDir, outcome.id), { force: true });
	} catch {
		// The command file is already gone, which is the state we wanted.
	}
}

/**
 * The commands waiting to be applied, oldest first.
 *
 * A command whose outcome is already recorded is skipped, so a restart does
 * not apply it twice.
 */
export function pendingCommands(memoryDir: string): MemoryCommand[] {
	let names: string[];
	try {
		names = fs.readdirSync(inboxDir(memoryDir));
	} catch {
		return [];
	}
	const commands: MemoryCommand[] = [];
	for (const name of names.sort()) {
		if (!name.endsWith(".json") || name.endsWith(".done.json")) continue;
		const id = name.slice(0, -".json".length);
		if (fs.existsSync(outcomeFile(memoryDir, id))) {
			try {
				fs.rmSync(path.join(inboxDir(memoryDir), name), { force: true });
			} catch {
				// Leaving it behind is harmless: it is skipped on every read.
			}
			continue;
		}
		try {
			const parsed = JSON.parse(fs.readFileSync(path.join(inboxDir(memoryDir), name), "utf-8")) as MemoryCommand;
			if (!parsed || typeof parsed.id !== "string" || typeof parsed.action !== "string") continue;
			commands.push({ ...parsed, id });
		} catch {
			// A command that cannot be read is left alone; the next pass may
			// find it complete, and a broken command never blocks the others.
		}
	}
	return commands;
}
