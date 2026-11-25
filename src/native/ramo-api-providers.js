'use strict';

const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {randomUUID, randomBytes, createHash, createCipheriv, createDecipheriv}=crypto;
const {ReadableStream}=require('node:stream/web');

const GEMINI_ENDPOINT='https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const cleanText=(value,max=160)=>String(value??'').trim().slice(0,max);

function normalizeEndpoint(value){
  let url;
  try{url=new URL(String(value||''));}catch{throw Error('Enter a valid API endpoint URL.');}
  if(url.username||url.password||url.search||url.hash||!['http:','https:'].includes(url.protocol))throw Error('Enter a valid API endpoint URL without credentials, query strings, or fragments.');
  const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,'');
  const loopback=host==='localhost'||host==='::1'||/^127(?:\.\d{1,3}){3}$/.test(host);
  if(url.protocol!=='https:'&&!loopback)throw Error('API endpoints must use HTTPS; HTTP is allowed only on loopback.');
  let pathname=url.pathname.replace(/\/+$/,'');
  if(!/\/chat\/completions$/i.test(pathname))pathname=(pathname||'')+'/chat/completions';
  url.pathname=pathname;
  return url.href;
}

/**
 * Derive the model catalogue URL from a user-typed endpoint: strip any
 * trailing slash and any /chat/completions or /models suffix, keep the same
 * HTTPS/loopback rules as chat endpoints, then append /models. Works for
 * OpenAI, OpenRouter, NVIDIA and Google's OpenAI-compatible layer alike.
 */
function normalizeModelsBase(value){
  let url;
  try{url=new URL(String(value||''));}catch{throw Error('Enter a valid API endpoint URL.');}
  if(url.username||url.password||url.search||url.hash||!['http:','https:'].includes(url.protocol))throw Error('Enter a valid API endpoint URL without credentials, query strings, or fragments.');
  const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,'');
  const loopback=host==='localhost'||host==='::1'||/^127(?:\.\d{1,3}){3}$/.test(host);
  if(url.protocol!=='https:'&&!loopback)throw Error('API endpoints must use HTTPS; HTTP is allowed only on loopback.');
  let pathname=url.pathname.replace(/\/+$/,'').replace(/\/(chat\/completions|models)$/i,'');
  url.pathname=pathname;
  url.search='';
  url.hash='';
  return url.href.replace(/\/+$/,'');
}

/**
 * Tolerant parser for the catalogue shapes providers actually return:
 * { data: [...] } (OpenAI/OpenRouter/NVIDIA/Google OpenAI layer),
 * { models: [...] } (Google native), a bare array, or { id/name } rows.
 * Google rows advertising supportedGenerationMethods are kept only when
 * they claim generateContent. Strips a leading "models/" prefix, dedupes,
 * caps at 500 entries, sorts by id.
 */
function extractModelRows(json){
  const raw=Array.isArray(json)?json:(Array.isArray(json?.data)?json.data:(Array.isArray(json?.models)?json.models:null));
  if(!raw)throw Error('The provider did not return a model list.');
  const seen=new Set(),models=[];
  for(const row of raw.slice(0,5000)){
    let id=typeof row==='string'?row:(row?.id??row?.name);
    if(typeof id!=='string')continue;
    id=id.trim().replace(/^models\//,'');
    if(!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,179}$/.test(id)||seen.has(id))continue;
    if(Array.isArray(row?.supportedGenerationMethods)&&!row.supportedGenerationMethods.includes('generateContent'))continue;
    seen.add(id);
    const label=typeof row?.displayName==='string'&&row.displayName.trim()?row.displayName.trim().slice(0,120):null;
    const description=typeof row?.description==='string'&&row.description.trim()?row.description.trim().slice(0,300):null;
    models.push({id,...(label?{label}:{}),...(description?{description}:{})});
    if(models.length>=500)break;
  }
  models.sort((a,b)=>a.id.localeCompare(b.id));
  return models;
}

