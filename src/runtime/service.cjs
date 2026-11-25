'use strict';
const {EventEmitter}=require('events');
const {fork,spawn}=require('child_process');
const http=require('http');const fs=require('fs');const path=require('path');const crypto=require('crypto');
const {Progress}=require('./progress.cjs');
const METHODS=new Set(['open','state','sessions','prompt','abort','fork','compact','export','import','resources','reload','rename','uiResponse','terminalStart','terminalStop','terminalInput','terminalResize','settings','installPackage','removePackage','tree','navigateTree','changes','undo_status','undo','palette','background_jobs']);
class WorkService extends EventEmitter {
 constructor({appDir,dataDir,models,chat,search,hostTool,browserTool,readerTool,readerGuard}){super();Object.assign(this,{appDir,dataDir,models,chat,search,hostTool,browserTool,readerTool,readerGuard});this.pending=new Map();this.seq=0;this.token=crypto.randomBytes(32).toString('hex');this.closed=false;this.controllers=new Set();}
 publish(force=false){if(!this.progress)return;const now=Date.now();if(!force&&now-(this.lastProgressAt||0)<80)return;this.lastProgressAt=now;this.emit('event',{type:'work_progress',...this.progress.snapshot()});}
 observe(event){
  if(event.type==='session_open'){this.ownerSessionId=event.sessionId;if(this.progress?.sessionId!==event.sessionId){this.progress=null;this.emit('event',{type:'work_progress',sessionId:event.sessionId,phase:'idle',generated:0,exact:false});}return;}
  if(event.type==='opened'){this.ownerSessionId=event.state.sessionId;if(this.progress?.sessionId!==this.ownerSessionId)this.progress=null;}
  if(['agent_start','manual_start'].includes(event.type)){this.ownerSessionId=event.sessionId;this.progress=new Progress(event.sessionId);this.publish(true);}
  const p=this.progress;if(!p||event.sessionId&&event.sessionId!==p.sessionId)return;
  if(event.type==='terminal_exit'&&!p.endedAt){p.phase=event.requested||event.exitCode===0?'stopped':'error';p.endedAt=Date.now();this.publish(true);return;}
  if(event.type==='ui_request')p.beforeUiPhase=p.phase;
  let phase=({tool_execution_start:'tool',tool_execution_end:'processing',ui_request:'approval',ui_done:p.beforeUiPhase||'processing',auto_compaction_start:'compacting',auto_compaction_end:'processing',agent_settled:'complete',agent_end:'complete',manual_end:'complete',worker_exit:'error'})[event.type];
  if(event.type==='auto_compaction_end'&&(event.errorMessage||event.aborted))phase=event.aborted?'stopped':'error';
  if(['agent_end','manual_end'].includes(event.type)&&['aborted','error','stopped','length'].includes(event.outcome))phase=event.outcome==='length'?'limited':event.outcome==='error'?'error':'stopped';
  if(phase){if(phase!=='complete'||!['error','stopped','limited'].includes(p.phase))p.phase=phase;if(['complete','error','stopped','limited'].includes(phase))p.endedAt=Date.now();this.publish(true);}
  if(event.type==='message_end'&&event.message?.role==='assistant'&&['error','aborted','length'].includes(event.message.stopReason)){p.phase=event.message.stopReason==='length'?'limited':event.message.stopReason==='aborted'?'stopped':'error';p.endedAt=Date.now();this.publish(true);}
 }
 async gateway(){
  if(this.server)return;
  this.server=http.createServer(async(req,res)=>{
   if(req.headers.origin||!/^127\.0\.0\.1:\d+$/.test(String(req.headers.host||''))||req.method!=='POST'||!['/v1/chat/completions','/search','/capability','/activity','/browser','/reader'].includes(req.url)||req.headers.authorization!=='Bearer '+this.token){res.writeHead(403);res.end();return;}
   const controller=new AbortController();this.controllers.add(controller);res.on('close',()=>controller.abort());
   try{
    let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>32*1024*1024)throw Error('Request exceeds 32 MiB');}
    const body=JSON.parse(raw);
    if(req.url==='/activity'){if(!this.terminalMode||!['user_input','session_open','agent_start','agent_end','manual_start','manual_end','tool_execution_start','tool_execution_end','ui_request','ui_done','auto_compaction_start','auto_compaction_end'].includes(body.type))throw Error('Unsupported terminal activity');this.observe(body);this.emit('event',{type:'terminal_activity',activity:body.type,text:body.type==='user_input'?String(body.text||'').slice(0,100000):undefined,sessionId:body.sessionId});res.writeHead(200);res.end('{}');return;}
    if(req.url==='/capability'){const result=await this.hostTool(body.name,body.args);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));return;}
     if(req.url==='/browser'){if(!this.browserTool)throw Error('In-app browser unavailable');const result=await this.browserTool(String(body.tool||''),body.args||{});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));return;}
     if(req.url==='/reader'){if(!this.readerTool)throw Error('Untrusted reader unavailable');let result=await this.readerTool(String(body.mode||'content'),body.args||{});if(this.readerGuard)result=await this.readerGuard.annotate(result);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));return;}
    if(req.url==='/search'){if(!this.search)throw Error('Web search unavailable');const result=await this.search(body);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));return;}
    const configured=(await this.models()).find(m=>m.id===body.model);
    const model=configured?{...configured,context:Math.min(configured.context||16384,this.activeContext||configured.context||16384)}:null;
    if(!model||(!this.terminalMode&&model.id!==this.activeModelId))throw Error('Only the selected Ramo model may run this task');
    if(!this.progress)this.progress=new Progress(this.ownerSessionId);const progress=this.progress,call=progress.begin(body);this.publish(true);
    try{await this.chat(model,body,{signal:controller.signal,onPhase:phase=>{if(this.progress===progress){progress.phase=phase;this.publish(true);}},onChunk:event=>{progress.chunk(call,event);if(this.progress===progress)this.publish(!!event.usage);if(!res.headersSent)res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.write('data: '+JSON.stringify(event)+'\n\n');}});}finally{progress.end(call);if(this.progress===progress)this.publish(true);}
    if(!res.headersSent)res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: [DONE]\n\n');
   }catch(error){if(!res.headersSent){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:error.message}}));}else{res.write('data: '+JSON.stringify({error:{message:error.message}})+'\n\n');res.end();}}
   finally{this.controllers.delete(controller);}
  });
  await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(0,'127.0.0.1',resolve);});
   // The worker reaches the gateway over a loopback connection that stays open
   // between turns. Node's default idle timeout is five seconds, which is
   // shorter than the gap between two model calls, so the gateway would close
   // a connection the worker still considers reusable; the worker then writes
   // its next request into a dead connection and the task hangs. A long idle
   // timeout removes that race.
   this.server.keepAliveTimeout=300000;
   this.server.headersTimeout=310000;
 }
 async start(){
  if(this.closed)throw Error('The session service is closed');if(this.starting)return this.starting;if(this.child)return;
  this.starting=(async()=>{
   await this.gateway();fs.mkdirSync(this.dataDir,{recursive:true});
   const nodePath=path.join(this.appDir,'work/node/node.exe');
   const env={...process.env,PI_CODING_AGENT_DIR:path.join(this.dataDir,'agent'),PI_PACKAGE_DIR:path.join(this.appDir,'work/runtime'),PATH:path.dirname(nodePath)+path.delimiter+(process.env.PATH||'')};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
   const child=fork(path.join(this.appDir,'work/worker.mjs'),[],{execPath:nodePath,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],serialization:'json'});this.child=child;
   let tail='';child.stderr.on('data',chunk=>{tail=(tail+chunk.toString()).slice(-4000);});child.stdout.on('data',()=>{});
   child.on('message',packet=>{
    if(packet.kind==='response'){const p=this.pending.get(packet.id);if(p){this.pending.delete(packet.id);packet.error?p.reject(Error(packet.error)):p.resolve(packet.result);}}
    else if(packet.kind==='hostTool'){Promise.resolve(this.hostTool(packet.name,packet.args)).then(result=>child.connected&&child.send({kind:'hostToolResponse',id:packet.id,result}),error=>child.connected&&child.send({kind:'hostToolResponse',id:packet.id,error:error.message}));}
    else if(packet.kind==='search'){Promise.resolve(this.search?this.search(packet.args):Promise.reject(Error('Web search is unavailable'))).then(result=>child.connected&&child.send({kind:'searchResponse',id:packet.id,result}),error=>child.connected&&child.send({kind:'searchResponse',id:packet.id,error:error.message}));}
    else if(packet.kind==='modelOwner'){this.activeModelId=packet.model;this.activeContext=packet.context;this.activeOutputTokens=packet.outputTokens;}
    else if(packet.kind==='terminalOwner')this.terminalMode=!!packet.active;
    else if(packet.kind==='event'){this.observe(packet.event);this.emit('event',packet.event);}
   });
   child.on('error',error=>this.fail(child,error));
   child.on('exit',(code,signal)=>{this.fail(child,Error('The session runtime exited ('+(signal||code)+')'+(code?': '+tail:'')));this.emit('event',{type:'worker_exit',code,signal});});
   await this.send('init',{dataDir:this.dataDir,baseUrl:'http://127.0.0.1:'+this.server.address().port+'/v1',token:this.token,profiles:await this.models()});
  })().finally(()=>{this.starting=null;});return this.starting;
 }
 fail(child,error){if(this.child!==child)return;this.child=null;this.terminalMode=false;for(const p of this.pending.values())p.reject(error);this.pending.clear();for(const c of this.controllers)c.abort();}
 send(method,params){return new Promise((resolve,reject)=>{const id=++this.seq;this.pending.set(id,{resolve,reject});if(!this.child?.connected){this.pending.delete(id);reject(Error('The session runtime disconnected'));return;}this.child.send({kind:'request',id,method,params},error=>{if(error){this.pending.delete(id);reject(error);}});});}
 async request(method,params={}){
  if(!METHODS.has(method))throw Error('Unsupported session operation');
  if(method==='open'&&(!params.cwd||!fs.statSync(params.cwd).isDirectory()))throw Error('Select an existing project directory');
  await this.start();
  if(method==='terminalStart')params={...params,profiles:await this.models()};
  if(['open','prompt'].includes(method)&&params.model){const model=(await this.models()).find(m=>m.id===params.model);if(!model)throw Error('Choose an available Ramo model');const requested=Number(params.contextWindow||(method==='prompt'&&model.id===this.activeModelId?this.activeContext:undefined)||model.context||16384);const context=Math.min(model.context||16384,Math.max(4096,Number.isFinite(requested)?Math.floor(requested):16384));params={...params,profile:{...model,context,outputTokens:Math.max(128,Math.min(32768,Number(params.generation?.outputTokens||(method==='prompt'?this.activeOutputTokens:undefined)||32768)))}};}
  const result=await this.send(method,params);
  if(result?.sessionId&&['state','open','prompt','abort','terminalStop','settings','fork'].includes(method)){if(method==='abort'&&this.progress?.sessionId===result.sessionId){this.progress.phase='stopped';this.progress.endedAt=Date.now();this.publish(true);}return {...result,progress:this.progress?.sessionId===result.sessionId?this.progress.snapshot():null};}return result;
 }
 async stopWorker(){
  const child=this.child;if(!child)return;
  for(const c of this.controllers)c.abort();
  try{await Promise.race([this.send('shutdown',{}),new Promise(resolve=>setTimeout(resolve,1500))]);}catch{}
  if(child.exitCode===null){await new Promise(resolve=>{const timeout=setTimeout(resolve,3000);child.once('exit',()=>{clearTimeout(timeout);resolve();});if(process.platform==='win32'){const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>{child.kill();});}else child.kill('SIGTERM');});}
 }
 async close(){this.closed=true;await this.stopWorker();if(this.server){const server=this.server;this.server=null;server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}}
}
module.exports={WorkService};

