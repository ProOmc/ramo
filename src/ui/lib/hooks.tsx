/**
 * Shared shell state packaged as one context + one hook set.
 * The legacy renderer scattered this across window globals; here it is
 * one typed provider — the React tree re-renders instead of the legacy
 * 120 ms full-DOM sweeps.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { assistantApi, conversationMessages, isBusy, activeChat, type ChatMessage, type ChatRecord } from './chat';

export interface ShellToast { text: string; key: number; action?: { label: string; run: () => void } }
export interface ShellValue {
  page: string;
  setPage: (page: string) => void;
  toast: ShellToast | null;
  showToast: (text: string, action?: { label: string; run: () => void }) => void;
  clearToast: () => void;
  chatVersion: number;
  bumpChat: () => void;
  inlineOpen: Record<string, boolean>;
  toggleInline: (key: string) => void;
  inlineDetailOpen: Record<string, boolean>;
  toggleInlineDetail: (key: string, open?: boolean) => void;
  liveText: string;
  liveThinking: string;
  busy: boolean;
  activeChatId: string;
  messages: ChatMessage[];
  chat: ChatRecord | undefined;
  pendingUser: string | null;
  submitPendingUser: (text: string) => void;
}
const ShellContext = createContext<ShellValue | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState('home');
  const [toast, setToast] = useState<ShellToast | null>(null);
  const [chatVersion, setChatVersion] = useState(0);
  const [inlineOpen, setInlineOpen] = useState<Record<string, boolean>>({});
  const [inlineDetailOpen, setInlineDetailOpen] = useState<Record<string, boolean>>({});
  const [liveText, setLiveText] = useState('');
  const [liveThinking, setLiveThinking] = useState('');
  const [busy, setBusy] = useState(isBusy());
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const liveRef = useRef({ text: '', thinking: '' });
  const pendingRef = useRef<{ chatId: string; baseline: number } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const bumpChat = useCallback(() => setChatVersion((v) => v + 1), []);

  const submitPendingUser = useCallback((text: string) => {
    const clean = String(text || '').trim();
    if (clean) {
      pendingRef.current = { chatId: activeChat()?.id ?? 'main', baseline: conversationMessages().length };
      setPendingUser(clean);
    } else {
      pendingRef.current = null;
      setPendingUser(null);
    }
  }, []);
  const showToast = useCallback((text: string, action?: { label: string; run: () => void }) => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, key: Date.now(), action });
    // Undo and other actions must not vanish while the user is reading or
    // navigating to them. Actionable notices stay until acted on or dismissed.
    if (!action) toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  }, []);
  const clearToast = useCallback(() => {
    window.clearTimeout(toastTimer.current);
    setToast(null);
  }, []);

  const toggleInline = useCallback((key: string) => {
    setInlineOpen((prev) => ({ ...prev, [key]: !(prev[key] ?? false) }));
  }, []);
  const toggleInlineDetail = useCallback((key: string, open?: boolean) => {
    setInlineDetailOpen((prev) => ({ ...prev, [key]: open ?? !prev[key] }));
  }, []);

  // Subscribe to the runtime's own event stream; keep views fresh.
  useEffect(() => {
    if (typeof window.RamoRuntime?.onEvent !== 'function') return undefined;
    const unsubscribe = window.RamoRuntime.onEvent((event: { type?: unknown; assistantMessageEvent?: { type?: string; delta?: string; content?: string } }) => {      const type = String((event as { type?: unknown })?.type ?? '');
      const assistantMessageEvent = (event as { assistantMessageEvent?: { type?: string; delta?: string; content?: string } })?.assistantMessageEvent;
      if (type === 'message_update' && assistantMessageEvent) {
        if (assistantMessageEvent.type === 'text_delta' || assistantMessageEvent.type === 'text_start') {
          liveRef.current.text = liveRef.current.text + (assistantMessageEvent.delta ?? '');
        } else if (assistantMessageEvent.type === 'thinking_delta') {
          liveRef.current.thinking = liveRef.current.thinking + (assistantMessageEvent.delta ?? '');
        } else if (assistantMessageEvent.type === 'text_end' || assistantMessageEvent.type === 'thinking_end') {
          // The per-phase buffers reset at boundaries the engine owns.
        }
        setLiveText(liveRef.current.text);
        setLiveThinking(liveRef.current.thinking);
      } else if (type === 'agent_start' || type === 'agent_settled' || type === 'message_end'
        || type === 'tool_execution_start' || type === 'tool_execution_end'
        || type === 'changes' || type === 'work_progress') {
        setBusy(isBusy());
        if (type === 'agent_start') { liveRef.current = { text: '', thinking: '' }; setLiveText(''); setLiveThinking(''); }
        if (type === 'message_end' || type === 'agent_settled') {
          liveRef.current = { text: '', thinking: '' };
          setLiveText(''); setLiveThinking('');
          setBusy(isBusy());
        }
        bumpChat();
      } else if (type === 'background_job_done') {
        const record = event as unknown as Record<string, unknown>;
        const jobId = String(record.jobId ?? 'job');
        const exitCode = String(record.exitCode ?? '?');
        const tail = String(record.output ?? '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? '';
        showToast(`Background job ${jobId} finished (exit ${exitCode})${tail ? `: ${tail.slice(0, 120)}` : ''}.`);
        bumpChat();
      }
    });
    return unsubscribe;
  }, [bumpChat]);

  // Live inline activity: the extension emits onto researchEvents for every
  // step and call; re-render the inline rows so thinking and searches stream.
  useEffect(() => {
    const api = (window as unknown as { __ramoAssistantInstance?: { researchEvents?: { subscribe?: (fn: () => void) => () => void } } }).__ramoAssistantInstance;
    const bus = api?.researchEvents;
    if (typeof bus?.subscribe !== 'function') return undefined;
    let timer: number | undefined;
    const unsubscribe = bus.subscribe(() => {
      setBusy(isBusy());
      window.clearTimeout(timer);
      timer = window.setTimeout(() => bumpChat(), 120);
    });
    return () => { window.clearTimeout(timer); unsubscribe?.(); };
  }, [bumpChat]);

  // A slow freshness tick covers anything the events miss (legacy parity, gentler).
  useEffect(() => {
    const timer = window.setInterval(() => { setBusy(isBusy()); bumpChat(); }, 500);
    return () => window.clearInterval(timer);
  }, [bumpChat]);

  const chat = useMemo(() => activeChat(), [chatVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const messages = useMemo(() => conversationMessages(), [chatVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Retire the optimistic row only when THIS chat gains a new message. Matching
  // by text broke repeated questions: the older copy cleared the new one at once.
  useEffect(() => {
    if (!pendingUser) return;
    const pending = pendingRef.current;
    if (!pending || pending.chatId !== (chat?.id ?? 'main') || messages.length > pending.baseline) {
      pendingRef.current = null;
      setPendingUser(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatVersion, chat?.id, messages.length]);

  const value: ShellValue = {
    page,
    setPage,
    toast,
    showToast,
    clearToast,
    chatVersion,
    bumpChat,
    inlineOpen,
    toggleInline,
    inlineDetailOpen,
    toggleInlineDetail,
    liveText,
    liveThinking,
    busy,
    activeChatId: chat?.id ?? 'main',
    pendingUser,
    submitPendingUser,
    messages,
    chat,
  };
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used inside <ShellProvider>.');
  return ctx;
}