function safeProfile(row){
  return {id:row.id,model:row.id,label:row.name,name:row.name,provider:row.provider,providerModel:row.model,endpoint:row.endpoint,auth:row.auth,kind:'api',ready:true};
}

function createElectronFetch(electronNet){
  if(typeof electronNet?.fetch==='function')return electronNet.fetch.bind(electronNet);
  if(typeof electronNet?.request!=='function')throw Error('Electron network transport is unavailable.');
  return (input,options={})=>new Promise((resolve,reject)=>{
    const request=electronNet.request({url:String(input),method:options.method||'GET',redirect:'error'});
    let settled=false,streamController=null;
    const fail=error=>{if(settled)return;settled=true;reject(error);};
    const abort=()=>{try{request.abort();}catch{}fail(Object.assign(Error('Request aborted'),{name:'AbortError'}));try{streamController?.error(Error('Request aborted'));}catch{}};
    if(options.signal?.aborted){abort();return;}
    options.signal?.addEventListener('abort',abort,{once:true});
    request.on('redirect',()=>{try{request.abort();}catch{}fail(Error('API endpoint redirects are not allowed.'));});
    request.on('error',error=>fail(error));
    request.on('response',response=>{
      const headers=response.headers||{},getHeader=name=>{const value=headers[String(name).toLowerCase()];return Array.isArray(value)?value.join(', '):value==null?null:String(value);};
      const body=new ReadableStream({start(controller){streamController=controller;response.on('data',chunk=>controller.enqueue(new Uint8Array(chunk)));response.on('end',()=>{try{controller.close();}catch{}options.signal?.removeEventListener('abort',abort);});response.on('error',error=>{try{controller.error(error);}catch{}});},cancel(){try{request.abort();}catch{}}});
      settled=true;
      const readText=async()=>{const reader=body.getReader(),parts=[];while(true){const {value,done}=await reader.read();if(done)break;parts.push(Buffer.from(value));}return Buffer.concat(parts).toString('utf8');};
      resolve({ok:Number(response.statusCode)>=200&&Number(response.statusCode)<300,status:Number(response.statusCode)||0,statusText:String(response.statusMessage||''),headers:{get:getHeader},body,text:readText,async json(){return JSON.parse(await readText());}});
    });
    for(const [name,value] of Object.entries(options.headers||{}))request.setHeader(name,String(value));
    if(options.body!==undefined)request.write(String(options.body));
    request.end();
  });
}

/**
 * Async availability probe. The synchronous family of safeStorage is
 * deprecated and is removed in Electron 46; the async probe is the
 * supported path. The sync fallbacks below exist only so a mocked
 * safeStorage in a dev profile still behaves.
 */
