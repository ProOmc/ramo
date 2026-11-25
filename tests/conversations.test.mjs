import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chatExportFilename, chatStamp, chatTitle, filterAndSortChats,
  hasChatContent, markdownForChat, relativeChatDate, transcriptMatches,
} from '../build/conversations.js';

const chat = (id, extra = {}) => ({ id, title: 'New chat', created: 100, messages: [], ...extra });

test('chat content includes notes, attempts and project work, not just messages', () => {
  assert.equal(hasChatContent(chat('empty')), false);
  assert.equal(hasChatContent(chat('named', { title: 'A useful title' })), true);
  assert.equal(hasChatContent(chat('messages', { messages: [{ user: 'hello' }] })), true);
  assert.equal(hasChatContent(chat('attempt', { attempt: { id: 'a' } })), true);
  assert.equal(hasChatContent(chat('project', { pi: { cwd: 'C:/project' } })), true);
});

test('an explicit renamed title wins over the first user message', () => {
  const record = chat('one', { title: 'Release checklist', messages: [{ user: 'the original first question' }] });
  assert.equal(chatTitle(record), 'Release checklist');
  assert.equal(chatTitle(chat('two', { messages: [{ user: 'the original first question' }] })), 'the original first question');
  assert.equal(chatTitle(chat('main')), 'Saved conversation');
});

test('archived visibility, search and pinned recency ordering are deterministic', () => {
  const records = [
    chat('old', { created: 100, messages: [{ user: 'older topic' }] }),
    chat('pinned', { created: 50, pinned: true, messages: [{ user: 'keep me' }] }),
    chat('archived', { created: 300, archived: true, messages: [{ user: 'hidden' }] }),
    chat('active-archived', { created: 400, archived: true, messages: [{ user: 'currently open' }] }),
    chat('new', { created: 200, messages: [{ assistant: 'a very specific answer' }] }),
  ];
  const active = filterAndSortChats(records, { activeId: 'active-archived' });
  assert.deepEqual(active.map((c) => c.id), ['pinned', 'active-archived', 'new', 'old']);
  assert.deepEqual(filterAndSortChats(records, { visibility: 'archived' }).map((c) => c.id), ['active-archived', 'archived']);
  assert.deepEqual(filterAndSortChats(records, { query: 'specific answer' }).map((c) => c.id), ['new']);
  assert.equal(chatStamp(records[2]), 300);
});

test('relative dates use a supplied clock', () => {
  const now = Date.UTC(2026, 10, 23, 12);
  assert.equal(relativeChatDate(now - 3600000, now), 'Today');
  assert.equal(relativeChatDate(now - 86400000, now), 'Yesterday');
  assert.equal(relativeChatDate(now - 3 * 86400000, now), '3 days ago');
  assert.equal(relativeChatDate(0, now), '');
});

test('transcript search returns original message indexes in order', () => {
  const messages = [{ user: 'Hello' }, { assistant: 'Nothing here' }, { user: 'hello again', assistant: 'Hello twice' }];
  assert.deepEqual(transcriptMatches(messages, 'hello'), [0, 2]);
  assert.deepEqual(transcriptMatches(messages, 'twice'), [2]);
  assert.deepEqual(transcriptMatches(messages, ''), []);
  assert.deepEqual(transcriptMatches(messages, 'missing'), []);
});

test('Markdown export keeps both speakers and produces a safe filename', () => {
  const record = chat('export', {
    title: 'A title: with / punctuation',
    messages: [{ user: 'Question?', assistant: 'Answer.' }, { user: 'Follow up', assistant: '' }],
  });
  const text = markdownForChat(record, 0);
  assert.match(text, /^# A title: with \/ punctuation/m);
  assert.match(text, /## You\n\nQuestion\?/);
  assert.match(text, /## Ramo\n\nAnswer\./);
  assert.match(text, /## You\n\nFollow up/);
  assert.equal(text.endsWith('---\n'), false);
  assert.equal(chatExportFilename(record), 'a-title-with-punctuation.md');
});
