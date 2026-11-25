/**
 * The memory surface.
 *
 * A viewer and an editor for the store the worker owns. It reads the
 * projection the worker writes and sends commands back through the inbox, so
 * it never writes a fact itself and never learns the store's format.
 *
 * One surface, four tabs over the same projection:
 *
 * - **MEMORY.md** — the file itself, as a full-page editable markdown document
 *   with a short note above it that explains the file and is not part of it.
 *   Saving writes the text back to `MEMORY.md`; a line the user adds becomes
 *   their fact. The budget, the counts and the passes sit below in a collapsed
 *   section, so the page reads as one document.
 * - **Daily** — the days, one at a time, each a list of what was remembered,
 *   changed or forgotten and when.
 * - **Notes** — the vault, one note per subject, read as a header and the
 *   facts it holds, with the links to the other notes.
 * - **Timeline** — every fact, with the moment it was remembered, whether it
 *   still holds and the words that justified it.
 *
 * The surface shows what a person reads. The ids, the sessions and the schema
 * a fact carries stay in the store and are shown only inside the detail the
 * reader opens on purpose.
 *
 * A search runs in the worker, because the arms that answer it — semantic,
 * lexical, graph and temporal — live there. The answer comes back with the
 * arms that fired, and the surface shows them as chips, so "nothing matched"
 * can be told apart from "an arm could not run".
 *
 * The surface edits the document and the facts, never the store. `MEMORY.md`
 * and the vault are projections of the store; a document edit is written to
 * the file and its added lines are recorded as user-originated facts, and an
 * edit to a fact supersedes what it replaced, so the files follow.
 */

import type { DesktopBridge } from './legacy-boundary.js';

interface MemoryFactView {
	id: string;
	text: string;
	kind: string;
	subject: string;
	predicate: string;
	object: string | null;
	validFrom: string;
	validUntil: string | null;
	recordedAt: string;
	confidence: number;
	superseded: boolean;
	retracted: boolean;
	quote: string | null;
	source: string;
	sessionId: string | null;
	tags: string[];
	/** The moment it was remembered, as a person reads it. */
	recordedLabel: string;
	/** Whether it still holds, in one phrase. */
	status: string;
}

interface MemorySection {
	name: string;
	body: string;
}

interface MemoryNoteLink {
	target: string;
	label: string;
}

interface MemoryNoteGroup {
	heading: string;
	facts: string[];
	links: MemoryNoteLink[];
}

interface MemoryNote {
	path: string;
	name: string;
	description: string;
	groups: MemoryNoteGroup[];
}

interface MemoryDream {
	id: string;
	startedAt: string;
	model: string;
	status: string;
	created: number;
	retracted: number;
	merged: number;
	conflicts: number;
}

interface MemoryDailyEntry {
	time: string;
	text: string;
}

interface MemoryDaily {
	path: string;
	date: string;
	/** The day as a person reads it. */
	label: string;
	/** The plain header the day carries. */
	header: string;
	/** The changes of the day, as sentences. */
	entries: MemoryDailyEntry[];
}

interface MemorySearchFact {
	id: string;
	text: string;
	rank: number;
	arms: string[];
	raised: string[];
	lowered: string[];
	superseded: boolean;
}

interface MemorySearch {
	query: string;
	at: string;
	facts: MemorySearchFact[];
	arms: { arm: string; status: string; reason: string; candidates: number }[];
	interval: { label: string; from: number; to: number } | null;
	history: boolean;
}

interface MemoryProjection {
	version: number;
	generatedAt: string;
	budget: number;
	tier: string;
	status: {
		facts: number;
		history: number;
		notes: number;
		lastRenderedAt: string | null;
		lastDreamAt: string | null;
		estimatedTokens: number;
		injectedTokens: number;
		embedding: { available: boolean; model: string | null; reason: string };
	};
	hot: { text: string; tokens: number; sections: MemorySection[]; skippedProtected: string[] };
	index: string;
	notes: MemoryNote[];
	daily: MemoryDaily[];
	timeline: MemoryFactView[];
	dreams: MemoryDream[];
	search: MemorySearch | null;
	command: { id: string; action: string; ok: boolean; reason: string; at: string } | null;
}

type MemoryTab = 'hot' | 'daily' | 'notes' | 'timeline';

