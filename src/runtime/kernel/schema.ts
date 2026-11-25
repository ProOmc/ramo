/**
 * Tool declaration handling and JSON Schema validation for the Ramo kernel.
 *
 * Derived from Pi 1.4.0 (`third_party/pi/packages/ai/src/utils/transcript.ts` and
 * `third_party/pi/packages/ai/src/utils/validation.ts`, MIT licensed, Copyright (c)
 * 2025 Mario Zechner). Changes: the typebox dependency is gone, so validation is
 * implemented here against plain JSON Schema; the vocabulary is Ramo's own.
 *
 * No validation library ships with Ramo, and none may be added, so this module
 * implements the subset of JSON Schema that capability declarations actually use.
 */

import type {
	JsonObject,
	JsonValue,
	ToolCallBlock,
	ToolDeclaration,
	ToolReference,
	TranscriptMessage,
} from "./types.js";

/** The JSON Schema keywords the kernel understands. */
interface SchemaObject {
	type?: string | string[];
	properties?: Record<string, SchemaObject>;
	required?: string[];
	items?: SchemaObject | SchemaObject[];
	additionalProperties?: boolean | SchemaObject;
	enum?: JsonValue[];
	const?: JsonValue;
	anyOf?: SchemaObject[];
	oneOf?: SchemaObject[];
	allOf?: SchemaObject[];
	minimum?: number;
	maximum?: number;
	minLength?: number;
	maxLength?: number;
	minItems?: number;
	maxItems?: number;
	pattern?: string;
}

/** Strip executable and display-only fields from a capability before comparison or persistence. */
export function toDeclaration(declaration: ToolDeclaration): ToolDeclaration {
	return {
		name: declaration.name,
		description: declaration.description,
		parameters: JSON.parse(JSON.stringify(declaration.parameters)) as JsonObject,
	};
}

/**
 * Whether two declarations present the same interface to the model.
 *
 * Both sides are normalized first so the comparison is exact and needs no deep
 * equality helper.
 */
export function declarationsEqual(left: ToolDeclaration, right: ToolDeclaration): boolean {
	return JSON.stringify(toDeclaration(left)) === JSON.stringify(toDeclaration(right));
}

export interface CapabilityStateChanges {
	capabilitiesAdded: ToolDeclaration[];
	capabilitiesRemoved: ToolReference[];
}

/** Compare two complete capability sets. A changed definition is a removal plus an addition. */
export function getCapabilityStateChanges(
	previous: readonly ToolDeclaration[],
	current: readonly ToolDeclaration[],
): CapabilityStateChanges {
	const previousTools = new Map(previous.map((tool) => [tool.name, tool]));
	const currentTools = new Map(current.map((tool) => [tool.name, tool]));
	return {
		capabilitiesAdded: current
			.filter((tool) => {
				const previousTool = previousTools.get(tool.name);
				return previousTool === undefined || !declarationsEqual(previousTool, tool);
			})
			.map(toDeclaration),
		capabilitiesRemoved: previous
			.filter((tool) => {
				const currentTool = currentTools.get(tool.name);
				return currentTool === undefined || !declarationsEqual(tool, currentTool);
			})
			.map((tool) => ({ name: tool.name })),
	};
}

/** Resolve the capabilities available after applying every transcript delta in order. */
export function getCurrentCapabilities(messages: readonly TranscriptMessage[]): ToolDeclaration[] {
	const capabilities = new Map<string, ToolDeclaration>();
	for (const message of messages) {
		if (message.role !== "system") continue;
		for (const capability of message.capabilitiesRemoved ?? []) capabilities.delete(capability.name);
		for (const capability of message.capabilitiesAdded ?? []) capabilities.set(capability.name, capability);
	}
	return [...capabilities.values()];
}

function schemaTypes(schema: SchemaObject): string[] {
	if (typeof schema.type === "string") return [schema.type];
	if (Array.isArray(schema.type)) return schema.type.filter((type): type is string => typeof type === "string");
	return [];
}

function matchesJsonType(value: unknown, type: string): boolean {
	switch (type) {
		case "number":
			return typeof value === "number" && Number.isFinite(value);
		case "integer":
			return typeof value === "number" && Number.isInteger(value);
		case "boolean":
			return typeof value === "boolean";
		case "string":
			return typeof value === "string";
		case "null":
			return value === null;
		case "array":
			return Array.isArray(value);
		case "object":
			return typeof value === "object" && value !== null && !Array.isArray(value);
		default:
			return false;
	}
}

