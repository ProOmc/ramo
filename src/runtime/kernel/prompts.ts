/**
 * Prompt templates.
 *
 * A prompt template is a markdown file invoked from the Work composer as
 * `/name arguments`. The file body replaces the command, with bash-style
 * argument substitution:
 *
 *   $1 .. $9        one positional argument
 *   $@, $ARGUMENTS  every argument, joined by spaces
 *   ${N:-default}   a positional argument, or a default when it is empty
 *   ${@:-default}   every argument, or a default when there are none
 *   ${@:N}          arguments from the Nth onwards
 *   ${@:N:L}        L arguments starting at the Nth
 *
 * Templates live in `<agentDir>/prompts/*.md` and, for a trusted project, in
 * `<project>/.pi/prompts/*.md`.
 *
 * Derived from Pi 1.4.0 (`third_party/pi/packages/coding-agent/src/core/prompt-templates.ts`,
 * MIT licensed, Copyright (c) 2025 Mario Zechner). Changes: the source is
 * recorded as `user` or `project` instead of Pi's source-info object, and a
 * name collision keeps the first template and reports it.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import type { ResourceDiagnostic } from "./resources.js";

/** One prompt template. */
export interface PromptTemplate {
	name: string;
	description: string;
	argumentHint?: string;
	content: string;
	filePath: string;
	source: "user" | "project";
}

export interface LoadPromptTemplatesOptions {
	cwd: string;
	agentDir: string;
	trusted: boolean;
}

export interface LoadPromptTemplatesResult {
	templates: PromptTemplate[];
	diagnostics: ResourceDiagnostic[];
}

/** Load the prompt templates of the session. */
export function loadPromptTemplates(options: LoadPromptTemplatesOptions): LoadPromptTemplatesResult {
	const templates = new Map<string, PromptTemplate>();
	const diagnostics: ResourceDiagnostic[] = [];
	const add = (found: LoadPromptTemplatesResult): void => {
		diagnostics.push(...found.diagnostics);
		for (const template of found.templates) {
			const existing = templates.get(template.name);
			if (existing) {
				diagnostics.push({
					type: "collision",
					message: `prompt template name "${template.name}" collision`,
					path: template.filePath,
					collision: {
						resourceType: "prompt",
						name: template.name,
						winnerPath: existing.filePath,
						loserPath: template.filePath,
					},
				});
				continue;
			}
			templates.set(template.name, template);
		}
	};

	add(loadTemplatesFromDir(join(options.agentDir, "prompts"), "user"));
	if (options.trusted) add(loadTemplatesFromDir(resolve(options.cwd, ".pi", "prompts"), "project"));
	return { templates: [...templates.values()], diagnostics };
}

function loadTemplatesFromDir(dir: string, source: "user" | "project"): LoadPromptTemplatesResult {
	const templates: PromptTemplate[] = [];
	const diagnostics: ResourceDiagnostic[] = [];
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return { templates, diagnostics };
	}
	for (const entry of entries) {
		if (entry.name.startsWith(".") || !entry.name.endsWith(".md")) continue;
		const fullPath = join(dir, entry.name);
		try {
			if (!statSync(fullPath).isFile()) continue;
		} catch {
			continue;
		}
		const result = loadTemplateFile(fullPath, source);
		if (result.template) templates.push(result.template);
		diagnostics.push(...result.diagnostics);
	}
	return { templates, diagnostics };
}

function loadTemplateFile(
	filePath: string,
	source: "user" | "project",
): { template: PromptTemplate | null; diagnostics: ResourceDiagnostic[] } {
	const diagnostics: ResourceDiagnostic[] = [];
	let raw: string;
	try {
		raw = readFileSync(filePath, "utf-8");
	} catch (error) {
		diagnostics.push({
			type: "warning",
			message: error instanceof Error ? error.message : "failed to read prompt template file",
			path: filePath,
		});
		return { template: null, diagnostics };
	}

	const { frontmatter, body } = parseFrontmatter(raw);
	const name = basename(filePath).replace(/\.md$/, "");
	let description = typeof frontmatter.description === "string" ? frontmatter.description : "";
	if (!description) {
		const firstLine = body.split("\n").find((line) => line.trim());
		if (firstLine) {
			description = firstLine.slice(0, 60);
			if (firstLine.length > 60) description += "...";
		}
	}
	const argumentHint =
		typeof frontmatter["argument-hint"] === "string" ? frontmatter["argument-hint"] : undefined;
	return {
		template: {
			name,
			description,
			...(argumentHint ? { argumentHint } : {}),
			content: body,
			filePath,
			source,
		},
		diagnostics,
	};
}

/**
 * Parse command arguments, respecting quoted strings (bash-style).
 *
 * A quoted empty string is kept as an argument.
 */
export function parseCommandArgs(argsString: string): string[] {
	const args: string[] = [];
	let current = "";
	let hasToken = false;
	let inQuote: string | null = null;

	for (let index = 0; index < argsString.length; index++) {
		const character = argsString[index] as string;
		if (inQuote) {
			if (character === inQuote) inQuote = null;
			else current += character;
		} else if (character === '"' || character === "'") {
			inQuote = character;
			hasToken = true;
		} else if (/\s/.test(character)) {
			if (hasToken) {
				args.push(current);
				current = "";
				hasToken = false;
			}
		} else {
			current += character;
			hasToken = true;
		}
	}
	if (hasToken) args.push(current);
	return args;
}

/**
 * Substitute argument placeholders in a template body.
 *
 * Replacement happens on the template only; an argument that itself contains
 * `$1` or `$@` is inserted literally.
 */
export function substituteArgs(content: string, args: string[]): string {
	const allArgs = args.join(" ");
	return content.replace(
		/\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
		(_match, defaultTarget: string, defaultValue: string, sliceStart: string, sliceLength: string, simple: string) => {
			if (defaultTarget) {
				const value =
					defaultTarget === "@" || defaultTarget === "ARGUMENTS"
						? allArgs
						: args[parseInt(defaultTarget, 10) - 1];
				return value ? value : defaultValue;
			}
			if (sliceStart) {
				let start = parseInt(sliceStart, 10) - 1;
				if (start < 0) start = 0;
				if (sliceLength) return args.slice(start, start + parseInt(sliceLength, 10)).join(" ");
				return args.slice(start).join(" ");
			}
			if (simple === "ARGUMENTS" || simple === "@") return allArgs;
			return args[parseInt(simple, 10) - 1] ?? "";
		},
	);
}

/**
 * Expand a prompt template when the text starts with a template name.
 *
 * Text that does not match a template is returned unchanged, so an ordinary
 * message beginning with `/` still reaches the model.
 */
export function expandPromptTemplate(text: string, templates: PromptTemplate[]): string {
	if (!text.startsWith("/")) return text;
	const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
	if (!match) return text;
	const template = templates.find((entry) => entry.name === match[1]);
	if (!template) return text;
	return substituteArgs(template.content, parseCommandArgs(match[2] ?? ""));
}
