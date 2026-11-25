const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('Work exposes Off/On/Max and uses a larger finite allowance or explicit no-cap generation',()=>{
 const policy=require('../../app/work/generation.cjs');
 assert.equal(policy.OUTPUT_TOKENS,32768);
 for(const [input,expected] of [['off','off'],['on','on'],['medium','on'],['minimal','on'],['high','max'],['xhigh','max'],['max','max']])assert.equal(policy.thinkingMode(input),expected);
 for(const mode of ['off','on']){const body=policy.requestPolicy({max_tokens:32768},mode);assert.equal(body.max_tokens,32768);assert.equal(body.chat_template_kwargs.enable_thinking,mode!=='off');}
 assert.equal(policy.requestPolicy({max_tokens:500},'high').max_tokens,-1);
 assert.equal(policy.requestPolicy({max_tokens:500},'on').max_tokens,500,'Context-aware smaller allowances remain valid');
 assert.equal(policy.piThinking('on'),'medium');
});
test('Live progress counts streamed text/thinking/tool arguments as estimates then replaces them with actual cumulative usage',()=>{
 const {Progress}=require('../../app/work/progress.cjs');const p=new Progress('s');
 const call=p.begin();p.chunk(call,{choices:[{delta:{reasoning_content:'think about code'}}]});assert.equal(p.snapshot().phase,'thinking');assert.ok(p.snapshot().generated>0);assert.equal(p.snapshot().exact,false);
 p.chunk(call,{choices:[{delta:{content:'answer'}}]});assert.equal(p.snapshot().phase,'writing');
 p.chunk(call,{choices:[],usage:{completion_tokens:37,prompt_tokens:200}});p.end(call);assert.equal(p.snapshot().generated,37);assert.equal(p.snapshot().exact,true);
 const second=p.begin();p.chunk(second,{choices:[{delta:{tool_calls:[{function:{arguments:'{"path":"a"}'}}]}}]});assert.ok(p.snapshot().generated>37);
 p.chunk(second,{usage:{completion_tokens:10}});p.end(second);assert.equal(p.snapshot().generated,47);assert.equal(p.snapshot().requests,2);
 const third=p.begin();p.chunk(third,{choices:[{delta:{content:'partial'}}]});p.end(third);assert.equal(p.snapshot().exact,false,'Missing backend usage stays explicitly estimated');
});
test('Native Ollama adapter preserves actual tool calls, thinking, generation options and token totals',()=>{
 const {ollamaPayload,ollamaChunk}=require('../../app/work/ollama.cjs');
 const payload=ollamaPayload({messages:[{role:'assistant',content:'',tool_calls:[{id:'x',type:'function',function:{name:'read',arguments:'{"path":"a.txt"}'}}]},{role:'tool',tool_call_id:'x',content:'data'}],max_tokens:-1,chat_template_kwargs:{enable_thinking:true},tools:[{type:'function',function:{name:'read'}}]}, {model:'qwen3.5:4b',context:32768});
 assert.equal(payload.options.num_predict,-1);assert.equal(payload.options.num_ctx,32768);assert.equal(payload.think,true);assert.deepEqual(payload.messages[0].tool_calls[0].function.arguments,{path:'a.txt'});assert.equal(payload.messages[1].tool_name,'read');
 const state={id:'test',nextTool:0,hasTools:false};const chunk=ollamaChunk({message:{thinking:'reason',tool_calls:[{function:{name:'write',arguments:{path:'a',content:'b'}}}]}},state);assert.equal(chunk.choices[0].delta.reasoning_content,'reason');assert.equal(chunk.choices[0].delta.tool_calls[0].function.arguments,'{"path":"a","content":"b"}');
 const done=ollamaChunk({done:true,prompt_eval_count:30,eval_count:12,done_reason:'stop'},state);assert.equal(done.choices[0].finish_reason,'tool_calls');assert.equal(done.usage.completion_tokens,12);
});
test('Activity core shows real phases, pauses on approvals, labels estimates and exposes a stalled stream',()=>{
 const {mode,view}=require('../../app/work/activity.js');assert.equal(mode('medium'),'on');assert.equal(mode('xhigh'),'max');
 assert.equal(view({phase:'approval',generated:40,exact:true,startedAt:1000},3000).label,'Waiting for you');
 const live=view({phase:'thinking',generated:37,exact:false,startedAt:1000,lastTokenAt:2000},3000);assert.equal(live.tokenLabel,'~37 generated tokens');assert.equal(live.phase,'thinking');
 const stalled=view({phase:'writing',generated:37,startedAt:1000,lastTokenAt:2000},8000);assert.equal(stalled.label,'Waiting for next token');assert.equal(stalled.phase,'processing');
 const final=view({phase:'complete',generated:40,exact:true,startedAt:1000,endedAt:5000},9000);assert.equal(final.elapsed,'4s');assert.equal(final.tokenLabel,'40 generated tokens');
});
test('Terminal session changes clear old totals and approval/error/abort phases remain truthful',()=>{
 const {WorkService}=require('../../app/work/service.cjs');const s=new WorkService({});s.observe({type:'agent_start',sessionId:'a'});s.observe({type:'tool_execution_start',sessionId:'a'});s.observe({type:'ui_request',sessionId:'a'});assert.equal(s.progress.phase,'approval');s.observe({type:'ui_done',sessionId:'a'});assert.equal(s.progress.phase,'tool');
 s.observe({type:'agent_end',sessionId:'a',outcome:'error'});assert.equal(s.progress.phase,'error');s.observe({type:'agent_settled',sessionId:'a'});assert.equal(s.progress.phase,'error');
 s.observe({type:'agent_start',sessionId:'a'});s.observe({type:'agent_end',sessionId:'a',outcome:'aborted'});assert.equal(s.progress.phase,'stopped');
 s.observe({type:'agent_start',sessionId:'a'});s.observe({type:'agent_end',sessionId:'a',outcome:'length'});s.observe({type:'agent_settled',sessionId:'a'});assert.equal(s.progress.phase,'limited');
 s.observe({type:'session_open',sessionId:'b'});assert.equal(s.progress,null);assert.equal(s.ownerSessionId,'b');
 s.observe({type:'agent_start',sessionId:'b'});s.observe({type:'terminal_exit',sessionId:'b',exitCode:1,requested:true});assert.equal(s.progress.phase,'stopped');
 s.observe({type:'agent_start',sessionId:'b'});s.observe({type:'terminal_exit',sessionId:'b',exitCode:1});assert.equal(s.progress.phase,'error');
});
test('Native Ollama streaming handles split frames and propagates cancellation to the actual HTTP connection',async t=>{
 const http=require('node:http'),{ollamaChat}=require('../../app/work/ollama.cjs');let disconnect;
 const closed=new Promise(r=>disconnect=r);const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/x-ndjson'});res.write('{"message":{"content":"par');setTimeout(()=>res.write('tial"},"done":false}\n'),10);res.on('close',disconnect);});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const controller=new AbortController(),chunks=[];const running=ollamaChat({model:'test',context:65536,port:server.address().port},{messages:[],max_tokens:-1},{signal:controller.signal,onChunk:c=>{chunks.push(c);controller.abort();}});await assert.rejects(running,/abort/i);await closed;assert.equal(chunks[0].choices[0].delta.content,'partial');
});
