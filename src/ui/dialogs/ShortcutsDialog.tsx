import { createPortal } from 'react-dom';
import type { RefObject } from 'react';
import { useDialogFocus } from '../lib/useDialogFocus';

const SHORTCUTS: Array<[string, string]> = [
  ['New chat', 'Ctrl / ⌘ + N'],
  ['Search all chats', 'Ctrl / ⌘ + K'],
  ['Search this conversation', 'Ctrl / ⌘ + F'],
  ['Send a message', 'Enter'],
  ['Add a new line', 'Shift + Enter'],
  ['Stop the current response', 'Ctrl / ⌘ + Shift + X'],
  ['Close a menu or dialog', 'Esc'],
  ['Show these shortcuts', 'Ctrl / ⌘ + /'],
];

/** Small, keyboard-dismissable reference for shortcuts that already exist. */
export function ShortcutsDialog({ onClose, returnFocus }: { onClose: () => void; returnFocus?: RefObject<HTMLButtonElement | null> }) {
  const dialogRef = useDialogFocus<HTMLElement>(onClose, true, true, returnFocus);

  return createPortal(
    <div className="oc-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} className="oc-shortcuts-dialog" role="dialog" aria-modal="true" aria-labelledby="oc-shortcuts-title">
        <header className="oc-dialog-head">
          <div>
            <h2 id="oc-shortcuts-title">Keyboard shortcuts</h2>
            <p>Less reaching for the mouse.</p>
          </div>
          <button type="button" className="oc-dialog-close" aria-label="Close keyboard shortcuts" onClick={onClose}>×</button>
        </header>
        <div className="oc-shortcuts-list">
          {SHORTCUTS.map(([action, keys]) => (
            <div className="oc-shortcut-row" key={action}>
              <span>{action}</span>
              <kbd>{keys}</kbd>
            </div>
          ))}
        </div>
        <p className="oc-dialog-footnote">Search a conversation, then use the up and down buttons to move between matches.</p>
      </section>
    </div>,
    document.body,
  );
}
