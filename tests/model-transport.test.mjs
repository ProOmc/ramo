import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { streamResponse } from '../build/model-client.js';

/**
 * The model transport has to fail in a bounded, explainable way.
 *
 * A local gateway can stall while a model loads, and a stalled model must not
 * hold a task open for minutes. These tests drive the transport against real
 * local servers that misbehave in the three ways that matter: they never
 * answer, they drop the connection, and they answer after a retry.
 */

/** A server that accepts the request and never answers. */
function startSilentServer() {
	let requests = 0;
	const server = http.createServer((req, res) => {
		requests++;
		req.resume();
		// The response is never written: the socket stays open.
		res.on('close', () => {});
	});
	return new Promise((resolve) =>
		server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, count: () => requests })),
	);
}

/** A server that drops the first connections and answers the rest. */
function startFlakyServer(failures) {
	let requests = 0;
	const server = http.createServer((req, res) => {
		requests++;
		req.resume();
		if (requests <= failures) {
			req.socket.destroy();
			return;
		}
		res.writeHead(200, { 'Content-Type': 'text/event-stream' });
		res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Recovered.' } }] }) + '\n\n');
		res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n');
		res.write('data: [DONE]\n\n');
		res.end();
	});
	return new Promise((resolve) =>
		server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, count: () => requests })),
	);
}

/** A server that answers with a refusal. */
function startRefusingServer() {
	let requests = 0;
	const server = http.createServer((req, res) => {
		requests++;
		req.resume();
		res.writeHead(400, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: { message: 'the model is not loaded' } }));
	});
	return new Promise((resolve) =>
		server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, count: () => requests })),
	);
}

/** A server that streams an answer with a usage chunk and no timing fields (llama.cpp). */
function startNoTimingServer() {
	const server = http.createServer(async (req, res) => {
		req.resume();
		res.writeHead(200, { 'Content-Type': 'text/event-stream' });
		res.write('data: ' + JSON.stringify({ choices: [{ delta: { role: 'assistant', content: null } }] }) + '\n\n');
		await new Promise((r) => setTimeout(r, 60));
		res.write('data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'think' } }] }) + '\n\n');
		await new Promise((r) => setTimeout(r, 60));
		res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }) + '\n\n');
		await new Promise((r) => setTimeout(r, 60));
		res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n');
		res.write('data: ' + JSON.stringify({ choices: [], usage: { completion_tokens: 10, prompt_tokens: 15, total_tokens: 25 } }) + '\n\n');
		res.write('data: [DONE]\n\n');
		res.end();
	});
	return new Promise((resolve) =>
		server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })),
	);
}

/** A server that streams an answer with Ollama-style timing fields in usage. */
function startTimedServer() {
	const server = http.createServer(async (req, res) => {
		req.resume();
		res.writeHead(200, { 'Content-Type': 'text/event-stream' });
		res.write('data: ' + JSON.stringify({ choices: [{ delta: { role: 'assistant', content: null } }] }) + '\n\n');
		await new Promise((r) => setTimeout(r, 60));
		res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }) + '\n\n');
		await new Promise((r) => setTimeout(r, 60));
		res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n');
		res.write('data: ' + JSON.stringify({ choices: [], usage: { completion_tokens: 10, prompt_tokens: 20, total_tokens: 30, prompt_eval_duration: 1_000_000_000, eval_duration: 2_000_000_000, load_duration: 5_000_000 } }) + '\n\n');
		res.write('data: [DONE]\n\n');
		res.end();
	});
	return new Promise((resolve) =>
		server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })),
	);
}

const profile = { id: 'fixture', model: 'fixture', label: 'Fixture', context: 16384, outputTokens: 1024, vision: false };

test('A streamed response with no timing fields is timed client-side', async t => {
	const { server, port } = await startNoTimingServer();
	t.after(() => server.close());
	const stream = streamResponse(
		{ profile, messages: [{ role: 'user', content: 'hello' }] },
		{ baseUrl: `http://127.0.0.1:${port}/v1`, token: 'token' },
		{ headerTimeoutMs: 5000, maxAttempts: 1 },
	);
	const events = [];
	for await (const event of stream) events.push(event);
	const last = events.at(-1);
	assert.equal(last.type, 'done');
	const usage = last.message.usage;
	assert.equal(usage.input, 15);
	assert.equal(usage.output, 10);
	// Wall-clock fallback synthesized the timing fields the server did not send.
	assert.ok(Number.isFinite(usage.timeToFirstChunkMs) && usage.timeToFirstChunkMs > 0, 'timeToFirstChunkMs recorded');
	assert.ok(Number.isFinite(usage.promptMs) && usage.promptMs > 0, 'promptMs synthesized');
	assert.ok(Number.isFinite(usage.outputMs) && usage.outputMs > 0, 'outputMs synthesized');
	assert.ok(Number.isFinite(usage.outputTps) && usage.outputTps > 0, 'outputTps synthesized');
	assert.ok(Number.isFinite(usage.promptTps) && usage.promptTps > 0, 'promptTps synthesized');
});

