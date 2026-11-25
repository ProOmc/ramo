import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useShell } from '../lib/hooks';
import { assistantApi, type ChatRecord } from '../lib/chat';
import {
  chatExportFilename, chatStamp, chatTitle, filterAndSortChats,
  markdownForChat, relativeChatDate, type ChatVisibility,
} from '../lib/conversations';
import { ShortcutsDialog } from '../dialogs/ShortcutsDialog';

const PLUS = '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>';
const SEARCH = '<path d="m21 21-4.3-4.3M17 10.6a6.4 6.4 0 1 1-12.8 0 6.4 6.4 0 0 1 12.8 0z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>';
const MORE = '<circle cx="6" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="18" cy="12" r="1.5" fill="currentColor"/>';
const STAR = '<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.6 9.4l6.1-.9z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/>';

function navIcon(name: 'chat' | 'research' | 'browser' | 'sessions' | 'models' | 'settings'): string {
  const paths: Record<string, string> = {
    chat: '<path d="M4 5h16v12H8l-4 4V5z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/>',
    research: '<path d="M5 19V5M5 5l4 4M5 5L1 9M12 9h9M12 14h9M12 19h7" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    browser: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9S14.5 18.3 12 21c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
    sessions: '<path d="M6 4h9l4 4v12H6z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M9 10h7M9 14h7M9 18h4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
    models: '<circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/>',
    settings: '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/>',
  };
  return '<svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">' + paths[name] + '</svg>';
}

const Kbd = ({ text }: { text: string }) => <span className="oc-kbd">{text}</span>;
const NAV = [
  { id: 'home', label: 'Chat', icon: 'chat' as const },
  { id: 'research', label: 'Research', icon: 'research' as const },
  { id: 'browser', label: 'Browser', icon: 'browser' as const },
  { id: 'sessions', label: 'Sessions', icon: 'sessions' as const },
];

type ConversationApi = {
  createChatSession?: () => Promise<string>;
  selectChatSession?: (id: string) => Promise<string>;
  renameChatSession?: (id: string, title: string) => Promise<unknown>;
  deleteChatSession?: (id: string) => Promise<unknown>;
  cancel?: () => unknown;
  harness?: { metadata?: (id: string, changes: { pinned?: boolean; archived?: boolean }) => unknown };
  engine?: { store?: { data?: { chats?: ChatRecord[]; activeChatId?: string } } };
};

