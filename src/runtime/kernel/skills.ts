/**
 * Project and agent skills.
 *
 * A skill is a markdown file with a name and a description. The session adds a
 * compact list of skills to the system prompt; the model reads the full file
 * with the `read` capability only when a task matches the description. This is
 * the Agent Skills layout:
 *
 *   <agentDir>/skills/<name>/SKILL.md      every project
 *   <project>/.pi/skills/<name>/SKILL.md   the trusted project only
 *
 * Derived from Pi 1.4.0 (`third_party/pi/packages/coding-agent/src/core/skills.ts`,
 * MIT licensed, Copyright (c) 2025 Mario Zechner). Changes: the `ignore`
 * package is not shipped, so dot-directories and `node_modules` are skipped
 * instead of honouring `.gitignore`; symlink de-duplication uses the resolved
 * path; and the source is recorded as `user` or `project` instead of Pi's
 * source-info object.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import type { ResourceDiagnostic } from "./resources.js";

/** Max name length per the Agent Skills specification. */
const MAX_NAME_LENGTH = 64;

/** Max description length per the Agent Skills specification. */
const MAX_DESCRIPTION_LENGTH = 1024;

/** A skill the session knows. */
export interface Skill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	source: "user" | "project";
	/** A skill can be hidden from the model prompt but still listed. */
	disableModelInvocation: boolean;
}

export interface LoadSkillsOptions {
	/** The working directory, for project skills. */
	cwd: string;
	/** The agent configuration directory, for user skills. */
	agentDir: string;
	/** Whether project configuration may be read. */
	trusted: boolean;
}

export interface LoadSkillsResult {
	skills: Skill[];
	diagnostics: ResourceDiagnostic[];
}

/**
 * Load the skills of the session.
 *
 * User skills are read first, so a user skill wins a name collision with a
 * project skill. The collision is reported rather than hidden.
 */
export function loadSkills(options: LoadSkillsOptions): LoadSkillsResult {
	const skills = new Map<string, Skill>();
	const seen = new Set<string>();
	const diagnostics: ResourceDiagnostic[] = [];

	const add = (found: LoadSkillsResult): void => {
		diagnostics.push(...found.diagnostics);
		for (const skill of found.skills) {
			const realPath = resolve(skill.filePath);
			if (seen.has(realPath)) continue;
			const existing = skills.get(skill.name);
			if (existing) {
				diagnostics.push({
					type: "collision",
					message: `skill name "${skill.name}" collision`,
					path: skill.filePath,
					collision: {
						resourceType: "skill",
						name: skill.name,
						winnerPath: existing.filePath,
						loserPath: skill.filePath,
					},
				});
				continue;
			}
			seen.add(realPath);
			skills.set(skill.name, skill);
		}
	};

	add(loadSkillsFromDir(join(options.agentDir, "skills"), "user"));
	if (options.trusted) add(loadSkillsFromDir(resolve(options.cwd, ".pi", "skills"), "project"));
	return { skills: [...skills.values()], diagnostics };
}

/**
 * Read one skills directory.
 *
 * A directory that contains `SKILL.md` is a skill root and is not searched
 * further. Otherwise direct `.md` children are skills and subdirectories are
 * searched for their own `SKILL.md`.
 */
function loadSkillsFromDir(dir: string, source: "user" | "project"): LoadSkillsResult {
	const skills: Skill[] = [];
	const diagnostics: ResourceDiagnostic[] = [];
	walk(dir, source, true, skills, diagnostics);
	return { skills, diagnostics };
}

function walk(
	dir: string,
	source: "user" | "project",
	includeRootFiles: boolean,
	skills: Skill[],
	diagnostics: ResourceDiagnostic[],
): void {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}

	const declared = entries.find((entry) => entry.name === "SKILL.md");
	if (declared && isFile(join(dir, declared.name))) {
		const result = loadSkillFile(join(dir, declared.name), source);
		if (result.skill) skills.push(result.skill);
		diagnostics.push(...result.diagnostics);
		return;
	}

	for (const entry of entries) {
		if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
		const fullPath = join(dir, entry.name);
		const stats = statOf(fullPath);
		if (!stats) continue;
		if (stats.isDirectory()) {
			walk(fullPath, source, false, skills, diagnostics);
			continue;
		}
		if (!includeRootFiles || !stats.isFile() || !entry.name.endsWith(".md")) continue;
		const result = loadSkillFile(fullPath, source);
		if (result.skill) skills.push(result.skill);
		diagnostics.push(...result.diagnostics);
	}
}

function loadSkillFile(
	filePath: string,
	source: "user" | "project",
): { skill: Skill | null; diagnostics: ResourceDiagnostic[] } {
	const diagnostics: ResourceDiagnostic[] = [];
	const declared = basename(filePath) === "SKILL.md";

	let raw: string;
	try {
		raw = readFileSync(filePath, "utf-8");
	} catch (error) {
		diagnostics.push({
			type: "warning",
			message: error instanceof Error ? error.message : "failed to read skill file",
			path: filePath,
		});
		return { skill: null, diagnostics };
	}

	const { frontmatter } = parseFrontmatter(raw);
	const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
	const hasDescription = description.trim() !== "";
	// A loose markdown file without a description is not a skill. A declared
	// SKILL.md without one is a broken skill and is reported.
	if (!hasDescription) {
		if (declared) diagnostics.push({ type: "warning", message: "description is required", path: filePath });
		return { skill: null, diagnostics };
	}

	const skillDir = dirname(filePath);
	const name = typeof frontmatter.name === "string" && frontmatter.name ? frontmatter.name : basename(skillDir);
	if (name.length > MAX_NAME_LENGTH) {
		diagnostics.push({
			type: "warning",
			message: `name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`,
			path: filePath,
		});
	}
	if (!/^[a-z0-9-]+$/.test(name)) {
		diagnostics.push({
			type: "warning",
			message: "name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)",
			path: filePath,
		});
	}
	if (name.startsWith("-") || name.endsWith("-")) {
		diagnostics.push({ type: "warning", message: "name must not start or end with a hyphen", path: filePath });
	}
	if (name.includes("--")) {
		diagnostics.push({ type: "warning", message: "name must not contain consecutive hyphens", path: filePath });
	}
	if (description.length > MAX_DESCRIPTION_LENGTH) {
		diagnostics.push({
			type: "warning",
			message: `description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`,
			path: filePath,
		});
	}

	return {
		skill: {
			name,
			description,
			filePath,
			baseDir: skillDir,
			source,
			disableModelInvocation: frontmatter["disable-model-invocation"] === true,
		},
		diagnostics,
	};
}

function statOf(target: string) {
	try {
		return statSync(target);
	} catch {
		return null;
	}
}

function isFile(target: string): boolean {
	return statOf(target)?.isFile() ?? false;
}

/**
 * Format skills for the system prompt, using the Agent Skills XML shape.
 *
 * A skill with `disable-model-invocation` is listed in the interface but is not
 * offered to the model.
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
	const visible = skills.filter((skill) => !skill.disableModelInvocation);
	if (visible.length === 0) return "";
	const lines = [
		"The following skills provide specialized instructions for specific tasks.",
		"Use the read tool to load a skill's file when the task matches its description.",
		"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
		"",
		"<available_skills>",
	];
	for (const skill of visible) {
		lines.push("  <skill>");
		lines.push(`    <name>${escapeXml(skill.name)}</name>`);
		lines.push(`    <description>${escapeXml(skill.description)}</description>`);
		lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
		lines.push("  </skill>");
	}
	lines.push("</available_skills>");
	return lines.join("\n");
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
