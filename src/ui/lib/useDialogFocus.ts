import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Keep keyboard focus inside a dialog, isolate global shortcuts, and restore the invoker. */
export function useDialogFocus<T extends HTMLElement>(onClose: () => void, modal = true, enabled = true, returnFocus?: RefObject<HTMLElement | null>): RefObject<T | null> {
  const containerRef = useRef<T>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!enabled) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    const appRoot = document.getElementById('root');
    if (modal && appRoot) appRoot.inert = true;
    const focusable = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((node) => node.getClientRects().length > 0 && !node.closest('[inert]'));
    if (!container.contains(document.activeElement)) (focusable()[0] ?? container).focus();

    const onKey = (event: KeyboardEvent) => {
      // A modal must not also trigger New chat, global search, or response stop.
      if (event.ctrlKey || event.metaKey || event.altKey) event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); container.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (modal && appRoot) appRoot.inert = false;
      const target = returnFocus?.current ?? previous;
      const fallback = document.getElementById('oc-mobile-nav');
      const destination = target?.isConnected && !target.closest('[inert]') ? target : fallback;
      if (destination?.isConnected) destination.focus();
    };
  }, [modal, enabled]);

  return containerRef;
}
