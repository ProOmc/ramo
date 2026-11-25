import {text,norm,words,hash,researchArray,human,recall,SINGLE_PREDICATES,clamp,iso,tokenCounts,expandedWords,predicateKey,activeObservation,contentTerms,historicalQuery,relationHints} from './helpers.js';

class MemoryService {
    constructor(store){this.store=store;this._upgradeLegacy();}
    _upgradeLegacy(){
      const needs=(this.store.data.facts||[]).some(f=>!f.subject||!f.predicate||!f.memory_key);
      if(!needs)return;
      this.store.transact(d=>{
        const now=new Date().toISOString();
        // Pass 1: deterministic legacy patterns create stable entities first.
        for(const f of d.facts){
          if(f.subject&&f.predicate&&f.memory_key)continue;
          const p=this._fastParse(f.content);
          if(!p)continue;
          f.subject=p.subject;f.predicate=predicateKey(p.predicate);f.object=text(p.object);f.kind=p.kind||'fact';f.type=f.type||'world';
          f.keywords=[...new Set([...(f.keywords||[]),...expandedWords(f.content)])].slice(0,20);
          f.memory_key=norm(f.subject)+'|'+f.predicate+'|'+norm(f.object||f.content);f.importance=this._importance(f.kind,!!f.confirmed_count);
          const entities=[];for(const raw of p.entities||[]){const e=this._resolveEntity(d,raw.name||raw,raw.type||'other');if(e&&!entities.some(x=>x.id===e.id))entities.push(e);}
          const se=this._resolveEntity(d,f.subject,f.subject==='user'?'person':'other');if(se&&!entities.some(x=>x.id===se.id))entities.push(se);
          f.entity_ids=entities.map(e=>e.id);
        }
        // Pass 2: retain every remaining legacy line, linking known named subjects when safe.
        for(const f of d.facts){
          if(!f.subject)f.subject='user';
          if(!f.predicate){
            const n=norm(f.content),known=(d.entities||[]).filter(e=>e.id!=='entity_user').sort((a,b)=>b.name.length-a.name.length).find(e=>n.startsWith((e.normalized||norm(e.name))+' is '));
            if(known){
              f.subject=known.name;f.predicate='described_as';f.object=text(f.content).replace(new RegExp('^'+known.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s+is\\s+','i'),'').replace(/[.!]+$/,'');f.entity_ids=[...new Set([...(f.entity_ids||[]),known.id])];
            }else{f.predicate='remembered_fact';f.object=f.content;}
          }
          f.kind=f.kind||'fact';f.type=f.type||'world';f.keywords=[...new Set([...(f.keywords||[]),...expandedWords(f.content)])].slice(0,20);
          f.memory_key=f.memory_key||norm(f.subject)+'|'+predicateKey(f.predicate)+'|'+norm(f.object||f.content);f.importance=Number.isFinite(Number(f.importance))?Number(f.importance):this._importance(f.kind,false);
          f.source_episode_ids??=[];f.evidence_quotes??=[];f.support_count=Math.max(1,Number(f.support_count)||1);
          const se=this._resolveEntity(d,f.subject,f.subject==='user'?'person':'other');if(se)f.entity_ids=[...new Set([...(f.entity_ids||[]),se.id])];
          if(!d.relations.some(r=>r.memory_id===f.id)&&f.predicate!=='remembered_fact'&&f.object){
            const subjectEntity=se,objectEntity=(d.entities||[]).find(e=>e.id!=='entity_user'&&(e.normalized===norm(f.object)||(e.aliases||[]).some(a=>norm(a)===norm(f.object))));
            if(subjectEntity)d.relations.push({id:'relation_'+hash(subjectEntity.id+'|'+f.predicate+'|'+(objectEntity?.id||norm(f.object))+'|'+f.id),subject_id:subjectEntity.id,subject:subjectEntity.name,predicate:f.predicate,object_entity_id:objectEntity?.id||'',object:objectEntity?.name||f.object,memory_id:f.id,status:'active',confidence:f.confidence||1,valid_from:f.valid_from||f.updated||now,valid_until:'',updated:f.updated||now});
          }
        }
      });
    }
    _importance(kind,explicit=false){
      const base={identity:.96,relationship:.9,project:.88,goal:.86,location:.82,skill:.78,preference:.76,ownership:.76,event:.68,fact:.62}[kind]??.62;
      return clamp(base+(explicit?.08:0),0,1);
    }
    _fastParse(value){
      const v=text(value).trim().replace(/[.!]+$/,'');let m;
      if((m=v.match(/^my name is (.+)$/i)))return {statement:`The user's name is ${m[1]}.`,subject:'user',predicate:'name',object:m[1],kind:'identity',entities:[{name:m[1],type:'person'}]};
      if((m=v.match(/^my (best friend|friend|brother|sister|partner|mother|father|roommate) is (.+)$/i)))return {statement:`${m[2]} is the user's ${m[1]}.`,subject:'user',predicate:predicateKey(m[1]),object:m[2],kind:'relationship',entities:[{name:m[2],type:'person'}]};
      if((m=v.match(/^my (dog|cat|pet)(?:'s name is| is (?:named|called)) (.+)$/i)))return {statement:`The user's ${m[1]} is named ${m[2]}.`,subject:'user',predicate:'has_pet',object:m[2],kind:'relationship',entities:[{name:m[2],type:'pet'}],keywords:[m[1],'pet','name']};
      if((m=v.match(/^i have a (dog|cat|pet) (?:named|called) (.+)$/i)))return {statement:`The user has a ${m[1]} named ${m[2]}.`,subject:'user',predicate:'has_pet',object:m[2],kind:'relationship',entities:[{name:m[2],type:'pet'}],keywords:[m[1],'pet','name']};
      if((m=v.match(/^(.+?) is my (dog|cat|pet)$/i)))return {statement:`${m[1]} is the user's ${m[2]}.`,subject:'user',predicate:'has_pet',object:m[1],kind:'relationship',entities:[{name:m[1],type:'pet'}],keywords:[m[2],'pet','name']};
      if((m=v.match(/^my favorite (.+?) is (.+)$/i)))return {statement:`The user's favorite ${m[1]} is ${m[2]}.`,subject:'user',predicate:'favorite_'+predicateKey(m[1]),object:m[2],kind:'preference',entities:/\b(?:person|friend|actor|artist|author)\b/i.test(m[1])?[{name:m[2],type:'person'}]:[]};
      if((m=v.match(/^i prefer (.+)$/i)))return {statement:`The user prefers ${m[1]}.`,subject:'user',predicate:'prefers',object:m[1],kind:'preference',entities:[]};
      if((m=v.match(/^i live in (.+)$/i)))return {statement:`The user lives in ${m[1]}.`,subject:'user',predicate:'lives_in',object:m[1],kind:'location',entities:[{name:m[1],type:'place'}]};
      if((m=v.match(/^i work as (.+)$/i)))return {statement:`The user works as ${m[1]}.`,subject:'user',predicate:'works_as',object:m[1],kind:'identity',entities:[]};
      if((m=v.match(/^we (?:decided|agreed) (?:to|on) (.+)$/i)))return {statement:`The current project decision is to ${m[1]}.`,subject:'current project',predicate:'decision',object:m[1],kind:'project',entities:[{name:'current project',type:'project'}]};
      return null;
    }
    _resolveEntity(d,name,type='other'){
      const cleanName=text(name).replace(/\s+/g,' ').trim().slice(0,120);
      if(!cleanName)return null;
      const n=norm(cleanName);
      if(n==='user'||n==='you'||n==='the user')return d.entities.find(e=>e.id==='entity_user')||null;
      let found=d.entities.find(e=>e.normalized===n||(e.aliases||[]).some(a=>norm(a)===n));
      if(!found&&n.length>=4){
        const possible=d.entities.filter(e=>{
          const en=e.normalized||norm(e.name);
          return en.length>=4&&(en===n||en.startsWith(n+' ')||n.startsWith(en+' '));
        });
        if(possible.length===1)found=possible[0];
      }
      const now=new Date().toISOString();
      if(found){
        found.last_seen_at=now;found.mentions=(found.mentions||0)+1;
        if(cleanName!==found.name&&!(found.aliases||[]).some(a=>norm(a)===n))found.aliases=[...(found.aliases||[]),cleanName].slice(-12);
        if((!found.type||found.type==='other')&&type&&type!=='other')found.type=type;
        return found;
      }
      const id='entity_'+hash(n),entity={id,name:cleanName,normalized:n,type:type||'other',aliases:[],mentions:1,created_at:now,last_seen_at:now};
      d.entities.push(entity);return entity;
    }
    _supersede(d,fact,now,reason='replaced'){
      if(!fact||fact.status==='superseded')return;
      for(const o of d.observations||[])if(researchArray(o.source_memory_ids).includes(fact.id)){o.status='superseded';o.invalidated_at=now;o.invalidated_reason=reason;}
      d.associations=(d.associations||[]).filter(a=>a.a!==fact.id&&a.b!==fact.id);
      fact.status='superseded';fact.valid_until=now;
      d.factHistory.push({...fact});
      d.facts=d.facts.filter(x=>x.id!==fact.id);
      for(const r of d.relations)if(r.memory_id===fact.id&&r.status==='active'){r.status='superseded';r.valid_until=now;}
      this.store.log(d,'superseded',fact.id,reason+': '+fact.content);
    }
    _storeStructured(d,item,meta={}){
      const now=meta.now||new Date().toISOString(),subject=text(item.subject||'user').trim()||'user',predicate=predicateKey(item.predicate).replace(/^not_/,''),object=text(item.object).replace(/\s+/g,' ').trim().slice(0,300);
      const statement=text(item.statement).replace(/\s+/g,' ').trim().slice(0,700);
      if(!statement||!predicate)return null;
      const kind=['identity','preference','relationship','project','goal','event','skill','location','ownership','fact'].includes(item.kind)?item.kind:'fact';
      const operation=item.operation==='negate'||/^not_/.test(predicateKey(item.predicate))?'negate':item.operation==='replace'?'replace':'add';
      const objectKey=norm(object||statement),slot=norm(subject)+'|'+predicate,memoryKey=slot+'|'+objectKey;
      if(!meta.explicit&&(d.forgottenEvidence||[]).some(e=>e.episodeId&&e.episodeId===meta.episodeId||e.subject===norm(subject)&&e.object===objectKey&&(!e.quote&&!e.episodeId||e.quote&&e.quote===norm(meta.quote))))return null;
      if(meta.explicit)d.forgottenEvidence=(d.forgottenEvidence||[]).filter(e=>!(e.subject===norm(subject)&&e.object===objectKey));
      const opposing=d.facts.filter(f=>norm(f.subject)===norm(subject)&&predicateKey(f.predicate).replace(/^not_/,'')===predicate);
      if(opposing.some(f=>String(f.mentioned_at||f.updated)>now&&(SINGLE_PREDICATES.has(predicate)||operation!=='add'||norm(f.object)===objectKey)))return null;
      if(operation==='negate')for(const f of opposing.filter(f=>norm(f.object)===objectKey&&!/^not_/.test(f.predicate)))this._supersede(d,f,now,'negated');
      else for(const f of opposing.filter(f=>norm(f.object)===objectKey&&/^not_/.test(f.predicate)))this._supersede(d,f,now,'reaffirmed');
      const storedKey=(operation==='negate'?'not:':'')+memoryKey;
      if((d.forgotten||[]).includes(memoryKey)||(d.forgotten||[]).includes(norm(statement))){if(!meta.explicit)return null;d.forgotten=d.forgotten.filter(x=>x!==memoryKey&&x!==norm(statement));}
      const same=d.facts.find(f=>f.memory_key===storedKey||norm(f.subject)===norm(subject)&&predicateKey(f.predicate)===(operation==='negate'?'not_':'')+predicate&&norm(f.object)===objectKey);
      if(same){
        same.support_count=(same.support_count||1)+(meta.episodeId&&same.source_episode_ids.includes(meta.episodeId)?0:1);same.updated=now;same.mentioned_at=now;
        if(meta.episodeId&&!same.source_episode_ids.includes(meta.episodeId))same.source_episode_ids=[...same.source_episode_ids,meta.episodeId].slice(-20);
        if(meta.quote&&!same.evidence_quotes.includes(meta.quote))same.evidence_quotes=[...same.evidence_quotes,meta.quote].slice(-12);
        same.keywords=[...new Set([...(same.keywords||[]),...(item.keywords||[]).map(x=>norm(x)).filter(Boolean)])].slice(0,20);
        d.memoryStats.duplicates=(d.memoryStats.duplicates||0)+1;
        return {id:same.id,duplicate:true};
      }
      if(operation==='negate'){
        const matches=d.facts.filter(f=>norm(f.subject||'')===norm(subject)&&predicateKey(f.predicate)===predicate&&(!objectKey||norm(f.object)===objectKey));
        for(const f of matches)this._supersede(d,f,now,'negated');
      } else if(operation==='replace'||SINGLE_PREDICATES.has(predicate)||predicate.startsWith('favorite_')){
        const prior=d.facts.filter(f=>norm(f.subject||'')===norm(subject)&&predicateKey(f.predicate)===predicate&&norm(f.object)!==objectKey);
        for(const f of prior)this._supersede(d,f,now,'updated');
        if(prior.length)d.memoryStats.updates=(d.memoryStats.updates||0)+prior.length;
      }
      const entities=[];
      for(const raw of Array.isArray(item.entities)?item.entities:[]){
        const obj=typeof raw==='string'?{name:raw,type:'other'}:raw||{},entity=this._resolveEntity(d,obj.name||obj.text,obj.type||'other');
        if(entity&&!entities.some(e=>e.id===entity.id))entities.push(entity);
      }
      const subjectEntity=this._resolveEntity(d,subject,subject==='user'?'person':(item.subject_type||'other'));
      if(subjectEntity&&!entities.some(e=>e.id===subjectEntity.id))entities.push(subjectEntity);
      let objectEntity=null;
      for(const e of entities)if(norm(e.name)===norm(object)||(e.aliases||[]).some(a=>norm(a)===norm(object)))objectEntity=e;
      if(!objectEntity&&object&&/^[A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+){0,3}$/.test(object)){
        const type=kind==='relationship'?'person':kind==='location'?'place':kind==='project'?'project':'other';
        objectEntity=this._resolveEntity(d,object,type);if(objectEntity&&!entities.some(e=>e.id===objectEntity.id))entities.push(objectEntity);
      }
      const type=item.fact_type==='experience'||kind==='event'?'experience':'world';
      const certainty=item.certainty==='uncertain'?.55:item.certainty==='likely'?.75:.92;
      const id=meta.idOverride||('fact_'+hash(storedKey+'|'+now+'|'+(meta.episodeId||''))),explicit=!!meta.explicit;
      const fact={
        id,content:statement,key:'',entity:entities.find(e=>e.id!=='entity_user')?.name||'',owner:'user',confidence:certainty,
        source:meta.source||'qwen retain',updated:now,mentioned_at:now,status:'active',type,kind,subject,predicate,object,
        why:text(item.why).replace(/\s+/g,' ').trim().slice(0,300),keywords:[...new Set((item.keywords||[]).map(x=>norm(x)).filter(Boolean))].slice(0,20),
        entity_ids:entities.map(e=>e.id),source_episode_ids:meta.episodeId?[meta.episodeId]:[],evidence_quotes:meta.quote?[meta.quote]:[],
        memory_key:storedKey,valid_from:item.valid_from||now,valid_until:'',occurred_start:iso(item.occurred_start)||'',occurred_end:iso(item.occurred_end)||'',
        importance:this._importance(kind,explicit),support_count:1,retrieval_count:0,used_count:0,confirmed_count:explicit?1:0,contradiction_count:0,last_retrieved_at:'',last_used_at:''
      };
      if(operation==='negate')fact.predicate=predicate.startsWith('not_')?predicate:'not_'+predicate;
      d.facts.push(fact);
      if(subjectEntity&&predicate&&object){
        const rid='relation_'+hash(subjectEntity.id+'|'+fact.predicate+'|'+(objectEntity?.id||norm(object))+'|'+id);
        d.relations.push({id:rid,subject_id:subjectEntity.id,subject:subjectEntity.name,predicate:fact.predicate,object_entity_id:objectEntity?.id||'',object:objectEntity?.name||object,memory_id:id,status:'active',confidence:certainty,valid_from:fact.valid_from,valid_until:'',updated:now});
      }
      this.store.log(d,meta.source==='user memory editor'?'fact added':'model saved',id,statement);
      d.memoryStats.retained=(d.memoryStats.retained||0)+1;d.memoryStats.new_since_consolidation=(d.memoryStats.new_since_consolidation||0)+1;d.memoryStats.last_retained_at=now;
      return {id,duplicate:false};
    }
    _write(fn){if(!this.store.transact(fn))throw Error(this.store.error||'Memory could not be saved.');return true;}
    capture(input){
      if(!human(input)||!/^remember\b/i.test(input)&&(/[?]\s*$/.test(input)||/\b(?:if|suppose|imagine|hypothetically|maybe)\b/i.test(input)))return [];
      const explicit=input.match(/^remember(?: that)?\s+(.+)/i),value=(explicit?.[1]||input).trim();
      const fast=this._fastParse(value);
      if(!explicit&&!fast)return [];
      let result=null;
      this._write(d=>{
        const item=fast||{statement:value,subject:'user',predicate:'remembered_fact',object:value,kind:'fact',operation:'add',entities:[],keywords:expandedWords(value).slice(0,8)};
        result=this._storeStructured(d,item,{source:explicit?'explicit remember':'fast memory rule',explicit:!!explicit});
        if(result)d.forgotten=(d.forgotten||[]).filter(x=>x!==norm(value)&&x!==norm(item.statement));
      });
      return result?[result.id]:[];
    }
    _knownEntityName(name){
      const n=norm(name);if(!n||n==='user')return false;
      return (this.store.data.entities||[]).some(e=>e.id!=='entity_user'&&[e.normalized,...(e.aliases||[]).map(norm)].some(a=>a===n));
    }
    _contextReference(quote){
      const q=norm(quote);
      return /\b(?:he|she|they|them|him|her|his|hers|their|theirs|it|its|this|that|these|those)\b/.test(q)||
        /\bthe (?:dog|cat|pet|friend|person|project|app|assistant|model|server|tool|file|game|car|phone|computer|system)\b/.test(q);
    }
    _grounded(raw,quote,source,context=[]){
      const q=norm(quote),src=norm(source),sub=norm(raw.subject||'user'),obj=norm(raw.object),statement=norm(raw.statement);
      const contextText=norm((Array.isArray(context)?context:[]).map(t=>text(t?.user||'')+' '+text(t?.assistant||'')).join(' '));
      if(!q||!src.includes(q)||!Array.isArray(raw.keywords||[])||!Array.isArray(raw.entities||[]))return false;
      // Keep hypothetical language only when the extractor explicitly marks it uncertain.
      if(/\b(?:if|suppose|imagine|hypothetically)\b/i.test(quote)&&raw.certainty!=='uncertain')return false;

      // Subjects may be resolved from recent conversational context. Requiring the literal
      // name here breaks "She's a German Shepherd" -> Luna when Luna is the active entity.
      if(sub==='user'){
        if(!/\b(?:i|i'm|i've|i'd|my|me|mine|we|our|us)\b/i.test(quote)&&!/^user\b/.test(statement))return false;
      }else if(!q.includes(sub)){
        // A resolved name is valid when it was already known OR is actually present in
        // the recent context supplied to the extractor, and the new quote contains a
        // coreferential expression ("she", "it", "that project", etc.).
        if(!(this._knownEntityName(sub)||contextText.includes(sub))||!this._contextReference(quote))return false;
      }

      // The object should normally be visible in the new message. Allow paraphrased
      // values when most of the object's content words are present.
      if(obj){
        const objectTerms=contentTerms(raw.object||'');
        const evidenceTerms=new Set(expandedWords(quote));
        const objectSupport=q.includes(obj)||objectTerms.length>0&&objectTerms.filter(w=>evidenceTerms.has(w)||evidenceTerms.has(w.replace(/s$/,''))).length/Math.max(1,objectTerms.length)>=.6;
        if(!objectSupport)return false;
      }

      // Negation is one-way validated: a negated memory needs a real change/negative cue.
      // Positive facts are still allowed from mixed sentences such as
      // "I stopped using Windows and switched to Linux."
      const operation=raw.operation==='negate'||/^not_/.test(predicateKey(raw.predicate))?'negate':raw.operation;
      if(operation==='negate'&&!/\b(?:not|never|no longer|no more|don t|doesn t|isn t|wasn t|stopped|stop|quit|gave up|switched (?:from|away from)|moved (?:from|away from)|replaced)\b/.test(q))return false;

      // Use semantic overlap as a plausibility check, not as a literal transcription test.
      // Exclude resolved subject tokens so pronoun resolution is not penalized.
      const subjectTerms=new Set(contentTerms(raw.subject||''));
      const signal=contentTerms(statement).filter(w=>!subjectTerms.has(w)&&!['the','s','is','has','user'].includes(w));
      const evidence=new Set(expandedWords(quote));
      if(!signal.length)return !!obj;
      const overlap=signal.filter(w=>evidence.has(w)||evidence.has(w.replace(/s$/,''))).length/signal.length;
      return overlap>=.32||!!obj&&q.includes(obj);
    }
    ingestExtraction(episode,payload){
      const source=text(episode?.user).trim(),episodeId=text(episode?.id);if(!source||!episodeId||!payload||!Array.isArray(payload.facts))return [];
      const accepted=[],indexToId=new Map(),sourceNorm=norm(source),context=Array.isArray(episode?.context)?episode.context:[],now=iso(episode.at)||new Date().toISOString();
      this._write(d=>{
        d.factHistory??=[];d.entities??=[];d.relations??=[];d.observations??=[];d.associations??=[];
        for(const [index,raw] of payload.facts.slice(0,8).entries()){
          const statement=text(raw?.statement).replace(/\s+/g,' ').trim().slice(0,700),quote=text(raw?.evidence_quote).replace(/\s+/g,' ').trim().slice(0,260);
          // Certainty is a property of the sentence, not of the extractor's mood.
          // A small model answers the enum with one value whatever the wording, which
          // pinned every fact to the minimum confidence and left profile() empty, so
          // nothing ever reached the always-loaded context. Read the hedge from the
          // message text instead and let the model only downgrade what is really hedged.
          const hedged=/\b(?:maybe|might|possibly|probably|perhaps|i think|i guess|not sure|unsure|could be|i suppose)\b/i.test(source);
          const certainty=hedged?raw?.certainty:(raw?.certainty==='uncertain'?'explicit':raw?.certainty);
          const item={...raw,certainty};
          if(statement.length<4||quote.length<4||!norm(source).includes(norm(quote))||!this._grounded(item,quote,source,context)){d.memoryStats.rejected=(d.memoryStats.rejected||0)+1;continue;}
          if((d.forgotten||[]).includes(norm(statement))){d.memoryStats.rejected=(d.memoryStats.rejected||0)+1;continue;}
          const record={...item,statement,operation:['replace','negate'].includes(raw.operation)?raw.operation:'add'};
          const stored=this._storeStructured(d,record,{now,episodeId,quote,source:'qwen retain'});
          if(!stored)continue;
          indexToId.set(index,stored.id);if(!stored.duplicate)accepted.push(stored.id);
        }
        for(const [index,raw] of payload.facts.slice(0,8).entries()){
          const child=indexToId.get(index);if(!child)continue;
          for(const target of Array.isArray(raw?.caused_by)?raw.caused_by.slice(0,3):[]){
            const parent=indexToId.get(Number(target));if(!parent||Number(target)>=index)continue;
            const rid='relation_'+hash(child+'|caused_by|'+parent);
            if(!d.relations.some(r=>r.id===rid))d.relations.push({id:rid,subject_id:'',subject:child,predicate:'caused_by',object_entity_id:'',object:parent,memory_id:child,target_memory_id:parent,status:'active',confidence:.82,valid_from:now,valid_until:'',updated:now});
          }
        }
      });
      return accepted;
    }
    profile(limit=7){
      const d=this.store.data,now=Date.now(),all=[
        ...d.facts.filter(f=>f.status==='active'&&f.owner==='user'&&((f.confidence??1)>=.65||(f.confirmed_count||0)>0)),
        ...(d.observations||[]).filter(o=>activeObservation(o,d)).map(o=>({...o,content:o.content||o.statement,kind:'observation',importance:o.importance??.78,support_count:o.proof_count||o.support_count||2,updated:o.updated||''}))
      ];
      const durable=new Set(['identity','preference','relationship','project','goal','location','skill','ownership','observation']);
      return all.filter(f=>durable.has(f.kind)||f.type==='observation').map(f=>{
        const age=Math.max(0,(now-new Date(f.updated||f.mentioned_at||0).getTime())/86400000),recency=1/(1+age/180);
        const score=(f.importance||.6)*.65+Math.min(1,Math.log2(1+(f.support_count||1))/4)*.2+recency*.15;
        return {...f,_profileScore:score};
      }).sort((a,b)=>b._profileScore-a._profileScore).slice(0,limit).map(f=>({id:f.id,statement:f.content,kind:f.kind||f.type||'fact'}));
    }
    mentionsKnownEntity(query){
      const q=norm(query);if(!q)return false;
      return (this.store.data.entities||[]).some(e=>e.id!=='entity_user'&&[e.normalized,...(e.aliases||[]).map(norm)].filter(Boolean).some(a=>a.length>=3&&q.includes(a)));
    }
    shouldRecall(query){
      const q=text(query);return this.mentionsKnownEntity(q)||/\b(?:my|mine|our|we|me|i|remember|earlier|before|previous|used to|favorite|prefer|like|friend|partner|dog|cat|pet|project|goal)\b/i.test(q);
    }
    _unitText(u,d){
      const names=(u.entity_ids||[]).map(id=>d.entities.find(e=>e.id===id)?.name||'').filter(Boolean);
      return [u.content||u.statement,u.subject,u.predicate,u.object,u.why,...(u.keywords||[]),...names].join(' ');
    }
    _bm25(query,units,d,limit=14){
      const q=[...new Set(expandedWords(query))];if(!q.length||!units.length)return [];
      const docs=units.map(u=>({u,tok:tokenCounts(this._unitText(u,d))})),N=docs.length,avg=docs.reduce((s,x)=>s+[...x.tok.values()].reduce((a,b)=>a+b,0),0)/Math.max(1,N),df=new Map();
      for(const term of q){let n=0;for(const doc of docs)if(doc.tok.has(term))n++;df.set(term,n);}
      const out=[];for(const doc of docs){const len=[...doc.tok.values()].reduce((a,b)=>a+b,0)||1;let score=0;
        for(const term of q){const tf=doc.tok.get(term)||0;if(!tf)continue;const idf=Math.log(1+(N-(df.get(term)||0)+.5)/((df.get(term)||0)+.5));score+=idf*(tf*2.2)/(tf+1.2*(1-.75+.75*len/Math.max(avg,1)));}
        if(score>0)out.push({id:doc.u.id,score,unit:doc.u});
      }
      return out.sort((a,b)=>b.score-a.score).slice(0,limit);
    }
    _graph(query,units,d,limit=14){
      const q=norm(query),entityIds=new Set();
      for(const e of d.entities||[]){if(e.id==='entity_user')continue;for(const a of [e.normalized,...(e.aliases||[]).map(norm)])if(a&&a.length>=3&&q.includes(a))entityIds.add(e.id);}
      const hints=relationHints(query),scores=new Map(),unitMap=new Map(units.map(u=>[u.id,u]));
      const add=(id,s)=>{if(unitMap.has(id))scores.set(id,Math.max(scores.get(id)||0,s));};
      for(const u of units)if((u.entity_ids||[]).some(id=>entityIds.has(id)))add(u.id,1);
      for(const r of d.relations||[]){
        if(r.status!=='active')continue;const direct=entityIds.has(r.subject_id)||entityIds.has(r.object_entity_id),hint=hints.some(h=>predicateKey(r.predicate).includes(h)||h.includes(predicateKey(r.predicate)));
        if(direct)add(r.memory_id,.92);else if(hint)add(r.memory_id,.84);
        if(direct&&r.target_memory_id)add(r.target_memory_id,.7);
      }
      const seeds=[...scores.keys()];
      for(const a of d.associations||[])if(seeds.includes(a.a)||seeds.includes(a.b)){const other=seeds.includes(a.a)?a.b:a.a;add(other,Math.min(.68,.35+.08*(a.weight||1)));}
      return [...scores].map(([id,score])=>({id,score,unit:unitMap.get(id)})).sort((a,b)=>b.score-a.score).slice(0,limit);
    }
    _temporal(query,units,limit=14){
      const q=norm(query),now=new Date(),historic=/\b(?:before|previous|earlier|used to|formerly|back then)\b/.test(q),recent=/\b(?:latest|recent|current|now|lately)\b/.test(q);
      let start=null,end=null,year=q.match(/\b(19\d{2}|20\d{2})\b/)?.[1];
      const day=(offset)=>{const d=new Date(now);d.setHours(0,0,0,0);d.setDate(d.getDate()+offset);return d;};
      if(/\byesterday\b/.test(q)){start=day(-1);end=day(0);}
      else if(/\btoday\b/.test(q)){start=day(0);end=day(1);}
      else if(/\blast week\b/.test(q)){start=day(-7);end=day(0);}
      else if(/\blast month\b/.test(q)){start=day(-30);end=day(0);}
      else if(/\blast year\b/.test(q)){start=new Date(now.getFullYear()-1,0,1);end=new Date(now.getFullYear(),0,1);}
      else if(year){start=new Date(Number(year),0,1);end=new Date(Number(year)+1,0,1);}
      if(!start&&!recent&&!historic)return [];
      const out=[];for(const u of units){const t=new Date(u.occurred_start||u.mentioned_at||u.updated||0).getTime();if(!Number.isFinite(t)||!t)continue;let score=0;
        if(start){if(t>=start.getTime()&&t<(end?.getTime()||Infinity))score=1;else continue;}
        else if(recent){const age=Math.max(0,(Date.now()-t)/86400000);score=1/(1+age/30);}
        else if(historic)score=u.status==='superseded'?.95:.35;
        if(score>0)out.push({id:u.id,score,unit:u});
      }
      return out.sort((a,b)=>b.score-a.score).slice(0,limit);
    }
    _fuse(arms,units,turn){
      const map=new Map(units.map(u=>[u.id,u])),scores=new Map(),ranks=new Map(),weights={semantic:1.25,lexical:1,graph:1.08,temporal:.9};
      for(const [name,list] of arms){for(let i=0;i<list.length;i++){const r=list[i],id=r.id;if(!map.has(id))continue;scores.set(id,(scores.get(id)||0)+(weights[name]||1)/(60+i+1));const x=ranks.get(id)||{};x[name]={rank:i+1,score:r.score};ranks.set(id,x);}}
      const shown=new Set(this.store.data.working.shown||[]),additional=turn.additional;
      return [...scores].map(([id,rrf])=>{const u=map.get(id),rr=ranks.get(id)||{},support=Math.min(1,Math.log2(1+(u.support_count||u.proof_count||1))/4),importance=u.importance??.65,exact=rr.graph?.score>=.9?.18:0,semantic=Math.max(0,rr.semantic?.score||0)*.12;
        return {unit:u,rrf,trace:rr,score:rrf*60+importance*.16+support*.1+exact+semantic};
      }).filter(x=>!additional||!shown.has(x.unit.id)).sort((a,b)=>b.score-a.score);
    }
    lookup(turn,semanticHits=[]){
      const d=this.store.data;let q=turn.effective||turn.raw||'',entity=turn.entity||'';
      const relationship=q.match(/\bmy (?:best friend|friend|brother|sister|partner|mother|father|roommate)\b/i)?.[0];
      if(relationship){
        const relNorm=norm(relationship).replace(/^my /,''),candidates=d.facts.filter(f=>f.status==='active'&&(norm(f.subject)==='user'&&predicateKey(f.predicate)===predicateKey(relNorm)||!f.subject&&norm(f.content).includes('my '+relNorm)));
        if(candidates.length===1){
          const c=candidates[0],named=c.object||c.content.match(/\bis\s+(.+?)[.!]*$/i)?.[1]||'';
          if(named){entity=named;d.working.entity=named;q+=' '+named;}
        }
      }
      const historical=historicalQuery(q);
      const units=[...d.facts.filter(f=>f.status==='active'&&f.owner==='user'),...(d.observations||[]).filter(o=>activeObservation(o,d)).map(o=>({...o,content:o.content||o.statement,type:'observation',kind:'observation',importance:o.importance??.8,support_count:o.proof_count||2,entity_ids:researchArray(o.entity_ids)}))];
      if(historical)units.push(...(d.factHistory||[]).filter(f=>f.status==='superseded'));
      const terms=contentTerms(q),hints=relationHints(q);
      const namedIds=d.entities.filter(e=>e.id!=='entity_user'&&[e.normalized,...(e.aliases||[]).map(norm)].some(a=>a&&(' '+norm(q)+' ').includes(' '+a+' '))).map(e=>e.id);
      const relevant=u=>(!namedIds.length||researchArray(u.entity_ids).some(id=>namedIds.includes(id))||namedIds.some(id=>norm(u.content).includes(norm(d.entities.find(e=>e.id===id)?.name))))&&(!terms.length||terms.some(t=>expandedWords(this._unitText(u,d)).includes(t))||hints.some(h=>predicateKey(u.predicate).includes(h)));
      const scoped=units.filter(relevant);
      const lexical=this._bm25(q,scoped,d),graph=this._graph(q,scoped,d),temporal=this._temporal(q,scoped),unitMap=new Map(units.map(u=>[u.id,u]));
      const semantic=(semanticHits||[]).filter(x=>unitMap.has(x.id)&&x.score>=.45&&(!namedIds.length||researchArray(unitMap.get(x.id).entity_ids).some(id=>namedIds.includes(id)))).map(x=>({id:x.id,score:x.score,unit:unitMap.get(x.id)}));
      let fused=this._fuse([['semantic',semantic],['lexical',lexical],['graph',graph],['temporal',temporal]],units,turn);
      if(/\b(?:(?:19|20)\d{2}|yesterday|today|last (?:week|month|year))\b/i.test(q)){const dated=new Set(temporal.map(x=>x.id));fused=fused.filter(x=>dated.has(x.unit.id));}
      const facts=fused.slice(0,8).map(x=>({...x.unit,score:x.score,retrieval:x.trace})),found=facts.length;
      const qt=new Set(expandedWords(q)),scoreEpisode=e=>{const wt=words(e.user),hit=wt.filter(x=>qt.has(x)).length;return hit/Math.max(2,qt.size);};
      const generic=/what (?:were|are) we talking|what did we discuss/i.test(q);
      const episodes=(historical||generic?d.journal.map(e=>({...e,_score:generic?.5:scoreEpisode(e)})).filter(e=>human(e.user)&&!recall(e.user)&&e._score>=.18).sort((a,b)=>b._score-a._score||String(b.at).localeCompare(String(a.at))).slice(0,5):[]);
      const knowledge=d.knowledge.filter(n=>n.status==='ready').map(n=>{const wt=expandedWords(n.topic+' '+(n.summary||'')+' '+(n.excerpts||[]).map(x=>x.text).join(' '));return {n,score:terms.filter(t=>wt.includes(t)).length/Math.max(1,terms.length)};}).filter(x=>x.score>=.5).sort((a,b)=>b.score-a.score).slice(0,3).map(x=>x.n);
      if(facts.length){
        const now=new Date().toISOString(),ids=new Set(facts.map(f=>f.id));
        this.store.transact(data=>{for(const f of data.facts)if(ids.has(f.id)){f.retrieval_count=(f.retrieval_count||0)+1;f.last_retrieved_at=now;}});
      }
      const matchedEntity=(d.entities||[]).find(e=>e.id!=='entity_user'&&[e.normalized,...(e.aliases||[]).map(norm)].some(a=>a&&norm(q).includes(a)))?.name||entity||'';
      return {schema:2,status:found||episodes.length||knowledge.length?'ok':'no_evidence',facts,episodes,knowledge,entity:matchedEntity,additional:turn.additional,excluded:Math.max(0,fused.length-facts.length),retrieval_trace:{semantic:semantic.length,lexical:lexical.length,graph:graph.length,temporal:temporal.length}};
    }
    used(evidence,answer){
      const aw=new Set(expandedWords(answer)),used=[];
      for(const f of evidence.facts||[]){const sig=[...new Set(expandedWords([f.content,f.subject,f.object].join(' ')))];if(sig.length&&sig.filter(x=>aw.has(x)).length/Math.min(sig.length,8)>=.7)used.push(f.id);}
      if(!used.length&&(evidence.facts||[]).length&&text(answer).trim())used.push(evidence.facts[0].id);
      if(used.length)this.store.transact(d=>{const now=new Date().toISOString();for(const f of d.facts)if(used.includes(f.id)){f.used_count=(f.used_count||0)+1;f.last_used_at=now;}for(let i=0;i<used.length;i++)for(let j=i+1;j<used.length;j++){const [a,b]=[used[i],used[j]].sort(),id='assoc_'+hash(a+'|'+b),edge=d.associations.find(x=>x.id===id);if(edge){edge.weight=Math.min(20,(edge.weight||1)+1);edge.last_strengthened=now;}else d.associations.push({id,a,b,weight:1,last_strengthened:now});}});
      return used;
    }
    addManual(content,source='user memory editor'){
      const value=text(content).trim();if(!value)return null;let out=null;
      this._write(d=>{if(d.facts.some(f=>norm(f.content)===norm(value)))return;const fast=this._fastParse(value),item=fast||{statement:value,subject:'user',predicate:'remembered_fact',object:value,kind:'fact',operation:'add',entities:[],keywords:expandedWords(value).slice(0,10)};out=this._storeStructured(d,item,{source,explicit:true});d.forgotten=(d.forgotten||[]).filter(x=>x!==norm(value));});
      return out&&!out.duplicate?out.id:null;
    }
    editManual(id,content){
      const value=text(content).trim();if(!value||value.length>2000)throw Error('Enter a memory of 1–2,000 characters.');let newId=null;
      this._write(d=>{const old=d.facts.find(x=>x.id===id);if(!old)throw Error('That memory no longer exists.');d.forgottenEvidence??=[];d.forgottenEvidence.push({subject:norm(old.subject),object:norm(old.object),quote:'',episodeId:''});if(d.facts.some(x=>x.id!==id&&norm(x.content)===norm(value)))throw Error('That memory is already saved.');d.forgotten=[...new Set([...(d.forgotten||[]),norm(old.content),old.memory_key||''].filter(Boolean))];this._supersede(d,old,new Date().toISOString(),'edited by user');const fast=this._fastParse(value),item=fast||{statement:value,subject:'user',predicate:'remembered_fact',object:value,kind:'fact',operation:'add',entities:[],keywords:expandedWords(value).slice(0,10)};const out=this._storeStructured(d,item,{source:'user memory editor',explicit:true,idOverride:id});newId=out?.id||null;d.forgotten=d.forgotten.filter(x=>x!==norm(value));});
      return newId;
    }
    forget(id){
      let removed=false;this._write(d=>{const f=d.facts.find(x=>x.id===id);if(!f)return;d.forgottenEvidence??=[];d.forgottenEvidence.push({subject:norm(f.subject),object:norm(f.object),quote:'',episodeId:''});for(const quote of f.evidence_quotes||[])d.forgottenEvidence.push({subject:norm(f.subject),object:norm(f.object),quote:norm(quote),episodeId:''});for(const episodeId of f.source_episode_ids||[])d.forgottenEvidence.push({subject:norm(f.subject),object:norm(f.object),quote:'',episodeId});d.forgotten=[...new Set([...(d.forgotten||[]),norm(f.content),f.memory_key||''].filter(Boolean))];this._supersede(d,f,new Date().toISOString(),'forgotten');const h=d.factHistory.find(x=>x.id===id);if(h)h.status='forgotten';for(const r of d.relations)if(r.memory_id===id)r.status='forgotten';this.store.log(d,'fact deleted',id,f.content);removed=true;});return removed;
    }
  }
export {MemoryService};
