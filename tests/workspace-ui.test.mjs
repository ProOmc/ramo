import test from 'node:test';
import assert from 'node:assert/strict';
import { RamoWorkspaceUI } from '../build/workspace.js';

/**
 * The workspace shell is a compatibility module, so the model-free suite
 * never loaded it. Two defects in it were invisible until a human used the
 * application:
 *
 *   - the chat composer stayed on screen over the Memory page, so a text box
 *     for the conversation floated over a page that has no conversation;
 *   - the answer that was streaming appeared before the question it was
 *     answering, because the question of a turn in flight is not in the
 *     store until the turn ends.
 *
 * This test loads the shipped module with the smallest DOM that renders a
 * conversation, then checks both.
 */

/** A DOM element with only what the workspace shell touches. */
function element(tag = 'div') {
	const node = {
		nodeType: 1,
		nodeName: tag.toUpperCase(),
		tagName: tag.toUpperCase(),
		style: {},
		dataset: {},
		attributes: {},
		children: [],
		childNodes: [],
		className: '',
		id: '',
		value: '',
		hidden: false,
		scrollTop: 0,
		scrollHeight: 0,
		clientHeight: 0,
		_html: '',
		_text: '',
		get firstElementChild() {
			return this.children[0] ?? null;
		},
		get innerHTML() {
			return this._html;
		},
		set innerHTML(value) {
			this._html = String(value);
			this.children = parseHTML(this._html);
			this.childNodes = [...this.children];
		},
		get textContent() {
			return this._text;
		},
		set textContent(value) {
			this._text = String(value);
			this.children = [];
			this.childNodes = [];
		},
		append(...nodes) {
			for (const child of nodes) {
				this.children.push(child);
				this.childNodes.push(child);
			}
		},
		appendChild(child) {
			this.children.push(child);
			this.childNodes.push(child);
			return child;
		},
		replaceChildren(...nodes) {
			this.children = [];
			this.childNodes = [];
			this.append(...nodes);
		},
		remove() {},
		querySelector() {
			return null;
		},
		querySelectorAll() {
			return [];
		},
		setAttribute(name, value) {
			this.attributes[name] = String(value);
		},
		getAttribute(name) {
			return name in this.attributes ? this.attributes[name] : null;
		},
		hasAttribute(name) {
			return name in this.attributes;
		},
		removeAttribute(name) {
			delete this.attributes[name];
		},
		cloneNode() {
			return element(this.tagName.toLowerCase());
		},
		focus() {},
	};
	return node;
}

/** The leaf elements of a fragment of HTML, enough for the shapes used here. */
function parseHTML(html) {
	const nodes = [];
	const pattern = /<([a-z]+)\b([^>]*)>([^<]*)<\/\1>/gi;
	let match;
	while ((match = pattern.exec(html))) {
		const node = element(match[1]);
		node.textContent = match[3];
		nodes.push(node);
	}
	return nodes;
}

/** A workspace shell with the state a conversation needs. */
function setup({ page = 'home', messages = [], busy = false, live = '', text = '', index } = {}) {
	const values = new Map();
	globalThis.localStorage = {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, String(value)),
		removeItem: (key) => values.delete(key),
	};
	globalThis.RamoState = {
		get: (key) => values.get(key),
		set: (key, value) => {
			values.set(key, value);
		},
	};
	globalThis.document = {
		createElement: (tag) => element(tag),
		getElementById: () => null,
		querySelector: () => null,
		querySelectorAll: () => [],
		head: element('head'),
		body: element('body'),
		hidden: false,
		addEventListener() {},
		dispatchEvent() {},
	};
	globalThis.window = {
		innerWidth: 1200,
		innerHeight: 800,
		addEventListener() {},
		dispatchEvent() {},
	};
	// The live turn is what the assistant is working on now. The store has
	// no message for it until the turn ends.
	globalThis.__ramoAssistantInstance = {
		session: live
			? { chatId: 'main', turn: { raw: live, index: index ?? messages.length } }
			: null,
		engine: { store: { data: { chats: [] } } },
	};
	values.set('tamai_shell_text_out_v1', text);
	const ui = new RamoWorkspaceUI();
	ui.currentPage = page;
	ui.workspaceContent = element('div');
	ui.chatView = { active: 'main', chats: [], messages, busy };
	ui.lastCanvasRect = { w: 1200, h: 800 };
	ui.lastLayout = { stageW: 1200, stageH: 800 };
	return ui;
}

/** The cards the shell rendered, in the order it rendered them. */
function cards(ui) {
	const scroll = ui.workspaceContent.children[0];
	const read = scroll.children[0];
	return read.children;
}

test('the chat composer is hidden on a page that is not the conversation', () => {
	const ui = setup({ page: 'memory' });
	ui.composer = element('div');
	ui._syncVisibility();
	assert.equal(ui.composer.style.display, 'none', 'the composer was still shown on the Memory page');
	ui.currentPage = 'home';
	ui._syncVisibility();
	assert.equal(ui.composer.style.display, 'flex', 'the composer did not come back on the conversation page');
});

