'use strict';

const {app, BrowserWindow, Menu, shell, screen, dialog, ipcMain, safeStorage, net} = require('electron');

const {ModelManager} = require('./model-manager');
const {RamoApiProviders, createElectronFetch} = require('./ramo-api-providers');

const {PocketVoice, VOICES, LANGUAGES} = require('./ramo-pocket-tts');

const {LocalSpeech} = require('./ramo-local-stt');

// Local document-to-Markdown conversion. Only this main process may spawn the
// Python worker; the renderer receives Markdown, never raw document bytes.
const {createConverter} = require('./work/document-convert.cjs');
const documentConverter = createConverter({
  dataDir: app.getPath('userData'),
});

const {PetInput, normalizeTrigger} = require('./pet-input.cjs');

const {parseSketch, projectSketch, sketchPrompt, sketchSystemPrompt, sketchConfirmation, isDrawRequest, wantsScreenContext, NO_SCREEN_REPLY} = require('./pet-sketch.cjs');

const grounding = require('./pet-grounding.cjs');
const petThinking = require('./pet-thinking.cjs');
const petScreen = require('./pet-screen.cjs');
const petDetect = require('./pet-detect.cjs');
const detectCodec = require('./pet-detect-codec.cjs');
const {Tracker: PetTracker, iou: petIou} = require('./pet-track.cjs');

const {SystemAwareness} = require('./system-awareness');

let projectWindow = null;

let modelWindow = null;

let manager = null;

let pocketVoice = null;

let localSpeech = null;

// Keeps the Nemotron speech model loaded after startup (and restarts it if the
// worker ever exits), so dictation and the pet never pay a model load.
let sttWarmTimer = null;

let systemAwareness = null;
let apiProviders = null;
const apiProviderRequests = new Map();

const path = require('path');
if(process.env.RAMO_PROFILE_DIR)app.setPath('userData',path.resolve(process.env.RAMO_PROFILE_DIR));

// Single-instance guard: a second launch must not race the first over shared
// user data (sessions, chat history), fixed local service ports (Pocket TTS,
// Bonsai router) or duplicate tray/pet instances. It focuses the running
// window instead.
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) { app.quit(); }
app.on('second-instance', () => {
  try {
    const win = projectWindow && !projectWindow.isDestroyed() ? projectWindow : null;
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  } catch (_) {}
});

// Main-process network transport: this Electron build has no global fetch here.
const petFetch = createElectronFetch(net);
const fs = require('fs');
const http = require('http');

// ---- Pet settings (persisted in userData) ----------------------------------
const petSettingsFile = () => path.join(app.getPath('userData'), 'pet-settings.json');
// The trigger is the way the pet is talked to: a mouse button and/or a
// keyboard chord, both held to talk. The mouse side button is the default
// because it can be used without leaving the game.
let petSettings = { volume: .95, preferModel: '4b', speakErrors: true, voice: null, sketchSeconds: 8, trigger: { mouse: 'forward', key: 'Ctrl+Alt+Space' } };
try {
  const loaded = JSON.parse(fs.readFileSync(petSettingsFile(), 'utf8'));
  if (loaded && typeof loaded === 'object') {
    const trigger = loaded.trigger;
    petSettings = { ...petSettings, ...loaded };
    petSettings.trigger = normalizeTrigger(trigger && typeof trigger === 'object' ? trigger : petSettings.trigger);
  }
  if (!(Number.isFinite(petSettings.volume) && petSettings.volume >= 0.05 && petSettings.volume <= 1)) petSettings.volume = .95;
  if (!['4b', '9b', '2b'].includes(petSettings.preferModel)) petSettings.preferModel = '4b';
  petSettings.speakErrors = petSettings.speakErrors !== false;
  // How long a drawing stays on screen. A sketch is a glance, not a window:
  // the user asked for the visuals to be there for a short time.
  const sketchSeconds = Number(petSettings.sketchSeconds);
  petSettings.sketchSeconds = Number.isFinite(sketchSeconds) ? Math.max(2, Math.min(20, Math.round(sketchSeconds))) : 8;
  petSettings.trigger = normalizeTrigger(petSettings.trigger);
} catch (_) {}
function petSaveSettings() {
  try { fs.mkdirSync(path.dirname(petSettingsFile()), { recursive: true }); fs.writeFileSync(petSettingsFile(), JSON.stringify(petSettings, null, 2), 'utf8'); } catch (_) {}
}



const isWindows = process.platform === 'win32';

const isMac = process.platform === 'darwin';

const isLinux = process.platform === 'linux';



if (isMac) {

  Menu.setApplicationMenu(Menu.buildFromTemplate([

    { role: 'appMenu' },

    { role: 'fileMenu' },

    { role: 'editMenu' },

    { role: 'windowMenu' },

    { role: 'help' }

  ]));

} else {

  Menu.setApplicationMenu(null);

}



const resourcesURL = Object.assign(new URL('file://'), {

  pathname: path.join(__dirname, '/')

}).href;

const defaultProjectURL = new URL('./index.html', resourcesURL).href;



const createWindow = (windowOptions) => {

  const options = {

    title: "Ramo · Unified",

    icon: path.resolve(__dirname, "icon.png"),

    useContentSize: true,

    webPreferences: {

      sandbox: true,
      backgroundThrottling: process.env.RAMO_TEST!=='1',

      contextIsolation: true,

      nodeIntegration: false,

      preload: path.resolve(__dirname, "preload-project.js"),

    },

    show: true,

    width: 480,

    height: 360,

    ...windowOptions,

  };



  const activeScreen = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

  const bounds = activeScreen.workArea;

  options.x = bounds.x + ((bounds.width - options.width) / 2);

  options.y = bounds.y + ((bounds.height - options.height) / 2);



  const window = new BrowserWindow(options);

  installWindowLinkPolicy(window.webContents);

  return window;

};



const createProjectWindow = (url) => {

  const windowMode = "window";

  const options = {

    show: false,

    backgroundColor: "#1f2123",

    width: 1100,

    height: 750,

    minWidth: 600,

    minHeight: 430,

  };

  // fullscreen === false disables fullscreen on macOS so only set this property when it's true

  if (windowMode === 'fullscreen') {

    options.fullscreen = true;

  }

  const window = createWindow(options);

  projectWindow = window;

  if (windowMode === 'maximize') {

    window.maximize();

  }

  window.loadURL(url);

  window.show();

};



const createDataWindow = (dataURI) => {

  const window = createWindow({});

  window.loadURL(dataURI);

};



const isResourceURL = (url) => {

  try {

    const parsedUrl = new URL(url);

    return parsedUrl.protocol === 'file:' && parsedUrl.href.startsWith(resourcesURL);

  } catch (e) {

    // ignore

  }

  return false;

};



const SAFE_PROTOCOLS = [

  'https:',

  'http:',

  'mailto:',

];



const isSafeOpenExternal = (url) => {

  try {

    const parsedUrl = new URL(url);

    return SAFE_PROTOCOLS.includes(parsedUrl.protocol);

  } catch (e) {

    // ignore

  }

  return false;

};



const isDataURL = (url) => {

  try {

    const parsedUrl = new URL(url);

    return parsedUrl.protocol === 'data:';

  } catch (e) {

    // ignore

  }

  return false;

};



// Link policy is installed per app window at creation. The isolated agent
// browser has its own allowlist in browser-host.cjs and is never passed here.
function installWindowLinkPolicy(contents) {

  contents.setWindowOpenHandler((details) => {

    setImmediate(() => openLink(details.url));

    return {action: 'deny'};

  });

  contents.on('will-navigate', (e, url) => {

    if (!isResourceURL(url)) {

      e.preventDefault();

      openLink(url);

    }

  });

  contents.on('before-input-event', (e, input) => {

    const window = BrowserWindow.fromWebContents(contents);

    if (!window || input.type !== "keyDown") return;

    if ((input.key || '').toLowerCase() === 'm' && input.control && input.shift) {

      e.preventDefault();

      openModelManager();

    } else if (input.key === 'F11' || (input.key === 'Enter' && input.alt)) {

      window.setFullScreen(!window.isFullScreen());

    } else if (input.key === 'Escape' && window.isFullScreen()) {

      window.setFullScreen(false);

    }

  });

}

const openLink = (url) => {

  if (isDataURL(url)) {

    createDataWindow(url);

  } else if (isResourceURL(url)) {

    createProjectWindow(url);

  } else if (isSafeOpenExternal(url)) {

    if (process.env.RAMO_TEST) {
      try { fs.appendFileSync(path.join(app.getPath('userData'), 'external-open.log'), String(url) + '\n'); } catch {}
    }

    shell.openExternal(url);

  }

};



app.on('render-process-gone', (event, webContents, details) => {

  const window = BrowserWindow.fromWebContents(webContents);

  dialog.showMessageBoxSync(window, {

    type: 'error',

    title: 'Error',

    message: 'Renderer process crashed: ' + details.reason + ' (' + details.exitCode + ')'

  });

});



app.on('child-process-gone', (event, details) => {

  dialog.showMessageBoxSync({

    type: 'error',

    title: 'Error',

    message: details.type + ' child process crashed: ' + details.reason + ' (' + details.exitCode + ')'

  });

});



// No global web-contents-created navigation handler: it also caught the
// embedded agent browser and handed its navigations to shell.openExternal.
// installWindowLinkPolicy() is called for each app window; the agent view has
// its own http(s)-only allowlist in browser-host.cjs.



app.on('session-created', (session) => {

  session.webRequest.onBeforeRequest({

    urls: ["file://*"]

  }, (details, callback) => {

    callback({

      cancel: !details.url.startsWith(resourcesURL)

    });

  });

});



// File/settings edits and general process controls remain in the local manager window.

// The exact project window can explicitly start/cancel only an existing configured profile.

function openModelManager() {

  if (modelWindow && !modelWindow.isDestroyed()) { modelWindow.show(); modelWindow.focus(); return; }

  modelWindow = new BrowserWindow({

    title:'Ramo — Local Models', width:980, height:820, minWidth:650, minHeight:500,

    backgroundColor:'#1f2123', show:false, parent:projectWindow||undefined,

    webPreferences: {sandbox:true,contextIsolation:true,nodeIntegration:false,

      preload:path.resolve(__dirname,'preload-models.js')}

  });

  installWindowLinkPolicy(modelWindow.webContents);

  modelWindow.removeMenu();

  modelWindow.loadFile(path.resolve(__dirname,'models.html'));

  modelWindow.once('ready-to-show',()=>{if(modelWindow && !modelWindow.isDestroyed())modelWindow.show();});

  modelWindow.on('closed',()=>{modelWindow=null;});

}

function isProjectSender(event) {

  return projectWindow && !projectWindow.isDestroyed() && event.sender.id===projectWindow.webContents.id && event.senderFrame===event.sender.mainFrame &&

    event.sender.getURL()===defaultProjectURL;

}

function isManagerSender(event) {

  return modelWindow && !modelWindow.isDestroyed() && event.sender.id===modelWindow.webContents.id &&

    event.sender.getURL()===new URL('./models.html',resourcesURL).href;

}

ipcMain.handle('ramo:system:snapshot', async event=>{

  if(!isProjectSender(event)) throw Error('Not authorized');

  return systemAwareness.snapshot();

});

// Per-turn file artifacts: the chat renders a card for files the model
// created/edited (from the kernel's changes ledger). Opening goes through
// the OS default app; executables are deliberately refused — a model-written
// binary must never launch with Ramo's privileges. Reveal is always allowed.
const OPEN_PATH_BLOCK = /\.(exe|bat|cmd|com|msi|ps1|psm1|vbs|vbe|js|jse|wsf|jar|scr|pif|reg|cpl|hta)$/i;

function openPathGuard(value){
  const p=String(value||'').trim();
  if(!p||p.length>1000)throw Error('Invalid path.');
  if(!path.isAbsolute(p))throw Error('Only absolute paths can be opened.');
  const normalized=path.normalize(p);
  try{const st=fs.statSync(normalized);if(!st.isFile())throw Error('Not a file.');}
  catch(error){throw Error('That file no longer exists.');}
  return normalized;
}

ipcMain.handle('ramo:system:open-path', async (event, filePath)=>{

  if(!isProjectSender(event)) throw Error('Not authorized');

  const full=openPathGuard(filePath);
  if(OPEN_PATH_BLOCK.test(full)) throw Error('Ramo refuses to launch executable-type files. Use Reveal in folder instead.');

  const error=await shell.openPath(full);
  if(error) throw Error(error);

  return true;

});

ipcMain.handle('ramo:system:reveal-path', async (event, filePath)=>{

  if(!isProjectSender(event)) throw Error('Not authorized');

  const full=openPathGuard(filePath);
  shell.showItemInFolder(full);

  return true;

});

// Convert an unsupported document (PDF/DOCX/XLSX/PPTX/...) to Markdown locally.
// Input is {url} or {data:base64,name}. The renderer/model only ever sees text.
ipcMain.handle('ramo:document:convert', async (event, input)=>{
  if(!isProjectSender(event)) throw Error('Not authorized');
  try {
    const result = await documentConverter.convert(input || {});
    return {ok:true, markdown:String(result.markdown||''), chars:Number(result.chars)||0,
      ocr_used:!!result.ocr_used, ocr_error:String(result.ocr_error||''),
      ocr_model:String(result.ocr_model||''), name:String(result.name||'')};
  } catch (error) {
    return {ok:false, markdown:'', chars:0, error:String(error?.message||error).slice(0,400)};
  }
});

ipcMain.handle('ramo:models:installed', async (event,port)=>{

  if(!isProjectSender(event))throw Error('Not authorized');

  return manager.listOllamaModels(port);

});

ipcMain.handle('ramo:models:profiles', event=>{

  if(!isProjectSender(event))throw Error('Not authorized');

  return manager.profileSummary();

});

