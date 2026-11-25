import test from'node:test';import assert from'node:assert/strict';import {createRequire}from'node:module';
import {RamoApplication}from'../build/application.js';import {AssistantExtension,StateStore}from'../build/domain.js';
const require=createRequire(import.meta.url),core=require('../src/compat/ramo-harness-core.js');
async function setup(options={}){
 const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};globalThis.window={RamoHarnessCore:core,RamoState:{set(){}}};
 const store=new StateStore(localStorage);let runtime={sessionId:'old',messages:[]},lastOpen;let sequence=0,prompts=0;
 const desktop={work:{onEvent:()=>()=>{},request:async(method,p={})=>{if(method==='models')return [{id:'fast',model:'fast'}];if(method==='assistantHome')return '/assistant';if(method==='state')return runtime;if(method==='open'){lastOpen=p;if(options.beforeOpen)await options.beforeOpen();runtime={sessionId:p.sessionId||'session-'+(++sequence),cwd:p.cwd,mode:p.mode,messages:p.history||[]};return runtime;}if(method==='prompt'){prompts++;runtime.messages.push({role:'user',content:p.text},{role:'assistant',content:'Answer'});return runtime;}throw Error(method);}}};
 const quiet={interrupt(){},resume(){},maybeSchedule(){}};
 // The interface owns the conversation-scoped tools. It no longer declares a
 // memory tool of its own: the worker owns the memory store, so the worker's
 // `memory_recall` and `memory_save` are the only implementations.
 const host={variable:n=>n==='Assistant Model'?'fast':'',setVariable(){},modelName:()=> 'fast',_restoreChatSurface(){},_agentTools:()=>[{function:{name:'session_search',description:'Scoped tool',parameters:{type:'object',properties:{}}}}]};
 const app=new RamoApplication(desktop,()=>({store,retainer:quiet,consolidator:quiet,researchLibrary:{backfill(){}},embedding:{detect:async()=>{}},conversation:{reset(){store.data.working=store._blankWorking();}}}));await app.initialize(host);
 return {app,host,store,get lastOpen(){return lastOpen;},get prompts(){return prompts;},set runtime(value){runtime=value;}};
}
test('selecting another Chat then opening Work opens that owner before any tool can run',async()=>{const f=await setup();const original=f.store.activeChat();original.pi={id:'old',fingerprint:'outdated',evidence:[]};f.store.newChat();const selected=f.store.activeChat();selected.savedNotes=[{content:'B_PRIVATE_NOTE'}];await f.app.request('state');assert.equal(f.store.activeChat().id,selected.id);assert.ok(f.lastOpen.context.includes('B_PRIVATE_NOTE'));await f.app.request('prompt',{text:'Work in B'});assert.equal(selected.messages.at(-1).user,'Work in B');assert.equal(original.messages.length,0);});
test('a new project never inherits saved notes from the previous Chat, and shares the global memory',async()=>{const f=await setup();f.store.activeChat().savedNotes=[{content:'MUST_NOT_LEAK'}];await f.app.request('open',{cwd:'/project-C',model:'fast'});assert.ok(!f.lastOpen.context.includes('MUST_NOT_LEAK'));assert.ok(f.lastOpen.hostTools.some(t=>t.name==='session_search'));// Work and the main conversation share the one global memory store, so a project session is not isolated from it.
 assert.equal(f.lastOpen.memoryIsolation,false);});
test('a separate conversation in Chat is isolated from the personal memory',async()=>{const f=await setup();f.store.newChat();await f.app.request('state');assert.equal(f.lastOpen.memoryIsolation,true);const main=await setup();await main.app.request('state');assert.equal(main.lastOpen.memoryIsolation,false);});
test('the interface no longer declares a memory tool of its own',async()=>{const f=await setup();const extension=new AssistantExtension();extension.harness=new core.Harness(f.store);const names=extension._agentTools({policy:{},turn:{}}).map(tool=>tool.function.name);assert.equal(names.includes('memory_recall'),false,'the interface must not declare memory_recall');assert.equal(names.includes('memory_save'),false,'the interface must not declare memory_save');assert.equal(names.includes('chat_note_save'),true,'the chat-scoped note stays owned by the interface');assert.equal(names.includes('session_search'),true);});
test('a task sent while the project is still opening waits for that session',async()=>{
 // The native Work view sends the first task while the project open is still
 // in flight. The task used to be rejected and lost; it must be delivered to
 // the session that is opening instead.
 let release;const gate=new Promise(r=>{release=r;});
 const f=await setup({beforeOpen:()=>gate});
 const opened=f.app.request('open',{cwd:'/project-D',model:'fast'});
 const prompted=f.app.request('prompt',{text:'First task'});
 await new Promise(r=>setTimeout(r,20));
 assert.equal(f.prompts,0,'the task reached the runtime before the session opened');
 release();await opened;const result=await prompted;
 assert.equal(f.prompts,1);
 assert.equal(result.sessionId,f.lastOpen.sessionId??result.sessionId);
 assert.equal(f.store.activeChat().messages.at(-1).user,'First task');
 assert.equal(f.store.activeChat().messages.at(-1).assistant,'Answer');
});
test('Clear Context starts fresh Pi context and preserves the visible archive',async()=>{const f=await setup();const chat=f.store.activeChat();f.store.appendChatTurn({raw:'OLD_CONTEXT_SECRET'},'Old reply');f.app.clearContext();await f.app.request('state');assert.deepEqual(f.lastOpen.history,[]);await f.app.request('prompt',{text:'New topic'});assert.equal(chat.messages[0].user,'OLD_CONTEXT_SECRET');assert.equal(chat.messages.at(-1).user,'New topic');});

