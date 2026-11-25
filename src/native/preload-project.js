'use strict';
const {contextBridge,ipcRenderer}=require('electron');
// No filesystem or arbitrary process methods in the PenguinMod/extension renderer.
contextBridge.exposeInMainWorld('ramoDesktop', Object.freeze({
  work:Object.freeze({request:(method,params)=>ipcRenderer.invoke('ramo:work:request',method,params),onEvent:callback=>{const handler=(_event,packet)=>callback(packet);ipcRenderer.on('ramo:work:event',handler);return ()=>ipcRenderer.removeListener('ramo:work:event',handler);}}),
  // The memory projection the worker writes, and the command inbox it reads.
  // The renderer never touches the fact store itself.
  memory:Object.freeze({
    read:()=>ipcRenderer.invoke('ramo:memory:read'),
    command:(command)=>ipcRenderer.invoke('ramo:memory:command',command||{}),
    onChanged:callback=>{
      if(typeof callback!=='function')return ()=>{};
      const handler=(_event,packet)=>callback(packet);
      ipcRenderer.on('ramo:memory:changed',handler);
      return ()=>ipcRenderer.removeListener('ramo:memory:changed',handler);
    }
  }),
  openModelManager:()=>ipcRenderer.invoke('ramo:open-manager'),
  // Local-only document conversion. The main process spawns the Python worker;
  // the renderer never receives raw document bytes or a cloud endpoint.
  documents:Object.freeze({
    convert:input=>ipcRenderer.invoke('ramo:document:convert',input||{})
  }),
  files:Object.freeze({
    openPath:p=>ipcRenderer.invoke('ramo:system:open-path',p).catch(error=>{throw Error(String(error?.message??error).replace(/^Error invoking remote method '[^']*':\s*([A-Za-z]*Error:\s*)?/,''));}),
    revealPath:p=>ipcRenderer.invoke('ramo:system:reveal-path',p).catch(error=>{throw Error(String(error?.message??error).replace(/^Error invoking remote method '[^']*':\s*([A-Za-z]*Error:\s*)?/,''));}),
  }),
  computer:Object.freeze({snapshot:()=>ipcRenderer.invoke('ramo:system:snapshot')}),
  // Typed in-app browser only. No eval and no CDP access cross this bridge.
  browser:Object.freeze({
    tool:(tool,args)=>ipcRenderer.invoke('ramo:browser:tool',tool,args||{}),
    metrics:()=>ipcRenderer.invoke('ramo:browser:metrics'),
    pane:Object.freeze({
      open:bounds=>ipcRenderer.invoke('ramo:browser:pane-open',bounds||{}),
      close:()=>ipcRenderer.invoke('ramo:browser:pane-close'),
      bounds:bounds=>ipcRenderer.invoke('ramo:browser:pane-bounds',bounds||{}),
      takeControl:()=>ipcRenderer.invoke('ramo:browser:take-control'),
      resume:()=>ipcRenderer.invoke('ramo:browser:resume'),
      state:()=>ipcRenderer.invoke('ramo:browser:state'),
      onState:callback=>{if(typeof callback!=='function')return ()=>{};const handler=(_event,packet)=>callback(packet);ipcRenderer.on('ramo:browser:state',handler);return ()=>ipcRenderer.removeListener('ramo:browser:state',handler);}
    })
  }),
  modelSummary:()=>ipcRenderer.invoke('ramo:models:summary'),
  modelProfiles:()=>ipcRenderer.invoke('ramo:models:profiles'),
  setup:Object.freeze({
    get:()=>ipcRenderer.invoke('ramo:setup:get'),
    save:input=>ipcRenderer.invoke('ramo:setup:save',input||{}),
    downloadOllama:()=>ipcRenderer.invoke('ramo:setup:ollama-download'),
    browseOllamaModels:()=>ipcRenderer.invoke('ramo:setup:ollama-library'),
    startOllama:()=>ipcRenderer.invoke('ramo:setup:ollama-start'),
  }),
  apiProviders:Object.freeze({
    list:()=>ipcRenderer.invoke('ramo:api-providers:list'),
    save:profile=>ipcRenderer.invoke('ramo:api-providers:save',profile),
    remove:id=>ipcRenderer.invoke('ramo:api-providers:remove',id),
    chat:(id,requestId,payload)=>ipcRenderer.invoke('ramo:api-providers:chat',id,requestId,payload),
    knownStatus:()=>ipcRenderer.invoke('ramo:api-providers:known-status'),
    knownSave:(provider,apiKey)=>ipcRenderer.invoke('ramo:api-providers:known-save',{provider,apiKey}),
    knownClear:provider=>ipcRenderer.invoke('ramo:api-providers:known-clear',provider),
    knownChat:(provider,requestId,payload)=>ipcRenderer.invoke('ramo:api-providers:known-chat',provider,requestId,payload),
    // Handler-thrown errors arrive wrapped in "Error invoking remote method…"; strip Electron's wrapper so the user sees just the provider's message.
    models:spec=>ipcRenderer.invoke('ramo:api-providers:models',spec).catch(error=>{throw Error(String(error?.message??error).replace(/^Error invoking remote method '[^']*':\s*([A-Za-z]*Error:\s*)?/,''));}),
    abort:requestId=>ipcRenderer.send('ramo:api-providers:abort',requestId),
    onChunk:callback=>{
      if(typeof callback!=='function')return ()=>{};
      const handler=(_event,packet)=>callback(packet);
      ipcRenderer.on('ramo:api-providers:chunk',handler);
      return ()=>ipcRenderer.removeListener('ramo:api-providers:chunk',handler);
    }
  }),
  startModel:id=>ipcRenderer.invoke('ramo:models:start-selected',id),
  cancelModelStart:id=>ipcRenderer.invoke('ramo:models:cancel-start',id),
  ollamaModels:port=>ipcRenderer.invoke('ramo:models:installed',port),
  pages:Object.freeze({
    open:name=>{if(['computer','models'].includes(name))document.dispatchEvent(new CustomEvent('ramo:desktop-page-open',{detail:name}));},
    current:()=>document.body?.dataset.ocDesktopPage||''
  }),
  stt:Object.freeze({
    recognize:options=>ipcRenderer.invoke('ramo:stt:recognize',options||{}),
    stop:()=>ipcRenderer.invoke('ramo:stt:stop'),
    status:()=>ipcRenderer.invoke('ramo:stt:status'),
    onEvent:callback=>{
      if(typeof callback!=='function')return ()=>{};
      const handler=(_event,packet)=>callback(packet);
      ipcRenderer.on('ramo:stt:event',handler);
      return ()=>ipcRenderer.removeListener('ramo:stt:event',handler);
    }
  }),
  pocket: Object.freeze({
    status:()=>ipcRenderer.invoke('ramo:voice:status'),
    configure:()=>ipcRenderer.invoke('ramo:voice:configure'),
    settings:settings=>ipcRenderer.invoke('ramo:voice:settings',settings),
    speak:text=>ipcRenderer.invoke('ramo:voice:speak',text),
    // One-shot read-out for the per-message speaker button. Electron wraps
    // handler errors; strip the wrapper so the toast shows the real message.
    speakOnce:text=>ipcRenderer.invoke('ramo:voice:speak-once',text).catch(error=>{throw Error(String(error?.message??error).replace(/^Error invoking remote method '[^']*':\s*([A-Za-z]*Error:\s*)?/,''));})
  }),
  pet:Object.freeze({
    pushState:(s)=>ipcRenderer.send('ramo:pet:state',s),
    show:()=>ipcRenderer.invoke('ramo:pet:show'),
    hide:()=>ipcRenderer.invoke('ramo:pet:hide'),
    toggle:()=>ipcRenderer.invoke('ramo:pet:toggle'),
    onChanged:(cb)=>ipcRenderer.on('ramo:pet:changed',(_,d)=>cb(d)),
    onOpenSettings:(cb)=>ipcRenderer.on('ramo:pet:open-settings',()=>cb()),
    loadSettings:()=>ipcRenderer.invoke('ramo:pet:get-settings'),
    saveSettings:(s)=>ipcRenderer.invoke('ramo:pet:set-settings',s),
    // Only a test build answers this: a transcript handed to the pet so the
    // router, the reminders and the voice can be exercised without a person.
    simulate:(text)=>ipcRenderer.invoke('ramo:pet:simulate',text),
    // Only a test build answers this: what the pet window actually is, so the
    // checks can tell whether the companion can be seen.
    inspect:()=>ipcRenderer.invoke('ramo:pet:inspect'),
    // Only a test build answers this: draw a command list directly, so the
    // overlay can be exercised without a model run.
    sketch:(input)=>ipcRenderer.invoke('ramo:pet:sketch',input),
    // Only a test build answers this: what the drawing turn would do before
    // it asks the model anything, so the checks can see whether the pet looked
    // at the screen first.
    drawPlan:(input)=>ipcRenderer.invoke('ramo:pet:draw-plan',input),
    // Only a test build answers this: run the grounded drawing turn without
    // showing anything on the user's screen, so a live run can measure the
    // stages against the local model.
    ground:(input)=>ipcRenderer.invoke('ramo:pet:ground',input),
    // Only a test build answers this: the same run against a picture on
    // disk, so the frozen fixture set can be measured the same way every
    // time, whatever is on the desktop.
    groundFile:(input)=>ipcRenderer.invoke('ramo:pet:ground-file',input)
  })
}));
