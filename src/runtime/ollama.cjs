'use strict';
const http=require('http'),crypto=require('crypto');
// The model request gets its own connection.
//
// The desktop process reaches the same local server for its control plane
// (the model list and the service probe), and those calls use Node's global
// agent, whose keep-alive pool can still hold a socket that the server has
// already closed. A request written to such a socket never reaches the server
// and never fails either: it is silently discarded, and the task hangs until
// the gateway gives up. A fresh connection per model request removes that
// failure mode completely, at the cost of one local handshake.
const modelAgent=new http.Agent({keepAlive:false,maxSockets:Infinity});
// How long the local model may take to start answering.
//
// A cold model loads its weights before the first token, so the bound is
// generous. It covers the response headers only: once the model starts
// answering, the stream is never cut off, because a long answer is normal.
const HEADERS_TIMEOUT_MS=120000;
function ollamaPayload(body,model){const names=new Map();const messages=(body.messages||[]).map(m=>{
 const out={role:m.role==='developer'?'system':m.role,content:typeof m.content==='string'?m.content:''};
 if(Array.isArray(m.content)){out.content=m.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');const images=m.content.filter(c=>c.type==='image_url').map(c=>{const match=/^data:image\/[^;]+;base64,(.+)$/s.exec(c.image_url?.url||'');if(!match)throw Error('Work images must be attached as local image data');return match[1];});if(images.length)out.images=images;}
 if(m.reasoning_content)out.thinking=m.reasoning_content;
 if(m.tool_calls){out.tool_calls=m.tool_calls.map(t=>{names.set(t.id,t.function.name);return {function:{name:t.function.name,arguments:typeof t.function.arguments==='string'?JSON.parse(t.function.arguments||'{}'):t.function.arguments}};});}
 if(m.role==='tool')out.tool_name=names.get(m.tool_call_id)||m.name||'';return out;
 });return {model:model.model,messages,tools:body.tools,stream:true,think:!!body.chat_template_kwargs?.enable_thinking,options:{num_ctx:model.context||32768,num_predict:body.max_tokens??32768,...(Number.isFinite(body.temperature)?{temperature:body.temperature}:{}),...(Number.isFinite(body.top_p)?{top_p:body.top_p}:{})}};
}
function ollamaChunk(packet,state){if(packet.error)throw Error(packet.error);const delta={};if(packet.message?.content)delta.content=packet.message.content;if(packet.message?.thinking)delta.reasoning_content=packet.message.thinking;
 if(packet.message?.tool_calls?.length){state.hasTools=true;delta.tool_calls=packet.message.tool_calls.map(t=>{const index=state.nextTool++;return {index,id:'call_'+state.id+'_'+index,type:'function',function:{name:t.function.name,arguments:JSON.stringify(t.function.arguments||{})}};});}
 return {id:state.id,choices:[{index:0,delta,finish_reason:packet.done?(packet.done_reason==='length'?'length':state.hasTools?'tool_calls':'stop'):null}],...(packet.done?{usage:{prompt_tokens:packet.prompt_eval_count||0,completion_tokens:packet.eval_count||0,total_tokens:(packet.prompt_eval_count||0)+(packet.eval_count||0),prompt_eval_duration:packet.prompt_eval_duration||0,eval_duration:packet.eval_duration||0,total_duration:packet.total_duration||0,load_duration:packet.load_duration||0}}:{})}
}
function ollamaChat(model,body,{signal,onChunk,headersTimeoutMs}){return new Promise((resolve,reject)=>{const state={id:crypto.randomBytes(8).toString('hex'),nextTool:0,hasTools:false};let done=false;
 const limit=Number.isFinite(Number(headersTimeoutMs))&&Number(headersTimeoutMs)>0?Number(headersTimeoutMs):HEADERS_TIMEOUT_MS;
 const request=http.request('http://127.0.0.1:'+model.port+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal,agent:modelAgent},response=>{request.setTimeout(0);let buffer='';response.setEncoding('utf8');const consume=line=>{if(!line.trim())return;const packet=JSON.parse(line);if(response.statusCode!==200)throw Error(packet.error||'Ollama HTTP '+response.statusCode);onChunk(ollamaChunk(packet,state));if(packet.done)done=true;};response.on('data',chunk=>{buffer+=chunk;try{let split;while((split=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,split));buffer=buffer.slice(split+1);}if(buffer.length>32*1024*1024)throw Error('Ollama stream frame exceeds 32 MiB');}catch(error){request.destroy(error);}});response.on('end',()=>{try{if(buffer.trim())consume(buffer);if(!done)throw Error('Ollama stream ended before completion');resolve();}catch(error){reject(error);}});response.on('error',reject);});request.on('error',reject);
 // The wait for the response headers is bounded, because a local model that
 // has stalled must not hold a task open indefinitely. The bound is cleared
 // as soon as the model starts answering, so a long answer is never cut off.
 request.setTimeout(limit,()=>request.destroy(new Error('The local model did not start answering within '+Math.round(limit/1000)+' seconds.')));
 try{request.end(JSON.stringify(ollamaPayload(body,model)));}catch(error){request.destroy();reject(error);}
 });}
module.exports={ollamaPayload,ollamaChunk,ollamaChat,HEADERS_TIMEOUT_MS,modelAgent};
