import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {WorkService}=require('../app/work/service.cjs');

/**
 * A local server that speaks the OpenAI-compatible streaming shape.
 *
 * The first request answers with reasoning, streamed text and a capability call
 * whose arguments arrive in three fragments. The second request, which carries
 * the capability result, answers with the final text and the token usage.
 */
function startModelServer(){
  const requests=[];
  const server=http.createServer((req,res)=>{
    let body='';
    req.on('data',chunk=>body+=chunk);
    req.on('end',()=>{
      requests.push(JSON.parse(body));
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
      const send=object=>res.write('data: '+JSON.stringify(object)+'\n\n');
      if(requests.length===1){
        send({choices:[{delta:{role:'assistant',reasoning_content:'The task is to write a file.'}}]});
        send({choices:[{delta:{content:'I will '}}]});
        send({choices:[{delta:{content:'write the file.'}}]});
        send({choices:[{delta:{tool_calls:[{index:0,id:'call_1',type:'function',function:{name:'write',arguments:'{"path":"'}}]}}]});
        send({choices:[{delta:{tool_calls:[{index:0,function:{arguments:'proof.txt",'}}]}}]});
        send({choices:[{delta:{tool_calls:[{index:0,function:{arguments:'"content":"REAL"}'}}]}}]});
        send({choices:[{delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:20,completion_tokens:5,total_tokens:25}});
      }else{
        send({choices:[{delta:{role:'assistant',content:'The file is written.'}}]});
        send({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:31,completion_tokens:9,total_tokens:40}});
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({server,port:server.address().port,requests})));
}

test('The Ramo kernel drives a whole turn from a real OpenAI-compatible server',async t=>{
  const {server,port,requests}=await startModelServer();
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ramo-kernel-')),cwd=path.join(tmp,'project');
  fs.mkdirSync(cwd);
  const model={id:'fixture',model:'fixture',label:'Protocol fixture',context:16384};
  // The service gateway forwards to the model server, so the worker's own
  // transport speaks HTTP and server-sent events for real.
  const service=new WorkService({appDir:path.resolve('app'),dataDir:path.join(tmp,'data'),models:async()=>[model],
    chat:async(_model,body,{onChunk,signal})=>{
      const response=await fetch('http://127.0.0.1:'+port+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
      let buffer='';
      for await(const part of response.body){
        buffer+=Buffer.from(part).toString('utf8');
        let newline=buffer.indexOf('\n');
        while(newline!==-1){
          const line=buffer.slice(0,newline).trim();buffer=buffer.slice(newline+1);newline=buffer.indexOf('\n');
          if(!line.startsWith('data:'))continue;
          const data=line.slice(5).trim();
          if(!data||data==='[DONE]')continue;
          onChunk(JSON.parse(data));
        }
      }
    }});
  const events=[];
  service.on('event',event=>events.push(event));
  t.after(async()=>{await service.close();server.close();fs.rmSync(tmp,{recursive:true,force:true});});

  await service.request('open',{cwd,trusted:true,permission:'full',mode:'project',model:'fixture'});
  const state=await service.request('prompt',{text:'Write proof.txt',model:'fixture'});

  // The capability really ran.
  assert.equal(fs.readFileSync(path.join(cwd,'proof.txt'),'utf8'),'REAL');
  // The request offered the capability, and the second request carried its result.
  assert.equal(requests.length,2);
  assert.ok(requests[0].tools.some(tool=>tool.function.name==='write'),'The kernel declared the write capability');
  assert.ok(requests[1].messages.some(message=>message.role==='tool'&&String(message.content).includes('Successfully wrote to proof.txt')),'The capability result reached the model');
  assert.equal(requests[1].messages.find(message=>message.role==='tool').tool_call_id,'call_1','The result is bound to the call that produced it');
  // The streamed fragments were accumulated into one call with whole arguments.
  const call=state.messages.find(message=>message.role==='assistant'&&message.content.some(block=>block.type==='toolCall'));
  assert.ok(call,'The transcript holds the capability call');
  const block=call.content.find(entry=>entry.type==='toolCall');
  assert.equal(block.name,'write');
  assert.deepEqual(block.arguments,{path:'proof.txt',content:'REAL'});
  // The reasoning and the text were kept apart.
  assert.ok(call.content.some(entry=>entry.type==='thinking'&&entry.thinking.includes('write a file')),'The reasoning was captured');
  assert.ok(call.content.some(entry=>entry.type==='text'&&entry.text==='I will write the file.'),'The streamed text was assembled');
  // The result is in the transcript and the progress reports the backend usage.
  const result=state.messages.find(message=>message.role==='toolResult'&&message.toolName==='write');
  assert.ok(result&&result.isError===false);
  // Both responses reported their usage, so the counter is exact rather than estimated.
  assert.equal(state.progress.exact,true);
  assert.equal(state.progress.generated,14);
  // The last assistant message carries the usage the backend reported.
  const final=state.messages.filter(message=>message.role==='assistant').pop();
  assert.equal(final.usage.totalTokens,40);
  assert.equal(final.usage.input,31);
  assert.equal(final.usage.output,9);
  // The interface saw the streaming events it renders.
  assert.ok(events.some(event=>event.type==='message_update'&&event.assistantMessageEvent.type==='text_delta'),'Text deltas reach the interface');
  assert.ok(events.some(event=>event.type==='tool_execution_start'&&event.toolName==='write'),'Capability start reaches the interface');
  assert.ok(events.some(event=>event.type==='tool_execution_end'&&event.toolName==='write'),'Capability end reaches the interface');
  assert.ok(events.some(event=>event.type==='agent_settled'),'The turn settles');
});
