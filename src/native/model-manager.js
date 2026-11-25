'use strict';
// Ramo Desktop model controller. Fixed executable types only; no shells, no user-defined commands.
// Manager edits are restricted to its trusted window; the project has only configured-profile startup.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');
const { app, dialog, BrowserWindow } = require('electron');
const {contextPlan,inspectMemory}=require('./work/context.cjs');
const {findProjector,findQwenModel,projectorArgs,tunedQwenOptions}=require('./work/vision.cjs');
const {writePreset}=require('./work/llama-preset.cjs');
const {llamaLaunchArgs}=require('./work/llama-args.cjs');

const HOME = os.homedir();
const BONSAI = path.join(process.env.LOCALAPPDATA||path.join(HOME,'AppData','Local'), 'Ramo', 'models', 'bonsai2');
const modelSlug = /^[a-z0-9_.:-]{1,80}$/i;
const allowedQuant = new Set(['f16', 'q8_0', 'q4_0']);
// The control-plane calls to the local model server use their own agent.
// Node's global agent keeps idle sockets alive while the server closes them
// after a few seconds, so a pooled socket can be reused after the server has
// gone away; the request is then written into a dead connection and never
// completes. Short-lived connections cost one local handshake and remove that
// whole failure mode.
const controlAgent = new http.Agent({keepAlive:false,maxSockets:Infinity});
function endProcess(child){
  if(!child||!child.pid)return;
  if(process.platform==='win32')spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',shell:false}).on('error',()=>{});
  else child.kill('SIGTERM');
}
const readText = x => typeof x === 'string' ? x.trim() : '';
const modelStateValue = status => readText(typeof status==='string'?status:status?.value).toLowerCase();
const isModelReadyState = state => !state||['loaded','ready','running'].includes(state);
const clampInt = (n, lo, hi, fallback) => Number.isInteger(Number(n)) && Number(n) >= lo && Number(n) <= hi ? Number(n) : fallback;
const endpoints = port => ({base:`http://127.0.0.1:${port}`, chat:`http://127.0.0.1:${port}/v1/chat/completions`});
function isGGUF(file){let fd;try{fd=fs.openSync(file,'r');const magic=Buffer.alloc(4);return fs.readSync(fd,magic,0,4,0)===4&&magic.toString()==='GGUF';}catch{return false;}finally{if(fd!==undefined)fs.closeSync(fd);}}
function existingQwenBlob(){
  // Read the installed manifest; never download, copy or mutate Ollama's store.
  try{const dir=path.join(HOME,'.ollama','models');const m=JSON.parse(fs.readFileSync(path.join(dir,'manifests','hf.co','ggml-org','Qwen3.6-35B-A3B-GGUF','Q4_K_M'),'utf8'));
    const layer=m.layers.find(l=>l.mediaType==='application/vnd.ollama.image.model');
    if(!/^sha256:[a-f0-9]{64}$/.test(layer?.digest))return '';
    const file=path.join(dir,'blobs',layer.digest.replace(':','-'));return isGGUF(file)?file:'';
  }catch{return '';}
}

function request(port, urlPath, opts={}) {
  return new Promise((resolve, reject) => {
    // These calls reach the local model server on the same address as the
    // model request itself. Node's global agent keeps idle sockets alive, and
    // the server closes them after a few seconds, so a pooled socket can be
    // reused after the server has already gone away: the request is then
    // written into a dead connection and never completes. Each control-plane
    // call gets its own short-lived connection instead.
    const req = http.request({hostname:'127.0.0.1', port, path:urlPath, method:opts.method||'GET', timeout:opts.timeout||1800, signal:opts.signal, agent:controlAgent,
      headers:opts.body?{'Content-Type':'application/json'}:{}}, res => {
      const chunks=[]; let count=0;
      res.on('data', c=>{ count+=c.length; if(count<524288) chunks.push(c); else req.destroy(new Error('Response too large')); });
      res.on('end',()=>{
        let body={}; try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{}
        resolve({status:res.statusCode, body});
      });
    });
    req.on('timeout',()=>req.destroy(new Error('Request timed out')));
    req.on('error',reject);
    if(opts.body)req.write(JSON.stringify(opts.body));
    req.end();
  });
}

