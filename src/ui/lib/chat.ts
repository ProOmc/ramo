/**
 * Typed access to the renderer's own conversation store — the same backing
 * the legacy UI read (`window.__ramoAssistantInstance.engine.store`).
 * The engine itself is untouched; this is only a typed window into it.
 */

export interface ChatMessage {
  user?: string;
  assistant?: string;
  at?: string | number;
  attempt?: { id?: string; status?: string };
  editedAt?: number;
  attachments?: Array<{ kind?: string; name?: string; images?: unknown[] }>;
  activity?: unknown;
  index?: number;
  status?: string;
}
export interface ChatRecord {
  id: string;
  title?: string;
  created?: number;
  updated?: number;
  pinned?: boolean;
  archived?: boolean;
  pi?: { cwd?: string; mode?: 'assistant' | 'project'; pinned?: boolean; [key: string]: unknown };
  attempt?: { id?: string; activity?: unknown; status?: string };
  messages: ChatMessage[];
  tasks?: unknown[];
  branches?: unknown[];
  savedNotes?: unknown[];
  queuedFollowups?: unknown[];
  working?: { turns?: unknown[] };
  researchState?: { active?: unknown };
  contextStartIndex?: number;
}
export interface LegacyChatApi {
  engine?: {
    store?: {
      data?: {
        chats?: ChatRecord[];
        activeChatId?: string;
        journal?: Array<{ text?: string; at?: string | number }>;
        working?: { turns: unknown[] };
      };
      activeChat?: () => ChatRecord | undefined;
      save?: () => boolean;
    };
    harness?: { tasks?: () => { todos?: Array<Record<string, unknown>> } };
  };
  session?: {
    turn?: { raw?: string; index?: number; activity?: unknown };
    aborted?: boolean;
    controller?: AbortController;
    chatId?: string;
  } | null;
  pendingDocument?: { kind?: string; images?: unknown[]; name?: string; content?: string } | null;
  clearContext?: () => void;
  liveThinking?: boolean;
  setLiveThinking?: (value: boolean) => Promise<unknown>;
  modelName?: () => string;
  askAI?: (args: Record<string, unknown>) => Promise<unknown>;
  answerText?: () => string;
  attempt?: { status?: string };
}

export function assistantApi(): LegacyChatApi | undefined {
  return (window as unknown as { __ramoAssistantInstance?: LegacyChatApi }).__ramoAssistantInstance;
}

export function activeChat(): ChatRecord | undefined {
  const api = assistantApi();
  const active = api?.engine?.store?.data?.activeChatId ?? 'main';
  const chats = api?.engine?.store?.data?.chats ?? [];
  return (chats.find((c) => c.id === active) ?? chats[0]) as ChatRecord | undefined;
}

export function conversationMessages(): ChatMessage[] {
  const chat = activeChat();
  if (!chat) return [];
  const start = Number(chat.contextStartIndex) || 0;
  return (chat.messages ?? []).slice(start >= 0 && start < (chat.messages?.length ?? 0) ? start : 0);
}

/** Busy = a session object exists (the legacy predicate, kept exactly). */
export function isBusy(): boolean {
  return !!assistantApi()?.session;
}

/** Tab label for a chat record: the first real user message, truncated. */
export function chatTabTitle(chat: ChatRecord | undefined, id: string): string {
  const first = chat?.messages?.find((m) => String(m.user || '').trim())?.user;
  if (first) return String(first).replace(/\s+/g, ' ').trim().slice(0, 72) || 'New conversation';
  const generic = String(chat?.title ?? '').trim();
  if (generic && generic !== 'Main') return generic.slice(0, 72);
  return id === 'main' ? 'Saved conversation' : 'New conversation';
}

export function currentModelName(): string {
  return assistantApi()?.modelName?.() ?? '';
}
