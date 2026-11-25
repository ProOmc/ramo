'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
test('Actual Pi compacts older turns, emits visible events, preserves the archive and continues',async t=>{
 const {WorkService}=require('../../app/work/service.cjs');const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ramo-compact-')),cwd=path.join(tmp,'project');fs.mkdirSync(cwd);
 const profile={id:'compact-fixture',model:'fixture',label:'Deterministic protocol fixture',context:32768};let calls=0;const events=[];
 const service=new WorkService({appDir:path.resolve('app'),dataDir:path.join(tmp,'data'),models:async()=>[{...profile,context:65536}],chat:async(_model,body,{onChunk})=>{
  calls++;const content=calls===3?'## Goal\nPreserve marker ORIGINAL_TASK_MARKER.\n## Progress\nRead the supplied notes.\n## Next steps\nContinue the task.':'Turn '+calls+' acknowledged.';
  onChunk({choices:[{delta:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:calls===2?25000:500,completion_tokens:50,total_tokens:calls===2?25050:550}});
 }});service.on('event',e=>events.push(e));t.after(async()=>{await service.close();fs.rmSync(tmp,{recursive:true,force:true});});
 await service.request('open',{cwd,trusted:true,profile,thinking:'off'});
 await service.request('prompt',{text:'ORIGINAL_TASK_MARKER '+('old notes here '.repeat(1800))});
 const compacted=await service.request('prompt',{text:'Recent work '+('current notes here '.repeat(1800))});
 assert.ok(events.some(e=>e.type==='auto_compaction_start'),'Real SDK start event reaches host');
 assert.ok(events.some(e=>e.type==='auto_compaction_end'&&!e.errorMessage&&!e.aborted),'Real summary completes');
 assert.ok(compacted.messages.some(m=>m.role==='user'&&JSON.stringify(m.content).includes('ORIGINAL_TASK_MARKER')),'Visible transcript retains the oldest turn after real compaction');
 assert.ok(compacted.contextMessageCount<compacted.messages.length,'Model context is distinct from the complete visible transcript');
 assert.ok(compacted.compaction.count>=1);assert.equal(compacted.compaction.reserveTokens,8192);
 const exported=await service.request('export');const entries=exported.text.trim().split('\n').map(x=>JSON.parse(x));
 assert.ok(entries.some(e=>e.type==='compaction'));assert.ok(exported.text.includes('ORIGINAL_TASK_MARKER'));assert.ok(exported.text.includes('old notes here old notes here'));
 const resumed=await service.request('prompt',{text:'Continue after compacting.'});assert.ok(resumed.messages.some(m=>m.role==='assistant'&&m.content.some(c=>c.text?.includes('acknowledged'))));
 assert.ok(calls>=4,'Session continues through the same real SDK after summarization');
});