const TABS: { id: MemoryTab; label: string }[] = [
	{ id: 'hot', label: 'MEMORY.md' },
	{ id: 'daily', label: 'Daily' },
	{ id: 'notes', label: 'Notes' },
	{ id: 'timeline', label: 'Timeline' },
];

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	text?: string,
	className?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (text !== undefined) node.textContent = text;
	if (className) node.className = className;
	return node;
}

function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
	const node = el('button', label, className);
	node.type = 'button';
	node.addEventListener('click', (event) => {
		event.preventDefault();
		onClick();
	});
	return node;
}

function stamp(value: string | null): string {
	if (!value) return 'unknown';
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed)) return value;
	return new Date(parsed).toLocaleString();
}

export class MemorySurface {
	private readonly bridge: DesktopBridge;
	private root: HTMLElement | null = null;
	private projection: MemoryProjection | null = null;
	private tab: MemoryTab = 'hot';
	private query = '';
	private selectedNote = '';
	private selectedDay = '';
	/** The text of MEMORY.md while it is being edited, before it is saved. */
	private documentDraft: string | null = null;
	/** Whether the draft differs from the file on disk. */
	private documentDirty = false;
	private editing: string | null = null;
	private stopListening: (() => void) | null = null;
	private searchTimer: number | undefined;
	private notice = '';

	constructor(bridge: DesktopBridge) {
		this.bridge = bridge;
	}

	/**
	 * Save a fact the user typed.
	 *
	 * The command is the only way the interface changes the store, and the
	 * worker's answer comes back in the projection. The reason is returned so
	 * the caller can show it.
	 */
	async remember(text: string): Promise<string> {
		const value = text.replace(/\s+/g, ' ').trim();
		if (value.length < 4) throw new Error('A fact needs some text.');
		const api = this.memoryApi();
		if (!api) throw new Error('Memory is unavailable in this window.');
		const result = await api.command({ action: 'add-fact', text: value });
		return this.outcome(String(result.id));
	}

	/** Open the surface in the workspace, on the memory page. */
	async open(): Promise<void> {
		const ui = (globalThis as unknown as { __ramoWorkspaceUIActive?: { preparePage?: (page: string) => unknown } })
			.__ramoWorkspaceUIActive;
		this.notice = '';
		// Preparing a page clears the workspace content, so the surface is
		// attached again below if the page took it away.
		const prepared = ui?.preparePage?.('memory');
		const host =
			prepared instanceof HTMLElement
				? prepared
				: document.getElementById('ramo-workspace-content-v180');
		if (!host) throw new Error('The memory page is not available in this window.');
		if (!this.root) {
			this.root = this.build();
			this.stopListening =
				this.memoryApi()?.onChanged?.(() => {
					void this.reload();
				}) ?? null;
		}
		if (!this.root.isConnected) host.append(this.root);
		await this.reload();
	}

	/** Close the surface and go back to the conversation. */
	close(): void {
		this.stopListening?.();
		this.stopListening = null;
		this.root?.remove();
		this.root = null;
		const ui = (globalThis as unknown as { __ramoWorkspaceUIActive?: { showHome?: () => void } })
			.__ramoWorkspaceUIActive;
		ui?.showHome?.();
	}

	private memoryApi():
		| {
				read(): Promise<{ available: boolean; reason: string; projection: MemoryProjection | null }>;
				command(command: Record<string, unknown>): Promise<{ id: string }>;
				onChanged(callback: () => void): () => void;
		  }
		| undefined {
		return (this.bridge as unknown as { memory?: ReturnType<MemorySurface['memoryApi']> }).memory;
	}

	/** Read the projection the worker wrote. */
	async reload(): Promise<void> {
		const api = this.memoryApi();
		if (!api) {
			this.notice = 'Memory is unavailable in this window.';
			this.render();
			return;
		}
		try {
			const result = await api.read();
			this.projection = result.projection;
			this.notice = result.available ? '' : result.reason;
		} catch (error) {
			this.projection = null;
			this.notice = error instanceof Error ? error.message : String(error);
		}
		this.render();
	}

	/** Send a command to the worker and wait for the projection to come back. */
	private async send(command: Record<string, unknown>): Promise<void> {
		const api = this.memoryApi();
		if (!api) return;
		try {
			const result = await api.command(command);
			this.notice = await this.outcome(String(result.id), command.action === 'dream' ? 120000 : 15000);
		} catch (error) {
			this.notice = error instanceof Error ? error.message : String(error);
		}
		this.render();
	}

