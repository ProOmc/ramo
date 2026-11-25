import { useEffect, useRef, useState } from 'react';
import { useShell } from '../lib/hooks';
import { assistantApi, type ChatMessage } from '../lib/chat';
import { renderMarkdown } from '../lib/markdown';
import { renderChartSvg } from '../lib/chart';
import { source, type RamoImage } from '../lib/image-core';
import { gatherInlineRuns } from '../lib/activity';
import { ActivityTimeline } from './ActivityTimeline';
import { ReplyStats } from './ReplyStats';

interface TurnProps {
  message?: ChatMessage;
  index?: number;
}

const BRANCH = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="8" r="2.2"/><path d="M6 8.3v7.4M6 15.6C6 12 8.4 9.5 15.8 8.3"/></svg>';
const RETRY = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v7h7"/><path d="M4 11a9 9 0 1 0 2.6-6.4L4 8"/></svg>';
const DELETE = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';
const COPY = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
const EDIT = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l11-11a2.4 2.4 0 0 0-3.4-3.4L4.6 16.6 4 20z"/></svg>';
const SPEAKER = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
let voiceHintShown = false;

function ImageRow({ images }: { images: RamoImage[] }) {
  if (!images.length) return null;
  return (
    <div className="oc-image-thumbnails">
      {images.map((image, index) => {
        const src = source(image);
        return src ? <img key={index} src={src} alt={image.name || 'Attached image'} title={image.name || 'Attached image'} loading="lazy" /> : null;
      })}
    </div>
  );
}