export function Sidebar({ hidden = false }: { hidden?: boolean }) {
  const { page, setPage, chatVersion, showToast, bumpChat, busy } = useShell();
  const [query, setQuery] = useState('');
  const [visibility, setVisibility] = useState<ChatVisibility>('active');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [petOn, setPetOn] = useState(() => document.documentElement.dataset.petActive === '1');
  const searchRef = useRef<HTMLInputElement>(null);
  const shortcutsRef = useRef<HTMLButtonElement>(null);
  const api = assistantApi() as ConversationApi | undefined;
  const activeId = api?.engine?.store?.data?.activeChatId ?? 'main';
  const storeChats = api?.engine?.store?.data?.chats ?? [];
  const activeCount = useMemo(() => filterAndSortChats(storeChats, { visibility: 'active', activeId }).length, [storeChats, activeId, chatVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const archivedCount = useMemo(() => filterAndSortChats(storeChats, { visibility: 'archived', activeId }).length, [storeChats, activeId, chatVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = useMemo(() => filterAndSortChats(storeChats, { query, visibility, activeId }), [storeChats, query, visibility, activeId, chatVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const newChat = async () => {
    try {
      await api?.createChatSession?.();
      setVisibility('active');
      setMenuId(null);
      bumpChat();
      setPage('home');
    } catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
  };
  const openChat = async (id: string) => {
    try {
      await api?.selectChatSession?.(id);
      setMenuId(null);
      bumpChat();
      setPage('home');
    } catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
  };
  const stopResponse = () => {
    if (!busy) return;
    void api?.cancel?.();
    bumpChat();
  };
  const submitSearch = (event: FormEvent) => event.preventDefault();
  const openModels = () => {
    try { localStorage.setItem('ramo-settings-section-v1', 'models'); } catch { /* memory-only */ }
    setPage('system');
  };
  const togglePet = async () => {
    try { await (window as unknown as { ramoDesktop?: { pet?: { toggle?: () => Promise<unknown> } } }).ramoDesktop?.pet?.toggle?.(); }
    catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
  };
  useEffect(() => {
    let mounted = true;
    (window as unknown as { ramoDesktop?: { pet?: { onChanged?: (cb: (state: { active?: boolean }) => void) => void } } }).ramoDesktop?.pet?.onChanged?.((state) => {
      if (mounted) setPetOn(!!state?.active);
    });
    return () => { mounted = false; };
  }, []);

  const metadata = async (chat: ChatRecord, changes: { pinned?: boolean; archived?: boolean }) => {
    setWorkingId(chat.id);
    try {
      await api?.harness?.metadata?.(chat.id, changes);
      if (changes.archived === true && chat.id === activeId) await api?.createChatSession?.();
      setMenuId(null);
      bumpChat();
      const title = chatTitle(chat);
      if (changes.archived === true) showToast(`“${title}” archived.`, { label: 'Undo', run: () => { void metadata(chat, { archived: false }); } });
      else if (changes.archived === false) showToast(`“${title}” restored.`);
      else showToast(changes.pinned ? `“${title}” pinned.` : `“${title}” unpinned.`);
    } catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
    finally { setWorkingId(null); }
  };
  const saveTitle = async (chat: ChatRecord) => {
    const title = draftTitle.trim();
    if (!title) { showToast('Enter a name for this chat.'); return; }
    setWorkingId(chat.id);
    try {
      await api?.renameChatSession?.(chat.id, title);
      setEditingId(null);
      bumpChat();
      showToast('Chat renamed.');
    } catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
    finally { setWorkingId(null); }
  };
  const exportChat = (chat: ChatRecord) => {
    const blob = new Blob([markdownForChat(chat, Date.now())], { type: 'text/markdown;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = chatExportFilename(chat);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    setMenuId(null);
    showToast('Chat exported as Markdown.');
  };
  const removeChat = async (chat: ChatRecord) => {
    setWorkingId(chat.id);
    try {
      await api?.deleteChatSession?.(chat.id);
      setDeleteId(null);
      setMenuId(null);
      bumpChat();
      showToast(chat.id === 'main' ? 'Saved conversation cleared.' : `“${chatTitle(chat)}” deleted.`);
    } catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
    finally { setWorkingId(null); }
  };

  // Global shortcuts. Ctrl+F belongs to the conversation view and is handled there.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (event.key === 'Escape') { setMenuId(null); setDeleteId(null); setEditingId(null); setShortcutsOpen(false); return; }
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === 'n') { event.preventDefault(); void newChat(); }
      else if (key === 'k') { event.preventDefault(); searchRef.current?.focus(); }
      else if (key === '/') { event.preventDefault(); setShortcutsOpen(true); }
      else if (key === 'x' && event.shiftKey) { event.preventDefault(); stopResponse(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, busy]);
  useEffect(() => {
    if (!menuId) return undefined;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest?.('[data-chat-menu]')) setMenuId(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuId]);

  return (
    <aside id="oc-studio-sidebar" aria-label="Ramo navigation" inert={hidden ? true : undefined}>
      <div className="oc-brand"><span className="oc-brand-name">Ramo <small>LOCAL</small></span><button type="button" className="oc-sidebar-close" aria-label="Close navigation" onClick={() => document.getElementById('oc-mobile-nav')?.click()}>×</button></div>
      <button type="button" className="oc-nav-item oc-new-chat" onClick={newChat} title="Start a new conversation (Ctrl+N)">
        <span dangerouslySetInnerHTML={{ __html: '<svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">' + PLUS + '</svg>' }} />
        <span>New chat</span><Kbd text="Ctrl N" />
      </button>
      <nav className="oc-nav-section" aria-label="Sections">
        {NAV.map((item) => (
          <button key={item.id} type="button" data-page={item.id} className="oc-nav-item" aria-current={page === item.id ? 'page' : undefined} onClick={() => setPage(item.id)}>
            <span dangerouslySetInnerHTML={{ __html: navIcon(item.icon) }} /><span>{item.label}</span>
          </button>
        ))}
      </nav>
      <form className="oc-sidebar-searchform" role="search" onSubmit={submitSearch}>
        <span className="oc-sidebar-search-icon" dangerouslySetInnerHTML={{ __html: '<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">' + SEARCH + '</svg>' }} />
        <input ref={searchRef} className="oc-sidebar-search" type="text" placeholder="Search chats" aria-label="Search chats" value={query} onChange={(event) => setQuery(event.target.value)} />
        {query ? <button type="button" className="oc-search-clear" aria-label="Clear chat search" onClick={() => { setQuery(''); searchRef.current?.focus(); }}>×</button> : <Kbd text="Ctrl K" />}
      </form>
      <div className="oc-chat-tabs" aria-label="Conversation filters">
        <button type="button" className="oc-chat-tab" aria-pressed={visibility === 'active'} onClick={() => setVisibility('active')}>Chats <span>{activeCount}</span></button>
        <button type="button" className="oc-chat-tab" aria-pressed={visibility === 'archived'} onClick={() => setVisibility('archived')}>Archived <span>{archivedCount}</span></button>
      </div>
      <div className="oc-sidebar-history ramo-drawer-chat-list" role="list" aria-label={visibility === 'archived' ? 'Archived conversations' : 'Conversations'}>
        {filtered.length === 0 && (
          <div className="oc-history-empty">
            <p>{query ? 'No matching conversations' : visibility === 'archived' ? 'No archived chats yet.' : 'Conversations will appear here as you chat.'}</p>
            {query ? <button type="button" className="oc-shell-button-quiet" onClick={() => setQuery('')}>Clear search</button> : null}
          </div>
        )}
        {filtered.map((chat) => {
          const title = chatTitle(chat);
          const archived = !!chat.archived;
          return (
            <div key={chat.id} className={`oc-chat-row${chat.id === activeId ? ' active' : ''}${menuId === chat.id ? ' menu-open' : ''}`} role="listitem" data-chat-menu={chat.id}>
              {editingId === chat.id ? (
                <div className="oc-chat-rename">
                  <input autoFocus aria-label="Chat name" value={draftTitle} maxLength={72} onChange={(event) => setDraftTitle(event.target.value)} onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); void saveTitle(chat); }
                    if (event.key === 'Escape') { event.preventDefault(); setEditingId(null); }
                  }} />
                  <button type="button" aria-label="Save chat name" disabled={workingId === chat.id} onClick={() => void saveTitle(chat)}>Save</button>
                  <button type="button" aria-label="Cancel renaming" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <button type="button" className="oc-chat-open" data-chat-id={chat.id} aria-current={chat.id === activeId ? 'true' : undefined} title={`${title}${archived ? ' (archived)' : ''}`} onClick={() => void openChat(chat.id)}>
                    <span className="oc-chat-title">{chat.pinned ? <span className="oc-chat-pin" aria-label="Pinned" dangerouslySetInnerHTML={{ __html: '<svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">' + STAR + '</svg>' }} /> : null}{title}</span>
                    <span className="oc-chat-meta">{chat.messages?.length ?? 0} messages{chatStamp(chat) ? ` · ${relativeChatDate(chatStamp(chat), Date.now())}` : ''}{archived ? ' · archived' : ''}</span>
                  </button>
                  <button type="button" className={`oc-chat-quick${chat.pinned ? ' pinned' : ''}`} title={chat.pinned ? 'Unpin chat' : 'Pin chat'} aria-label={chat.pinned ? `Unpin ${title}` : `Pin ${title}`} disabled={workingId === chat.id} onClick={() => void metadata(chat, { pinned: !chat.pinned })} dangerouslySetInnerHTML={{ __html: '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">' + STAR + '</svg>' }} />
                  <button type="button" className="oc-chat-quick" title="Chat actions" aria-label={`Actions for ${title}`} aria-expanded={menuId === chat.id} onClick={() => { setMenuId(menuId === chat.id ? null : chat.id); setDeleteId(null); }} dangerouslySetInnerHTML={{ __html: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' + MORE + '</svg>' }} />
                </>
              )}
              {menuId === chat.id && deleteId !== chat.id ? (
                <div className="oc-chat-menu" role="menu" aria-label={`Actions for ${title}`}>
                  <button type="button" role="menuitem" onClick={() => { setDraftTitle(title); setEditingId(chat.id); setMenuId(null); }}>Rename</button>
                  <button type="button" role="menuitem" disabled={workingId === chat.id} onClick={() => void metadata(chat, { archived: !archived })}>{archived ? 'Restore chat' : 'Archive chat'}</button>
                  <button type="button" role="menuitem" onClick={() => exportChat(chat)}>Export Markdown</button>
                  <button type="button" role="menuitem" className="oc-danger" onClick={() => setDeleteId(chat.id)}>{chat.id === 'main' ? 'Clear conversation…' : 'Delete chat…'}</button>
                </div>
              ) : null}
              {deleteId === chat.id ? (
                <div className="oc-chat-confirm" role="alert">
                  <p>{chat.id === 'main' ? 'Clear this saved conversation? Its messages will be removed.' : 'Delete this chat? This cannot be undone.'}</p>
                  <div><button type="button" className="oc-danger-fill" disabled={workingId === chat.id} onClick={() => void removeChat(chat)}>{chat.id === 'main' ? 'Clear' : 'Delete'}</button><button type="button" onClick={() => setDeleteId(null)}>Cancel</button></div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="oc-nav-spacer" />
      <button type="button" className="oc-nav-item oc-nav-footer" onClick={openModels}>
        <span dangerouslySetInnerHTML={{ __html: navIcon('models') }} /><span>Models</span>
      </button>
      <button type="button" id="oc-pet-item" className="oc-nav-item oc-nav-footer" data-pet={petOn ? 'on' : 'off'} aria-pressed={petOn} aria-label={petOn ? 'Hide Ramo Pet — right-click for settings' : 'Show Ramo Pet — right-click for settings'} title={petOn ? 'Pet is on — click to hide; right-click for settings' : 'Pet is off — click to show; right-click for settings'} onClick={() => void togglePet()} onContextMenu={(event) => { event.preventDefault(); (window as unknown as { RamoPet?: { openSettings?: () => void } }).RamoPet?.openSettings?.(); }}>
        <span dangerouslySetInnerHTML={{ __html: '<svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8.2" cy="9.2" r="1.7" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="15.8" cy="9.2" r="1.7" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="5" cy="13" r="1.5" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="19" cy="13" r="1.5" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M12 13.2c-2.6 0-4.6 2-4.6 4.3 0 1.5 1.1 2.5 2.5 2.5 1 0 1.4-.5 2.1-.5s1.1.5 2.1.5c1.4 0 2.5-1 2.5-2.5 0-2.3-2-4.3-4.6-4.3z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/></svg>' }} />
        <span>Pet</span>
      </button>
      <button ref={shortcutsRef} type="button" className="oc-nav-item oc-nav-footer" onClick={() => setShortcutsOpen(true)} title="Keyboard shortcuts (Ctrl+/)">
        <span className="oc-shortcut-symbol" aria-hidden="true">?</span><span>Shortcuts</span>
      </button>
      <button type="button" className="oc-nav-item oc-nav-footer" onClick={() => setPage('system')}>
        <span dangerouslySetInnerHTML={{ __html: navIcon('settings') }} /><span>Settings</span>
      </button>
      {shortcutsOpen ? <ShortcutsDialog onClose={() => setShortcutsOpen(false)} returnFocus={shortcutsRef} /> : null}
    </aside>
  );
}
