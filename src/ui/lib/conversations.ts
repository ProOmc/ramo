/**
 * Pure conversation-list helpers shared by the sidebar and transcript search.
 * No window, DOM or model access: the model-free suite checks the ordering,
 * filtering and export format directly.
 */
import type { ChatMessage, ChatRecord } from './chat';

export type ChatVisibility = 'active' | 'archived';

export function hasChatContent(chat: ChatRecord): boolean {
  const title = String(chat.title ?? '').trim();
  return !!(chat.messages?.length
    || chat.attempt
    || chat.tasks?.length
    || chat.branches?.length
    || chat.savedNotes?.length
    || chat.queuedFollowups?.length
    || chat.working?.turns?.length
    || chat.researchState?.active
    || chat.pi?.cwd
    || !['', 'Main', 'New chat'].includes(title));
}

export function chatTitle(chat: ChatRecord): string {
  // An explicit user-chosen title always wins over the first-message fallback.
  const explicit = String(chat.title ?? '').trim();
  if (explicit && explicit !== 'Main' && explicit !== 'New chat') return explicit.slice(0, 72);
  const first = chat.messages?.find((message) => String(message.user || '').trim())?.user;
  if (first) return String(first).replace(/\s+/g, ' ').trim().slice(0, 72) || 'New conversation';
  return chat.id === 'main' ? 'Saved conversation' : 'New conversation';
}

export function chatStamp(chat: ChatRecord): number {
  return Number(chat.updated ?? chat.created ?? 0) || 0;
}

function searchableText(chat: ChatRecord): string {
  return `${chatTitle(chat)} ${(chat.messages ?? []).map((message) => `${message.user ?? ''} ${message.assistant ?? ''}`).join(' ')}`.toLowerCase();
}

/** Archived chats are hidden unless requested; the open chat is never lost. */
export function filterAndSortChats(
  chats: readonly ChatRecord[],
  options: { query?: string; visibility?: ChatVisibility; activeId?: string },
): ChatRecord[] {
  const query = String(options.query ?? '').trim().toLowerCase();
  const archived = options.visibility === 'archived';
  return chats
    .filter(hasChatContent)
    .filter((chat) => archived ? !!chat.archived : (!chat.archived || chat.id === options.activeId))
    .filter((chat) => !query || searchableText(chat).includes(query))
    .slice()
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || chatStamp(b) - chatStamp(a));
}

export function relativeChatDate(timestamp: number, now: number): string {
  const stamp = Number(timestamp) || 0;
  if (!stamp || !Number.isFinite(stamp)) return '';
  const days = Math.max(0, Math.floor((now - stamp) / 86400000));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(stamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: new Date(stamp).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

export function transcriptMatches(messages: readonly ChatMessage[], query: string): number[] {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return [];
  const matches: number[] = [];
  messages.forEach((message, index) => {
    const text = `${message.user ?? ''}\n${message.assistant ?? ''}`.toLowerCase();
    if (text.includes(needle)) matches.push(index);
  });
  return matches;
}

function cleanFilenamePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

export function chatExportFilename(chat: ChatRecord): string {
  return `${cleanFilenamePart(chatTitle(chat)) || 'ramo-chat'}.md`;
}

/** Human-readable, dependency-free Markdown export of one visible transcript. */
export function markdownForChat(chat: ChatRecord, exportedAt = 0): string {
  const lines = [`# ${chatTitle(chat)}`, '', 'Exported from Ramo.'];
  if (exportedAt > 0) lines[2] = `Exported from Ramo on ${new Date(exportedAt).toISOString()}.`;
  for (const message of chat.messages ?? []) {
    const user = String(message.user ?? '').trim();
    const assistant = String(message.assistant ?? '').trim();
    if (user) lines.push('', '## You', '', user);
    if (assistant) lines.push('', '## Ramo', '', assistant);
    if (user || assistant) lines.push('', '---');
  }
  if (lines.at(-1) === '---') lines.pop();
  return lines.join('\n').trimEnd() + '\n';
}
