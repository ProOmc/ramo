import { useEffect, useMemo, useRef, useState } from 'react';
import { useShell } from '../lib/hooks';
import { Turn } from './Turn';
import { assistantApi } from '../lib/chat';
import { transcriptMatches } from '../lib/conversations';
import { gatherInlineRuns, type ActivityRun } from '../lib/activity';
import { ActivityTimeline } from './ActivityTimeline';
import { renderMarkdown } from '../lib/markdown';
import { FileCards } from './FileCards';

function Welcome() {
  return (
    <div className="oc-empty-state">
      <h1>What are we working on?</h1>
      <p>Ask a question, attach a file, or tell Ramo what to build. Ctrl+N starts a fresh chat; Ctrl+/ shows every shortcut.</p>
    </div>
  );
}

export function HomePage() {
  const { messages, busy, liveText, liveThinking, chatVersion, activeChatId, pendingUser } = useShell();
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const stickRef = useRef(true);
  const lengthRef = useRef(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [showJump, setShowJump] = useState(false);
  const matches = useMemo(() => transcriptMatches(messages, searchQuery), [messages, searchQuery]);
  const currentMatch = matches.length ? matches[Math.min(cursor, matches.length - 1)] : undefined;

  useEffect(() => {
    const host = scrollRef.current;
    if (!host) return undefined;
    // Delegated copy for code blocks rendered via dangerouslySetInnerHTML.
    const onClick = (event: Event) => {
      const button = (event.target as HTMLElement | null)?.closest?.('[data-oc-copy-code]') as HTMLElement | null;
      if (!button) return;
      event.preventDefault();
      const block = button.closest('.oc-code-block');
      const code = block?.querySelector('pre code')?.textContent ?? '';
      if (!code) return;
      void navigator.clipboard?.writeText(code).then(() => {
        const previous = button.textContent ?? 'Copy block';
        button.textContent = 'Copied!';
        button.classList.add('is-copied');
        window.setTimeout(() => { button.textContent = previous; button.classList.remove('is-copied'); }, 1600);
      }).catch(() => { /* clipboard unavailable */ });
    };
    host.addEventListener('click', onClick);
    return () => host.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      const away = el.scrollHeight - el.scrollTop - el.clientHeight >= 240;
      stickRef.current = !away;
      setShowJump(away);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    lengthRef.current = messages.length;
    return () => el.removeEventListener('scroll', onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const grew = messages.length > lengthRef.current;
    const streamingNow = busy && (liveText.length > 0 || liveThinking.length > 0);
    lengthRef.current = messages.length;
    if (stickRef.current && (grew || streamingNow)) el.scrollTop = el.scrollHeight;
  }, [messages.length, liveText, liveThinking, chatVersion]);

  useEffect(() => {
    // Each conversation owns its own scroll/search position. Switching chats
    // starts at the latest message rather than inheriting the previous one.
    stickRef.current = true;
    lengthRef.current = messages.length;
    setShowJump(false);
    setSearchOpen(false);
    setCursor(0);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId]);
  useEffect(() => { setCursor(0); }, [searchQuery]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchOpen(true);
        window.setTimeout(() => searchRef.current?.focus(), 0);
      } else if (event.key === 'Escape' && searchOpen) {
        event.preventDefault();
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen]);

  const goToMatch = (index: number, nextCursor: number) => {
    setCursor(nextCursor);
    const host = scrollRef.current;
    const node = host?.querySelector(`[data-oc-turn-index="${index}"]`);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    node?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  };
  const nextMatch = (direction: number) => {
    if (!matches.length || currentMatch === undefined) return;
    const current = matches.indexOf(currentMatch);
    const next = (current + direction + matches.length) % matches.length;
    goToMatch(matches[next], next);
  };
  const scrollToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setShowJump(false);
    stickRef.current = true;
  };

  const empty = messages.length === 0 && !busy;
  const liveRun = (assistantApi() as { session?: { turn?: { activity?: ActivityRun } } } | undefined)?.session?.turn?.activity;
  const liveRows = liveRun ? gatherInlineRuns(activeChatId, messages, liveRun) : [];
  const liveRunRow = liveRows.find((row) => row.index === messages.length);
  const showActivity = busy && !!liveRunRow;
  const streaming = busy && (liveText.length > 0 || liveThinking.length > 0);

  return (
    <div className="ramo-chat-shell">
      {messages.length > 0 ? <button type="button" className="oc-transcript-find" title="Search this conversation (Ctrl+F)" aria-label="Search this conversation" aria-expanded={searchOpen} onClick={() => { setSearchOpen((open) => !open); if (!searchOpen) window.setTimeout(() => searchRef.current?.focus(), 0); }}>Find</button> : null}
      {searchOpen ? (
        <div className="oc-transcript-search" role="search">
          <input ref={searchRef} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); nextMatch(event.shiftKey ? -1 : 1); }
            if (event.key === 'Escape') { event.preventDefault(); setSearchOpen(false); }
          }} placeholder="Find in this chat" aria-label="Find in this chat" />
          <span className="oc-transcript-search-count" aria-live="polite">{searchQuery.trim() ? (matches.length ? `${Math.min(cursor + 1, matches.length)} of ${matches.length}` : 'No matches') : 'Type to search'}</span>
          <button type="button" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={!matches.length} onClick={() => nextMatch(-1)}>↑</button>
          <button type="button" aria-label="Next match" title="Next match (Enter)" disabled={!matches.length} onClick={() => nextMatch(1)}>↓</button>
          <button type="button" aria-label="Close conversation search" title="Close (Esc)" onClick={() => setSearchOpen(false)}>×</button>
        </div>
      ) : null}
      <div className="ramo-chat-scroll" ref={scrollRef}>
        <div className="ramo-reading">
          {empty ? <Welcome /> : null}
          {messages.map((message, index) => (
            <div key={`${message.at ?? 'm'}-${index}`} className={currentMatch === index ? 'oc-search-current' : undefined}>
              <Turn message={message} index={index} />
            </div>
          ))}
          {pendingUser ? (
            <article className="ramo-w-chat user ramo-w-pending" data-pending="true">
              <div className="oc-speaker">YOU · sending</div>
              <div className="oc-response-body"><div dangerouslySetInnerHTML={{ __html: renderMarkdown(pendingUser) }} /></div>
            </article>
          ) : null}
          {busy && !streaming && !showActivity ? (
            <div className="oc-working-note" role="status"><span className="oc-working-dot" aria-hidden="true" />Ramo is working…</div>
          ) : null}
          {busy && (streaming || showActivity) ? (
            <article className="ramo-w-chat assistant ramo-w-chat-live" data-oc-turn-index={String(messages.length)}>
              <div className="oc-speaker">RAMO · LIVE</div>
              <div className="oc-response-body">
                {liveText ? <div className="oc-live-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(liveText) }} /> : null}
                {showActivity ? <ActivityTimeline run={liveRunRow} busy /> : null}
              </div>
            </article>
          ) : null}
          <FileCards />
        </div>
      </div>
      {showJump ? <button type="button" className="oc-jump-latest" onClick={scrollToLatest} title="Jump to the latest message">↓ Latest</button> : null}
    </div>
  );
}