	/**
	 * Wait for the worker's answer to one command.
	 *
	 * The native host only moves the command into the inbox, so the answer
	 * arrives later, in the projection. The surface reads it there rather than
	 * guessing what happened.
	 */
	private async outcome(id: string, timeoutMs = 15000): Promise<string> {
		const api = this.memoryApi();
		if (!api) return '';
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			try {
				const result = await api.read();
				const command = result.projection?.command;
				if (command && command.id === id) {
					this.projection = result.projection;
					this.render();
					return command.reason;
				}
			} catch {
				// The worker has not written the answer yet.
			}
			await new Promise((resolve) => window.setTimeout(resolve, 300));
		}
		return 'The memory store did not answer in time.';
	}

	// ------------------------------------------------------------- the surface

	private build(): HTMLElement {
		const root = el('section', undefined, 'oc-memory');
		root.setAttribute('role', 'region');
		root.setAttribute('aria-label', 'Memory');

		const head = el('header', undefined, 'oc-memory-head');
		const tabs = el('div', undefined, 'oc-memory-tabs');
		tabs.setAttribute('role', 'tablist');
		tabs.setAttribute('aria-label', 'Memory sections');
		for (const tab of TABS) {
			const node = button(tab.label, () => {
				this.tab = tab.id;
				this.render();
			});
			node.dataset.tab = tab.id;
			node.setAttribute('role', 'tab');
			tabs.append(node);
		}
		head.append(tabs);

		const search = el('input', undefined, 'oc-memory-search');
		search.type = 'search';
		search.placeholder = 'Search memory…';
		search.setAttribute('aria-label', 'Search memory');
		search.addEventListener('input', () => {
			this.query = search.value.trim();
			if (this.searchTimer !== undefined) window.clearTimeout(this.searchTimer);
			this.searchTimer = window.setTimeout(() => {
				this.searchTimer = undefined;
				if (this.query.length === 0) {
					this.render();
					return;
				}
				void this.send({ action: 'search', query: this.query });
			}, 260);
		});
		head.append(search);

		const actions = el('div', undefined, 'oc-memory-actions');
		actions.append(
			button('Add fact', () => this.startAdd(), 'oc-memory-add'),
			button('Consolidate', () => {
				void this.send({ action: 'dream' });
			}),
			button('Close', () => this.close()),
		);
		head.append(actions);
		root.append(head);

		const body = el('div', undefined, 'oc-memory-body');
		body.setAttribute('role', 'tabpanel');
		root.append(body);

		const notice = el('p', undefined, 'oc-memory-notice');
		notice.setAttribute('role', 'status');
		root.append(notice);
		return root;
	}

	private render(): void {
		if (!this.root) return;
		const projection = this.projection;
		const body = this.root.querySelector('.oc-memory-body');
		const notice = this.root.querySelector('.oc-memory-notice');
		const search = this.root.querySelector<HTMLInputElement>('.oc-memory-search');
		if (search && search.value !== this.query) search.value = this.query;
		for (const node of Array.from(this.root.querySelectorAll<HTMLButtonElement>('.oc-memory-tabs button'))) {
			const selected = node.dataset.tab === this.tab;
			node.setAttribute('aria-selected', String(selected));
			node.classList.toggle('is-active', selected);
		}
		if (notice) notice.textContent = this.notice || projection?.command?.reason || '';
		if (!body) return;
		// A document being edited is not thrown away by a projection update that
		// arrived while the user was typing: the draft is the newer state, and
		// only Save replaces the file. A rebuild happens only when the page on
		// screen does not already carry that draft.
		if (this.tab === 'hot' && this.documentDirty) {
			const area = body.querySelector<HTMLTextAreaElement>('.oc-memory-document');
			if (area && this.documentDraft !== null && area.value === this.documentDraft) return;
		}
		body.replaceChildren();
		if (!projection) {
			body.append(el('p', 'The memory store is not available yet.', 'oc-memory-empty'));
			return;
		}
		if (projection.search && projection.search.query === this.query && this.query.length > 0) {
			body.append(this.searchPanel(projection.search));
		}
		if (this.tab === 'hot') body.append(this.hotPanel(projection));
		else if (this.tab === 'daily') body.append(this.dailyPanel(projection));
		else if (this.tab === 'notes') body.append(this.notesPanel(projection));
		else body.append(this.timelinePanel(projection));
	}

	// ------------------------------------------------------------------ hot

	/**
	 * MEMORY.md as a page, not as a list of facts.
	 *
	 * The document is the file itself: the textarea holds exactly what is on
	 * disk and saving writes it back. The note above it explains the file and
	 * is authored here, never written into it. The store's own details — the
	 * budget, the counts, the consolidation passes — sit below the document in
	 * a collapsed section, so the page reads as one document rather than as a
	 * dashboard.
	 */
	private hotPanel(projection: MemoryProjection): HTMLElement {
		const panel = el('div', undefined, 'oc-memory-panel oc-memory-doc-panel');

		const toolbar = el('div', undefined, 'oc-memory-toolbar');
		toolbar.setAttribute('role', 'toolbar');
		toolbar.setAttribute('aria-label', 'Formatting');
		toolbar.append(
			this.formatButton('B', 'Bold', 'is-bold', () => this.wrapSelection('**')),
			this.formatButton('I', 'Italic', 'is-italic', () => this.wrapSelection('*')),
			this.formatButton('H1', 'Heading 1', '', () => this.prefixLines('h1')),
			this.formatButton('H2', 'Heading 2', '', () => this.prefixLines('h2')),
			this.formatButton('H3', 'Heading 3', '', () => this.prefixLines('h3')),
			this.formatButton('• List', 'Bulleted list', '', () => this.prefixLines('bullet')),
			this.formatButton('1. List', 'Numbered list', '', () => this.prefixLines('number')),
		);
		panel.append(toolbar);

		const area = el('textarea', undefined, 'oc-memory-document');
		area.value = this.documentDraft ?? projection.hot.text;
		area.setAttribute('aria-label', 'MEMORY.md');
		area.spellcheck = true;
		area.rows = 24;
		area.addEventListener('input', () => {
			this.documentDraft = area.value;
			this.documentDirty = area.value !== projection.hot.text;
			this.setDocumentState(this.documentDirty ? 'Unsaved changes' : 'Saved to MEMORY.md');
		});
		area.addEventListener('keydown', (event) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
				event.preventDefault();
				void this.saveDocument(area.value);
			}
		});
		panel.append(area);

		const footer = el('div', undefined, 'oc-memory-doc-footer');
		footer.append(
			button('Save', () => void this.saveDocument(area.value), 'oc-memory-save'),
			button(
				'Revert',
				() => {
					this.documentDraft = null;
					this.documentDirty = false;
					this.render();
				},
				'oc-memory-quiet',
			),
			el(
				'span',
				this.documentDirty ? 'Unsaved changes' : 'Saved to MEMORY.md',
				'oc-memory-doc-state',
			),
		);
		panel.append(footer);

		const more = el('details', undefined, 'oc-memory-more');
		more.append(el('summary', 'Store details'));
		more.append(this.budgetSummary(projection));
		if (projection.hot.skippedProtected.length > 0) {
			more.append(
				el(
					'p',
					`Kept your wording in ${projection.hot.skippedProtected.join(', ')}: no fact said otherwise yet.`,
					'oc-memory-hint',
				),
			);
		}
		more.append(this.passesSection(projection));
		panel.append(more);
		return panel;
	}

	/** The budget, the counts and the semantic arm, kept out of the document. */
	private budgetSummary(projection: MemoryProjection): HTMLElement {
		const status = projection.status;
		const summary = el('div', undefined, 'oc-memory-summary');
		const budget = el('div', undefined, 'oc-memory-budget');
		const used = Math.max(0, Math.min(1, status.injectedTokens / Math.max(1, projection.budget)));
		const meter = el('div', undefined, 'oc-memory-meter');
		const fill = el('div', undefined, 'oc-memory-meter-fill');
		fill.style.width = `${Math.round(used * 100)}%`;
		meter.append(fill);
		budget.append(
			el(
				'span',
				`About ${status.injectedTokens} tokens injected of a ${projection.budget} budget (${projection.tier} tier)`,
				'oc-memory-budget-label',
			),
			meter,
		);
		summary.append(
			el('span', `${status.facts} current`, 'oc-memory-chip'),
			el('span', `${status.history} in history`, 'oc-memory-chip'),
			el('span', `${status.notes} notes`, 'oc-memory-chip'),
			el('span', `${status.estimatedTokens} in MEMORY.md`, 'oc-memory-chip'),
			el(
				'span',
				status.embedding.available
					? `Semantic arm: ${status.embedding.model ?? 'ready'}`
					: `Semantic arm unavailable: ${status.embedding.reason || 'no embedding model'}`,
				status.embedding.available ? 'oc-memory-chip' : 'oc-memory-chip is-warn',
			),
			budget,
		);
		return summary;
	}

	/** The consolidation passes, with a way to revert one. */
	private passesSection(projection: MemoryProjection): HTMLElement {
		const passes = el('section', undefined, 'oc-memory-passes');
		passes.append(el('h3', 'Consolidation passes', 'oc-memory-section-title'));
		if (!projection.dreams.length) passes.append(el('p', 'No consolidation pass has run yet.', 'oc-memory-empty'));
		for (const dream of projection.dreams) {
			const row = el('article', undefined, 'oc-memory-pass');
			const meta = el('div', undefined, 'oc-memory-pass-meta');
			meta.append(
				el('span', stamp(dream.startedAt), 'oc-memory-chip'),
				el('span', dream.model || 'no model', 'oc-memory-chip'),
				el('span', dream.status || 'unknown', 'oc-memory-chip'),
				el('span', `${dream.created} created`, 'oc-memory-chip'),
				el('span', `${dream.retracted} retired`, 'oc-memory-chip'),
				...(dream.conflicts > 0 ? [el('span', `${dream.conflicts} flagged`, 'oc-memory-chip is-warn')] : []),
			);
			row.append(meta, el('p', dream.id, 'oc-memory-pass-id'));
			row.append(
				button('Revert', () => {
					void this.send({ action: 'revert-dream', dreamId: dream.id });
				}, 'oc-memory-quiet'),
			);
			passes.append(row);
		}
		return passes;
	}

	// -------------------------------------------------------------- document

	private formatButton(label: string, name: string, className: string, onClick: () => void): HTMLButtonElement {
		const node = button(label, onClick, `oc-memory-format ${className}`.trim());
		node.setAttribute('aria-label', name);
		node.title = name;
		// A toolbar button must not take the caret out of the document, or the
		// selection it is meant to format is gone before the click lands.
		node.addEventListener('mousedown', (event) => event.preventDefault());
		return node;
	}

	private documentArea(): HTMLTextAreaElement | null {
		return this.root?.querySelector<HTMLTextAreaElement>('.oc-memory-document') ?? null;
	}

	/** Wrap the selection in a pair of marks, or take them off again. */
	private wrapSelection(mark: string): void {
		const area = this.documentArea();
		if (!area) return;
		const start = area.selectionStart;
		const end = area.selectionEnd;
		const selected = area.value.slice(start, end);
		const wrapped = selected.startsWith(mark) && selected.endsWith(mark) && selected.length >= mark.length * 2;
		if (wrapped) {
			const inner = selected.slice(mark.length, selected.length - mark.length);
			this.replaceRange(area, start, end, inner, start, start + inner.length);
			return;
		}
		const insert = `${mark}${selected}${mark}`;
		this.replaceRange(area, start, end, insert, start + mark.length, start + mark.length + selected.length);
	}

	/** Put a markdown line marker on every selected line, or take it off. */
	private prefixLines(kind: 'h1' | 'h2' | 'h3' | 'bullet' | 'number'): void {
		const area = this.documentArea();
		if (!area) return;
		const value = area.value;
		const start = value.lastIndexOf('\n', Math.max(0, area.selectionStart - 1)) + 1;
		const newline = value.indexOf('\n', area.selectionEnd);
		const end = newline === -1 ? value.length : newline;
		const block = value.slice(start, end);
		const lines = block.length > 0 ? block.split('\n') : [''];
		const marker = kind === 'bullet' ? '- ' : kind === 'number' ? '1. ' : `${'#'.repeat(Number(kind.slice(1)))} `;
		const already = (line: string): boolean =>
			kind === 'bullet'
				? /^\s*-\s+/.test(line)
				: kind === 'number'
					? /^\s*\d+\.\s+/.test(line)
					: line.startsWith(marker);
		const toggleOff = lines.length > 0 && lines.every((line) => line.trim().length === 0 || already(line));
		const replaced = lines
			.map((line) => {
				if (line.trim().length === 0) return line;
				if (!toggleOff) return `${marker}${line}`;
				if (kind === 'bullet') return line.replace(/^(\s*)-\s+/, '$1');
				if (kind === 'number') return line.replace(/^(\s*)\d+\.\s+/, '$1');
				return line.startsWith(marker) ? line.slice(marker.length) : line;
			})
			.join('\n');
		this.replaceRange(area, start, end, replaced, start, start + replaced.length);
	}

	/** Put text into the document, keeping the draft and the dirty mark in step. */
	private replaceRange(
		area: HTMLTextAreaElement,
		start: number,
		end: number,
		text: string,
		selectStart: number,
		selectEnd: number,
	): void {
		area.value = `${area.value.slice(0, start)}${text}${area.value.slice(end)}`;
		area.focus();
		area.setSelectionRange(selectStart, selectEnd);
		this.documentDraft = area.value;
		this.documentDirty = area.value !== (this.projection?.hot.text ?? '');
		this.setDocumentState(this.documentDirty ? 'Unsaved changes' : 'Saved to MEMORY.md');
	}

	private setDocumentState(text: string): void {
		const node = this.root?.querySelector('.oc-memory-doc-state');
		if (node) node.textContent = text;
	}

	/**
	 * Write the edited document back to MEMORY.md through the worker.
	 *
	 * The draft is kept until the projection shows the saved file, so a command
	 * that fails does not cost the user the text they just wrote.
	 */
	private async saveDocument(text: string): Promise<void> {
		if (text.trim().length === 0) {
			this.notice = 'MEMORY.md cannot be saved empty. Forget a fact to remove it, or write a line first.';
			this.render();
			return;
		}
		this.documentDraft = text;
		this.documentDirty = true;
		await this.send({ action: 'write-hot', content: text });
		// The file is the user's text with a trailing newline, so the draft can
		// be dropped once the projection shows that the write landed.
		const saved = (this.projection?.hot.text ?? '').replace(/\r\n?/g, '\n');
		const expected = text.replace(/\r\n?/g, '\n');
		if (saved === (expected.endsWith('\n') ? expected : `${expected}\n`)) {
			this.documentDraft = null;
			this.documentDirty = false;
		}
		this.render();
	}

	// ----------------------------------------------------------------- daily

	/**
	 * The daily notes, read as a day of sentences.
	 *
	 * The days stay in a list on the left, as they were, but the day itself
	 * reads as prose: the time a thing was remembered and what was said. The
	 * ids and the sessions the note file keeps are not shown.
	 */
	private dailyPanel(projection: MemoryProjection): HTMLElement {
		const panel = el('div', undefined, 'oc-memory-panel');
		const days = projection.daily ?? [];
		panel.append(
			el(
				'p',
				'A day at a time: what Ramo remembered, changed or forgot, in the order it happened.',
				'oc-memory-hint',
			),
		);
		if (!days.length) {
			panel.append(el('p', 'No day has been written yet.', 'oc-memory-empty'));
			return panel;
		}
		const layout = el('div', undefined, 'oc-memory-notes');
		const list = el('div', undefined, 'oc-memory-note-list');
		for (const day of days) {
			const selected = (this.selectedDay || days[0].date) === day.date;
			const node = button(
				day.label,
				() => {
					this.selectedDay = day.date;
					this.render();
				},
				selected ? 'is-active' : '',
			);
			list.append(
				node,
				el(
					'p',
					`${day.entries.length} ${day.entries.length === 1 ? 'entry' : 'entries'}`,
					'oc-memory-note-description',
				),
			);
		}
		layout.append(list);

		const detail = el('div', undefined, 'oc-memory-note-detail');
		const day = days.find((entry) => entry.date === this.selectedDay) ?? days[0];
		detail.append(el('h3', day.label, 'oc-memory-note-title'));
		detail.append(el('p', day.header, 'oc-memory-hint'));
		const entries = el('div', undefined, 'oc-memory-entries');
		for (const entry of day.entries) {
			const line = el('p', undefined, 'oc-memory-entry');
			line.append(el('span', entry.time, 'oc-memory-entry-time'));
			line.append(document.createTextNode(` — ${entry.text}`));
			entries.append(line);
		}
		if (!day.entries.length) {
			entries.append(el('p', 'Nothing was remembered or changed on this day.', 'oc-memory-empty'));
		}
		detail.append(entries);
		layout.append(detail);
		panel.append(layout);
		return panel;
	}

	// ----------------------------------------------------------------- notes

	/**
	 * The vault, read as notes.
	 *
	 * A note is a header — its name and what it says about the subject — and
	 * the facts it holds under a heading. The links to the other notes are
	 * links the reader can follow. The frontmatter is not shown as YAML, and
	 * the facts are not repeated as cards: the timeline already lists them.
	 */
	private notesPanel(projection: MemoryProjection): HTMLElement {
		const panel = el('div', undefined, 'oc-memory-panel');
		const layout = el('div', undefined, 'oc-memory-notes');
		const list = el('div', undefined, 'oc-memory-note-list');
		list.setAttribute('role', 'tablist');
		for (const note of projection.notes) {
			const selected = (this.selectedNote || projection.notes[0]?.path) === note.path;
			const node = button(note.name, () => {
				this.selectedNote = note.path;
				this.render();
			}, selected ? 'is-active' : '');
			node.setAttribute('role', 'tab');
			const facts = note.groups.reduce((total, group) => total + group.facts.length, 0);
			list.append(
				node,
				el('p', `${facts} ${facts === 1 ? 'fact' : 'facts'}`, 'oc-memory-note-description'),
			);
		}
		if (!projection.notes.length) list.append(el('p', 'There are no notes yet.', 'oc-memory-empty'));
		layout.append(list);

		const detail = el('div', undefined, 'oc-memory-note-detail');
		const note = projection.notes.find((entry) => entry.path === this.selectedNote) ?? projection.notes[0];
		if (note) {
			detail.append(el('h3', note.name, 'oc-memory-note-title'));
			if (note.description) detail.append(el('p', note.description, 'oc-memory-note-about'));
			for (const group of note.groups) {
				if (!group.facts.length && !group.links.length) continue;
				detail.append(el('h4', group.heading, 'oc-memory-section-title'));
				if (group.facts.length) {
					const facts = el('ul', undefined, 'oc-memory-note-facts');
					for (const fact of group.facts) facts.append(el('li', fact, 'oc-memory-note-fact'));
					detail.append(facts);
				}
				if (group.links.length) {
					const links = el('div', undefined, 'oc-memory-note-links');
					for (const link of group.links) {
						const anchor = el('a', link.label, 'oc-memory-note-link');
						anchor.href = `#${link.target}`;
						anchor.addEventListener('click', (event) => {
							event.preventDefault();
							this.openNote(link.target);
						});
						links.append(anchor);
					}
					detail.append(links);
				}
			}
		} else {
			detail.append(el('p', 'Choose a note.', 'oc-memory-empty'));
		}
		layout.append(detail);
		panel.append(layout);
		return panel;
	}

	/** Open the note a link points at, when the vault holds one. */
	private openNote(target: string): void {
		const path = `notes/${target}.md`;
		const note = this.projection?.notes.find((entry) => entry.path === path);
		if (!note) {
			this.notice = `There is no note for ${target} yet.`;
			this.render();
			return;
		}
		this.selectedNote = note.path;
		this.render();
	}

	// -------------------------------------------------------------- timeline

	private timelinePanel(projection: MemoryProjection): HTMLElement {
		const panel = el('div', undefined, 'oc-memory-panel');
		const list = el('div', undefined, 'oc-memory-timeline');
		for (const fact of projection.timeline) list.append(this.factRow(fact));
		if (!projection.timeline.length) list.append(el('p', 'No facts have been recorded yet.', 'oc-memory-empty'));
		panel.append(list);
		return panel;
	}

	/**
	 * One fact, as a card a person reads.
	 *
	 * The card carries the statement, when it was remembered, whether it still
	 * holds and the words that justified it. The machine record — the id, the
	 * kind, the subject, the confidence, the session — stays in the store and
	 * is shown only when the reader asks for it.
	 */
	private factRow(fact: MemoryFactView): HTMLElement {
		const row = el('article', undefined, 'oc-memory-fact');
		if (fact.superseded) row.classList.add('is-history');
		if (fact.retracted) row.classList.add('is-retracted');

		if (this.editing === fact.id) {
			const editor = el('textarea', undefined, 'oc-memory-editor');
			editor.value = fact.text;
			editor.setAttribute('aria-label', 'Edit the fact');
			editor.rows = 3;
			const controls = el('div', undefined, 'oc-memory-fact-controls');
			controls.append(
				button('Save', () => {
					const text = editor.value.trim();
					this.editing = null;
					if (text.length < 4) {
						this.notice = 'A fact needs some text.';
						this.render();
						return;
					}
					void this.send({ action: 'edit-fact', text: fact.text, replace: text });
				}),
				button('Cancel', () => {
					this.editing = null;
					this.render();
				}, 'oc-memory-quiet'),
			);
			row.append(editor, controls);
		} else {
			row.append(el('p', fact.text, 'oc-memory-fact-text'));
			const when = el('p', undefined, 'oc-memory-fact-when');
			when.textContent = fact.status ? `${fact.recordedLabel} · ${fact.status}` : fact.recordedLabel;
			row.append(when);
			const controls = el('div', undefined, 'oc-memory-fact-controls');
			controls.append(
				button('Edit', () => {
					this.editing = fact.id;
					this.render();
				}, 'oc-memory-quiet'),
				button('Forget', () => {
					if (!confirm(`Forget "${fact.text}"? The record is kept, so this can be undone.`)) return;
					void this.send({ action: 'forget-fact', text: fact.text, reason: 'forgotten in the memory view' });
				}, 'oc-memory-quiet'),
			);
			row.append(controls);
		}

		if (fact.quote) row.append(el('p', `“${fact.quote}”`, 'oc-memory-quote'));
		row.append(this.factDetails(fact));
		return row;
	}

	/** The machine record, behind a detail the reader opens on purpose. */
	private factDetails(fact: MemoryFactView): HTMLElement {
		const details = el('details', undefined, 'oc-memory-details');
		details.append(el('summary', 'Details'));
		const body = el('dl', undefined, 'oc-memory-details-body');
		const rows: [string, string][] = [
			['Remembered', stamp(fact.recordedAt)],
			['Kind', fact.kind],
			['Subject', fact.subject],
			['Confidence', `${Math.round(fact.confidence * 100)}%`],
			['Source', fact.source],
			['Session', fact.sessionId ?? '—'],
			['Fact id', fact.id],
		];
		for (const [key, value] of rows) {
			body.append(el('dt', key, 'oc-memory-details-key'));
			body.append(el('dd', value, 'oc-memory-details-value'));
		}
		details.append(body);
		return details;
	}

	// ---------------------------------------------------------------- search

	private searchPanel(search: MemorySearch): HTMLElement {
		const panel = el('section', undefined, 'oc-memory-search-panel');
		const head = el('div', undefined, 'oc-memory-summary');
		head.append(el('h3', `“${search.query}”`, 'oc-memory-section-title'));
		for (const arm of search.arms) {
			const label =
				arm.status === 'unavailable'
					? `${arm.arm} unavailable`
					: `${arm.arm}: ${arm.candidates}`;
			head.append(el('span', label, arm.status === 'unavailable' ? 'oc-memory-chip is-warn' : 'oc-memory-chip'));
		}
		panel.append(head);
		if (search.interval) {
			panel.append(el('p', `Time: ${search.interval.label}`, 'oc-memory-hint'));
		}
		if (!search.facts.length) {
			panel.append(el('p', 'No stored fact answers that question.', 'oc-memory-empty'));
			return panel;
		}
		for (const fact of search.facts) {
			const row = el('article', undefined, 'oc-memory-fact');
			const meta = el('div', undefined, 'oc-memory-fact-meta');
			meta.append(el('span', `#${fact.rank}`, 'oc-memory-chip'));
			for (const arm of fact.arms) meta.append(el('span', arm, 'oc-memory-chip is-arm'));
			for (const reason of fact.raised) meta.append(el('span', reason, 'oc-memory-chip is-why'));
			for (const reason of fact.lowered) meta.append(el('span', reason, 'oc-memory-chip is-warn'));
			if (fact.superseded) meta.append(el('span', 'no longer current', 'oc-memory-chip is-warn'));
			row.append(meta, el('p', fact.text, 'oc-memory-fact-text'));
			panel.append(row);
		}
		return panel;
	}

	// ------------------------------------------------------------------ add

	private startAdd(): void {
		if (!this.root) return;
		const existing = this.root.querySelector('.oc-memory-add-form');
		if (existing) {
			existing.remove();
			return;
		}
		const form = el('div', undefined, 'oc-memory-add-form');
		const editor = el('textarea', undefined, 'oc-memory-editor');
		editor.placeholder = 'One fact, in the third person: “The user lives in Porto.”';
		editor.setAttribute('aria-label', 'New fact');
		editor.rows = 3;
		const controls = el('div', undefined, 'oc-memory-fact-controls');
		controls.append(
			button('Save', () => {
				const text = editor.value.trim();
				if (text.length < 4) {
					this.notice = 'A fact needs some text.';
					this.render();
					return;
				}
				form.remove();
				void this.send({ action: 'add-fact', text });
			}),
			button('Cancel', () => form.remove(), 'oc-memory-quiet'),
		);
		form.append(editor, controls);
		this.root.querySelector('.oc-memory-body')?.prepend(form);
		editor.focus();
	}
}