test('the composer is laid out hidden on a page that is not the conversation', () => {
	// The layout pass writes the composer's own styles, so it must agree
	// with the visibility pass: otherwise a resize would put the input
	// back over the page.
	const ui = setup({ page: 'memory' });
	ui.composer = element('div');
	const geometry = { composerH: 60, composerLeft: 10, composerBottom: 10, composerWidth: 800 };
	ui._styleComposer(geometry);
	assert.equal(ui.composer.style.display, 'none');
	ui.currentPage = 'home';
	ui._styleComposer(geometry);
	assert.equal(ui.composer.style.display, 'flex');
});

test('the answer that is streaming is rendered after the question it answers', () => {
	// A turn in flight is not in the store yet, so the question is drawn
	// from the live turn. The answer that is streaming belongs after it.
	const ui = setup({ busy: true, live: 'What is the weather?', text: 'It is raining.' });
	ui._renderHome(true);
	const rendered = cards(ui);
	assert.equal(rendered.length, 2, 'the question and the answer were not both rendered');
	assert.equal(rendered[0].className, 'ramo-w-chat user');
	assert.equal(rendered[1].className, 'ramo-w-chat assistant');
	assert.equal(rendered[0].textContent, 'YOU · What is the weather?');
	assert.ok(rendered[1].innerHTML.includes('It is raining.'), 'the streamed answer was not rendered');
});

test('the answer that is streaming follows the question of the turn in flight', () => {
	const ui = setup({
		messages: [{ user: 'Earlier question', assistant: 'Earlier answer' }],
		busy: true,
		live: 'New question',
		text: 'New answer',
	});
	ui._renderHome(true);
	const rendered = cards(ui);
	const classes = rendered.map((card) => card.className);
	assert.deepEqual(classes, [
		'ramo-w-chat user',
		'ramo-w-chat assistant',
		'ramo-w-chat user',
		'ramo-w-chat assistant',
	]);
	const lastUser = classes.lastIndexOf('ramo-w-chat user');
	const lastAnswer = classes.lastIndexOf('ramo-w-chat assistant');
	assert.ok(lastUser < lastAnswer, 'the streamed answer came before the question it answers');
	assert.equal(rendered[lastUser].textContent, 'YOU · New question');
	assert.ok(rendered[lastAnswer].innerHTML.includes('New answer'));
	// The earlier turn keeps its own place: the speaker and the answer.
	assert.equal(rendered[0].children[0].textContent, 'YOU');
	assert.ok(rendered[1].children[1].innerHTML.includes('Earlier answer'), 'the earlier turn was lost');
});

test('a finished turn is rendered once, with no second copy of the question', () => {
	// The store already holds the turn, so the question and the answer are
	// messages of their own and must not be drawn a second time.
	const ui = setup({
		messages: [{ user: 'Question', assistant: 'Answer' }],
		busy: false,
		live: 'Question',
		text: 'Answer',
		index: 0,
	});
	ui._renderHome(true);
	const rendered = cards(ui);
	assert.deepEqual(
		rendered.map((card) => card.className),
		['ramo-w-chat user', 'ramo-w-chat assistant'],
	);
});

test('a question that repeats an earlier one is still shown while it streams', () => {
	// The same question twice is two turns. The second one must show its own
	// question, or the answer appears with nothing above it.
	const ui = setup({
		messages: [{ user: 'Same question', assistant: 'Same answer' }],
		busy: true,
		live: 'Same question',
		text: 'Same answer',
	});
	ui._renderHome(true);
	const rendered = cards(ui);
	assert.deepEqual(
		rendered.map((card) => card.className),
		[
			'ramo-w-chat user',
			'ramo-w-chat assistant',
			'ramo-w-chat user',
			'ramo-w-chat assistant',
		],
		'the repeated question and its answer were not shown',
	);
	assert.equal(rendered[2].textContent, 'YOU · Same question');
	assert.ok(rendered[3].innerHTML.includes('Same answer'));
});

test('the answer of the turn in flight is not shown twice once the store holds it', () => {
	// The moment the store writes the turn down, the answer is a message of
	// its own and must not also be shown as the answer that is streaming.
	const ui = setup({
		messages: [
			{ user: 'First question', assistant: 'First answer' },
			{ user: 'Second question', assistant: 'Second answer' },
		],
		busy: true,
		live: 'Second question',
		text: 'Second answer',
		index: 1,
	});
	ui._renderHome(true);
	const rendered = cards(ui);
	assert.deepEqual(
		rendered.map((card) => card.className),
		['ramo-w-chat user', 'ramo-w-chat assistant', 'ramo-w-chat user', 'ramo-w-chat assistant'],
		'the answer was shown twice',
	);
});
