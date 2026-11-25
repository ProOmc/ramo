import {U140_RESEARCH_LIBRARY_V2,text,norm,hash,researchArray,rows,validURL,expandedWords,freshQuery,stripResearchOutput,researchMetrics,researchMetric,volatileResearchMetric,researchTerms,researchMetricKey,researchTermPresent} from './helpers.js';

class ResearchLibrary {
    constructor(store){this.store=store;}
    volatile(input){return /\b(?:latest|current|right now|today|recent|newest|price|availability|weather|news|release|version|score|ranking|ranked|pick rate|win rate|usage rate|stock|exchange rate|patch|season)\b/i.test(text(input));}
    ttlDays(record){
      if(Number(record?.refresh_after_days)>0)return Number(record.refresh_after_days);
      const metric=researchMetricKey(record?.metric||'');
      if(['price','version','rating'].includes(metric))return 7;
      if(['pick_rate','win_rate','performance','percentage','count'].includes(metric))return 14;
      return record?.volatile?30:365;
    }
    sourceMap(note){return new Map(researchArray(note?.sources).filter(s=>s&&typeof s==='object').map(s=>[s.id,s]));}
    fromNote(note){
      const sources=this.sourceMap(note),now=note.checked_at||new Date().toISOString(),subject=text(note.topic),rows=[];
      for(const c of Array.isArray(note.claims)?note.claims:[]){
        if(!c||!text(c.claim).trim()||c.support&&c.support!=='direct')continue;
        const s=sources.get(c.source_id);if(!s||!validURL(s.url))continue;
        if(U140_RESEARCH_LIBRARY_V2&&(c.support!=='direct'||c.target_eligibility!=='direct'||c.report_lane==='background'||text(c.region_role||'main_content')!=='main_content'||['CONFLICT','ADJACENT_VERSION','HISTORICAL_REFERENCE'].includes(text(c.target_identity_status))||text(s.publication_integrity)==='retracted'||!text(c.quote).trim()||c.type==='inference'))continue;
        const scope=c.scope&&typeof c.scope==='object'?c.scope:{};
        const signature=norm([subject,c.claim,c.metric,c.value,c.unit,JSON.stringify(scope),s.url].join('|'));
        rows.push({id:'research_record_'+hash(signature),topic:subject,claim:text(c.claim).trim(),metric:researchMetricKey(c.metric||'none'),metric_name:text(c.metric_name||c.metric),finding_type:text(c.finding_type||'result'),outcome:text(c.outcome),intervention:text(c.intervention),comparator:text(c.comparator),value:text(c.value),unit:text(c.unit),scope,facet_ids:Array.isArray(c.facet_ids)?c.facet_ids:[],evidence_class:text(c.evidence_class),source_id:text(c.source_id),source_title:text(s.title),source_url:text(s.url),source_published:text(s.published||''),evidence:text(c.quote||s.text).slice(0,900),work_id:text(c.work_id||s.work_id),study_role:text(s.study_role),source_role:text(s.source_role),publication_integrity:text(s.publication_integrity||'unknown'),target_eligibility:text(c.target_eligibility),report_lane:text(c.report_lane||'direct'),checked_at:now,confidence:Number(c.confidence)||.75,volatile:this.volatile(subject+' '+c.claim+' '+c.metric),refresh_after_days:0,status:'active',research_id:note.id});
      }
      return rows;
    }
    saveNote(note){
      const incoming=this.fromNote(note);if(!incoming.length)return 0;
      const incomingIds=new Set(incoming.map(r=>r.id)),now=new Date().toISOString();
      this.store.transact(d=>{d.researchRecords??=[];
        for(const old of d.researchRecords)if(old.research_id===note.id&&old.status==='active'&&!incomingIds.has(old.id)){old.status='superseded';old.superseded_at=now;}
        for(const row of incoming){const at=d.researchRecords.findIndex(x=>x.id===row.id);if(at>=0)d.researchRecords[at]={...d.researchRecords[at],...row,status:'active',superseded_at:''};else d.researchRecords.push(row);}
        this.store.log(d,'research records saved',note.id,String(incoming.length)+' validated source-backed claims');
      });
      if(this.store.durable)for(const row of incoming)this.store.durable.put('research_records',row).catch(()=>{});
      return incoming.length;
    }
    backfill(){
      let added=0;for(const note of this.store.data.knowledge||[]){const rows=this.fromNote(note);for(const row of rows)if(!(this.store.data.researchRecords||[]).some(r=>r.id===row.id)){this.store.data.researchRecords.push(row);added++;}}
      if(added)this.store.save();return added;
    }
    search(query,limit=18){
      const q=text(query),terms=researchTerms(q),metrics=researchMetrics(q),metric=researchMetricKey(metrics[0]||researchMetric(q)),now=Date.now(),fresh=freshQuery(q)||metrics.some(volatileResearchMetric),rows=[];
      if(!terms.length)return {status:'no_evidence',records:[],sources:[],reason:'no_subject_terms'};
      for(const r of this.store.data.researchRecords||[]){
        if(r.status!=='active'||!r.claim||!r.source_url)continue;if(U140_RESEARCH_LIBRARY_V2&&(r.target_eligibility!=='direct'||r.report_lane!=='direct'||r.publication_integrity==='retracted'||!text(r.evidence).trim()))continue;
        const hay=new Set(expandedWords([r.topic,r.claim,r.metric,r.value,r.unit,Object.values(r.scope||{}).join(' ')].join(' ')));
        const hits=terms.filter(t=>researchTermPresent(hay,t)).length,coverage=hits/Math.max(1,terms.length);
        if(hits<1||coverage<Math.min(.6,2/Math.max(1,terms.length)))continue;
        const age=now-Date.parse(r.checked_at),ttl=this.ttlDays(r)*86400000,stale=!Number.isFinite(age)||age<0||age>ttl;
        const metricFit=!metrics.length||metrics.includes(r.metric)?1:0;
        if(fresh&&(stale||r.volatile&&age>ttl))continue;
        const score=coverage*4+metricFit*.8+Math.max(0,Number(r.confidence)||0)*.4+(norm(r.topic)===norm(stripResearchOutput(q))?.6:0)-(stale?.7:0);
        rows.push({...r,age_ms:age,stale,score:Number(score.toFixed(3))});
      }
      const selected=rows.sort((a,b)=>b.score-a.score||String(b.checked_at).localeCompare(String(a.checked_at))).slice(0,limit);
      const sources=[];for(const r of selected)if(!sources.some(s=>s.url===r.source_url))sources.push({id:'S'+(sources.length+1),title:r.source_title,url:r.source_url,published:r.source_published||'',text:r.evidence,kind:'saved-research'});
      const sourceId=new Map(sources.map(s=>[s.url,s.id]));for(const r of selected)r.citation_id=sourceId.get(r.source_url)||'';
      const strong=selected.length>0&&selected[0].score>=3.0;
      return {schema:3,lane:'research_library',status:strong?'ok':'no_evidence',query:q,records:strong?selected:[],sources:strong?sources:[],checked_at:selected[0]?.checked_at||'',stale_count:selected.filter(r=>r.stale).length,volatile:this.volatile(q),reason:strong?'matched':'weak_match'};
    }
  }
export {ResearchLibrary};
