/* Ramo local harness. Original implementation informed by the supplied reference projects.
 * Pure state/protocol functions: no network, filesystem, model calls or new dependencies. */
(function(root){
 'use strict';
 const copy=x=>JSON.parse(JSON.stringify(x)),uid=()=>Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10);
 const defaults={context:16384,maxTokens:1400,thinkingTokens:4096,maxToolRounds:6,temperature:.4,instructions:'',web:true,skills:true,tools:true,autoSummary:false};
 // Syntax validation only. Non-profile models are additionally checked against the
 // LOCAL installed Ollama inventory by ModelService before inference.
 function allowedModel(name){
  const s=String(name||'');
  if(s.length<1||s.length>180||!/^[a-zA-Z0-9][a-zA-Z0-9._/\-]*(?::[a-zA-Z0-9][a-zA-Z0-9._\-]*)?$/.test(s))return false;
  if(s.includes('//')||s.split('/').some(p=>p==='.'||p==='..'))return false;
  return true;
 }
 function localEndpoint(value){
  try{const u=new URL(value),h=u.hostname;
   if(!/^https?:$/.test(u.protocol)||u.username||u.password||!(h==='localhost'||h==='[::1]'||/^127\./.test(h)||/^10\./.test(h)||/^192\.168\./.test(h)||/^172\.(?:1[6-9]|2\d|3[01])\./.test(h)))throw Error();
   return value;
  }catch{throw Error('Inference requires a local loopback or private LAN endpoint. Existing configuration has been retained.');}
 }
 function validateSettings(raw={}){
  const o={...defaults};
  for(const [key,min,max] of [['context',8192,65536],['maxTokens',128,8192],['thinkingTokens',128,16384],['maxToolRounds',1,24],['temperature',0,2]])if(raw[key]!==undefined){const n=Number(raw[key]);if(!Number.isFinite(n)||n<min||n>max||key!=='temperature'&&!Number.isInteger(n))throw Error('Invalid '+key+' setting');o[key]=n;}
  if(o.maxTokens>o.context/2||o.thinkingTokens>o.context/2)throw Error('Response budget must be at most half the context size.');
  for(const k of ['web','skills','tools','autoSummary'])if(raw[k]!==undefined){if(typeof raw[k]!=='boolean')throw Error('Invalid '+k+' setting');o[k]=raw[k];}
  if(raw.instructions!==undefined){if(typeof raw.instructions!=='string'||raw.instructions.length>4000)throw Error('Instructions must be 4,000 characters or fewer.');o.instructions=raw.instructions;}
  return o;
 }
 const branchFields=['messages','contextSummary','contextSummaryThroughAt','toolRuns','working','researchState','tasks','taskRevision','attempt','savedNotes','pi','contextStartIndex'];
 function snapshot(c){const o={};for(const k of branchFields)if(c[k]!==undefined)o[k]=copy(c[k]);return o;}
 function restore(c,state){for(const k of branchFields)delete c[k];Object.assign(c,copy(state));}
 const eventTime=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):Number.isFinite(Date.parse(value))?Date.parse(value):Date.now();
 function createActivity(index,at=Date.now(),id='turn_'+uid()){return {id,index,at:eventTime(at),done:false,status:'running',steps:[],calls:[],elapsed_ms:0,revision:0};}
 function finishActivity(run,status='complete',at=Date.now()){
  if(!run||run.done)return false;
  run.done=true;run.status=status;run.finished_at=eventTime(at);run.elapsed_ms=Math.max(0,run.finished_at-run.at);
  for(const c of run.calls||[])if(c.status==='running'){c.status=status==='complete'?'done':status==='failed'?'error':status;c.finished_at=run.finished_at;}
  for(const s of run.steps||[])if(s.status==='pending'){s.status=status==='interrupted'?'interrupted':'error';s.completed_at=run.finished_at;}
  run.revision=(run.revision||0)+1;return true;
 }
 function recordActivity(run,e){
  if(!run||run.done||!e)return false;
  const at=eventTime(e.at),str=(v,n)=>String(v||'').slice(0,n);
  if(e.type==='turn_end')return finishActivity(run,e.status,e.at);
  if(e.type==='activity'){
   const kind=str(e.kind||'tool',50);if(kind==='prompt')return false;
   const message=str(e.message,900);
   if(kind==='read'&&e.read_id){let s=run.steps.find(s=>s.read_id===e.read_id);if(!s){s={kind,message,read_id:e.read_id,at:eventTime(e.requested_at||e.at)};run.steps.push(s);}Object.assign(s,{phase:e.phase,status:e.status||'pending',cached:!!e.cached,characters:Number(e.characters)||0,completed_at:e.completed_at,error:str(e.error,180),why:str(e.why,700)});}
   else if(!(kind==='search'&&run.steps.some(s=>s.kind==='search'&&s.message===message&&!s.resultsReceived)))run.steps.push({kind,message,why:str(e.why,700),at});
  }else if(e.type==='search_results'){
   const query=str(e.query,400),pending=run.steps.filter(s=>s.kind==='search'&&!s.resultsReceived);let s=[...pending].reverse().find(s=>s.message===query)||pending.at(-1);
   if(!s){s={kind:'search',message:query,at};run.steps.push(s);}Object.assign(s,{message:query,resultsReceived:true,completed_at:at,provider:str(e.provider,40),cached:!!e.cached,searchStatus:str(e.status,50),searchError:str(e.error,180),sources:(Array.isArray(e.sources)?e.sources:[]).slice(0,12).map(s=>({title:str(s.title||'Source',220),url:str(s.url,1200),snippet:str(s.snippet,520),published:str(s.published,55)}))});
  }else if(e.type?.startsWith('model_')&&e.call_id){
   let c=run.calls.find(c=>c.id===e.call_id);if(!c){c={id:str(e.call_id,120),at,stage:str(e.stage||'model',100),model:str(e.model,180),status:'running',thinking:'',output:'',elapsed_ms:0,thinkingEnabled:e.thinking_enabled!==false};run.calls.push(c);}
   if(e.type==='model_start')c.thinkingEnabled=e.thinking_enabled!==false;
   if(e.type==='model_thinking_chunk'){c.thinkingCharacters=(c.thinkingCharacters||0)+String(e.text||'').length;c.thinking=(c.thinking+String(e.text||'')).slice(-120000);c.thinkingTruncated=c.thinkingCharacters>120000;}
   if(e.type==='model_content_chunk')c.output=(c.output+String(e.text||'')).slice(-12000);
   if(e.type==='model_end'||e.type==='model_error'){c.status=e.type==='model_error'?(e.status==='cancelled'?'interrupted':'error'):'done';c.elapsed_ms=Number(e.elapsed_ms)||0;c.finished_at=at;c.metrics=e.metrics&&typeof e.metrics==='object'?copy(e.metrics):null;}
  }else return false;
  run.hiddenSteps=(run.hiddenSteps||0)+Math.max(0,run.steps.length-50);run.hiddenCalls=(run.hiddenCalls||0)+Math.max(0,run.calls.length-12);run.steps=run.steps.slice(-50);run.calls=run.calls.slice(-12);run.revision=(run.revision||0)+1;return true;
 }
 function activitySnapshot(run,imported=false){
  if(!run)return undefined;
  if(typeof run!=='object'||!Array.isArray(run.calls)||!Array.isArray(run.steps)||run.calls.length>12||run.steps.length>50||JSON.stringify(run).length>1800000)throw Error('Invalid activity record');
  const safe=copy(run);safe.calls=safe.calls.map(c=>({...c,thinking:String(c.thinking||'').slice(-120000),output:'',thinkingEnabled:c.thinkingEnabled}));
  if(imported){safe.imported=true;if(!safe.done)finishActivity(safe,'interrupted');}return safe;
 }
 class Harness{
  constructor(store){this.store=store;}
  chat(){const c=this.store.activeChat();if(!c)throw Error('No active chat');return c;}
  write(fn){const previous=copy(this.store.data);try{const result=fn();if(!this.store.save())throw Error('Storage is full or unavailable. The change was not saved; export a backup before removing data.');return result;}catch(e){this.store.data=previous;const c=this.chat();if(c.working)this.store.data.working=c.working;if(c.researchState)this.store.data.researchState=c.researchState;throw e;}}
  settings(changes){if(changes===undefined)return validateSettings(this.chat().harness||{});const next=validateSettings({...this.settings(),...changes});return this.write(()=>{this.chat().harness=next;return next;});}
  fork(label='Revision',persist=true){
   const action=()=>{
    const c=this.chat();c.branches??=[];c.branchId??='original';
    if(c.branches.length>=20)throw Error('This chat has 20 saved branches. Export it or fork into another chat before revising.');
    const id=c.branchId,old=c.branches.find(b=>b.id===id);
    const entry={id,title:String(label).slice(0,80),at:Date.now(),state:snapshot(c)};
    if(old)Object.assign(old,entry);else c.branches.push(entry);
    c.branchId='branch_'+uid();return id;
   };return persist?this.write(action):action();
  }
  branches(){const c=this.chat();return [...(c.branches||[]).map(({id,title,at})=>({id,title,at})),{id:c.branchId||'original',title:'Current branch',current:true}].filter((b,i,a)=>a.findIndex(x=>x.id===b.id)===i).map(b=>({...b,current:b.id===(c.branchId||'original')}));}
  selectBranch(id){
   if(id===(this.chat().branchId||'original'))return true;
   const target=this.chat().branches?.find(b=>b.id===id);if(!target)throw Error('Unknown saved branch');
   return this.write(()=>{const c=this.chat(),currentId=c.branchId||'original',state=snapshot(c),existing=c.branches.find(b=>b.id===currentId);if(existing)existing.state=state;else{if(c.branches.length>=20)throw Error('Branch storage limit reached. Export this chat first.');c.branches.push({id:currentId,title:'Revised conversation',at:Date.now(),state});}restore(c,target.state);c.branchId=id;this.store.data.working=c.working||{turns:[],entity:'',request:'',shown:[],updated:0};this.store.data.researchState=c.researchState||{active:null,recent:[],turnCounter:0};return true;});
  }
  tasks(items,expected){
   const c=this.chat();if(items===undefined)return {todos:copy(c.tasks||[]),revision:c.taskRevision||0};
   if(expected!==undefined&&expected!==(c.taskRevision||0))throw Error('Task list changed; refresh before saving.');
   if(!Array.isArray(items)||items.length>24)throw Error('Use at most 24 tasks.');
   const seen=new Set(),validated=items.map((t,i)=>{const id=String(t?.id||'task_'+(i+1));if(seen.has(id))throw Error('Duplicate task ID');seen.add(id);if(!/^[a-z0-9_-]{1,64}$/i.test(id)||typeof t?.content!=='string'||!t.content.trim()||t.content.length>500||!['pending','in_progress','completed','cancelled'].includes(t.status))throw Error('Invalid task');return {id,content:t.content.trim(),status:t.status};});
   return this.write(()=>{const chat=this.chat();chat.tasks=validated;chat.taskRevision=(chat.taskRevision||0)+1;return this.tasks();});
  }
  library(){return this.store.data.chats.find(c=>c.id==='main');}
  skills(){return (this.library()?.harnessSkills||[]).map(({name,description})=>({name,description}));}
  skill(name){const s=this.library()?.harnessSkills?.find(s=>s.name===name);if(!s)throw Error('Unknown skill');return copy(s);}
  saveSkill(input){
   if(!input||!/^[a-z0-9][a-z0-9_-]{0,47}$/i.test(input.name))throw Error('Use a short skill name with letters, numbers, underscores or hyphens.');
   if(typeof input.content!=='string'||!input.content.trim()||input.content.length>8000)throw Error('Skill instructions must contain 1–8,000 characters.');
   const skill={name:input.name,description:String(input.description||'').slice(0,200),content:input.content};
   return this.write(()=>{const main=this.library();main.harnessSkills??=[];const i=main.harnessSkills.findIndex(s=>s.name===skill.name);if(i>=0)main.harnessSkills[i]=skill;else{if(main.harnessSkills.length>=30)throw Error('Maximum 30 skills');main.harnessSkills.push(skill);}return skill;});
  }
  deleteSkill(name){return this.write(()=>{const main=this.library();main.harnessSkills=(main.harnessSkills||[]).filter(s=>s.name!==name);});}
  metadata(id,changes){return this.write(()=>{const c=this.store.data.chats.find(c=>c.id===id);if(!c)throw Error('Unknown chat');for(const k of ['pinned','archived'])if(typeof changes[k]==='boolean')c[k]=changes[k];return true;});}
  exportChat(){const c=this.chat();for(const state of [c,...(c.branches||[]).map(b=>b.state)]){if(!Array.isArray(state?.messages)||state.messages.length>50000||state.messages.some(m=>typeof m?.user!=='string'||typeof m?.assistant!=='string'||m.user.length>100000||m.assistant.length>150000))throw Error('JSON export exceeds the supported transcript transfer limits; export separate branches or Markdown transcripts.');}const result=JSON.stringify({format:'ramo-chat',version:1,chat:{title:c.title,messages:c.messages,harness:this.settings(),savedNotes:c.savedNotes||[],tasks:c.tasks||[],attempt:c.attempt||undefined,branches:c.branches||[],branchId:c.branchId||'original'}},null,2);if(result.length>25000000)throw Error('This chat exceeds the 25 MB transfer limit. Export separate branches or Markdown transcripts.');return result;}
  importChat(raw,mediaReady=false){
   if(typeof raw!=='string'||raw.length>25000000)throw Error('Choose an Ramo chat JSON file under 25 MB.');
   const input=JSON.parse(raw),c=input?.chat;
   if((input.format!=='ramo-chat'&&input.format!=='oceanic-chat')||input.version!==1||!c||!Array.isArray(c.messages)||c.messages.length>50000)throw Error('Invalid Ramo chat file');
   if(!mediaReady&&this.store.persistChatImages&&this.store._chatImages?.(input).length)return this.store.persistChatImages(input).then(()=>this.importChat(JSON.stringify(input),true));
   const cleanMessages=rows=>{if(!Array.isArray(rows)||rows.length>50000)throw Error('Invalid branch messages');return rows.map(m=>{if(typeof m?.user!=='string'||typeof m?.assistant!=='string'||m.user.length>100000||m.assistant.length>150000)throw Error('Invalid chat message');const extra={};if(m.activity!==undefined)extra.activity=activitySnapshot(m.activity,true);if(m.attachments!==undefined){if(!Array.isArray(m.attachments)||m.attachments.length>20||m.attachments.some(a=>typeof a?.name!=='string'||typeof a?.content!=='string'||a.content.length>100000))throw Error('Invalid attachment');extra.attachments=m.attachments.map(a=>{if(a.kind!=='images')return {name:a.name.slice(0,200),content:a.content};if(!Array.isArray(a.images)||a.images.length>4||a.images.some(i=>!['image/png','image/jpeg','image/webp'].includes(i?.mimeType)||typeof i.data!=='string'||i.data.length>6*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(i.data)))throw Error('Invalid image attachment');return {kind:'images',name:a.name.slice(0,200),content:'',images:a.images.map(i=>({type:'image',mimeType:i.mimeType,data:i.data,...(i.mediaId?{mediaId:i.mediaId}:{}),name:String(i.name||'image').slice(0,200)}))};});}if(m.toolResults!==undefined){if(!Array.isArray(m.toolResults)||m.toolResults.length>144||JSON.stringify(m.toolResults).length>2000000)throw Error('Invalid tool references');extra.toolResults=copy(m.toolResults).map(t=>({...t,imported:true}));}return {user:m.user,assistant:m.assistant,at:Number(m.at)||Date.now(),status:['complete','partial','failed'].includes(m.status)?m.status:'complete',...extra};});};
   const cleanAttempt=value=>{
    if(value===undefined||value===null)return undefined;
    if(typeof value!=='object'||!['running','interrupted','partial','failed','complete'].includes(value.status)||!Array.isArray(value.calls||[])||(value.calls||[]).length>72||JSON.stringify(value).length>12000000)throw Error('Invalid interrupted attempt');
    const draft=cleanMessages([{user:value.user,assistant:value.partial||'',attachments:value.attachments||[],toolResults:value.toolResults||[]}])[0];
    const calls=(value.calls||[]).map(c=>{if(!c||typeof c.call_id!=='string'||c.call_id.length>120||typeof c.partial!=='string'||c.partial.length>120000)throw Error('Invalid interrupted call');return {...copy(c),status:c.status==='running'?'interrupted':c.status,imported:true};});
    return {status:['running','complete'].includes(value.status)?'interrupted':value.status,user:draft.user,partial:draft.assistant,partial_truncated:!!value.partial_truncated,current_call_id:String(value.current_call_id||'').slice(0,120),calls,attachments:draft.attachments,toolResults:draft.toolResults,error:String(value.error||'').slice(0,500),activity:activitySnapshot(value.activity,true),imported:true};
   };
   const cleanNotes=rows=>{if(!Array.isArray(rows)||rows.length>100)throw Error('Invalid saved notes');return rows.map(n=>{if(typeof n?.content!=='string'||n.content.length>2000||typeof n.quote!=='string'||n.quote.length>16000)throw Error('Invalid saved note');return {id:String(n.id||'note_'+uid()).slice(0,100),content:n.content,quote:n.quote,request:String(n.request||'').slice(0,16000),turn:Number(n.turn)||0,at:Number(n.at)||0};});};
   const messages=cleanMessages(c.messages),savedNotes=cleanNotes(c.savedNotes||[]);
   const cleanTasks=rows=>{if(!Array.isArray(rows)||rows.length>24)throw Error('Invalid imported tasks');const seen=new Set();return rows.map(t=>{if(!t||typeof t.id!=='string'||!/^[a-z0-9_-]{1,64}$/i.test(t.id)||seen.has(t.id)||typeof t.content!=='string'||!t.content.trim()||t.content.length>500||!['pending','in_progress','completed','cancelled'].includes(t.status))throw Error('Invalid imported task');seen.add(t.id);return {id:t.id,content:t.content,status:t.status};});};
   const tasks=cleanTasks(c.tasks||[]),branches=[];const ids=new Set();
   if(c.branches!==undefined&&(!Array.isArray(c.branches)||c.branches.length>20))throw Error('Invalid imported branches');
   const stateFor=(messages,tasks)=>({messages,tasks,taskRevision:0,working:{turns:messages.slice(-6),entity:'',request:'',shown:[],updated:0},researchState:{active:null,recent:[],turnCounter:0}});
   for(const b of c.branches||[]){if(typeof b?.id!=='string'||!/^[a-z0-9_-]{1,80}$/i.test(b.id)||ids.has(b.id)||!b.state)throw Error('Invalid branch ID');ids.add(b.id);branches.push({id:b.id,title:String(b.title||'Imported branch').slice(0,80),at:Number(b.at)||Date.now(),state:{...stateFor(cleanMessages(b.state.messages),cleanTasks(b.state.tasks||[])),savedNotes:cleanNotes(b.state.savedNotes||[]),attempt:cleanAttempt(b.state.attempt)}});}
   const branchId=typeof c.branchId==='string'&&/^[a-z0-9_-]{1,80}$/i.test(c.branchId)?c.branchId:'original';
   const settings=validateSettings(c.harness||{});
   // Import transcript and settings only. Foreign summaries/audits are not treated as trusted execution history.
   return this.write(()=>{if(this.store.data.chats.length>=150)throw Error('Chat storage limit reached');const id='chat_'+uid(),chat={id,title:String(c.title||'Imported chat').slice(0,72),created:Date.now(),harness:settings,...stateFor(messages,tasks),attempt:cleanAttempt(c.attempt),savedNotes,branches,branchId};this.store.data.chats.push(chat);this.store.data.activeChatId=id;this.store.data.working=chat.working;this.store.data.researchState=chat.researchState;return id;});
  }
  recover(){let changed=false;for(const c of this.store.data.chats){if(c.attempt?.status==='running'){c.attempt.status='interrupted';changed=true;}if(c.attempt?.status==='interrupted'){if(finishActivity(c.attempt.activity,'interrupted'))changed=true;for(const call of c.attempt.calls||[])if(call.status==='running'){call.status='interrupted';changed=true;}}}if(changed)this.store.save();}
  attempt(value,chatId){return this.write(()=>{const chat=chatId?this.store.data.chats.find(c=>c.id===chatId):this.chat();if(!chat)throw Error('Unknown attempt conversation');chat.attempt=value?copy(value):null;});}
 }
 function estimate(value){let images=0;const encoded=typeof value==='string'?value:JSON.stringify(value,(key,v)=>{if(key==='images'&&Array.isArray(v)){images+=v.length;return '[image data]';}if(v?.type==='image_url'||v?.type==='image'){images++;return {type:'image',content:'[image data]'};}return v;});return Math.ceil(new TextEncoder().encode(encoded).length/2)+images*3072;}
 function budgetMessages(messages,context,maxTokens,tools=[],currentUser){
  const source=copy(messages),prefix=[],groups=[];let group=null;
  let anchored=false;const anchor=currentUser===undefined?-1:source.map(m=>m.role==='user'&&m.content===currentUser).lastIndexOf(true);
  for(const [index,m] of source.entries()){if(index===anchor)anchored=true;if(!group&&m.role==='system')prefix.push(m);else{if((m.role==='user'&&(!anchored||index===anchor))||!group){group=[];groups.push(group);}group.push(m);}}
  const limit=context-maxTokens-256,toolCost=estimate(tools);let omitted=0;
  const tokens=()=>estimate([...prefix,...groups.flat()])+toolCost;
  while(groups.length>1&&tokens()>limit){omitted+=groups.shift().length;}
  // Fit read-only result excerpts, preserving every call/result pair and source URL.
  // This is a size bound, not a semantic filter. Never trim the user's request.
  let excerpts=0;
  while(tokens()>limit){
   const candidates=[];
   for(const m of groups.flat().filter(m=>m.role==='tool')){
    let data;try{data=JSON.parse(m.content);}catch{continue;}
    const scan=o=>{if(!o||typeof o!=='object')return;for(const [k,v] of Object.entries(o)){if(['content','snippet','text','assistant','user'].includes(k)&&typeof v==='string'&&v.length>256)candidates.push({m,data,o,k,v});else if(v&&typeof v==='object')scan(v);}};scan(data);
   }
   candidates.sort((a,b)=>b.v.length-a.v.length);const c=candidates[0];if(!c)break;
   const remove=Math.max(128,Math.ceil((tokens()-limit)*2)),keep=Math.max(256,c.v.length-remove);
   let start=0;
   const positioned=c.k==='content'&&Number.isFinite(c.o.excerpt_start)&&c.o.excerpt_start>=0;
   if(positioned&&Number.isFinite(c.o.focus_start)&&Number.isFinite(c.o.focus_end)&&c.o.focus_end>c.o.focus_start){
    const relative=c.o.focus_start-c.o.excerpt_start,span=c.o.focus_end-c.o.focus_start;
    if(relative>=0&&relative<c.v.length)start=Math.max(0,Math.min(c.v.length-keep,relative-Math.max(0,Math.floor((keep-span)/2))));
   }
   c.o[c.k]=c.v.slice(start,start+keep);
   if(positioned){
    c.o.excerpt_start+=start;c.o.excerpt_end=c.o.excerpt_start+c.o[c.k].length;
    c.o.next_offset=Number.isFinite(c.o.original_characters)&&c.o.excerpt_end>=c.o.original_characters?null:c.o.excerpt_end;c.o.truncated=true;
    if(Number.isFinite(c.o.focus_start)&&Number.isFinite(c.o.focus_end))c.o.focus_truncated=c.o.focus_start<c.o.excerpt_start||c.o.focus_end>c.o.excerpt_end;
   }
   c.data.context_excerpt=true;c.m.content=JSON.stringify(c.data);excerpts++;
  }
  // Long tool chains can exhaust even the excerpt budget. Drop older complete
  // call/result cycles together; retain the current request and newest results.
  const latest=groups.at(-1)||[];
  while(tokens()>limit){
   const calls=latest.map((m,i)=>m.role==='assistant'&&m.tool_calls?.length?i:-1).filter(i=>i>=0);
   if(calls.length<2)break;
   const start=calls[0],end=calls[1];
   if(latest.slice(start,end).some(m=>m.role==='user'))break;
   omitted+=end-start;latest.splice(start,end-start);
  }
  if(tokens()>limit)throw Error('Current input and tool results are too large for this context. Increase context or shorten the input.');
  return {messages:[...prefix,...groups.flat()],omitted,excerpts,estimatedTokens:tokens(),context,maxTokens};
 }
 class ToolAccumulator{
  constructor(){this.map=new Map();}
  addOpenAI(delta){for(const [i,t] of (delta?.tool_calls||[]).entries()){
   const key=t.index??i;let row=this.map.get(key);
   if(!row){row={id:'',type:'function',function:{name:'',arguments:''}};this.map.set(key,row);}
   if(t.id)row.id=t.id;
   if(t.function?.name)row.function.name+=t.function.name;
   if(typeof t.function?.arguments==='string')row.function.arguments+=t.function.arguments;
   if(t.extra_content){const previous=row.extra_content||{},extra=copy(t.extra_content);row.extra_content={...previous,...extra};if(extra.google)row.extra_content.google={...previous.google,...extra.google};}
  }}
  addOllama(calls){
   // Ollama emits complete calls, not OpenAI argument deltas. Array positions restart
   // per chunk; append them so parallel or repeated calls are never overwritten.
   for(const t of calls||[]){const key='ollama_'+this.map.size;this.map.set(key,copy({id:t.id||'call_'+this.map.size,type:'function',function:{name:t.function?.name||'',arguments:t.function?.arguments??{}}}));}
  }
  calls(){return [...this.map.values()].map((t,i)=>({...t,id:t.id||'call_'+i})).filter(t=>t.function.name);}
 }
 const api={Harness,allowedModel,localEndpoint,validateSettings,budgetMessages,ToolAccumulator,createActivity,recordActivity,finishActivity,activitySnapshot};root.RamoHarnessCore=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
