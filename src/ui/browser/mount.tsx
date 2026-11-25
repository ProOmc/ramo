import { createRoot } from 'react-dom/client';
import { BrowserPane } from './BrowserPane';

/**
 * The pane mounts beside the React shell, without changing the pending
 * Chat/Work simplification surface. It is additive: one host element and one
 * root, both owned by this module.
 */
const ID = 'ramo-browser-pane-root-v180';

export function mountBrowserPane(): void {
  if (document.getElementById(ID)) return;
  const host = document.createElement('div');
  host.id = ID;
  document.body.appendChild(host);
  createRoot(host).render(<BrowserPane />);
}
