/* API keys for cloud providers. Simple on purpose: one encrypted field per
   provider, saved on this computer, never read back into the screen. The
   provider configuration (src/native/ramo-api-providers.js) owns the
   key; this dialog is only the doorway. Keys are never rendered, never
   logged, and never leave the app. */
(function () {
  'use strict';
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const api = () => globalThis.ramoDesktop?.apiProviders;
  // Adding a provider here is the whole next feature: one entry, one row in
  // the dialog, done. Keep the list tiny until each provider is verified.
  const KNOWN = [
    { id: 'openai', name: 'OpenAI', hint: 'Use OpenAI chat models with your own key.' },
    { id: 'openrouter', name: 'OpenRouter', hint: 'One key unlocks every model OpenRouter routes to.' },
    { id: 'anthropic', name: 'Anthropic', hint: 'Use Anthropic chat models with your own key.' },
    { id: 'gemini', name: 'Google Gemini', hint: 'Use Gemini chat models with your own key.' },
    { id: 'nvidia', name: 'NVIDIA', hint: 'One key unlocks the NVIDIA NIM catalogue.' },
  ];
  const notice = (panel, text, tone) => {
    const p = panel.querySelector('.oc-key-notice');
    if (!p) return;
    p.textContent = text || '';
    p.classList.toggle('error', tone === 'error');
    p.classList.toggle('ok', tone === 'ok');
  };
  const refreshRow = async (panel, row) => {
    const status = row.querySelector('.oc-key-status');
    const input = row.querySelector('.oc-key-input');
    const clearBtn = row.querySelector('.oc-key-clear');
    try {
      const rows = await api().knownStatus();
      const entry = rows.find((item) => item.provider === row.dataset.provider) || { saved: false };
      status.textContent = entry.saved ? `✓ Saved — ${entry.masked}` : 'Not set';
      status.classList.toggle('set', !!entry.saved);
      input.placeholder = entry.saved ? 'Paste a new key to replace it' : `Paste your ${row.dataset.name} key here`;
      clearBtn.disabled = !entry.saved;
    } catch (error) {
      status.textContent = 'Status unavailable';
      status.classList.remove('set');
    }
  };
  function buildRow(panel, provider) {
    const row = el('div', undefined, 'oc-key-row');
    row.dataset.provider = provider.id;
    row.dataset.name = provider.name;
    row.append(el('div', provider.name, 'oc-key-name'));
    row.append(el('div', provider.hint, 'oc-key-hint'));
    row.append(el('div', 'Not set', 'oc-key-status'));
    const field = el('div', undefined, 'oc-key-field');
    const input = el('input', undefined, 'oc-key-input');
    input.type = 'password';
    input.autocomplete = 'new-password';
    input.spellcheck = false;
    input.setAttribute('aria-label', provider.name + ' API key');
    const toggle = el('button', 'Show', 'oc-key-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Show or hide the key as you type');
    toggle.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      toggle.textContent = input.type === 'password' ? 'Show' : 'Hide';
    });
    field.append(input, toggle);
    row.append(field);
    const actions = el('div', undefined, 'oc-key-actions');
    const save = el('button', 'Save', 'oc-shell-button primary');
    save.type = 'button';
    save.addEventListener('click', async () => {
      const value = input.value;
      input.value = '';
      const trimmed = value.trim();
      if (!trimmed) return notice(panel, `Paste your ${provider.name} key first.`, 'error');
      try {
        await api().knownSave(provider.id, trimmed);
        await refreshRow(panel, row);
        notice(panel, `${provider.name} key saved.`, 'ok');
      } catch (error) {
        notice(panel, error?.message || 'The key was not saved.', 'error');
      }
    });
    const clear = el('button', 'Clear', 'oc-shell-button oc-key-clear');
    clear.type = 'button';
    clear.disabled = true;
    clear.addEventListener('click', async () => {
      if (!confirm(`Remove the ${provider.name} key from this computer?`)) return;
      try {
        await api().knownClear(provider.id);
        await refreshRow(panel, row);
        notice(panel, `${provider.name} key removed.`, 'ok');
      } catch (error) {
        notice(panel, error?.message || 'The key was not removed.', 'error');
      }
    });
    actions.append(save, clear);
    row.append(actions);
    return row;
  }
  function open(anchor) {
    const bridge = api();
    if (!bridge?.knownStatus || !bridge?.knownSave) {
      globalThis.__ramoWorkspaceUIActive?._showSmallStatus?.('Restart the app to use API keys.');
      return;
    }
    window.RamoOverlays?.close?.(false);
    const panel = el('section', undefined, 'oc-keys-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'API keys');
    const head = el('div', undefined, 'oc-dialog-head');
    const h2 = el('h2', 'API keys');
    const close = el('button', 'Close', 'oc-shell-button');
    close.type = 'button';
    close.addEventListener('click', () => window.RamoOverlays?.close?.());
    head.append(h2, close);
    panel.append(head);
    panel.append(el('p', 'Keys stay on this computer, encrypted by Windows. They unlock the matching provider and are never written to chats, exports or screenshots.', 'oc-keys-note'));
    const fields = el('div', undefined, 'oc-keys-list');
    const rows = KNOWN.map((provider) => { const row = buildRow(panel, provider); fields.append(row); return row; });
    panel.append(fields);
    const p = el('p', '', 'oc-key-notice');
    p.setAttribute('role', 'status');
    panel.append(p);
    panel.append(el('p', 'More providers can be added here as they are verified.', 'oc-keys-tail'));
    window.RamoOverlays?.open?.(panel, { anchor, modal: true, width: 440, label: 'API keys' });
    Promise.all(rows.map((row) => refreshRow(panel, row))).catch(() => notice(panel, 'The key status could not be read.', 'error'));
  }
  window.RamoKeys = { open, KNOWN };
})();
