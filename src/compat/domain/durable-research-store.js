import {text,rows,v33Clone,v33Stable,researchNow} from './helpers.js';

class DurableResearchStore {
    constructor(){this.name='AI_ASSISTANT_R282_DURABLE';this.version=3;this.error='';this.ready=null;this.failures=0;this.lastFailureAt='';}
    noteFailure(message){this.ready=false;this.failures=(this.failures||0)+1;this.lastFailureAt=researchNow();this.error=text(message||'IndexedDB failure');}
    async open(){
      if(typeof indexedDB==='undefined'){this.noteFailure('IndexedDB unavailable');return null;}
      const required=['documents','research_jobs','knowledge','research_records','searches','model_transcripts','chat_media','meta'];
      const createMissing=db=>{for(const n of required)if(!db.objectStoreNames.contains(n))db.createObjectStore(n,{keyPath:'id'});};
      // Never open an existing database with a hard-coded lower version. Browsers retain the
      // highest version previously created, so doing so throws VersionError and can force a
      // huge research job into localStorage. First open the current version, then upgrade only
      // when required stores are actually missing.
      const openCurrent=()=>new Promise(resolve=>{
        let settled=false,r;
        const finish=db=>{if(settled){try{db?.close?.();}catch{}return;}settled=true;resolve(db||null);};
        try{r=indexedDB.open(this.name);}catch(e){this.noteFailure('IndexedDB open exception: '+e.message);finish(null);return;}
        r.onupgradeneeded=()=>{try{createMissing(r.result);}catch(e){this.noteFailure('IndexedDB initial schema creation failed: '+e.message);}};
        r.onsuccess=()=>finish(r.result);
        r.onerror=()=>{this.noteFailure('IndexedDB open failed: '+text(r.error?.message||r.error||'unknown error'));finish(null);};
        r.onblocked=()=>{this.noteFailure('IndexedDB open blocked by another connection');finish(null);};
      });
      let db=await openCurrent();if(!db)return null;
      try{
        let missing=required.filter(n=>!db.objectStoreNames.contains(n));
        if(missing.length){
          const nextVersion=Math.max(Number(db.version)||1,this.version||1)+1;try{db.close();}catch{}db=null;
          db=await new Promise(resolve=>{
            let settled=false,r;const finish=value=>{if(settled){try{value?.close?.();}catch{}return;}settled=true;resolve(value||null);};
            try{r=indexedDB.open(this.name,nextVersion);}catch(e){this.noteFailure('IndexedDB schema upgrade open exception: '+e.message);finish(null);return;}
            r.onupgradeneeded=()=>{try{createMissing(r.result);}catch(e){this.noteFailure('IndexedDB schema upgrade failed: '+e.message);}};
            r.onsuccess=()=>finish(r.result);
            r.onerror=()=>{this.noteFailure('IndexedDB schema upgrade failed to open: '+text(r.error?.message||r.error||'unknown error'));finish(null);};
            r.onblocked=()=>{this.noteFailure('IndexedDB schema upgrade blocked by another connection');finish(null);};
          });
          if(!db)return null;missing=required.filter(n=>!db.objectStoreNames.contains(n));
          if(missing.length){this.noteFailure('IndexedDB schema missing stores after upgrade: '+missing.join(', '));try{db.close();}catch{}return null;}
        }
        this.version=Math.max(this.version||1,Number(db.version)||1);this.ready=true;this.error='';return db;
      }catch(e){this.noteFailure('IndexedDB validation failed: '+e.message);try{db?.close?.();}catch{}return null;}
    }
    async put(store,value){
      if(!value?.id){this.noteFailure('IndexedDB write rejected: missing record id for '+store);return false;}
      let db=null;
      try{
        db=await this.open();if(!db)return false;
        if(!db.objectStoreNames.contains(store)){this.noteFailure('IndexedDB object store missing: '+store);db.close();return false;}
        return await new Promise(resolve=>{
          let settled=false,tx;
          const done=ok=>{if(settled)return;settled=true;try{db.close();}catch{}resolve(ok);};
          try{tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);}
          catch(e){this.noteFailure('IndexedDB write exception ['+store+']: '+e.message);done(false);return;}
          tx.oncomplete=()=>{this.ready=true;this.error='';done(true);};
          tx.onerror=tx.onabort=()=>{this.noteFailure('IndexedDB write failed ['+store+']: '+text(tx.error?.message||tx.error||'transaction aborted'));done(false);};
        });
      }catch(e){this.noteFailure('IndexedDB write failure ['+store+']: '+e.message);try{db?.close?.();}catch{}return false;}
    }
    async get(store,id){
      let db=null;
      try{
        db=await this.open();if(!db||!db.objectStoreNames.contains(store))return null;
        return await new Promise(resolve=>{
          let settled=false,r,tx;const done=v=>{if(settled)return;settled=true;try{db.close();}catch{}resolve(v);};
          try{tx=db.transaction(store,'readonly');r=tx.objectStore(store).get(id);}catch(e){this.noteFailure('IndexedDB read exception ['+store+']: '+e.message);done(null);return;}
          r.onsuccess=()=>done(r.result||null);r.onerror=()=>{this.noteFailure('IndexedDB read failed ['+store+']');done(null);};
          tx.onerror=tx.onabort=()=>{this.noteFailure('IndexedDB read transaction failed ['+store+']');done(null);};
        });
      }catch(e){this.noteFailure('IndexedDB read failure ['+store+']: '+e.message);try{db?.close?.();}catch{}return null;}
    }
    async all(store){
      let db=null;
      try{
        db=await this.open();if(!db||!db.objectStoreNames.contains(store))return [];
        return await new Promise(resolve=>{
          let settled=false,r,tx;const done=v=>{if(settled)return;settled=true;try{db.close();}catch{}resolve(Array.isArray(v)?v:[]);};
          try{tx=db.transaction(store,'readonly');r=tx.objectStore(store).getAll();}catch(e){this.noteFailure('IndexedDB list exception ['+store+']: '+e.message);done([]);return;}
          r.onsuccess=()=>done(r.result);r.onerror=()=>{this.noteFailure('IndexedDB list failed ['+store+']');done([]);};
          tx.onerror=tx.onabort=()=>{this.noteFailure('IndexedDB list transaction failed ['+store+']');done([]);};
        });
      }catch(e){this.noteFailure('IndexedDB list failure ['+store+']: '+e.message);try{db?.close?.();}catch{}return [];}
    }
    mergeById(a,b) {
      const m=new Map();for(const x of [...(a||[]),...(b||[])])if(x?.id){
        const old=m.get(x.id);
        if(x.v33||old?.v33||x.engine==='agent_v2'||old?.engine==='agent_v2'){
          // Compact rows are pointers, never substitutes for complete evidence.
          if(x.storage_compacted){if(!old)m.set(x.id,x);continue;}
          if(old&&!old.storage_compacted&&(old.revision||0)>(x.revision||0))continue;
          if(old&&!old.storage_compacted&&(old.revision||0)===(x.revision||0)&&v33Stable(old)!==v33Stable(x))this.error='Hydration revision conflict: '+x.id;
        }
        m.set(x.id,x);
      }return [...m.values()];
    }
    async persistState(data){try{const tasks=[];for(const d of data.documents||[])if(d?.id)tasks.push(this.put('documents',d));for(const j of data.jobs||[])if(j?.id)tasks.push(this.saveJob(j));for(const k of data.knowledge||[])if(k?.id)tasks.push(this.put('knowledge',k));for(const r of data.researchRecords||[])if(r?.id)tasks.push(this.put('research_records',r));for(const s of data.searches||[])if(s?.id)tasks.push(this.put('searches',s));await Promise.all(tasks);return true;}catch(e){this.error=e.message;return false;}}
    async migrateAndHydrate(store){
      this.error='';
      const names=['documents','research_jobs','knowledge','research_records','searches'];
      let [documents,jobs,knowledge,researchRecords,searches]=await Promise.all(names.map(n=>this.all(n)));
      if(this.ready===false)throw Error(this.error||'Durable IndexedDB is unavailable.');
      const byId=a=>new Map((a||[]).filter(x=>x?.id).map(x=>[x.id,x])),dm=byId(documents),jm=byId(jobs),km=byId(knowledge),rm=byId(researchRecords),sm=byId(searches),migrations=[];
      const richerDoc=(a,b)=>text(a?.content).length>text(b?.content).length||((a?.revisions||[]).length>(b?.revisions||[]).length);
      const richerJob=(a,b)=>a?.v33||b?.v33 ? (!a.storage_compacted && (Number(a.revision)||0)>(Number(b?.revision)||0)) : (a?.claims?.length||0)+(a?.sources?.length||0)+Math.min(20,Math.floor(text(a?.report).length/1000))>(b?.claims?.length||0)+(b?.sources?.length||0)+Math.min(20,Math.floor(text(b?.report).length/1000));
      const richerKnowledge=(a,b)=>(a?.claims?.length||0)+(a?.sources?.length||0)+Math.min(10,Math.floor(text(a?.summary).length/500))>(b?.claims?.length||0)+(b?.sources?.length||0)+Math.min(10,Math.floor(text(b?.summary).length/500));
      for(const d of store.data.documents||[])if(d?.id&&typeof d.content==='string'&&(!dm.has(d.id)||richerDoc(d,dm.get(d.id))))migrations.push(this.put('documents',{...d,durable:true}));
      for(const j of store.data.jobs||[])if(j?.id&&(j.sources?.length||j.claims?.length)&&(!jm.has(j.id)||richerJob(j,jm.get(j.id))))migrations.push(this.saveJob(j));
      for(const k of store.data.knowledge||[])if(k?.id&&(k.sources?.length||k.claims?.length||k.summary)&&(!km.has(k.id)||richerKnowledge(k,km.get(k.id))))migrations.push(this.put('knowledge',k));
      for(const r of store.data.researchRecords||[])if(r?.id&&r.claim&&r.source_url&&!rm.has(r.id))migrations.push(this.put('research_records',r));
      for(const q of store.data.searches||[])if(q?.id&&q.query&&!sm.has(q.id))migrations.push(this.put('searches',q));
      if(migrations.length){const results=await Promise.all(migrations);if(results.some(x=>x!==true))throw Error(this.error||'One or more durable migration writes failed.');[documents,jobs,knowledge,researchRecords,searches]=await Promise.all(names.map(n=>this.all(n)));if(this.ready===false)throw Error(this.error||'Durable IndexedDB became unavailable during hydration.');}
      store.data.documents=this.mergeById(store.data.documents,documents.map(d=>({...d,durable:true})));
      store.data.jobs=this.mergeById(store.data.jobs,jobs).slice(-30);
      store.data.knowledge=this.mergeById(store.data.knowledge,knowledge);
      store.data.researchRecords=this.mergeById(store.data.researchRecords,researchRecords);
      store.data.searches=this.mergeById(store.data.searches,searches).slice(-80);
      const metaOK=await this.put('meta',{id:'migration',version:this.version,at:new Date().toISOString(),documents:store.data.documents.length,jobs:store.data.jobs.length,hydration:'durable_first'});if(metaOK!==true)throw Error(this.error||'Could not confirm durable hydration metadata.');
      if(!store.save())throw Error(store.error||'Could not persist compact hydrated metadata.');
      return true;
    }
    async saveJob(job) {
      if(!job?.v33&&job?.engine!=='agent_v2')return this.put('research_jobs',v33Clone(job));
      // Clone BEFORE queueing: later mutations cannot alter the queued revision.
      const snapshot=v33Clone(job);delete snapshot.storage_compacted;
      const serial=v33Stable(snapshot);
      this.jobQueues??=new Map();
      const pending=(this.jobQueues.get(job.id)||Promise.resolve()).catch(()=>false).then(async()=>{
        const old=await this.get('research_jobs',snapshot.id);
        if((old?.v33||old?.engine==='agent_v2')&&Number(old.revision)>snapshot.revision){this.error='Rejected stale research revision';return false;}
        if((old?.v33||old?.engine==='agent_v2')&&old.revision===snapshot.revision){
          if(v33Stable(old)===serial)return true;
          this.error='Conflicting content for research revision '+snapshot.revision;
          await this.put('meta',{id:'conflict_'+snapshot.id+'_'+snapshot.revision,at:researchNow(),reason:this.error});return false;
        }
        return this.put('research_jobs',snapshot);
      });
      this.jobQueues.set(job.id,pending);return pending;
    }
    async saveDocument(doc){return this.put('documents',JSON.parse(JSON.stringify(doc)));}
    async saveModelTranscript(record){return record?.id?this.put('model_transcripts',JSON.parse(JSON.stringify(record))):false;}
    async listModelTranscripts(researchId){const rows=await this.all('model_transcripts');return rows.filter(r=>r?.research_id===researchId).sort((a,b)=>String(a.started_at||'').localeCompare(String(b.started_at||'')));}
    async delete(store,id){
      if(!id)return false;const db=await this.open();if(!db)return false;
      return new Promise(resolve=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(id);tx.oncomplete=()=>{db.close();resolve(true);};tx.onerror=tx.onabort=()=>{this.error='IndexedDB delete failed: '+store;db.close();resolve(false);};});
    }
  }
export {DurableResearchStore};
