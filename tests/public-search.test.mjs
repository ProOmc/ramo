import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchService } from '../build/domain.js';

const host = (keys = {}) => ({ variable: (name) => name === 'AnySearch Relay URL' ? 'direct' : '', _storageGet: (key) => keys[key] || '' });

test('AnySearch without a key uses the direct public endpoint, never a private relay', async () => {
  let request;
  const transport = { get: async (url, options) => { request = { url, options }; return { code: 0, data: { results: [] } }; } };
  await new SearchService(host(), transport, {}).anySearch('test', undefined, {});
  assert.equal(request.url, 'https://api.anysearch.com/v1/search');
  assert.equal(request.options.headers.Authorization, undefined);
});

test('Tavily is a keyed reserve after AnySearch failure and is not called without its key', async () => {
  const key = 'tvly-public-test-key';
  let calls = 0;
  const fallbackTransport = { get: async (url, options) => {
    calls++;
    if (calls === 1) throw Error('primary unavailable');
    assert.equal(url, 'https://api.tavily.com/search');
    assert.equal(options.headers.Authorization, 'Bearer ' + key);
    return { results: [{ title: 'Result', url: 'https://example.com', content: 'Text' }] };
  } };
  const result = await new SearchService(host({ RAMO_TAVILY_API_KEY_V1: key }), fallbackTransport, {}).webSearch('test', undefined, {});
  assert.equal(result._provider, 'tavily');
  assert.equal(result.data.results[0].url, 'https://example.com');
  let anonymousCalls = 0;
  const noReserve = { get: async () => { anonymousCalls++; throw Error('offline'); } };
  await assert.rejects(() => new SearchService(host(), noReserve, {}).webSearch('test', undefined, {}));
  assert.equal(anonymousCalls, 1);
});
