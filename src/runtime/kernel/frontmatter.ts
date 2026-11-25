/**
 * A small frontmatter reader.
 *
 * Skills and prompt templates carry a YAML frontmatter block. The shipped
 * runtime has no YAML package, so this reads the subset those files use:
 * top-level scalar keys, quoted strings, booleans and `|`/`>` block scalars.
 * Nested maps and sequences are not interpreted; they are left out rather than
 * guessed at.
 *
 * Derived from Pi 1.4.0 (`third_party/pi/packages/coding-agent/src/utils/frontmatter.ts`,
 * MIT licensed, Copyright (c) 2025 Mario Zechner). Changes: the YAML parser is
 * replaced by the scalar reader below, because `yaml` is not shipped.
 */

/** A parsed frontmatter block and the body that follows it. */
export interface FrontmatterResult {
	frontmatter: Record<string, string | boolean | null>;
	body: string;
}

/** Split a markdown file into its frontmatter keys and its body. */
export function parseFrontmatter(content: string): FrontmatterResult {
	const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/^\uFEFF/, "");
	if (!normalized.startsWith("---")) return { frontmatter: {}, body: normalized };
	const end = normalized.indexOf("\n---", 3);
	if (end === -1) return { frontmatter: {}, body: normalized };
	return {
		frontmatter: parseScalars(normalized.slice(4, end)),
		body: normalized.slice(end + 4).trim(),
	};
}

function parseScalars(yaml: string): Record<string, string | boolean | null> {
	const result: Record<string, string | boolean | null> = {};
	const lines = yaml.split("\n");
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		if (!line.trim() || line.trimStart().startsWith("#")) continue;
		// Indented lines belong to a key already read; they are not top-level.
		if (/^\s/.test(line)) continue;
		const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (!match) continue;
		const key = match[1] as string;
		const raw = (match[2] ?? "").trim();
		if (/^[|>][-+]?$/.test(raw)) {
			const folded = raw.startsWith(">");
			const collected: string[] = [];
			while (index + 1 < lines.length) {
				const next = lines[index + 1] ?? "";
				if (next.trim() && !/^\s/.test(next)) break;
				index++;
				collected.push(next.replace(/^\s+/, ""));
			}
			while (collected.length && !(collected[collected.length - 1] ?? "").trim()) collected.pop();
			result[key] = folded ? collected.join(" ").trim() : collected.join("\n").trim();
			continue;
		}
		result[key] = parseScalar(raw);
	}
	return result;
}

function parseScalar(raw: string): string | boolean | null {
	if (!raw) return "";
	if (raw === "true") return true;
	if (raw === "false") return false;
	if (raw === "null" || raw === "~") return null;
	if (raw.startsWith('"') && raw.endsWith('"')) {
		return raw
			.slice(1, -1)
			.replace(/\\(["\\n])/g, (_match, character: string) => (character === "n" ? "\n" : character));
	}
	if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
	return raw;
}
