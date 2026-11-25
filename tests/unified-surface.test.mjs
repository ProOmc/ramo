/**
 * The unified surface: Chat and Work run one session service with one
 * capability set.
 *
 * These checks are model-free. The fake model answers the way a model that
 * used a tool does, so the request body, the capability call, the tool result
 * and the permission question all travel the real path of the shipped worker.
 * What the model *decides* is not assessed here; what the surface *offers*
 * and what it *writes* are.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {WorkService} = require('../app/work/service.cjs');

/** The work tools the unified surface offers in every conversation. */
const WORK_TOOLS = ['read', 'write', 'edit', 'ls', 'find', 'grep', 'powershell', 'codemode'];
/** Lazy discovery: only these schemas are declared every turn (spec §2.2). */
const CORE_TOOLS = ['read', 'write', 'edit', 'ls', 'find', 'grep', 'powershell', 'tool_info'];

const answer = (onChunk, text = 'Done.') =>
	onChunk({choices: [{delta: {role: 'assistant', content: text}, finish_reason: 'stop'}], usage: {prompt_tokens: 20, completion_tokens: 2, total_tokens: 22}});

const toolCall = (onChunk, name, args, id = 'call_1') =>
	onChunk({choices: [{delta: {role: 'assistant', tool_calls: [{index: 0, id, type: 'function', function: {name, arguments: JSON.stringify(args)}}]}, finish_reason: 'tool_calls'}]});

