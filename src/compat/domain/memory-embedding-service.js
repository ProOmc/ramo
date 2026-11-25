import {text,researchArray,rows,MEMORY_EMBED_MODEL_STORAGE,MEMORY_DB,activeObservation} from './helpers.js';

class MemoryEmbeddingService {
    constructor(host,store,transport){this.host=host;this.store=store;this.transport=transport;this.detected=false;this.disabledReason='';this.lastStats={};}
    model(){try{return text(this.host._storageGet?.(MEMORY_EMBED_MODEL_STORAGE)||'').trim();}catch(_){return '';}}
    setModel(value){const v=text(value).trim();try{this.host._storageSet?.(MEMORY_EMBED_MODEL_STORAGE,v);}catch(_){}this.detected=!!v;this.disabledReason='';return v;}
    endpoint(){return text(this.host.variable('Ollama Chat URL')||'http://127.0.0.1:11434/api/chat').replace(/\/api\/chat(?:[/?#].*)?$/i,'/api/embed');}
    async detect(signal){
      let configured=this.model();if(configured)return configured;if(this.detected)return '';
      this.detected=true;
      try{
        const tags=this.endpoint().replace(/\/api\/embed$/,'/api/tags'),r=await this.transport.get(tags,{},signal,5000),names=researchArray(r?.models).map(x=>text(x?.name||x?.model));
        const preferred=['embeddinggemma','qwen3-embedding','all-minilm'];
        for(const base of preferred){const hit=names.find(n=>n===base||n.split(':')[0]===base);if(hit){this.setModel(hit);return hit;}}
        // Say so explicitly. A silent empty arm is indistinguishable from
        // "nothing matched", which is the failure this arm exists to fix.
        this.disabledReason='No embedding model is installed. Pull one (for example embeddinggemma or all-minilm) to enable semantic memory.';
      }catch(e){this.disabledReason=e.message;}
      return '';
    }
    async open(){
      if(typeof indexedDB==='undefined')return null;
      return new Promise(resolve=>{const req=indexedDB.open(MEMORY_DB,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('vectors'))db.createObjectStore('vectors',{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=req.onblocked=()=>resolve(null);});
    }
    async clear(){
      const db=await this.open();if(!db)return false;
      return new Promise(resolve=>{const tx=db.transaction('vectors','readwrite');tx.objectStore('vectors').clear();tx.oncomplete=()=>{db.close();resolve(true);};tx.onerror=tx.onabort=()=>{db.close();resolve(false);};});
    }
    signalText(id){
      const f=this.store.data.facts.find(x=>x.id===id)||this.store.data.observations.find(x=>x.id===id);if(!f)return '';
      const names=(f.entity_ids||[]).map(eid=>this.store.data.entities.find(e=>e.id===eid)?.name||'').filter(Boolean);
      return [f.content||f.statement,f.subject,f.predicate,f.object,f.why,...(f.keywords||[]),...names].filter(Boolean).join(' ');
    }
    async _embed(input,signal){
      const model=await this.detect(signal);if(!model)return [];
      try{
        const started=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now(),r=await this.transport.get(this.endpoint(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,input,truncate:true})},signal,60000);
        if(r.error)throw Error(r.error);this.lastStats={model,total_ms:Number(r.total_duration||0)/1e6,load_ms:Number(r.load_duration||0)/1e6,prompt_tokens:Number(r.prompt_eval_count||0),wall_ms:((typeof performance!=='undefined'&&performance.now)?performance.now():Date.now())-started};
        this.disabledReason='';return Array.isArray(r.embeddings)?r.embeddings:[];
      }catch(e){if(signal?.aborted)throw e;this.disabledReason=e.message;return [];}
    }
    async index(ids,signal){
      const unique=[...new Set(ids)].filter(Boolean),texts=unique.map(id=>this.signalText(id));if(!unique.length||texts.some(x=>!x))return 0;
      const vectors=await this._embed(texts,signal);if(vectors.length!==unique.length)return 0;
      const model=this.model(),db=await this.open();if(!db)return 0;
      return new Promise(resolve=>{const tx=db.transaction('vectors','readwrite'),s=tx.objectStore('vectors');for(let i=0;i<unique.length;i++)s.put({id:unique[i],model,vector:vectors[i],updated:new Date().toISOString()});tx.oncomplete=()=>{db.close();resolve(unique.length);};tx.onerror=tx.onabort=()=>{db.close();resolve(0);};});
    }
    async _all(model){
      const db=await this.open();if(!db)return [];
      return new Promise(resolve=>{const rows=[];const tx=db.transaction('vectors','readonly'),req=tx.objectStore('vectors').openCursor();req.onsuccess=()=>{const c=req.result;if(!c)return;if(c.value?.model===model&&Array.isArray(c.value.vector))rows.push(c.value);c.continue();};tx.oncomplete=tx.onerror=tx.onabort=()=>{db.close();resolve(rows);};});
    }
    async search(query,limit=14,signal){
      const model=await this.detect(signal);if(!model)return [];
      const [qv]=await this._embed(text(query),signal);if(!Array.isArray(qv)||!qv.length)return [];
      const rows=await this._all(model),out=[];
      for(const r of rows){const v=r.vector;if(v.length!==qv.length)continue;let dot=0;for(let i=0;i<v.length;i++)dot+=v[i]*qv[i];if(dot>.2)out.push({id:r.id,score:dot});}
      return out.sort((a,b)=>b.score-a.score).slice(0,limit);
    }
    async reindexAll(signal){
      await this.clear();const ids=[...this.store.data.facts.filter(f=>f.status==='active').map(f=>f.id),...this.store.data.observations.filter(o=>activeObservation(o,this.store.data)).map(o=>o.id)];
      let count=0;for(let i=0;i<ids.length;i+=12){if(signal?.aborted)throw Error('Embedding indexing cancelled.');count+=await this.index(ids.slice(i,i+12),signal);}return count;
    }
  }
export {MemoryEmbeddingService};
