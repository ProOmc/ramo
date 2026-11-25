'use strict';
const fs=require('fs'),path=require('path'),http=require('http');
const {WorkService}=require('./service.cjs');
const {createBrowserHost}=require('./browser-host.cjs');
const {annotate:annotateInjection}=require('./injection-guard.cjs');
const {ollamaChat}=require('./ollama.cjs');
const {validateImages,hasImages}=require('./vision.cjs');
function localChat(url,payload,{signal,onChunk}){
 return new Promise((resolve,reject)=>{
  const request=http.request(url,{method:'POST',headers:{'Content-Type':'application/json'},signal},response=>{
   let buffer='',errors='';response.setEncoding('utf8');
   response.on('data',chunk=>{if(response.statusCode!==200){errors=(errors+chunk).slice(0,4000);return;}buffer+=chunk;let split;while((split=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,split).trim();buffer=buffer.slice(split+1);if(line.startsWith('data:')&&line.slice(5).trim()!=='[DONE]'){try{onChunk(JSON.parse(line.slice(5)));}catch(error){request.destroy(error);}}}});
   response.on('end',()=>response.statusCode===200?resolve():reject(Error('Local model returned HTTP '+response.statusCode+': '+errors)));response.on('error',reject);
  });request.on('error',reject);request.end(JSON.stringify(payload));
 });
}
function installWork({app,ipcMain,dialog,shell,manager,apiProviders,isProjectSender,getWindow}){
 const dataDir=path.join(app.getPath('userData'),'work'),settingsFile=path.join(dataDir,'projects.json');let service=null,approved=new Map(),searchSequence=0;const searches=new Map();const hostTools=new Map();
 // Step 1 of the agent browser plan: one hidden tab in an isolated persistent
 // session, owned by this process. It is created on first use only.
 let browserHost=null;
 const getBrowserHost=()=>browserHost||(browserHost=(()=>{const host=createBrowserHost({app,userDataDir:path.join(app.getPath('userData'),'agent-browser')});host.onState(state=>{const win=getWindow();if(win&&!win.isDestroyed())win.webContents.send('ramo:browser:state',state);});const win=getWindow();if(win&&!win.isDestroyed())win.webContents.on('did-start-loading',()=>host.hidePane());return host;})());
 // The memory store belongs to the worker. The interface reads the projection
 // the worker writes and sends commands back through the inbox, because the
 // renderer is sandboxed and the worker-to-parent protocol is a fixed
 // boundary. This host only moves files: it never interprets a command and
 // never writes a fact.
 const memoryDir=path.join(dataDir,'memory'),memoryUiFile=path.join(memoryDir,'ui.json'),memoryInbox=path.join(memoryDir,'inbox');
 let memoryWatcher=null;
 const readMemory=()=>{try{return {available:true,reason:'',projection:JSON.parse(fs.readFileSync(memoryUiFile,'utf8'))};}catch(error){return {available:false,reason:error.code==='ENOENT'?'The memory store has not been written yet.':'The memory projection could not be read: '+error.message,projection:null};}};
 const watchMemory=()=>{
  if(memoryWatcher)return;
  try{fs.mkdirSync(memoryDir,{recursive:true});memoryWatcher=fs.watch(memoryDir,(_event,name)=>{if(name&&String(name)!=='ui.json')return;const win=getWindow();if(win&&!win.isDestroyed())win.webContents.send('ramo:memory:changed',{at:Date.now()});});memoryWatcher.on('error',()=>{memoryWatcher?.close();memoryWatcher=null;});}catch{}
 };
 try{approved=new Map(JSON.parse(fs.readFileSync(settingsFile,'utf8')).map(p=>[p.cwd,p]));}catch{}
 const save=()=>{fs.mkdirSync(dataDir,{recursive:true});const tmp=settingsFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify([...approved.values()],null,2));fs.renameSync(tmp,settingsFile);};
 function pickOllamaDefaults(rows,assigned={}){
  const models=(rows||[]).filter(row=>row&&String(row.name||'').trim()).map(row=>({name:String(row.name).trim(),parameters:String(row.parameters||''),size:Number(row.size)||0}));
  const names=models.map(row=>row.name),available=name=>names.includes(name)?name:'';
  const billions=row=>{const match=/(?:^|[^0-9])([0-9]+(?:\.[0-9]+)?)\s*b(?:[^a-z]|$)/i.exec(row.parameters||row.name);return match?Number(match[1]):null;};
  const ranked=[...models].sort((a,b)=>(billions(a)??1e6)-(billions(b)??1e6)||a.size-b.size||a.name.localeCompare(b.name));
  const unused=exclude=>ranked.find(row=>!exclude.includes(row.name))?.name||'';
  const knownFast=available('heretic-4b-vision'),knownSmart=available('heretic-9b-vision');
  const fast=available(assigned.fast)||knownFast||unused([])||'';
  const smart=available(assigned.smart)||knownSmart||unused([fast])||fast;
  const superSmart=available(assigned.superSmart)||[...ranked].reverse().find(row=>![fast,smart].includes(row.name))?.name||smart;
  return {fast,smart,superSmart};
 }
 async function models(){
  const setup=(()=>{try{return apiProviders?.setup?.()||{tiers:{},ollamaPort:11434};}catch{return {tiers:{},ollamaPort:11434};}})();
  const port=setup.ollamaPort||manager.get('ollama').port,installed=await manager.listOllamaModels(port).catch(()=>({models:[]}));
  const tiers=pickOllamaDefaults(installed.models||[],setup.tiers||{});
  const configuredSuper=manager.profileSummary().find(p=>p.id==='qwen36');
  if(configuredSuper){try{const live=await manager.probe(manager.get('qwen36'));if(live.context)configuredSuper.context=live.context;}catch{/* An optional configured server must not hide other models. */}}
  const apiProfiles=(()=>{try{return (apiProviders?.list?.()||[]).filter(p=>p&&p.id).map(p=>({id:'api:'+p.id,model:p.id,label:p.label||p.name||p.id,kind:'api',profileId:p.id,context:32768,vision:false,memoryTier:'standard'}));}catch{return [];}})();
  const rows=[];
  for(const [tier,label,memoryTier] of [['fast','Fast','fast'],['smart','Smart','standard'],['superSmart','Super Smart','deep']]){
   const assigned=String(setup.tiers?.[tier]||''),api=apiProfiles.find(profile=>profile.id===assigned);
   if(api)rows.push({...api,label,memoryTier,tier});
   else if(tiers[tier])rows.push({id:'ollama:'+tiers[tier],model:tiers[tier],label,kind:'ollama',context:memoryTier==='deep'?65536:32768,port,vision:/vision|vl|llava/i.test(tiers[tier]),memoryTier,tier});
  }
  const selected=new Set(rows.filter(row=>row.kind==='ollama').map(row=>row.model)),tierApis=new Set(rows.filter(row=>row.kind==='api').map(row=>row.id));
  const extraOllama=(installed.models||[]).filter(row=>!selected.has(row.name)).map(row=>({id:'ollama:'+row.name,model:row.name,label:row.name,kind:'ollama',context:16384,port,vision:/vision|vl|llava/i.test(row.name),memoryTier:'standard'}));
  const extraProfiles=manager.profileSummary().filter(p=>!['ollama'].includes(p.id)).map(p=>({...p,label:p.title||p.model,context:p.context||16384,memoryTier:p.id==='qwen36'?'deep':'standard'}));
  return [...rows,...extraOllama,...extraProfiles,...apiProfiles.filter(profile=>!tierApis.has(profile.id))];
 }
 function getService(){if(service)return service;
  service=new WorkService({appDir:path.dirname(__dirname),dataDir,models,hostTool:(name,args)=>new Promise((resolve,reject)=>{const id='tool-'+(++searchSequence);const timer=setTimeout(()=>{hostTools.delete(id);reject(Error('Capability timed out'));},90000);hostTools.set(id,{resolve,reject,timer});getWindow()?.webContents.send('ramo:work:event',{type:'host_tool_request',id,name,args});}),chat:async(model,body,options)=>{
   if(model.kind==='api'){const payload={...body};delete payload.chat_template_kwargs;return apiProviders.chat(model.profileId,payload,options);}
   const startId=model.kind==='ollama'?'ollama':model.id,startProfile=model.kind==='ollama'?{...manager.get(startId),port:model.port}:manager.get(startId);
   const status=await manager.probe(startProfile);
   if(!status.ready){options.onPhase?.('loading');getWindow()?.webContents.send('ramo:work:event',{type:'notification',message:'Starting '+model.label+'…'});if(model.kind==='ollama'){await manager.start(startId,{signal:options.signal});const deadline=Date.now()+60000;while(!(await manager.probe(startProfile)).ready){if(options.signal.aborted)throw Error('Task stopped');if(Date.now()>deadline)throw Error('Ollama service startup timed out');await new Promise(r=>setTimeout(r,300));}}else{const cancel=()=>manager.cancelSelectedStart(startId);options.signal.addEventListener('abort',cancel,{once:true});let result;try{result=await manager.startSelected(startId);}finally{options.signal.removeEventListener('abort',cancel);}if(!result.ready)throw Error(result.message||'Model startup failed');}}
   if(options.signal.aborted)throw Error('Task stopped');
   if(model.kind!=='ollama'){const live=await manager.probe(startProfile);if(live.context&&model.context>live.context)throw Error('The running model has '+live.context+' context tokens. Reopen this session to use its actual limit.');}
   options.onPhase?.('processing');
   if(model.kind==='ollama')return ollamaChat(model,body,options);
   if(hasImages(body)){const props=await fetch('http://127.0.0.1:'+model.port+'/props',{signal:options.signal}).then(r=>r.json());if(!props.modalities?.vision&&!props.multimodal?.vision)throw Error('This local model server is running without vision. Restart it with a compatible projector, or choose a vision-capable model.');}
   const payload={...body,model:model.model,stream:true,stream_options:{include_usage:true}};
   delete payload.ramo_work_mode;
   return localChat('http://127.0.0.1:'+model.port+'/v1/chat/completions',payload,options);
  },browserTool:(tool,args)=>getBrowserHost().runTool(tool,args),readerTool:(mode,args)=>getBrowserHost().internal.extract(String(mode||'content'),args||{}),readerGuard:{annotate:annotateInjection},search:args=>new Promise((resolve,reject)=>{const id='web-'+(++searchSequence);const timer=setTimeout(()=>{searches.delete(id);reject(Error('Web search timed out'));},60000);searches.set(id,{resolve,reject,timer});getWindow()?.webContents.send('ramo:work:event',{type:'search_request',id,args});})});
  service.on('event',event=>{const win=getWindow();if(win&&!win.isDestroyed())win.webContents.send('ramo:work:event',event);});return service;
 }
 ipcMain.handle('ramo:memory:read',async(event)=>{
  if(!isProjectSender(event))throw Error('Not authorized');
  watchMemory();
  // The memory tab has to fill on a restart, so the worker that owns the
  // store is started as soon as the projection is read rather than when the
  // first conversation happens. The start is idempotent, and a worker that
  // fails to start still leaves the projection already on disk readable.
  try{await getService().start();}catch{}
  return readMemory();
 });
 ipcMain.handle('ramo:memory:command',async(event,command={})=>{
  if(!isProjectSender(event))throw Error('Not authorized');
  const action=String(command.action||'');
  if(!['edit-fact','add-fact','forget-fact','write-hot','dream','revert-dream','search'].includes(action))throw Error('Unsupported memory command.');
  const id=String(command.id||('cmd_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8)));
  fs.mkdirSync(memoryInbox,{recursive:true});
  const target=path.join(memoryInbox,id+'.json'),temporary=target+'.'+process.pid+'.tmp';
  fs.writeFileSync(temporary,JSON.stringify({...command,id})+'\n','utf8');
  fs.renameSync(temporary,target);
  return {id};
 });
 ipcMain.handle('ramo:work:request',async(event,method,params={})=>{
  if(!isProjectSender(event))throw Error('Not authorized');
  if(method==='assistantHome'){const cwd=path.join(dataDir,'assistant');fs.mkdirSync(cwd,{recursive:true});return cwd;}
  if(method==='hostToolResponse'){const item=hostTools.get(params.id);if(item){clearTimeout(item.timer);hostTools.delete(params.id);params.error?item.reject(Error(params.error)):item.resolve(params.result);}return true;}
  if(method==='prompt'&&params.images)params={...params,images:validateImages(params.images)};
  if(method==='models')return models();if(method==='projects')return [...approved.values()];
  if(method==='chooseProject'){
   const result=await dialog.showOpenDialog(getWindow(),{title:'Choose a project for Ramo',properties:['openDirectory','createDirectory']});if(result.canceled)return null;
   const cwd=fs.realpathSync(result.filePaths[0]);
   if(!approved.has(cwd)){const choice=await dialog.showMessageBox(getWindow(),{type:'question',title:'Trust this project?',message:'Allow Ramo to work in '+cwd+'?',detail:'Project instructions and extensions may execute code. Commands run with your Windows account permissions; this folder is not a sandbox. You can require approval for each command or file change.',buttons:['Trust project','Cancel'],defaultId:1,cancelId:1});if(choice.response!==0)return null;approved.set(cwd,{cwd,name:path.basename(cwd),trusted:true,permission:'ask'});save();}
   return approved.get(cwd);
  }
  if(method==='open'){
   // The unified Chat surface can write files and run commands, so its own
   // folder asks for approval before anything changes, exactly like a
   // trusted project does. A project keeps the permission the user gave it.
   const cwd=fs.realpathSync(params.cwd);const assistant=params.mode==='assistant'&&cwd===path.join(dataDir,'assistant');const project=assistant?null:approved.get(cwd);if(!assistant&&!project)throw Error('Choose and trust this project first');
   const permission=assistant?(['read','ask','full'].includes(String(params.permission))?String(params.permission):'ask'):project.permission;
   return getService().request('open',{...params,cwd,trusted:true,permission});
  }
  if(method==='settings'&&params.permission){if(!['read','ask','full'].includes(params.permission))throw Error('Invalid permission');const state=await getService().request('settings',params);const project=approved.get(state.cwd);if(project){project.permission=state.permission;save();}return state;}
  if(method==='showFolder'){const state=await getService().request('state');if(state.cwd)await shell.openPath(state.cwd);return true;}
  if(method==='exportFile'){
   const result=await getService().request('export',params);if(result.path){await shell.openPath(result.path);return result.path;}
   const dest=await dialog.showSaveDialog(getWindow(),{defaultPath:result.name,filters:[{name:'Ramo session',extensions:['jsonl']}]});if(dest.canceled)return null;fs.writeFileSync(dest.filePath,result.text);return dest.filePath;
  }
  if(method==='importFile'){const result=await dialog.showOpenDialog(getWindow(),{filters:[{name:'Ramo session',extensions:['jsonl']}],properties:['openFile']});if(result.canceled)return null;const file=result.filePaths[0];if(fs.statSync(file).size>32*1024*1024)throw Error('Session exceeds 32 MiB');return getService().request('import',{text:fs.readFileSync(file,'utf8')});}
  if(method==='searchResponse'){const item=searches.get(params.id);if(item){clearTimeout(item.timer);searches.delete(params.id);params.error?item.reject(Error(params.error)):item.resolve(params.result);}return true;}
  return getService().request(method,params);
 });
 let quitting=false;
  // The in-app browser is driven only by main. The renderer never reaches CDP.
 ipcMain.handle('ramo:browser:tool',async(event,tool,args={})=>{if(!isProjectSender(event))throw Error('Not authorized');return getBrowserHost().runTool(String(tool||''),args);});
 ipcMain.handle('ramo:browser:metrics',async(event)=>{if(!isProjectSender(event))throw Error('Not authorized');return browserHost?browserHost.metrics():{rendererPid:null,rendererWorkingSetMb:null};});
 // The visible pane mounts the embedded BrowserView in the app window. Its
 // bounds are content-relative, exactly like the renderer's viewport rect.
 ipcMain.handle('ramo:browser:pane-open',async(event,bounds={})=>{if(!isProjectSender(event))throw Error('Not authorized');return getBrowserHost().showPane(bounds,getWindow());});
 ipcMain.handle('ramo:browser:pane-close',async(event)=>{if(!isProjectSender(event))throw Error('Not authorized');return browserHost?browserHost.hidePane():{visible:false};});
 ipcMain.handle('ramo:browser:pane-bounds',async(event,bounds={})=>{if(!isProjectSender(event))throw Error('Not authorized');return browserHost?browserHost.setPaneBounds(bounds):{visible:false};});
 ipcMain.handle('ramo:browser:take-control',async(event)=>{if(!isProjectSender(event))throw Error('Not authorized');return getBrowserHost().setControlMode('user');});
 ipcMain.handle('ramo:browser:resume',async(event)=>{if(!isProjectSender(event))throw Error('Not authorized');return getBrowserHost().setControlMode('agent');});
 ipcMain.handle('ramo:browser:state',async(event)=>{if(!isProjectSender(event))throw Error('Not authorized');return browserHost?browserHost.paneState():{url:'',title:'Ramo browser',loading:false,visible:false,controlMode:'agent'};});
 app.on('before-quit',async()=>{if(browserHost){try{await browserHost.close();}catch{}browserHost=null;}});
 app.on('before-quit',event=>{if(service&&!quitting){event.preventDefault();quitting=true;service.close().finally(()=>app.quit());}});
 return {models,getService};
}
module.exports={installWork,localChat};