/** Check one value against one schema. Returns the list of problems, empty when valid. */
function checkSchema(value: unknown, schema: SchemaObject, path: string, errors: string[]): void {
	if (schema.const !== undefined && value !== schema.const) {
		errors.push(`${path}: expected ${JSON.stringify(schema.const)}`);
	}
	if (schema.enum && !schema.enum.some((candidate) => candidate === value)) {
		errors.push(`${path}: expected one of ${schema.enum.map((entry) => JSON.stringify(entry)).join(", ")}`);
	}

	const types = schemaTypes(schema);
	if (types.length > 0 && !types.some((type) => matchesJsonType(value, type))) {
		errors.push(`${path}: expected ${types.join(" or ")}`);
		return;
	}

	if (typeof value === "number") {
		if (schema.minimum !== undefined && value < schema.minimum) {
			errors.push(`${path}: must be at least ${schema.minimum}`);
		}
		if (schema.maximum !== undefined && value > schema.maximum) {
			errors.push(`${path}: must be at most ${schema.maximum}`);
		}
	}
	if (typeof value === "string") {
		if (schema.minLength !== undefined && value.length < schema.minLength) {
			errors.push(`${path}: must be at least ${schema.minLength} characters`);
		}
		if (schema.maxLength !== undefined && value.length > schema.maxLength) {
			errors.push(`${path}: must be at most ${schema.maxLength} characters`);
		}
		if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
			errors.push(`${path}: must match ${schema.pattern}`);
		}
	}
	if (Array.isArray(value)) {
		if (schema.minItems !== undefined && value.length < schema.minItems) {
			errors.push(`${path}: must have at least ${schema.minItems} items`);
		}
		if (schema.maxItems !== undefined && value.length > schema.maxItems) {
			errors.push(`${path}: must have at most ${schema.maxItems} items`);
		}
		if (Array.isArray(schema.items)) {
			for (let index = 0; index < value.length; index++) {
				const itemSchema = schema.items[index];
				if (itemSchema) checkSchema(value[index], itemSchema, `${path}[${index}]`, errors);
			}
		} else if (schema.items) {
			for (let index = 0; index < value.length; index++) {
				checkSchema(value[index], schema.items, `${path}[${index}]`, errors);
			}
		}
	}
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		const object = value as Record<string, unknown>;
		const properties = schema.properties ?? {};
		for (const key of schema.required ?? []) {
			if (!(key in object)) errors.push(`${path}.${key}: is required`);
		}
		for (const [key, propertySchema] of Object.entries(properties)) {
			if (key in object) checkSchema(object[key], propertySchema, `${path}.${key}`, errors);
		}
		if (schema.additionalProperties === false) {
			for (const key of Object.keys(object)) {
				if (!(key in properties)) errors.push(`${path}.${key}: is not an accepted argument`);
			}
		} else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
			for (const [key, propertyValue] of Object.entries(object)) {
				if (key in properties) continue;
				checkSchema(propertyValue, schema.additionalProperties, `${path}.${key}`, errors);
			}
		}
	}

	for (const nested of schema.allOf ?? []) checkSchema(value, nested, path, errors);
	const alternatives = schema.anyOf ?? schema.oneOf;
	if (alternatives) {
		const matched = alternatives.some((alternative) => {
			const nested: string[] = [];
			checkSchema(value, alternative, path, nested);
			return nested.length === 0;
		});
		if (!matched) errors.push(`${path}: does not match any accepted form`);
	}
}

/**
 * Validate the arguments of one capability call against its declaration.
 *
 * Returns the accepted arguments. Throws with a readable message when they do not
 * match, so the model can be told what went wrong and re-issue the call.
 */
export function validateCapabilityArguments(
	declaration: ToolDeclaration,
	toolCall: ToolCallBlock,
): JsonObject {
	if (toolCall.argumentsError) {
		throw new Error(`Invalid arguments for capability "${declaration.name}": ${toolCall.argumentsError}`);
	}
	const args = toolCall.arguments;
	const errors: string[] = [];
	checkSchema(args, declaration.parameters as SchemaObject, "root", errors);
	if (errors.length > 0) {
		throw new Error(
			`Validation failed for capability "${declaration.name}":\n${errors.map((error) => `  - ${error}`).join("\n")}\n\nReceived arguments:\n${JSON.stringify(toolCall.arguments, null, 2)}`,
		);
	}
	return args;
}

/**
 * Coerce an argument value that has the wrong primitive type but an obvious intended
 * type, so a model that sends `"3"` for a number is not rejected over a detail.
 */
export function coerceCapabilityArguments(declaration: ToolDeclaration, args: JsonObject): JsonObject {
	const properties = (declaration.parameters as SchemaObject).properties ?? {};
	const result: JsonObject = { ...args };
	for (const [key, propertySchema] of Object.entries(properties)) {
		if (!(key in result)) continue;
		const types = schemaTypes(propertySchema);
		if (types.length === 0) continue;
		const value = result[key];
		if (types.some((type) => matchesJsonType(value, type))) continue;
		if (types.includes("number") && typeof value === "string" && value.trim() !== "") {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) result[key] = parsed;
		} else if (types.includes("boolean") && typeof value === "string") {
			if (value === "true") result[key] = true;
			else if (value === "false") result[key] = false;
		} else if (types.includes("string") && (typeof value === "number" || typeof value === "boolean")) {
			result[key] = String(value);
		}
	}
	return result;
}
