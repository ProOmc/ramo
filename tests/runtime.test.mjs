import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire}from'node:module';
const require=createRequire(import.meta.url),app=path.resolve('app');
fs.mkdirSync(path.resolve('evidence'),{recursive:true});
const {WorkService}=require('../app/work/service.cjs');
function fixture(t,chat,hostTool=async()=>({ok:true})){
 const tmp=fs.mkdtempSync(path.resolve('evidence/runtime-')),cwd=path.join(tmp,'project');fs.mkdirSync(cwd);
 const model={id:'fixture',model:'fixture',label:'Protocol fixture',context:16384,vision:true};
 const service=new WorkService({appDir:app,dataDir:path.join(tmp,'data'),models:async()=>[model],chat,hostTool});
 t.after(async()=>{await service.close();});return {service,cwd,tmp};
}
const done=onChunk=>onChunk({choices:[{delta:{role:'assistant',content:'Confirmed.'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:2,total_tokens:22}});
// The unified surface offers one capability set in Chat and in Work: the
// files, the search, the shell and the memory. The model decides when a turn
// needs one of them, so the tools are declared in every conversation. An
// isolated conversation keeps the memory out, and nothing else.
const WORK_TOOLS=['read','write','edit','ls','find','grep','powershell','codemode'];
const MEMORY_TOOLS=['memory_recall','memory_save','memory_note_list','memory_note_read','memory_forget','memory_dream','memory_dreams'];
const unified=tools=>{const names=new Set(tools);for(const name of [...WORK_TOOLS,...MEMORY_TOOLS])assert.ok(names.has(name),`the unified surface offers ${name}`);};
const noMemory=tools=>assert.deepEqual(tools.filter(name=>name.startsWith('memory_')),[],'an isolated conversation has no memory capability');
const answered=state=>{const last=state.messages.filter(m=>m.role==='assistant').at(-1);assert.equal(last?.stopReason,'stop',`the turn failed: ${last?.errorMessage||'no answer'}`);};
test('assistant restores actual Pi history, retains images and runs host tools in the same loop',async t=>{
 let call=0,hostCalls=0;
 const {service,cwd}=fixture(t,async(_model,body,{onChunk})=>{
  call++;assert.ok(body.messages.some(m=>JSON.stringify(m.content).includes('old preference')));
  assert.ok(JSON.stringify(body.messages).includes('data:image/png;base64,'));
  // Lazy discovery: memory_recall is indexed in the prompt, not declared with
  // its full schema; the first call returns the schema for a retry.
  assert.ok(String(body.messages[0].content).includes('memory_recall'),'the tiny index lists memory_recall');
  assert.ok(body.tools.some(t=>t.function.name==='powershell'),'the unified Chat offers the shell as well');
  if(call===1){onChunk({choices:[{delta:{role:'assistant',tool_calls:[{index:0,id:'memory1',type:'function',function:{name:'memory_recall',arguments:'{"query":"preference"}'}}]},finish_reason:'tool_calls'}]});}
  else if(call===2){assert.ok(body.messages.some(m=>m.role==='tool'&&String(m.content).includes('Schema:')));onChunk({choices:[{delta:{role:'assistant',tool_calls:[{index:0,id:'memory2',type:'function',function:{name:'memory_recall',arguments:'{"query":"preference"}'}}]},finish_reason:'tool_calls'}]});}
  else{assert.ok(body.messages.some(m=>m.role==='tool'&&String(m.content).includes('real host result')));done(onChunk);}
 },async(name,args)=>{hostCalls++;assert.equal(name,'memory_recall');assert.equal(args.query,'preference');return {content:'real host result'};});
 const state=await service.request('open',{cwd,trusted:true,permission:'read',mode:'assistant',model:'fixture',history:[{role:'user',content:'old preference',images:[{type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'}]},{role:'assistant',content:'Remembered.'}],hostTools:[{name:'memory_recall',description:'Read memory',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}}]});
 assert.equal(state.messages.length,2);
 const result=await service.request('prompt',{text:'Recall it',model:'fixture'});assert.equal(hostCalls,1);assert.equal(call,3);assert.ok(result.messages.some(m=>m.role==='toolResult'&&m.toolName==='memory_recall'));
 const forked=await service.request('fork');assert.equal(forked.mode,'assistant');assert.ok((await service.request('resources')).activeTools.includes('memory_recall'));
 await service.stopWorker();const restored=await service.request('open',{cwd,trusted:true,mode:'assistant',permission:'read',model:'fixture',sessionId:state.sessionId});assert.equal(restored.messages.length,result.messages.length);
 const branched=await service.request('fork');assert.notEqual(branched.sessionId,state.sessionId);assert.equal(branched.mode,'assistant');unified((await service.request('resources')).activeTools);
 await assert.rejects(()=>service.request('terminalStart'),/terminal view was removed/i);
});
test('the assistant surface reads no project instructions and cannot write files without permission',async t=>{
 const {service,cwd}=fixture(t,async(_model,body,{onChunk})=>{assert.ok(!JSON.stringify(body).includes('HOSTILE_CONTEXT_MARKER'));assert.ok(body.tools.some(t=>t.function.name==='powershell'),'the unified Chat offers the shell');assert.ok(String(body.messages[0].content).includes('# Memory'),'the memory section reaches the model');done(onChunk);});
 fs.writeFileSync(path.join(cwd,'AGENTS.md'),'HOSTILE_CONTEXT_MARKER');
 fs.mkdirSync(path.join(cwd,'.pi/extensions'),{recursive:true});fs.writeFileSync(path.join(cwd,'.pi/extensions/evil.js'),`require('fs').writeFileSync(${JSON.stringify(path.join(cwd,'executed.txt'))},'bad')`);
 await service.request('open',{cwd,trusted:true,mode:'assistant',permission:'read',model:'fixture',hostTools:[]});
 const state=await service.request('prompt',{text:'hello',model:'fixture'});answered(state);assert.equal(fs.existsSync(path.join(cwd,'executed.txt')),false);
 const resources=await service.request('resources');unified(resources.activeTools);
});
test('project uses real Pi file and PowerShell tools and survives mode changes',async t=>{
 let calls=0;const {service,cwd}=fixture(t,async(_model,body,{onChunk})=>{
  const steps=[['write',{path:'proof.txt',content:'REAL_FILE'}],['powershell',{command:'Get-Content proof.txt'}]];
  if(calls<steps.length){const [name,args]=steps[calls++];onChunk({choices:[{delta:{role:'assistant',tool_calls:[{index:0,id:'t'+calls,type:'function',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}]});}else done(onChunk);
 });
 const project=await service.request('open',{cwd,trusted:true,permission:'full',mode:'project',model:'fixture'});
 const result=await service.request('prompt',{text:'Write and read',model:'fixture'});assert.equal(fs.readFileSync(path.join(cwd,'proof.txt'),'utf8'),'REAL_FILE');assert.ok(result.messages.some(m=>m.role==='toolResult'&&m.toolName==='powershell'&&!m.isError&&JSON.stringify(m).includes('REAL_FILE')));
 await service.request('open',{cwd,trusted:true,mode:'assistant',permission:'read',model:'fixture'});
 const restored=await service.request('open',{cwd,trusted:true,permission:'full',mode:'project',model:'fixture',sessionId:project.sessionId});assert.equal(restored.messages.length,result.messages.length);
});
test('configured session context is bounded and shared by Pi and the native gateway',async t=>{const {service,cwd}=fixture(t,async(model,_body,{onChunk})=>{assert.equal(model.context,8192);assert.equal(_body.max_tokens,512);assert.equal(_body.temperature,0.2);done(onChunk);});const state=await service.request('open',{cwd,trusted:true,mode:'assistant',model:'fixture',contextWindow:8192,generation:{outputTokens:512,temperature:0.2}});assert.equal(state.generation.contextWindow,8192);const result=await service.request('prompt',{text:'context',model:'fixture'});assert.equal(result.generation.contextWindow,8192);});

