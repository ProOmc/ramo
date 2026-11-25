/**
 * Shared truncation for capability output.
 *
 * Derived from Pi 1.4.0 (`third_party/pi/packages/coding-agent/src/core/tools/truncate.ts`,
 * MIT licensed, Copyright (c) 2025 Mario Zechner). Changes: Ramo's own
 * implementation, with the middle-truncation helper kept because command output
 * needs it.
 */

/** The maximum number of lines a capability result may contain. */
export const DEFAULT_MAX_LINES = 2000;
/** The maximum number of bytes a capability result may contain. */
export const DEFAULT_MAX_BYTES = 50 * 1024;
/** The maximum number of characters of one grep match line. */
export const GREP_MAX_LINE_LENGTH = 500;

export interface TruncationResult {
	content: string;
	truncated: boolean;
	/** Which limit was hit, or null when nothing was cut. */
	truncatedBy: "lines" | "bytes" | null;
	totalLines: number;
	totalBytes: number;
	outputLines: number;
	outputBytes: number;
	lastLinePartial: boolean;
	firstLineExceedsLimit: boolean;
	maxLines: number;
	maxBytes: number;
}

export interface TruncationOptions {
	maxLines?: number;
	maxBytes?: number;
}

function splitLinesForCounting(content: string): string[] {
	if (content.length === 0) return [];
	const lines = content.split("\n");
	if (content.endsWith("\n")) lines.pop();
	return lines;
}

/** Format bytes as a human-readable size. */
export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Truncate content from the head, keeping the first lines that fit.
 *
 * Never returns a partial line. When the first line alone exceeds the byte limit,
 * the content is empty and `firstLineExceedsLimit` says so.
 */
export function truncateHead(content: string, options: TruncationOptions = {}): TruncationResult {
	const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

	const totalBytes = Buffer.byteLength(content, "utf-8");
	const lines = splitLinesForCounting(content);
	const totalLines = lines.length;

	if (totalLines <= maxLines && totalBytes <= maxBytes) {
		return {
			content,
			truncated: false,
			truncatedBy: null,
			totalLines,
			totalBytes,
			outputLines: totalLines,
			outputBytes: totalBytes,
			lastLinePartial: false,
			firstLineExceedsLimit: false,
			maxLines,
			maxBytes,
		};
	}

	const firstLineBytes = Buffer.byteLength(lines[0] ?? "", "utf-8");
	if (firstLineBytes > maxBytes) {
		return {
			content: "",
			truncated: true,
			truncatedBy: "bytes",
			totalLines,
			totalBytes,
			outputLines: 0,
			outputBytes: 0,
			lastLinePartial: false,
			firstLineExceedsLimit: true,
			maxLines,
			maxBytes,
		};
	}

	const outputLines: string[] = [];
	let outputBytesCount = 0;
	let truncatedBy: "lines" | "bytes" = "lines";

	for (let index = 0; index < lines.length && index < maxLines; index++) {
		const line = lines[index];
		const lineBytes = Buffer.byteLength(line, "utf-8") + (index > 0 ? 1 : 0);
		if (outputBytesCount + lineBytes > maxBytes) {
			truncatedBy = "bytes";
			break;
		}
		outputLines.push(line);
		outputBytesCount += lineBytes;
	}

	if (outputLines.length >= maxLines && outputBytesCount <= maxBytes) truncatedBy = "lines";

	const outputContent = outputLines.join("\n");
	return {
		content: outputContent,
		truncated: true,
		truncatedBy,
		totalLines,
		totalBytes,
		outputLines: outputLines.length,
		outputBytes: Buffer.byteLength(outputContent, "utf-8"),
		lastLinePartial: false,
		firstLineExceedsLimit: false,
		maxLines,
		maxBytes,
	};
}

/**
 * Truncate content from the tail, keeping the last lines that fit.
 *
 * The first kept line may be partial when it alone exceeds the byte limit.
 */