class ModelManager {
  constructor(options={}){
    this.configFile = path.join(app.getPath('userData'), 'ramo-models.json');
    this.managed = new Map();
    this.logs = new Map();
    this.custom = {};
    this.overrides = {};
    this.launches = new Map();
    this.startups = new Map();
    this.runtimeContexts = new Map();
    this.startupTimeoutMs = clampInt(options.startupTimeoutMs,1,180000,180000);
    this.pollIntervalMs = clampInt(options.pollIntervalMs,1,5000,750);
    this.load();
  }
  baseProfiles(){
    return {
      ollama:{id:'ollama', title:'Ollama service', kind:'ollama', port:11434,
        exe:path.join(process.env.LOCALAPPDATA||path.join(HOME,'AppData','Local'),'Programs','Ollama','ollama.exe'),
        model:'', description:'Installed Ollama models. Ramo attaches to a running Ollama service rather than replacing it.'},
      bonsai2:{id:'bonsai2',title:'Bonsai2 PTQ1 (PrismML)',kind:'bonsai',port:8080,
        exe:path.join(BONSAI,'bin','cuda','llama-server.exe'),
        modelPath:path.join(BONSAI,'models','bonsai2-gguf','27B','Ternary-Bonsai-2-27B-PTQ1_0.gguf'),
        preset:path.join(BONSAI,'bonsai-models.ini'), model:'bonsai2', context:8192,
        description:'Uses your existing autostart router when present; never stops a server Ramo did not launch.'},
      qwen36:{id:'qwen36',title:'Qwen3.6 35B-A3B CPU-MoE',kind:'llama',port:8081,
        exe:path.join(process.env.LOCALAPPDATA||path.join(HOME,'AppData','Local'),'Ramo','llama.cpp','llama-server.exe'),modelPath:'',model:'qwen3:32b',context:65536,
        gpu:'all',flash:true,cpuMoe:true,kv:'q8_0',threads:12,threadsBatch:12,
        batchSize:8192,ubatchSize:8192,prio:2,prioBatch:2,sleepIdleSeconds:600,
        description:'Optional configurable llama.cpp server for a large local model. Available RAM and VRAM are checked before startup.'}
    };
  }
  load(){
    try{
      const raw=JSON.parse(fs.readFileSync(this.configFile,'utf8'));
      this.overrides=raw.overrides&&typeof raw.overrides==='object'?raw.overrides:{};
      this.custom=raw.custom&&typeof raw.custom==='object'?raw.custom:{};
    }catch{}
    // Upgrade only the old shipped 16K value; retain other deliberate user settings.
    // A tuned preset that names its own context is authoritative and is not upgraded.
    if(this.overrides.qwen36?.context===16384){
      const tuned=tunedQwenOptions(this.overrides.qwen36?.exe||this.baseProfiles().qwen36.exe);
      if(!tuned.context){
        const backup=this.configFile+'.before-context-2.15.3.bak';
        if(!fs.existsSync(backup))fs.copyFileSync(this.configFile,backup);
        this.overrides.qwen36.context=65536;this.save();
      }
    }
  }
  save(){
    fs.mkdirSync(path.dirname(this.configFile), {recursive:true});
    const tmp=this.configFile+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify({version:1,overrides:this.overrides,custom:this.custom},null,2),{mode:0o600});
    fs.renameSync(tmp,this.configFile);
  }
  get(id){
    const defaults=this.baseProfiles();
    const raw=typeof id==='string'&&(Object.hasOwn(defaults,id)?defaults[id]:Object.hasOwn(this.custom,id)?this.custom[id]:null);
    if(!raw)throw new Error('Unknown model profile');
    const o=this.overrides[id]||{};
    // Only specifically configurable fields may be changed.
    const p={...raw,...(id==='qwen36'?tunedQwenOptions(o.exe||raw.exe):{}),...o};
    if(this.runtimeContexts.has(id))p.context=this.runtimeContexts.get(id);
    if(id==='qwen36'&&!p.modelPath)p.modelPath=existingQwenBlob()||findQwenModel();
    if(id==='qwen36'){p.mmprojPath=p.mmprojPath||findProjector(p.modelPath);p.vision=!!p.mmprojPath&&isGGUF(p.mmprojPath);}
    return p;
  }
  profiles(){
    return [...Object.keys(this.baseProfiles()),...Object.keys(this.custom)].map(id=>this.get(id));
  }
  async planContext(id){return contextPlan(this.get(id),await inspectMemory());}
  profileSummary(){
    return this.profiles().map(p=>({id:p.id,title:p.title,model:p.model,kind:p.kind,port:p.port,context:p.context||null,vision:!!p.vision,
      endpoint:p.kind==='ollama'?endpoints(p.port).base:endpoints(p.port).chat}));
  }
  log(id,msg){
    const lines=this.logs.get(id)||[];
    lines.push(`${new Date().toLocaleTimeString()} ${String(msg).slice(0,600)}`);
    if(lines.length>90)lines.splice(0,lines.length-90);
    this.logs.set(id,lines);
  }
  async probe(p){
    try {
      const resp=await request(p.port,p.kind==='ollama'?'/api/version':'/v1/models');
      if(resp.status<500 && resp.status!==404 && resp.status!==401 &&
        (p.kind==='ollama'? !!resp.body.version : Array.isArray(resp.body.data))){
        const aliases=p.kind==='ollama'?[]:resp.body.data.map(m=>m.id);
        const row=p.kind==='ollama'?null:resp.body.data.find(m=>m.id===p.model||(Array.isArray(m.aliases)&&m.aliases.includes(p.model)));
        const matched=p.kind==='ollama'||!!row;
        return {online:true,aliases,ready:matched,context:Number(row?.meta?.n_ctx)||null,modelState:modelStateValue(row?.status),detail:matched?'API responding; alias available':'API responding; configured alias not advertised'};
      }
      return {online:false, occupied:true, detail:`Port ${p.port} answers, but it is not the expected API`};
    }catch(e){
      // Port occupied by an unrelated service may still report request rejection. Start will separately get EADDRINUSE.
      return {online:false,detail:'Not running'};
    }
  }
  async listOllamaModels(port){
    const profile=this.get('ollama'),selectedPort=clampInt(port,1,65535,profile.port);
    try{
      const response=await request(selectedPort,'/api/tags',{timeout:4500});
      if(response.status!==200||!Array.isArray(response.body?.models))throw Error('Ollama did not return a model list');
      const found=new Map();
      for(const m of response.body.models.slice(0,512)){
        const name=readText(m?.name||m?.model);
        if(!name||name.length>180||/[\x00-\x1f\x7f\s]/.test(name))continue;
        if(!found.has(name))found.set(name,{
          name,
          family:readText(m?.details?.family).slice(0,80),
          parameters:readText(m?.details?.parameter_size).slice(0,40),
          quantization:readText(m?.details?.quantization_level).slice(0,40),
          size:Number.isFinite(Number(m?.size))?Math.max(0,Number(m.size)):null
        });
      }
      return {online:true,port:selectedPort,models:[...found.values()].sort((x,y)=>x.name.localeCompare(y.name,undefined,{numeric:true})),error:''};
    }catch(err){
      const detail=readText(err?.message).slice(0,180);
      return {online:false,port:selectedPort,installed:fs.existsSync(profile.exe),models:[],error:'No Ollama API response on 127.0.0.1:'+selectedPort+'. Start Ollama or check its host/port. '+(detail?'('+detail+')':'')};
    }
  }
  async status(){
    return Promise.all(this.profiles().map(async p=>{
      const running=this.managed.get(p.id);
      const probe=await this.probe(p);
      // A fitted launch may have chosen a different context than the profile asks for.
      if(probe.context&&probe.online)this.runtimeContexts.set(p.id,probe.context);
      const active=!!running&&running.exitCode===null&&!running.killed;
      const modelState=readText(probe.modelState).toLowerCase(),ready=!!probe.ready&&(p.kind==='ollama'||isModelReadyState(modelState));
      const unavailable=probe.online&&probe.ready&&!ready;
      const state=probe.online?(probe.ready?(modelState==='loaded'?'Model loaded':unavailable?'Model '+modelState:'API ready'):'Alias mismatch'):active?'Loading':fs.existsSync(p.exe)&&(p.kind==='ollama'||isGGUF(p.modelPath)||fs.existsSync(p.preset||''))?'Installed · stopped':'Needs configuration';
      const detail=unavailable?'Configured alias '+p.model+' reports '+modelState+'. '+(['failed','error'].includes(modelState)?'Inspect server logs in Local Models, then retry Start model.':'Use Start model to load it or wait for loading to finish.'):probe.detail;
      return {id:p.id,title:p.title,kind:p.kind,port:p.port,model:p.model,context:probe.context||p.context||null,gpu:p.gpu||'all',cpuMoe:!!p.cpuMoe,flash:p.flash!==false,kv:p.kv||'q8_0',threads:p.threads||8,preset:p.preset||'',
        startup:this.startups.get(p.id)?.summary||null,
        online:probe.online,occupied:!!probe.occupied,detail,
        ready,modelState,aliases:probe.aliases||[],state,
        ownership:active?'Ramo started':probe.online?'Already running / external':'Not running',
        canStop:active,loaded:modelState==='loaded',canStartServerOnly:(p.kind==='llama'||p.kind==='custom')&&!probe.online,modelPath:p.modelPath||'',exe:p.exe||'',
        description:p.description||'',loaderPath:p.loaderPath||'',logs:(this.logs.get(p.id)||[]).slice(-15),
        endpoint:p.kind==='ollama'?endpoints(p.port).base:endpoints(p.port).chat};
    }));
  }
  async choose(id,type,win){
    const p=this.get(id);
    if(!['exe','modelPath','loaderPath','preset'].includes(type))throw new Error('Unsupported file type');
    if(type==='preset'&&p.kind!=='bonsai')throw new Error('Presets are available for the Bonsai router');
    if(type==='loaderPath'&&p.kind!=='script')throw new Error('Only script profiles can select a loader script');
    if(type!=='loaderPath'&&p.kind==='script')throw new Error('Use Select PowerShell loader for this profile');
    if(type==='exe'&&p.kind==='ollama')throw new Error('Ollama executable is discovered automatically');
    const selected=await dialog.showOpenDialog(win, {title:type==='exe'?'Select local llama-server.exe':type==='loaderPath'?'Select trusted PowerShell loader':'Select GGUF model',
      properties:['openFile'],filters:type==='exe'?[{name:'Windows executable',extensions:['exe']}]:type==='loaderPath'?[{name:'PowerShell',extensions:['ps1']}]:type==='preset'?[{name:'llama.cpp preset',extensions:['ini']}]:[{name:'GGUF',extensions:['gguf']},{name:'All files (existing Ollama blobs)',extensions:['*']}],
      defaultPath:p[type]&&fs.existsSync(p[type])?p[type]:undefined});
    if(selected.canceled||!selected.filePaths?.length)return p[type]||'';
    const file=selected.filePaths[0];
    if(type==='exe' && path.basename(file).toLowerCase()!=='llama-server.exe')throw new Error('Please select llama-server.exe only.');
    if(type==='modelPath' && !isGGUF(file))throw new Error('Please select a valid GGUF model.');
    if(type==='preset'&&path.extname(file).toLowerCase()!=='.ini')throw new Error('Select an .ini preset.');
    if(this.managed.has(id))throw new Error('Stop the Ramo-managed server before changing files');
    if(type==='loaderPath' && path.extname(file).toLowerCase()!=='.ps1')throw new Error('Select a .ps1 script.');
    this.overrides[id]??={}; this.overrides[id][type]=file;
    this.save();return file;
  }
  update(id,values){
    if(!values||typeof values!=='object'||Array.isArray(values))throw new Error('Invalid options');
    const p=this.get(id);
    const changes={};
    if('model' in values){
      if(p.kind==='bonsai')throw new Error('Bonsai alias is fixed by its router preset');
      const model=readText(values.model);
      if(!modelSlug.test(model))throw new Error('Invalid model alias');
      changes.model=model;
    }
    if(p.kind!=='ollama'){
      if('threads' in values){changes.threads=clampInt(values.threads,1,128,NaN);if(!Number.isInteger(changes.threads))throw new Error('Threads must be 1–128');}
      if('context' in values)changes.context=clampInt(values.context,1024,262144,NaN);
      if(!Number.isInteger(changes.context)&&'context' in values)throw new Error('Context must be 1024–262144');
    }
    if(p.kind==='custom'||p.kind==='llama'||p.kind==='script'){
      if('port' in values){changes.port=clampInt(values.port,1025,65535,NaN);if(!Number.isInteger(changes.port))throw new Error('Invalid port');}
      if(p.kind!=='script'&&'cpuMoe' in values)changes.cpuMoe=values.cpuMoe===true;
      if(p.kind!=='script'&&'flash' in values)changes.flash=values.flash===true;
      if(p.kind!=='script'&&'kv' in values){if(!allowedQuant.has(values.kv))throw new Error('Invalid KV format');changes.kv=values.kv;}
      if(p.kind!=='script'&&'gpu' in values){if(!['all','0','99'].includes(String(values.gpu)))throw new Error('Invalid GPU setting');changes.gpu=String(values.gpu);}
    }
    if(this.managed.has(id))throw new Error('Stop the Ramo-managed server before changing its settings');
    const merged={...p,...changes};
    for(const q of this.profiles())if(q.id!==id&&q.port===merged.port)throw new Error('Another profile uses that port');
    this.overrides[id]??={};Object.assign(this.overrides[id],changes);this.runtimeContexts.delete(id);this.save();return this.get(id);
  }
  addCustom(name,port,kind='custom'){
    if(kind!=='custom'&&kind!=='script')throw new Error('Invalid profile type');
    const title=readText(name).slice(0,80);
    if(!title)throw new Error('Enter a name');
    const id='custom_'+Date.now().toString(36);
    const n=clampInt(port,1025,65535,NaN);
    if(!Number.isInteger(n))throw new Error('Invalid port');
    if(this.profiles().some(x=>x.port===n))throw new Error('Port already used by a profile');
    this.custom[id]={id,title,kind,exe:'',modelPath:'',loaderPath:'',model:title.toLowerCase().replace(/[^a-z0-9_.-]/g,'-').slice(0,60),
      port:n,context:8192,gpu:'all',flash:true,cpuMoe:false,kv:'q8_0',
      description:kind==='script'?'User-approved local PowerShell (.ps1) server launcher. Runs with no arguments; the script itself must listen on the configured port.':'Custom GGUF via a selected llama-server.exe. No shell commands.'};
    this.save();return this.get(id);
  }
  removeCustom(id){
    if(!this.custom[id])throw new Error('Only custom profiles can be removed');
    if(this.managed.has(id))throw new Error('Stop the server before removing its profile');
    delete this.custom[id];delete this.overrides[id];this.save();return true;
  }
  async ask(options){
    const win=BrowserWindow.getFocusedWindow();
    const choice=win?await dialog.showMessageBox(win,options):await dialog.showMessageBox(options);
    return choice.response;
  }
  async askAdmission(p,error,memory){
    const ram=(Number(memory&&memory.ramFree||0)/2**30).toFixed(1);
    const vram=Number.isFinite(memory&&memory.freeMiB)?(memory.freeMiB/1024).toFixed(1):'unknown';
    const choice=await this.ask({type:'warning',title:'Not enough free memory for '+p.title,
      message:p.title+' needs more free memory than this machine has available right now.',
      detail:String(error.message||error)+'\n\nAvailable now: '+ram+' GiB system RAM, '+vram+' GiB VRAM.\n\nStart server only: launches llama-server with no weights loaded, so you can test the server and free memory first. The model loads on the first request that names it.\n\nLoad anyway: starts the model now and lets llama.cpp size the layer split and context to the memory that is actually free. It may be slow, and it can fail if the system runs out of memory.',
      buttons:['Cancel','Start server only','Load anyway'],defaultId:0,cancelId:0});
    return choice===1?'server-only':choice===2?'override':'';
  }
  start(id,options={}){
    this.get(id);
    if(this.launches.has(id))return this.launches.get(id);
    const pending=this._startProcess(id,options).finally(()=>{if(this.launches.get(id)===pending)this.launches.delete(id);});
    this.launches.set(id,pending);return pending;
  }
  // Start the server with no weights resident. The model loads on the first request.
  startServerOnly(id,options={}){return this.start(id,{...options,mode:'server-only'});}
  // Start the model even when the advisory RAM/VRAM thresholds are not met.
  // If the server is already up, ask it to load the model instead of respawning it.
  async startWithOverride(id,options={}){
    const p=this.get(id);
    if((await this.probe(p)).online)return this.wake(id);
    return this.start(id,{...options,mode:'override'});
  }
  async _startProcess(id,options={}){
    const p=this.get(id);
    const probe=await this.probe(p);
    if(options.signal?.aborted)throw new Error('Model startup cancelled');
    if(probe.online){this.log(id,'Using existing server on port '+p.port+'; not spawning another.');return {message:'Already running; Ramo will use the existing service.'};}
    if(probe.occupied)throw new Error(`Port ${p.port} is occupied by something else`);
    if(this.managed.has(id))return {message:'Server already launching',started:false};
    let mode=options.mode==='server-only'?'server-only':options.mode==='override'?'override':'';
    let plan=null;
    if(id==='qwen36'){
      const memory=await inspectMemory();let allowUnknownVRAM=false;
      if(mode==='server-only'){
        // The server starts with no weights resident, so no memory admission is required.
        plan={context:Number(p.context)||8192};
        this.log(id,'Starting the server without loading the model. It loads on the first request that names it.');
      } else {
        if(!Number.isFinite(memory.freeMiB)){
          const choice=await this.ask({type:'warning',title:'VRAM reading unavailable',message:'Ramo could not read free NVIDIA VRAM.',detail:'You can retry later or start this model at 32K context anyway. Available VRAM is unverified, so loading may fail if another application is using the GPU. This override applies only to this startup.',buttons:['Cancel','Start at 32K anyway'],defaultId:0,cancelId:0});
          if(choice!==1)throw Error('Startup cancelled because VRAM could not be verified. Retry to choose the 32K override.');
          allowUnknownVRAM=true;
        }
        if(options.signal?.aborted)throw Error('Model startup cancelled');
        try{
          plan=contextPlan(p,memory,{allowUnknownVRAM});
        }catch(error){
          if(mode==='override'){
            plan=contextPlan(p,memory,{allowUnknownVRAM,allowLowMemory:true});
          }else{
            const choice=await this.askAdmission(p,error,memory);
            if(choice==='server-only'){mode='server-only';plan={context:Number(p.context)||8192};}
            else if(choice==='override'){mode='override';plan=contextPlan(p,memory,{allowUnknownVRAM,allowLowMemory:true});}
            else throw Error('Startup cancelled. '+error.message);
          }
        }
        p.context=plan.context;
        if(!plan.fit)this.runtimeContexts.set(id,plan.context);
        if(plan.message)this.log(id,plan.message);
      }
    }
    let exe=p.exe,args=[];
    if(p.kind==='ollama'){
      if(!fs.existsSync(exe))throw new Error('Ollama not detected at '+exe+'. Launch Ollama normally first.');
      args=['serve'];
    } else if(p.kind==='bonsai'){
      if(!fs.existsSync(exe))throw new Error('PrismML llama-server.exe is missing: '+exe);
      if(fs.existsSync(p.preset)){
        args=['--models-preset',p.preset,'--models-max','1','--models-autoload','--host','127.0.0.1','--port',String(p.port)];
      } else {
        if(!fs.existsSync(p.modelPath))throw new Error('Bonsai GGUF missing: '+p.modelPath);
        args=['-m',p.modelPath,'--alias',p.model,'--host','127.0.0.1','--port',String(p.port),'-ngl','99','-fa','on','-c',String(p.context||8192),'-t',String(p.threads||8),'-np','1','--jinja','--sleep-idle-seconds','300'];
      }
    } else if(p.kind==='script'){
      if(!p.loaderPath||!fs.existsSync(p.loaderPath)||path.extname(p.loaderPath).toLowerCase()!=='.ps1')throw new Error('Select an existing .ps1 PowerShell loader first.');
      exe=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
      if(!fs.existsSync(exe))exe='powershell.exe';
      args=['-NoProfile','-ExecutionPolicy','Bypass','-File',p.loaderPath];
    } else {
      if(!exe||!fs.existsSync(exe)||path.basename(exe).toLowerCase()!=='llama-server.exe')throw new Error('Select an existing llama-server.exe for this profile.');
      if(!isGGUF(p.modelPath))throw new Error('Select an existing GGUF file first.');
      if(mode==='server-only'){
        // The router path gets the same fitted launch: no pinned layer count, so
        // llama.cpp sizes the split to the free VRAM with the requested context as the floor.
        const fitted=id==='qwen36'&&mode!=='override'&&String(p.gpu)==='all';
        const preset=writePreset(p,path.join(app.getPath('userData'),'llama-presets'),{loadOnStartup:false,fit:fitted});
        this.log(id,'Router preset (model stays unloaded until the first request): '+preset);
        args=['--models-preset',preset,'--models-max','1','--models-autoload','--host','127.0.0.1','--port',String(p.port)];
      } else {
        // The 35B launch lets llama.cpp size the layer split for the memory that is
        // actually free, with the requested context window pinned, so a busy GPU moves
        // expert layers to RAM instead of silently collapsing on the GPU compute path.
        const {args:launchArgs}=llamaLaunchArgs(p,{id,mode,projector:id==='qwen36'?projectorArgs(p):[]});
        args=launchArgs;
      }
    }
    const child=spawn(exe,args,{cwd:p.kind==='script'?path.dirname(p.loaderPath):path.dirname(exe),windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
    this.managed.set(id,child);
    this.log(id,'Starting '+path.basename(exe)+' on 127.0.0.1:'+p.port+' (PID '+child.pid+')');
    for(const stream of [child.stdout,child.stderr]){
      if(!stream)continue;
      let pending='';
      stream.on('data',buffer=>{
        pending+=buffer.toString('utf8');
        const rows=pending.split(/\r?\n/);pending=rows.pop().slice(-1200);
        for(const row of rows.slice(-30))if(row.trim())this.log(id,row);
      });
    }
    child.on('error',err=>{this.log(id,'Process error: '+err.message);if(this.managed.get(id)===child){this.managed.delete(id);this.runtimeContexts.delete(id);}});
    child.on('exit',(code,signal)=>{this.log(id,`Exited (code ${code}, signal ${signal})`);if(this.managed.get(id)===child){this.managed.delete(id);this.runtimeContexts.delete(id);}});
    return {message:'Started '+p.title+'. Loading may take a while; check status or logs.',pid:child.pid,started:true};
  }
  startSelected(id){
    const p=this.get(id);
    // Ollama deliberately keeps ordinary per-request lazy loading of the selected tag.
    if(p.kind==='ollama')throw new Error('Ollama loads the selected model when you send a message. Use Local Models to start its service.');
    const previous=this.startups.get(id);
    if(previous?.promise)return previous.promise;
    const op={controller:new AbortController(),child:null,summary:{status:'starting',message:'Checking '+p.title+'…',startedAt:Date.now(),cancellable:true}};
    this.startups.set(id,op);
    op.promise=this._startSelected(p,op).finally(()=>{op.promise=null;});
    return op.promise;
  }
  async _startSelected(p,op){
    const id=p.id,deadline=Date.now()+this.startupTimeoutMs,signal=op.controller.signal;
    let started=false,wakeRequested=false;
    try{
      if(!this.managed.has(id)){
        // Joining another manager launch never transfers that process's ownership to this action.
        const joining=this.launches.has(id),result=await this.start(id,{signal});
        started=!joining&&result.started===true;
        if(started)op.child=this.managed.get(id)||null;
      }
      op.summary={...op.summary,status:'waiting',message:'Waiting for alias '+p.model+' on port '+p.port+'…'};
      while(!signal.aborted&&Date.now()<deadline){
        if(op.child&&(op.child.exitCode!==null||op.child.killed||this.managed.get(id)!==op.child))throw Error('Model server exited during startup. Open Local Models and inspect its logs and configured files.');
        try{
          const response=await request(p.port,'/v1/models',{signal,timeout:Math.max(1,Math.min(1800,deadline-Date.now()))});
          if(response.status===200&&Array.isArray(response.body.data)){
            const row=response.body.data.find(m=>m.id===p.model||(Array.isArray(m.aliases)&&m.aliases.includes(p.model)));
            const modelState=modelStateValue(row?.status);
            if(row&&['failed','error'].includes(modelState)){
              const error=Error('Configured model '+p.model+' reports '+modelState+'. Open Local Models and inspect server logs.');error.startupFailure=true;throw error;
            }
            if(row&&['unloaded','sleeping'].includes(modelState)&&!wakeRequested){
              wakeRequested=true;
              op.summary.message='Loading configured model '+p.model+'…';
              const wake=await request(p.port,'/v1/chat/completions',{method:'POST',signal,timeout:Math.max(1,deadline-Date.now()),body:{model:p.model,messages:[{role:'user',content:'Reply READY.'}],stream:false,max_tokens:1,reasoning_effort:'none'}});
              if(wake.status>=400){const error=Error('Model load request returned HTTP '+wake.status+'. Inspect server logs in Local Models.');error.startupFailure=true;throw error;}
              continue;
            }
            if(row&&isModelReadyState(modelState)){
              const live=await this.probe(p);
              if(live.context)this.runtimeContexts.set(id,live.context);
              op.summary={...op.summary,status:'ready',message:p.title+' is ready.',cancellable:false};
              return {id,status:'ready',ready:true,started,owned:!!op.child,message:op.summary.message};
            }
            op.summary.message=row?'API available; waiting for model '+p.model+' to load…':'API available; waiting for configured alias '+p.model+' (advertised: '+response.body.data.map(m=>String(m.id).slice(0,80)).slice(0,8).join(', ')+'). Check the profile alias in Local Models.';
          }else op.summary.message='Waiting for the model API (HTTP '+response.status+'). Check the server logs in Local Models.';
        }catch(error){if(signal.aborted)break;if(error.startupFailure)throw error;op.summary.message=wakeRequested?'Waiting for configured model '+p.model+' to finish loading. Check server logs in Local Models.':'Waiting for the local model API on port '+p.port+'…';}
        await new Promise(resolve=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,this.pollIntervalMs);signal.addEventListener('abort',done,{once:true});if(signal.aborted)done();});
      }
      if(signal.aborted)throw Error('Model startup cancelled');
      throw Error('Startup timed out waiting for alias '+p.model+'. '+op.summary.message+' Open Local Models to inspect executable, GGUF/preset and logs.');
    }catch(error){
      const cancelled=signal.aborted,status=cancelled?'cancelled':'error',message=cancelled?'Model startup cancelled.':String(error.message||error);
      if(op.child&&this.managed.get(id)===op.child){this.managed.delete(id);this.runtimeContexts.delete(id);try{endProcess(op.child);}catch{} }
      op.summary={...op.summary,status,message,cancellable:false,...(!cancelled?{error:message}:{})};
      this.log(id,message);
      return {id,status,ready:false,started,owned:false,message,...(!cancelled?{error:message}:{})};
    }
  }
  cancelSelectedStart(id){
    this.get(id);
    const op=this.startups.get(id);
    if(!op?.promise||!op.summary.cancellable)return {id,status:'idle',cancelled:false,message:'No model startup is pending.'};
    op.controller.abort();
    return {id,status:'cancelled',cancelled:true,message:'Model startup cancellation requested.'};
  }
  async stop(id){
    const child=this.managed.get(id);
    if(!child)throw new Error('This server was started outside Ramo. Ramo will not terminate an external process.');
    this.managed.delete(id);
    this.runtimeContexts.delete(id);
    this.log(id,'Stopping Ramo-owned process '+child.pid);
    try{endProcess(child);}catch(e){throw new Error('Could not stop process: '+e.message);}
    return {message:'Stop requested'};
  }
  async wake(id){
    const p=this.get(id);
    if(!(await this.probe(p)).online)throw new Error('Start the server first.');
    if(p.kind==='ollama'){
      const r=await request(p.port,'/api/generate',{method:'POST',timeout:300000,body:{model:p.model,prompt:'',stream:false,keep_alive:'10m'}});
      if(r.status>=400)throw new Error(`Ollama returned HTTP ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`);
      return {message:'Ollama model loaded: '+p.model};
    }
    if(p.kind==='bonsai'){
      const r=await request(p.port,'/v1/chat/completions',{method:'POST',timeout:300000,body:{model:'bonsai2',messages:[{role:'user',content:'Reply READY.'}],stream:false,max_tokens:48,reasoning_effort:'none'}});
      if(r.status>=400)throw new Error(`Bonsai returned HTTP ${r.status}: ${JSON.stringify(r.body).slice(0,250)}`);
      return {message:'Bonsai2 loaded/responded: '+String(r.body?.choices?.[0]?.message?.content||'OK').slice(0,100)};
    }
    const r=await request(p.port,'/v1/chat/completions',{method:'POST',timeout:300000,body:{model:p.model,messages:[{role:'user',content:'Reply READY.'}],stream:false,max_tokens:48,reasoning_effort:'none'}});
    if(r.status>=400)throw new Error('Model load request returned HTTP '+r.status+': '+JSON.stringify(r.body||{}).slice(0,250));
    return {message:'Model loaded/responded: '+String(r.body?.choices?.[0]?.message?.content||'OK').slice(0,100)};
  }
  terminateAll(){
    for(const op of this.startups.values())if(op.promise)op.controller.abort();
    for(const [id,child] of this.managed){try{endProcess(child);}catch{} this.log(id,'App closed; requested stop');}
    this.managed.clear();
  }
}
module.exports={ModelManager,isGGUF};
