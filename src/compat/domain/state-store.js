import {STORE,text,norm,hash,json,researchArray,rows,human,MEMORY_SCHEMA_VERSION,simpleMemoryKey,compactResearchJobForStorage,boundedResearchJobForLocal,compactDocumentForStorage,v33Clone} from './helpers.js';

class StateStore {
    constructor(storage){
      this.storage=storage;this.error='';
      this.data={
        schema:MEMORY_SCHEMA_VERSION,
        facts:[],factHistory:[],entities:[],relations:[],observations:[],associations:[],retainQueue:[],
        memoryStats:{retained:0,rejected:0,duplicates:0,updates:0,new_since_consolidation:0,last_consolidated_at:'',last_retained_at:''},
        journal:[],knowledge:[],researchRecords:[],searches:[],review:[],jobs:[],documents:[],forgotten:[],
        working:{turns:[],entity:'',request:'',shown:[],updated:0},
        chats:[],activeChatId:'main',
        researchState:{active:null,recent:[],turnCounter:0},imports:[],forgottenEvidence:[]
      };
      this.load();this._ensureChats();this._ensureUserEntity();
    }
    attachDurable(durable){this.durable=durable;}
    _chatImages(value=this.data){
      const images=[],seen=new WeakSet();
      const visit=node=>{if(!node||typeof node!=='object'||seen.has(node))return;seen.add(node);if(Array.isArray(node.images))for(const image of node.images)if(image&&typeof image==='object'&&(typeof image.data==='string'||typeof image.mediaId==='string'))images.push(image);for(const [key,child] of Object.entries(node))if(key!=='images'&&child&&typeof child==='object')visit(child);};
      visit(value);return images;
    }
    async persistChatImages(value=this.data){
      this._committedImageData??=new Map();
      for(const image of this._chatImages(value)){
        if(!image.data){if(image.mediaId)continue;throw Error('Image bytes are missing. Attach the image again.');}
        if(image.mediaId&&this._committedImageData.get(image.mediaId)===image.data)continue;
        if(!this.durable)throw Error('Durable image storage is unavailable. The image attachment is preserved; try again when local storage is available.');
        const id='chat_image_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)+'_'+Math.random().toString(36).slice(2);
        const ok=await this.durable.put('chat_media',{id,data:image.data,mimeType:image.mimeType,name:image.name||'image',created:new Date().toISOString()});
        if(ok!==true)throw Error('Could not save the image to durable local storage. The attachment is preserved. '+text(this.durable.error));
        image.mediaId=id;this._committedImageData.set(id,image.data);
      }
    }
    async hydrateChatImages(){
      this._committedImageData??=new Map();
      for(const image of this._chatImages())if(image.mediaId&&!image.data){
        const record=await this.durable?.get('chat_media',image.mediaId);
        if(!record?.data)throw Error('A saved image could not be loaded from durable local storage. Restore a JSON chat backup containing its images.');
        image.data=record.data;this._committedImageData.set(image.mediaId,image.data);
      }
      await this.persistChatImages();
    }
    _serializeLocalState(value){
      return JSON.stringify(value,(key,item)=>{
        if(item&&typeof item==='object'&&typeof item.data==='string'&&item.mediaId&&this._committedImageData?.get(item.mediaId)===item.data){const {data,...reference}=item;return reference;}
        return item;
      });
    }

