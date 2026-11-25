/**
 * Lazy tool discovery (docs/tiered-shell-spec.md §2) — model-free checks.
 *
 * Layer 1 is a tiny index in the system prompt; layer 2 is the full schema,
 * returned by `tool_info` or just-in-time on an unloaded tool call. The core
 * set is the seven work tools, without codemode.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {WorkService} = require('../app/work/service.cjs');
import {
	CORE_TOOL_NAMES, TOOL_INFO_NAME, TOOL_INFO_DESCRIPTION,
	buildToolIndex, describeTool, exampleCall, createToolInfoCapability,
} from '../build/tool-discovery.js';

const answer = (onChunk, text = 'Done.') =>
	onChunk({choices: [{delta: {role: 'assistant', content: text}, finish_reason: 'stop'}], usage: {prompt_tokens: 20, completion_tokens: 2, total_tokens: 22}});
const toolCall = (onChunk, name, args, id) =>
	onChunk({choices: [{delta: {role: 'assistant', tool_calls: [{index: 0, id, type: 'function', function: {name, arguments: JSON.stringify(args)}}]}, finish_reason: 'tool_calls'}]});

function fixture(t, chat, hostTool = async () => ({ok: true})) {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ramo-discover-'));
	const cwd = path.join(tmp, 'project');
	fs.mkdirSync(cwd);
	const service = new WorkService({
		appDir: path.resolve('app'), dataDir: path.join(tmp, 'data'),
		models: async () => [{id: 'fixture', model: 'fixture', label: 'Fixture', context: 16384}],
		chat, hostTool,
	});
	t.after(async () => { await service.close(); fs.rmSync(tmp, {recursive: true, force: true}); });
	return {service, cwd};
}

const probe = {
	name: 'echo_probe',
	description: 'Echo a value back to the model. Use it to test discovery.',
	parameters: {type: 'object', properties: {value: {type: 'string'}}, required: ['value']},
};

test('core set is exactly the seven work tools, without codemode', () => {
	assert.deepEqual([...CORE_TOOL_NAMES].sort(), ['edit', 'find', 'grep', 'ls', 'powershell', 'read', 'write'].sort());
	assert.equal(CORE_TOOL_NAMES.has('codemode'), false);
	assert.equal(TOOL_INFO_DESCRIPTION.split(/[.;\n]/)[0].trim().length < 100, true, 'the describe tool stays one line');
});

test('the index is one line per tool plus the instruction, and stays tiny', () => {
	const declarations = [
		{name: 'read', description: 'Read a file. Use it to inspect a file before editing it.', parameters: {}},
		{name: 'codemode', description: 'Call several tools in one turn. Useful for batches.', parameters: {}},
	];
	const index = buildToolIndex(declarations);
	assert.match(index, /Call tool_info <name> once for a schema/);
	assert.match(index, /- read: Read a file\./);
	assert.match(index, /- codemode: Call several tools in one turn\./);
	assert.equal(index.split('\n').length, 4);
	assert.equal(index.includes('parameters'), false);
	assert.equal(index.includes(`- ${TOOL_INFO_NAME}:`), false, 'tool_info is already declared, not listed as an indexed tool');
});

test('tool_info returns the full schema and an example, exact name first then substring', async () => {
	const declarations = [
		probe,
		{name: 'browser_navigate', description: 'Navigate to a URL.', parameters: {type: 'object', properties: {url: {type: 'string'}}, required: ['url']}},
		{name: 'browser_click', description: 'Click an element.', parameters: {type: 'object', properties: {selector: {type: 'string'}}, required: ['selector']}},
	];
	const cap = createToolInfoCapability({declarations: () => declarations});
	const exact = await cap.execute('1', {name: 'browser_navigate'});
	assert.match(exact.content[0].text, /Schema:/);
	assert.match(exact.content[0].text, /Example: browser_navigate/);
	assert.match(exact.content[0].text, /"url"/);
	const substring = await cap.execute('2', {query: 'navig'});
	assert.match(substring.content[0].text, /Tool: browser_navigate/);
	const many = await cap.execute('3', {query: 'browser'});
	assert.match(many.content[0].text, /browser_navigate/);
	assert.match(many.content[0].text, /browser_click/);
	assert.match(many.content[0].text, /exact name/);
	const unknown = await cap.execute('4', {name: 'does_not_exist'});
	assert.equal(unknown.isError, true);
	assert.equal(describeTool(probe).includes('echo a value back'), false, 'purpose is one line, not the whole description');
	assert.match(exampleCall(probe), /"value":"value"/);
});

test('every tool is declared so real function calling works; only core schemas are full', async (t) => {
	const bodies = [];
	const {service, cwd} = fixture(t, async (_model, body, {onChunk}) => {
		bodies.push(body);
		answer(onChunk);
	});
	await service.request('open', {cwd, trusted: true, permission: 'ask', mode: 'assistant', model: 'fixture'});
	await service.request('prompt', {text: 'hello', model: 'fixture'});
	const declared = new Map(bodies[0].tools.map((tool) => [tool.function.name, tool.function]));
	for (const name of ['read', 'write', 'edit', 'ls', 'find', 'grep', 'powershell', 'tool_info', 'memory_recall', 'codemode', 'browser_navigate']) {
		assert.ok(declared.has(name), `the model can actually call ${name}`);
	}
	for (const name of ['read', 'write', 'edit', 'ls', 'find', 'grep', 'powershell']) {
		assert.ok(JSON.stringify(declared.get(name).parameters).length > 40, `${name} carries its full schema`);
	}
	for (const name of ['memory_recall', 'codemode', 'browser_navigate']) {
		const parameters = declared.get(name).parameters;
		assert.equal(parameters.additionalProperties, true, `${name} is permissive`);
		assert.ok(Object.keys(parameters.properties).length > 0, `${name} still exposes its argument names`);
		assert.ok(!JSON.stringify(parameters).includes('description'), `${name} has no full descriptions`);
	}
	const system = String(bodies[0].messages[0].content);
	assert.match(system, /Call tool_info <name> once for a schema/);
	for (const name of ['memory_recall', 'codemode', 'browser_navigate']) assert.match(system, new RegExp(`- ${name}:`));
	assert.equal(system.includes('"required"'), false, 'no full parameter schemas are sent in the index');
});

test('an unloaded tool call returns its schema, then the retry executes — first attempt never ran', async (t) => {
	const hostCalls = [];
	let call = 0;
	const {service, cwd} = fixture(t, async (_model, body, {onChunk}) => {
		call += 1;
		const results = body.messages.filter((message) => message.role === 'tool').length;
		if (call === 1) toolCall(onChunk, 'echo_probe', {value: 'first'}, 'jit1');
		else if (results >= 1 && call === 2) toolCall(onChunk, 'echo_probe', {value: 'second'}, 'jit2');
		else answer(onChunk, 'Discovery worked.');
	}, async (name, args) => { hostCalls.push({name, args}); return {echoed: args.value}; });
	await service.request('open', {cwd, trusted: true, permission: 'ask', mode: 'assistant', model: 'fixture', hostTools: [probe]});
	const state = await service.request('prompt', {text: 'Use the probe', model: 'fixture'});
	const jit = state.messages.find((message) => message.role === 'toolResult' && message.toolCallId === 'jit1');
	assert.ok(jit, 'the first call produced a tool result');
	assert.equal(jit.isError, false, 'discovery is not an error');
	assert.match(JSON.stringify(jit.content), /Schema:/);
	assert.match(JSON.stringify(jit.content), /Call echo_probe directly with your real arguments/);
	assert.deepEqual(hostCalls, [{name: 'echo_probe', args: {value: 'second'}}], 'only the retry reached the tool');
	assert.equal(call, 3);
});

test('a repeated identical tool call is stopped and the model gets one answer turn', async (t) => {
	let call = 0;
	const {service, cwd} = fixture(t, async (_model, body, {onChunk}) => {
		call += 1;
		if (call <= 3) toolCall(onChunk, 'tool_info', {name: 'browser_navigate'}, 'loop' + call);
		else answer(onChunk, 'I could not finish that, and here is what I know.');
	});
	await service.request('open', {cwd, trusted: true, permission: 'ask', mode: 'assistant', model: 'fixture'});
	const state = await service.request('prompt', {text: 'Open x.com', model: 'fixture'});
	assert.ok(call <= 4, `the loop was stopped after ${call} model calls`);
	assert.ok(state.messages.some((message) => message.role === 'toolResult'
		&& JSON.stringify(message.content).includes('same tool call was repeated')), 'the repeated call got a short stop result');
	assert.ok(state.messages.some((message) => message.role === 'assistant'
		&& JSON.stringify(message.content).includes('I could not finish that')), 'the final answer came from the model');
});

test('a genuinely unknown tool still gets the normal bounded error, not a discovery result', async (t) => {
	const hostCalls = [];
	let call = 0;
	const {service, cwd} = fixture(t, async (_model, body, {onChunk}) => {
		call += 1;
		if (call === 1) toolCall(onChunk, 'not_a_real_tool', {x: 1}, 'miss1');
		else answer(onChunk, 'That tool does not exist.');
	}, async (name, args) => { hostCalls.push(name); return {}; });
	await service.request('open', {cwd, trusted: true, permission: 'ask', mode: 'assistant', model: 'fixture'});
	const state = await service.request('prompt', {text: 'Call a missing tool', model: 'fixture'});
	const result = state.messages.find((message) => message.role === 'toolResult' && message.toolCallId === 'miss1');
	assert.equal(result.isError, true);
	assert.match(JSON.stringify(result.content), /not found/);
	assert.equal(JSON.stringify(result.content).includes('Schema:'), false);
	assert.deepEqual(hostCalls, []);
});