ipcMain.handle('ramo:models:start-selected', (event,id)=>{

  if(!isProjectSender(event))throw Error('Not authorized');

  return manager.startSelected(id);

});

ipcMain.handle('ramo:models:cancel-start', (event,id)=>{

  if(!isProjectSender(event))throw Error('Not authorized');

  return manager.cancelSelectedStart(id);

});

ipcMain.handle('ramo:models:summary', async event=>{

  if(!isProjectSender(event)) throw Error('Not authorized');

  const profiles=await manager.status();

  return profiles.map(({id,title,model,kind,port,online,ownership,canStop,endpoint,ready,state,modelState,context,startup,detail})=>({id,title,model,kind,port,online,ownership,canStop,endpoint,ready,state,modelState,context,startup,detail}));

});

ipcMain.handle('ramo:api-providers:list',event=>{
  if(!isProjectSender(event))throw Error('Not authorized');
  return apiProviders?.list()||[];
});

ipcMain.handle('ramo:setup:get',event=>{
  if(!isProjectSender(event))throw Error('Not authorized');
  return apiProviders?.setup?.()||{tiers:{},complete:false};
});

ipcMain.handle('ramo:setup:save',async(event,input)=>{
  if(!isProjectSender(event))throw Error('Not authorized');
  if(!apiProviders)throw Error('Setup storage is not ready.');
  return apiProviders.saveSetup(input||{});
});

ipcMain.handle('ramo:setup:ollama-download',event=>{
  if(!isProjectSender(event))throw Error('Not authorized');
  return shell.openExternal('https://ollama.com/download/windows');
});

ipcMain.handle('ramo:setup:ollama-library',event=>{
  if(!isProjectSender(event))throw Error('Not authorized');
  return shell.openExternal('https://ollama.com/library');
});

ipcMain.handle('ramo:setup:ollama-start',async event=>{
  if(!isProjectSender(event))throw Error('Not authorized');
  await manager.start('ollama');
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){const status=await manager.listOllamaModels();if(status.online)return status;await new Promise(resolve=>setTimeout(resolve,400));}
  throw Error('Ollama was launched but its API did not answer on 127.0.0.1:11434. Check its host/port settings.');
});

ipcMain.handle('ramo:api-providers:save',async(event,profile)=>{
  if(!isProjectSender(event))throw Error('Not authorized');
  await apiProviders.save(profile||{});
  return apiProviders.list();
});

ipcMain.handle('ramo:api-providers:remove',async(event,id)=>{
  if(!isProjectSender(event))throw Error('Not authorized');
  await apiProviders.remove(id);
  return apiProviders.list();
});

ipcMain.handle('ramo:api-providers:chat',async(event,id,requestId,payload)=>{
  if(!isProjectSender(event))throw Error('Not authorized');
  if(!apiProviders)throw Error('API provider storage is not ready.');
  const key=event.sender.id+':'+String(requestId||'');
  if(!String(requestId||'').match(/^[A-Za-z0-9_-]{1,120}$/)||apiProviderRequests.has(key))throw Error('Invalid or duplicate API request ID.');
  const controller=new AbortController();apiProviderRequests.set(key,controller);
  try{
    return await apiProviders.chat(id,payload||{},{signal:controller.signal,onChunk:chunk=>{
      if(!event.sender.isDestroyed())event.sender.send('ramo:api-providers:chunk',{requestId,event:chunk});
    }});
  }finally{apiProviderRequests.delete(key);}
});

ipcMain.handle('ramo:api-providers:known-status',event=>{
  if(!isProjectSender(event))throw Error('Not authorized');
  if(!apiProviders)return [];
  return apiProviders.knownStatus();
});

ipcMain.handle('ramo:api-providers:known-save',async(event,input)=>{
  if(!isProjectSender(event))throw Error('Not authorized');
  if(!apiProviders)throw Error('API provider storage is not ready.');
  const provider=String(input?.provider||'');
  await apiProviders.setKnown(provider,String(input?.apiKey||''));
  return apiProviders.knownStatus();
});

ipcMain.handle('ramo:api-providers:known-clear',async(event,provider)=>{
  if(!isProjectSender(event))throw Error('Not authorized');
  if(!apiProviders)throw Error('API provider storage is not ready.');
  await apiProviders.clearKnown(String(provider||''));
  return apiProviders.knownStatus();
});

ipcMain.handle('ramo:api-providers:known-chat',async(event,provider,requestId,payload)=>{
  if(!isProjectSender(event))throw Error('Not authorized');
  if(!apiProviders)throw Error('API provider storage is not ready.');
  const key=event.sender.id+':'+String(requestId||'');
  if(!String(requestId||'').match(/^[A-Za-z0-9_-]{1,120}$/)||apiProviderRequests.has(key))throw Error('Invalid or duplicate API request ID.');
  const controller=new AbortController();apiProviderRequests.set(key,controller);
  try{
    return await apiProviders.knownChat(String(provider||''),payload||{},{signal:controller.signal,onChunk:chunk=>{
      if(!event.sender.isDestroyed())event.sender.send('ramo:api-providers:chunk',{requestId,event:chunk});
    }});
  }finally{apiProviderRequests.delete(key);}
});

ipcMain.handle('ramo:api-providers:models',async(event,spec)=>{
  if(!isProjectSender(event))throw Error('Not authorized');
  if(!apiProviders)throw Error('API provider storage is not ready.');
  return apiProviders.fetchModels(spec||{});
});

ipcMain.on('ramo:api-providers:abort',(event,requestId)=>{
  if(!isProjectSender(event))return;
  const request=apiProviderRequests.get(event.sender.id+':'+String(requestId||''));request?.abort();
});

ipcMain.handle('ramo:open-manager', event=>{

  if (!isProjectSender(event)) throw Error('Not authorized');

  openModelManager();return true;

});

const actions={

  status:()=>manager.status(),

  start:id=>manager.start(id),

  startServerOnly:id=>manager.startServerOnly(id),

  startWithOverride:id=>manager.startWithOverride(id),

  stop:id=>manager.stop(id),

  wake:id=>manager.wake(id),

  choose:(id,type)=>manager.choose(id,type,modelWindow),

  update:(id,options)=>manager.update(id,options),

  add:(name,port,kind)=>manager.addCustom(name,port,kind),

  remove:id=>manager.removeCustom(id)

};

for(const [name,fn] of Object.entries(actions)){

  ipcMain.handle('ramo:models:'+name, (event,...args)=>{

    if(!isManagerSender(event)) throw Error('Not authorized');

    return fn(...args);

  });

}

for(const [name,fn] of Object.entries({

  status:()=>pocketVoice.status(),

  configure:()=>pocketVoice.configure(),

  settings:(settings)=>pocketVoice.settings(settings||{}),

  speak:(text)=>pocketVoice.speak(text),

  'speak-once':(text)=>pocketVoice.speakOnce(text)

}))ipcMain.handle('ramo:voice:'+name,(event,...args)=>{

  if(!isProjectSender(event))throw Error('Not authorized');return fn(...args);

});

ipcMain.handle('ramo:stt:recognize',async (event,settings)=>{

  if(!isProjectSender(event))throw Error('Not authorized');

  return localSpeech.recognize();

});

ipcMain.handle('ramo:stt:stop',event=>{

  if(!isProjectSender(event))throw Error('Not authorized');

  return localSpeech.stop();

});

ipcMain.handle('ramo:stt:status',event=>{

  if(!isProjectSender(event))throw Error('Not authorized');

  return localSpeech.status();

});

app.on('before-quit',()=>{ try { petStopTrigger(); } catch (_) {} try { destroyPetWindow(); } catch (_) {} if(sttWarmTimer){clearInterval(sttWarmTimer);sttWarmTimer=null;}if(manager)manager.terminateAll();pocketVoice?.stop();localSpeech?.shutdown(); });