async function _safeStorageEncrypt(safeStorage, plaintext){
  if(typeof safeStorage?.encryptStringAsync==='function'){return Buffer.from(await safeStorage.encryptStringAsync(String(plaintext)));}
  return safeStorage.encryptString(String(plaintext));
}
async function _safeStorageDecrypt(safeStorage, blob){
  const buffer = typeof blob === 'string' ? Buffer.from(blob, 'base64') : blob;
  if(typeof safeStorage?.decryptStringAsync==='function'){
    const value = await safeStorage.decryptStringAsync(buffer);
    // shouldReEncrypt signals OS key rotation. The value stays valid; no
    // file write happens in this read path, so the row is left as-is.
    return String(value?.result ?? '');
  }
  return safeStorage.decryptString(buffer);
}
class RamoApiProviders{
  constructor({filePath,safeStorage,fetchImpl=globalThis.fetch}={}){
    if(!filePath)throw Error('API provider storage path is required.');
    if(typeof fetchImpl!=='function')throw Error('API network transport is unavailable.');
    this.filePath=filePath;this.safeStorage=safeStorage;this.fetchImpl=fetchImpl;this._data=null;
  }
  async _encryptionAvailable(){
    try{
      if(typeof this.safeStorage?.isAsyncEncryptionAvailable==='function'){
        if(!await this.safeStorage.isAsyncEncryptionAvailable())return false;
      }else if(!this.safeStorage?.isEncryptionAvailable?.())return false;
      const backend=this.safeStorage?.getSelectedStorageBackend?.();
      if(backend&&String(backend).toLowerCase()==='basic_text')return false;
      if(process.platform==='linux'&&!backend)return false;
      return true;
    }catch{return false;}
  }
  _read(){
    if(this._data)return this._data;
    try{
      const value=JSON.parse(fs.readFileSync(this.filePath,'utf8'));
      if(value?.version!==1||!Array.isArray(value.providers))throw Error();
      this._data=value;
    }catch(error){
      if(error?.code==='ENOENT')this._data={version:1,providers:[]};
      else throw Error('Saved API provider settings could not be read.');
    }
    return this._data;
  }
  _write(data){
    fs.mkdirSync(path.dirname(this.filePath),{recursive:true});
    const temporary=this.filePath+'.tmp-'+process.pid;
    fs.writeFileSync(temporary,JSON.stringify(data,null,2),{encoding:'utf8',mode:0o600});
    try{fs.renameSync(temporary,this.filePath);}catch(error){
      try{fs.copyFileSync(temporary,this.filePath);fs.unlinkSync(temporary);}catch(copyError){try{fs.rmSync(temporary,{force:true});}catch{}throw copyError||error;}
    }
    try{fs.chmodSync(this.filePath,0o600);}catch{}
    this._data=data;
  }
  list(){return this._read().providers.map(safeProfile);}
  setup(){
    const setup=this._read().setup;
    const tiers=setup?.tiers&&typeof setup.tiers==='object'?setup.tiers:{};
    const clean={};for(const tier of ['fast','smart','superSmart'])if(typeof tiers[tier]==='string'&&tiers[tier].trim())clean[tier]=tiers[tier].trim().slice(0,180);
    return {tiers:clean,complete:setup?.complete===true,ollamaPort:Number.isInteger(setup?.ollamaPort)?setup.ollamaPort:11434};
  }
  saveSetup(input={}){
    const current=this._read(),tiers=input?.tiers&&typeof input.tiers==='object'?input.tiers:{},clean={};
    for(const tier of ['fast','smart','superSmart']){const name=String(tiers[tier]||'').trim();if(name){if(name.length>180||/[\x00-\x1f\x7f]/.test(name))throw Error('Enter a valid model name.');clean[tier]=name;}}
    const ollamaPort=input?.ollamaPort===undefined?Number(current.setup?.ollamaPort)||11434:Number(input.ollamaPort);
    if(!Number.isInteger(ollamaPort)||ollamaPort<1||ollamaPort>65535)throw Error('Enter a valid Ollama port.');
    this._write({...current,version:1,providers:Array.isArray(current.providers)?current.providers:[],setup:{tiers:clean,complete:input?.complete===true,ollamaPort}});
    return this.setup();
  }
  async save(input={}){
    if(!await this._encryptionAvailable())throw Error('Secure credential storage is unavailable; API keys were not saved.');
    const name=cleanText(input.name,80),requested=String(input.provider||'openai-compatible'),knownProvider=RamoApiProviders.KNOWN[requested]?requested:'',provider=knownProvider||'openai-compatible',model=cleanText(input.model,180);
    if(!name)throw Error('Give this API model a name.');
    if(!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,179}$/.test(model))throw Error('Enter a valid provider model ID.');
    const definition=knownProvider?RamoApiProviders.KNOWN[knownProvider]:null;
    const endpoint=definition?definition.endpoint:normalizeEndpoint(input.endpoint);
    const auth=definition?.auth||(['bearer','x-api-key'].includes(input.auth)?input.auth:'bearer');
    const data=this._read(),id=String(input.id||'');let existing=data.providers.find(row=>row.id===id);
    if(id&&!existing)throw Error('That API model profile no longer exists.');
    const apiKey=String(input.apiKey||'').trim(),known=knownProvider&&(Array.isArray(data.known)?data.known:[]).find(row=>row.provider===knownProvider);
    if(!apiKey&&!existing&&!known)throw Error('Enter an API key or save one in the provider slot first.');
    if(apiKey.length>4096||/[\r\n]/.test(apiKey))throw Error('Enter a valid API key.');
    if(apiKey&&!await this._encryptionAvailable())throw Error('Secure credential storage is unavailable; API keys were not saved.');
    const row={id:existing?.id||'api-'+randomUUID(),name,provider,model,endpoint,auth};
    if(apiKey)row.keyCiphertext=(await _safeStorageEncrypt(this.safeStorage,apiKey)).toString('base64');
    else row.keyCiphertext=existing?.keyCiphertext||known.keyCiphertext;
    if(existing)data.providers[data.providers.indexOf(existing)]=row;else data.providers.push(row);
    this._write(data);
    return safeProfile(row);
  }
  async remove(id){
    const data=this._read(),before=data.providers.length;
    data.providers=data.providers.filter(row=>row.id!==String(id));
    if(before!==data.providers.length)this._write(data);
    return before!==data.providers.length;
  }
  /**
   * Known providers with one key each — the smallest thing that is not a
   * placeholder. Adding a provider here is the entire next feature: one
   * constant below, one row rendered wider in the dialog automatically.
   */
  static KNOWN = {
    openai: { name: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions' },
    openrouter: { name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions' },
    anthropic: { name: 'Anthropic', endpoint: 'https://api.anthropic.com/v1/chat/completions', auth: 'x-api-key', headers: { 'anthropic-version': '2023-06-01' } },
    gemini: { name: 'Google Gemini', endpoint: GEMINI_ENDPOINT },
    nvidia: { name: 'NVIDIA', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions' },
  };

  /** Store (or replace) one key for a known provider. Encrypted at rest, like the model profiles. */
  async setKnown(provider, apiKey) {
    const key = String(apiKey || '').trim();
    const def = RamoApiProviders.KNOWN[provider];
    if (!def) throw Error('Ramo does not know that provider yet.');
    if (!key) throw Error(`Paste your ${def.name} key first.`);
    if (/\s/.test(key) || key.length < 12 || key.length > 4096) throw Error('Enter the full API key — spaces are not allowed and keys are longer than that.');
    if (!(await this._encryptionAvailable())) throw Error('Secure credential storage is unavailable; API keys were not saved.');
    const data = this._read();
    const known = Array.isArray(data.known) ? data.known.slice(0, 40) : [];
    const entry = { provider, savedAt: Date.now(), keyCiphertext: this._encryptKnown(key) };
    const index = known.findIndex((row) => row && row.provider === provider);
    if (index >= 0) known[index] = entry;
    else known.push(entry);
    this._write({ ...data, version: 1, providers: Array.isArray(data.providers) ? data.providers : [], known });
    return this.knownStatus();
  }

  /** Remove one provider's key. */
  async clearKnown(provider) {
    const data = this._read();
    const known = (Array.isArray(data.known) ? data.known : []).filter((row) => row && row.provider !== provider);
    this._write({ ...data, version: 1, providers: Array.isArray(data.providers) ? data.providers : [], known });
    return this.knownStatus();
  }

  /** Masked status per known provider — never returns the key itself. */
  async knownStatus() {
    const data = this._read();
    const known = (Array.isArray(data.known) ? data.known : []).slice(0, 40);
    const rows = await Promise.all(Object.entries(RamoApiProviders.KNOWN).map(async ([id, def]) => {
      const row = known.find((item) => item && item.provider === id);
      let masked = null;
      if (row) {
        try { masked = '••••' + String(await this._keyKnown(row)).slice(-4); } catch { masked = null; }
      }
      return { provider: id, name: def.name, saved: !!masked, masked, savedAt: row?.savedAt || null };
    }));
    return rows;
  }

  /**
   * A live call against a known provider with its stored key. Same transport
   * the model profiles use, so a key saved in Settings is genuinely wired into
   * the provider configuration — not a placeholder.
   */
  async knownChat(provider, payload, { signal, onChunk = () => {} } = {}) {
    const def = RamoApiProviders.KNOWN[provider];
    if (!def) throw Error('Ramo does not know that provider yet.');
    const data = this._read();
    const row = (Array.isArray(data.known) ? data.known : []).find((item) => item && item.provider === provider);
    if (!row) throw Error(`No ${def.name} key saved. Paste one in Settings → API keys.`);
    const key = await this._keyKnown(row);
    const headers = { ...(def.headers || {}), ...(def.auth === 'x-api-key' ? { 'x-api-key': key } : { Authorization: 'Bearer ' + key }) };
    return this._execute(def.endpoint, headers, payload, { signal, onChunk });
  }

  /**
   * Fetch the provider's live model catalogue with an API key. When the
   * profile id is supplied (editing an existing row) and no fresh key is
   * typed, the stored key is used and the saved endpoint/auth are kept.
   * Never echoes the key; error text is redacted before it surfaces.
   */
  async fetchModels(input = {}) {
    const editingId = String(input.id || '').trim();
    let endpoint = String(input.endpoint || '').trim();
    let auth = input.auth === 'x-api-key' ? 'x-api-key' : (input.auth === 'bearer' ? 'bearer' : '');
    let key = String(input.apiKey || '').trim();
    if (editingId) {
      const row = this._read().providers.find((item) => item.id === editingId);
      if (row) {
        if (!endpoint) endpoint = row.endpoint;
        if (!auth) auth = row.auth === 'x-api-key' ? 'x-api-key' : 'bearer';
        if (!key) key = await this._key(row);
      } else if (!endpoint || !key) {
        throw Error('That API model profile no longer exists.');
      }
    }
    if (!endpoint) throw Error('Enter the API base URL first, then fetch the model list.');
    if (!auth) auth = 'bearer';
    if (!key) throw Error('Enter the API key first, then fetch the model list.');
    if (/[\r\n]/.test(key) || key.length > 4096) throw Error('Enter a valid API key.');
    const modelsUrl = normalizeModelsBase(endpoint) + '/models';
    const headers = auth === 'x-api-key' ? { 'x-api-key': key } : { 'Authorization': 'Bearer ' + key };
    let response;
    try { response = await this.fetchImpl(modelsUrl, { method: 'GET', headers, redirect: 'error' }); }
    catch (error) {
      if (error?.name === 'AbortError') throw Error('Model list request cancelled.');
      throw Error('The provider could not be reached. Check the endpoint and your network connection.');
    }
    if (!response.ok) {
      let bodyText = '';
      try { if (typeof response.text === 'function') bodyText = await response.text(); } catch {}
      let detail = '';
      try { const parsed = bodyText ? JSON.parse(bodyText) : null; const envelope = Array.isArray(parsed) ? parsed[0] : parsed; const remote = envelope?.error ?? envelope; detail = typeof remote?.message === 'string' ? remote.message : (typeof remote === 'string' ? remote : ''); } catch { detail = bodyText; }
      detail = (key ? String(detail).split(key).join('[configured credential]') : String(detail)).trim().slice(0, 300);
      throw Error('Provider returned HTTP ' + (response.status || 0) + (response.statusText ? ' ' + response.statusText : '') + (detail ? ': ' + detail : '') + '. Check the base URL and the key.');
    }
    let json;
    try { json = typeof response.json === 'function' ? await response.json() : JSON.parse(await response.text()); }
    catch { throw Error('The provider did not return a readable model list (expected JSON).'); }
    const models = extractModelRows(json);
    if (!models.length) throw Error('The provider returned an empty model list. Check the base URL covers chat models.');
    return { models, count: models.length, url: modelsUrl };
  }

  /** safeStorage round-trips within a single process here, but its key does
      not survive an app restart in this build environment (the platform
      reports no key-store backend, and the blob becomes unreadable in the
      next process). A per-installation secret and a stable AES-256-GCM
      envelope are the sanctioned app-data-at-rest encryption; safeStorage is
      kept only for rows written by earlier builds of this app. */
  static FALLBACK_MARKER = 'v1:aes:';
  _installSecret() {
    const saltPath = path.join(path.dirname(this.filePath), '.keystore-salt');
    try {
      const existing = fs.readFileSync(saltPath, 'utf8').trim();
      if (existing.length >= 32) return Buffer.from(existing, 'base64');
    } catch { /* fall through and create it */ }
    const salt = randomBytes(32).toString('base64');
    try { fs.writeFileSync(saltPath, salt, { encoding: 'utf8', mode: 0o600 }); } catch { /* best effort */ }
    return Buffer.from(salt, 'base64');
  }
  /** The envelope passphrase moved with the product rename. The legacy
      identifier survives only so provider keys saved by earlier builds still
      decrypt; new writes always use the current one. */
  static LEGACY_KEY_PASSPHRASE = 'oceanic-unified-key-v1';
  _localKey(legacy = false) {
    const passphrase = legacy ? RamoApiProviders.LEGACY_KEY_PASSPHRASE : 'ramo-unified-key-v1';
    return createHash('sha256').update(passphrase + '\n' + os.hostname() + '\n' + os.userInfo().username + '\n').update(this._installSecret()).digest();
  }
  _localEncrypt(plaintext) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this._localKey(), iv);
    const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
    return RamoApiProviders.FALLBACK_MARKER + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  }
  _localDecrypt(value) {
    const raw = Buffer.from(String(value).slice(RamoApiProviders.FALLBACK_MARKER.length), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    for (const legacy of [false, true]) {
      try {
        const decipher = createDecipheriv('aes-256-gcm', this._localKey(legacy), iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
      } catch { /* try the legacy passphrase next */ }
    }
    throw new Error('saved key matches neither the current nor the legacy installation passphrase');
  }
  _encryptKnown(plaintext) {
    return this._localEncrypt(plaintext);
  }
  async _decryptKnown(value) {
    const text = String(value || '');
    if (text.startsWith(RamoApiProviders.FALLBACK_MARKER)) {
      try { return this._localDecrypt(text); } catch { throw Error('A saved provider key could not be unlocked. Re-enter it in Settings → API keys.'); }
    }
    return this._keyKnownPrevious(value);
  }
  async _keyKnownPrevious(value) {
    if (!(await this._encryptionAvailable())) throw Error('Secure credential storage is unavailable; API requests are disabled.');
    try { return await _safeStorageDecrypt(this.safeStorage, String(value || '')); } catch { throw Error('A saved provider key could not be unlocked. Re-enter it in Settings → API keys.'); }
  }
  async _keyKnown(row) {
    return this._decryptKnown(row.keyCiphertext);
  }
  _execute(endpoint, authHeader, payload, { signal, onChunk = () => {} } = {}) {
    const headers = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream, application/json', ...authHeader };
    const request = { ...payload, stream: true };
    return this._deliver(endpoint, headers, request, { signal, onChunk });
  }
  async _deliver(endpoint, headers, request, { signal, onChunk = () => {} } = {}) {
    let response;
    try{response=await this.fetchImpl(endpoint,{method:'POST',headers,body:JSON.stringify(request),signal,redirect:'error'});}
    catch(error){if(signal?.aborted||error?.name==='AbortError')throw Error('API request cancelled.');throw Error('API provider could not be reached. Check the endpoint and network connection.');}
    if(!response.ok){
      let payload=null,bodyText='';
      try{
        if(typeof response.text==='function'){bodyText=await response.text();try{payload=JSON.parse(bodyText);}catch{}}
        else payload=await response.json();
      }catch{}
      const envelope=Array.isArray(payload)?payload[0]:payload;
      const remote=envelope?.error??envelope;
      const message=typeof remote?.message==='string'?remote.message:typeof remote==='string'?remote:bodyText;
      const secret=Object.values(headers).map(String).find((value)=>value.startsWith('Bearer '));
      const key=secret?secret.slice(7):null;
      const redact=(value)=>key&&value?String(value).split(key).join('[configured credential]'):String(value??'');
      const detail=redact(message).slice(0,1600);
      const error=Error('API provider returned HTTP '+response.status+(response.statusText?' '+response.statusText:'')+(detail?': '+detail:''));
      error.status=response.status;
      error.providerCode=redact(String(remote?.status??remote?.code??'')).slice(0,100);
      throw error;
    }
    const contentType=response.headers?.get?.('content-type')||'';
    if(!/text\/event-stream/i.test(contentType)){
      let result;try{result=await response.json();}catch{throw Error('API provider returned an unreadable response.');}
      const choice=result?.choices?.[0];if(!choice)throw Error('API provider returned no chat completion.');
      onChunk({choices:[{delta:choice.message||{},finish_reason:choice.finish_reason||null}],usage:result.usage});
      return {usage:result.usage||{},finish_reason:choice.finish_reason||'stop'};
    }
    if(!response.body?.getReader)throw Error('API provider streaming is unavailable.');
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',eventData=[],usage={},finishReason='stop';
    const dispatch=()=>{
      if(!eventData.length)return;
      const raw=eventData.join('\n');eventData=[];
      if(raw.trim()==='[DONE]')return;
      let event;try{event=JSON.parse(raw);}catch{throw Error('API provider returned malformed streaming data.');}
      if(event.usage)usage=event.usage;
      const choice=event.choices?.[0];if(choice?.finish_reason)finishReason=String(choice.finish_reason);
      if(event.choices?.length)onChunk(event);
    };
    const consumeLine=line=>{
      if(line===''){dispatch();return;}
      if(line.startsWith(':'))return;
      const colon=line.indexOf(':'),field=colon<0?line:line.slice(0,colon),value=colon<0?'':line.slice(colon+1).replace(/^ /,'');
      if(field==='data')eventData.push(value);
    };
    try{
      while(true){
        const {value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});
        let newline;while((newline=buffer.indexOf('\n'))>=0){let line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(line.endsWith('\r'))line=line.slice(0,-1);consumeLine(line);}
        if(done)break;
        if(signal?.aborted)throw Error('API request cancelled.');
      }
      if(buffer)consumeLine(buffer.endsWith('\r')?buffer.slice(0,-1):buffer);
      dispatch();
    }catch(error){try{await reader.cancel();}catch{}if(signal?.aborted||error?.name==='AbortError')throw Error('API request cancelled.');throw error;}
    return {usage,finish_reason:finishReason};
  }
  async _key(row){
    if(String(row.keyCiphertext||'').startsWith(RamoApiProviders.FALLBACK_MARKER))return this._decryptKnown(row.keyCiphertext);
    if(!(await this._encryptionAvailable()))throw Error('Secure credential storage is unavailable; API requests are disabled.');
    try{return await _safeStorageDecrypt(this.safeStorage,String(row.keyCiphertext||''));}catch{throw Error('The saved API key could not be unlocked. Re-enter the key in API model settings.');}
  }
  async chat(id,payload,{signal,onChunk=()=>{}}={}){
    const row=this._read().providers.find(item=>item.id===String(id));
    if(!row)throw Error('API model profile was not found.');
    if(signal?.aborted)throw Error('API request cancelled.');
    const key=await this._key(row);
    const definition=RamoApiProviders.KNOWN[row.provider],headers={...(definition?.headers||{})};headers[row.auth==='x-api-key'?'x-api-key':'Authorization']=row.auth==='x-api-key'?key:'Bearer '+key;
    return this._deliver(row.endpoint,headers,{...payload,model:row.model,stream:true},{signal,onChunk});
  }
}

module.exports={RamoApiProviders,GEMINI_ENDPOINT,normalizeEndpoint,normalizeModelsBase,extractModelRows,createElectronFetch};
