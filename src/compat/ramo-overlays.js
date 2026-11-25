/* One owner for transient desktop surfaces. No inference or storage responsibilities. */
(function () {
  'use strict';
  let active = null;
  const focusables = panel => [...panel.querySelectorAll('button,input,textarea,select,summary,a[href],[tabindex="0"]')]
    .filter(e => !e.disabled && e.getClientRects().length);
  function close(restore = true) {
    if (!active) return;
    const previous = active; active = null;
    window.removeEventListener('resize', previous.place);
    previous.observer.disconnect();
    previous.layer.remove();
    previous.anchor?.setAttribute('aria-expanded', 'false');
    previous.onClose?.();
    if (restore && previous.anchor?.isConnected) previous.anchor.focus();
  }
  function open(panel, {anchor = document.activeElement, modal = false, width = 380, label = 'Dialog', onClose} = {}) {
    close(false);
    const layer = document.createElement('div');
    layer.className = 'oc-overlay-layer' + (modal ? ' is-modal' : '');
    panel.classList.add('oc-overlay-panel');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', label);
    panel.setAttribute('aria-modal', 'true'); panel.tabIndex = -1;
    layer.append(panel); document.body.append(layer);
    anchor?.setAttribute('aria-expanded', 'true');
    const place = () => {
      const w = Math.min(width, innerWidth - 24);
      panel.style.width = w + 'px'; panel.style.maxHeight = (innerHeight - 32) + 'px';
      const h = Math.min(panel.scrollHeight + 2, innerHeight - 32);
      if (modal) { panel.style.left = Math.max(12, (innerWidth - w) / 2) + 'px'; panel.style.top = Math.max(16, (innerHeight - h) / 2) + 'px'; }
      else {
        const r = anchor?.getBoundingClientRect();
        panel.style.left = Math.max(12, Math.min(r?.left ?? 12, innerWidth - w - 12)) + 'px';
        const below = (r?.bottom ?? 52) + 8;
        panel.style.top = Math.max(16, Math.min(below + h <= innerHeight - 16 ? below : (r?.top ?? below) - h - 8, innerHeight - h - 16)) + 'px';
      }
    };
    const observer = new ResizeObserver(place);
    active = {panel, layer, anchor, place, onClose, observer};
    // Legacy content handlers call panel.remove(); ownership still closes its backdrop.
    panel.remove = () => { if (active?.panel === panel) close(); else Element.prototype.remove.call(panel); };
    layer.addEventListener('pointerdown', e => { if (e.target === layer) close(); });
    panel.addEventListener('toggle', place, true);
    window.addEventListener('resize', place); place();
    observer.observe(panel);
    (focusables(panel)[0] || panel).focus();
    return panel;
  }
  document.addEventListener('keydown', e => {
    if (!active) return;
    if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    else if (e.key === 'Tab') {
      const list = focusables(active.panel), first = list[0], last = list.at(-1);
      if (!first) { e.preventDefault(); active.panel.focus(); }
      else if (e.shiftKey && (document.activeElement === first || !active.panel.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !active.panel.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    }
  }, true);
  window.RamoOverlays = {open, close, get current() { return active?.panel || null; }};
})();
