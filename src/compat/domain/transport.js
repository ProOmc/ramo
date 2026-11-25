import {text,hash,json,redactProviderMessage} from './helpers.js';

class Transport {
    constructor(host=null){this.host=host;this.remoteOllamaUntil=0;this.lastOllamaRoute='auto';}
    _fetcher(){return fetch;}
    _localChat(){return text(this.host?.variable?.('Ollama Chat URL')||'http://127.0.0.1:11434/api/chat').trim();}
    _remoteChat(){return text(this.host?.variable?.('Remote Ollama URL')||'').trim();}
    _isLocalOllamaURL(url){
      try{const request=new URL(url),local=new URL(this._localChat());return request.origin===local.origin&&/^\/api\//i.test(request.pathname);}catch(_){return false;}
    }
    _remoteFor(url){
      try{
        const request=new URL(url),remote=new URL(this._remoteChat());
        if(!/^https?:$/.test(remote.protocol))return '';
        let prefix=remote.pathname.replace(/\/api\/chat(?:[/?#].*)?$/i,'').replace(/\/$/,'');
        remote.pathname=prefix+request.pathname;remote.search=request.search;remote.hash='';return remote.href;
      }catch(_){return '';}
    }
    _remoteInit(init={},remoteURL=''){
      const next={...init};
      try{
        const u=new URL(remoteURL||this._remoteChat());
        if(/(^|\.)ngrok-free\.(?:app|dev)$/i.test(u.hostname)){
          const headers=new Headers(init?.headers||{});
          if(!headers.has('ngrok-skip-browser-warning'))headers.set('ngrok-skip-browser-warning','true');
          next.headers=headers;
        }
      }catch(_){ }
      return next;
    }
    _fallbackable(error,url){
      if(!this._isLocalOllamaURL(url)||!this._remoteFor(url))return false;
      if(error?.error_class==='network'||error?.code==='NETWORK_FETCH_FAILED')return true;
      // A tags request is a connection probe, so a timeout may safely fall back. Never
      // duplicate a timed-out generation/chat request against the same home Ollama.
      try{return error?.error_class==='timeout'&&/\/api\/tags(?:[/?#]|$)/i.test(new URL(url).pathname);}catch(_){return false;}
    }
    _markRoute(route){
      this.lastOllamaRoute=route;
      try{this.host?.setVariable?.('Ollama Route',route);}catch(_){}
    }
    async _jsonOnce(url,init={},signal,timeout=45000) {
      const controller=new AbortController();let timedOut=false,timer=null;
      const abort=()=>controller.abort();if(signal?.aborted)throw Object.assign(Error('Cancelled'),{error_class:'cancelled'});
      signal?.addEventListener('abort',abort,{once:true});
      const hardMs=Math.max(1,Number(timeout)||45000);
      // A transport may ignore AbortController while a relay request is stalled. Race the
      // entire fetch and body parse against an independent deadline so control returns to
      // the research loop even when abort is advisory only.
      const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;try{controller.abort();}catch(_){}reject(Object.assign(Error('Provider request timed out'),{error_class:'timeout',code:'PROVIDER_HARD_TIMEOUT'}));},hardMs);});
      const work=(async()=>{
        const r=await this._fetcher()(url,{...init,signal:controller.signal});
        if(!r.ok){
          const retry=r.headers?.get?.('Retry-After')||'',ms=/^\d+(?:\.\d+)?$/.test(retry)?Number(retry)*1000:Math.max(0,Date.parse(retry)-Date.now())||0;
          let payload=null,raw='';try{raw=await r.text();if(raw.trim())payload=JSON.parse(raw);}catch(_){}
          const bodyError=payload&&typeof payload==='object'?payload.error:null,providerCode=payload?.error_code??payload?.data?.error_code??bodyError?.code??payload?.code??('HTTP_'+r.status),providerMessage=redactProviderMessage(payload?.message??bodyError?.message??raw).trim().slice(0,1200)||('HTTP '+r.status),requestId=text(payload?.request_id??bodyError?.request_id??r.headers?.get?.('x-request-id')??r.headers?.get?.('request-id')??r.headers?.get?.('x-requestid')??'').slice(0,180);
          throw Object.assign(Error(providerMessage),{http_status:r.status,code:providerCode,message:providerMessage,request_id:requestId,retry_after:retry,retry_after_ms:ms,error_class:r.status===429?'rate_limit':[401,403].includes(r.status)?'auth':r.status>=500?'server':'invalid_request'});
        }
        try{return await r.json();}catch(e){throw Object.assign(Error('Invalid provider JSON'),{error_class:'parse',code:'INVALID_PROVIDER_JSON',message:'Invalid provider JSON'});}
      })();
      try{return await Promise.race([work,deadline]);}
      catch(e){
        if(signal?.aborted)throw Object.assign(Error('Cancelled'),{error_class:'cancelled'});
        if(timedOut||e?.code==='PROVIDER_HARD_TIMEOUT'||e?.error_class==='timeout')throw Object.assign(Error('Provider request timed out'),{error_class:'timeout',code:'PROVIDER_HARD_TIMEOUT'});
        if(!e?.error_class&&/failed to fetch|fetch failed|networkerror|load failed|network request failed/i.test(text(e?.message))){e.error_class='network';if(!e.code)e.code='NETWORK_FETCH_FAILED';}
        throw e;
      } finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    }
    async get(url,init={},signal,timeout=45000) {
      const ollama=this._isLocalOllamaURL(url),remote=ollama?this._remoteFor(url):'',preferRemote=ollama&&remote&&Date.now()<this.remoteOllamaUntil;
      if(preferRemote){
        try{const result=await this._jsonOnce(remote,this._remoteInit(init,remote),signal,timeout);this._markRoute('remote');return result;}
        catch(remoteError){
          if(!this._fallbackable(remoteError,url)){this.remoteOllamaUntil=0;throw remoteError;}
          this.remoteOllamaUntil=0;
        }
      }
      try{const result=await this._jsonOnce(url,init,signal,timeout);if(ollama){this.remoteOllamaUntil=0;this._markRoute('local');}return result;}
      catch(localError){
        if(!this._fallbackable(localError,url))throw localError;
        try{const result=await this._jsonOnce(remote,this._remoteInit(init,remote),signal,timeout);this.remoteOllamaUntil=Date.now()+300000;this._markRoute('remote');return result;}
        catch(remoteError){remoteError.local_failure=redactProviderMessage(localError?.message).slice(0,500);throw remoteError;}
      }
    }
    async _streamOnce(url,init={},signal,timeout=45000,onEvent=()=>{}){
      const controller=new AbortController();let timedOut=false;const abort=()=>controller.abort();if(signal?.aborted)throw Object.assign(Error('Cancelled'),{error_class:'cancelled'});signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeout);
      try{
        const r=await this._fetcher()(url,{...init,signal:controller.signal});
        if(!r.ok){const retry=r.headers?.get?.('Retry-After')||'',ms=/^\d+(?:\.\d+)?$/.test(retry)?Number(retry)*1000:Math.max(0,Date.parse(retry)-Date.now())||0;let payload=null,raw='';try{raw=await r.text();if(raw.trim())payload=JSON.parse(raw);}catch(_){}const bodyError=payload&&typeof payload==='object'?payload.error:null,providerCode=payload?.error_code??payload?.data?.error_code??bodyError?.code??payload?.code??('HTTP_'+r.status),providerMessage=redactProviderMessage(payload?.message??bodyError?.message??raw).trim().slice(0,1200)||('HTTP '+r.status),requestId=text(payload?.request_id??bodyError?.request_id??r.headers?.get?.('x-request-id')??r.headers?.get?.('request-id')??r.headers?.get?.('x-requestid')??'').slice(0,180);throw Object.assign(Error(providerMessage),{http_status:r.status,code:providerCode,message:providerMessage,request_id:requestId,retry_after:retry,retry_after_ms:ms,error_class:r.status===429?'rate_limit':[401,403].includes(r.status)?'auth':r.status>=500?'server':'invalid_request'});}
        if(!r.body?.getReader)throw Object.assign(Error('Streaming response body is unavailable'),{code:'STREAM_UNAVAILABLE',error_class:'unsupported'});
        const reader=r.body.getReader(),decoder=new TextDecoder(),events=[];let carry='',bytes=0,final=null;
        while(true){const part=await reader.read();if(part.done)break;bytes+=part.value?.byteLength||0;carry+=decoder.decode(part.value,{stream:true});let at;while((at=carry.indexOf('\n'))>=0){const line=carry.slice(0,at).trim();carry=carry.slice(at+1);if(!line)continue;let parsed;try{parsed=JSON.parse(line);}catch(_){throw Object.assign(Error('Invalid streamed provider JSON'),{error_class:'parse'});}events.push(parsed);final=parsed;onEvent(parsed);}}
        carry+=decoder.decode();if(carry.trim()){let parsed;try{parsed=JSON.parse(carry.trim());}catch(_){throw Object.assign(Error('Invalid streamed provider JSON'),{error_class:'parse'});}events.push(parsed);final=parsed;onEvent(parsed);}
        return {final,events:events.length,bytes,streaming_supported:true};
      }catch(e){if(signal?.aborted)throw Object.assign(Error('Cancelled'),{error_class:'cancelled'});if(timedOut)throw Object.assign(Error('Provider request timed out'),{error_class:'timeout'});if(!e?.error_class&&/failed to fetch|fetch failed|networkerror|load failed|network request failed/i.test(text(e?.message))){e.error_class='network';if(!e.code)e.code='NETWORK_FETCH_FAILED';}throw e;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    }
    async streamOpenAISSE(url,init={},signal,timeout=90000,onEvent=()=>{}){
      const controller=new AbortController();const abort=()=>controller.abort();let timedOut=false;
      if(signal?.aborted)throw Object.assign(Error('Cancelled'),{error_class:'cancelled'});
      signal?.addEventListener('abort',abort,{once:true});
      const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeout);
      try{
        const response=await this._fetcher()(url,{...init,signal:controller.signal});
        if(!response.ok){let message='OpenAI-compatible streaming failed (HTTP '+response.status+')';try{const raw=await response.text();const error=JSON.parse(raw);message=redactProviderMessage(error?.error?.message||error?.message||message).slice(0,300);}catch(_){}throw Object.assign(Error(message),{error_class:'provider',http_status:response.status});}
        if(!/text\/event-stream/i.test(response.headers?.get?.('content-type')||'')||!response.body?.getReader)throw Object.assign(Error('SSE not supported by endpoint'),{code:'STREAM_UNAVAILABLE',error_class:'unsupported'});
        const reader=response.body.getReader(),decoder=new TextDecoder();let carry='',count=0,done=false,usage={};
        const parse=(line)=>{
          const trimmed=line.trim();if(!trimmed.startsWith('data:'))return;
          const data=trimmed.slice(5).trim();if(!data)return;
          if(data==='[DONE]'){done=true;return;}
          let value;try{value=JSON.parse(data);}catch(_){return;}
          count++;if(value.usage)usage=value.usage;onEvent(value);
        };
        while(!done){const chunk=await reader.read();if(chunk.done)break;carry+=decoder.decode(chunk.value,{stream:true});let at;while((at=carry.indexOf('\n'))>=0){const line=carry.slice(0,at);carry=carry.slice(at+1);parse(line);if(done)break;}}
        if(!done&&carry.trim())parse(carry);
        return {count,usage,done};
      }catch(e){if(signal?.aborted)throw Object.assign(Error('Cancelled'),{error_class:'cancelled'});if(timedOut)throw Object.assign(Error('Provider request timed out'),{error_class:'timeout'});throw e;}
      finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    }
    async streamJSONLines(url,init={},signal,timeout=45000,onEvent=()=>{}){
      const ollama=this._isLocalOllamaURL(url),remote=ollama?this._remoteFor(url):'',preferRemote=ollama&&remote&&Date.now()<this.remoteOllamaUntil;
      if(preferRemote){
        try{const result=await this._streamOnce(remote,this._remoteInit(init,remote),signal,timeout,onEvent);this._markRoute('remote');return result;}
        catch(remoteError){this.remoteOllamaUntil=0;throw remoteError;}
      }
      try{const result=await this._streamOnce(url,init,signal,timeout,onEvent);if(ollama){this.remoteOllamaUntil=0;this._markRoute('local');}return result;}
      catch(localError){
        if(!this._fallbackable(localError,url))throw localError;
        try{const result=await this._streamOnce(remote,this._remoteInit(init,remote),signal,timeout,onEvent);this.remoteOllamaUntil=Date.now()+300000;this._markRoute('remote');return result;}
        catch(remoteError){remoteError.local_failure=redactProviderMessage(localError?.message).slice(0,500);throw remoteError;}
      }
    }
  }
export {Transport};