export function Turn({ message, index }: TurnProps) {
  const {
    activeChatId, messages, showToast,
  } = useShell();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const api = assistantApi() as unknown as Record<string, (i: number, ...args: unknown[]) => Promise<unknown> | unknown> | undefined;
  useEffect(() => {
    const root = chartRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>('[data-oc-chart]').forEach((node) => {
      try { node.innerHTML = renderChartSvg(decodeURIComponent(node.dataset.ocChart || '')); }
      catch { node.textContent = ''; }
    });
  }, [message?.assistant]);

  if (!message || index === undefined || index === null) return null;

  const userText = String(message.user ?? '');
  const assistantText = String(message.assistant ?? '');
  const images = (message.attachments ?? []).filter((a) => a.kind === 'images').flatMap((a) => (a.images ?? []) as RamoImage[]);
  const pending = !assistantText && !images.length;

  const retry = () => {
    const later = messages.length - index - 1;
    if (later && !window.confirm('Regenerate from this message in a new branch? The original conversation will be saved.')) return;
    void Promise.resolve(api?.regenerateChatMessageAt?.(index)).catch((error) => showToast(String((error as Error)?.message || error)));
  };
  const fork = () => {
    void Promise.resolve(api?.forkChatAt?.(index)).catch((error) => showToast(String((error as Error)?.message || error)));
  };
  const remove = () => {
    if (!window.confirm('Delete this user message and its answer? The original conversation will remain available in Chat tools → Conversation branches.')) return;
    void Promise.resolve(api?.deleteChatMessageAt?.(index, 'exchange')).catch((error) => showToast(String((error as Error)?.message || error)));
  };
  const removeReply = () => {
    if (!window.confirm('Delete only this answer? The original conversation will remain available in Chat tools → Conversation branches.')) return;
    void Promise.resolve(api?.deleteChatMessageAt?.(index, 'reply')).catch((error) => showToast(String((error as Error)?.message || error)));
  };
  const copy = () => {
    void navigator.clipboard?.writeText(assistantText).then(() => showToast('Copied answer to clipboard.')).catch((error) => showToast(String((error as Error)?.message || error)));
  };
  const startEdit = () => {
    setDraft(userText);
    setEditing(true);
  };
  const saveEdit = () => {
    const updated = draft.trim();
    if (!updated) { showToast('Message cannot be empty.'); return; }
    if (updated === userText) { setEditing(false); return; }
    if (!window.confirm('Save this edit as a new branch? The original answer and later messages remain in Chat tools → Conversation branches.')) return;
    void Promise.resolve(api?.editChatMessageAt?.(index, updated)).then(() => {
      setEditing(false);
      showToast('Message saved. Select Regenerate to request a new answer.');
    }).catch((error) => showToast(String((error as Error)?.message || error)));
  };

  const speakAnswer = () => {
    if (speaking) {
      const active = (window as unknown as { __ramoPocketAudio?: HTMLAudioElement }).__ramoPocketAudio;
      try { active?.pause(); if (active) active.src = ''; } catch { /* ignored */ }
      (window as unknown as { __ramoPocketAudio?: HTMLAudioElement }).__ramoPocketAudio = undefined;
      setSpeaking(false);
      return;
    }
    if (!voiceHintShown) { voiceHintShown = true; showToast('First read-out can take a moment while the local voice starts on demand.'); }
    void (async () => {
      setSpeaking(true);
      try {
        const result = await window.ramoDesktop.pocket?.speakOnce?.(assistantText) as { wavBase64?: string } | undefined;
        if (result?.wavBase64) {
          const prior = (window as unknown as { __ramoPocketAudio?: HTMLAudioElement }).__ramoPocketAudio;
          if (prior) { prior.pause(); prior.src = ''; }
          const audio = new Audio('data:audio/wav;base64,' + result.wavBase64);
          (window as unknown as { __ramoPocketAudio?: HTMLAudioElement }).__ramoPocketAudio = audio;
          audio.onended = () => setSpeaking(false);
          audio.onerror = () => { setSpeaking(false); showToast('The generated voice could not be played.'); };
          await audio.play();
        } else {
          setSpeaking(false);
        }
      } catch (error) {
        setSpeaking(false);
        showToast(error instanceof Error ? error.message : String(error));
      }
    })();
  };

  const runs = gatherInlineRuns(
    activeChatId,
    messages,
    (assistantApi() as { session?: { turn?: { activity?: unknown } } } | undefined)?.session?.turn?.activity as never,
  );
  const run = runs.find((row) => row.index === index);

  return (
    <>
      {userText || images.length ? (
        <article className="ramo-w-chat user" data-oc-turn-index={String(index)}>
          <div className="oc-speaker">YOU</div>
          <div className="oc-response-body">
            {userText ? <div dangerouslySetInnerHTML={{ __html: renderMarkdown(userText) }} /> : null}
            {images.length ? <ImageRow images={images} /> : null}
          </div>
          {editing ? (
            <div className="oc-turn-editor">
              <textarea className="oc-turn-edit-input" aria-label="Edit user message" rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} />
              <div className="oc-turn-edit-actions">
                <button type="button" onClick={saveEdit}>Save</button>
                <button type="button" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="oc-message-actions">
              <button type="button" data-oc-turn-edit={String(index)} aria-label="Edit message" onClick={startEdit} dangerouslySetInnerHTML={{ __html: '<span>' + EDIT + '</span> Edit' }} />
              <button type="button" data-oc-turn-delete={String(index)} aria-label="Delete user message" onClick={remove} dangerouslySetInnerHTML={{ __html: '<span>' + DELETE + '</span> Delete' }} />
            </div>
          )}
        </article>
      ) : null}
      {(assistantText || run || pending) ? (
        <article className="ramo-w-chat assistant" data-oc-turn-index={String(index)}>
          <div className="oc-speaker">RAMO</div>
          <div className="oc-response-body">
            <ActivityTimeline run={run} />
            {assistantText ? <div ref={chartRef} dangerouslySetInnerHTML={{ __html: renderMarkdown(assistantText) }} /> : null}
          </div>
          <div className="oc-message-actions">
            {assistantText ? <button type="button" data-oc-message-speak="true" aria-label={speaking ? 'Stop reading' : 'Read answer aloud'} aria-pressed={speaking} onClick={speakAnswer} dangerouslySetInnerHTML={{ __html: '<span>' + SPEAKER + '</span> ' + (speaking ? 'Stop' : 'Speak') }} /> : null}
            <button type="button" data-oc-turn-fork={String(index)} aria-label="Branch from here" onClick={fork} dangerouslySetInnerHTML={{ __html: '<span>' + BRANCH + '</span> Branch' }} />
            <button type="button" data-oc-turn-retry={String(index)} aria-label="Regenerate answer" onClick={retry} dangerouslySetInnerHTML={{ __html: '<span>' + RETRY + '</span> Retry' }} />
            {assistantText ? <button type="button" data-oc-message-copy="true" aria-label="Copy answer" onClick={copy} dangerouslySetInnerHTML={{ __html: '<span>' + COPY + '</span> Copy' }} /> : null}
            <button type="button" data-oc-turn-delete={String(index)} aria-label="Delete answer only" onClick={removeReply} dangerouslySetInnerHTML={{ __html: '<span>' + DELETE + '</span> Delete' }} />
            <ReplyStats run={run} />
          </div>
        </article>
      ) : null}
    </>
  );
}

