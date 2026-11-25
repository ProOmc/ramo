/* Desktop presentation only. Service contracts and authored core belong to the existing runtime. */
(function () {
  'use strict';
  const ui = () => globalThis.__ramoWorkspaceUIActive;
  const api = () => globalThis.__ramoAssistantInstance;
  const overlays = () => window.RamoOverlays;
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  const paths = {
    plus:'<path d="M12 5v14M5 12h14"/>', down:'<path d="m6 9 6 6 6-6"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>',
    chat:'<path d="M20 11.5a8 8 0 0 1-8 8H4l1.8-4A8 8 0 1 1 20 11.5Z"/>',
    settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
    more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>', search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    memory:'<path d="M9 4a3 3 0 0 0-5 3 4 4 0 0 0-1 7 4 4 0 0 0 6 6V4Zm6 0a3 3 0 0 1 5 3 4 4 0 0 1 1 7 4 4 0 0 1-6 6V4M5 9h4m6 0h4M5 16h4m6 0h4"/>',
    files:'<path d="M3 7V5h7l2 2h9v13H3Z"/>', computer:'<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8m-4-5v5"/>',
    models:'<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/>',
    task:'<path d="m3 6 2 2 4-4m-6 10 2 2 4-4M12 6h9m-9 8h9M3 21h18"/>',
    branch:'<circle cx="6" cy="5" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10m0-4h6a6 6 0 0 0 6-5"/>',
    voice:'<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
    attach:'<path d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9m-7 11 8-8"/>',
    pet:'<circle cx="12" cy="15.2" r="3.6"/><circle cx="6.8" cy="10.2" r="1.7"/><circle cx="10.6" cy="7.2" r="1.8"/><circle cx="14.6" cy="7.4" r="1.8"/><circle cx="17.6" cy="10.8" r="1.7"/>',
    key:'<circle cx="8" cy="15" r="4.5"/><path d="M11.5 11.5 19.5 3.5M17 6l2.5 2.5M14 9l2 2"/>',
  };
  function icon(name) { const span = el('span'); span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name] || paths.more)+'</svg>'; return span.firstChild; }
  function button(label, fn, glyph, cls = 'oc-shell-button') {
    const b = el('button', undefined, cls); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label;
    if (glyph) b.append(icon(glyph)); if (label) b.append(el('span', label));
    b.onclick = async () => { try { await fn(b); } catch (e) { const notice = overlays().current?.querySelector('[role="status"]'); if (notice) notice.textContent = e.message; else ui()?._showSmallStatus(e.message); } }; return b;
  }
  function head(panel, title) { const row = el('div', undefined, 'oc-dialog-head'); row.append(el('h2', title), button('Close', () => overlays().close(), 'close')); panel.append(row); }
  function busy() { if (api().session) throw Error('Wait for the current response or stop it first.'); }
  const labels = {home:'Chat',research:'Research',memory:'Memory',files:'Files',computer:'Computer',models:'Models',system:'Settings'};
  function navigate(name) { overlays().close(false); document.documentElement.classList.remove('sidebar-open'); ui()._navAction(name);sync(); }
  function openDialog(name, anchor) { window.RamoChatDialogs.open(name, anchor); }
  function menu(anchor, title, items) {
    const panel = el('section'); head(panel, title);
    for (const item of items) {
      if (!item) { panel.append(el('hr', undefined, 'oc-menu-rule')); continue; }
      const [label, glyph, fn] = item; panel.append(button(label, () => { overlays().close(false); return fn(anchor); }, glyph, 'oc-menu-row'));
    }
    overlays().open(panel, {anchor, label:title, width:290});
  }
  function conversationMenu(anchor) { menu(anchor, 'Conversation', [
    ['Tasks','task',a=>openDialog('tasks',a)], ['Saved versions','branch',a=>openDialog('branches',a)],
    ['Reusable instructions','files',a=>openDialog('skills',a)], null,
    ['Saved sessions','chat',a=>external('sessionsDialog',a)], ['Compact context now','menu',a=>external('compactNow',a)],
    ['Fork this conversation','branch',a=>external('forkChat',a)], ['Skills & tools','task',a=>external('skillsDialog',a)],
    ['Export…','down',a=>external('exportDialog',a)], null,
    ['Manage & export chats','chat',a=>openDialog('data',a)],
  ]); }
  function external(name, anchor) {
    const target = globalThis.RamoUnified && globalThis.RamoUnified[name];
    if (typeof target === 'function') { const result = target(anchor); Promise.resolve(result).catch(error => ui()?._showSmallStatus?.(error?.message || String(error))); return; }
    ui()?._showSmallStatus?.('Restart the app to use this.');
  }
  function addMenu(anchor) { menu(anchor, 'Add to your conversation', [
    ['Attach text file','attach',()=>{busy();return api().attachText();}],
    ['Open files','files',()=>navigate('files')], ['Saved research','search',()=>navigate('research')],
  ]); }
  function appMenu(anchor) { menu(anchor, 'Settings', [
    ['Voice & dictation','voice',a=>voiceSettings(a)], ['Research model','search',a=>researchSettings(a)],
    ['API keys','key',a=>globalThis.RamoKeys?.open?.(a)],
    ['Pet settings','pet',()=>{try{window.RamoPet?.openSettings();}catch(_){ui()._showSmallStatus('Pet settings are unavailable in this build.');}}], ['Appearance: '+(ui().theme==='paper'?'Light':'Dark'),'sun',()=>ui()._toggleTheme()], null,
    ['Advanced system settings','settings',()=>navigate('system')], ['Manage model servers','models',()=>window.ramoDesktop?.openModelManager()],
  ]); }
  function researchSettings(anchor) {
    const panel = el('section'); head(panel, 'Research model'); panel.append(el('p','Choose the local model used for deep research.','oc-dialog-help'));
    const select=el('select',undefined,'oc-research-model');select.setAttribute('aria-label','Research model');panel.append(select);
    ui()._wireModelPickers(panel);
    const profiles=ui()._chatModelProfiles();let current=String(ui()._getNamed('Research Report Model',''));if(!profiles.some(p=>p.name===current)){current=profiles.find(p=>p.label==='Smart')?.name||profiles[0]?.name||'';const variable=ui()._findVarByName('Research Report Model');if(variable)variable.value=current;}
    for(const choice of ui()._availableModelChoices(current,false)){const option=el('option',choice.label);option.value=choice.name;select.append(option);}
    select.value=current;
    overlays().open(panel,{anchor,modal:true,width:440,label:'Research model'});
  }
  async function voiceSettings(anchor) {
    overlays().close(false); const u=ui(); u.composer.querySelector('.oc-voice-panel')?.remove();
    const promise=u._showVoiceSettings();const panel=u.composer.querySelector('.oc-voice-panel');
    if(panel){panel.className='oc-studio-voice';panel.querySelector(':scope > strong')?.remove();head(panel,'Voice output');panel.prepend(panel.lastElementChild);panel.querySelector('.oc-voice-close')?.remove();overlays().open(panel,{anchor,modal:true,width:480,label:'Voice settings'});}
    await promise;
  }
  function settingToggle(panel, key, title, description, config, fields) {
    const label=el('label',undefined,'oc-switch-row'),text=el('span',title);text.append(el('small',description));
    const input=el('input');input.type='checkbox';input.checked=config[key];input.setAttribute('aria-label',title);fields[key]=input;label.append(text,input);panel.append(label);
  }
  function chatSettings(anchor) {
    const a=api(), config=a.harness.settings(), panel=el('section'),fields={};head(panel,'Conversation settings');
    panel.append(el('p','Preferences for this conversation.','oc-dialog-help'));
    settingToggle(panel,'web','Web access','Allow online search and source reading.',config,fields);
    settingToggle(panel,'tools','Assistant tools','Allow supported actions such as source and session lookup.',config,fields);
    const label=el('label',undefined,'oc-form-field');label.append(el('span','Instructions'));const input=el('textarea');input.value=config.instructions;input.maxLength=4000;input.rows=3;input.placeholder='How should Ramo help in this chat?';input.setAttribute('aria-label','Chat instructions');label.append(input);fields.instructions=input;panel.append(label);
    const advanced=el('details',undefined,'oc-advanced');advanced.append(el('summary','Advanced generation settings'));const grid=el('div',undefined,'oc-form-grid');
    for(const [key,title,min,max,step] of [['context','Context window',8192,65536,1024],['maxTokens','Response limit',128,8192,128],['temperature','Temperature',0,2,.05]]) {
      const label=el('label',undefined,'oc-form-field'),field=el('input');label.append(el('span',title));Object.assign(field,{type:'number',min,max,step,value:config[key]});field.setAttribute('aria-label',title);fields[key]=field;label.append(field);grid.append(label);
    }
    advanced.append(grid);settingToggle(advanced,'skills','Reusable instructions','Allow the assistant to load your saved procedures.',config,fields);advanced.append(el('p','Ramo manages context compaction and the shared capability loop. Full session history remains saved.','oc-dialog-help'));panel.append(advanced);
    const notice=el('p','', 'oc-harness-notice');notice.setAttribute('role','status');panel.append(notice);
    const actions=el('div',undefined,'oc-dialog-actions');actions.append(button('Cancel',()=>overlays().close()),button('Save settings',async()=>{busy();const changes={};for(const [k,v] of Object.entries(fields))changes[k]=v.type==='checkbox'?v.checked:v.type==='number'?Number(v.value):v.value;await a.updateHarnessSettings(changes);overlays().close();ui()._showSmallStatus('Conversation settings saved');},null,'oc-shell-button primary'));panel.append(actions);
    overlays().open(panel,{anchor,modal:true,width:500,label:'Conversation settings'});
  }
  let registryPending=false,registryAt=0;
  /**
   * API profiles are part of the same choice list as the local tiers.
   *
   * `_availableModelChoices` reads `__ramoModelRegistry`, which `registry()`
   * fills with the provider store's rows, so a saved API profile becomes
   * selectable as soon as the pickers rebuild. Nothing else is needed to
   * "include" them — this only republishes the list.
   */
  function includeApiModels(u){if(!u)return;u._syncModelPickers?.(true);}
  async function registry(force=false) {
    if(registryPending||(!force&&Date.now()-registryAt<8000)||!window.ramoDesktop?.modelSummary)return;
    registryPending=true;try{const [local,api]=await Promise.all([window.ramoDesktop.modelSummary(),window.ramoDesktop.apiProviders?.list?.().catch(()=>[])||[]]);globalThis.__ramoModelRegistry=[...local,...api];registryAt=Date.now();const u=ui();if(u){includeApiModels(u);u._syncModelPickers?.(true);}}finally{registryPending=false;}
  }
  function selectedRuntime(){return (globalThis.__ramoModelRegistry||[]).find(p=>p.model===api().modelName()&&p.kind!=='ollama'&&p.kind!=='api');}
  async function startModel() {
    busy();const runtime=selectedRuntime();if(!runtime)return;
    if(runtime.startup?.cancellable){await window.ramoDesktop.cancelModelStart(runtime.id);}
    else {runtime.startup={cancellable:true,message:'Starting model'};sync();const result=await window.ramoDesktop.startModel(runtime.id);if(result.status==='error')throw Error(result.message||result.error||'Could not start model');}
    await registry(true);sync();
  }
  async function editApiModel(profile,anchor,returnToPicker=true){
    const panel=el('section',undefined,'oc-api-model-editor');head(panel,profile?'Edit API model':'Add an API model');panel.append(el('p','API keys are encrypted by your operating system. Ramo never adds them to chats or exports.','oc-dialog-help'));
    const field=(title,value,type='text')=>{const wrap=el('label',undefined,'oc-form-field'),caption=el('span',title),input=el('input');input.type=type;input.value=value||'';input.setAttribute('aria-label',title);wrap.append(caption,input);panel.append(wrap);return input;};
    const choice=(title,options,value)=>{const wrap=el('label',undefined,'oc-form-field'),caption=el('span',title),select=el('select');select.setAttribute('aria-label',title);for(const [label,id] of options){const option=el('option',label);option.value=id;select.append(option);}select.value=value;wrap.append(caption,select);panel.append(wrap);return select;};
    const provider=choice('API provider',[['Google Gemini','gemini'],['OpenAI-compatible service','openai-compatible']],profile?.provider||'gemini');
    const name=field('Name shown in the model picker',profile?.name||'Gemini Flash');
    const model=field('Provider model ID',profile?.providerModel||'');
    const endpoint=field('API base URL',profile?.provider==='openai-compatible'?profile.endpoint.replace(/\/chat\/completions$/i,''):'https://api.openai.com/v1','url');
    const auth=choice('API key format',[['Bearer token','bearer'],['x-api-key header','x-api-key']],profile?.auth||'bearer');
    const key=field(profile?'Replace API key (leave blank to keep current)':'API key','', 'password');key.autocomplete='new-password';
    const updateVisibility=()=>{const custom=provider.value==='openai-compatible';endpoint.closest('label').hidden=!custom;auth.closest('label').hidden=!custom;};
    provider.addEventListener('change',()=>{if(provider.value==='openai-compatible'&&endpoint.value.includes('generativelanguage.googleapis.com'))endpoint.value='https://api.openai.com/v1';updateVisibility();});updateVisibility();
    const notice=el('p','', 'oc-harness-notice');notice.setAttribute('role','status');panel.append(notice);
    const actions=el('div',undefined,'oc-dialog-actions');actions.append(button('Cancel',()=>overlays().close()));
    actions.append(button('Save API model',async()=>{busy();try{const rows=await window.ramoDesktop.apiProviders.save({id:profile?.id,name:name.value,provider:provider.value,model:model.value,endpoint:endpoint.value,auth:auth.value,apiKey:key.value});key.value='';await registry(true);overlays().close(false);ui()._syncModelPickers?.(true);sync();if(returnToPicker)openModels(anchor);}catch(error){notice.textContent=error.message;key.value='';}},null,'oc-shell-button primary'));
    if(profile)actions.append(button('Remove',async()=>{busy();if(!confirm('Remove this API model and its saved key?'))return;await window.ramoDesktop.apiProviders.remove(profile.id);await registry(true);overlays().close(false);ui()._syncModelPickers?.(true);sync();if(returnToPicker)openModels(anchor);},null,'oc-shell-button'));panel.append(actions);
    overlays().open(panel,{anchor,modal:true,width:470,label:profile?'Edit API model':'Add an API model'});
  }
  async function openModels(anchor) {
    await registry(true);const u=ui(),a=api(),panel=el('section');head(panel,'Choose model');const list=el('div',undefined,'oc-model-list');panel.append(list);
    const render=()=>{
      list.replaceChildren();
      const add=(name,title,description)=>{
        const runtime=(globalThis.__ramoModelRegistry||[]).find(p=>p.model===name&&p.kind!=='ollama'),installed=u.ollamaInventory.some(m=>m.name===name);
        const status=runtime?(runtime.ready?'Ready':runtime.startup?.cancellable?'Starting':'Stopped'):installed?'Available':'Not installed';
        const row=button('',()=>{busy();u._chatModelsExpanded=true;u._syncModelPickers(true);const select=u.workspacePane.querySelector('.oc-chat-model');select.value=name;if(select.value!==name){u._syncModelPickers(true);select.value=name;}select.dispatchEvent(new Event('change',{bubbles:true}));if(a.modelName()!==name)throw Error('Model could not be selected');overlays().close();sync();},null,'oc-model-option');
        row.setAttribute('aria-label',title);row.setAttribute('aria-pressed',String(name===a.modelName()));const copy=el('span');copy.append(el('b',title),el('small',description));row.append(copy,el('span',name===a.modelName()?'Selected · '+status:status,'oc-model-status'));list.append(row);
      };
      // The same list the composer menu and the toolbar select use: the three
      // local tiers and every saved API model.
      for(const choice of u._availableModelChoices())add(choice.name,choice.label,({'Fast':'Quick everyday help','Smart':'More detailed work','Super Smart':'Complex tasks'})[choice.label]||choice.details||'Cloud provider model');
      const addModel=button('Add an API model…',()=>{overlays().close(false);editApiModel(undefined,anchor);},'plus','oc-shell-button');list.append(addModel);
    };
    render();overlays().open(panel,{anchor,width:410,label:'Choose model'});await u._refreshOllamaInventory(true);if(panel.isConnected)render();
  }
  function installNavigation(u) {
    includeApiModels(u);registry(true).then(()=>{u._syncModelPickers?.(true);sync();}).catch(()=>{});
    u.navShell?.remove();u.drawer=null;
    u._setupNavigation=function(){
      if(this.navShell?.isConnected)return true;
      const shell=el('div');shell.id='ramo-nav-shell-v190';const side=el('aside');side.id='oc-studio-sidebar';side.setAttribute('aria-label','Main navigation');
      const brand=el('div',undefined,'oc-brand');brand.append(el('span','Ramo'),el('small','LOCAL'));const close=button('Close navigation',()=>document.documentElement.classList.remove('sidebar-open'),'close','oc-shell-button oc-sidebar-close');close.querySelector('span').remove();brand.append(close);side.append(brand);
      side.append(button('New chat',()=>{overlays().close(false);document.documentElement.classList.remove('sidebar-open');return this._doChatAction('new');},'plus','oc-new-chat'));
      for(const [page,glyph] of [['home','chat'],['research','search'],['memory','memory'],['files','files']]){const b=button(labels[page],()=>navigate(page),glyph,'oc-nav-item');b.dataset.page=page;side.append(b);}
      side.append(el('div','CONVERSATIONS','oc-nav-label'));const search=el('input',undefined,'oc-sidebar-search');search.type='search';search.placeholder='Search chats';search.setAttribute('aria-label','Search conversations');search.oninput=()=>{this.chatSearch=search.value.trim().toLowerCase();this._renderDrawerChats();};side.append(search);
      const history=el('div',undefined,'oc-sidebar-history ramo-drawer-chat-list');history.setAttribute('aria-label','Recent conversations');history.addEventListener('click',e=>{const b=e.target.closest('[data-chat-id]');if(b){document.documentElement.classList.remove('sidebar-open');this._doChatAction('select',b.dataset.chatId);}});side.append(history);
      const footer=el('div',undefined,'oc-nav-footer');footer.append(button('Manage chats',a=>openDialog('data',a),'chat','oc-nav-item'));for(const [p,g] of [['computer','computer'],['models','models']]){const b=button(labels[p],()=>navigate(p),g,'oc-nav-item');b.dataset.page=p;footer.append(b);}const petItem=button('Pet',()=>{const pet=window.ramoDesktop?.pet;if(pet&&typeof pet.toggle==='function')pet.toggle();else ui()?._showSmallStatus('Pet mode is unavailable in this build.');},'pet','oc-nav-item');petItem.id='oc-pet-item';petItem.title='Desktop pet companion · voice only · hold the trigger to talk · Right-click for settings';footer.append(petItem);footer.append(button('Settings',a=>appMenu(a),'settings','oc-nav-item'));side.append(footer);
      const backdrop=el('div');backdrop.id='oc-mobile-backdrop';backdrop.onclick=()=>document.documentElement.classList.remove('sidebar-open');
      const mobile=button('Open navigation',()=>document.documentElement.classList.toggle('sidebar-open'),'menu');mobile.id='oc-mobile-nav';mobile.querySelector('span')?.remove();shell.append(backdrop,side,mobile);this.overlayRoot.append(shell);this.navShell=shell;this._renderDrawerChats();return true;
    };
    u._styleNavigation=function(){this.navShell?.style.setProperty('--rail-w',innerWidth>900?'216px':'0px');};
    u._toggleDrawer=()=>document.documentElement.classList.toggle('sidebar-open');
  }
  function layout(u) {
    u._geometry=function(w,h,mode){
      // One owner. The content box is the room between the sidebar and the
      // rail; the pane, the composer and the core all derive from it, so the
      // CSS pin (--oc-content-x/--oc-content-w) and this model cannot drift.
      const box=this._contentBox();
      const occupied=this._conversationOccupied(),isHome=this.currentPage==='home';
      const composerH=Math.max(64,this.composerHeight||64),bottom=44,top=12;
      // Occupied: the small core badge at the pane's top-left, exactly where
      // .oc-occupied-home draws it (left = pane + 16, top = 30, 32 x 32).
      const d=occupied?32:Math.min(320,Math.max(160,h*.34));
      const cx=occupied?box.left+32:box.left+box.width/2;
      const cy=occupied?46:Math.min(h*.35,h-bottom-composerH-140);
      return {mode,compact:w<690,isHome,sideBySide:false,stageW:w,stageH:h,contentBox:box,rail:box.left,margin:0,contentLeft:box.left,usableRight:box.right,coreCenterX:cx,coreCenterY:cy,coreX:cx-w/2,coreY:h/2-cy,coreDiameter:d,coreSize:d/104*100,activitySize:50,activityY:h/2-cy+d*.52,workspaceLeft:box.left,workspaceRight:box.right,workspaceTop:top,workspaceBottom:bottom+composerH+24,workspaceWidth:box.width,workspaceHeight:h-top-bottom-composerH-24,composerLeft:box.left,composerWidth:box.width,composerH,composerBottom:bottom,drawerWidth:216,railButton:36};
    };
    const originalRender=u._renderHome;u._renderHome=function(force){originalRender.call(this,force);decorateMessages(this);};
    const originalActivity=u._inlineActivityHTML;u._inlineActivityHTML=function(run){this.inlineOpen??={};const key=(this.chatView?.active||'main')+':'+run.index;if(this.inlineOpen[key]===undefined)this.inlineOpen[key]=false;return originalActivity.call(this,run);};
    const originalThinking=u._syncThinkingButton;u._syncThinkingButton=function(){originalThinking.call(this);const b=this.composer?.querySelector('.oc-thinking-quick');if(b){b.textContent='Thinking '+(api()?.liveThinking?'on':'off');b.setAttribute('aria-label','Thinking '+(api()?.liveThinking?'on':'off'));}};
  }
  function decorateMessages(u) {
    const names={'data-oc-turn-fork':'Branch','data-oc-turn-edit':'Edit','data-oc-turn-retry':'Retry','data-oc-turn-delete':'Delete','data-oc-message-copy':'Copy'};
    for(const [attr,name] of Object.entries(names))for(const b of u.workspacePane?.querySelectorAll('['+attr+']')||[])if(b.textContent!==name)b.textContent=name;
  }
  function installHeader(u) {
    const head=u.workspacePane.querySelector('.ramo-w-head');if(head.querySelector('.oc-studio-heading'))return;
    const heading=el('div',undefined,'oc-studio-heading'),text=el('div',undefined,'oc-studio-heading-text');
    const model=button('Select chat model',a=>openModels(a),'down','oc-shell-button oc-model-menu');text.append(model,el('span','','oc-studio-chat-title'));heading.append(text);
    const actions=el('div',undefined,'oc-studio-header-actions');const start=button('Start model',()=>startModel(),null,'oc-shell-button oc-model-start');start.hidden=true;
    const settings=button('Conversation settings',a=>chatSettings(a),'settings');settings.querySelector('span').textContent='Settings';settings.querySelector('span').className='oc-settings-label';
    const more=button('Conversation actions',a=>conversationMenu(a),'more');more.querySelector('span').remove();actions.append(start,settings,more);head.append(heading,actions);
  }
  function installComposer(u) {
    const c=u.composer;if(c.querySelector('.oc-composer-tools'))return;
    const more=button('Add files or research',a=>addMenu(a),'plus','oc-shell-button oc-composer-tools');more.querySelector('span').remove();c.prepend(more);
    // Text remains editable during a run. Queue and stop retain the original service semantics.
  }
  function sync() {
    const u=ui(),a=api();if(!u?.workspacePane||!a?.harness||!window.RamoOverlays)return;
    if(!u.studioInstalled){
      if(!u.studioSessionReady){
        if(!u.studioSessionStarting){u.studioSessionStarting=true;window.RamoConversations.install(a,u);a.initialize().then(()=>{u.studioSessionReady=true;u.showHome(false);sync();}).catch(e=>{u.studioSessionReady=true;sync();u._showSmallStatus(e.message);});}
        return;
      }
      u.studioInstalled=true;document.documentElement.classList.add('oc-studio');installNavigation(u);layout(u);u.apply(true);
      window.RamoStudio={openModels,chatSettings,conversationMenu,voiceSettings,addMenu,navigate,editApiModel,conversations:()=>window.RamoConversations.conversations(a)};
    }
    installHeader(u);installComposer(u);const occupied=u._conversationOccupied(),g=u.lastLayout;
    document.documentElement.style.setProperty('--oc-heading-height',occupied&&u.currentPage==='home'?(innerWidth<=900?'108px':'116px'):'66px');
    const heading=u.workspacePane.querySelector('.oc-studio-heading');heading.style.paddingLeft=occupied&&u.currentPage==='home'?(innerWidth<=900?'144px':'132px'):(innerWidth<=900?'42px':'0px');
    const model=u.workspacePane.querySelector('.oc-model-menu'),profile=u._chatModelProfiles().find(p=>p.name===a.modelName());model.querySelector('span').textContent=profile?.label||a.modelName();
    const title=u.workspacePane.querySelector('.oc-studio-chat-title');title.textContent=u.currentPage==='home'?window.RamoConversations.title(a.harness.chat()):(labels[u.currentPage]||'Ramo');
    const runtime=selectedRuntime(),starting=runtime?.startup?.cancellable,start=u.workspacePane.querySelector('.oc-model-start');start.hidden=!runtime||!!runtime.ready&&!starting;start.textContent=starting?'Cancel startup':'Start model';start.disabled=!!a.session;
    let welcome=document.getElementById('oc-studio-welcome');if(!welcome){welcome=el('div',undefined,'oc-welcome');welcome.id='oc-studio-welcome';welcome.append(el('h1','What are we working on?'),el('p','Ask a question, bring a file, or start some research.'));u.overlayRoot.append(welcome);}
    welcome.hidden=occupied||u.currentPage!=='home'||!!window.ramoDesktop?.pages?.current?.();welcome.style.left=g.rail+'px';welcome.style.width=(innerWidth-g.rail)+'px';welcome.style.top=(g.coreCenterY+g.coreDiameter*.65)+'px';
    u._syncThinkingButton();u._syncNavState();decorateMessages(u);
    const input=u.composer.querySelector('#ramo-command-input-v180');let stop=u.composer.querySelector('.oc-active-stop');
    if(a.session&&input.value.trim()){if(!stop){stop=button('Stop',()=>a.cancel(),null,'oc-shell-button oc-active-stop');u.composer.append(stop);}}else stop?.remove();
    let badge=u.composer.querySelector('.oc-attached-text');if(a.pendingDocument){if(!badge){badge=button('',()=>{busy();a.clearAttachment();},null,'oc-attached-text');u.composer.append(badge);}badge.textContent=a.pendingDocument.name+' · Remove';badge.setAttribute('aria-label','Remove attached file');}else badge?.remove();
    const chat=a.harness.chat(),queue=chat.queuedFollowups||[];let queued=u.composer.querySelector('.oc-queued');
    if(queue.length){if(!queued){queued=button('',()=>{if(input.value.trim()||a.pendingDocument)throw Error('Send or clear your draft before restoring a queued message');const next=chat.queuedFollowups[0];a.harness.write(()=>chat.queuedFollowups.shift());input.value=next.text;a.pendingDocument=next.attachment;u._writeProjectPrompt(next.text);u._resizeComposer();},null,'oc-queued');u.composer.append(queued);}queued.textContent=queue.length+' queued · Restore';
      if(!a.session&&!Number(a.variable('Assistant Active'))&&!Number(a.variable('UI_BUSY'))&&!input.value.trim()&&!a.pendingDocument&&a.engine.trace?.status==='complete'&&!sync.sending){sync.sending=true;const next=queue[0];a.harness.write(()=>chat.queuedFollowups.shift());a.pendingDocument=next.attachment||null;a.askAI({TEXT:next.text}).catch(e=>{a.harness.write(()=>chat.queuedFollowups.unshift(next));u._showSmallStatus(e.message);}).finally(()=>{sync.sending=false;});}
    }else queued?.remove();
    registry().catch(()=>{});
  }
  setInterval(sync,400);
})();
