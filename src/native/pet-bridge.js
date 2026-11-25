// Ramo Pet — main-window integration bridge.
//
// The Pet toggle is the native sidebar item (#oc-pet-item, built by the
// studio renderer next to Manage chats / Computer / Models / Settings).
// This bridge mirrors activation state onto that item and opens the pet
// settings dialog (right-click the item). The pet window itself is owned
// by electron-main.cjs.
(function(){
  'use strict';
  var STYLE_ID = 'ramo-pet-bridge-style';
  function ensureStyle(){
    try{
      if (document.getElementById(STYLE_ID)) return;
      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = '#oc-pet-item[data-pet="on"]{color:var(--oc-text)!important;background:var(--oc-surface)!important}'
        + '.oc-pet-row{display:block;margin:0 0 14px}'
        + '.oc-pet-row > span{display:block;margin-bottom:6px;font-size:12px;color:var(--oc-soft,var(--oc-muted,#9aa))}'
        + '.oc-pet-row select,.oc-pet-row input[type="range"]{width:100%;box-sizing:border-box}';
      document.head && document.head.appendChild(style);
    }catch(_){}
  }
  function reflect(active){
    try{
      if (active) document.documentElement.dataset.petActive = '1';
      else delete document.documentElement.dataset.petActive;
      var item = document.getElementById('oc-pet-item');
      if (item) item.dataset.pet = active ? 'on' : 'off';
    }catch(_){}
  }
  function wireState(){
    try{
      var pet = window.ramoDesktop && window.ramoDesktop.pet;
      if (pet && typeof pet.onChanged === 'function'){
        pet.onChanged(function(s){ reflect(!!(s && s.active)); });
        if (typeof pet.onOpenSettings === 'function') pet.onOpenSettings(openPetSettings);
        return true;
      }
    }catch(_){}
    return false;
  }

  // ---- Pet settings dialog (native overlay modal) ----------------------------
  function openPetSettings(){
    try{
      var petApi = window.ramoDesktop && window.ramoDesktop.pet;
      var overlays = window.RamoOverlays;
      if (!petApi || typeof petApi.loadSettings !== 'function' || !overlays) return;
      var panel = document.createElement('section');
      var head = document.createElement('div');
      head.className = 'oc-dialog-head';
      var h2 = document.createElement('h2');
      h2.textContent = 'Ramo Pet';
      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'oc-shell-button';
      closeBtn.textContent = 'Close';
      closeBtn.onclick = function(){ overlays.close(); };
      head.append(h2, closeBtn);
      panel.append(head);

      var hint = document.createElement('p');
      hint.style.cssText = 'margin:0 0 16px;font-size:12px;color:var(--oc-muted,#9aa)';
      hint.textContent = 'Voice-only companion · hold the trigger to talk, release to send';
      panel.append(hint);

      // ---- Talk trigger ------------------------------------------------------
      // A mouse button and a keyboard chord can both be armed. Both are held
      // to talk, which is what makes the pet usable while a game has the
      // keyboard and the mouse.
      var triggerHead = document.createElement('p');
      triggerHead.style.cssText = 'margin:0 0 10px;font-size:13px;font-weight:600';
      triggerHead.textContent = 'Talk to the pet';
      panel.append(triggerHead);

      var mouseRow = document.createElement('label');
      mouseRow.className = 'oc-pet-row';
      var mouseSpan = document.createElement('span');
      mouseSpan.textContent = 'Mouse button';
      var mouseSel = document.createElement('select');
      [['back', 'Back button (side)'], ['forward', 'Forward button (side)'], ['middle', 'Middle button (wheel)'], ['none', 'None']].forEach(function(opt) {
        var o = document.createElement('option'); o.value = opt[0]; o.textContent = opt[1]; mouseSel.append(o);
      });
      mouseRow.append(mouseSpan, mouseSel);
      panel.append(mouseRow);

      var keyRow = document.createElement('label');
      keyRow.className = 'oc-pet-row';
      var keySpan = document.createElement('span');
      keySpan.textContent = 'Keyboard chord';
      var keyBox = document.createElement('span');
      keyBox.style.cssText = 'display:flex;gap:8px;align-items:center';
      var keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.readOnly = true;
      keyInput.style.cssText = 'flex:1;padding:6px 8px;font:inherit';
      keyInput.placeholder = 'None';
      var keyRecord = document.createElement('button');
      keyRecord.type = 'button';
      keyRecord.className = 'oc-shell-button';
      keyRecord.textContent = 'Press a shortcut';
      var keyClear = document.createElement('button');
      keyClear.type = 'button';
      keyClear.className = 'oc-shell-button';
      keyClear.textContent = 'Clear';
      keyBox.append(keyInput, keyRecord, keyClear);
      keyRow.append(keySpan, keyBox);
      panel.append(keyRow);

      var keyNote = document.createElement('p');
      keyNote.style.cssText = 'margin:-6px 0 16px;font-size:11px;color:var(--oc-muted,#9aa)';
      keyNote.textContent = 'The chord is held to talk. A mouse side button is usually easier while gaming.';
      panel.append(keyNote);

      var recording = false;
      function acceleratorFromEvent(e) {
        var parts = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        if (e.metaKey) parts.push('Super');
        var key = e.key;
        if (key === ' ' || key === 'Spacebar') parts.push('Space');
        else if (key && key.length === 1) parts.push(key.toUpperCase());
        else if (/^F\d{1,2}$/i.test(key || '')) parts.push(key.toUpperCase());
        else return '';
        return parts.join('+');
      }
      function onKeyDown(e) {
        if (!recording) return;
        var accelerator = acceleratorFromEvent(e);
        if (!accelerator) return;           // a modifier on its own: keep waiting
        e.preventDefault();
        e.stopPropagation();
        recording = false;
        keyInput.value = accelerator;
        keyRecord.textContent = 'Press a shortcut';
      }
      document.addEventListener('keydown', onKeyDown, true);
      keyRecord.onclick = function () {
        recording = !recording;
        keyRecord.textContent = recording ? 'Listening…' : 'Press a shortcut';
        if (recording) keyInput.value = '';
      };
      keyClear.onclick = function () {
        recording = false;
        keyRecord.textContent = 'Press a shortcut';
        keyInput.value = '';
      };

      var voiceRow = document.createElement('label');
      voiceRow.className = 'oc-pet-row';
      var voiceSpan = document.createElement('span');
      voiceSpan.textContent = 'Voice';
      var voiceSel = document.createElement('select');
      voiceRow.append(voiceSpan, voiceSel);
      panel.append(voiceRow);

      var volRow = document.createElement('label');
      volRow.className = 'oc-pet-row';
      var volSpan = document.createElement('span');
      var volRange = document.createElement('input');
      volRange.type = 'range';
      volRange.min = '10'; volRange.max = '100'; volRange.step = '10';
      var volOut = document.createElement('output');
      volOut.style.cssText = 'font-variant-numeric:tabular-nums';
      volSpan.append(document.createTextNode('Voice volume '), volOut);
      function paint(){ volOut.textContent = volRange.value + '%'; }
      volRange.oninput = paint;
      volRow.append(volSpan, volRange);
      panel.append(volRow);

      var modelRow = document.createElement('label');
      modelRow.className = 'oc-pet-row';
      var modelSpan = document.createElement('span');
      modelSpan.textContent = 'Preferred bonsai-2 size (falls back automatically)';
      var modelSel = document.createElement('select');
      [['4b', '4b — fastest replies'], ['9b', '9b — richest explanations'], ['2b', '2b — lightest load']].forEach(function(opt){
        var o = document.createElement('option'); o.value = opt[0]; o.textContent = opt[1]; modelSel.append(o);
      });
      modelRow.append(modelSpan, modelSel);
      panel.append(modelRow);

      var drawRow = document.createElement('label');
      drawRow.className = 'oc-pet-row';
      var drawSpan = document.createElement('span');
      var drawRange = document.createElement('input');
      drawRange.type = 'range';
      drawRange.min = '2'; drawRange.max = '20'; drawRange.step = '1';
      var drawOut = document.createElement('output');
      drawOut.style.cssText = 'font-variant-numeric:tabular-nums';
      drawSpan.append(document.createTextNode('Drawing time '), drawOut);
      function paintDraw(){ drawOut.textContent = drawRange.value + 's'; }
      drawRange.oninput = paintDraw;
      drawRow.append(drawSpan, drawRange);
      panel.append(drawRow);

      var errRow = document.createElement('label');
      errRow.className = 'oc-pet-row';
      errRow.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px';
      var errChk = document.createElement('input');
      errChk.type = 'checkbox';
      errRow.append(errChk, document.createTextNode('Speak errors out loud when a turn fails'));
      panel.append(errRow);

      var actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:10px;margin-top:18px';
      var save = document.createElement('button');
      save.type = 'button';
      save.className = 'oc-shell-button';
      save.textContent = 'Save';
      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'oc-shell-button';
      cancel.textContent = 'Cancel';
      cancel.onclick = function(){ overlays.close(); };
      save.onclick = function(){
        save.disabled = true;
        petApi.saveSettings({
          voice: voiceSel.value || undefined,
          volume: Number(volRange.value) / 100,
          preferModel: modelSel.value,
          speakErrors: errChk.checked,
          sketchSeconds: Number(drawRange.value),
          trigger: { mouse: mouseSel.value, key: (keyInput.value || '').trim() }
        }).then(function(){
          overlays.close();
        }).catch(function(){ save.disabled = false; });
      };
      actions.append(save, cancel);
      panel.append(actions);

      petApi.loadSettings().then(function(s){
        if (!s) return;
        for (var v of (s.voices || [])){
          var o = document.createElement('option');
          o.value = v; o.textContent = v.charAt(0).toUpperCase() + v.slice(1);
          if (v === (s.currentVoice || s.voice)) o.selected = true;
          voiceSel.append(o);
        }
        volRange.value = String(Math.round(Number(s.volume) * 100) || 95);
        paint();
        modelSel.value = s.preferModel || '4b';
        errChk.checked = s.speakErrors !== false;
        drawRange.value = String(Number(s.sketchSeconds) || 8);
        paintDraw();
        var trigger = s.trigger || {};
        mouseSel.value = trigger.mouse || 'back';
        keyInput.value = trigger.key || '';
      });

      overlays.open(panel, {
        modal: true,
        width: 520,
        label: 'Ramo Pet settings',
        // The chord recorder listens on the document, so it is removed again
        // when the dialog closes: opening the settings twice must not leave
        // two recorders behind.
        onClose: function () {
          recording = false;
          document.removeEventListener('keydown', onKeyDown, true);
        }
      });
    }catch(_){}
  }
  // Delegated right-click: survives sidebar rebuilds.
  document.addEventListener('contextmenu', function(e){
    var item = e.target && e.target.closest ? e.target.closest('#oc-pet-item') : null;
    if (!item) return;
    e.preventDefault();
    openPetSettings();
  }, true);

  function start(){
    ensureStyle();
    try{ window.RamoPet = Object.freeze({ openSettings: openPetSettings }); }catch(_){}
    if (!wireState()){
      var tries = 0;
      var timer = setInterval(function(){
        tries++;
        if (wireState() || tries > 40) clearInterval(timer);
      }, 250);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