    _blankWorking(){return {turns:[],entity:'',request:'',shown:[],updated:0};}
    _blankResearch(){return {active:null,recent:[],turnCounter:0};}
    _ensureChats(){
      let chats=this.data.chats;
      if(!Array.isArray(chats))chats=[];
      chats=chats.filter(c=>c&&typeof c.id==='string'&&Array.isArray(c.messages));
      if(!chats.some(c=>c.id==='main'))chats.unshift({id:'main',title:'Main',created:Date.now(),messages:[],working:this.data.working||this._blankWorking(),researchState:this.data.researchState||this._blankResearch()});
      this.data.chats=chats.slice(0,150);
      if(!chats.some(c=>c.id===this.data.activeChatId))this.data.activeChatId='main';
      const active=this.activeChat();
      this.data.working=active.working||this._blankWorking();
      this.data.researchState=active.researchState||this._blankResearch();
    }
    activeChat(){return (this.data.chats||[]).find(c=>c.id===this.data.activeChatId)||(this.data.chats||[])[0];}
    _snapshotChat(){const c=this.activeChat();if(c){c.working=this.data.working;c.researchState=this.data.researchState;}}
    listChats(){this._snapshotChat();return this.data.chats.map(c=>({id:c.id,title:c.title||'Chat',main:c.id==='main',updated:c.updated||c.created||0,count:(c.messages||[]).length}));}
    newChat(){if(this.data.chats.length>=150)throw Error('Chat limit reached; export a backup before deleting old chats.');this._snapshotChat();const c={id:'chat_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,9),title:'New chat',created:Date.now(),messages:[],working:this._blankWorking(),researchState:this._blankResearch()};this.data.chats.push(c);this.data.activeChatId=c.id;this.data.working=c.working;this.data.researchState=c.researchState;this.save();return c.id;}
    switchChat(id){if(!this.data.chats.some(c=>c.id===id))return false;this._snapshotChat();this.data.activeChatId=id;const c=this.activeChat();this.data.working=c.working||this._blankWorking();this.data.researchState=c.researchState||this._blankResearch();this.save();return true;}
    renameChat(id,title){const c=this.data.chats.find(c=>c.id===id);if(!c)return false;c.title=String(title||'').trim().slice(0,72)||c.title;this.save();return true;}
    deleteChat(id){if(id==='main')return false;const idx=this.data.chats.findIndex(c=>c.id===id);if(idx<0)return false;if(this.data.activeChatId===id)this.switchChat('main');this.data.chats.splice(idx,1);this.save();return true;}
    _reviseChat(index,operation,updatedText=''){return new RamoHarnessCore.Harness(this).write(()=>this._reviseChatUnchecked(index,operation,updatedText));}
    _reviseChatUnchecked(index,operation,updatedText=''){
      const chat=this.activeChat(),entries=chat?.messages;
      if(!Array.isArray(entries)||!Number.isInteger(index)||index<0||index>=entries.length)return false;
      if(operation==='edit'&&(!String(updatedText||'').trim()||String(updatedText).length>16000))return false;
      new RamoHarnessCore.Harness(this).fork('Before '+operation+' at message '+(index+1),false);
      const old=entries.slice(index).map(m=>({...m}));
      if(operation==='edit'){
        const value=String(updatedText||'').trim();
        if(!value||value.length>16000)return false;
        entries[index]={...entries[index],user:value,assistant:'',editedAt:Date.now()};
        entries.splice(index+1);
      }else if(operation==='delete')entries.splice(index);
      else if(operation==='delete_reply'){
        entries[index]={...entries[index],assistant:'',editedAt:Date.now()};
        entries.splice(index+1);
      }else return false;
      if(entries[index]&&operation!=='delete'){delete entries[index].toolResults;delete entries[index].status;delete entries[index].activity;}
      chat.savedNotes=(chat.savedNotes||[]).filter(n=>Number(n.turn)<index+1);chat.queuedFollowups=[];
      // Derived conversational context must never retain overwritten messages.
      chat.contextSummary='';chat.contextSummaryThroughAt=0;chat.toolRuns=[];
      chat.working=this._blankWorking();
      chat.working.turns=entries.slice(-6).filter(m=>m.user&&m.assistant).map(m=>({user:m.user,assistant:m.assistant}));
      chat.researchState=this._blankResearch();
      chat.updated=Date.now();
      if(this.data.activeChatId===chat.id){this.data.working=chat.working;this.data.researchState=chat.researchState;}
      // Remove chat journal entries only for messages actually invalidated here.
      const matches=new Set(old.map(m=>String(m.user||'')+'\u0001'+String(m.assistant||'')));
      this.data.journal=this.data.journal.filter(j=>!(j?.chat_id===chat.id&&j.source==='human'&&matches.has(String(j.user||'')+'\u0001'+String(j.assistant||''))));
      return true;
    }
    editChatTurn(index,value){return this._reviseChat(index,'edit',value);}
    deleteChatTurn(index){return this._reviseChat(index,'delete');}
    deleteChatReply(index){return this._reviseChat(index,'delete_reply');}
    appendToolRun(entry){
      const c=this.activeChat();if(!c)return;
      c.toolRuns??=[];c.toolRuns.push({at:Date.now(),...entry});c.toolRuns=c.toolRuns.slice(-32);
      this.save();
    }
    appendChatTurn(turn,answer){const c=this.activeChat();if(!c)return;c.messages??=[];c.messages.push({user:String(turn.raw||''),assistant:String(answer||''),at:Date.now(),...(turn.attachments?.length?{attachments:v33Clone(turn.attachments)}:{}),...(turn.toolResults?.length?{toolResults:v33Clone(turn.toolResults)}:{}),...(turn.activity?{activity:RamoHarnessCore.activitySnapshot(turn.activity)}:{}),status:turn.completionStatus||'complete'});if(c.title==='New chat')c.title=String(turn.raw||'').trim().replace(/\s+/g,' ').slice(0,48)||'New chat';}
    _fact(f){
      const now=f?.updated||f?.mentioned_at||new Date().toISOString();
      return {
        ...f,
        id:f?.id||'fact_'+hash(norm(f?.content||'')+'|'+now),
        content:text(f?.content||f?.fact).trim(),
        owner:f?.owner||'user',
        confidence:Number.isFinite(Number(f?.confidence))?Number(f.confidence):1,
        source:f?.source||'legacy user memory',
        updated:now,
        mentioned_at:f?.mentioned_at||now,
        status:f?.status||'active',
        type:f?.type||f?.fact_type||(f?.kind==='event'?'experience':'world'),
        kind:f?.kind||'fact',
        subject:f?.subject||'',
        predicate:f?.predicate||'',
        object:f?.object||'',
        why:f?.why||'',
        keywords:Array.isArray(f?.keywords)?f.keywords:[],
        entity_ids:Array.isArray(f?.entity_ids)?f.entity_ids:[],
        source_episode_ids:Array.isArray(f?.source_episode_ids)?f.source_episode_ids:(f?.evidence?.episode_id?[f.evidence.episode_id]:[]),
        evidence_quotes:Array.isArray(f?.evidence_quotes)?f.evidence_quotes:(f?.evidence?.quote?[f.evidence.quote]:[]),
        importance:Number.isFinite(Number(f?.importance))?Number(f.importance):.65,
        support_count:Math.max(1,Number(f?.support_count)||1),
        retrieval_count:Number(f?.retrieval_count)||0,
        used_count:Number(f?.used_count)||0,
        confirmed_count:Number(f?.confirmed_count)||0,
        contradiction_count:Number(f?.contradiction_count)||0,
        last_retrieved_at:f?.last_retrieved_at||'',
        last_used_at:f?.last_used_at||''
      };
    }
    load(){
      const saved=json(this.storage.getItem(STORE));
      if(!saved||typeof saved!=='object')return;
      const lanes=['facts','factHistory','entities','relations','observations','associations','retainQueue','journal','knowledge','researchRecords','searches','review','jobs','imports','documents','forgotten','forgottenEvidence'];
      for(const lane of lanes)if(Array.isArray(saved[lane]))this.data[lane]=saved[lane];
      if(saved.working&&Array.isArray(saved.working.turns))this.data.working={...this.data.working,...saved.working};
      if(saved.researchState&&typeof saved.researchState==='object')this.data.researchState={...this.data.researchState,...saved.researchState,recent:Array.isArray(saved.researchState.recent)?saved.researchState.recent.slice(-2):[]};
      if(saved.memoryStats&&typeof saved.memoryStats==='object')this.data.memoryStats={...this.data.memoryStats,...saved.memoryStats};
      this.data.facts=this.data.facts.map(f=>this._fact(f)).filter(f=>f.content&&f.status!=='forgotten');
      this.data.factHistory=this.data.factHistory.map(f=>this._fact(f)).filter(f=>f.content);
      this.data.researchRecords=researchArray(this.data.researchRecords).filter(r=>r&&r.id&&r.claim&&r.source_url&&r.status!=='deleted');
      this.data.documents=researchArray(this.data.documents).filter(d=>d&&typeof d==='object'&&d.id).map(d=>({...d,id:text(d.id),name:text(d.name||'Document'),updated:text(d.updated||''),content:typeof d.content==='string'?d.content:undefined,metadata_only:typeof d.content!=='string'}));
      if(Array.isArray(saved.chats))this.data.chats=saved.chats;
      if(typeof saved.activeChatId==='string')this.data.activeChatId=saved.activeChatId;
      this.data.schema=MEMORY_SCHEMA_VERSION;
      this._ensureUserEntity();
    }
    _ensureUserEntity(){
      if(!this.data.entities.some(e=>e.id==='entity_user'))this.data.entities.unshift({id:'entity_user',name:'You',normalized:'user',type:'person',aliases:['user','you'],mentions:1,created_at:new Date().toISOString(),last_seen_at:new Date().toISOString()});
    }
    _prune(){
      const d=this.data;
      d.review=(d.review||[]).slice(-300);
      d.jobs=(d.jobs||[]).slice(-30);
      d.searches=(d.searches||[]).slice(-80);
      d.researchRecords=(d.researchRecords||[]).slice(-2500);
      d.factHistory=(d.factHistory||[]).slice(-1200);
      d.entities=(d.entities||[]).slice(-1200);
      d.relations=(d.relations||[]).slice(-3500);
      d.observations=(d.observations||[]).slice(-500);
      d.associations=(d.associations||[]).sort((a,b)=>(b.weight||0)-(a.weight||0)).slice(0,1500);
      d.retainQueue=(d.retainQueue||[]).filter(x=>x.status!=='complete').slice(-100);
    }
save(){
      try{
        this._snapshotChat();
        const disk={...this.data},durableUnavailable=!!this.durable&&this.durable.ready!==true;
        disk.jobs=(this.data.jobs||[]).map(durableUnavailable?boundedResearchJobForLocal:compactResearchJobForStorage).slice(-12);
        disk.documents=(this.data.documents||[]).map(compactDocumentForStorage);
        disk.knowledge=(this.data.knowledge||[]).map(k=>({id:k.id,topic:k.topic,status:k.status,quality_state:k.quality_state,synthesis_status:k.synthesis_status||'',completion:k.completion||'',fallback_level:k.fallback_level||'none',checked_at:k.checked_at,source_ids:k.source_ids||[],claim_ids:k.claim_ids||[],summary:text(k.summary).slice(0,1800),durable:!!k.durable})).slice(-80);
        disk.researchRecords=(this.data.researchRecords||[]).slice(-800).map(r=>({id:r.id,topic:r.topic,claim:r.claim,metric:r.metric,metric_name:r.metric_name,value:r.value,unit:r.unit,scope:r.scope,facet_ids:r.facet_ids||[],source_id:r.source_id,source_title:r.source_title,source_url:r.source_url,source_published:r.source_published,evidence:text(r.evidence).slice(0,900),work_id:r.work_id,study_role:r.study_role,source_role:r.source_role,publication_integrity:r.publication_integrity,target_eligibility:r.target_eligibility,report_lane:r.report_lane,checked_at:r.checked_at,confidence:r.confidence,volatile:r.volatile,refresh_after_days:r.refresh_after_days,status:r.status,research_id:r.research_id}));
        disk.searches=(this.data.searches||[]).slice(-30).map(s=>({id:s.id,query:s.query,kind:s.kind,created:s.created,scope:s.scope,sources:(s.sources||[]).slice(0,10).map(x=>({title:x.title,url:x.url,published:x.published,kind:x.kind}))}));
        try{this.storage.setItem(STORE,this._serializeLocalState(disk));}
        catch(error){
          if(error?.name!=='QuotaExceededError'&&error?.code!==22&&!/quota|storage.*full|not enough space/i.test(error?.message||''))throw error;
          // Optional activity must never displace the answer or delete the prior recovery checkpoint.
          const changed=[],seen=new Set(),states=(this.data.chats||[]).flatMap(c=>[c,...(c.branches||[]).map(b=>b.state)]);
          const containers=states.flatMap(c=>[...(c.messages||[]),...(c.working?.turns||[]),c.attempt]).filter(Boolean);
          for(const item of containers){if(seen.has(item)||!item.activity)continue;seen.add(item);const old=item.activity,next=RamoHarnessCore.activitySnapshot(old);next.storageLimited=true;next.revision=(next.revision||0)+1;
            for(const call of next.calls){if(call.thinking){call.thinkingOmitted=true;call.thinkingCharacters=Math.max(call.thinkingCharacters||0,call.thinking.length);call.thinking='';}call.output='';}
            changed.push({item,old});item.activity=next;
          }
          if(!changed.length)throw error;
          try{try{this.storage.setItem(STORE,this._serializeLocalState(disk));}catch(retry){
            for(const {item} of changed){const run=item.activity;run.hiddenSteps=(run.hiddenSteps||0)+run.steps.length;run.hiddenCalls=(run.hiddenCalls||0)+run.calls.length;run.steps=[];run.calls=[];run.revision++;}
            this.storage.setItem(STORE,this._serializeLocalState(disk));
          }}catch(retry){for(const {item,old} of changed)item.activity=old;throw retry;}
        }
        this.error='';return true;
      }catch(e){this.error='Local metadata save failed; existing durable records were not deleted: '+e.message;return false;}
    }
transact(fn){try{fn(this.data);return this.save();}catch(e){this.error=e.message;throw e;}}
    log(d,action,id,preview){d.review.push({at:new Date().toISOString(),action,id,preview:text(preview).slice(0,320)});d.review=d.review.slice(-300);}
    importFacts(input){
      for(const raw of rows(input)){
        const r=typeof raw==='string'?json(raw,{content:raw}):raw;
        if(!r||r.owner&&r.owner!=='user'||r.status&&r.status!=='active')continue;
        const value=text(r.content||r.fact).trim(),legacyKey=simpleMemoryKey(value);
        if(!value||(this.data.forgotten||[]).includes(norm(value))||(legacyKey&&(this.data.forgotten||[]).includes(legacyKey)))continue;
        const id=r.id||'fact_'+hash(norm(value));
        if(!this.data.facts.some(f=>f.id===id||norm(f.content)===norm(value)))this.data.facts.push(this._fact({...r,id,content:value,source:r.source_ref||r.source||'legacy user memory'}));
      }
    }
    importJournal(input){for(const r0 of rows(input)){const r=json(r0,{}),u=r.user||r.user_message;if(!human(u))continue;const id='episode_'+hash(text(r.id)+u);if(!this.data.journal.some(e=>e.id===id))this.data.journal.push({id,user:u,assistant:text(r.assistant),at:r.created||r.date||'',source:'legacy'});}}
    migrate(facts,journal){
      const prior=JSON.stringify(this.data);
      this.importFacts(facts);this.importJournal(journal);
      this._ensureUserEntity();
      if(!this.save())this.data=JSON.parse(prior);
    }
    async importIndexedDB(){
      // A fresh 2.8.2 namespace must never pull episodic or memory records
      // from a previous installed version. Hydrate only this build's own store.
      if(this.durable)try{await this.durable.migrateAndHydrate(this);}catch(e){this.error='Durable storage hydration warning: '+e.message;}
    }
  }
export {StateStore};
