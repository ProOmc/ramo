import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

/**
 * The Work view is authored DOM, not the renderer bundle, so the model-free
 * suite never loaded it. That left a real defect invisible: after the Pi
 * terminal was removed, the progress handler still referred to the terminal's
 * state variable, and every progress event threw in the renderer.
 *
 * This test loads the shipped Work script in a sandbox with the smallest
 * possible DOM, then delivers the events the runtime sends, and fails if the
 * view throws.
 */

const source = fs.readFileSync(path.resolve('app/work/ui.js'), 'utf8');

function loadWorkView() {
	const handlers = [];
	const element = () => ({
		style: {},
		dataset: {},
		classList: { add() {}, remove() {}, toggle() {} },
		append() {},
		appendChild() {},
		replaceChildren() {},
		setAttribute() {},
		addEventListener() {},
		querySelector: () => null,
		querySelectorAll: () => [],
	});
	const documentStub = {
		addEventListener() {},
		getElementById: () => null,
		querySelector: () => null,
		querySelectorAll: () => [],
		createElement: element,
		body: element(),
		dispatchEvent() {},
	};
	const windowStub = {
		RamoWorkActivity: {
			view: () => ({ phase: 'idle', label: 'Ready', tokenLabel: '0', tokenTitle: '', elapsed: '0s' }),
			mode: (value) => value,
		},
		RamoRuntime: {
			request: async () => ({}),
			onEvent: (handler) => handlers.push(handler),
		},
	};
	const sandbox = {
		console,
		window: windowStub,
		document: documentStub,
		setInterval: () => 0,
		clearInterval: () => {},
		setTimeout: () => 0,
		clearTimeout: () => {},
	};
	vm.createContext(sandbox);
	vm.runInContext(source, sandbox, { filename: 'app/work/ui.js' });
	return { handlers, sandbox };
}

test('The Work view registers its event handler', () => {
	const { handlers, sandbox } = loadWorkView();
	assert.ok(handlers.length > 0, 'the Work view registered no event handler');
	assert.ok(sandbox.window.RamoWork, 'the Work view did not publish itself');
});

test('The Work view handles the runtime events without a renderer exception', async () => {
	const { handlers } = loadWorkView();
	const events = [
		{ type: 'work_progress', sessionId: 'session-1', phase: 'processing', generated: 12, exact: true, startedAt: Date.now(), lastTokenAt: Date.now(), endedAt: null },
		{ type: 'work_progress', sessionId: 'session-1', phase: 'complete', generated: 40, exact: true, startedAt: Date.now(), lastTokenAt: Date.now(), endedAt: Date.now() },
		{ type: 'notification', message: 'Starting the model' },
		{ type: 'worker_exit' },
	];
	for (const event of events) {
		await assert.doesNotReject(async () => handlers[0](event), `the Work view threw on ${event.type}`);
	}
});

test('The Work view no longer refers to the removed terminal', () => {
	// The terminal view was removed with the Pi harness. A remaining reference
	// to its state is a defect the native UI would show as a thrown error.
	const bare = source.match(/(?<![.\w$])(term|termResize)(?![\w$])/g) || [];
	assert.deepEqual(bare, [], 'the Work view still refers to the removed terminal');
});

test('The Work view adds no button to the navigation', () => {
	// Chat and Work are one surface, so there is no Work entry point in the
	// sidebar. The view used to inject one every 400ms, which put a second
	// door into the same conversation surface.
	assert.ok(
		!/dataset\.page\s*=\s*['"]work['"]/.test(source),
		'the Work view still marks a navigation item as the work page',
	);
	assert.ok(
		!/getElementById\(\s*['"]oc-studio-sidebar['"]\s*\)/.test(source),
		'the Work view still reaches into the studio sidebar',
	);
});

test('The Work view stays reachable for the operations only it offers', () => {
	// The navigation entry is gone, but the operations that live only here —
	// sessions, changes, export, manual compaction, forking, project resources
	// and the tool-access selector — must not be lost with it.
	const { sandbox } = loadWorkView();
	const work = sandbox.window.RamoWork;
	assert.ok(work, 'the Work view did not publish itself');
	for (const method of ['show', 'close', 'request', 'getState']) {
		assert.equal(typeof work[method], 'function', `the Work view lost ${method}`);
	}
});
