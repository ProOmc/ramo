import {text,norm,hash,researchArray,clamp,expandedWords,jaccard,contentTerms,OBSERVATION_SCHEMA,OBSERVATION_SYSTEM} from './helpers.js';

class MemoryConsolidator {
    constructor(host,store,memory,model,embedding){this.host=host;this.store=store;this.memory=memory;this.model=model;this.embedding=embedding;this.timer=null;this.running=false;this.controller=null;this.lastError='';}
    interrupt(){if(this.timer){clearTimeout(this.timer);this.timer=null;}if(this.controller)this.controller.abort();}
    maybeSchedule(delay=5000){if((this.store.data.memoryStats?.new_since_consolidation||0)<6||this.timer||this.running)return;this.timer=setTimeout(()=>{this.timer=null;this.run();},delay);}
    _cluster(){
      const facts=this.store.data.facts.filter(f=>f.status==='active'&&f.owner==='user').sort((a,b)=>String(b.updated).localeCompare(String(a.updated))).slice(0,80),groups=new Map();
      const add=(k,f)=>{if(!k)return;const a=groups.get(k)||[];if(!a.some(x=>x.id===f.id))a.push(f);groups.set(k,a);};
      for(const f of facts){for(const id of (f.entity_ids||[]).filter(id=>id!=='entity_user'))add('e:'+id,f);if(['preference','project','goal','skill'].includes(f.kind))add('k:'+f.kind,f);}
      return [...groups.values()].filter(g=>g.length>=3).sort((a,b)=>b.length-a.length)[0]?.slice(0,8)||[];
    }
    async run(force=false){
      if(this.running)return [];if(!force&&this.host.session){this.maybeSchedule(3000);return [];}const cluster=this._cluster();
      if(cluster.length<3){this.store.data.memoryStats.new_since_consolidation=0;this.store.data.memoryStats.last_consolidated_at=new Date().toISOString();this.store.save();return [];}
      this.running=true;this.controller=new AbortController();const previous=text(this.host.variable?.('Core Activity')||'READY');
      try{
        if(!this.host.session)this.host.setVariable?.('Core Activity','LEARNING PATTERNS');
        const allowed=new Set(cluster.map(f=>f.id)),payload=await this.model.structured([{role:'system',content:OBSERVATION_SYSTEM},{role:'user',content:JSON.stringify({MEMORIES:cluster.map(f=>({id:f.id,statement:f.content,kind:f.kind,subject:f.subject,predicate:f.predicate,object:f.object}))})}],OBSERVATION_SCHEMA,this.controller.signal,'memory_reflect',260);
        const created=[],now=new Date().toISOString();
        this.store.transact(d=>{
          for(const raw of Array.isArray(payload.observations)?payload.observations:[]){
            const sourceIds=[...new Set(researchArray(raw.source_memory_ids).filter(id=>allowed.has(id)&&d.facts.some(f=>f.id===id&&f.status==='active')))];if(sourceIds.length<2)continue;
            const statement=text(raw.statement).replace(/\s+/g,' ').trim().slice(0,700);if(statement.length<8)continue;
            const evidenceWords=new Set(expandedWords(d.facts.filter(f=>sourceIds.includes(f.id)).map(f=>f.content).join(' ')));
            const claimWords=contentTerms(statement);if(!claimWords.length||claimWords.filter(w=>evidenceWords.has(w)||evidenceWords.has(w.replace(/s$/,''))).length/claimWords.length<.55)continue;
            const confidence=clamp(raw.confidence,.5,.85);let existing=d.observations.find(o=>o.status!=='superseded'&&(norm(o.content)===norm(statement)||jaccard(o.content,statement)>.76));
            const entityIds=[];for(const name of researchArray(raw.entities)){const e=this.memory._resolveEntity(d,name,'other');if(e&&!entityIds.includes(e.id))entityIds.push(e.id);}
            if(existing){existing.source_memory_ids=[...new Set([...researchArray(existing.source_memory_ids),...sourceIds])].slice(-30);existing.proof_count=existing.source_memory_ids.length;existing.updated=now;existing.confidence=Math.max(existing.confidence||0,confidence);existing.entity_ids=[...new Set([...researchArray(existing.entity_ids),...entityIds])];created.push(existing.id);}
            else{const id='obs_'+hash(norm(statement));d.observations.push({id,content:statement,type:'observation',kind:'observation',status:'active',confidence,importance:.82,source_memory_ids:sourceIds,proof_count:sourceIds.length,entity_ids:entityIds,created_at:now,updated:now,support_count:sourceIds.length,retrieval_count:0,used_count:0});this.store.log(d,'observation learned',id,statement);created.push(id);}
          }
          d.memoryStats.new_since_consolidation=0;d.memoryStats.last_consolidated_at=now;
        });
        if(created.length)try{await this.embedding.index(created,this.controller.signal);}catch(e){if(this.controller.signal.aborted)throw e;}
        this.lastError='';return created;
      }catch(e){if(!this.controller.signal.aborted)this.lastError=e.message;return [];}
      finally{this.controller=null;this.running=false;if(!this.host.session&&text(this.host.variable?.('Core Activity'))==='LEARNING PATTERNS')this.host.setVariable?.('Core Activity',previous==='READY'?'READY':previous);}
    }
  }
export {MemoryConsolidator};