test('Server-supplied timing fields win over the wall-clock fallback', async t => {
	const { server, port } = await startTimedServer();
	t.after(() => server.close());
	const stream = streamResponse(
		{ profile, messages: [{ role: 'user', content: 'hello' }] },
		{ baseUrl: `http://127.0.0.1:${port}/v1`, token: 'token' },
		{ headerTimeoutMs: 5000, maxAttempts: 1 },
	);
	const events = [];
	for await (const event of stream) events.push(event);
	const last = events.at(-1);
	assert.equal(last.type, 'done');
	const usage = last.message.usage;
	// The server reported 1s prompt and 2s generation; nothing may be overwritten.
	assert.equal(usage.promptMs, 1000);
	assert.equal(usage.outputMs, 2000);
	assert.equal(usage.loadMs, 5);
	assert.equal(usage.outputTps, 5);
	assert.equal(usage.promptTps, 20);
});

test('A model that never answers fails with a bounded, readable error', async t => {
	const { server, port, count } = await startSilentServer();
	t.after(() => server.close());
	const stream = streamResponse(
		{ profile, messages: [{ role: 'user', content: 'hello' }] },
		{ baseUrl: `http://127.0.0.1:${port}/v1`, token: 'token' },
		{ headerTimeoutMs: 300, maxAttempts: 2 },
	);
	const events = [];
	for await (const event of stream) events.push(event);
	const last = events.at(-1);
	assert.equal(last.type, 'error');
	assert.match(last.error.errorMessage, /did not start answering within/);
	assert.equal(count(), 2, 'the request was tried again once');
});

test('A dropped connection is retried and the answer still arrives', async t => {
	const { server, port, count } = await startFlakyServer(1);
	t.after(() => server.close());
	const stream = streamResponse(
		{ profile, messages: [{ role: 'user', content: 'hello' }] },
		{ baseUrl: `http://127.0.0.1:${port}/v1`, token: 'token' },
		{ headerTimeoutMs: 5000, maxAttempts: 3 },
	);
	const events = [];
	for await (const event of stream) events.push(event);
	const last = events.at(-1);
	assert.equal(last.type, 'done');
	assert.equal(last.message.content[0].text, 'Recovered.');
	assert.equal(count(), 2, 'the request was sent again after the dropped connection');
});

test('A refusal by the model is not retried', async t => {
	const { server, port, count } = await startRefusingServer();
	t.after(() => server.close());
	const stream = streamResponse(
		{ profile, messages: [{ role: 'user', content: 'hello' }] },
		{ baseUrl: `http://127.0.0.1:${port}/v1`, token: 'token' },
		{ headerTimeoutMs: 5000, maxAttempts: 3 },
	);
	const events = [];
	for await (const event of stream) events.push(event);
	const last = events.at(-1);
	assert.equal(last.type, 'error');
	assert.match(last.error.errorMessage, /HTTP 400/);
	assert.equal(count(), 1, 'a refusal was sent again');
});

test('A stopped task is not retried', async t => {
	const { server, port, count } = await startSilentServer();
	t.after(() => server.close());
	const controller = new AbortController();
	const stream = streamResponse(
		{ profile, messages: [{ role: 'user', content: 'hello' }] },
		{ baseUrl: `http://127.0.0.1:${port}/v1`, token: 'token' },
		{ signal: controller.signal, headerTimeoutMs: 5000, maxAttempts: 3 },
	);
	setTimeout(() => controller.abort(), 150);
	const events = [];
	for await (const event of stream) events.push(event);
	const last = events.at(-1);
	assert.equal(last.type, 'error');
	assert.equal(last.error.stopReason, 'aborted');
	assert.equal(count(), 1, 'a stopped task was sent again');
});