app.on('window-all-closed', () => {
  try { petStopTrigger(); } catch (_) {}
  try { destroyPetWindow(); } catch (_) {}
  app.quit();
});



  let petWindow = null;
  let petActive = false;
  let petWorkApi = null;

  // ---- Pet mode configuration ------------------------------------------------
  // The talk trigger is configured in Pet settings: a mouse button (side
  // button or wheel click) and/or a keyboard chord, both held to talk. It is
  // read from the physical state of those inputs by a small helper process
  // (src/native/pet-input.cjs), because Windows has no global hotkey for a
  // mouse button and Electron never reports the release of a key.
  //
  // The pet's brain is the 4B pack of Bonsai 2 on the PrismML fork router
  // ([bonsai2-4b] preset in Bonsai-demo's bonsai-models.ini, Q2_0 pack,
  // load-on-startup true, sleep-idle-seconds -1, reasoning off at preset
  // level). Every pet call goes there; the 27B preset is untouched. The fork
  // serves one model per router slot (--models-max 1), so an eviction (e.g.
  // the 27B being woken) costs one reload; that reload is small and quick.
  // Pet settings preferModel is kept in the file for compatibility but no
  // longer decides anything about transport.
  // Defaults to the production Bonsai-demo router on 8080. The disposable
  // verification harness sets RAMO_PET_FORK_BASE so a test instance can
  // point at an ephemeral router instead; production never sees it.
  const PET_FORK = { base: process.env.RAMO_PET_FORK_BASE || 'http://127.0.0.1:8080', model: 'bonsai2-4b' };
  // Visible while a turn runs, dimmer while the pet waits, unseen when the pet
  // was only summoned for one turn.
  const PET_ACTIVE_OPACITY = 0.55;
  // When the pet is on but nothing is happening, it stays invisible and only
  // flashes very briefly every ~30 seconds so it is not distracting.
  const PET_FLASH_OPACITY = 0.12;
  const PET_REST_OPACITY = 0;
  const PET_IDLE_OPACITY = 0;
  // ----------------------------------------------------------------------------

  let petTurnActive = false;
  let petCapturing = false;
  let petReleaseRequested = false;
  let petWindowReady = false;
  let petPendingCaption = null;
  // Resolved when pet.js reports all queued audio has actually played.
  let petAudioDoneResolver = null;  let petCursorTimer = null;
  let petFadeTimer = null;
  let petIdleFallbackTimer = null;
  const petHistory = [];
  const petReminders = new Map();
  // Pet window box (Ringo-style art 190px + caption strip below).
  const PET_WINDOW_WIDTH = 320;
  const PET_WINDOW_HEIGHT = 292;

  function petPush(phase) { if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:state', { phase }); }

  // Tell the main UI which pet state to reflect on its sidebar item.
  function petNotify() {
    try { if (projectWindow && !projectWindow.isDestroyed()) projectWindow.webContents.send('ramo:pet:changed', { active: petActive }); } catch (_) {}
  }

  // Captions are queued until the pet window has loaded, so a caption sent
  // while the window is being created is not lost.
  function petCaption(payload) {
    if (!petWindow || petWindow.isDestroyed()) return;
    if (!petWindowReady) { petPendingCaption = payload; return; }
    petPendingCaption = null;
    try { petWindow.webContents.send('pet:caption', payload); } catch (_) {}
  }

  // One-time discoverability hint when pet mode is turned on.
  function petHint() {
    const trigger = petSettings.trigger || {};
    const how = trigger.mouse && trigger.mouse !== 'none'
      ? 'Hold the ' + (trigger.mouse === 'back' ? 'mouse back button' : trigger.mouse === 'forward' ? 'mouse forward button' : 'middle mouse button') + ' to talk'
      : trigger.key ? 'Hold ' + trigger.key + ' to talk' : 'No talk trigger is set';
    petCaption({ status: how + ' · right-click the Pet button for settings' });
  }

  // Turn-latency trace (userData/pet-timings.log) for diagnosing perceived delay:
  // stt finalization → router → first streamed token → full text → TTS synthesis.
  function petTiming(line) {
    try { fs.appendFileSync(path.join(app.getPath('userData'), 'pet-timings.log'), new Date().toISOString().slice(11, 23) + ' ' + line + '\n'); } catch (_) {}
  }

  // Step the window opacity toward a target; idleness also stops cursor polling.
  function petSetOpacity(target) {
    if (!petWindow || petWindow.isDestroyed()) return;
    if (petFadeTimer) { clearInterval(petFadeTimer); petFadeTimer = null; }
    const win = petWindow;
    let current = 0;
    try { const o = win.getOpacity(); if (Number.isFinite(o)) current = o; } catch (_) {}
    if (Math.abs(target - current) < 0.02) {
      try { win.setOpacity(target); } catch (_) {}
      if (target === PET_IDLE_OPACITY) stopPetCursorLoop();
      return;
    }
    const step = (target - current) / 6;
    petFadeTimer = setInterval(() => {
      if (!win || win.isDestroyed()) { clearInterval(petFadeTimer); petFadeTimer = null; return; }
      current += step;
      if ((step > 0 && current >= target) || (step < 0 && current <= target)) {
        try { win.setOpacity(target); } catch (_) {}
        clearInterval(petFadeTimer); petFadeTimer = null;
        if (target === PET_IDLE_OPACITY) stopPetCursorLoop();
        return;
      }
      try { win.setOpacity(current); } catch (_) {}
    }, 30);
  }

  function createPetWindow() {
    if (petWindow && !petWindow.isDestroyed()) { petWindow.show(); return petWindow; }
    const window = createWindow({
      title: "Ramo - Pet",
      show: false,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      width: PET_WINDOW_WIDTH,
      height: PET_WINDOW_HEIGHT,
      backgroundColor: "#00000000",
      webPreferences: {
        sandbox: true,
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.resolve(__dirname, "preload-pet.js"),
        autoplayPolicy: 'no-user-gesture-required'
      }
    });
    petWindow = window;
    petWindowReady = false;
    try {
      // Park in the bottom-right corner of the work area.
      const area = screen.getPrimaryDisplay().workArea;
      window.setPosition(area.x + area.width - PET_WINDOW_WIDTH - 14, area.y + area.height - PET_WINDOW_HEIGHT - 14);
    } catch (_) {}
    // Voice-only companion: never intercept clicks or steal focus (safe to click through during games).
    try { window.setIgnoreMouseEvents(true, { forward: true }); } catch (_) {}
    try { window.setOpacity(0); } catch (_) {}
    window.loadFile(path.resolve(__dirname, "pet", "pet.html"));
    window.webContents.on('did-finish-load', () => {
      petWindowReady = true;
      try { window.webContents.send('pet:settings', { ...petSettings }); } catch (_) {}
      // Captions sent before the window finished loading are delivered now.
      if (petPendingCaption) {
        const pending = petPendingCaption;
        petPendingCaption = null;
        try { window.webContents.send('pet:caption', pending); } catch (_) {}
      }
    });
    window.once('ready-to-show', () => { if (!window.isDestroyed()) { window.showInactive(); try { window.setOpacity(petActive ? PET_REST_OPACITY : PET_IDLE_OPACITY); } catch (_) {} if (petActive) { ensurePetCursorLoop(); startPetIdleFlash(); } } petNotify(); });
    window.on('closed', () => { petWindow = null; petWindowReady = false; stopPetCursorLoop(); petNotify(); });
    return window;
  }

  // Turning the pet off must not throw away what the user asked it to
  // remember: a reminder stays scheduled and still fires (the pet comes back
  // for it). Reminders only die with the application.
  function destroyPetWindow() {
    petHideSketch(true);
    if (petWindow && !petWindow.isDestroyed()) petWindow.destroy();
    petWindow = null;
    petWindowReady = false;
    stopPetCursorLoop();
  }

  // ---- Sketch overlay -------------------------------------------------------
  // A SketchVLM-style answer is only useful if it lands on the screen. The
  // overlay is a transparent, click-through, non-focusable window on the
  // display the pointer is on. It is display-only: the main process validates
  // and projects each stroke, and the renderer builds SVG elements from those
  // bounded numbers. It stays for the configured few seconds and then goes.
  let petSketchWindow = null;
  let petSketchReady = false;
  let petSketchPending = null;
  let petSketchHideTimer = null;
  let petSketchState = { visible: false, strokes: 0, startedAt: 0, durationMs: 0, bounds: null };

  function petSketchDisplayBounds() {
    try {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      return { ...display.bounds };
    } catch (_) {
      try { return { ...screen.getPrimaryDisplay().bounds }; } catch (_) { return { x: 0, y: 0, width: 1280, height: 720 }; }
    }
  }

  function createPetSketchWindow() {
    if (petSketchWindow && !petSketchWindow.isDestroyed()) return petSketchWindow;
    const bounds = petSketchDisplayBounds();
    const win = createWindow({
      title: 'Ramo sketch',
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      show: false,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      fullscreenable: false,
      backgroundColor: '#00000000',
      webPreferences: {
        sandbox: true,
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.resolve(__dirname, 'preload-sketch.js')
      }
    });
    petSketchWindow = win;
    petSketchReady = false;
    petSketchPending = null;
    try { win.setIgnoreMouseEvents(true, { forward: true }); } catch (_) {}
    try { win.setAlwaysOnTop(true, 'screen-saver'); } catch (_) {}
    win.loadFile(path.resolve(__dirname, 'pet', 'sketch.html'));
    win.webContents.on('did-finish-load', () => {
      petSketchReady = true;
      if (petSketchPending) {
        const pending = petSketchPending;
        petSketchPending = null;
        try { win.webContents.send('pet:sketch', pending); } catch (_) {}
      }
    });
    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return;
      try {
        win.setAlwaysOnTop(true, 'screen-saver');
        win.setIgnoreMouseEvents(true, { forward: true });
        win.showInactive();
      } catch (_) {}
    });
    win.on('closed', () => {
      petSketchWindow = null;
      petSketchReady = false;
      petSketchPending = null;
      petSketchState = { visible: false, strokes: 0, startedAt: 0, durationMs: 0, bounds: null };
    });
    return win;
  }

  function petSketchInfo() {
    return { ...petSketchState, bounds: petSketchState.bounds ? { ...petSketchState.bounds } : null };
  }

  function petShowSketch(sketch) {
    if (!sketch || !sketch.ok || !Array.isArray(sketch.strokes) || !sketch.strokes.length) return false;
    const bounds = petSketchDisplayBounds();
    const win = createPetSketchWindow();
    if (!win || win.isDestroyed()) return false;
    const projected = projectSketch(sketch, bounds.width, bounds.height);
    const holdMs = Math.max(2000, Math.min(20000, Number(sketch.durationMs) || 8000));
    const payload = {
      strokes: projected.strokes,
      color: sketch.color,
      widthPx: projected.widthPx,
      width: bounds.width,
      height: bounds.height,
      holdMs
    };
    try { win.setBounds(bounds); } catch (_) {}
    if (petSketchReady) {
      try { win.webContents.send('pet:sketch', payload); } catch (_) { petSketchPending = payload; }
    } else {
      petSketchPending = payload;
    }
    try {
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setIgnoreMouseEvents(true, { forward: true });
      win.showInactive();
    } catch (_) {}
    if (petSketchHideTimer) { clearTimeout(petSketchHideTimer); petSketchHideTimer = null; }
    petSketchHideTimer = setTimeout(() => { petSketchHideTimer = null; petHideSketch(false); }, holdMs + 250);
    petSketchState = {
      visible: true,
      strokes: projected.strokes.length,
      startedAt: Date.now(),
      durationMs: holdMs,
      bounds: { ...bounds }
    };
    petTiming('sketch-shown strokes=' + projected.strokes.length + ' hold=' + holdMs + 'ms');
    return true;
  }

  // ---- Phase 4: the tracking loop -----------------------------------------
  //
  // After the detector found the target and the model picked it, the mark has
  // to follow the thing without a model call. The screen is captured small
  // (the letterbox size the detector wants anyway), the detector runs over
  // it, ByteTrack-lite matches the detection back to the picked target, and
  // the overlay frame is redrawn instantly around the tracked box.
  //
  // The VLM wakes only on a lost or changed target:
  //   track loss > 1 s, IoU < 0.3 against the prediction, the class changing
  //   for three frames, or three frames below 0.3 confidence.
  // A woken target re-runs the grounded draw once for the same request; no
  // other VLM call happens while a track is held.
  const PET_TRACK_INTERVAL_MS = 200;
  const PET_TRACK_GRACE_MS = 500;      // on-motion prediction alone, before hiding
  const PET_TRACK_WAKE_MS = 1000;      // track loss that wakes the model
  const PET_TRACK_CONF = 0.05;         // the detector's shortlist threshold
  const PET_TRACK_WAKE_COOLDOWN_MS = 5000;
  const PET_TRACK_WAKE_LIMIT = 3;

  let petTrackActive = null;   // {tracker, request, model, smallW, smallH}
  let petTrackTimer = null;
  let petTrackBusy = false;
  let petTrackWakeCount = 0;
  let petTrackWakeAt = 0;
  let petTrackFrameShown = false;
  let petTrackLastBox = null;  // the box the overlay is showing, to skip no-op redraws

  function petStopTracking() {
    if (petTrackTimer) { clearTimeout(petTrackTimer); petTrackTimer = null; }
    petTrackActive = null;
    petTrackBusy = false;
    petTrackWakeCount = 0;
    petTrackWakeAt = 0;
    petTrackFrameShown = false;
    petTrackLastBox = null;
  }

  // The overlay, on a tracker frame. Numbers ride the same canvas page as the
  // sketch itself, but the frame is sent with instant:true: no entrance
  // animation and no auto-hide, because the tracker owns its lifetime.
  //
  // The window affordances (bounds, always-on-top, click-through, show) are
  // done once when the overlay is created, not once per frame — calling them
  // every 150 ms stalls the game's frame pacing, which is what stuttered.

  function petTrackShowFrame(strokes) {
    const bounds = petSketchDisplayBounds();
    const win = createPetSketchWindow();
    if (!win || win.isDestroyed()) return false;
    const width = Math.max(1, Number(bounds.width) || 1);
    const height = Math.max(1, Number(bounds.height) || 1);
    const projected = projectSketch({ok: true, strokes, color: '#ff4d4d', width: 5, durationMs: 2000}, width, height);
    const payload = {
      strokes: projected.strokes,
      color: '#ff4d4d',
      widthPx: Math.max(2, projected.widthPx || 4),
      width,
      height,
      instant: true
    };
    try { win.webContents.send('pet:sketch', payload); } catch (_) { return false; }
    if (!petTrackFrameShown) {
      petTrackFrameShown = true;
      try { win.setBounds(bounds); } catch (_) {}
      try { win.setAlwaysOnTop(true, 'screen-saver'); win.setIgnoreMouseEvents(true, {forward: true}); win.showInactive(); } catch (_) {}
    }
    petSketchState = {visible: true, strokes: projected.strokes.length, startedAt: Date.now(), durationMs: 1000000, bounds: {...bounds}};
    return true;
  }

  async function petWakeTracking(reason) {
    const active = petTrackActive;
    if (!active) return;
    if (Date.now() - petTrackWakeAt < PET_TRACK_WAKE_COOLDOWN_MS) return; // a wake is already in flight
    if (petTrackWakeCount >= PET_TRACK_WAKE_LIMIT) {
      petTiming('track wake limit reached (' + reason + '), letting the mark sit');
      petStopTracking();
      petHideSketch(false);
      return;
    }
    petTrackWakeCount += 1;
    petTrackWakeAt = Date.now();
    petTiming('track wake: ' + reason);
    petStopTracking();
    petHideSketch(true);
    try {
      // The VLM gets the same request again and the pet re-grounds: that is
      // what a wake is for. No wake, no model call.
      const plan = await petDrawPlan(active.request);
      if (!plan.imageBase64) return;
      const result = await petRunGrounding(plan, active.model);
      if (result.ok && result.sketch) {
        petShowSketch(result.sketch);
        if (result.stage === 'detect' && result.box) petStartTracking(result, active.request, active.model);
      }
    } catch (error) {
      petTiming('track wake failed: ' + (error && error.message ? error.message : String(error)));
    }
  }

  async function petTrackTick() {
    if (!petTrackActive || petTrackBusy) return;
    petTrackBusy = true;
    try {
      const active = petTrackActive;
      const capture = await petScreen.captureSmall(640);
      if (!capture.ok) { petTrackTimer = setTimeout(petTrackTick, PET_TRACK_INTERVAL_MS); return; }
      const size = capture.image.getSize();
      const bitmap = capture.image.toBitmap();
      const found = await petDetect.detectForDraw(bitmap, [active.request], {
        width: size.width,
        height: size.height,
        captureWidth: size.width,
        captureHeight: size.height,
        conf: PET_TRACK_CONF,
        limit: 16
      });
      const now = Date.now();
      const detections = found && found.ok && Array.isArray(found.boxes) ? found.boxes : [];
      const state = active.tracker.update(detections, now);
      if (!state.visible) {
        petTiming('track lost for ' + state.lostMs + 'ms; waking the model' + (state.wake ? ' (' + state.wake + ')' : ''));
        await petWakeTracking(state.wake || 'lost');
        return;
      }
      // Redraw the mark around wherever the target is now — but only when
      // the box actually moved. A no-op redraw still invalidates the overlay
      // and still costs the GPU, for nothing.
      const box = state.box;
      const moved = !petTrackLastBox
        || Math.abs(box.x - petTrackLastBox.x) > 2
        || Math.abs(box.y - petTrackLastBox.y) > 2
        || Math.abs(box.w - petTrackLastBox.w) > 2
        || Math.abs(box.h - petTrackLastBox.h) > 2;
      if (moved) {
        const { boxToSketchCommands } = require('./pet-sketch.cjs');
        const commands = boxToSketchCommands(box, { width: size.width, height: size.height, polygon: state.polygon, color: 'red', strokeWidth: 5 });
        if (commands) {
          const sketch = parseSketch(commands, { durationMs: 1000000, allowDuration: true });
          if (sketch.ok && petTrackShowFrame(sketch.strokes)) petTrackLastBox = { x: box.x, y: box.y, w: box.w, h: box.h };
        }
      }
      if (state.wake) await petWakeTracking(state.wake);
    } catch (error) {
      petTiming('track tick failed: ' + (error && error.message ? error.message : String(error)));
    } finally {
      petTrackBusy = false;
      if (petTrackActive) petTrackTimer = setTimeout(petTrackTick, PET_TRACK_INTERVAL_MS);
    }
  }

  // `result` is the grounded draw that just landed on the screen; `request`
  // is what the user asked for. Only a detector-picked drawing is tracked: a
  // drawing with no target cannot be followed.
  function petStartTracking(result, request, model) {
    try {
      if (!result || !result.box || result.stage !== 'detect') return false;
      const bounds = petSketchDisplayBounds();
      const smallW = 640;
      const smallH = Math.max(1, Math.round((bounds.height / Math.max(1, bounds.width)) * smallW));
      const scaleX = smallW / Math.max(1, bounds.width);
      const scaleY = smallH / Math.max(1, bounds.height);
      const box = {
        x: (result.box.x / 1000) * smallW,
        y: (result.box.y / 1000) * smallH,
        w: (result.box.w / 1000) * smallW,
        h: (result.box.h / 1000) * smallH
      };
      petStopTracking();
      petTrackActive = {
        tracker: new PetTracker({
          x: box.x, y: box.y, w: box.w, h: box.h,
          conf: result.conf || 1, cls: result.cls, polygon: result.polygon, now: Date.now()
        }, 1, {graceMs: PET_TRACK_GRACE_MS, wakeLossMs: PET_TRACK_WAKE_MS}),
        request: String(request || ''),
        model: model
      };
      petTiming('track start box=' + JSON.stringify({x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h)}));
      petTrackTimer = setTimeout(petTrackTick, PET_TRACK_INTERVAL_MS);
      return true;
    } catch (error) {
      petTiming('track start failed: ' + (error && error.message ? error.message : String(error)));
      return false;
    }
  }

  function petHideSketch(immediate = false) {
    if (petSketchHideTimer) { clearTimeout(petSketchHideTimer); petSketchHideTimer = null; }
    petSketchState = { ...petSketchState, visible: false };
    const win = petSketchWindow;
    if (!win || win.isDestroyed()) return;
    try { win.webContents.send('pet:sketch-clear'); } catch (_) {}
    if (immediate) {
      try { win.destroy(); } catch (_) {}
      return;
    }
    setTimeout(() => {
      try { if (win && !win.isDestroyed()) win.hide(); } catch (_) {}
    }, 80);
  }

  // Show the pet. 'rest' is the dimmed state the pet waits in when the user
  // has turned it on; a turn raises it to the active opacity.
  function petActivate(visible, rest = false) {
    if (!petWindow || petWindow.isDestroyed()) createPetWindow();
    if (!petWindow || petWindow.isDestroyed()) return false;
    try { petWindow.showInactive(); } catch (_) {}
    ensurePetCursorLoop();
    petSetOpacity(visible ? (rest ? PET_REST_OPACITY : PET_ACTIVE_OPACITY) : PET_IDLE_OPACITY);
    return true;
  }

  let petFlashTimer = null;
  let petFlashHoldTimer = null;
  function stopPetIdleFlash() {
    if (petFlashTimer) { clearTimeout(petFlashTimer); petFlashTimer = null; }
    if (petFlashHoldTimer) { clearTimeout(petFlashHoldTimer); petFlashHoldTimer = null; }
  }
  function startPetIdleFlash() {
    if (!petActive) return;
    stopPetIdleFlash();
    // Roughly every 30 seconds (with jitter), briefly brighten to a very low
    // opacity, then fade back to invisible.
    const schedule = () => {
      if (!petActive || petTurnActive) { petFlashTimer = setTimeout(schedule, 3000); return; }
      if (!petWindow || petWindow.isDestroyed()) { petFlashTimer = setTimeout(schedule, 3000); return; }
      // Wait a random ~25-35 seconds, then flash.
      const delay = 25000 + Math.floor(Math.random() * 10000);
      petFlashTimer = setTimeout(() => {
        if (!petActive || petTurnActive) { schedule(); return; }
        if (!petWindow || petWindow.isDestroyed()) { schedule(); return; }
        ensurePetCursorLoop();
        petSetOpacity(PET_FLASH_OPACITY);
        petFlashHoldTimer = setTimeout(() => {
          petFlashHoldTimer = null;
          if (petActive && !petTurnActive) petSetOpacity(PET_IDLE_OPACITY);
          schedule();
        }, 2200);
      }, delay);
    };
    schedule();
  }
  function petWaitForAudioDone(timeoutMs = 4000) {
    if (!petWindow || petWindow.isDestroyed()) return Promise.resolve(false);
    const cap = Math.max(800, Math.min(60000, Number(timeoutMs) || 4000));
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        petAudioDoneResolver = null;
        resolve(value);
      };
      const timer = setTimeout(() => finish(false), cap);
      petAudioDoneResolver = finish;
    });
  }
  function petRest() {
    petSetOpacity(petActive ? PET_REST_OPACITY : PET_IDLE_OPACITY);
    if (petActive && !petTurnActive) startPetIdleFlash();
  }

  function ensurePetCursorLoop() {
    if (petCursorTimer) return;
    petCursorTimer = setInterval(() => {
      if (!petWindow || petWindow.isDestroyed()) return;
      try {
        const pt = screen.getCursorScreenPoint();
        const b = petWindow.getBounds();
        petWindow.webContents.send('pet:cursor', { x: pt.x - b.x, y: pt.y - b.y });
      } catch (_) {}
    }, 33);
  }
  function stopPetCursorLoop() {
    if (petCursorTimer) { clearInterval(petCursorTimer); petCursorTimer = null; }
  }

  // Ensure the Bonsai-demo fork router is up and the 4B is resident.
  // Mirrors petEnsureOllama: probe, start via the Ramo Bonsai2 profile if
  // offline, wait, then - only if the slot is busy with something else (the
  // 27B) - ask for the 4B with one READY line so it autoloads back in.
  async function petForkEnsure() {
    const p = manager.get('bonsai2');
    let status = await manager.probe(p).catch(() => ({ online: false }));
    if (!status.online) {
      try { await manager.start('bonsai2', {}); } catch (_) {}
      for (let i = 0; i < 20 && !status.online; i++) {
        await new Promise((r) => setTimeout(r, 300));
        status = await manager.probe(p).catch(() => ({ online: false }));
      }
    }
    if (status.online) {
      try {
        const models = await petFetch(PET_FORK.base + '/v1/models').then((r) => r.json()).catch(() => null);
        const row = models && Array.isArray(models.data)
          ? models.data.find((m) => m.id === PET_FORK.model || (Array.isArray(m.aliases) && m.aliases.includes(PET_FORK.model)))
          : null;
        const rawState = row && row.status && (typeof row.status === 'string' ? row.status : (row.status.value || ''));
        const state = String(rawState || '').toLowerCase();
        const resident = state === 'loaded' || state === 'ready' || state === 'running';
        if (state && !resident) {
          await petFetch(PET_FORK.base + '/v1/chat/completions', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: PET_FORK.model, messages: [{ role: 'user', content: 'Reply READY.' }], stream: false, temperature: 0, max_tokens: 1, reasoning_effort: 'none' })
          }).catch(() => {});
        }
      } catch (_) { /* the chat call reports the real failure */ }
    }
    return { profile: { ...p, port: 8080 }, status };
  }

  // ---- Keep-hot residency (pet mode on → TTS/STT/bonsai stay loaded) ---------
  // While pet mode is active the fork router keeps the pet's 4B resident
  // (sleep-idle -1: it never idles out), the Nemotron STT worker stays
  // alive with its model hot, and the Pocket TTS server is kept up. The old
  // Ollama bonsai-2:4b pin is gone; nothing here loads an Ollama model any
  // more. STT stays warm for ordinary dictation too when pet mode is off.
  let petHotModel = null;
  let petWarmTimer = null;

  async function petWarmModel() {
    const { status } = await petForkEnsure();
    if (!status.online) throw Error('The Bonsai router is not running. Start Bonsai2 from the Ramo Models menu, then retry.');
    petHotModel = PET_FORK.model;
    return PET_FORK.model;
  }

  function petStartKeepHot() {
    if (petWarmTimer) return;
    const warm = async () => {
      try { await petWarmModel(); } catch (e) { console.warn('[Pet] model warm:', e.message); }
      try { await localSpeech.hot(); } catch (e) { console.warn('[Pet] STT hot:', e.message); }
      try { if (pocketVoice.config.enabled) { await pocketVoice.ensure(); await pocketVoice.warm(); } } catch (e) { console.warn('[Pet] TTS hot:', e.message); }
    };
    warm();
    petWarmTimer = setInterval(warm, 60000);
  }

  function petStopKeepHot(unloadModel = true) {
    if (petWarmTimer) { clearInterval(petWarmTimer); petWarmTimer = null; }
    // STT deliberately stays loaded: the user asked for it to be warm from
    // startup, not only while the pet is on. It is stopped on app quit.
    if (unloadModel && petHotModel) {
      // Pet mode off. The fork preset never idles out (sleep-idle-seconds -1),
      // and the pet's model is deliberately not evicted here: keeping it
      // means a warm next pet-on costs no reload. The Ollama pin this used
      // to clear is gone; no Ollama model is loaded by this code.
      petHotModel = null;
    }
  }

  // ---- Talk trigger -----------------------------------------------------------
  // The trigger is a separate helper process: it reads the physical state of
  // the chosen mouse button and keyboard chord, so the game keeps the
  // keyboard and the mouse and Ramo never captures their input.
  const petInput = new PetInput({ scriptPath: path.join(app.getPath('userData'), 'pet-input.ps1') });
  let petFallbackShortcut = null;

  petInput.on('down', (source) => petTriggerDown(source));
  petInput.on('up', () => petTriggerUp());
  petInput.on('error', (message) => {
    console.warn('[Pet] trigger:', message);
    petCaption({ status: 'Talk trigger: ' + String(message).slice(0, 120) });
  });

  // If the helper cannot run at all, the chord still works as a press-to-toggle
  // shortcut so the pet is never left without a way to talk to it.
  function petArmFallbackShortcut() {
    try {
      const { globalShortcut } = require('electron');
      const key = petSettings.trigger && petSettings.trigger.key;
      if (!key) return false;
      petFallbackShortcut = globalShortcut.register(key, () => {
        if (petCapturing) { petTriggerUp(); return; }
        petTriggerDown('key');
      });
      return !!petFallbackShortcut;
    } catch (_) { return false; }
  }
  function petDisarmFallbackShortcut() {
    if (!petFallbackShortcut) return;
    try { require('electron').globalShortcut.unregister(petFallbackShortcut); } catch (_) {}
    petFallbackShortcut = null;
  }
  async function petStartTrigger() {
    petDisarmFallbackShortcut();
    const armed = await petInput.start(petSettings.trigger);
    // The pet may have been switched off while the helper was starting.
    if (!petActive) { petInput.stop(); return false; }
    const trigger = petSettings.trigger || {};
    if (armed) {
      console.log('[Pet] Talk trigger armed: mouse=' + (trigger.mouse || 'none') + ' key=' + (trigger.key || 'none') + ' (hold to talk)');
    } else {
      const fallback = petArmFallbackShortcut();
      console.warn('[Pet] Talk trigger unavailable: ' + (petInput.lastError || 'unknown'));
      petCaption({ status: fallback
        ? 'Hold-to-talk is unavailable — press ' + petSettings.trigger.key + ' to talk'
        : 'The talk trigger could not be started.' });
    }
    return armed;
  }
  function petStopTrigger() {
    stopPetIdleFlash();
    petInput.stop();
    petDisarmFallbackShortcut();
  }

  // The trigger is held to talk: the press opens the microphone, the release
  // ends the capture and the answer is composed from what was said.
  function petTriggerDown(source) {
    if (petTurnActive) return;
    stopPetIdleFlash();
    petReleaseRequested = false;
    petCapturing = true;
    petTiming('trigger-down ' + source);
    petRunTurn(source).catch(() => {});
  }
  function petTriggerUp() {
    if (!petCapturing) return;
    petReleaseRequested = true;
    petTiming('trigger-up');
    try { if (localSpeech) localSpeech.stop(); } catch (_) {}
  }

  // Pick the pet's model: always the fork's 4B alias. The Ollama size setting
  // is intentionally no longer consulted — the fork carries one 4B pack, and
  // approved moving the pet there. Ensuring the router + the model are
  // resident here means a pet turn never fails silently after an eviction.
  async function petPickModel() {
    const { status } = await petForkEnsure();
    if (!status.online) throw Error('The Bonsai router is not running. Start Bonsai2 from the Ramo Models menu, then retry.');
    return PET_FORK.model;
  }

  // Shared helper: drop any image parts Ollama would have accepted and
  // instead note the limitation inline. The fork 4B carries no projector
  // right now, so vision turns fail with a short apology instead of 400s or
  // a silent blind answer. No Ollama fallback: the approved fork and
  // the point of the switch is that no Ollama keeps this model alive.
  function petForkMessages(messages) {
    const out = messages.map((m) => ({ role: m.role, content: m.content }));
    return out.map((m) => {
      if (typeof m.content !== 'string' || !m.images) return m;
      return { ...m, content: m.content + '\n[A screen capture is attached but this model cannot view images. Say so briefly.]' };
    });
  }

  async function petOllamaChat(model, messages, imageBase64) {
    if (imageBase64 && messages.length && messages[messages.length - 1].role === 'user') messages[messages.length - 1].images = [imageBase64];
    const { status } = await petForkEnsure();
    if (!status.online) throw Error('The Bonsai router is not running. Start Bonsai2 from the Ramo Models menu, then retry.');
    const res = await petFetch(PET_FORK.base + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Temperature 0.5 as before; max_tokens 16 matches the old 16-token
      // router budget. reasoning_effort none repeats what the preset already
      // enforces, belt and braces at the request level too.
      body: JSON.stringify({ model, messages: petForkMessages(messages), stream: false, temperature: 0.5, max_tokens: 16, reasoning_effort: 'none' })
    });
    if (!res.ok) throw Error('Bonsai fork chat failed: ' + res.status);
    const data = await res.json().catch(() => null);
    const choice = data && data.choices && data.choices[0];
    return String(choice && choice.message && choice.message.content || '').trim();
  }

  // The drawing hand needs more room than the one-line router and no guessing:
  // it returns a compact command list, not conversation. Every grounding stage
  // runs at temperature 0 with thinking off, same as before. It now goes
  // through the fork 4B, which carries no projector; there is no Ollama
  // fallback. The injected note keeps image turns from failing silently.
  async function petOllamaSketch(model, messages, imageBase64, options = {}) {
    if (imageBase64 && messages.length && messages[messages.length - 1].role === 'user') messages[messages.length - 1].images = [imageBase64];
    const { status } = await petForkEnsure();
    if (!status.online) throw Error('The Bonsai router is not running. Start Bonsai2 from the Ramo Models menu, then retry.');
    const numPredict = Number(options.numPredict) || grounding.GROUNDING_STAGES.draw.numPredict;
    const temperature = Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0;
    const res = await petFetch(PET_FORK.base + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: petForkMessages(messages),
        stream: false,
        // The preset forces reasoning off; reasoning_effort repeats that for any
        // retry path or a stricter future build.
        reasoning_effort: 'none',
        max_tokens: numPredict,
        temperature
      })
    });
    if (!res.ok) throw Error('Bonsai fork sketch failed: ' + res.status);
    const data = await res.json().catch(() => null);
    const choice = data && data.choices && data.choices[0];
    return String(choice && choice.message && choice.message.content || '').trim();
  }

  // A grounding stage that has to answer with JSON. The fork answers JSON
  // when the prompt asks for it (response_format json_object), so the schema
  // is no longer sent structurally; parseJsonReply still reads prose-wrapped
  // answers, and the stages all tolerate a repaired answer. If this model
  // cannot produce it, the stage reports the parse error exactly as before.
  async function petGroundingCallJson({ model, messages, schema, image, numPredict, think }) {
    const { status } = await petForkEnsure();
    if (!status.online) throw Error('The Bonsai router is not running. Start Bonsai2 from the Ramo Models menu, then retry.');
    const payload = petForkMessages(messages.map((message) => ({ ...message })));
    if (image && payload.length && payload[payload.length - 1].role === 'user') {
      payload[payload.length - 1].content = String(payload[payload.length - 1].content || '') + '\n[A screen capture is attached but this model cannot view images. Say so briefly.]';
    }
    const res = await petFetch(PET_FORK.base + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: payload,
        stream: false,
        reasoning_effort: 'none',
        response_format: { type: 'json_object' },
        max_tokens: Number(numPredict) || 32,
        temperature: 0
      })
    });
    if (!res.ok) return { ok: false, error: 'the model call failed with status ' + res.status };
    const data = await res.json().catch(() => null);
    const choice = data && data.choices && data.choices[0];
    const raw = String(choice && choice.message && choice.message.content || '').trim();
    const parsed = grounding.parseJsonReply(raw);
    if (!parsed.ok) return { ok: false, error: parsed.error, raw };
    return { ok: true, value: parsed.value, raw };
  }

  async function petGroundingCallDraw({ model, messages, image, numPredict, think, temperature }) {
    const raw = await petOllamaSketch(model, messages, image, { numPredict, think, temperature });
    return { raw };
  }

  // Streaming variant: yields cumulative text on every token so the caption
  // strip shows the answer live while it is generated. The fork streams
  // OpenAI SSE ("data: {...}" per chunk, then "data: [DONE]"), not NDJSON.
  //
  // Reasoning is forced off at preset level, and reasoning_effort repeats it
  // per request; the reasoning text (if any) is never spoken or shown.
  function petOllamaChatStream(model, messages, onDelta, imageBase64, options = {}) {
    if (imageBase64 && messages.length && messages[messages.length - 1].role === 'user') messages[messages.length - 1].images = [imageBase64];
    const numPredict = Number(options.numPredict) || 60;
    return petForkEnsure().then(({ status }) => new Promise((resolve, reject) => {
      if (!status.online) { reject(Error('The Bonsai router is not running. Start Bonsai2 from the Ramo Models menu, then retry.')); return; }
      const payload = Buffer.from(JSON.stringify({ model, messages: petForkMessages(messages), stream: true, temperature: 0.5, max_tokens: numPredict, reasoning_effort: 'none' }));
      const req = http.request(PET_FORK.base + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length }
      }, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let errBody = '';
          res.setEncoding('utf8');
          res.on('data', (c) => { errBody = (errBody + c).slice(-300); });
          res.on('end', () => reject(Error('Bonsai fork chat failed: ' + res.statusCode + (errBody ? ' — ' + errBody.trim() : ''))));
          return;
        }
        let buffer = '', full = '', failure = null;
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer += chunk;
          let idx;
          // One event per line; chunks may split lines, so buffer until newline.
          while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;
            if (line === 'data: [DONE]') {
              buffer = '';
              continue;
            }
            if (!line.startsWith('data:')) continue;
            const body = line.slice(5).trim();
            if (!body) continue;
            let data;
            try { data = JSON.parse(body); } catch (_) { continue; }
            if (data && data.error) { failure = Error(String(data.error)); continue; }
            const choice = data && data.choices && data.choices[0];
            const delta = choice && choice.delta;
            const tok = String((delta && delta.content) || '');
            if (tok) {
              full += tok;
              try { if (onDelta) onDelta(full, tok); } catch (_) {}
            }
          }
        });
        res.on('error', (e) => reject(e));
        res.on('end', () => {
          if (failure && !full.trim()) reject(failure);
          else resolve(full.trim());
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    }));
  }

  // Push a rolling window of the streamed reply into the caption strip
  // (same styling as the STT captions, so the answer types itself out).
  function petStreamCaption(full) {
    if (!petWindow || petWindow.isDestroyed()) return;
    const text = String(full || '').trim();
    const tail = text.length > 240 ? '… ' + text.slice(-230) : text;
    petCaption({ text: tail });
  }

  // Router preprompt: bonsai itself decides whether a web search (or another
  // sense/tool) is needed before answering, and with what query.
  const PET_ROUTER_SYSTEM =
    'You are the intent router for Ramo Pet, a voice-and-drawing desktop companion. ' +
    'Reply with EXACTLY ONE line, starting with one keyword followed by a colon:\n' +
    'SEARCH: <web search query> — whenever the user asks about something current, a fact you may not know, or wants to understand a topic in depth.\n' +
    'SCREEN: — whenever the user asks about their screen, monitor, display, or what they are seeing or looking at right now: "what\'s on my screen", "look at my screen", "check my screen", "describe what I am seeing". Never for conversational phrases like "nice to see you".\n' +
    'DRAW: <what to draw or mark> — whenever the user asks to draw, sketch, doodle, circle, underline, highlight, point to, label, outline or annotate something on their screen. Keep it short and concrete.\n' +
    'WINDOW: — only when the user asks which app or window is open right now.\n' +
    'REMIND: <when> <what to remember> — whenever the user asks for a reminder or timer. <when> is either a delay ("in 30 minutes", "in 90 seconds", "in 2 hours") or a clock time ("at 10pm", "at 10", "at 10:30am", "at 22:00", "tomorrow at 9am"). Always keep the task text after the time.\n' +
    'REMIND_CANCEL: <which reminder> — whenever the user asks to cancel, stop or clear a reminder or timer. If they do not name a specific one, leave <which reminder> empty to cancel all.\n' +
    'REMIND_CHECK: — whenever the user asks what reminders or timers they have, whether anything is scheduled, or to list them.\n' +
    'ANSWER: <short spoken reply> — greetings, chat, math, opinions and everything else.\n' +
    'Rules: always begin with SEARCH:, SCREEN:, DRAW:, WINDOW:, REMIND:, REMIND_CANCEL:, REMIND_CHECK: or ANSWER: (with the colon). No markdown, no quotes, no extra lines, keep queries short.';

  async function petDecide(transcript) {
    let model = null;
    let raw = '';
    try { model = await petPickModel(); raw = await petOllamaChat(model, [{ role: 'system', content: PET_ROUTER_SYSTEM }, { role: 'user', content: transcript }]); } catch (_) {}
    // Router line may be "SCREEN:" — or (when the model skips the colon) bare
    // "SCREEN" — accept both; the keyword must still be the whole first word.
    // Longest keywords first so REMIND_CANCEL/REMIND_CHECK never parse as REMIND.
    const line = String(raw).split(/\r?\n/).map((l) => l.trim()).find((l) => /^(SEARCH|SCREEN|DRAW|WINDOW|REMIND_CANCEL|REMIND_CHECK|REMIND|ANSWER)(:|\s|$)/i.test(l)) || '';
    const m = line.match(/^(remind_cancel|remind_check|search|screen|draw|window|remind|answer)(?::|\s+(\S[^]*))?/i) || null;
    if (m) {
      const kind = m[1].toLowerCase();
      const rest = (m[2] || (line.slice(m[1].length).replace(/^:*/, '').trim())).trim();
      if (kind === 'search') return { tool: 'search', query: rest || transcript, model, via: 'router' };
      if (kind === 'screen') return { tool: 'screen', model, via: 'router' };
      if (kind === 'draw') return { tool: 'draw', request: rest || transcript, model, via: 'router' };
      if (kind === 'window') return { tool: 'window', model, via: 'router' };
      if (kind === 'remind') return { tool: 'remind', spec: rest || '', model, via: 'router' };
      if (kind === 'remind_cancel') return { tool: 'remind_cancel', spec: rest || '', model, via: 'router' };
      if (kind === 'remind_check') return { tool: 'remind_check', spec: rest || '', model, via: 'router' };
      if (kind === 'answer' && rest) return { tool: 'answer', answer: rest, model, via: 'router' };
    }
    // Fallback heuristics when the router line was empty or unusable.
    const low = transcript.toLowerCase();
    if (/cancel|stop|clear|forget/.test(low) && /reminder|timer|alarm/.test(low)) return { tool: 'remind_cancel', spec: '', model, via: 'fallback' };
    if (/(what|list|check|any|do i have).{0,24}(reminder|timer)s?|reminders?\?*$|timers?\?*$/.test(low)) return { tool: 'remind_check', spec: '', model, via: 'fallback' };
    const rm = low.match(/remind me (in|at) (.+)$/) || low.match(/remind me to (.+)$/);
    if (rm) return { tool: 'remind', spec: (rm[2] || rm[1]).trim(), model, via: 'fallback' };
    if (isDrawRequest(low)) return { tool: 'draw', request: transcript, model, via: 'fallback' };
    if (/screen|screenshot|capture|monitor|display|look at (my|the)|what (i am |am i )?(seeing|looking at)|on my screen/.test(low)) return { tool: 'screen', model, via: 'fallback' };
    if (/foreground|top (app|window)|what('s| is) open|current app/.test(low)) return { tool: 'window', model, via: 'fallback' };
    if (/search|look up|what (is|are|was|were)/.test(low)) return { tool: 'search', query: transcript.replace(/^(please\s+)?(search|look up|what is|what are)\s*/i, '').trim() || transcript, model, via: 'fallback' };
    return { tool: 'answer', answer: '', model, via: 'fallback' };
  }

  function petForegroundWindow() {
    return new Promise((resolve) => {
      const child = require('child_process').spawn('powershell', ['-NoProfile','-Command','try{(Get-Process | Where-Object {$_.MainWindowTitle} | Sort-Object -Property CPU -Descending | Select-Object -First 1).MainWindowTitle}catch{""}'], { windowsHide: true, stdio: ['ignore','pipe','pipe'] });
      let out = '';
      child.stdout.on('data', (b) => { out += String(b); });
      child.on('close', () => resolve(out.trim().slice(0,200) || 'unknown'));
      child.on('error', () => resolve('unknown'));
    });
  }

  function petSearch(q) {
    return new Promise((resolve) => {
      const tryWork = async () => {
        try {
          if (petWorkApi && petWorkApi.getService) {
            const service = petWorkApi.getService();
            const result = await service.search({ query: q });
            if (result) return JSON.stringify(result).slice(0, 700);
          }
        } catch (_) {}
        return null;
      };
      tryWork().then((r) => {
        if (r) { resolve(r); return; }
        const url = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(q) + '&format=json&no_html=1&skip_disambig=1';
        petFetch(url).then((resp) => resp.json()).then((d) => {
          const bits = [];
          if (d.AbstractText) bits.push(d.AbstractText);
          for (const t of (d.RelatedTopics || []).slice(0, 3)) { if (t.Text) bits.push(t.Text); }
          resolve((bits.join(' ') || 'No quick result found.').slice(0, 600));
        }).catch(() => resolve('Search unavailable.'));
      });
    });
  }

  // ---- Reminder subsystem -----------------------------------------------
  // petReminders: Map<id, {timer, when: Date, reason}> — one-shot in-RAM
  // timers owned by the main process (they fire even while the pet is
  // hidden/off, but die when Ramo closes). The reason is stored so the
  // reminder can be spoken back properly, cancelled by voice, and listed.

  // "at 10:05 pm today" / "at 9 am tomorrow" from the system clock.
  function petSpeakableWhen(d) {
    const now = new Date();
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const dayDiff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    const day = dayDiff === 0 ? 'today' : dayDiff === 1 ? 'tomorrow' : d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    return 'at ' + time + ' ' + day;
  }

  // Parse a reminder time + task out of spoken-style text. Understands
  // relative delays ("in 10 minutes", "10 m feed the cat") and absolute
  // clock times from the system clock ("at 10pm", "at 10:30am", "at 22:00",
  // "10pm feed the cat", "tomorrow at 9am"). Meridiem-less hours ("at 10")
  // resolve to whichever of am/pm is next. Returns { when, reason, whenText }.
  function petParseRemindSpec(specRaw) {
    const spec = String(specRaw || '').trim();
    const now = new Date();
    // Voice-friendly: convert spelled-out numbers ("in three minutes") to digits.
    const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fortyfive: 45, fifty: 50, sixty: 60 };
    const clean = spec
      .replace(/^remind (me|us)?\s*/i, '')
      .replace(/^please\s+/i, '')
      .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|forty five|fifty|sixty)\b/ig, (w) => WORDNUM[w.toLowerCase().replace(/ /g, '')] != null ? String(WORDNUM[w.toLowerCase().replace(/ /g, '')]) : w)
      .trim();
    const tidy = (s) => {
      let t = String(s || '').replace(/\s+/g, ' ').trim();
      t = t.replace(/^[:.,;-]\s*/, '');
      t = t.replace(/^(remind (me|us)?|reminder)\s*/i, '').trim();
      t = t.replace(/\bin\s+\d+\s*(second|sec|minute|min|hour|hr)s?\b\s*[:,]?\s*/i, '').trim();
      t = t.replace(/^(to|that|about|for)\s+/i, '').trim();
      t = t.replace(/^(remind (me|us)?|reminder)\s*/i, '').trim();
      return t;
    };
    const unitText = (n, c) => 'in about ' + n + (c === 'h' ? ' hour(s)' : c === 'm' ? ' minute(s)' : ' second(s)');
    // Relative: "in 10 minutes" / "in 90 seconds" / "in 2 hours" (plural-tolerant)
    let m = clean.match(/\bin\s+(\d+)\s*(second|sec|minute|min|hour|hr)s?\b/i) || clean.match(/\bin\s+(\d+)\s*([smh])\b/i);
    if (m) {
      const n = parseInt(m[1], 10) || 0;
      const c = m[2][0].toLowerCase();
      const when = new Date(now.getTime() + (c === 'h' ? n * 3600000 : c === 'm' ? n * 60000 : n * 1000));
      return { when, reason: tidy(clean.replace(m[0], ' ')) || 'your reminder', whenText: unitText(n, c) };
    }
    // Compact router form: "10 m feed the cat", "10 minutes stretch"
    m = clean.match(/^(\d+)\s*(second|sec|minute|min|hour|hr)s?\b\s*(.*)$/i) || clean.match(/^(\d+)\s*([smh])\b\s*(.*)$/i);
    if (m) {
      const n = parseInt(m[1], 10) || 0;
      const c = m[2][0].toLowerCase();
      const when = new Date(now.getTime() + (c === 'h' ? n * 3600000 : c === 'm' ? n * 60000 : n * 1000));
      return { when, reason: tidy(m[3]) || 'your reminder', whenText: unitText(n, c) };
    }
    // Absolute clock time. "tomorrow" shifts the target date a day ahead.
    const tomorrow = /\btomorrow\b/i.test(clean);
    const body = clean.replace(/\btomorrow\b|\btoday\b/gi, ' ');
    // One unified pattern: optional "at", hour, optional ":minutes", optional am/pm
    // — covers "at 10pm", "at 10", "at 10:30am", "at 22:00", "10pm garbage", "9:15".
    const am = body.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
    if (!am) return { when: null, reason: tidy(body) || spec, error: spec };
    const withColon = am[2] != null && /^\d+$/.test(am[2]);
    let h = parseInt(am[1], 10);
    const mi = withColon ? parseInt(am[2], 10) : 0;
    const mer = am[3] ? am[3].toLowerCase() : null;
    if (mer === 'pm' && h < 12) h += 12;
    if (mer === 'am' && h === 12) h = 0;
    const hadTime = !!mer || withColon || /^at\b/i.test(am[0].trim());
    if (!hadTime) return { when: null, reason: tidy(body) || spec, error: spec }; // "every 2 hours…" etc: not a schedulable clock time
    let when;
    if (!mer && !withColon && h >= 0 && h <= 12) {
      // Ambiguous "at 10": pick today's am or pm, whichever is still ahead.
      const cands = [h, h === 12 ? 0 : h + 12].map((hh) => { const d = new Date(now); d.setHours(hh, mi, 0, 0); return d; }).filter((d) => d.getTime() > now.getTime() + 60000);
      when = cands[0] || null;
      if (!when) { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(h, mi, 0, 0); when = d; }
    } else {
      when = new Date(now);
      when.setHours(h, mi, 0, 0);
      if (tomorrow) when.setDate(when.getDate() + 1);
      if (when.getTime() <= now.getTime() + 30000) when.setDate(when.getDate() + 1); // past time → next occurrence
    }
    const reason = tidy(body.replace(am[0], ' ')) || 'your reminder';
    return { when, reason, whenText: petSpeakableWhen(when) };
  }

  function petScheduleReminderAt(when, reason) {
    const entry = { timer: null, when, reason: String(reason || 'your reminder') };
    const id = setTimeout(() => { petFireReminder(id, entry); }, Math.max(500, when.getTime() - Date.now()));
    entry.timer = id;
    petReminders.set(id, entry);
    petTiming('reminder-scheduled ' + when.toISOString() + ' reason="' + entry.reason.slice(0, 80) + '"');
    return entry;
  }

  // Fired: pet wakes, the AI composes a spoken reminder from the stored
  // reason + time (streamed into captions), with a plain fallback.
  async function petFireReminder(id, entry) {
    petReminders.delete(id);
    const whenText = petSpeakableWhen(entry.when);
    try {
      petActivate(true);
      petPush('thinking');
      petCaption({ status: 'Reminder…' });
      let speech = '';
      try {
        const model = await petPickModel();
        speech = await petOllamaChatStream(model, [
          { role: 'system', content: "You are Ramo Pet delivering a reminder the user asked for earlier. Reply with one short friendly spoken sentence (no markdown, no emoji) that says what they should do." },
          { role: 'user', content: 'It is now ' + whenText + '. Deliver this reminder to them: "' + entry.reason + '".' }
        ], (full) => petStreamCaption(full), null);
      } catch (_) {}
      if (!speech) speech = 'Reminder: ' + entry.reason + '.';
      petPush('responding');
      await petSpeak(speech);
    } catch (_) {}
    petPush('idle');
    petRest();
    petTiming('reminder-fired reason="' + entry.reason.slice(0, 80) + '"');
  }

  // "cancel my reminders" / "cancel the cat reminder". Empty spec or "all"
  // cancels everything; otherwise token-matches the stored reasons.
  function petCancelReminders(spec) {
    if (!petReminders.size) return 'You have no reminders to cancel.';
    const want = String(spec || '').toLowerCase().replace(/^(the|my)\s+/, '').replace(/\b(reminder|timer|alarm)s?\b/g, '').trim();
    if (!want || /\b(all|everything|any|them)\b/.test(want)) {
      const count = petReminders.size;
      for (const e of petReminders.values()) clearTimeout(e.timer);
      petReminders.clear();
      return count === 1 ? 'Cancelled your one reminder.' : 'Cancelled all ' + count + ' of your reminders.';
    }
    let removed = 0;
    for (const [id, e] of Array.from(petReminders)) {
      if (e.reason.toLowerCase().includes(want)) { clearTimeout(e.timer); petReminders.delete(id); removed++; }
    }
    if (removed) return removed === 1 ? 'Cancelled that reminder.' : 'Cancelled ' + removed + ' reminders.';
    const left = [...petReminders.values()].sort((a, b) => a.when - b.when).map((e) => e.reason).slice(0, 4).join(', ');
    return 'No reminder matched "' + want.slice(0, 40) + '". Still set: ' + left + '.';
  }

  // "what reminders do I have" → a spoken, time-ordered list.
  function petListReminders() {
    if (!petReminders.size) return 'You have no reminders set.';
    const list = [...petReminders.values()].sort((a, b) => a.when - b.when);
    const head = list.length === 1 ? 'You have one reminder' : 'You have ' + list.length + ' reminders';
    const parts = list.map((e, i) => (list.length > 1 ? (i + 1) + ': ' : '') + petSpeakableWhen(e.when) + ' — ' + e.reason);
    return head + ': ' + parts.join('. ') + '.';
  }

  async function petCaptureScreen() {
    const capture = await petScreen.captureFull();
    if (!capture.ok) return null;
    return petScreen.screenView(capture, { maxWidth: 1280, quality: 90 });
  }

  // Speak through pocket TTS and route the audio to the pet window.
  async function petSpeak(text) {
    const clean = String(text || '').trim();
    if (!clean) return null;
    // Speak sentence by sentence so the first sentence can start playing
    // while any later ones are still being synthesised.
    const sentences = (clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [clean]).map((s) => s.trim()).filter(Boolean);
    if (!sentences.length) return null;
    let last = null;
    for (const sentence of sentences) {
      const tts = await pocketVoice.speak(sentence.length > 280 ? sentence.slice(0, 280) : sentence);
      if (tts && tts.wavBase64 && petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:audio', tts.wavBase64);
      last = tts;
    }
    // Safety net: pet.js reports playback end; force idle after a cap in case it never does.
    clearTimeout(petIdleFallbackTimer);
    petIdleFallbackTimer = setTimeout(() => {
      if (!petTurnActive) { petPush('idle'); petRest(); }
    }, 25000);
    return last;
  }

  // The drawing lands on the user's screen, so the model has to see that screen
  // before it chooses where the marks go. The capture is not optional: without
  // it the model works from memory and invents what is on the screen, so a
  // failed capture ends the turn instead of producing a drawing.
  //
  // The capture is kept at full resolution as well as a model-sized view, so
  // the grounding stages can crop the REAL pixels instead of the downscaled
  // copy the model looked at.
  async function petDrawPlan(text) {
    const request = String(text || '').trim();
    const capture = await petScreen.captureFull();
    const imageBase64 = capture.ok ? petScreen.screenView(capture, { maxWidth: 1280, quality: 90 }) : null;
    const grounded = wantsScreenContext(request);
    return {
      request,
      imageBase64,
      grounded,
      capture: capture.ok ? capture : null,
      // The size of the picture the model is shown. The numbered discs are
      // sized in its pixels, so the two have to agree.
      view: petScreen.viewSize(capture, { maxWidth: 1280 }),
      target: grounded ? grounding.targetPhrase(request) : null,
      prompt: sketchPrompt(request, { hasImage: !!imageBase64, grounded })
    };
  }

  // The grounding run, on its own, without showing anything.
  //
  // A grounded request runs four stages: route the target to a third of the
  // screen, re-ground it inside a crop of that third, draw with the centre
  // locked, and check the shape before anything is shown. A request that is
  // not about the screen skips all of that and draws in the middle.
  async function petRunGrounding(plan, model) {
    const durationMs = Math.max(2000, Math.min(20000, Math.round((Number(petSettings.sketchSeconds) || 8) * 1000)));
    const options = { durationMs, allowDuration: false };

    if (!plan.grounded) {
      // Imaginary: the middle of the canvas, and nothing else to check.
      const messages = sketchPrompt(plan.request, {
        hasImage: true,
        grounded: false,
        locked: { cx: 500, cy: 500, rx: 120, ry: 120, target: 'the thing the user asked for' }
      });
      const drawn = await grounding.stageDraw(
        { callDraw: petGroundingCallDraw, log: (message) => petTiming(message) },
        { model, messages, image: plan.imageBase64, options }
      );
      return {
        ok: !!drawn.ok && !!drawn.sketch,
        stage: 'draw',
        absent: false,
        verified: null,
        box: null,
        sketch: drawn.sketch || null,
        reply: drawn.ok ? null : 'I could not turn that into a drawing.',
        calls: []
      };
    }

    const deps = {
      callJson: petGroundingCallJson,
      callDraw: petGroundingCallDraw,
      crop: (args) => petScreen.crop(args.fullImage, args.rect, { upscale: args.upscale, maxWidth: args.maxWidth }),
      renderShape: (args) => petScreen.renderShape(args),
      // The numbered grid the locate stage asks about. It is drawn on the
      // screen view through the same hidden canvas page as the check marks.
      renderGrid: (args) => petScreen.renderGrid(args),
      // The detector proposes the places; the model picks one of them.
      //
      // The capture is resized to the letterbox's inner size with Electron's
      // own resizer, because a JS resample of a 1920x1200 screen costs more
      // than the inference does. The boxes come back in the capture's own
      // pixels, which is where the pet draws.
      detect: async (args) => {
        const capture = args.image;
        if (!capture || !capture.ok || !capture.image) {
          return { ok: false, boxes: [], error: 'there was no capture to detect on' };
        }
        try {
          const size = capture.image.getSize();
          const meta = detectCodec.letterbox(size.width, size.height);
          const frame = capture.image.resize({ width: meta.w, height: meta.h, quality: 'good' });
          const bitmap = frame.toBitmap();
          return await petDetect.detectForDraw(bitmap, args.phrases || [], {
            width: meta.w,
            height: meta.h,
            captureWidth: size.width,
            captureHeight: size.height,
            conf: args.conf,
            limit: args.limit
          });
        } catch (error) {
          return { ok: false, boxes: [], error: 'the screen could not be read for detection: ' + (error && error.message ? error.message : String(error)) };
        }
      },
      // The numbered candidates the model is shown.
      renderSom: (args) => petScreen.renderSom(args),
      log: (message) => petTiming(message)
    };
    return grounding.runGroundedDraw(deps, {
      request: plan.request,
      target: plan.target,
      model,
      screenView: plan.imageBase64,
      fullImage: plan.capture,
      screenWidth: plan.capture ? plan.capture.width : 0,
      screenHeight: plan.capture ? plan.capture.height : 0,
      viewWidth: plan.view ? plan.view.width : 0,
      viewHeight: plan.view ? plan.view.height : 0,
      // "think hard" switches the model's reasoning on for every stage of the
      // drawing, and gives each stage a budget that fits the reasoning.
      thinking: petThinking.wantsThinking(plan.request),
      options
    });
  }

  // The grounded drawing turn: ground it, then show it.
  async function petDrawTurn(request, model) {
    const plan = await petDrawPlan(request);
    const text = plan.request;
    if (!text) return { ok: false, reply: 'I did not catch what to draw.' };
    petTiming('sketch-screen=' + (plan.imageBase64 ? 'yes' : 'no') + ' grounded=' + (plan.grounded ? 'yes' : 'no'));
    if (!plan.imageBase64) return { ok: false, reply: NO_SCREEN_REPLY };
    const t0 = Date.now();
    const result = await petRunGrounding(plan, model);
    petTiming('sketch-grounding=+' + (Date.now() - t0) + 'ms stage=' + result.stage +
      ' calls=' + (result.calls ? result.calls.length : 0));
    if (!result.ok) return { ok: false, reply: result.reply, grounding: { stage: result.stage, absent: result.absent } };
    if (!petShowSketch(result.sketch)) return { ok: false, reply: 'I could not open the drawing layer.' };
    if (result.stage === 'detect' && result.box) {
      // The mark has to follow the thing without the model.
      petStartTracking(result, text, model);
    }
    return {
      ok: true,
      sketch: result.sketch,
      reply: sketchConfirmation(result.sketch, { screen: true }),
      grounding: { stage: result.stage, box: result.box }
    };
  }

  async function petRunTurn(source) {
    if (petTurnActive || !localSpeech) return;
    // A new turn talking to the screen takes over from the old one: kill any
    // loop that is still holding a mark on the previous target.
    petStopTracking();
    petTurnActive = true;
    try {
      if (!petWindow || petWindow.isDestroyed()) createPetWindow();
      if (!petWindow || petWindow.isDestroyed()) return;
      ensurePetCursorLoop();
      try { petWindow.showInactive(); } catch (_) {}
      petSetOpacity(PET_ACTIVE_OPACITY);
      petPush('listening');
      // The warm worker owns the microphone. Waiting for it (instead of
      // starting a second worker) keeps a single process on the capture
      // device, so a game can still open the microphone when the pet is idle.
      const hotT0 = Date.now();
      try { await localSpeech.hot(); } catch (e) { petTiming('hot-failed ' + e.message); }
      petTiming('hot=' + (Date.now() - hotT0) + 'ms');
      // The trigger was already released while the worker was warming up.
      if (petReleaseRequested) { petPush('idle'); petRest(); return; }
      // Hold to talk: the release stops the worker and flushes whatever
      // Nemotron captured so far.
      const t0 = Date.now();
      const capture = localSpeech.recognize();
      if (petReleaseRequested) { try { localSpeech.stop(); } catch (_) {} }
      const raw = await capture;
      petTiming('stt=' + (Date.now() - t0) + 'ms');
      const transcript = String(raw || '').replace(/[\s.,!?]+$/, '');
      if (!transcript.trim()) {
        petCaption({ status: "I didn't hear anything — try again." });
        petPush('idle');
        petRest();
        clearTimeout(petIdleFallbackTimer);
        petIdleFallbackTimer = setTimeout(() => { if (!petTurnActive) { petPush('idle'); petRest(); } }, 2600);
        return;
      }
      await petAnswerTurn(transcript);
    } catch (e) {
      console.warn('[Pet]', e && e.message);
      petPush('error');
      const msg = String(e && e.message || '').replace(/[.]$/, '');
      petCaption({ status: 'Could not finish: ' + msg.slice(0, 140) });
      if (petSettings.speakErrors) {
        try {
          const sorry = await pocketVoice.speak('Sorry, pet mode could not finish that. ' + msg.slice(0, 140) + '.');
          if (sorry?.wavBase64 && petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:audio', sorry.wavBase64);
        } catch (_) {}
      }
      setTimeout(() => { if (!petTurnActive) { petPush('idle'); petRest(); } }, 6000);
    } finally {
      petTurnActive = false;
      petCapturing = false;
      petReleaseRequested = false;
      if (petActive) petRest();
    }
  }

  // Everything that happens after the words are known: the router decides
  // what the request is, the tool runs, and the answer is spoken. It is the
  // same path for a spoken turn and for a transcript handed to the pet.
  async function petAnswerTurn(transcript) {
    const text = String(transcript || '').trim();
    if (!text) return;
    // A released turn can still be cancelled out loud, instead of being sent to
    // the model.
    if (/^cancel(?:\s+the)?\s*(pet\s*)?message$/i.test(text)) {
      petCaption({ status: 'Cancelled' });
      petPush('idle');
      petRest();
      return;
    }
    transcript = text;
    petPush('thinking');
    const routerT0 = Date.now();
    const decision = await petDecide(transcript.trim());
    petTiming('router=+' + (Date.now() - routerT0) + 'ms tool=' + decision.tool + ' via=' + (decision.via || 'fallback'));
    let context = '';
    let imageBase64 = null;
    let reply = '';
    const thinkingCaption = (msg) => { petCaption({ status: msg }); };
    if (decision.tool === 'search') {
      thinkingCaption('Searching the web…');
      const results = await petSearch(decision.query || transcript);
      context = 'Web search results for "' + decision.query + '":\n' + results;
    } else if (decision.tool === 'screen') {
      thinkingCaption('Looking at your screen…');
      imageBase64 = await petCaptureScreen();
      context = imageBase64 ? "Context: a capture of the user's screen is attached." : 'Context: the screen capture failed; mention that briefly.';
    } else if (decision.tool === 'window') {
      thinkingCaption('Checking what is on screen…');
      const title = await petForegroundWindow();
      context = 'Context: the most likely active window is "' + title + '".';
    } else if (decision.tool === 'draw') {
      thinkingCaption('Drawing on your screen…');
      const drawn = await petDrawTurn(decision.request || transcript, decision.model || await petPickModel());
      reply = drawn.reply;
      if (drawn.ok) {
        petPush('responding');
        petStreamCaption(reply);
      }
    } else if (decision.tool === 'remind') {
      const parsed = petParseRemindSpec(decision.spec || transcript);
      if (parsed.when) {
        const entry = petScheduleReminderAt(parsed.when, parsed.reason);
        context = 'Context: a reminder was just scheduled for ' + petSpeakableWhen(entry.when) + (parsed.reason && parsed.reason !== 'your reminder' ? ' about: ' + parsed.reason : '') + '. Confirm it briefly and naturally, mentioning the time.';
      } else {
        context = 'Context: the reminder time "' + String(decision.spec || '').slice(0, 120) + '" could not be understood. Ask the user to try a time like "at 10pm" or "in 10 minutes".';
      }
    } else if (decision.tool === 'remind_cancel') {
      // Cancel confirmations are composed directly — no model call, fast reply.
      petPush('responding');
      reply = petCancelReminders(decision.spec);
      petStreamCaption(reply);
    } else if (decision.tool === 'remind_check') {
      petPush('responding');
      reply = petListReminders();
      petStreamCaption(reply);
    }
    if (reply) {
      // Composed directly above (reminder cancel/check).
    } else if (decision.tool === 'answer' && decision.answer) {
      reply = decision.answer;
      petPush('responding');
      petStreamCaption(reply);
    } else {
      const messages = [
        { role: 'system', content: "You are Ramo Pet, a small calm voice companion perched in the corner of the user's screen. Reply in at most two short sentences of plain spoken words; no markdown, lists or emoji. If web search results are provided, base the reply on them and never recite raw text. If an image is attached, describe what is visible. When you draw, the sketch appears on screen for a few seconds, so keep the spoken part short. If unsure, say so briefly. You can be heard, not read as text." },
        ...petHistory.slice(-10),
        { role: 'user', content: context ? context + '\n\nSpoken request: ' + transcript.trim() : transcript.trim() }
      ];
      let responding = false;
      const streamT0 = Date.now();
      // A "think hard" request lets the model reason before it answers. The
      // caption stays quiet until the answer itself starts, so the user sees
      // the answer, not the reasoning.
      const answerBudget = petThinking.budgetFor('answer', transcript);
      petTiming('answer-think=' + (answerBudget.think ? 'on' : 'off') + ' budget=' + answerBudget.numPredict);
      reply = await petOllamaChatStream(decision.model || await petPickModel(), messages, (full) => {
        if (!responding) { responding = true; petPush('responding'); petTiming('stream-first-token=+' + (Date.now() - streamT0) + 'ms'); }
        petStreamCaption(full);
      }, imageBase64, {think: answerBudget.think, numPredict: answerBudget.numPredict});
      petTiming('stream-done=+' + (Date.now() - streamT0) + 'ms');
    }
    if (!reply) { petPush('idle'); petRest(); return; }
    // Short per-session memory; reset when the pet is hidden.
    petHistory.push({ role: 'user', content: transcript.trim() }, { role: 'assistant', content: reply });
    while (petHistory.length > 12) petHistory.shift();
    petPush('responding');
    const speakT0 = Date.now();
    await petSpeak(reply);
    await petWaitForAudioDone(Math.max(3000, reply.length * 75));
    petTiming('tts-synth-and-send=+' + (Date.now() - speakT0) + 'ms chars=' + reply.length);
  }

  // A transcript handed to the pet, so the checks can exercise the router,
  // the reminder scheduler and the voice without a person at the microphone.
  // It runs the same path as a spoken turn.
  async function petSimulateTurn(text) {
    const transcript = String(text || '').trim();
    if (!transcript || petTurnActive) return false;
    petTurnActive = true;
    try {
      if (!petWindow || petWindow.isDestroyed()) createPetWindow();
      petActivate(true);
      petPush('listening');
      await petAnswerTurn(transcript);
      return true;
    } catch (e) {
      console.warn('[Pet]', e && e.message);
      petPush('error');
      petCaption({ status: 'Could not finish: ' + String(e && e.message || '').slice(0, 140) });
      return false;
    } finally {
      petTurnActive = false;
      petCapturing = false;
      petReleaseRequested = false;
    }
  }

  app.whenReady().then(() => {
  manager = new ModelManager();

  apiProviders = new RamoApiProviders({filePath:path.join(app.getPath('userData'),'api-providers.json'),safeStorage,fetchImpl:createElectronFetch(net)});

  systemAwareness = new SystemAwareness();

  pocketVoice = new PocketVoice();

  localSpeech = new LocalSpeech({dataDir:app.getPath('userData'),sendEvent:packet=>{

    if(projectWindow&&!projectWindow.isDestroyed())projectWindow.webContents.send('ramo:stt:event',packet);

    // Live captions for the pet: the words being heard, and what went wrong.
    // The engine's own status (loading the model, for instance) is not shown
    // here: it would cover the caption that explains how to talk to the pet.
    if(petWindow&&!petWindow.isDestroyed()){
      if(packet.type==='partial')petCaption({text:String(packet.text||'').slice(-120)});
      else if(packet.type==='error')petCaption({status:String(packet.message||'Speech error')});
      else if(packet.type==='status'&&petCapturing)petCaption({status:String(packet.message||'')});
      else if(packet.type==='ready'&&petCapturing)petCaption({text:''});
    }

  }});

  // Voice is opt-in by default. Builds before this forced enabled:true on every
  // launch and persisted it, so profiles could not be quiet. One-time migration
  // turns the inherited flag OFF; the user re-enables voice in System -> Voice
  // and that persists from then on.
  try {
    if (pocketVoice && !pocketVoice.config.migratedAutoSpeak) {
      pocketVoice.config.migratedAutoSpeak = true;
      if (pocketVoice.config.enabled) void pocketVoice.settings({ enabled: false }).catch(() => {});
      else pocketVoice.save();
    }
  } catch (_) {}
  setTimeout(() => {
    const warm = async () => {
      try { await localSpeech.hot(); }
      catch (e) { console.warn('[STT] Nemotron warm:', e && e.message); }
    };
    warm();
    // The model stays loaded between turns. This only re-warms if the worker
    // exited; an already-warm worker answers immediately.
    if (!sttWarmTimer) sttWarmTimer = setInterval(() => {
      if (!localSpeech || localSpeech.busy) return;
      localSpeech.hot().catch(() => {});
    }, 60000);
  }, 3000);

  petWorkApi = require('./work/main.cjs').installWork({app,ipcMain,dialog,shell,manager,apiProviders,isProjectSender,getWindow:()=>projectWindow});
  // Pet mode channels (main is the authority; pet window is display-only).
  ipcMain.handle('ramo:pet:show', (event) => { if (!isProjectSender(event)) return false; petActive = true; petActivate(true, true); petPush('idle'); petStartKeepHot(); petStartTrigger(); petHint(); petNotify(); startPetIdleFlash(); return true; });
  ipcMain.handle('ramo:pet:hide', (event) => { if (!isProjectSender(event)) return false; petActive = false; petStopTrigger(); petStopKeepHot(true); destroyPetWindow(); petNotify(); return true; });
  ipcMain.handle('ramo:pet:toggle', (event) => {
    if (!isProjectSender(event)) return false;
    // The toggle follows what the user asked for, not whether a window
    // happens to exist: a pet that came back for a reminder is still a pet
    // the user has not switched on.
    if (petActive) {
      petActive = false; petStopTrigger(); petStopKeepHot(true); destroyPetWindow();
    } else {
      petActive = true; petActivate(true, true); petPush('idle'); petStartKeepHot(); petStartTrigger(); petHint(); startPetIdleFlash();
    }
    petNotify();
    return true;
  });
  ipcMain.on('ramo:pet:state', (event, state) => { if (!isProjectSender(event)) return; if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:state', state); });
  // The check seam: a transcript can be handed to the pet so the router, the
  // reminder scheduler and the voice can be exercised without a person at the
  // microphone. It exists only in a test build.
  ipcMain.handle('ramo:pet:simulate', async (event, text) => {
    if (!isProjectSender(event) || process.env.RAMO_TEST !== '1') return false;
    return petSimulateTurn(text);
  });
  // The measurement seam: what the pet window actually is. The opacity is the
  // only honest way to tell whether the companion can be seen, because a
  // transparent, always-on-top window is not part of a screen capture.
  // It exists only in a test build.
  ipcMain.handle('ramo:pet:inspect', (event) => {
    if (!isProjectSender(event) || process.env.RAMO_TEST !== '1') return null;
    const exists = !!(petWindow && !petWindow.isDestroyed());
    let opacity = null;
    let visible = false;
    if (exists) {
      try { opacity = petWindow.getOpacity(); } catch (_) {}
      try { visible = petWindow.isVisible(); } catch (_) {}
    }
    return {
      exists,
      opacity,
      visible,
      active: petActive,
      turn: petTurnActive,
      trigger: { ...(petSettings.trigger || {}) },
      sketch: petSketchInfo(),
      sketchWindow: !!(petSketchWindow && !petSketchWindow.isDestroyed())
    };
  });
  // A sketch reports that its hold and fade are finished, so the overlay can
  // be hidden without guessing. The deterministic hide timer stays as a
  // backstop for a renderer that never answers.
  ipcMain.on('pet:sketch-done', () => {
    if (petSketchHideTimer) { clearTimeout(petSketchHideTimer); petSketchHideTimer = null; }
    petSketchState = { ...petSketchState, visible: false };
    const win = petSketchWindow;
    if (win && !win.isDestroyed()) { try { win.hide(); } catch (_) {} }
  });
  // The overlay seam: hand the drawing layer a command list directly, without
  // inference, so the native harness can prove parse -> project -> render
  // independently of any model run. It exists only in a test build.
  ipcMain.handle('ramo:pet:sketch', (event, input) => {
    if (!isProjectSender(event) || process.env.RAMO_TEST !== '1') return null;
    const payload = input && typeof input === 'object' ? input : { commands: input };
    const raw = String(payload.commands == null ? '' : payload.commands);
    const seconds = Number(payload.seconds);
    const durationMs = Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
    const sketch = parseSketch(raw, { durationMs, allowDuration: false });
    const shown = petShowSketch(sketch);
    return {
      ok: sketch.ok,
      shown,
      strokes: sketch.strokes.length,
      ignored: sketch.ignored,
      durationMs: sketch.durationMs,
      info: petSketchInfo()
    };
  });
  // The draw-plan seam: what the drawing turn would do before it asks the
  // model anything. It shows whether the screen was captured and what the
  // model would be told, so the native harness can prove the pet always looks
  // at the screen before it draws, without a model run. It exists only in a
  // test build.
  ipcMain.handle('ramo:pet:draw-plan', async (event, input) => {
    if (!isProjectSender(event) || process.env.RAMO_TEST !== '1') return null;
    const payload = input && typeof input === 'object' ? input : { text: input };
    const plan = await petDrawPlan(payload.text);
    const user = plan.prompt[plan.prompt.length - 1];
    return {
      request: plan.request,
      hasImage: !!plan.imageBase64,
      grounded: !!plan.grounded,
      promptUser: user ? user.content : '',
      system: plan.prompt[0] ? plan.prompt[0].content : '',
      reply: plan.imageBase64 ? null : NO_SCREEN_REPLY,
      // The capture itself, for a live check that must not put anything on the
      // user's screen. Only when the caller asks for it.
      image: payload.includeImage ? (plan.imageBase64 || null) : null
    };
  });
  // The grounding seam: run the real four-stage grounded turn against the
  // local model and report what every stage did, WITHOUT opening the overlay.
  // It exists only in a test build, so a live measurement never puts marks on
  // the user's screen while it is being taken.
  ipcMain.handle('ramo:pet:ground', async (event, input) => {
    if (!isProjectSender(event) || process.env.RAMO_TEST !== '1') return null;
    const payload = input && typeof input === 'object' ? input : { text: input };
    const started = Date.now();
    let model = payload.model;
    try { model = model || await petPickModel(); } catch (_) {}
    if (!model) return { ok: false, error: 'no model was available' };
    const plan = await petDrawPlan(payload.text);
    if (!plan.imageBase64) return { ok: false, error: 'the screen capture failed', reply: NO_SCREEN_REPLY };
    // A live measurement can ask for the picture the model was given, so a
    // wrong answer can be looked at instead of guessed about.
    if (payload.save) {
      try { fs.writeFileSync(payload.save, Buffer.from(plan.imageBase64, 'base64')); } catch (_) {}
    }
    const result = await petRunGrounding(plan, model);
    return {
      ok: result.ok,
      model,
      request: plan.request,
      target: plan.target,
      grounded: plan.grounded,
      stage: result.stage,
      drew: !!result.drew,
      absent: !!result.absent,
      refined: !!result.refined,
      box: result.box || null,
      error: result.error || null,
      reply: result.reply || null,
      sketch: result.sketch ? { ok: result.sketch.ok, strokes: result.sketch.strokes.length, commands: result.sketch.strokes } : null,
      calls: result.calls || [],
      elapsedMs: Date.now() - started
    };
  });
  // The same grounding run, but against a picture on disk instead of the
  // live desktop. The frozen fixture set is measured this way: the same
  // twenty images, every time, whatever else is on the screen. It also
  // carries the older, ungrounded method, so the two can be compared on the
  // same images with the same model.
  ipcMain.handle('ramo:pet:ground-file', async (event, input) => {
    if (!isProjectSender(event) || process.env.RAMO_TEST !== '1') return null;
    const payload = input && typeof input === 'object' ? input : {};
    const started = Date.now();
    let model = payload.model;
    try { model = model || await petPickModel(); } catch (_) {}
    if (!model) return { ok: false, error: 'no model was available' };
    const { nativeImage } = require('electron');
    let image = null;
    try { image = nativeImage.createFromPath(String(payload.imagePath || '')); } catch (_) {}
    if (!image || image.isEmpty()) return { ok: false, error: 'the image could not be read' };
    const size = image.getSize();
    const capture = { ok: true, image, width: size.width, height: size.height };
    const imageBase64 = petScreen.screenView(capture, { maxWidth: 1280, quality: 90 });
    if (!imageBase64) return { ok: false, error: 'the image could not be prepared' };
    const request = String(payload.text || '').trim();
    const target = grounding.targetPhrase(request);
    const durationMs = Math.max(2000, Math.min(20000, Math.round((Number(petSettings.sketchSeconds) || 8) * 1000)));
    const options = { durationMs, allowDuration: false };

    // The picture the locate stage really sees: the screen view with the
    // numbered grid drawn over it. A measurement can save it, so a wrong
    // answer can be looked at instead of guessed about.
    if (payload.saveGrid) {
      try {
        const rendered = await petScreen.renderGrid({
          imageBase64: imageBase64,
          cols: grounding.GRID_COLS,
          rows: grounding.GRID_ROWS,
          numSize: grounding.GRID_NUM_SIZE
        });
        if (rendered && rendered.ok) fs.writeFileSync(payload.saveGrid, Buffer.from(rendered.base64, 'base64'));
      } catch (_) {}
    }
    if (payload.saveView) {
      try { fs.writeFileSync(payload.saveView, Buffer.from(imageBase64, 'base64')); } catch (_) {}
    }

    if (payload.method === 'baseline') {
      // The method this replaced, reproduced faithfully so the A/B measures the
      // grounded loop and nothing else:
      //   - ONE call, the whole screen attached
      //   - no locked centre, no crop, no re-ground, no verification
      //   - the old sampling: temperature 0.2, num_predict 260
      //   - the old instruction: "mark where it really is"
      // The contract and the parser are shared with the new method on purpose:
      // that is a Phase 1 change, and hiding it inside the baseline would make
      // the comparison unreadable.
      const legacyMessages = [
        {role: 'system', content: sketchSystemPrompt()},
        {
          role: 'user',
          content: [
            "The attached image is the user's screen. Mark where it really is: find \"" + target + "\" in the image and draw around it.",
            '',
            'Draw this: ' + request
          ].join('\n')
        }
      ];
      const startedDraw = Date.now();
      let raw = '';
      let drawError = null;
      try {
        raw = await petOllamaSketch(model, legacyMessages, imageBase64, { numPredict: 260, temperature: 0.2 });
      } catch (error) {
        drawError = String(error && error.message ? error.message : error);
      }
      const sketch = drawError ? null : parseSketch(raw, options);
      const drew = !!(sketch && sketch.ok);
      return {
        ok: drew,
        method: 'baseline',
        model,
        request,
        target,
        grounded: true,
        stage: 'draw',
        drew,
        absent: false,
        verified: null,
        refined: false,
        box: null,
        error: drawError || (sketch && !sketch.ok ? sketch.error : null),
        reply: drew ? null : 'I could not turn that into a drawing.',
        sketch: sketch ? { ok: sketch.ok, strokes: sketch.strokes.length, commands: sketch.strokes } : null,
        calls: [{stage: 'draw', ok: drew, ms: Date.now() - startedDraw, repairs: 0, numPredict: 260, temperature: 0.2}],
        elapsedMs: Date.now() - started
      };
    }

    const plan = {
      request,
      imageBase64,
      grounded: true,
      target,
      capture,
      view: petScreen.viewSize(capture, { maxWidth: 1280 }),
      prompt: sketchPrompt(request, { hasImage: true, grounded: true })
    };
    const result = await petRunGrounding(plan, model);
    return {
      ok: result.ok,
      method: 'phase1',
      model,
      request,
      target,
      grounded: true,
      stage: result.stage,
      drew: !!result.drew,
      absent: !!result.absent,
      refined: !!result.refined,
      // A failed check buys a retry, and the retry's drawing is the one shown.
      // The flag is reported so the measurement can separate "the first
      // drawing was right" from "the pet had to try again".
      retried: !!result.retried,
      box: result.box || null,
      error: result.error || null,
      reply: result.reply || null,
      sketch: result.sketch ? { ok: result.sketch.ok, strokes: result.sketch.strokes.length, commands: result.sketch.strokes } : null,
      calls: result.calls || [],
      elapsedMs: Date.now() - started
    };
  });
  // Pet window -> main close request.
  ipcMain.on('pet:close', () => { petActive = false; petStopTracking(); petStopTrigger(); petStopKeepHot(true); destroyPetWindow(); petNotify(); });
  // Pet window reports finished audio playback -> back to waiting.
  ipcMain.on('pet:audio-done', () => {
    if (petAudioDoneResolver) {
      const resolve = petAudioDoneResolver;
      petAudioDoneResolver = null;
      try { resolve(true); } catch (_) {}
    }
    if (!petTurnActive) { petPush('idle'); petRest(); }
  });
  // Pet settings (voice, volume, preferred bonsai size, spoken errors, trigger).
  ipcMain.handle('ramo:pet:get-settings', (event) => {
    if (!isProjectSender(event)) return null;
    return { ...petSettings, voices: [...VOICES], languages: [...LANGUAGES], currentVoice: pocketVoice ? pocketVoice.config.voice : (petSettings.voice || 'michael') };
  });
  ipcMain.handle('ramo:pet:set-settings', (event, patch) => {
    if (!isProjectSender(event) || !patch || typeof patch !== 'object') return null;
    if (Number.isFinite(Number(patch.volume))) petSettings.volume = Math.max(0.05, Math.min(1, Number(patch.volume)));
    if (['4b', '9b', '2b'].includes(patch.preferModel)) petSettings.preferModel = patch.preferModel;
    if (patch.speakErrors !== undefined) petSettings.speakErrors = patch.speakErrors === true;
    // How long a sketch stays. The user owns this setting; a model cannot
    // stretch it, which is why the sketch parser is given allowDuration:false.
    if (patch.sketchSeconds !== undefined) {
      const seconds = Number(patch.sketchSeconds);
      if (Number.isFinite(seconds)) petSettings.sketchSeconds = Math.max(2, Math.min(20, Math.round(seconds)));
    }
    if (patch.voice && VOICES.has(patch.voice)) {
      petSettings.voice = patch.voice;
      if (pocketVoice) { try { pocketVoice.settings({ voice: patch.voice }).catch(() => {}); } catch (_) {} }
    }
    // A new trigger is armed straight away, so the change can be used at once.
    if (patch.trigger && typeof patch.trigger === 'object') {
      const before = JSON.stringify(petSettings.trigger);
      petSettings.trigger = normalizeTrigger(patch.trigger);
      petSaveSettings();
      if (JSON.stringify(petSettings.trigger) !== before) {
        if (petActive) petStartTrigger();
        else petStopTrigger();
      }
    }
    petSaveSettings();
    if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:settings', { ...petSettings });
    return { ...petSettings, voices: [...VOICES], languages: [...LANGUAGES], currentVoice: pocketVoice ? pocketVoice.config.voice : (petSettings.voice || 'michael') };
  });
  createProjectWindow(defaultProjectURL);
  if (projectWindow) projectWindow.on('closed', () => { try { petStopTrigger(); petStopKeepHot(false); destroyPetWindow(); } catch (_) {} });
  // Tray for manual control.
  try {
    const { Tray, Menu } = require('electron');
    const petTray = new Tray(path.resolve(__dirname, 'icon.png'));
    petTray.setToolTip('Ramo Pet');
    const triggerLabel = petSettings.trigger && petSettings.trigger.mouse && petSettings.trigger.mouse !== 'none'
      ? 'Talk (hold the ' + (petSettings.trigger.mouse === 'back' ? 'mouse back button' : petSettings.trigger.mouse === 'forward' ? 'mouse forward button' : 'middle mouse button') + ')'
      : 'Talk (hold ' + ((petSettings.trigger && petSettings.trigger.key) || 'the trigger') + ')';
    petTray.setContextMenu(Menu.buildFromTemplate([
      { label: triggerLabel, click: () => { if (petCapturing) { petTriggerUp(); return; } petActive = true; if (!petWindow || petWindow.isDestroyed()) createPetWindow(); petStartKeepHot(); petStartTrigger(); petTriggerDown('tray'); } },
      { label: 'Wake Pet', click: () => { petActive = true; petActivate(true, true); petPush('idle'); petStartKeepHot(); petStartTrigger(); petHint(); startPetIdleFlash(); petNotify(); } },
      { label: 'Pet settings', click: () => { try { if (projectWindow && !projectWindow.isDestroyed()) projectWindow.show(); projectWindow?.webContents.send('ramo:pet:open-settings'); } catch (_) {} } },
      { label: 'Hide Pet', click: () => { petActive = false; petStopTrigger(); petStopKeepHot(true); destroyPetWindow(); petNotify(); } }
    ]));
  } catch (e) { console.warn('[Pet] Tray unavailable:', e && e.message); }

  if(pocketVoice.config.enabled)pocketVoice.ensure().catch(error=>console.warn("[Ramo Pocket]",error.message));

});