/** Wait for a condition that a background pass will satisfy. */
async function waitFor(check, timeout = 15000) {
	const started = Date.now();
	while (Date.now() - started < timeout) {
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error('The condition was not met in time.');
}

/**
 * A fixture of the shipped worker.
 *
 * The interface answers the permission question the way the Chat surface does:
 * the user is asked before anything changes. `options.approve=false` refuses
 * instead, and `options.port` points the background memory pass at a local
 * fixture rather than at a model.
 */
function fixture(t, chat, options = {}) {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ramo-unified-'));
	const cwd = path.join(tmp, 'conversation');
	fs.mkdirSync(cwd);
	const dataDir = path.join(tmp, 'data');
	const model = {id: 'fixture', model: 'fixture', label: 'Protocol fixture', context: 16384, ...(options.port ? {port: options.port} : {})};
	const service = new WorkService({appDir: path.resolve('app'), dataDir, models: async () => [model], chat, hostTool: async () => ({ok: true})});
	const events = [];
	service.on('event', (event) => {
		events.push(event);
		if (event.type === 'ui_request') void service.request('uiResponse', {id: event.id, value: options.approve !== false});
	});
	t.after(async () => {
		await service.close();
		fs.rmSync(tmp, {recursive: true, force: true});
	});
	return {service, cwd, dataDir, tmp, events, model};
}

/** The last answer of a turn, and the proof that the turn really finished. */
function answered(state) {
	const last = state.messages.filter((message) => message.role === 'assistant').at(-1);
	assert.equal(last?.stopReason, 'stop', `the turn failed: ${last?.errorMessage || 'no answer'}`);
	return last;
}

test('a plain question in the unified Chat uses no tool', async (t) => {
	const bodies = [];
	const {service, cwd} = fixture(t, async (_model, body, {onChunk}) => {
		bodies.push(body);
		answer(onChunk, 'Lisbon is the capital of Portugal.');
	});
	await service.request('open', {cwd, trusted: true, permission: 'ask', mode: 'assistant', model: 'fixture', key: 'main'});
	const state = await service.request('prompt', {text: 'What is the capital of Portugal?', model: 'fixture'});
	answered(state);
	// The seven core schemas plus tool_info are declared every turn; the rest
	// are discoverable through the tiny index in the system prompt.
	const offered = (bodies[0].tools || []).map((tool) => tool.function.name);
	for (const name of CORE_TOOLS) assert.ok(offered.includes(name), `the unified Chat declares ${name}`);
	const system = String(bodies[0].messages[0].content);
	for (const name of WORK_TOOLS) assert.ok(system.includes(name), `the tiny index lists ${name}`);
	assert.match(system, /Call tool_info <name> once for a schema/);
	// The rule that decides when they are used travels with the prompt.
	assert.match(system, /without calling a tool/i);
	assert.match(system, /Never start work the user did not ask for/i);
	// The model chose to answer directly, and nothing changed on disk.
	assert.equal(state.messages.filter((message) => message.role === 'toolResult').length, 0);
	assert.deepEqual(fs.readdirSync(cwd), []);
});

test('a build request in the unified Chat uses the Work tools once the interface approves', async (t) => {
	const {service, cwd, events} = fixture(t, async (_model, body, {onChunk}) => {
		const results = body.messages.filter((message) => message.role === 'tool').length;
		if (results === 0) toolCall(onChunk, 'write', {path: 'built.txt', content: 'UNIFIED'});
		else if (results === 1) toolCall(onChunk, 'powershell', {command: 'Get-Content built.txt'});
		else answer(onChunk, 'The file was written and read back.');
	});
	await service.request('open', {cwd, trusted: true, permission: 'ask', mode: 'assistant', model: 'fixture', key: 'main'});
	const state = await service.request('prompt', {text: 'Build a file called built.txt', model: 'fixture'});
	answered(state);
	assert.equal(fs.readFileSync(path.join(cwd, 'built.txt'), 'utf8'), 'UNIFIED');
	assert.ok(state.messages.some((message) => message.role === 'toolResult' && message.toolName === 'write' && !message.isError));
	assert.ok(state.messages.some((message) => message.role === 'toolResult' && message.toolName === 'powershell' && !message.isError && JSON.stringify(message.content).includes('UNIFIED')));
	// The Chat asks before it changes anything.
	const approvals = events.filter((event) => event.type === 'ui_request' && event.method === 'permission');
	assert.ok(approvals.length >= 2, 'the Chat asks before it writes and before it runs a command');
});

test('the unified Chat asks before it changes anything, and a refusal stops it', async (t) => {
	const {service, cwd, events} = fixture(t, async (_model, body, {onChunk}) => {
		const results = body.messages.filter((message) => message.role === 'tool').length;
		if (results === 0) toolCall(onChunk, 'write', {path: 'refused.txt', content: 'NO'});
		else answer(onChunk, 'The write was declined.');
	}, {approve: false});
	await service.request('open', {cwd, trusted: true, permission: 'ask', mode: 'assistant', model: 'fixture', key: 'main'});
	await service.request('prompt', {text: 'Build refused.txt', model: 'fixture'});
	assert.equal(fs.existsSync(path.join(cwd, 'refused.txt')), false, 'the refused write never happened');
	assert.ok(events.some((event) => event.type === 'ui_request' && event.method === 'permission'), 'the Chat asked before it wrote');
});

test('an isolated Chat still writes nothing to the global memory store', async (t) => {
	// The extractor is a local fixture, not a model. It counts the calls the
	// worker makes and answers with one fact, so the test can tell a refusal
	// from a write that never happened.
	let extractorCalls = 0;
	const extractor = http.createServer((_request, response) => {
		extractorCalls++;
		response.writeHead(200, {'Content-Type': 'application/json'});
		response.end(JSON.stringify({
			message: {content: JSON.stringify({items: ['The user lives in Lisbon.']})},
			prompt_eval_count: 10,
			eval_count: 5,
		}));
	});
	await new Promise((resolve) => extractor.listen(0, '127.0.0.1', resolve));
	const port = extractor.address().port;
	t.after(() => new Promise((resolve) => extractor.close(resolve)));

	// The shared conversation retains what the user said, so the store is live.
	const shared = fixture(t, async (_model, body, {onChunk}) => {
		answer(onChunk, 'Noted.');
	}, {port});
	await shared.service.request('open', {cwd: shared.cwd, trusted: true, permission: 'ask', mode: 'assistant', model: 'fixture', key: 'main'});
	await shared.service.request('prompt', {text: 'I live in Lisbon.', model: 'fixture'});
	const sharedFacts = path.join(shared.dataDir, 'memory', 'facts.jsonl');
	// The new model writes prose into today's daily note, not into facts.jsonl.
	// The fact-store file is not expected to exist; the daily note is the write.
	await waitFor(() => {
		const dir = path.join(shared.dataDir, 'memory', 'notes', 'daily');
		if (!fs.existsSync(dir)) return false;
		return fs.readdirSync(dir).some((name) => {
			try { return fs.readFileSync(path.join(dir, name), 'utf8').includes('Lisbon'); } catch { return false; }
		});
	});
	assert.ok(extractorCalls >= 1, 'the shared conversation does retain what the user said');

	// A separate conversation is isolated: it has no memory capability, it
	// never asks the extractor, and the store stays as it was.
	const isolated = fixture(t, async (_model, body, {onChunk}) => {
		answer(onChunk, 'Noted.');
	}, {port});
	await isolated.service.request('open', {cwd: isolated.cwd, trusted: true, permission: 'ask', mode: 'assistant', model: 'fixture', key: 'chat_2'});
	const resources = await isolated.service.request('resources');
	assert.deepEqual(resources.activeTools.filter((name) => name.startsWith('memory_')), [], 'an isolated conversation has no memory capability');
	const before = extractorCalls;
	await isolated.service.request('prompt', {text: 'I live in Lisbon.', model: 'fixture'});
	await new Promise((resolve) => setTimeout(resolve, 1500));
	assert.equal(extractorCalls, before, 'the isolated conversation never asked the extractor to write');
	assert.equal(fs.existsSync(path.join(isolated.dataDir, 'memory', 'facts.jsonl')), false, 'the global store of the isolated conversation is untouched');
	const isolatedDaily = path.join(isolated.dataDir, 'memory', 'notes', 'daily');
	assert.equal(fs.existsSync(isolatedDaily) ? fs.readdirSync(isolatedDaily).length : 0, 0, 'the isolated conversation wrote no daily note either');
});

test('a conversation bound to a project reaches the project files', async (t) => {
	const {service, cwd} = fixture(t, async (_model, body, {onChunk}) => {
		const results = body.messages.filter((message) => message.role === 'tool').length;
		if (results === 0) toolCall(onChunk, 'read', {path: 'notes.txt'});
		else answer(onChunk, 'The notes were read.');
	});
	fs.writeFileSync(path.join(cwd, 'notes.txt'), 'PROJECT_NOTES');
	await service.request('open', {cwd, trusted: true, permission: 'ask', mode: 'project', model: 'fixture', key: 'main'});
	const state = await service.request('prompt', {text: 'Read notes.txt', model: 'fixture'});
	answered(state);
	assert.ok(state.messages.some((message) => message.role === 'toolResult' && message.toolName === 'read' && !message.isError && JSON.stringify(message.content).includes('PROJECT_NOTES')));
});

test('Chat and Work offer the same capability set', async (t) => {
	const {service, cwd} = fixture(t, async (_model, body, {onChunk}) => {
		answer(onChunk);
	});
	await service.request('open', {cwd, trusted: true, permission: 'ask', mode: 'assistant', model: 'fixture', key: 'main'});
	const chatTools = (await service.request('resources')).activeTools;
	await service.request('open', {cwd, trusted: true, permission: 'ask', mode: 'project', model: 'fixture', key: 'main'});
	const workTools = (await service.request('resources')).activeTools;
	for (const name of WORK_TOOLS) {
		assert.ok(chatTools.includes(name), `Chat offers ${name}`);
		assert.ok(workTools.includes(name), `Work offers ${name}`);
	}
});
