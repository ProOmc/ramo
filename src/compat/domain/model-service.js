import {ocCoreWorkStart,ocCoreWorkEnd,U140_MASTER_ENABLE,text,requestText,hash,researchArray,researchObject,modelJSON,v33Clone,u130WorkerPredictBudget,chatAttachmentImages,localImagesOnlyMessage,chatMessagesHaveImages,researchNow} from './helpers.js';

class ModelService {
    constructor(host,transport){this.host=host;this.transport=transport;this.lastStats={};this.researchLock=false;this.researchTranscripts=[];this.lifecycle={current_model:'',load_state:'unknown',last_4b_used:0,keepalive_until:0};}
    smallModel(){return this.researchSmallModel||this.host.session?.chatModel||this.host.variable('Assistant Model')||globalThis.__ramoModelRegistry?.find?.(profile=>profile.tier==='fast')?.model||'';}
    url(){return this.host.variable('Ollama Chat URL')||'http://127.0.0.1:11434/api/chat';}
    profile(model){return (globalThis.__ramoModelRegistry||[]).find(p=>p.kind!=='ollama'&&(p.model===model||p.name===model));}
    researchBackend(model=''){
      if(this.profile(model))return 'openai';
      const configured=text(this.host.variable('Research Model Backend')||'auto').trim().toLowerCase();
      if(['ollama','openai'].includes(configured))return configured;
      // Bonsai2's verified local path uses PrismML/llama-server's OpenAI-compatible API.
      return /^(?:bonsai2|qwen36-tune)$/i.test(text(model).trim())?'openai':'ollama';
    }
    openAIResearchURL(model=''){
      const profile=this.profile(model);if(profile)return profile.kind==='api'?profile.endpoint:RamoHarnessCore.localEndpoint(profile.endpoint);
      if(model==='qwen36-tune')return 'http://127.0.0.1:8081/v1/chat/completions';
      const raw=text(this.host.variable('Research OpenAI URL')||'http://127.0.0.1:8080/v1/chat/completions').trim();
      try{const u=new URL(raw);if(!/^https?:$/.test(u.protocol))throw Error();let p=u.pathname.replace(/\/+$/,'');if(!/\/v1\/chat\/completions$/i.test(p))p=(p||'')+'/v1/chat/completions';u.pathname=p;u.search='';u.hash='';return u.href;}catch(_){throw Error('Research OpenAI URL must be a valid http:// or https:// address.');}
    }
    _openAIMessage(m){
      const out={role:text(m?.role||'user'),content:m?.content==null?'':text(m.content)};
      if(out.role==='tool'){if(m?.tool_call_id)out.tool_call_id=text(m.tool_call_id);return out;}
      const images=chatAttachmentImages({images:m?.images});
      if(images.length)out.content=[{type:'text',text:out.content},...images.map(image=>({type:'image_url',image_url:{url:'data:'+image.mimeType+';base64,'+image.data}}))];
      if(Array.isArray(m?.tool_calls)){out.tool_calls=m.tool_calls.map(tc=>({id:text(tc?.id||''),type:'function',...(tc?.extra_content?{extra_content:v33Clone(tc.extra_content)}:{}),function:{name:text(tc?.function?.name||''),arguments:typeof tc?.function?.arguments==='string'?tc.function.arguments:JSON.stringify(tc?.function?.arguments||{})}})).filter(tc=>tc.function.name);}
      return out;
    }
    _openAIRequest(body){
      const o=body?.options||{},profile=this.profile(body?.model),apiProfile=profile?.kind==='api',req={model:apiProfile?profile.providerModel:text(body?.model||'bonsai2'),messages:researchArray(body?.messages).map(m=>this._openAIMessage(m)),stream:false,max_tokens:Math.max(1,Number(o.num_predict)||2048),temperature:Number.isFinite(Number(o.temperature))?Number(o.temperature):0.2,top_p:Number.isFinite(Number(o.top_p))?Number(o.top_p):0.9};
      const optionKeys=apiProfile?['presence_penalty','frequency_penalty','seed']:['top_k','min_p','presence_penalty','frequency_penalty','repeat_penalty','repeat_last_n','seed'];
      for(const key of optionKeys)if(o[key]!==undefined&&Number.isFinite(Number(o[key])))req[key]=Number(o[key]);
      const systems=req.messages.filter(m=>m.role==='system');if(systems.length){req.messages=[{role:'system',content:systems.map(m=>m.content).join('\n\n')},...req.messages.filter(m=>m.role!=='system')];}
      if(Array.isArray(body?.tools)&&body.tools.length){req.tools=body.tools;req.tool_choice='auto';}
      if(body?.format){if(body.format==='json')req.response_format={type:'json_object'};else if(typeof body.format==='object')req.response_format={type:'json_schema',json_schema:{name:'ramo_response',strict:true,schema:body.format}};}
      const think=body?.think;if(typeof think==='string'&&think&&!['false','off','none','0'].includes(think.toLowerCase()))req.reasoning_effort=think;else if(think===true)req.reasoning_effort='medium';else if(think===false)req.reasoning_effort='none';
      // llama.cpp's auto/legacy mode can stream an implicit reasoning prefix in content.
      // Request its structured reasoning channel rather than guessing from answer text.
      if(this.profile(body?.model)?.kind==='llama'||this.profile(body?.model)?.id==='qwen36'||/^qwen36-tune$/i.test(text(body?.model)))req.reasoning_format='deepseek';
      return req;
    }
    async fitContext(body,signal,currentUser){
      const context=body.options.num_ctx,reserve=body.options.num_predict;
      const fallback=()=>RamoHarnessCore.budgetMessages(body.messages,context,reserve,body.tools,currentUser);
      if(chatMessagesHaveImages(body.messages))return fallback();
      if(this.researchBackend(body.model)!=='openai'||this.profile(body.model)?.kind==='api'||Date.now()<(this.tokenizerUnavailableUntil||0))return fallback();
      const endpoint=RamoHarnessCore.localEndpoint(this.openAIResearchURL(body.model)),origin=new URL(endpoint).origin;
      const count=async messages=>{
        const request=this._openAIRequest({...body,messages});
        // A ready local router may still need to load the selected model on its first template request.
        const template=await this.transport.get(origin+'/apply-template',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)},signal,60000);
        if(typeof template?.prompt!=='string'||!template.prompt.length)throw Error('Template endpoint unavailable');
        // The local multi-model router needs the model on both tokenizer requests.
        const tokens=await this.transport.get(origin+'/tokenize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:body.model,content:template.prompt,add_special:false,parse_special:true})},signal,6000);
        if(!Array.isArray(tokens?.tokens))throw Error('Tokenizer endpoint unavailable');
        return tokens.tokens.length;
      };
      let size;
      try{size=await count(body.messages);}catch(e){if(signal?.aborted)throw e;this.tokenizerUnavailableUntil=Date.now()+300000;return fallback();}
      if(size+reserve+256<=context)return {messages:body.messages.map(m=>({...m})),estimatedTokens:size,measured:true,omitted:0,excerpts:0};
      const bounded=fallback();
      let measured;
      try{measured=await count(bounded.messages);}catch(e){if(signal?.aborted)throw e;return bounded;}
      if(measured+reserve+256>context)throw Error('The measured prompt exceeds this model context. Shorten the input or lower the response budget.');
      return {...bounded,estimatedTokens:measured,measured:true};
    }
    _fromOpenAIResponse(payload){
      const choice=researchArray(payload?.choices)[0]||{},msg=researchObject(choice?.message),usage=researchObject(payload?.usage),toolCalls=researchArray(msg.tool_calls).map(tc=>({id:text(tc?.id||''),type:'function',...(tc?.extra_content?{extra_content:v33Clone(tc.extra_content)}:{}),function:{name:text(tc?.function?.name||''),arguments:tc?.function?.arguments??'{}'}})).filter(tc=>tc.function.name);
      const finish=text(choice?.finish_reason||'stop'),done=finish==='length'?'length':finish||'stop';
      return {message:{content:text(msg.content),thinking:text(msg.reasoning_content||msg.reasoning||msg.thinking),tool_calls:toolCalls},done_reason:done,prompt_eval_count:Number(usage.prompt_tokens)||0,eval_count:Number(usage.completion_tokens)||0,prompt_eval_cached_count:usage.prompt_tokens_details?.cached_tokens??undefined,total_duration:0,load_duration:0,prompt_eval_duration:0,eval_duration:0,_openai_compat:true};
    }
    stats(r,lane){
      const content=text(r.message?.content||r.response),thinking=text(r.message?.thinking);
      const input=Number(r.prompt_eval_count),cached=Number(r.prompt_eval_cached_count),output=Number(r.eval_count),promptNs=Number(r.prompt_eval_duration),outputNs=Number(r.eval_duration);
      const validInput=Number.isFinite(input)&&input>=0,validCached=Number.isFinite(cached)&&cached>=0,validOutput=Number.isFinite(output)&&output>=0;
      const uncached=validInput?Math.max(0,input-(validCached?cached:0)):null;
      this.lastStats[lane]={provider:r._apiProvider?'api:'+text(r._apiProvider):r._openai_compat?'openai_compatible':'ollama',total_ms:Number(r.total_duration||0)/1e6,load_ms:Number(r.load_duration||0)/1e6,prompt_tokens:validInput?input:null,prompt_cached_tokens:validCached?cached:null,prompt_uncached_tokens:uncached,prompt_ms:Number(r.prompt_eval_duration||0)/1e6,output_tokens:validOutput?output:null,output_ms:Number(r.eval_duration||0)/1e6,prompt_tps:uncached>0&&promptNs>0?uncached*1e9/promptNs:null,output_tps:validOutput&&output>0&&outputNs>0?output*1e9/outputNs:null,done_reason:text(r.done_reason),content_chars:content.length,thinking_chars:thinking.length,has_content:!!content.trim(),has_thinking:!!thinking.trim()};
    }
    touched(model){this.lifecycle.current_model=model;this.lifecycle.load_state='ready';if(model===this.smallModel()){this.lifecycle.last_4b_used=Date.now();this.lifecycle.keepalive_until=Date.now()+300000;}}
    async request(body,signal,lane,timeout){
      if(!RamoHarnessCore.allowedModel(body.model))throw Error('Invalid local model identifier: '+body.model);
      const configuredProfile=this.profile(body.model);
      if(configuredProfile?.kind==='api')throw Error('Ramo Unified runs inference on local model profiles. Existing API settings are retained but inactive in this local-only build.');
      const hasImages=chatMessagesHaveImages(body.messages);
      if(hasImages&&configuredProfile?.kind==='api')throw Error(localImagesOnlyMessage);
      for(const message of researchArray(body.messages))chatAttachmentImages({images:message?.images});
      if(hasImages&&configuredProfile?.kind==='llama'&&configuredProfile.vision===false)throw Error('This local model has no vision projector configured. Select a vision-capable model or install its matching projector in Local Models.');
      // Models outside the legacy set MUST exist in the trusted, locally served
      // Ollama inventory. Never turn an arbitrary model name into a remote URL.
      const legacy=/^(?:qwen36-tune|bonsai2)$/i.test(body.model)||/(?:^|\/)qwen3[.\-][56][:_\-]/i.test(body.model);
      if(!configuredProfile&&!legacy&&(!this._installedModelVerified||this._installedModelVerified.name!==body.model||Date.now()-this._installedModelVerified.at>30000)){
        if(typeof globalThis.ramoDesktop?.ollamaModels!=='function')throw Error('Installed-model verification is unavailable; use Local Models to configure this model.');
        const listing=await globalThis.ramoDesktop.ollamaModels();
        const available=Array.isArray(listing?.models)&&listing.models.some(item=>item?.name===body.model||item?.model===body.model);
        if(!listing?.online||!available)throw Error('Model is not confirmed installed in local Ollama: '+body.model);
        this._installedModelVerified={name:body.model,at:Date.now()};
      }
      const chatCompat=!!configuredProfile||/^(?:bonsai2|qwen36-tune)$/i.test(body.model);
      const inferenceURL=configuredProfile?.kind==='api'?configuredProfile.endpoint:chatCompat?this.openAIResearchURL(body.model):/^research/i.test(lane)&&this.researchBackend(body.model)==='openai'?this.openAIResearchURL(body.model):this.url();
      if(configuredProfile?.kind!=='api')RamoHarnessCore.localEndpoint(inferenceURL);
      const accumulator=new RamoHarnessCore.ToolAccumulator();
      const native=body._ldrNative===true;const hardMs=native?Math.max(1,Number(timeout)||60000):Math.max(1000,Number(timeout)||60000)+15000,callController=new AbortController();let hardTimer=null,watchdogFired=false;
      let rejectAbort;const cancelled=new Promise((_,reject)=>{rejectAbort=reject;});
      const parentAbort=()=>{callController.abort();rejectAbort(Object.assign(Error('Cancelled'),{error_class:'cancelled'}));};if(signal?.aborted)throw Object.assign(Error('Cancelled'),{error_class:'cancelled'});signal?.addEventListener('abort',parentAbort,{once:true});
      const watchdog=new Promise((_,reject)=>{hardTimer=setTimeout(()=>{watchdogFired=true;callController.abort();const e=Error((configuredProfile?.kind==='api'?'API model':'Local model')+' call exceeded hard watchdog ('+lane+').');e.code='MODEL_WATCHDOG_TIMEOUT';e.error_class='timeout';reject(e);},hardMs);});
      const research=/^research/i.test(lane),researchId=this.host.session?.job?.id||'',callId='MC'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6),startedAt=researchNow(),startedMs=Date.now(),requestBody={...body},requestText=researchArray(body.messages).map(m=>String(m.role||'').toUpperCase()+': '+text(m.content)).join('\n\n'),openAIResearch=chatCompat||research&&this.researchBackend(body.model)==='openai';
      const activityOwner=this.host.session,activityChat=activityOwner?.chatId||null,activityTurn=activityOwner?.turn?.index,activityId=activityOwner?.turn?.activity?.id;
      delete requestBody._ldrNative;delete requestBody._chatStream;let thinkingText='',contentText='',firstChunkAt=0,firstThinkingAt=0,firstContentAt=0,streamFallback=false,r=null,status='ok',failure=null;
      const emit=(type,extra={})=>{const work=globalThis.__ramoInferenceMeter?.active?.[callId];if(work&&type==='model_thinking_chunk')work.phase='think';if(work&&type==='model_content_chunk')work.phase='generate';if(signal?.aborted&&type!=='model_error')return;try{this.host.researchEvents?.emit({type,call_id:callId,research_id:researchId,chat_id:activityChat,turn_index:activityTurn,turn_id:activityId,stage:lane,model:body.model,model_role:this.host.session?.job?.engine==='agent_v2'?'lead':body.model===this.host.session?.job?.settings?.report_model?'reporter':'worker',at:researchNow(),...extra});}catch(_){}};
      emit('model_start',{thinking_enabled:body.think!==false});
      ocCoreWorkStart(callId,body,lane);
      try{
        if(configuredProfile?.kind==='api'){
           const api=globalThis.ramoDesktop?.apiProviders;if(!api?.chat)throw Error('API model support is unavailable in this desktop build.');
           const compatBody=this._openAIRequest(requestBody);compatBody.stream=true;compatBody.stream_options={include_usage:true};
           const onApiEvent=value=>{const choice=researchArray(value?.choices)[0]||{},delta=choice.delta||{};accumulator.addOpenAI(delta);const t=text(delta.reasoning_content||delta.reasoning||delta.thinking),c=text(delta.content);if(!firstChunkAt&&(t||c||delta.tool_calls?.length))firstChunkAt=Date.now();if(t&&!firstThinkingAt)firstThinkingAt=Date.now();if(c&&!firstContentAt)firstContentAt=Date.now();if(t){thinkingText+=t;emit('model_thinking_chunk',{text:t,elapsed_ms:Date.now()-startedMs});}if(c){contentText+=c;emit('model_content_chunk',{text:c,elapsed_ms:Date.now()-startedMs});}};
           const removeListener=api.onChunk(packet=>{if(packet?.requestId===callId)onApiEvent(packet.event||{});}),abortRequest=()=>api.abort(callId);
           callController.signal.addEventListener('abort',abortRequest,{once:true});
           try{const reply=await Promise.race([api.chat(configuredProfile.id,callId,compatBody),watchdog,cancelled]);const usage=reply?.usage||{};r={message:{content:contentText,thinking:thinkingText,tool_calls:accumulator.calls()},done_reason:text(reply?.finish_reason||'stop'),prompt_eval_count:Number(usage.prompt_tokens)||0,eval_count:Number(usage.completion_tokens)||0,_openai_compat:true,_apiProvider:configuredProfile.provider,_streaming:true,_time_to_first_chunk_ms:firstChunkAt?firstChunkAt-startedMs:null,_time_to_first_thinking_ms:firstThinkingAt?firstThinkingAt-startedMs:null,_time_to_first_content_ms:firstContentAt?firstContentAt-startedMs:null};}
           finally{callController.signal.removeEventListener('abort',abortRequest);removeListener();}
        }else if(openAIResearch){
           const compatBody=this._openAIRequest(requestBody),endpoint=inferenceURL;
           if((!native||body._chatStream)&&this.transport.streamOpenAISSE){
             compatBody.stream=true;compatBody.stream_options={include_usage:true};let finalReason='',finalContent='',usage={},finish='stop',gotAny=false;
             const onEvent=value=>{const choice=researchArray(value?.choices)[0]||{},delta=choice.delta||{};accumulator.addOpenAI(delta);const t=text(delta.reasoning_content||delta.reasoning||delta.thinking),c=text(delta.content);if(!firstChunkAt&&(t||c||delta.tool_calls?.length))firstChunkAt=Date.now();if(t&&!firstThinkingAt)firstThinkingAt=Date.now();if(c&&!firstContentAt)firstContentAt=Date.now();if(t){gotAny=true;finalReason+=t;emit('model_thinking_chunk',{text:t,elapsed_ms:Date.now()-startedMs});}if(c){gotAny=true;finalContent+=c;emit('model_content_chunk',{text:c,elapsed_ms:Date.now()-startedMs});}if(choice.finish_reason)finish=text(choice.finish_reason);if(value?.usage)usage=value.usage;};
             try{const init={method:'POST',headers:{'Content-Type':'application/json','Accept':'text/event-stream'},body:JSON.stringify(compatBody)};const reply=await Promise.race([this.transport.streamOpenAISSE(endpoint,init,callController.signal,timeout,onEvent),watchdog,cancelled]);usage=reply.usage||usage;r={message:{content:finalContent,thinking:finalReason,tool_calls:accumulator.calls()},done_reason:finish,prompt_eval_count:Number(usage.prompt_tokens)||0,eval_count:Number(usage.completion_tokens)||0,prompt_eval_cached_count:usage.prompt_tokens_details?.cached_tokens??undefined,_openai_compat:true,_streaming:true,_time_to_first_chunk_ms:firstChunkAt?firstChunkAt-startedMs:null,_time_to_first_thinking_ms:firstThinkingAt?firstThinkingAt-startedMs:null,_time_to_first_content_ms:firstContentAt?firstContentAt-startedMs:null};thinkingText=finalReason;contentText=finalContent;}
             catch(e){if(gotAny||!['STREAM_UNAVAILABLE','unsupported'].includes(e?.code)&&e?.error_class!=='unsupported')throw e;streamFallback=true;compatBody.stream=false;const payload=await Promise.race([this.transport.get(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(compatBody)},callController.signal,timeout),watchdog,cancelled]);r=this._fromOpenAIResponse(payload);}
           }else{const payload=await Promise.race([this.transport.get(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(compatBody)},callController.signal,timeout),watchdog,cancelled]);r=this._fromOpenAIResponse(payload);} 
        }else{
          const wantsStream=(!native||body._chatStream)&&!!this.transport.streamJSONLines&&!openAIResearch;
          if(wantsStream){requestBody.stream=true;const onEvent=evt=>{accumulator.addOllama(evt?.message?.tool_calls);if(!firstChunkAt)firstChunkAt=Date.now();const t=text(evt?.message?.thinking),c=text(evt?.message?.content);if(t){if(!firstThinkingAt)firstThinkingAt=Date.now();thinkingText+=t;emit('model_thinking_chunk',{text:t,elapsed_ms:Date.now()-startedMs});}if(c){if(!firstContentAt)firstContentAt=Date.now();contentText+=c;emit('model_content_chunk',{text:c,elapsed_ms:Date.now()-startedMs});}};
            try{const pending=this.transport.streamJSONLines(this.url(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(requestBody)},callController.signal,timeout,onEvent),streamed=await Promise.race([pending,watchdog,cancelled]),final=streamed.final||{};r={...final,message:{...(final.message||{}),thinking:thinkingText||final.message?.thinking||'',content:contentText||final.message?.content||'',tool_calls:accumulator.calls().length?accumulator.calls():final.message?.tool_calls||[]},_streaming:true,_time_to_first_chunk_ms:firstChunkAt?firstChunkAt-startedMs:null,_time_to_first_thinking_ms:firstThinkingAt?firstThinkingAt-startedMs:null,_time_to_first_content_ms:firstContentAt?firstContentAt-startedMs:null};}
            catch(e){if(['STREAM_UNAVAILABLE','unsupported'].includes(e?.code)||e?.error_class==='unsupported'){streamFallback=true;requestBody.stream=false;const pending=this.transport.get(this.url(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(requestBody)},callController.signal,timeout);r=await Promise.race([pending,watchdog,cancelled]);}else throw e;}
          }else{requestBody.stream=false;const pending=this.transport.get(this.url(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(requestBody)},callController.signal,timeout);r=await Promise.race([pending,watchdog,cancelled]);}
        }
      }catch(e){status='failed';failure=e;if(signal?.aborted)failure=Object.assign(Error('Cancelled'),{error_class:'cancelled'});else if(watchdogFired){failure=Error((configuredProfile?.kind==='api'?'API model':'Local model')+' call exceeded hard watchdog ('+lane+').');failure.code='MODEL_WATCHDOG_TIMEOUT';failure.error_class='timeout';}}
      finally{clearTimeout(hardTimer);signal?.removeEventListener('abort',parentAbort);}
      const finishedAt=researchNow(),elapsed=Date.now()-startedMs;let result='',thinking='';
      if(r){
        this.stats(r,lane);this.lastStats[lane].request_settings={model:body.model,think:body.think,...body.options};Object.assign(this.lastStats[lane],{streaming:!!r._streaming,stream_fallback:streamFallback,time_to_first_chunk_ms:r._time_to_first_chunk_ms??null,time_to_first_thinking_ms:r._time_to_first_thinking_ms??null,time_to_first_content_ms:r._time_to_first_content_ms??null});
        if(!failure){
          result=text(r?.message?.content||r?.response).trim();thinking=text(r?.message?.thinking).trim();
          if(r?.error){failure=Error((configuredProfile?.kind==='api'?'API provider':'Local model')+' error: '+r.error);failure.code='MODEL_PROVIDER_ERROR';failure.error_class='provider';}
          else if(!result&&!native){failure=Error(thinking?'The model returned reasoning but no final answer.':'The model returned an empty response.');failure.code=thinking?'THINKING_ONLY':'EMPTY_MODEL_RESPONSE';failure.error_class='invalid_response';failure.thinking_preview=thinking.slice(0,1200);failure.done_reason=text(r?.done_reason);}
          else if(r?.done_reason==='length'&&(research||(lane==='chat'&&body.think!==false))&&!native){failure=Error('Model output reached its token limit ('+lane+'); evidence/drafts remain available.');failure.code='OUTPUT_TRUNCATED';failure.error_class='truncated';failure.draft=result;}
        }
      }
      const transcript={id:(researchId||'adhoc')+':'+callId,research_id:researchId,call_id:callId,stage:lane,model:body.model,model_role:this.host.session?.job?.engine==='agent_v2'?'lead':body.model===this.host.session?.job?.settings?.report_model?'reporter':'worker',started_at:startedAt,finished_at:finishedAt,elapsed_ms:elapsed,thinking_enabled:body.think!==false,request_text:requestText,thinking_text:thinkingText||text(r?.message?.thinking),response_text:contentText||text(r?.message?.content||r?.response),status:failure?'failed':'complete',done_reason:text(r?.done_reason),metrics:v33Clone(this.lastStats[lane]||{}),stream_fallback:streamFallback};
      if(signal?.aborted)failure=Object.assign(Error('Cancelled'),{error_class:'cancelled'});
      if(native){transcript.tool_calls=v33Clone(researchArray(r?.message?.tool_calls));transcript.request_tools=v33Clone(researchArray(body.tools));transcript.request_messages=v33Clone(researchArray(body.messages));}if(research&&researchId){this.researchTranscripts.push(transcript);if(this.researchTranscripts.length>96)this.researchTranscripts.splice(0,this.researchTranscripts.length-96);this.host.engine?.durable?.saveModelTranscript?.(transcript).catch(()=>{});}
      if(!thinkingText&&transcript.thinking_text)emit('model_thinking_chunk',{text:transcript.thinking_text.slice(0,18000),from_final_response:true});
       if(!contentText&&transcript.response_text)emit('model_content_chunk',{text:transcript.response_text.slice(0,12000),from_final_response:true});
       ocCoreWorkEnd(callId,r,!!failure);
      const measured=r?this.lastStats[lane]||{}:{};
      emit(failure?'model_error':'model_end',{elapsed_ms:elapsed,done_reason:transcript.done_reason,status:transcript.status,stream_fallback:streamFallback,metrics:r?{provider:measured.provider||'ollama',model:text(body.model),prompt_tokens:measured.prompt_tokens,prompt_cached_tokens:measured.prompt_cached_tokens,prompt_uncached_tokens:measured.prompt_uncached_tokens,output_tokens:measured.output_tokens,prompt_tps:measured.prompt_tps,output_tps:measured.output_tps,prompt_ms:measured.prompt_ms,output_ms:measured.output_ms,load_ms:measured.load_ms,total_ms:measured.total_ms,wall_ms:elapsed,time_to_first_chunk_ms:measured.time_to_first_chunk_ms,done_reason:transcript.done_reason}:null});
      if(native){transcript.tool_calls=v33Clone(researchArray(r?.message?.tool_calls));transcript.request_tools=v33Clone(researchArray(body.tools));transcript.request_messages=v33Clone(researchArray(body.messages));}if(failure)throw failure;
      if(configuredProfile?.kind!=='api')this.touched(body.model);return native?{content:result,tool_calls:researchArray(r?.message?.tool_calls),done_reason:text(r?.done_reason),eval_count:Number(r?.eval_count)||0,prompt_eval_count:Number(r?.prompt_eval_count)||0}:result;
    }
    async answer(messages,signal,jsonMode=false){
      if(this.researchLock)throw Error('The research reporter currently owns the model connection.');
      const thinking=!jsonMode&&!!this.host.liveThinking;
      const base={model:this.smallModel(),stream:false,think:thinking,keep_alive:'5m',...(jsonMode?{format:'json'}:{}),options:{num_ctx:16384,num_predict:jsonMode?350:(thinking?8192:800)},messages};
      try{return await this.request(base,signal,jsonMode?'json':'chat',thinking?300000:90000);}
      catch(e){
        // Thinking uses the same generation pool as the answer. Recover a complete response
        // if a model spends that pool solely on reasoning or reaches its token limit.
        if(!thinking||!['THINKING_ONLY','OUTPUT_TRUNCATED'].includes(e?.code)||signal?.aborted)throw e;
        const finish={...base,think:false,options:{...base.options,num_predict:4096},messages:[{role:'system',content:'Provide the complete user-facing answer directly. Do not output hidden reasoning. Preserve factual uncertainty and any source constraints.'},...messages]};
        return this.request(finish,signal,'chat_final_answer',180000);
      }
    }
    async structured(messages,schema,signal,lane='memory',maxTokens=320,think=false){
      if(this.researchLock)throw Error('The research reporter currently owns the model connection.');
      const thinking=!!think,predict=u130WorkerPredictBudget(lane,maxTokens,thinking),base={model:this.smallModel(),stream:false,think:thinking,keep_alive:'5m',format:schema,options:{num_ctx:16384,num_predict:predict,temperature:0},messages};
      let result;try{result=await this.request(base,signal,lane,lane.startsWith('research')?180000:60000);}catch(e){if(thinking&&(e?.code==='THINKING_ONLY'||e?.code==='OUTPUT_TRUNCATED'))result=await this.request({...base,think:false,options:{...base.options,num_predict:maxTokens}},signal,lane+'_finalize',lane.startsWith('research')?180000:60000);else throw e;}
      const parsed=modelJSON(result,null);if(!parsed||typeof parsed!=='object')throw Error('Structured model output was invalid JSON');return parsed;
    }
    async residency(model,keepAlive,signal,contextOverride=0){
      this.lifecycle.load_state=keepAlive===0?'unloading':'loading';
      const url=this.url().replace(/\/api\/chat(?:\?.*)?$/,'/api/generate');
      if(url===this.url())throw Error('Model switching requires an Ollama /api/chat endpoint.');
      try{
        const requested=Number(contextOverride)||Number(this.host.variable('Research Report Context'))||49152,ctx=model===this.smallModel()?16384:Math.max(8192,Math.min(49152,requested));
        const r=await this.transport.get(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,prompt:'',stream:false,keep_alive:keepAlive,options:{num_ctx:ctx}})},signal,180000);
        if(r.error)throw Error(r.error);
        if(keepAlive===0){this.lifecycle.current_model='';this.lifecycle.load_state='unloaded';}else this.touched(model);
      }catch(e){this.lifecycle.load_state='failed';this.lifecycle.error=e.message;throw e;}
    }
    reportThink(settings,level='high'){
      // Speed/quality balance: high-reasoning stages still think. Routine verification,
      // formatting and local synthesis can explicitly request "off". GPT-OSS keeps its
      // string reasoning levels; Qwen-style Ollama models use boolean thinking.
      const requested=text(settings?.think_level||level||'high').toLowerCase();
      if(['off','false','none','0'].includes(requested))return false;
      if(/gpt[-_ ]?oss/i.test(text(settings?.report_model)))return ['low','medium','high'].includes(requested)?requested:'high';
      return requested==='high';
    }
    async reportStructured(messages,schema,settings,signal,lane='research_report_plan',maxTokens=3200){
      const defaultLevel=/sentence_support|editor|report_blueprint|synthesis_batch/i.test(lane)?'off':/adjudicator/i.test(lane)?'medium':'high',level=settings?.think_level||defaultLevel;
      const base={model:settings.report_model,stream:false,keep_alive:'5m',format:schema,messages,options:{num_ctx:settings.context,num_predict:maxTokens,temperature:.15,top_p:.85,top_k:20}};
      let result;try{result=await this.request({...base,think:this.reportThink(settings,level)},signal,lane,15*60*1000);}
      catch(e){if(e?.code==='THINKING_ONLY'||e?.code==='EMPTY_MODEL_RESPONSE'||(U140_MASTER_ENABLE&&e?.code==='OUTPUT_TRUNCATED')){const condensed=e?.code==='OUTPUT_TRUNCATED'?[{role:'system',content:'Return concise valid JSON. Use short evidence-linked findings, omit repetition and optional elaboration; preserve all required IDs and fields.'},...messages]:messages;result=await this.request({...base,messages:condensed,think:false,options:{...base.options,temperature:.08}},signal,lane+'_finalize',15*60*1000);}else throw e;}
      const parsed=modelJSON(result,null);if(!parsed||typeof parsed!=='object')throw Error('Report planner returned invalid structured output');return parsed;
    }
    async reportStructuredFast(messages,schema,settings,signal,lane='research_report_fast',maxTokens=2600){const result=await this.request({model:settings.report_model,stream:false,think:false,keep_alive:'5m',format:schema,messages,options:{num_ctx:settings.context,num_predict:maxTokens,temperature:.45,top_p:.85,top_k:20}},signal,lane,15*60*1000);const parsed=modelJSON(result,null);if(!parsed||typeof parsed!=='object')throw Error('Fast structured report stage returned invalid JSON');return parsed;}

    async reportProse(messages,settings,signal,lane='research_report_prose',maxTokens=8192){
      return this.request({model:settings.report_model,stream:false,think:false,keep_alive:'5m',messages,options:{num_ctx:settings.context,num_predict:maxTokens,temperature:.68,top_p:.85,top_k:20,repeat_penalty:1.03}},signal,lane,15*60*1000);
    }
    async reportAnalyticalProse(messages,settings,signal,lane='research_report_analysis',maxTokens=8192){
      const level=settings?.think_level||'high',base={model:settings.report_model,stream:false,think:this.reportThink(settings,level),keep_alive:'5m',messages,options:{num_ctx:settings.context,num_predict:maxTokens,temperature:.78,top_p:.90,top_k:20,repeat_penalty:1.02,...(settings.analysis_sampling||{})}};
      try{return await this.request(base,signal,lane,15*60*1000);}catch(e){if(e?.code==='THINKING_ONLY'||e?.code==='EMPTY_MODEL_RESPONSE')return this.request({...base,think:false,options:{...base.options,temperature:.64,top_p:.84}},signal,lane+'_finalize',15*60*1000);throw e;}
    }
    async report(messages,settings,signal){
      const base={model:settings.report_model,stream:false,keep_alive:'5m',messages,options:{num_ctx:settings.context,num_predict:8192,temperature:1.0,top_p:.95,top_k:20}};
      try{return await this.request({...base,think:this.reportThink(settings,'high')},signal,'research_report_large',15*60*1000);}
      catch(e){if(e?.code==='THINKING_ONLY'||e?.code==='EMPTY_MODEL_RESPONSE')return this.request({...base,think:false},signal,'research_report_large_finalize',15*60*1000);throw e;}
    }
  }
export {ModelService};
