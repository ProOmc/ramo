/**
 * Shared resource vocabulary.
 *
 * Skills and prompt templates are markdown files the session loads from the
 * agent directory and, for a trusted project, from the project configuration.
 * Both loaders report the same diagnostic shape so the interface can show one
 * list of problems.
 *
 * Derived from Pi 1.4.0 (`third_party/pi/packages/coding-agent/src/core/diagnostics.ts`,
 * MIT licensed, Copyright (c) 2025 Mario Zechner). Changes: only the fields
 * Ramo uses are kept.
 */

/** The kind of resource a diagnostic is about. */
export type ResourceType = "skill" | "prompt" | "extension";

/** A problem the loaders found while reading resources. */
export interface ResourceDiagnostic {
	type: "warning" | "collision";
	message: string;
	path?: string;
	collision?: {
		resourceType: ResourceType;
		name: string;
		winnerPath: string;
		loserPath: string;
	};
}