export function truncateTail(content: string, options: TruncationOptions = {}): TruncationResult {
	const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

	const totalBytes = Buffer.byteLength(content, "utf-8");
	const lines = splitLinesForCounting(content);
	const totalLines = lines.length;

	if (totalLines <= maxLines && totalBytes <= maxBytes) {
		return {
			content,
			truncated: false,
			truncatedBy: null,
			totalLines,
			totalBytes,
			outputLines: totalLines,
			outputBytes: totalBytes,
			lastLinePartial: false,
			firstLineExceedsLimit: false,
			maxLines,
			maxBytes,
		};
	}

	const outputLines: string[] = [];
	let outputBytesCount = 0;
	let truncatedBy: "lines" | "bytes" = "lines";
	let lastLinePartial = false;

	for (let index = lines.length - 1; index >= 0 && outputLines.length < maxLines; index--) {
		const line = lines[index];
		const lineBytes = Buffer.byteLength(line, "utf-8") + (outputLines.length > 0 ? 1 : 0);
		if (outputBytesCount + lineBytes > maxBytes) {
			truncatedBy = "bytes";
			if (outputLines.length === 0) {
				const truncatedLine = truncateStringToBytesFromEnd(line, maxBytes);
				outputLines.unshift(truncatedLine);
				outputBytesCount = Buffer.byteLength(truncatedLine, "utf-8");
				lastLinePartial = true;
			}
			break;
		}
		outputLines.unshift(line);
		outputBytesCount += lineBytes;
	}

	if (outputLines.length >= maxLines && outputBytesCount <= maxBytes) truncatedBy = "lines";

	const outputContent = outputLines.join("\n");
	return {
		content: outputContent,
		truncated: true,
		truncatedBy,
		totalLines,
		totalBytes,
		outputLines: outputLines.length,
		outputBytes: Buffer.byteLength(outputContent, "utf-8"),
		lastLinePartial,
		firstLineExceedsLimit: false,
		maxLines,
		maxBytes,
	};
}

function truncateStringToBytesFromEnd(value: string, maxBytes: number): string {
	const buffer = Buffer.from(value, "utf-8");
	if (buffer.length <= maxBytes) return value;
	let start = buffer.length - maxBytes;
	// Continuation bytes are not character starts.
	while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start++;
	return buffer.slice(start).toString("utf-8");
}

/** Truncate one line, marking that it was cut. */
export function truncateLine(line: string, maxChars: number = GREP_MAX_LINE_LENGTH): { text: string; wasTruncated: boolean } {
	if (line.length <= maxChars) return { text: line, wasTruncated: false };
	return { text: `${line.slice(0, maxChars)}... [truncated]`, wasTruncated: true };
}

export interface MiddleTruncationResult {
	content: string;
	truncated: boolean;
	removedChars: number;
	totalBytes: number;
	totalLines: number;
}

/**
 * Keep the start and the end of the content, half of `maxBytes` each, and replace
 * the middle with a marker. Cuts only at character boundaries.
 */
export function truncateMiddle(content: string, maxBytes: number): MiddleTruncationResult {
	const buffer = Buffer.from(content, "utf-8");
	const totalLines = splitLinesForCounting(content).length;
	if (buffer.length <= maxBytes) {
		return { content, truncated: false, removedChars: 0, totalBytes: buffer.length, totalLines };
	}
	const isBoundary = (index: number) => index >= buffer.length || (buffer[index] & 0xc0) !== 0x80;
	let headEnd = Math.floor(maxBytes / 2);
	while (headEnd > 0 && !isBoundary(headEnd)) headEnd--;
	let tailStart = buffer.length - (maxBytes - Math.floor(maxBytes / 2));
	while (tailStart < buffer.length && !isBoundary(tailStart)) tailStart++;
	const head = buffer.subarray(0, headEnd).toString("utf-8");
	const tail = buffer.subarray(tailStart).toString("utf-8");
	const removedChars = Array.from(buffer.subarray(headEnd, tailStart).toString("utf-8")).length;
	return {
		content: `${head}…${removedChars} chars truncated…${tail}`,
		truncated: true,
		removedChars,
		totalBytes: buffer.length,
		totalLines,
	};
}
