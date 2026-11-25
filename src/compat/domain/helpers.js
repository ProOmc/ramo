
function ocCoreCountInput(body){
    let chars=0;
    for(const m of (Array.isArray(body?.messages)?body.messages:[])){
      const content=m?.content;
      if(typeof content==='string')chars+=content.length;
      else if(content!=null){try{chars+=JSON.stringify(content).length;}catch(_){}}
      if(m?.tool_calls){try{chars+=JSON.stringify(m.tool_calls).length;}catch(_){}}
      chars+=10;
    }
    if(body?.tools){try{chars+=JSON.stringify(body.tools).length;}catch(_){}}
    if(body?.format&&typeof body.format==='object'){
      try{chars+=JSON.stringify(body.format).length;}catch(_){}
    }
    // Tokenizer-independent provisional estimate; replaced with provider usage on completion.
    return Math.max(1,Math.round(chars/3.7));
  }

function ocCoreReasoningMode(think){
    if(think===false||think===0||/^(false|off|none|0)$/i.test(String(think)))return 'off';
    if(think===true)return 'on';
    if(typeof think==='string'&&/^(high|xhigh|extra[_ -]?high|maximum)$/i.test(think))return 'high';
    if(typeof think==='string'&&/^(low|medium|on|true)$/i.test(think))return 'on';
    return 'unspecified';
  }

function ocCoreWorkStart(id,body,lane){
    try{
      const meter=globalThis.__ramoInferenceMeter||(globalThis.__ramoInferenceMeter={active:{},last:null,seq:0});
      const entry={id,seq:++meter.seq,model:String(body?.model||''),lane:String(lane||''),think:ocCoreReasoningMode(body?.think),inputTokens:ocCoreCountInput(body),estimated:true,startedAt:Date.now()};
      meter.active[id]=entry;
      meter.last=entry;
    }catch(_){}
  }

function ocCoreWorkEnd(id,response,failed){
    try{
      const meter=globalThis.__ramoInferenceMeter;
      if(!meter||!meter.active)return;
      const entry=meter.active[id];if(!entry)return;
      const actual=Number(response?.prompt_eval_count);
      if(Number.isFinite(actual)&&actual>0){entry.inputTokens=Math.round(actual);entry.estimated=false;}
      entry.finishedAt=Date.now();entry.failed=!!failed;
      meter.last={...entry};delete meter.active[id];
    }catch(_){}
  }

const ANYSEARCH_API_KEY_STORAGE = 'AI_SEARCH_API_KEY_V1';

const VERSION = 'research-architecture-2.4.0-dev-shared-report-review';

const STORE = 'AI_ASSISTANT_V282_STATE';

const U130_SEMANTIC_LOOP_ENABLED=true;

const U131_WORKER_THINKING_CIRCUIT_BREAKER=true;

const U140_MASTER_ENABLE=true;

const U140_RESEARCH_LIBRARY_V2=U140_MASTER_ENABLE;

const U150_MAX_CONTEXT_ATTEMPTS=3;

const text = v => String(v == null ? '' : v);

const requestText=v=>{
    let s=text(v).replace(/^\uFEFF/,'').trim();
    for(let pass=0;pass<4;pass++){
      const before=s;
      s=s.replace(/^```(?:text|txt|markdown|md)?\s*/i,'').replace(/\s*```$/,'').trim();
      s=s.replace(/^(?:>\s*|[-*•]\s+)(?=\S)/,'').trim();
      const pairs=[['"','"'],['“','”'],['„','”'],['«','»'],['`','`'],["'","'"],['‘','’']];
      for(const [a,b] of pairs){
        if(s.length>2&&s.startsWith(a)&&s.endsWith(b)){s=s.slice(a.length,s.length-b.length).trim();break;}
      }
      // A copied opening quote can survive without its closing quote after UI/file processing.
      s=s.replace(/^(?:["“„«`]|'(?=[A-Za-z]))\s*(?=(?:can|could|would|will|please|create|write|generate|make|prepare|compile|produce|draft|build|provide|give|get|have|put|do|conduct|research|deep|investigate|learn|look|find|tell|explain)\b)/i,'').trim();
      if(s===before)break;
    }
    return s;
  };

const norm = v => text(v).toLowerCase().replace(/[’]/g,"'").replace(/[^a-z0-9]+/g,' ').trim();

const words = v => norm(v).split(' ').filter(x=>x.length>1 && !STOP.has(x));

const STOP = new Set('what who when where how which do does did is are was were the a an to of for on at in with and or my your me i you we our about tell know else more please name information earlier said decide decided'.split(' '));

const hash = v => {let h=2166136261;for(const c of text(v)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36);};

const json = (v,fallback=null) => {try{return typeof v==='string'?JSON.parse(v):v??fallback;}catch(_){return fallback;}};

const researchArray = v => Array.isArray(v) ? v : [];

const ownArray=(obj,key)=>obj&&Object.prototype.hasOwnProperty.call(obj,key)&&Array.isArray(obj[key])?obj[key]:[];

const ownString=(obj,key,fallback='')=>obj&&Object.prototype.hasOwnProperty.call(obj,key)&&typeof obj[key]==='string'?obj[key]:fallback;

const researchObject=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};

const boundedText=(v,n)=>text(v).replace(/\s+/g,' ').trim().slice(0,n);

const boundedStringArray=(v,max=12,len=180)=>[...new Set(researchArray(v).map(x=>boundedText(x,len)).filter(Boolean))].slice(0,max);

function u145Norm(v){return String(v||'').normalize('NFKC').toLowerCase().replace(/[\u2010-\u2015\u2212]/g,'-').replace(/([a-z])[- ]+(\d)/g,'$1$2').replace(/[^a-z0-9.]+/g,' ').trim().replace(/\s+/g,' ');}

function u145Contains(h,n){const hay=u145Norm(h).replace(/\b([a-z]+\d+(?:\.\d+)*) (\w+) and (\w+)\b/g,'$1 $2 and $1 $3');return !!n&&(' '+hay+' ').includes(' '+u145Norm(n)+' ');}

function u150SoftCurrentCue(request){return /\b(?:new|newly|latest|current(?:ly)?|recent(?:ly)?|just released|just launched|dropped|launched|released|announced|introduced|unveiled|rolled out|update|updated|newest|right now|today|this week)\b/i.test(requestText(request));}

function u150CommonPublicSuffix(host){
  const h=text(host).toLowerCase().replace(/^www\./,'').split(':')[0],parts=h.split('.').filter(Boolean);if(parts.length<=2)return h;const last2=parts.slice(-2).join('.'),common=new Set(['co.uk','org.uk','gov.uk','ac.uk','com.au','net.au','org.au','co.nz','com.br','com.mx','co.jp','co.kr','com.sg','com.tr','com.cn','com.tw','co.in']);return common.has(last2)?parts.slice(-3).join('.'):last2;
}

function u150DomainCore(host){const root=u150CommonPublicSuffix(host),parts=root.split('.');return parts.length>1?parts[0]:root;}

function u154CommunityHost(source,host=''){
  let h=text(host).toLowerCase().replace(/^www\./,'');if(!h)try{h=new URL(text(source?.url)).hostname.toLowerCase().replace(/^www\./,'');}catch(_){}
  let path='';try{path=new URL(text(source?.url)).pathname.toLowerCase();}catch(_){}
  const title=text(source?.title).toLowerCase();return /^(?:community|forum|forums|discuss|discussion|discourse)\./.test(h)||/(?:^|\.)(?:community|forum|forums|discuss|discussion|discourse)\./.test(h)||/(?:^|\/)(?:community|forum|forums|discuss|discussion|discourse)(?:\/|$)/.test(path)||/\b(?:feature requests?|bugs?|community discussion|forum thread)\b/.test(title);
}

function u154VerifiedOrganizationMetadata(source,host=''){
  const meta=researchObject(source?.page_metadata),vals=[meta.publisher,meta.publisher_name,meta.organization,meta.organization_name,meta.site_name,meta.siteName,meta.application_name,source?.publisher,source?.organization].map(x=>typeof x==='object'?text(x?.name||x?.legalName):text(x)).map(x=>x.trim()).filter(Boolean),core=u150DomainCore(host||(()=>{try{return new URL(text(source?.url)).hostname}catch(_){return ''}})()),compact=v=>u145Norm(v).replace(/[^a-z0-9]/g,'');
  for(const v of vals){const c=compact(v);if(c&&core&&(c===core||c.startsWith(core)||core.startsWith(c)))return v;}return '';
}

function u154ExplicitOfficialAuthor(source){const meta=researchObject(source?.page_metadata),blob=[source?.author_role,source?.author_type,source?.author_verified,source?.staff,source?.official_author,meta.author_role,meta.author_type,meta.staff,meta.verified_author].map(text).join(' ');return source?.official===true||/\b(?:official|staff|employee|administrator|organization)\b/i.test(blob);}

function u154OwnerCandidateHint(source,contract={}){
  let host='',path='';try{const u=new URL(text(source?.url));host=u.hostname.toLowerCase().replace(/^www\./,'');path=u.pathname.toLowerCase();}catch(_){}
  const socialOrAggregator=/(?:^|\.)(?:reddit\.com|facebook\.com|instagram\.com|threads\.net|x\.com|twitter\.com|linkedin\.com|youtube\.com|youtu\.be)$/.test(host);if(!host||socialOrAggregator||u154CommunityHost(source,host))return {confidence:0,basis:[]};const title=text(source?.title),subjects=researchArray(contract?.subjects||contract?.objects),aliases=subjects.flatMap(o=>researchArray(o?.aliases).length?o.aliases:[o?.surface]).map(text).filter(Boolean),hits=aliases.filter(a=>u145Contains(title,a)).length,needed=Math.max(1,Math.min(2,aliases.length)),launchTitle=/^\s*(?:introducing|announcing|launching|release notes?|documentation|developer documentation|what(?:'s| is) new)\b/i.test(title),launchPath=/(?:^|\/)(?:introducing|announcing|release-notes?|documentation)(?:[\/-]|$)/i.test(path),score=hits>=needed&&(launchTitle||launchPath)?.72:0;return {confidence:score,basis:score?['exact_target_page_identity',launchTitle?'launch_style_title':'launch_or_documentation_path'].filter(Boolean):[]};
}

function u155DeclaredOrganizationMetadata(source){const meta=researchObject(source?.page_metadata),vals=[meta.publisher,meta.publisher_name,meta.organization,meta.organization_name,meta.site_name,meta.siteName,meta.application_name,source?.publisher,source?.organization].map(x=>typeof x==='object'?text(x?.name||x?.legalName):text(x)).map(x=>x.trim()).filter(Boolean);return vals[0]||'';}

function u150AuthorityProfile(source,planOrContract={}){
  const contract=planOrContract?.contract?planOrContract.contract:planOrContract,requestContract=planOrContract?.request_object_contract||contract?.request_object_contract||{},out={relationship:'unknown',confidence:0,organization:'',source_role:'ordinary_web',evidence_class:'verified_web',basis:[]};
  if(source?.official===true)return {...out,relationship:'first_party',confidence:1,source_role:'official_primary',evidence_class:'official_primary',basis:['provider_or_api_explicit_official']};
  if(source?.kind==='science'&&(source?.doi||source?.openalex_id))return {...out,relationship:'independent_primary',confidence:.88,source_role:'scholarly_primary_candidate',evidence_class:'academic_primary',basis:['scholarly_record']};
  let host='';try{host=new URL(text(source?.url)).hostname.toLowerCase().replace(/^www\./,'');}catch(_){return out;}const core=u150DomainCore(host),compact=v=>u145Norm(v).replace(/[^a-z0-9]/g,''),titleBody=text(source?.title)+' '+text(source?.search_text||source?.snippet||source?.text||'').slice(0,5000),communityHost=u154CommunityHost(source,host),hostVerifiedOrg=u154VerifiedOrganizationMetadata(source,host),declaredOrg=u155DeclaredOrganizationMetadata(source),officialAuthor=u154ExplicitOfficialAuthor(source);
  const graphOrgs=researchArray(planOrContract?.authority_graph?.organizations||planOrContract?.__runtime_authority_graph?.organizations),publisherRows=[...researchArray(requestContract?.publishers),...researchArray(contract?.publishers),...researchArray(planOrContract?.organizations),...graphOrgs].map(x=>({name:text(x?.surface||x?.name||x),confidence:Number(x?.confidence)||0,provisional:!!x?.provisional||x?.relation==='learned_originator_hypothesis'})).filter(x=>x.name),knownPublisher=publisherRows.find(row=>compact(row.name)&&declaredOrg&&compact(row.name)===compact(declaredOrg));
  for(const row of publisherRows){const name=row.name,c=compact(name);if(c&&core===c){if(communityHost&&!officialAuthor)return {...out,relationship:'hosted_by_subject_org',confidence:.48,organization:name,source_role:'hosted_community',evidence_class:'secondary_web',basis:['publisher_domain_host_match','community_or_forum_surface','author_not_verified']};if(row.provisional)return {...out,relationship:'provisional_subject_publisher',confidence:Math.max(.58,Math.min(.74,row.confidence||.68)),organization:name,source_role:'probable_owner_host',evidence_class:'verified_web',basis:['learned_organization_hypothesis','domain_match_not_yet_author_verified']};return {...out,relationship:'first_party',confidence:.97,organization:name,source_role:'official_primary',evidence_class:'official_primary',basis:['publisher_domain_match']};}}
  const subjects=researchArray(requestContract?.subjects||requestContract?.objects).flatMap(o=>researchArray(o.aliases).length?o.aliases:[o.surface]).map(text).filter(Boolean),targetHit=subjects.some(subj=>u145Contains(titleBody,subj));
  if(knownPublisher&&targetHit&&!communityHost)return {...out,relationship:'first_party',confidence:.94,organization:knownPublisher.name,source_role:'official_primary',evidence_class:'official_primary',basis:['page_declared_organization_matches_known_publisher','requested_target_in_page_identity']};
  if(knownPublisher&&targetHit&&communityHost&&officialAuthor)return {...out,relationship:'first_party',confidence:.90,organization:knownPublisher.name,source_role:'official_community_announcement',evidence_class:'official_primary',basis:['page_declared_organization_matches_known_publisher','verified_official_author','requested_target_in_page_identity']};
  let brandHit='';for(const subj of subjects){const c=compact(subj);if(c.length<4)continue;const titleHit=u145Contains(titleBody,subj),brandDomain=core===c||core==='play'+c||core===c+'game';if(brandDomain&&titleHit){brandHit=subj;break;}}
  if(brandHit&&!communityHost)return {...out,relationship:'probable_product_owner_candidate',confidence:declaredOrg?.70:.62,organization:declaredOrg||hostVerifiedOrg||'',source_role:'probable_owner_page',evidence_class:'verified_web',basis:['subject_branded_domain_hint','target_in_page_identity',declaredOrg?'page_declares_organization':'organization_not_yet_verified']};
  if(brandHit&&communityHost)return {...out,relationship:'hosted_product_community',confidence:.38,organization:declaredOrg||hostVerifiedOrg||'',source_role:'hosted_community',evidence_class:'secondary_web',basis:['subject_branded_domain_hint','community_or_forum_surface','author_not_verified']};
  const ownerHint=u154OwnerCandidateHint(source,requestContract);if(ownerHint.confidence)return {...out,relationship:'probable_owner_candidate',confidence:ownerHint.confidence,organization:hostVerifiedOrg||'',source_role:'probable_owner_page',evidence_class:'verified_web',basis:ownerHint.basis};
  if(/\.(?:gov|mil)$/.test(host))return {...out,relationship:'institutional_primary',confidence:.8,source_role:'official_institutional',evidence_class:'official_primary',basis:['government_domain']};
  if(/\.edu$/.test(host))return {...out,relationship:'institutional',confidence:.58,source_role:'institutional_source',evidence_class:'verified_web',basis:['education_domain']};
  return out;
}

function u151Day(value){
  const s=String(value||'').trim();if(!s)return '';let d;
  if(/^\d{4}-\d{2}-\d{2}/.test(s))d=new Date(s.slice(0,10)+'T00:00:00Z');
  else if(/^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}/.test(s)){const m=s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);d=new Date(m[2]+' '+m[1]+', '+m[3]+' UTC');}
  else d=new Date(s);
  if(!Number.isFinite(d.getTime()))return '';const y=d.getUTCFullYear();if(y<1000||y>3000)return '';return d.toISOString().slice(0,10);
}

function dateProvenance(source={},claim={}){
  const day=u151Day,body=String(source.text||''),header=body.slice(0,10000).split(/\n\s*(?:#{2,}\s|(?:related (?:articles|stories|content)|recommended|read more|references|footer)\b)/i)[0],meta=researchObject(source.page_metadata),explicit=kind=>{const label=kind==='updated'?'(?:last\\s+updated|updated|modified|article:modified_time|og:updated_time|dateModified|date_modified)':'(?:published|publication date|date published|posted|article:published_time|citation_publication_date|datePublished|date_published)';const re=new RegExp('(?:^|\\n)\\s*(?:\\*\\*)?'+label+'(?:\\*\\*)?\\s*(?::|on)?\\s*([^\\n|]{4,100})','i');return day(header.match(re)?.[1]);};
  const providerPublished=source.date_provenance==='provider_estimate'&&source.published===source.provider_date?'':source.published,published=day(providerPublished||meta.datePublished||meta.date_published||meta.article_published_time||meta.published_time)||explicit('published'),updated=day(source.updated||meta.dateModified||meta.date_modified||meta.article_modified_time||meta.modified_time)||explicit('updated');
  const provider=day(source.provider_published_date||source.provider_date||''),observedAt=text(source.retrieved_at||source.discovered_at||''),observed=day(observedAt),quote=String(claim.quote||''),eventMatch=quote.match(/\b(?:on|in|effective|as of)\s+((?:\d{4}-\d{2}-\d{2})|(?:\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})|(?:[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}))\b/i),effective=String(claim.claim_effective_time||claim.scope?.date||eventMatch?.[1]||''),grounded=day(effective);
  const verified=updated||published,confidence=verified?'page_verified':grounded?'claim_grounded':provider?'provider_estimate':'unknown',best=verified||grounded||provider;
  return {page_published:published,page_updated:updated,provider_estimate:provider,provider_name:text(source.provider_name||source.search_provider||''),retrieved_at:observedAt,observed_date:observed,claim_effective_at:grounded,quote_event_at:grounded,best_available_date:best,confidence,provisional:!verified&&!grounded&&!!provider,basis:updated?'page_updated':published?'page_published':grounded?'claim_effective':provider?'provider_estimate':'unknown'};
}

function u151TemporalProfile(source={},claim={},contract={}){
  const d=dateProvenance(source,claim),verified=d.page_updated||d.page_published||d.claim_effective_at,chosen=verified||d.provider_estimate,volatile=/\b(?:current(?:ly)?|latest|today|now|available|unavailable|released|unreleased|price|cost|version|supports?|does not support|ceo|president|rank(?:ing)?|law|policy)\b/i.test(text(claim.claim||claim.quote)),historical=/\b(?:historical|history|formerly|previously|in (?:1[5-9]|20)\d{2})\b/i.test(text(claim.claim||claim.quote));
  return {verified_published_at:d.page_published,verified_updated_at:d.page_updated,claim_effective_at:d.claim_effective_at,provider_estimated_at:d.provider_estimate,provider_name:d.provider_name,observed_at:d.retrieved_at,best_available_date:chosen,confidence:d.confidence,date_basis:d.basis,provisional:d.provisional,claim_temporal_type:historical?'historical':volatile?'current_state':d.claim_effective_at?'event':'stable_or_unknown'};
}

function publishedVerifiedClaimIds(j){
  const report=String(j.report||''),allowed=Array.isArray(j.u140_verified_claim_ids)?new Set(j.u140_verified_claim_ids):null,ids=new Set();
  for(const verdict of (Array.isArray(j.u140_verification?.verdicts)?j.u140_verification.verdicts:[])){
    const sentence=String(verdict.text||'').replace(/<[CI]\d+>/g,'').trim();
    if(verdict.status!=='SUPPORTED'||verdict.removed||!sentence||!report.includes(sentence))continue;
    for(const id of (Array.isArray(verdict.evidence_ids)?verdict.evidence_ids:[]))if(!allowed||allowed.has(id))ids.add(id);
  }
  return ids;
}

const normalizeSemanticBrief=v=>{
    const x=researchObject(v),confidence=Math.max(0,Math.min(1,Number(x.interpretation_confidence)||0));
    return {
      object_mentions:researchArray(x.object_mentions).slice(0,12).map(o=>({surface:boundedText(o.surface,160),shared_prefix:boundedText(o.shared_prefix,100)})),
      subject_surface:boundedText(x.subject_surface,160),
      requested_object_type:boundedText(x.requested_object_type,120),
      task_goal:boundedText(x.task_goal,220),
      canonical_terms:boundedStringArray(x.canonical_terms,12,100),
      adjacent_not_equivalent:boundedStringArray(x.adjacent_not_equivalent,12,120),
      likely_interpretations:researchArray(x.likely_interpretations).map(y=>({label:boundedText(y?.label,140),evidence_phrase:boundedText(y?.evidence_phrase,180)})).filter(y=>y.label).slice(0,4),
      hard_constraints_observed:boundedStringArray(x.hard_constraints_observed,8,160),
      unresolved_semantic_questions:boundedStringArray(x.unresolved_semantic_questions,6,180),
      interpretation_confidence:confidence,
      needs_context_resolution:!!x.needs_context_resolution,
      interpretation_rationale:boundedText(x.interpretation_rationale,400)
    };
  };

const normalizeResearchUnderstanding=v=>{
    const x=researchObject(v);
    return {
      current_summary:boundedText(x.current_summary,1800),
      leading_interpretation:boundedText(x.leading_interpretation,240),
      key_entities:boundedStringArray(x.key_entities,12,120),
      confirmed_terms:boundedStringArray(x.confirmed_terms,12,100),
      rejected_interpretations:boundedStringArray(x.rejected_interpretations,12,180),
      unresolved_gaps:boundedStringArray(x.unresolved_gaps,12,180),
      conflicts:boundedStringArray(x.conflicts,12,180),
      candidate_answer_or_hypothesis:boundedText(x.candidate_answer_or_hypothesis,500),
      last_updated_round:Math.max(0,Number(x.last_updated_round)||0)
    };
  };

const normalizeContextSearchState=v=>{
    const x=researchObject(v);
    const attempts=Math.max(0,Number(x.attempts)||Number(x.attempted?1:0)||0),max_attempts=Math.max(1,Math.min(U150_MAX_CONTEXT_ATTEMPTS,Number(x.max_attempts)||U150_MAX_CONTEXT_ATTEMPTS));return {attempted:attempts>0,attempts,max_attempts,round:Math.max(0,Number(x.round)||0),reason:boundedText(x.reason,240),query:boundedText(x.query,320),resolved:!!x.resolved,revision_count:Math.max(0,Number(x.revision_count)||0)};
  };

const modelJSON=(v,fallback=null)=>{
    if(typeof v!=='string')return v??fallback;
    const raw=text(v).trim(),direct=json(raw,null);if(direct!==null)return direct;
    const unfenced=raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim(),fromFence=json(unfenced,null);if(fromFence!==null)return fromFence;
    const firstObj=unfenced.indexOf('{'),lastObj=unfenced.lastIndexOf('}');if(firstObj>=0&&lastObj>firstObj){const parsed=json(unfenced.slice(firstObj,lastObj+1),null);if(parsed!==null)return parsed;}
    const firstArr=unfenced.indexOf('['),lastArr=unfenced.lastIndexOf(']');if(firstArr>=0&&lastArr>firstArr){const parsed=json(unfenced.slice(firstArr,lastArr+1),null);if(parsed!==null)return parsed;}
    return fallback;
  };

const rows = v => {const x=json(v,[]);return Array.isArray(x)?x:Array.isArray(x?.memories)?x.memories:Array.isArray(x?.records)?x.records:[];};

const human = v => !!text(v).trim() && !/^(?:TURN CONTEXT|SEARCH RESULTS|REFERENCE MEMORY|ROLLING CONVERSATION STATE|BEGIN RETRIEVED DATA|!)/i.test(text(v).trim());

const recall = v => /\b(?:remember|what else|know about|told you|we decided|we discuss|earlier|my .*name|who is my)\b/i.test(v);

const clean = v => text(v).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();

const researchClean = v => text(v).replace(/<[^>]*>/g,' ').replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();

const validURL = v => {try{const u=new URL(v);if(!['http:','https:'].includes(u.protocol))return '';u.hash='';for(const k of [...u.searchParams.keys()])if(k.startsWith('utm_'))u.searchParams.delete(k);return u.href;}catch(_){return '';}};

const phraseIncludes=(hay,needle)=>{const h=norm(hay),n=norm(needle);return !!n&&(' '+h+' ').includes(' '+n+' ');};

const MEMORY_EMBED_MODEL_STORAGE='AI_MEMORY_EMBED_MODEL_V1';

const MEMORY_DB='AI_ASSISTANT_V282_MEMORY_INDEX';

const MEMORY_SCHEMA_VERSION=2;

const SINGLE_PREDICATES=new Set(['name','full_name','lives_in','current_location','works_as','occupation','employer','primary_job','breed','birthday','age','timezone','preferred_name']);

const MEMORY_SYNONYMS=Object.freeze(Object.assign(Object.create(null),{
    dog:['pet','canine','puppy'],cat:['pet','feline','kitten'],pet:['dog','cat','animal'],
    job:['work','career','occupation','employer'],work:['job','career','occupation'],friend:['buddy','relationship'],
    home:['live','location','residence'],live:['home','location','residence'],location:['live','home','place'],
    like:['prefer','favorite','enjoy'],prefer:['like','favorite','enjoy'],favorite:['prefer','like'],
    car:['vehicle','auto'],project:['app','software','work'],name:['called','named'],called:['name','named'],
    scared:['fear','afraid'],afraid:['fear','scared'],fear:['afraid','scared'],decision:['decided','choice'],
    community:['users','players','fans','audience','reviewers'],reception:['opinion','sentiment','reviews','reactions','feedback'],opinion:['sentiment','reception','review','reaction'],sentiment:['opinion','reception','reaction'],
    positive:['praise','praised','liked','satisfied','favorable'],negative:['complaint','complained','disliked','criticism','criticized','unfavorable'],praise:['positive','liked'],complaint:['negative','criticism'],
    limitation:['caveat','constraint','boundary'],failure:['fail','failed','worse','degradation'],mechanism:['process','pathway','causal','works']
  }));

const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,Number(n)||0));

const iso=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?d.toISOString():'';};

const tokenCounts=v=>{const m=new Map();for(const w of words(v))m.set(w,(m.get(w)||0)+1);return m;};

const expandedWords=v=>{const out=new Set(words(v));for(const w of [...out])for(const s of ownArray(MEMORY_SYNONYMS,w))if(typeof s==='string'&&s)out.add(s);return [...out];};

const jaccard=(a,b)=>{const A=new Set(words(a)),B=new Set(words(b));if(!A.size||!B.size)return 0;let n=0;for(const x of A)if(B.has(x))n++;return n/(A.size+B.size-n);};

const predicateKey=v=>{const k=norm(v).replace(/\s+/g,'_').slice(0,80)||'related_to';const aliases=Object.assign(Object.create(null),{resides_in:'lives_in',current_location:'lives_in',location:'lives_in',full_name:'name',preferred_drink:'favorite_drink',enjoys:'likes',like:'likes',prefer:'prefers'});const raw=k.startsWith('not_')?k.slice(4):k,alias=ownString(aliases,raw,raw);return k.startsWith('not_')?'not_'+alias:alias;};

const activeObservation=(o,d)=>{const ids=researchArray(o?.source_memory_ids);return o?.status==='active'&&ids.length>=2&&ids.every(id=>researchArray(d?.facts).some(f=>f.id===id&&f.status==='active'));};

const contentTerms=q=>expandedWords(q).filter(w=>!new Set('user users current latest recent now today yesterday last week month year before previous earlier formerly used then did does happened happen said told saved memory memories information details know facts fact find search web online official research papers studies scientific assistant can could would should about please explain tell give how'.split(' ')).has(w)&&!/^\d{4}$/.test(w));

const historicalQuery=q=>/\b(?:before|previous|earlier|used to|formerly|back then|yesterday|last (?:week|month|year)|(?:19|20)\d{2})\b/i.test(q);

const releaseObjectPattern='(?:update|release|patch|version|model|event|game\s+mode|mode|driver|firmware|launch|announcement)';

const currentResearchSignal=q=>{const s=text(q),soft=u150SoftCurrentCue(s),consensusOnly=/\bcurrent\s+(?:scientific|research)?\s*consensus\b/i.test(s)&&!/\b(?:latest|right now|today|tomorrow|recent|newest|upcoming|this week|news|as of)\b/i.test(s);if(soft||/\b(?:latest|right now|today|tomorrow|recent|newest|upcoming|this week|news)\b/i.test(s))return true;if(/\bcurrent\b/i.test(s)&&!consensusOnly)return true;const near=new RegExp('\\b(?:next|new)\\b(?:\\s+[A-Za-z0-9][A-Za-z0-9._+\\-\\u2019\\u0027:]*){0,5}\\s+'+releaseObjectPattern+'\\b','i');return near.test(s)||new RegExp('\\b'+releaseObjectPattern+'\\b(?:\\s+[A-Za-z0-9][A-Za-z0-9._+\\-\\u2019\\u0027:]*){0,5}\\s+\\b(?:next|upcoming|latest|current|newest)\\b','i').test(s);};

const freshQuery=q=>currentResearchSignal(q)||/\b(?:price|availability|weather|release|version|score|ranking|stock|exchange rate)\b/i.test(q);

const reuseSavedSearchQuery=q=>/^(?:show|use|open|reuse|give me|let me see)(?: me)?\s+(?:that|the|same|previous|last|saved)\s+(?:search|sources|results)(?:\s+again)?[?.!]*$/i.test(text(q).trim())||/^(?:same|previous|last|saved)\s+(?:search|sources|results)(?:\s+again)?[?.!]*$/i.test(text(q).trim());

const refreshQuery=q=>!reuseSavedSearchQuery(q)&&/\b(?:search|look up|look online|check online|browse|verify|fact.check|refresh|new search|find (?:new )?sources|search again|check again|browse again|verify again|rerun search|update search)\b/i.test(q);

const outputFormatRequest=input=>{
    const raw=requestText(input);
    const txt=/\b(?:txt|\.txt|text file|plain[- ]text file)\b/i.test(raw);
    if(!txt)return '';
    const negated=/(?:do not|don't|no)\s+(?:create|save|export|download|make|send|give|return)|without\s+(?:a\s+)?(?:txt|text file)/i.test(raw);
    if(negated)return '';
    const outputish=/\b(?:report|analysis|write[- ]?up|document|file|create|write|make|prepare|compile|produce|save|send|give|export|return|download|generate|provide|put together)\b/i.test(raw);
    return outputish?'txt':'';
  };

const stripResearchOutput=q=>text(q).trim()
    // Format words are presentation metadata, not part of the factual subject.
    .replace(/\b(?:\.?(?:txt)|text file|plain[- ]text file)\s+(?=(?:(?:sourced|detailed|short|full|quick|brief|comprehensive)\s+)?(?:report|analysis|write[- ]?up|document)\b)/ig,'')
    .replace(/\s+(?:(?:and|then)\s+)?(?:give|send|save|export|return|download|put|make|provide)(?:\s+(?:it|me))?\s+(?:as\s+)?(?:a\s+)?(?:\.?txt|text file|plain[- ]text file|document|markdown|md|pdf|docx)\s*(?:file|document)?[.!?]*$/i,'')
    .replace(/\s+(?:and|then)\s+(?:give|send|save|export|return|download|put|make|provide|let me download)(?:\s+(?:it|me))?\b[^\n]*\b(?:\.?txt|text file|plain[- ]text file|document|markdown|md|pdf|docx)\b[^\n]*$/i,'')
    .replace(/\s+(?:as|in|into|to)\s+(?:a\s+)?(?:\.?txt|text file|plain[- ]text file|text|markdown|md|pdf|docx)\s*(?:file|document)?[.!?]*$/i,'')
    .replace(/\s+(?:and|then)\s+(?:create|write|generate|make|prepare|compile|produce|draft|build|provide|put together)(?:\s+me)?\s+(?:a\s+|an\s+)?(?:sourced\s+|detailed\s+|short\s+|full\s+|quick\s+|brief\s+|comprehensive\s+)?(?:research\s+)?(?:report|analysis|write[- ]?up)\s*[.!?]*$/i,'')
    .replace(/[\s,;:]+$/,'').replace(/[.!?]+$/,'').replace(/\s+/g,' ').trim();

const stripResearchDirectiveTail=value=>text(value).trim()
    .replace(/\s*(?:[,;:]|\b(?:and|but)\b)\s*(?:do not|don't|never)\s+(?:include|cover|discuss|mention|research|analy[sz]e|consider|add|report|show|list|focus\s+on|confuse)\b[\s\S]*$/i,'')
    .replace(/\s*(?:[,;:]|\b(?:and|but)\b)?\s*(?:exclude|excluding|omit|leave\s+out)\b[\s\S]*$/i,'')
    .replace(/\s*(?:[,;:]|\b(?:and|but)\b)?\s*without\s+(?:discussion|mention|coverage|analysis|research|including|references?|citations?|animal\s+studies?|preprints?|case\s+reports?|community\s+sources?|forums?|social\s+media)\b(?:\s+(?:of\s+)?[\s\S]*)?$/i,'')
    .replace(/\s*(?:[,;:]|\b(?:and|but)\b)?\s*(?:no|without)\s+(?:citations?|references?)\b[\s\S]*$/i,'')
    .replace(/\s*(?:[,;:]|\b(?:and|but)\b)?\s*(?:with|using)\s+(?:citations?|references?)\b[\s\S]*$/i,'')
    .replace(/\s*(?:[,;:]|\b(?:and|but)\b)\s*(?:cite|provide|include|list|add)\s+(?:(?:reliable|primary|official|supporting)\s+)?(?:sources?|references?|citations?)\b[\s\S]*$/i,'')
    .replace(/\s*(?:[,;:]|\b(?:and|but)\b)\s*(?:summari[sz]e|synthesize)\s+(?:(?:the\s+)?(?:findings?|evidence|results?)|what\s+(?:the\s+)?(?:evidence|results?|sources?)\s+(?:say|show))\b[\s\S]*$/i,'')
    .replace(/\s+(?:using|from|with|based\s+on|rely(?:ing)?\s+on)\s+(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}\s+only\s*$/i,'')
    // Named-organizational or domain source directives are metadata rather than subject text.
    .replace(/\s*(?:[,;:]|\b(?:and|but)\b)?\s*(?:use|using|from|rely(?:ing)?\s+on|based\s+on|with)\s+[^.;!?]{1,100}\b(?:official\s+(?:sources?|documentation|docs)|sources?\s+only)\s*$/i,'')
    // Source-selection language is contract metadata, not part of the factual subject.
    .replace(/\s*(?:[,;:]|\b(?:and|but)\b)?\s*(?:(?:use|using|prefer|prioriti[sz]e|rely(?:ing)?\s+on|based\s+on|draw(?:ing)?\s+on|with)\s+)?(?:only\s+)?(?:primary\s+(?:research|sources?)|original\s+research|official\s+(?:technical\s+)?(?:sources?|documentation|docs)|peer[- ]reviewed\s+(?:sources?|papers?|studies|research)|academic\s+(?:sources?|papers?|studies|research)|scientific\s+(?:sources?|papers?|studies|research)|web\s+sources?)\b[\s\S]*$/i,'')
    .replace(/\s+thoroughly\s*$/i,'')
    .replace(/[\s,;:]+$/,'').trim();

const RESEARCH_TASK_STOP=new Set('a an the me my please quick brief detailed full sourced comprehensive report analysis writeup write up txt text file document research deep do some give create make prepare compile produce generate write draft build provide put together about on of into for as most used use usage data result results source sources evidence information current latest'.split(' '));

const contextualResearchTopic=q=>/^(?:it|that|this|them|those|the (?:show|anime|game|movie|report|research|topic|product|project|paper|study|subject))$/i.test(text(q).trim());

const naturalResearchIntent=q=>{
    const s=requestText(q);
    if(/^(?:(?:can|could|would|will) you\s+|(?:can|could|may) i\s+)?(?:please\s+)?(?:(?:do\s+)?(?:extensive|thorough|in[- ]depth|deep)\s+research|research|deep research|investigate|look into|dig into|do a deep dive (?:on|into)|conduct research|find out about)\b/i.test(s))return true;
    if(/\b(?:report|analysis|write[- ]?up|briefing|brief|memo|whitepaper|overview|evidence\s+(?:matrix|table)|literature\s+review)\b/i.test(s)&&/^(?:(?:can|could|would|will) you\s+|(?:can|could|may) i\s+|(?:i (?:want|need)|i(?:'d| would) (?:like|love))\s+)?(?:please\s+)?(?:give|get|have|create|make|prepare|compile|produce|generate|write|draft|build|provide|put together|do)\b/i.test(s)&&/\b(?:research|studies|papers|sources|evidence|citations|sourced|source[- ]backed|evidence[- ]backed|evidence[- ]based|official documentation|peer[- ]reviewed)\b/i.test(s))return true;
    if(/^(?:tell me|explain)\b[\s\S]+\b(?:in|as)\s+(?:a\s+)?(?:(?:brief|detailed|full|sourced|comprehensive)\s+)?(?:research\s+)?(?:report|analysis)\b/i.test(s))return true;
    return false;
  };

const deepResearchReportIntent=q=>{
    const s=requestText(q);
    if(!s)return false;
    if(/\b(?:deep\s+research|research\s+(?:report|analysis|write[- ]?up)|literature\s+review|systematic\s+review|evidence\s+review)\b/i.test(s)
      &&/^(?:(?:can|could|would|will) you\s+|(?:can|could|may) i\s+|(?:i (?:want|need)|i(?:'d| would) (?:like|love))\s+)?(?:please\s+)?(?:do|conduct|research|investigate|create|write|generate|make|prepare|compile|produce|draft|build|provide|give|get|have|put together|learn|look|find)\b/i.test(s))return true;
    if(/\b(?:report|analysis|write[- ]?up)\b/i.test(s)
      &&/\b(?:research|studies|papers|sources|evidence|citations|quantitative|limitations|compare|comparison|peer[- ]reviewed|academic|scientific)\b/i.test(s)
      &&/^(?:(?:can|could|would|will) you\s+|(?:can|could|may) i\s+|(?:i (?:want|need)|i(?:'d| would) (?:like|love))\s+)?(?:please\s+)?(?:create|write|generate|make|prepare|compile|produce|draft|build|provide|give|get|have|put together|do|conduct)\b/i.test(s))return true;
    return naturalResearchIntent(s);
  };

const reportRequested=q=>{const s=requestText(q);return /\b(?:report|analysis|write[- ]?up)\b/i.test(s)&&/\b(?:give|get|have|create|make|prepare|compile|produce|generate|write|draft|build|provide|put together|turn|report|analysis)\b/i.test(s);};

const requiresDeepResearch=q=>{
    const s=requestText(q);if(!s)return false;
    if(deepResearchReportIntent(s))return true;
    const artifact=/\b(?:report|analysis|write[- ]?up|literature review|systematic review|evidence review)\b/i.test(s);
    const researchSignals=(s.match(/\b(?:research|studies|papers|sources|evidence|citations|quantitative|limitations|disagreements?|compare|comparison|peer[- ]reviewed|academic|scientific|methodology|findings)\b/ig)||[]).length;
    const creation=/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:create|write|generate|make|prepare|compile|produce|draft|build|provide|give|get|have|put together|do|conduct)\b/i.test(s);
    if(artifact&&creation&&researchSignals>=1)return true;
    const claimAudit=/\b(?:fact[- ]?check|claim audit|audit (?:every|each|these|the) (?:factual )?claims?|verify (?:each|these|the) claims?|source audit|investigate whether [^.!?]{0,80} is true)\b/i.test(s)&&/\b(?:source|evidence|citation|verify|fact|claim|true|conflicting)\b/i.test(s);
    const sourceReview=/\b(?:find|identify|review|research|give|provide)\b[^.!?]{0,100}\b(?:best|key|most relevant|primary)\s+(?:(?:primary|relevant)\s+)?(?:sources?|papers?|studies|datasets?|benchmarks?)\b/i.test(s);
    const landscape=/\b(?:research|map|analy[sz]e|review)\b[^.!?]{0,100}\b(?:landscape|ecosystem|state of the field|competitive landscape|market map|major approaches)\b/i.test(s);
    const evidenceComparison=/\b(?:compare|comparison|trade[- ]?offs?)\b/i.test(s)&&/\b(?:sources?|evidence|citations?|studies|papers|current|latest|benchmarks?)\b/i.test(s);
    const multiHop=/\b(?:investigate|research|trace|determine)\b[^.!?]{0,140}\b(?:through|mechanism|relationship|relates? to|causal chain|evidence chain|why reports disagree)\b/i.test(s);
    const sourcedCatalog=/\b(?:create|prepare|compile|make|research)\b[^.!?]{0,100}\b(?:sourced|source[- ]backed|complete|documented|comprehensive)\b[^.!?]{0,80}\b(?:catalog|list|timeline|dossier|profile)\b/i.test(s);
    const entityDossier=/\b(?:comprehensive\s+)?(?:dossier|entity profile)\b/i.test(s)&&/\b(?:research|sources?|sourced|source[- ]backed|multiple sources?|comprehensive)\b/i.test(s);
    const explicitReview=/^(?:please\s+)?(?:review|analy[sz]e)\b[^.!?]{0,120}\b(?:evidence|studies|sources|papers|trends?|scenarios?)\b/i.test(s);
    const deepScientific=/\bdeep\s+(?:scientific|academic|evidence[- ]based)\s+research\b/i.test(s);
    const firstPersonSourcedReport=/^(?:i\s+(?:want|need)|i(?:'d| would)\s+(?:like|love))\b[\s\S]{0,140}\b(?:report|analysis|write[- ]?up)\b/i.test(s)&&researchSignals>=1;
    const literatureSurvey=/\b(?:literature\s+survey|survey\s+the\s+literature|research\s+survey)\b/i.test(s);
    const standaloneDeepDive=/^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:deep\s+dive|do\s+a\s+deep\s+dive)\s+(?:on|into)\b/i.test(s);
    const evidenceBackedArtifact=/\b(?:source[- ]backed|sourced|evidence[- ]backed|evidence[- ]based)\s+(?:overview|briefing|brief|review|explanation|memo|whitepaper|matrix|table|timeline|guide)\b/i.test(s);
    const researchArtifact=/\b(?:research\s+memo|literature\s+review|technical\s+whitepaper|evidence\s+(?:matrix|table))\b/i.test(s)&&/\b(?:research|sources?|evidence|studies|papers|citations?|official|peer[- ]reviewed|technical)\b/i.test(s);
    const extensiveResearch=/^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:do|conduct|perform)?\s*(?:extensive|thorough|in[- ]depth|deep)\s+research\b/i.test(s);
    const sourcedExplanation=/\b(?:long|detailed|comprehensive|in[- ]depth)\s+(?:sourced|source[- ]backed|evidence[- ]backed)\s+(?:explanation|overview|review)\b/i.test(s);
    return claimAudit||sourceReview||landscape||evidenceComparison||multiHop||sourcedCatalog||entityDossier||explicitReview||deepScientific||firstPersonSourcedReport||literatureSurvey||standaloneDeepDive||evidenceBackedArtifact||researchArtifact||extensiveResearch||sourcedExplanation;
  };

const researchRequest=q=>{
    const raw=requestText(q).replace(/^[\s.,;:!?]+/,'');
    const input=stripResearchOutput(raw);
    const patterns=[
      {task:'general_report',re:/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:create|write|prepare|compile|produce|generate|give(?: me)?|provide(?: me)?|build)\s+(?:(?:a|an)\s+)?(?:source[- ]backed|sourced|evidence[- ]backed|evidence[- ]based|detailed|comprehensive|in[- ]depth|technical)?\s*(?:overview|briefing|brief|review|explanation|memo|whitepaper|evidence\s+(?:matrix|table)|timeline)\s+(?:about|on|of|into|for)\s+(.+)/i},
      {task:'general_report',re:/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:create|write|prepare|compile|produce|generate|give(?: me)?|provide(?: me)?)\s+(?:(?:a|an)\s+)?(?:literature\s+review|research\s+memo|technical\s+whitepaper|evidence\s+(?:matrix|table))\s+(?:about|on|of|into|for)\s+(.+)/i},
      {task:'research',re:/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:do|conduct|perform)?\s*(?:extensive|thorough|in[- ]depth|deep)\s+research\s+(?:on|about|into|of)?\s*(.+)/i},
      {task:'general_report',re:/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:do\s+)?(?:deep research|research)\s+and\s+(?:(?:create|write|generate|make|prepare|compile|produce|draft|provide|give(?: me)?|put together)\s+)?(?:(?:a|an)\s+)?(?:sourced\s+|detailed\s+|short\s+|full\s+|quick\s+|brief\s+|comprehensive\s+)?(?:research\s+)?(?:report|analysis|write[- ]?up)\s+(?:about|on|of|into|for)\s+(.+)/i},
      {task:'research',re:/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:do\s+)?(?:deep research|research)(?:\s+(?:on|about|into))?\s+(.+)/i},
      {task:'research',re:/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:learn(?: about)?|investigate|look into|dig into|find out about|do a deep dive (?:on|into))\s+(.+)/i},
      {task:'research',re:/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:review|analy[sz]e)\s+(?:(?:recent|current|peer[- ]reviewed|randomized(?: controlled)?|clinical|primary|published)\s+)*(?:evidence|literature|research|studies|papers|trials)\s+(?:on|of|about)\s+(.+)/i},
      {task:'research',re:/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?survey\s+(?:the\s+)?(?:research\s+)?literature\s+(?:on|of|about)\s+(.+)/i},
      {task:'research',re:/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?find\s+(?:(?:the|me)\s+)?(?:best|key|most relevant|primary)?\s*(?:sources?|papers?|studies|datasets?|benchmarks?)\s+(?:on|about|for)\s+(.+)/i},
      {task:'research',re:/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?map\s+(?:the\s+)?(?:current\s+)?(?:ecosystem|landscape|market map)\s+(?:of|for|around)\s+(.+)/i},
      {task:'research',re:/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?trace\s+(.+)/i},
      {task:'research',re:/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?conduct\s+(?:deep\s+)?research\s+(?:into|on|about)\s+(.+)/i},
      {task:'general_report',re:/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:create|write|generate|make|prepare|compile|produce|draft|build|provide|put together)\s+(?:me\s+)?(?:(?:a|an)\s+)?(?:sourced\s+|detailed\s+|short\s+|full\s+|quick\s+|brief\s+|comprehensive\s+)?(?:research\s+)?(?:report|analysis|write[- ]?up)\s+(?:about|on|of|into|for)\s+(.+)/i},
      {task:'general_report',re:/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:give|get|provide)(?:\s+me)?\s+(?:(?:a|an)\s+)?(?:sourced\s+|detailed\s+|short\s+|full\s+|quick\s+|brief\s+|comprehensive\s+)?(?:research\s+)?(?:report|analysis|write[- ]?up)\s+(?:about|on|of|into|for)\s+(.+)/i},
      {task:'general_report',re:/^(?:(?:can|could|may) i\s+)?(?:please\s+)?(?:get|have)\s+(?:(?:a|an)\s+)?(?:sourced\s+|detailed\s+|short\s+|full\s+|quick\s+|brief\s+|comprehensive\s+)?(?:research\s+)?(?:report|analysis|write[- ]?up)\s+(?:about|on|of|into|for)\s+(.+)/i},
      {task:'general_report',re:/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:i (?:want|need)|i(?:'d| would) (?:like|love))\s+(?:you\s+to\s+)?(?:(?:create|write|generate|make|prepare|compile|produce|draft|provide)\s+)?(?:(?:a|an)\s+)?(?:sourced\s+|detailed\s+|short\s+|full\s+|quick\s+|brief\s+|comprehensive\s+)?(?:research\s+)?(?:report|analysis|write[- ]?up)\s+(?:about|on|of|into|for)\s+(.+)/i},
      {task:'general_report',re:/^(?:tell me|explain)\s+(.+?)\s+(?:in|as)\s+(?:a\s+)?(?:sourced\s+|detailed\s+|short\s+|full\s+|quick\s+|brief\s+|comprehensive\s+)?(?:research\s+)?(?:report|analysis|write[- ]?up)$/i},
      {task:'general_report',re:/^(?:report|analysis|write[- ]?up)\s+(?:about|on|of|into|for)\s+(.+)/i},
      {task:'general_report',re:/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:create|write up|write-up|write|make|prepare|compile|turn|put)\s+(.+?)\s+(?:as|into)\s+(?:a\s+)?(?:sourced\s+|detailed\s+|short\s+|full\s+|quick\s+|brief\s+|comprehensive\s+)?(?:research\s+)?(?:report|analysis|write[- ]?up)$/i}
    ];
    let topic='',task='';for(const p of patterns){const match=input.match(p.re);if(match){topic=match[1];task=p.task;break;}}
    if(topic&&reportRequested(raw))task='general_report';
    // Broad natural-language safety net: route obvious report/research requests to the planner even
    // when deterministic subject extraction is imperfect. The structured planner can refine the subject.
    if(!topic&&requiresDeepResearch(input)){
      const after=input.match(/\b(?:research\s+)?(?:report|analysis|write[- ]?up)\s+(?:about|on|of|into|for)\s+(.+)$/i)
        ||input.match(/\b(?:deep\s+research|research|investigate|look into|dig into|find out about|deep dive (?:on|into))\s+(.+)$/i);
      topic=after?.[1]||input;task=/\b(?:report|analysis|write[- ]?up)\b/i.test(raw)||/\bresearch\s+report\b/i.test(raw)?'general_report':'research';
    }
    topic=stripResearchDirectiveTail(stripResearchOutput(topic))
      .replace(/^(?:and\s+)?(?:(?:create|write|generate|make|prepare|compile|produce|draft|provide|give me|put together)\s+)?(?:(?:a|an)\s+)?(?:sourced\s+|detailed\s+|short\s+|full\s+|quick\s+|brief\s+|comprehensive\s+)?(?:research\s+)?(?:report|analysis|write[- ]?up)\s+(?:about|on|of|into|for)\s+/i,'')
      .replace(/^(?:on|about|into|of|for)\s+/i,'')
      .replace(/\s+(?:and\s+)?(?:summari[sz]e|synthesize)\s+what\s+(?:the\s+)?(?:evidence|results?|sources?)\s+(?:says?|shows?)\s*$/i,'')
      .trim();
    const personal=/\b(?:my|our)\s+(?:best friend|friend|brother|sister|partner|mother|father|roommate|dog|cat|pet|name|address|birthday|favorite|decision|conversation|project)\b/i.test(topic);
    return {matched:(!!topic&&requiresDeepResearch(input))||!!task,topic,personal,task:task||'research',output_format:outputFormatRequest(raw)};
  };

const usageRankingIntent=q=>/\b(?:most\s+(?:use|used|played|picked|selected|popular)|top\s+(?:used|played|picked|selected)\b|pick\s*(?:rate|rates|percentage|percent|ranking|rankings|stats|statistics)|usage\s*(?:rate|rates|ranking|rankings|stats|statistics)|agent\s+(?:usage|pick\s*rate|pick\s*rates)|popularity\s*(?:ranking|rankings|stats|statistics)?)\b/i.test(text(q));

const researchMetrics=q=>{
    const s=text(q),out=[];
    if(usageRankingIntent(s)||/\bagents?\b[\s\S]{0,80}\b(?:their\s+)?(?:use|usage)\b/i.test(s)||(/\bwin\s*(?:rate|rates)\b/i.test(s)&&/\b(?:their|its)\s+(?:use|usage)\b/i.test(s)))out.push('pick_rate');
    if(/\bwin\s*(?:rate|rates|percentage|percent|ranking|rankings|stats|statistics)\b/i.test(s))out.push('win_rate');
    if(/\b(?:price|cost|pricing)\b/i.test(s))out.push('price');
    if(/\b(?:version|release(?:\s+state)?)\b/i.test(s))out.push('version');
    if(/\b(?:benchmark|performance|latency|throughput|tokens?\s*\/\s*s|fps)\b/i.test(s))out.push('performance');
    return [...new Set(out)];
  };

const researchMetric=q=>researchMetrics(q)[0]||'';

const volatileResearchMetric=m=>['pick_rate','win_rate','price','version'].includes(text(m));

const academicNeed=q=>/\b(?:papers?|studies|academic|scientific (?:evidence|research|consensus)|research consensus|consensus (?:in|from) (?:the )?(?:scientific|research) literature|peer[- ]reviewed|doi|arxiv|literature review|systematic review|meta[- ]analysis|clinical trials?|research literature|primary research|original research|evidence[- ]based|medical research|clinical evidence|biomedical|neuroscience|epidemiology|review (?:the )?evidence|evidence from the last \d+ (?:years?|months?))\b/i.test(text(q));

const REPORT_MODES=['ACADEMIC_SCIENTIFIC','FACTUAL_EXPLANATORY','CATALOG_LIST','COMPARISON','OPINION_RECEPTION','HISTORICAL_CHRONOLOGY','CURRENT_DATA_META','TECHNICAL_ENGINEERING','INVESTIGATIVE','MIXED'];

const researchDomainList=values=>[...new Set(researchArray(values).map(x=>text(x).toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0].replace(/[^a-z0-9.-]/g,'')).filter(x=>/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(x)))].slice(0,20);

const domainAllowedByPolicy=(source,policy={})=>{
    const d=sourceDomain(source),matches=x=>d===x||d.endsWith('.'+x),allow=researchArray(policy.allowed_domains),block=researchArray(policy.blocked_domains),cls=text(source?.evidence_class||researchEvidenceClass(source)),kind=text(source?.kind),stype=text(source?.source_type||sourceTypeInfo(source));
    if(block.some(matches))return false;if(allow.length&&!allow.some(matches))return false;
    const isOfficial=!!source?.official||allow.some(matches)||/\.(?:gov|edu)(?:\/|$)|who\.int|nasa\.gov/i.test(text(source?.url))||/official_primary/.test(cls),isPeer=/^peer_reviewed_/.test(cls),isAcademic=kind==='science'||/^(?:peer_reviewed|academic_|preprint_)/.test(cls),isPrimary=['peer_reviewed_primary','academic_primary','academic_data','preprint_primary','official_primary','structured_web_data'].includes(cls),hard=researchArray(policy.hard_source_classes);
    if(hard.length){const matchHard=hard.some(x=>x==='official'?isOfficial:x==='peer_reviewed'?isPeer:x==='academic'?isAcademic:x==='primary'?isPrimary:x==='web'?!isAcademic:false);if(!matchHard)return false;}
    if(policy.official_only&&!isOfficial)return false;if(policy.peer_reviewed_only&&!isPeer)return false;if(policy.academic_only&&!isAcademic)return false;if(policy.academic_blocked&&isAcademic)return false;if(policy.preprint_blocked&&/^preprint_/.test(cls))return false;if(policy.community_blocked&&(stype==='community'||cls==='secondary_web'||/(?:^|\.)(?:reddit\.com|x\.com|twitter\.com|facebook\.com|tiktok\.com|youtube\.com|youtu\.be)$/.test(d)))return false;if(policy.primary_research_only&&!['peer_reviewed_primary','academic_primary','academic_data'].includes(cls))return false;if(policy.primary_only&&!isPrimary)return false;return true;
  };

const reportModesOf=plan=>{const a=researchArray(plan?.report_modes).filter(x=>REPORT_MODES.includes(x)&&x!=='MIXED');if(a.length)return [...new Set(a)];const one=plan?.report_mode;return one&&one!=='MIXED'?[one]:['FACTUAL_EXPLANATORY'];};

const facetModeForPlan=(facet,plan)=>{
    const label=norm(facet?.label||facet?.question||''),modes=reportModesOf(plan),has=x=>modes.includes(x);
    if(has('OPINION_RECEPTION')&&/opinion|sentiment|praise|complaint|controvers|community|platform|representative/.test(label))return 'OPINION_RECEPTION';
    if(has('CATALOG_LIST')&&/entity|canonical|alias|categor|attribute|role|abilit|skill|relationship|appearance|coverage gap|inclusion/.test(label))return 'CATALOG_LIST';
    if(has('HISTORICAL_CHRONOLOGY')&&/chronolog|period|turning point|event|cause|driver|actor|consequence|histor/.test(label))return 'HISTORICAL_CHRONOLOGY';
    if(has('CURRENT_DATA_META')&&/current|metric|ranking|scope|date|version|region|rank|population|fresh/.test(label))return 'CURRENT_DATA_META';
    if(has('TECHNICAL_ENGINEERING')&&/latency|memory|context cost|hardware|vram|ram|throughput|system|mechanism|implementation|performance|benchmark|failure|design/.test(label))return 'TECHNICAL_ENGINEERING';
    if(has('ACADEMIC_SCIENTIFIC')&&/evidence|study|effect|outcome|method|measurement|external valid|counterevidence/.test(label))return 'ACADEMIC_SCIENTIFIC';
    if(has('COMPARISON')&&/compar|difference|similar|tradeoff|each/.test(label))return 'COMPARISON';
    return plan?.report_mode&&plan.report_mode!=='MIXED'?plan.report_mode:(modes[0]||'FACTUAL_EXPLANATORY');
  };

const sourceFitnessProfile=(source,plan,facet=null)=>{
    const base=researchSourceQualityProfile(source,plan,facet),mode=facetModeForPlan(facet,plan),url=text(source?.url).toLowerCase(),title=text(source?.title).toLowerCase(),tp=u151TemporalProfile(source,{},plan?.contract||{}),published=Date.parse(tp.best_available_date||''),ageDays=Number.isFinite(published)?Math.max(0,(Date.now()-published)/86400000):99999;
    let score=Number(base.score)||0,tier=base.tier,role='supporting';
    const official=!!source?.official||likelyFirstPartySource(source,plan)||/\b(?:official|documentation|docs|developer|government)\b/i.test(title)||/\.(?:gov|edu)(?:\/|$)|who\.int|nasa\.gov/i.test(url);
    const community=/reddit\.com|steamcommunity|forum|forums|discord|youtube\.com|tiktok\.com|x\.com|twitter\.com/i.test(url)||text(source?.source_type)==='community';
    const wiki=/wiki|fandom\.com/i.test(url);
    if(mode==='ACADEMIC_SCIENTIFIC'){if(base.primary)score+=.12;if(community)score-=.35;if(wiki)score-=.18;}
    if(mode==='CATALOG_LIST'){if(official)score+=.28;if(wiki)score+=.08;if(base.primary&&academicNeed(title))score-=.08;role=official?'canonical':'supporting';}
    if(mode==='OPINION_RECEPTION'){if(community){score+=.26;role='primary_opinion';}else if(/review|editorial/.test(text(source?.source_type)))role='professional_opinion';if(official)score-=.04;}
    const temporalCurrent=!!plan?.contract?.temporal_intent?.current_like||reportModesOf(plan).includes('CURRENT_DATA_META');
    if(mode==='CURRENT_DATA_META'||temporalCurrent){const tstat=researchTemporalSourceStatus(source,plan?.contract||{});if(tstat.status==='stale'||tstat.status==='after_window')score-=.52;else if(tstat.status==='in_window'){if(ageDays<=7)score+=.28;else if(ageDays<=30)score+=.20;else if(ageDays<=90)score+=.10;}else if(ageDays<=7)score+=.24;else if(ageDays<=30)score+=.13;else if(Number.isFinite(published)&&ageDays>180)score-=.24;else if(!Number.isFinite(published))score-=.04;if(official)score+=.18;if(community)score-=.22;}
    if(mode==='HISTORICAL_CHRONOLOGY'&&official)score+=.12;
    if(mode==='TECHNICAL_ENGINEERING'&&official)score+=.18;
    score=Math.max(0,Math.min(1.35,score));
    if(score>=.95)tier='A';else if(score>=.78)tier='B';else if(score>=.58)tier='C';else if(score>=.4)tier='D';else tier='E';
    return {...base,score,tier,task_role:role,official,community,wiki,mode};
  };

const researchTemporalSourceStatus=(source,contract={})=>{
    const temporal=contract?.temporal_intent||{},mode=text(contract?.date_filter_mode||temporal.mode||'none'),start=Date.parse(contract?.date_start||temporal.publication_start||''),end=Date.parse(contract?.date_end||temporal.publication_end||''),prov=u151TemporalProfile(source,{},contract),raw=prov.verified_updated_at||prov.verified_published_at||prov.provider_estimated_at||source?.publication_date||source?.year||'';let ts=Date.parse(text(raw));if(!Number.isFinite(ts)&&/^\d{4}$/.test(text(raw)))ts=Date.parse(text(raw)+'-07-01');const provisional=!prov.verified_updated_at&&!prov.verified_published_at&&!!prov.provider_estimated_at;
    if(mode==='none'||(!Number.isFinite(start)&&!Number.isFinite(end)))return {status:'not_filtered',ok:true,dated:Number.isFinite(ts),provisional,date:Number.isFinite(ts)?new Date(ts).toISOString().slice(0,10):'',date_basis:prov.date_basis,confidence:prov.confidence};
    if(!Number.isFinite(ts))return {status:'undated',ok:true,dated:false,provisional:false,date_basis:prov.date_basis,confidence:prov.confidence};
    if(Number.isFinite(start)&&ts<start)return {status:'stale',ok:false,dated:true,provisional,date:new Date(ts).toISOString().slice(0,10),date_basis:prov.date_basis,confidence:prov.confidence};
    if(Number.isFinite(end)&&ts>=end+86400000)return {status:'after_window',ok:false,dated:true,provisional,date:new Date(ts).toISOString().slice(0,10),date_basis:prov.date_basis,confidence:prov.confidence};
    return {status:'in_window',ok:true,dated:true,provisional,date:new Date(ts).toISOString().slice(0,10),date_basis:prov.date_basis,confidence:prov.confidence};
  };

const normalizeFacetLabel=value=>text(value).replace(/^\s*(?:(?:facet\s*)?F?\d+\s*[:.)\-–—]\s*|\d+\s*[:.)\-–—]\s*)/i,'').replace(/^[-•]\s*/,'').replace(/\s+/g,' ').trim();

const mechanismFacet=label=>/\b(?:mechanism|failure|worse|harm|conflict|robustness|causal)\b/i.test(normalizeFacetLabel(label));

const researchSourceWithinContract=(source,plan)=>{
    const policy=plan?.contract?.source_restrictions||plan?.source_restrictions||{};if(!domainAllowedByPolicy(source,policy))return {ok:false,reason:'source excluded by user source restriction'};
    const contract=plan?.contract||{},status=researchTemporalSourceStatus(source,contract);if(status.status==='not_filtered')return {ok:true,reason:''};
    if(status.status==='undated')return {ok:true,reason:'date unknown; retain for page-date verification, not as proof of freshness'};
    if(status.status==='stale')return {ok:contract.date_filter_mode!=='hard',reason:'source predates requested window; historical context only unless time scope matches'};
    if(status.status==='after_window')return {ok:false,reason:'published after active date/freshness window'};
    return {ok:true,reason:''};
  };

const relationHints=q=>{const n=norm(q),h=new Set();if(/\b(?:dog|cat|pet|animal)\b/.test(n))['has_pet','owns','pet','breed'].forEach(x=>h.add(x));if(/\b(?:friend|buddy)\b/.test(n))['friend','best_friend','relationship'].forEach(x=>h.add(x));if(/\b(?:live|home|location|residence)\b/.test(n))h.add('lives_in');if(/\b(?:job|work|career|occupation)\b/.test(n))['works_as','occupation','employer','primary_job'].forEach(x=>h.add(x));if(/\b(?:favorite|prefer|like|enjoy)\b/.test(n))['favorite','prefers','likes'].forEach(x=>h.add(x));if(/\b(?:name|called|named)\b/.test(n))h.add('name');if(/\b(?:fear|afraid|scared)\b/.test(n))['fears','afraid_of'].forEach(x=>h.add(x));return [...h];};

const simpleMemoryKey=v=>{const s=text(v).trim().replace(/[.!]+$/,'');let m;if((m=s.match(/^my name is (.+)$/i)))return 'user|name|'+norm(m[1]);if((m=s.match(/^my (best friend|friend|brother|sister|partner|mother|father|roommate) is (.+)$/i)))return 'user|'+predicateKey(m[1])+'|'+norm(m[2]);if((m=s.match(/^my favorite (.+?) is (.+)$/i)))return 'user|favorite_'+predicateKey(m[1])+'|'+norm(m[2]);if((m=s.match(/^i prefer (.+)$/i)))return 'user|prefers|'+norm(m[1]);if((m=s.match(/^i live in (.+)$/i)))return 'user|lives_in|'+norm(m[1]);if((m=s.match(/^i work as (.+)$/i)))return 'user|works_as|'+norm(m[1]);return '';};

const compactResearchJobForStorage=j=>{
    if(j?.engine==='agent_v2'){if(!j.durable_checkpoint)return JSON.parse(JSON.stringify(j));return {id:j.id,schema:j.schema,engine:'agent_v2',research_engine:j.research_engine||'legacy_2_2_1',revision:j.revision,topic:j.topic,status:j.status,state:j.state,started:j.started,updated:j.updated,settings:j.settings,model_state:j.model_state,artifact:j.artifact,synthesis:j.synthesis,sources:[],errors:j.errors,storage_compacted:true};}
    if(!j||typeof j!=='object')return j;
    const compact={
      id:j.id, schema:j.schema, v33:j.v33, revision:j.revision, last_durable_revision:j.last_durable_revision, state:j.state, state_entered_at:j.state_entered_at, run_generation:j.run_generation, topic:j.topic, effective_request:j.effective_request,
      started:j.started, updated:j.updated, status:j.status, stop_reason:j.stop_reason,
      settings:j.settings, model_state:j.model_state,
      literal_request:j.literal_request,research_contract_schema:1,request_object_contract:j.request_object_contract||null,interpretation_trace:j.interpretation_trace||null,extraction_trace:j.extraction_trace||null,recovery_attempts:Number(j.recovery_attempts)||0,recovery_pending:j.recovery_pending||'',final_validation:j.final_validation||null,publication_omissions:j.publication_omissions||[],
      semantic_brief:normalizeSemanticBrief(j.semantic_brief),
      research_understanding:normalizeResearchUnderstanding(j.research_understanding),
      context_search_state:normalizeContextSearchState(j.context_search_state),
      semantic_diagnostics:researchObject(j.semantic_diagnostics),
      literal_query_used:!!j.literal_query_used,
      simple_report_check:j.simple_report_check||null,
      simple_fallback_reason:j.simple_fallback_reason||null,
      benchmark_metrics:j.benchmark_metrics||null,
      telemetry_summary:u130RoleTelemetry(j),
      plan:j.plan?{
        subject:j.plan.subject,task:j.plan.task,contract:j.plan.contract,facets:j.plan.facets,retrieval:j.plan.retrieval,
        report_mode:j.plan.report_mode,report_modes:j.plan.report_modes,source_policy:j.plan.source_policy,freshness:j.plan.freshness,metrics:j.plan.metrics
      }:null,
      queries:researchArray(j.queries).slice(-40),
      rounds:researchArray(j.rounds).map(r=>({
        number:r.number,facet_id:r.facet_id,task:r.task,query:r.task?.query||r.query,kind:r.task?.kind||r.kind,
        provider_query:r.provider_query,provider_status:r.provider_status,provider_error:r.provider_error,retry_count:r.retry_count,started:r.started,finished:r.finished,coverage_delta:r.coverage_delta,new_works:r.new_works,new_useful_works:r.new_useful_works,novel_qualified_claims:r.novel_qualified_claims,review_candidate_gain:r.review_candidate_gain,direct_gain:r.direct_gain,counter_gain:r.counter_gain,critical_cells_resolved:r.critical_cells_resolved,rejected_gain:r.rejected_gain,duplicate_works:r.duplicate_works,marginal_evidence_value:r.marginal_evidence_value,productive_gain:!!r.productive_gain,novel_material:!!r.novel_material,new_facets_supported:r.new_facets_supported,semantic_role_counts:r.semantic_role_counts||null,grounded:r.grounded,qualified:r.qualified,accepted:r.accepted,discovered:r.discovered,selected:r.selected
      })).slice(-40),
      readiness:j.readiness||null,
      gaps:researchArray(j.gaps).slice(0,24),
      synthesis:j.synthesis||null,
      artifact:j.artifact||null,
      txt_saved:!!j.txt_saved,
      errors:researchArray(j.errors).slice(-12),
      storage_compacted:true
    };
    return compact;
  };

const boundedResearchJobForLocal=j=>{if(j?.engine==='agent_v2')return JSON.parse(JSON.stringify(j));if(!j||typeof j!=='object')return j;try{const size=JSON.stringify(j).length;if(size<=650000)return j;}catch{}return {...compactResearchJobForStorage(j),local_recovery_limited:true,local_recovery_note:'Full research state exceeded safe localStorage size; continue in memory and rely on IndexedDB for full resume.'};};

const compactDocumentForStorage=d=>{if(!d||typeof d!=='object')return d;if(d.durable!==true)return JSON.parse(JSON.stringify(d));return {id:d.id,name:d.name,updated:d.updated,created:d.created,generated:!!d.generated,status:d.status,origin:d.origin||((d.generated)?'generated':'user'),size:text(d.content||'').length,durable:true,revisions_count:Array.isArray(d.revisions)?d.revisions.length:0};};

const v33Clone = value => JSON.parse(JSON.stringify(value));

const v33Stable = value => JSON.stringify(value, function(k,v) {
    return v && typeof v==='object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((o,key)=>(o[key]=v[key],o),{}) : v;
  });

function v33Wait(ms,signal) {return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(Object.assign(Error('Cancelled'),{error_class:'cancelled'}));
    const abort=()=>{clearTimeout(timer);reject(Object.assign(Error('Cancelled'),{error_class:'cancelled'}));};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
    signal?.addEventListener('abort',abort,{once:true});
  });}

function u124LogicalSourceKey(source){
  const work=text(source?.work_id||'').trim(),special=work.match(/^(?:doi|openalex|arxiv|academic-title):/i);if(special)return work.toLowerCase();const canonical=canonicalCandidateURL(/^url:/i.test(work)?'https://'+work.slice(4):text(source?.url||'').trim());if(canonical)return 'web:'+canonical.replace(/^https?:\/\//i,'').toLowerCase();return work?work.toLowerCase():'title:'+norm(source?.title||'')+'|'+text(source?.published||source?.year||'').slice(0,4);
}

function effectiveReportClaimIds(j){const report=researchArray(j?.report_claim_ids).map(text).filter(Boolean);if(report.length)return report;const synthesis=researchArray(j?.synthesis_claim_ids).map(text).filter(Boolean);if(synthesis.length)return synthesis;const qualified=new Set(researchArray(j?.support_records).filter(x=>x.status==='qualified').map(x=>x.claim_id));const fallback=researchArray(j?.claims).filter(c=>qualified.has(c.id)).map(c=>c.id);return fallback.length?fallback:researchArray(j?.claims).map(c=>c.id).filter(Boolean);}

const u130WorkerPredictBudget=(lane,maxTokens,thinking)=>{if(!thinking)return maxTokens;if(/contract_supplements/i.test(lane))return Math.max(maxTokens,4800);if(/facet_query/i.test(lane))return Math.max(maxTokens,3000);return Math.max(maxTokens,3600);};

const u130RoleTelemetry=j=>{const prior=researchObject(j?.telemetry_summary),seed=role=>{const r=researchObject(prior?.[role]);return {context_peak_ratio:Math.max(0,Number(r.context_peak_ratio)||0),thinking_attempts:Math.max(0,Number(r.thinking_attempts)||0),thinking_completed:Math.max(0,Number(r.thinking_completed)||0),thinking_truncated:Math.max(0,Number(r.thinking_truncated)||0),finalized_without_thinking:Math.max(0,Number(r.finalized_without_thinking)||0)};},roles={worker:seed('worker'),reporter:seed('reporter')};for(const m of researchArray(j?.stage_runs)){if(!m||m.cache_hit)continue;const role=(m.model===j?.settings?.report_model||/simple_|global_analysis|synthesis|section_|editor|adversarial|sufficiency|relation_verify/.test(text(m.stage)))?'reporter':'worker',r=roles[role];r.context_peak_ratio=Math.max(r.context_peak_ratio,Number(m.context_peak_ratio)||0,...researchArray(m.context_usage).map(u=>Number(u.total_ratio)||Number(u.prompt_ratio)||0));if(m.thinking_attempted)r.thinking_attempts++;if(m.thinking_completed)r.thinking_completed++;if(m.thinking_truncated)r.thinking_truncated++;if(m.finalized_without_thinking)r.finalized_without_thinking++;}return roles;};

function u11StageGroup(stage,think){if(/simple_analysis/.test(stage))return 'simple_analysis';if(/simple_write|emergency_report|u140_anchor_recovery/.test(stage))return 'simple_writing';if(/simple_repair/.test(stage))return 'simple_repair';if(/facet_query|contract_supplements/.test(stage))return 'worker_query';if(/enrich/.test(stage))return 'enrichment';if(/sentence_id_select|extract/.test(stage))return 'worker_evidence';if(/evidence_critic/.test(stage))return 'evidence_critic';if(/facet_synthesis/.test(stage))return 'facet_synthesis';if(/synthesis_batch/.test(stage))return think==='off'?'easy_synthesis':'complex_synthesis';if(/sufficiency_audit|relation_verify/.test(stage))return 'sufficiency_audit';if(/global_analysis/.test(stage))return 'global_analysis';if(/thesis_formatter/.test(stage))return 'thesis_formatter';if(/blueprint/.test(stage))return 'blueprint';if(/sentence_support/.test(stage))return 'verification';if(/repair|sentence_narrow/.test(stage))return 'repair';if(/global_editor|adversarial/.test(stage))return 'global_editing';if(stage==='editor')return 'batch_editing';if(/section_/.test(stage))return 'writing';return 'worker_evidence';}

function u11Performance(j){const groups={},models={},roles={worker:{calls:0,elapsed_ms:0,prompt_tokens:0,output_tokens:0,thinking_calls:0,finalize_calls:0,length_failures:0,thinking_attempts:0,thinking_completed:0,thinking_truncated:0,finalized_without_thinking:0,context_peak_ratio:0},reporter:{calls:0,elapsed_ms:0,prompt_tokens:0,output_tokens:0,thinking_calls:0,finalize_calls:0,length_failures:0,thinking_attempts:0,thinking_completed:0,thinking_truncated:0,finalized_without_thinking:0,context_peak_ratio:0}};let cache_hits=0;for(const m of researchArray(j.stage_runs)){if(m.cache_hit){cache_hits++;continue;}const key=m.group||u11StageGroup(m.stage,m.settings?.think),g=groups[key]??={calls:0,retries:0,elapsed_ms:0,load_ms:0,prompt_tokens:0,output_tokens:0,prompt_ms:0,output_ms:0};g.calls++;g.retries+=m.retries||0;g.elapsed_ms+=m.elapsed_ms||0;for(const a of m.attempt_metrics||[m.metrics||{}])for(const k of ['load_ms','prompt_tokens','output_tokens','prompt_ms','output_ms'])g[k]+=Number(a[k])||0;models[m.model||'unknown']=(models[m.model||'unknown']||0)+(m.elapsed_ms||0);const role=(m.model===j.settings?.report_model||/simple_|global_analysis|synthesis|section_|editor|adversarial|sufficiency|relation_verify/.test(m.stage))?'reporter':'worker',rr=roles[role];rr.calls++;rr.elapsed_ms+=m.elapsed_ms||0;for(const a of m.attempt_metrics||[m.metrics||{}]){rr.prompt_tokens+=Number(a.prompt_tokens)||0;rr.output_tokens+=Number(a.output_tokens)||0;if(Number(a.thinking_chars)>0)rr.thinking_calls++;if(a.done_reason==='length')rr.length_failures++;}if(m.thinking_attempted)rr.thinking_attempts++;if(m.thinking_completed)rr.thinking_completed++;if(m.thinking_truncated)rr.thinking_truncated++;if(m.finalized_without_thinking)rr.finalized_without_thinking++;rr.context_peak_ratio=Math.max(rr.context_peak_ratio,Number(m.context_peak_ratio)||0,...researchArray(m.context_usage).map(u=>Number(u.total_ratio)||Number(u.prompt_ratio)||0));rr.finalize_calls+=Math.max(0,(m.attempt_metrics?.length||1)-1);}for(const g of Object.values(groups)){g.prompt_tokens_per_second=g.prompt_ms?g.prompt_tokens*1000/g.prompt_ms:null;g.output_tokens_per_second=g.output_ms?g.output_tokens*1000/g.output_ms:null;}const persistedTelemetry=u130RoleTelemetry(j);for(const role of ['worker','reporter'])for(const key of ['context_peak_ratio','thinking_attempts','thinking_completed','thinking_truncated','finalized_without_thinking'])roles[role][key]=persistedTelemetry[role][key];return {...researchObject(j.performance_summary),intent:j.intent_diagnostics?{deterministic_task_shapes:j.intent_diagnostics.deterministic.task_shapes,advisory_task_shapes:j.intent_diagnostics.advisory.semantic_task_shapes,reconciled_task_shapes:j.intent_profile?.task_shapes,semantic_confidence:j.intent_diagnostics.advisory.confidence,disagreement_count:j.intent_diagnostics.disagreements.length}:null,packets:j.packet_diagnostics||[],sufficiency:j.sufficiency_diagnostics||[],blueprint:j.blueprint_diagnostics||null,compiler_rescue_count:j.compiler_rescue_used?1:0,compiler_rescue:j.compiler_rescue||null,adversarial_trigger:j.adversarial_trigger||null,benchmark_metrics:j.benchmark_metrics||u113BenchmarkMetrics(j),packet_resilience:j.packet_resilience||[],model_calls:Object.values(groups).reduce((n,g)=>n+g.calls+g.retries,0),groups:{...groups,storage:{calls:researchArray(j.storage_events).length,elapsed_ms:researchArray(j.storage_events).reduce((n,e)=>n+e.elapsed_ms,0)}},deterministic_cache_hits:j.deterministic_cache_hits||0,model_elapsed_ms_by_model:models,model_roles:roles,report_pipeline:j.report_pipeline||'legacy_1_1_9',cache_hits,network_events:j.network_events||[],collection_stop:{stop_reason:j.stop_reason||'',marginal_saturated:!!j.marginal_saturated,readiness:j.readiness||null,remaining_round_budget:Math.max(0,(Number(j.settings?.max_rounds)||0)-researchArray(j.rounds).length),last_rounds:researchArray(j.rounds).slice(-5).map(r=>({round:r.number,strategy:r.task?.strategy||'',provider_status:r.provider_status,value:r.marginal_evidence_value,productive:!!r.productive_gain,qualified:r.novel_qualified_claims,review_candidates:r.review_candidate_gain,direct:r.direct_gain,counter:r.counter_gain,new_works:r.new_works,new_locked_requirement_evidence:r.new_locked_requirement_evidence,rejected:r.rejected_gain}))},round_values:j.rounds.map(r=>({round:r.number,novel_works:r.new_works,grounded:r.grounded,qualified:r.novel_qualified_claims,review_candidates:r.review_candidate_gain,direct:r.direct_gain,counter:r.counter_gain,duplicates:r.duplicate_works,value:r.marginal_evidence_value,productive:!!r.productive_gain})),report:{synthesis_calls:researchArray(j.stage_runs).filter(m=>/synthesis/.test(m.stage)&&!m.cache_hit).length,batch_complexity_classes:researchArray(j.stage_runs).filter(m=>/synthesis_batch/.test(m.stage)&&!m.cache_hit).map(m=>m.settings?.think==='off'?'easy':'complex'),raw_anchors_supplied:j.compiler_context_manifest?.raw_ids.length||0,writer_calls:groups.writing?.calls||0,verifier_calls:groups.verification?.calls||0,repair_calls:groups.repair?.calls||0,editor_calls:(groups.batch_editing?.calls||0)+(groups.global_editing?.calls||0),final_coverage:j.coverage_matrix||[],synthesis_batches:j.synthesis_batches?.length||0,context_expansions:j.compiler_context_expansion?.length||0,sections:j.sections?.length||0,words:researchArray(j.sections).reduce((n,s)=>n+(s.word_count||0),0),actually_used_claims:j.used_evidence_ledger?.claims.length||0,assigned_unused:j.used_evidence_ledger?.assigned_but_unused.length||0,completion:j.synthesis?.completion,quality_state:j.synthesis?.quality_state||'',synthesis_status:j.synthesis?.synthesis_status||'',fallback_level:j.synthesis?.fallback_level||j.simple_fallback_level||'none'}};}

const LIGHTYEAR_PROVIDER_LIMITS={anysearch_search:{max_results:10},anysearch_extract:{max_urls:1,concurrency:4,timeout_ms:45000},openalex:{per_page_max:100,semantic_per_page_max:50,semantic_query_max_chars:2000}};

const ANYSEARCH_SEARCH_ENDPOINT='https://api.anysearch.com/v1/search';

const ANYSEARCH_EXTRACT_ENDPOINT='https://api.anysearch.com/v1/extract';

const TAVILY_SEARCH_ENDPOINT='https://api.tavily.com/search';

const TAVILY_API_KEY_STORAGE='RAMO_TAVILY_API_KEY_V1';

const clampInt=(v,min,max,fallback)=>Math.max(min,Math.min(max,Number.isFinite(Number(v))?Math.trunc(Number(v)):fallback));

const redactProviderMessage=v=>text(v).replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/ig,'Bearer [redacted]').replace(/\bas_sk_[A-Za-z0-9_-]+\b/g,'[redacted]').replace(/\b(api[_-]?key|password|username)\s*=\s*[^\s\r\n]+/ig,'$1=[redacted]');

const anySearchCredential=host=>{
    const scratch=text(host?.variable?.('AnySearch API Key')||'').trim();if(scratch)return {key:scratch,source:'scratch_variable'};
    let stored='';try{stored=text(host&&typeof host._storageGet==='function'?host._storageGet(ANYSEARCH_API_KEY_STORAGE):(typeof localStorage!=='undefined'?localStorage.getItem(ANYSEARCH_API_KEY_STORAGE):'')||'').trim();}catch(_){}
    return stored?{key:stored,source:'local_storage'}:{key:'',source:'anonymous'};
  };

const anySearchRelay=host=>{const configured=text(host?.variable?.('AnySearch Relay URL')||'').trim();if(!configured||/^direct$/i.test(configured))return '';return configured.replace(/\/+$/,'');};

const tavilyCredential=host=>{const scratch=text(host?.variable?.('Tavily API Key')||'').trim();if(scratch)return {key:scratch,source:'settings'};let stored='';try{stored=text(host&&typeof host._storageGet==='function'?host._storageGet(TAVILY_API_KEY_STORAGE):(typeof localStorage!=='undefined'?localStorage.getItem(TAVILY_API_KEY_STORAGE):'')||'').trim();}catch{}return stored?{key:stored,source:'local_storage'}:{key:'',source:'not_configured'};};

const tavilySearchRequest=async(transport,host,query,options,signal)=>{const credential=tavilyCredential(host);if(!credential.key)throw Object.assign(Error('No Tavily API key is configured.'),{code:'TAVILY_KEY_REQUIRED'});const body={query:anySearchConstrainedQuery(query,options),max_results:clampInt(options.max_results,1,10,10),search_depth:'advanced',include_answer:false,include_raw_content:false};const result=await transport.get(TAVILY_SEARCH_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+credential.key},body:JSON.stringify(body)},signal,30000);return {code:0,data:{results:researchArray(result?.results).map(row=>({title:row?.title,url:row?.url,snippet:row?.content,content:row?.content,score:row?.score,published_date:row?.published_date}))},_provider:'tavily',_provider_query:body.query,_transport_mode:'direct'};};

const anySearchRequest=async(transport,host,operation,body,signal,timeout)=>{const credential=anySearchCredential(host),relay=anySearchRelay(host),viaRelay=!!relay,isCloudflareRelay=viaRelay&&/\.workers\.dev(?::|\/|$)/i.test(relay),transportMode=viaRelay?(isCloudflareRelay?'cloudflare_relay':'relay'):'direct',url=viaRelay?relay+(operation==='extract'?'/extract':'/search'):(operation==='extract'?ANYSEARCH_EXTRACT_ENDPOINT:ANYSEARCH_SEARCH_ENDPOINT),headers={'Content-Type':'application/json'};if(credential.key)headers[viaRelay?'X-AnySearch-Key':'Authorization']=viaRelay?credential.key:'Bearer '+credential.key;try{const result=await transport.get(url,{method:'POST',headers,body:JSON.stringify(body)},signal,timeout);return {result,transport_mode:transportMode};}catch(e){if(e&&typeof e==='object'){e.transport_mode=transportMode;e.transport_endpoint=operation==='extract'?'extract':'search';if(viaRelay&&e.error_class==='network'){e.code='ANYSEARCH_RELAY_UNAVAILABLE';e.message='AnySearch relay unavailable: '+redactProviderMessage(e.message||'Failed to fetch');}}throw e;}};

const providerFailureDetails=e=>({failure_kind:text(e?.failure_kind),provider:text(e?.provider||'anysearch'),operation:text(e?.provider_operation||e?.operation),http_status:Number.isFinite(Number(e?.http_status))?Number(e.http_status):null,code:e?.code??'',message:redactProviderMessage(e?.message).slice(0,1200),request_id:text(e?.request_id).slice(0,180),retry_after:text(e?.retry_after).slice(0,180),retry_after_ms:Number(e?.retry_after_ms)||0,error_class:text(e?.error_class),transport_mode:text(e?.transport_mode)});

const markAnySearchFailure=(e,operation='search')=>{const err=e instanceof Error?e:Error(redactProviderMessage(e)||'AnySearch request failed');err.provider='anysearch';err.provider_operation=operation;err.failure_kind=operation==='search'?'SEARCH_PROVIDER_FAILED':'FETCH_PROVIDER_FAILED';err.message=redactProviderMessage(err.message)||('AnySearch '+operation+' failed');if(!err.error_class&&/failed to fetch|fetch failed|networkerror|load failed|network request failed/i.test(err.message))err.error_class='network';if(err.code===undefined||err.code===null||err.code==='')err.code=err.error_class==='network'?'ANYSEARCH_TRANSPORT_FAILED':'ANYSEARCH_'+operation.toUpperCase()+'_FAILED';return err;};

const anySearchResponseError=(result,operation='search')=>{const message=redactProviderMessage(result?.message)||('AnySearch '+operation+' failed'),err=Error(message);Object.assign(err,{http_status:200,code:result?.error_code??result?.data?.error_code??result?.code??'ANYSEARCH_PROVIDER_ERROR',message,request_id:text(result?.request_id),retry_after:'',retry_after_ms:0,error_class:'provider'});return markAnySearchFailure(err,operation);};

const anySearchConstrainedQuery=(query,options={})=>{
    let q=text(query).replace(/\s+/g,' ').trim(),p=options?.source_restrictions||{},allowed=researchDomainList(p.allowed_domains).slice(0,4),start=text(options.date_start),end=text(options.date_end);
    if(allowed.length){const sites=allowed.map(d=>'site:'+d);q+=' '+(sites.length===1?sites[0]:'('+sites.join(' OR ')+')');}
    if(text(options.date_filter_mode)==='hard'&&(start||end)){if(start&&end)q+=' published between '+start+' and '+end;else if(start)q+=' published on or after '+start;else q+=' published on or before '+end;}
    else if(options.temporal_news&&!freshQuery(q))q+=' recent news';
    return q.slice(0,500).trim();
  };

const buildAnySearchSearchRequest=(query,options={})=>{const provider_query=anySearchConstrainedQuery(query,options),body={query:provider_query,max_results:clampInt(options.max_results,1,LIGHTYEAR_PROVIDER_LIMITS.anysearch_search.max_results,10),format:options.format==='json'?'json':'markdown'};if(options.tag)body.tag=text(options.tag);if(options.zone)body.zone=text(options.zone);if(options.language)body.language=text(options.language);if(options.params&&typeof options.params==='object'&&!Array.isArray(options.params))body.params=options.params;return {body,provider_query};};

const buildAnySearchExtractRequest=url=>{const valid=validURL(url);if(!valid)throw Object.assign(Error('No valid URL for AnySearch Extract'),{error_class:'invalid_request'});return {url:valid};};

const buildOpenAlexSearchURL=(query,options={})=>{const semantic=!!options.semantic,key=semantic?'search.semantic':'search',limit=clampInt(options.per_page,1,semantic?LIGHTYEAR_PROVIDER_LIMITS.openalex.semantic_per_page_max:LIGHTYEAR_PROVIDER_LIMITS.openalex.per_page_max,semantic?30:20),safe=text(query).slice(0,semantic?LIGHTYEAR_PROVIDER_LIMITS.openalex.semantic_query_max_chars:500),filters=[];if(/^20\d{2}-\d{2}-\d{2}$/.test(text(options.date_start)))filters.push('from_publication_date:'+text(options.date_start));if(/^20\d{2}-\d{2}-\d{2}$/.test(text(options.date_end)))filters.push('to_publication_date:'+text(options.date_end));let url='https://api.openalex.org/works?'+key+'='+encodeURIComponent(safe);if(filters.length)url+='&filter='+encodeURIComponent(filters.join(','));return url+'&per_page='+limit;};

function chatAttachmentImages(attachment){
    if(attachment?.kind==='images'&&(!Array.isArray(attachment.images)||!attachment.images.length))throw Error('The image attachment is empty or malformed. Remove it and attach the image again.');
    if(attachment?.images!==undefined&&!Array.isArray(attachment.images))throw Error('Invalid image attachment list. Remove it and attach the image again.');
    return researchArray(attachment?.images).map(image=>{
      const source=typeof image==='string'?image:text(image?.data),match=/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(source);
      const data=(match?match[2]:source).replace(/\s/g,'');
      if(!data||!/^[A-Za-z0-9+/]+={0,2}$/.test(data)||data.length%4===1)throw Error('Invalid image data. Remove the image and attach it again.');
      const detected=data.startsWith('/9j/')?'image/jpeg':data.startsWith('R0lGOD')?'image/gif':data.startsWith('UklGR')?'image/webp':'image/png';
      const mimeType=match?.[1]||text(image?.mimeType)||detected;
      if(!/^image\/(?:png|jpeg|jpg|webp|gif)$/i.test(mimeType))throw Error('Unsupported image type. Attach a PNG, JPEG or WebP image.');
      return {data,mimeType:mimeType.toLowerCase().replace('image/jpg','image/jpeg'),name:text(image?.name||attachment?.name||'Image')};
    });
  }

const isChatImageAttachment=attachment=>attachment?.kind==='images'||researchArray(attachment?.images).length>0;

const localImagesOnlyMessage='Image attachments stay local. Choose Fast, Smart or Super Smart.';

const chatMessagesHaveImages=messages=>researchArray(messages).some(message=>researchArray(message?.images).length>0||researchArray(message?.content).some(part=>['image_url','input_image','image'].includes(part?.type)));

const MEMORY_SCHEMA={
    type:'object',additionalProperties:false,
    properties:{facts:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,properties:{
      statement:{type:'string'},evidence_quote:{type:'string'},subject:{type:'string'},predicate:{type:'string'},object:{type:'string'},
      kind:{type:'string',enum:['identity','preference','relationship','project','goal','event','skill','location','ownership','fact']},
      operation:{type:'string',enum:['add','replace','negate']},fact_type:{type:'string',enum:['world','experience']},
      certainty:{type:'string',enum:['explicit','likely','uncertain']},why:{type:'string'},
      keywords:{type:'array',maxItems:10,items:{type:'string'}},
      entities:{type:'array',maxItems:10,items:{type:'object',additionalProperties:false,properties:{name:{type:'string'},type:{type:'string',enum:['person','pet','organization','place','project','product','concept','other']}},required:['name','type']}},
      occurred_start:{type:'string'},occurred_end:{type:'string'},caused_by:{type:'array',maxItems:3,items:{type:'integer'}}
    },required:['statement','evidence_quote','subject','predicate','object','kind','operation','fact_type','certainty','why','keywords','entities','occurred_start','occurred_end','caused_by']}}},
    required:['facts']
  };

const MEMORY_SYSTEM=`You are the local assistant's long-term memory extractor. Extract NEW durable facts from CURRENT_USER only.
CONTEXT exists to resolve names, pronouns, implied subjects, and continuing topics. Use it when CURRENT_USER says things like "she", "he", "it", "that project", or otherwise omits a name. Never re-extract an old context fact unless CURRENT_USER adds new information about it.
Be generous with useful context: remember identity, relationships, preferences, possessions, skills, goals, project decisions, stable constraints, meaningful events, corrections, recurring interests, and useful personal/project details. Skip greetings, pure requests with no new fact, and disposable process chatter.
Each statement must be concise, third-person, and useful later. evidence_quote MUST come from CURRENT_USER and directly support the NEW information, but the resolved subject/name may come from CONTEXT.
Use short snake_case predicates that can be reused. Use subject="user" for the human unless another entity is the subject.
operation="replace" only for an explicit correction or changed single-valued state; "negate" when the user says a previous fact is no longer true; otherwise "add". A sentence can contain both a negated old state and a new positive state.
fact_type="experience" for a dated event, otherwise "world". Resolve relative dates from EVENT_DATE when possible. Empty occurred_start/end means timeless/current state.
keywords should include useful alternate retrieval terms and category words, not filler.
caused_by contains zero-based indices of earlier facts in THIS output only when the causal link is explicit.
certainty="uncertain" when the user expresses doubt. Preserve uncertain information as uncertain instead of silently converting it to certainty or dropping it.
Return {"facts":[]} only when nothing is useful enough to remember.`;

const OBSERVATION_SCHEMA={
    type:'object',additionalProperties:false,
    properties:{observations:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,properties:{
      statement:{type:'string'},source_memory_ids:{type:'array',minItems:2,maxItems:8,items:{type:'string'}},entities:{type:'array',maxItems:8,items:{type:'string'}},confidence:{type:'number'}
    },required:['statement','source_memory_ids','entities','confidence']}}},
    required:['observations']
  };

const OBSERVATION_SYSTEM=`Form only stable, useful observations supported by at least two supplied memories.
An observation is a pattern or higher-level understanding, not a restatement of one fact.
Never invent evidence. source_memory_ids MUST be copied from the supplied IDs. Prefer no observation over a weak one.
Do not infer sensitive traits. Keep the statement concise and revisable. Return {"observations":[]} when evidence is insufficient.`;

const exportRequest=input=>{
    const raw=requestText(input),output_format=outputFormatRequest(raw);
    const topic=stripResearchOutput(raw),r=researchRequest(raw);
    return {topic,output_format,task:r.matched?(r.task||'research'):'answer',subject:r.topic||'',freshness:freshQuery(topic)?'current':'unspecified'};
  };

const researchTerms=q=>contentTerms(q).filter(t=>!new Set('most used use usage rate rates report analysis create make generate write give file txt text game agents agent popularity popular ranked player players testing evaluating effect effects'.split(' ')).has(t));

const researchMetricKey=value=>{
    const n=norm(value);
    if(!n||n==='none')return 'none';
    if(/\b(?:pick|picked|usage|use|used|played|selection|selected|popularity|popular)\b/.test(n))return 'pick_rate';
    if(/\bwin\b/.test(n))return 'win_rate';
    if(/\b(?:price|cost|pricing)\b/.test(n))return 'price';
    if(/\b(?:version|release)\b/.test(n))return 'version';
    if(/\b(?:benchmark|performance|latency|throughput|speed)\b/.test(n))return 'performance';
    if(/\b(?:rating|score)\b/.test(n))return 'rating';
    if(/\b(?:count|number|total)\b/.test(n))return 'count';
    if(/\b(?:percent|percentage)\b/.test(n))return 'percentage';
    if(/\bdate\b/.test(n))return 'date';
    return 'other';
  };

const sourceDomain=s=>{try{return new URL(text(s?.url)).hostname.replace(/^www\./,'').toLowerCase();}catch(_){return '';}};

const sourceTypeInfo=source=>{
    const domain=sourceDomain(source),hay=(text(source?.title)+' '+text(source?.text).slice(0,2600)).toLowerCase();
    if(source?.official)return 'official';
    // Social/search-community pages are useful discovery or opinion sources, but should not
    // silently receive the same authority as a first-party release note. Official API-marked
    // sources still bypass this downgrade through source.official above.
    if(/(?:reddit\.com|youtube\.com|youtu\.be|medium\.com|facebook\.com|instagram\.com|tiktok\.com|threads\.net|x\.com|twitter\.com)$/.test(domain)||/(?:^|\.)reddit\.com$/.test(domain)||u154CommunityHost(source,domain))return 'community';
    if(/\bcurated editorial baseline\b|\bopinion\b|\bcommunity evaluation\b/.test(hay))return 'editorial';
    if(/\b(?:updated daily|refreshed every patch|last 7 days|tracked competitive matches|live stats|real ranked matches)\b/.test(hay)&&/\b(?:win rate|pick rate|statistics|stats)\b/.test(hay))return 'live_data';
    if(/\|\s*(?:win(?:\s+rate| %)|pick(?:\s+rate| %)|rank)\s*\|/i.test(text(source?.text))||/\b(?:win rate|pick rate)\b/.test(hay)&&/\b(?:matches|sample|data)\b/.test(hay))return 'data_table';
    if(/\b(?:tier list|guide|blog|best .* to play)\b/.test(hay))return 'editorial';
    return 'unknown';
  };

const researchEvidenceClass=source=>{const ap=source?.authority_profile||u150AuthorityProfile(source,{});if(Number(ap.confidence)>=.75&&['first_party','probable_product_first_party','institutional_primary'].includes(text(ap.relationship)))return 'official_primary';
    const title=text(source?.title),domain=sourceDomain(source),url=text(source?.url),type=norm(source?.type),journal=text(source?.journal),review=/\b(?:systematic review|meta[- ]analysis|review of|scoping review|literature review|survey(?: of| on)?|comprehensive survey)\b/i.test(title)||/review|meta-analysis/.test(type),commentary=/editorial|letter|commentary|correction|erratum|retraction|peer-review/.test(type),dataset=/dataset|data set/.test(type);
    // Prefer work metadata over publisher identity. A journal/publisher domain can host reviews,
    // editorials, corrections and other non-primary material as well as original studies.
    if(/(?:^|\.)arxiv\.org$/.test(domain)||/\barxiv\.org\b/i.test(url))return review?'academic_review':commentary?'academic_commentary':'preprint_primary';
    if(source?.kind==='science'){
      if(commentary)return 'academic_commentary';
      if(review)return journal?'peer_reviewed_review':'academic_review';
      if(dataset)return 'academic_data';
      if(journal&&/article|journal-article|proceedings-article|report|book-chapter/.test(type||'article'))return 'peer_reviewed_primary';
      if(source?.doi)return 'academic_published';
      return 'academic_discovery';
    }
    if(source?.official)return 'official_primary';
    const t=text(source?.source_type||sourceTypeInfo(source));
    if(['live_data','data_table'].includes(t))return 'structured_web_data';
    if(t==='editorial'||t==='community')return 'secondary_web';
    const academicHost=/(?:^|\.)(?:aclanthology\.org|proceedings\.neurips\.cc|openreview\.net|dl\.acm\.org|ieeexplore\.ieee\.org|nature\.com|springer\.com|link\.springer\.com|sciencedirect\.com|academic\.oup\.com|journals\.plos\.org|jamanetwork\.com|bmj\.com|frontiersin\.org)$/.test(domain)||/(?:^|\.)doi\.org$/.test(domain)||!!source?.doi;
    if(academicHost)return review?'peer_reviewed_review':commentary?'academic_commentary':'academic_published';
    return 'verified_web';
  };

const evidenceClassWeight=cls=>({peer_reviewed_primary:.30,peer_reviewed_review:.24,academic_primary:.22,academic_published:.18,academic_data:.20,preprint_primary:.17,official_primary:.26,structured_web_data:.18,verified_web:.08,academic_review:.12,academic_commentary:.02,academic_discovery:.06,secondary_web:-.02}[text(cls)]||0);

const evidenceTier=cls=>({peer_reviewed_primary:'A',academic_primary:'A',official_primary:'A',academic_data:'B',peer_reviewed_review:'B',academic_published:'B',preprint_primary:'B',structured_web_data:'B',academic_review:'C',academic_commentary:'D',academic_discovery:'D',verified_web:'E',secondary_web:'F'}[text(cls)]||'E');

const evidenceTierValue=t=>({A:1,B:.84,C:.68,D:.52,E:.34,F:.16,G:.05}[text(t)]||.25);

const strongPrimaryClass=cls=>['peer_reviewed_primary','academic_primary','official_primary','preprint_primary','academic_data'].includes(text(cls));

const weakCoreEvidenceClass=cls=>['verified_web','secondary_web','academic_discovery','academic_commentary'].includes(text(cls));

const researchSourceQualityProfile=(source,plan=null,facet=null)=>{
    const cls=source?.evidence_class||researchEvidenceClass(source),tier=evidenceTier(cls),authority=Math.max(0,Math.min(1,sourceAuthority(source,plan)+.18)),extract=source?.evidence_level==='fulltext_supported'||source?.extraction_status==='verified_extract'?1:source?.evidence_level==='abstract_supported'?.72:source?.evidence_level==='verified_page'?.7:.35,direct=researchEvidenceRole(source,plan,facet),directness=direct==='DIRECT_POPULATION'?1:direct==='DIRECT_GENERAL'?.78:direct==='COUNTEREVIDENCE'?.78:direct==='INDIRECT_MECHANISM'?.62:direct==='REVIEW_SYNTHESIS'?.55:.4;
    const score=Math.max(0,Math.min(1,evidenceTierValue(tier)*.42+authority*.22+extract*.18+directness*.18));
    return {tier,score:Number(score.toFixed(3)),evidence_class:cls,primary:strongPrimaryClass(cls),weak_for_core:weakCoreEvidenceClass(cls),directness_role:direct,extractability:extract};
  };

const facetAliases=facet=>[...new Set([text(facet?.label||facet?.question||''),...researchArray(facet?.aliases).map(text)].filter(Boolean))].slice(0,14);

const facetLexicalScore=(facet,hay)=>{const phrases=facetAliases(facet);if(!phrases.length)return 0;return Math.max(0,...phrases.map(p=>{const terms=contentTerms(p);return terms.length?terms.filter(t=>researchTermPresent(hay,t)).length/terms.length:0;}));};

const researchQualityReady=status=>['strong','acceptable','verified','verified_with_gaps'].includes(text(status));

const likelyFirstPartySource=(s,plan)=>firstPartySourceConfidence(s,plan)>=.75;

function firstPartySourceConfidence(source,plan){const p=source?.authority_profile||u150AuthorityProfile(source,plan||{});return Number(p.confidence)||0;}

const sourceAuthority=(s,plan)=>{
    let score=0;const host=sourceDomain(s),type=text(s?.source_type||sourceTypeInfo(s)),fresh=text(s?.freshness_status),firstParty=likelyFirstPartySource(s,plan);
    if(s.official||type==='official')score+=.35;
    else if(firstParty)score+=.24;
    if(/\.(?:gov|edu)(?:\.|$)/.test(host))score+=.18;
    if(s.kind==='science'&&plan?.retrieval?.academic)score+=.15;
    score+=evidenceClassWeight(s.evidence_class||researchEvidenceClass(s));
    if(type==='live_data')score+=.16;
    else if(type==='data_table')score+=.10;
    else if(type==='editorial')score-=.04;
    else if(type==='community')score-=.14;
    if(s.extraction_status==='verified_extract')score+=.06;
    else if(s.kind==='web'&&s.extraction_status==='extract_failed')score-=.08;
    if(fresh==='fresh')score+=.08;
    else if(fresh==='unknown'&&plan?.freshness==='current')score-=.08;
    if(/wikipedia\.org$/.test(host))score+=.04;
    if(/(?:fandom\.com|tvtropes\.org)$/.test(host))score-=.06;
    return score;
  };

const researchTermPresent=(set,term)=>{
    if(set.has(term))return true;
    if(term.length>4&&term.endsWith('s')&&set.has(term.slice(0,-1)))return true;
    if(term.length>3&&!term.endsWith('s')&&set.has(term+'s'))return true;
    return false;
  };

const researchEvidenceRole=(source,plan,facet)=>{
    const cls=source.evidence_class||researchEvidenceClass(source),hay=new Set(contentTerms(text(source.title)+' '+text(source.text))),population=contentTerms(plan?.contract?.population||''),populationHit=population.length?population.filter(t=>researchTermPresent(hay,t)).length/Math.max(1,population.length):0,mode=facetModeForPlan(facet,plan);
    if(mode==='OPINION_RECEPTION'&&(/reddit|forum|steamcommunity|youtube|tiktok|twitter|x\.com/i.test(text(source.url))||text(source.source_type)==='community'))return 'DIRECT_OPINION';
    if(mode==='CATALOG_LIST'&&(source.official||['official_primary','structured_web_data'].includes(cls)))return 'DIRECT_CANONICAL';
    if(/review/.test(cls)&&mode==='ACADEMIC_SCIENTIFIC')return 'REVIEW_SYNTHESIS';
    if(population.length&&populationHit>=.45)return 'DIRECT_POPULATION';
    if(['ACADEMIC_SCIENTIFIC','TECHNICAL_ENGINEERING'].includes(mode)&&mechanismFacet(facet?.label||facet?.question||''))return 'INDIRECT_MECHANISM';
    return ['peer_reviewed_primary','academic_primary','academic_published','academic_data','preprint_primary','official_primary','structured_web_data'].includes(cls)?'DIRECT_GENERAL':'SUPPORTING_CONTEXT';
  };

const localCalendarDate=value=>{const d=value==null?new Date():new Date(value);if(!Number.isFinite(d.getTime()))return '';return String(d.getFullYear()).padStart(4,'0')+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};

const researchNow=()=>new Date().toISOString();

const claimViolatesExclusions=(j,c)=>{const ex=j.plan?.contract?.exclusions||[];if(!ex.length)return false;const src=(j.sources||[]).find(x=>x.id===c.source_id)||{},blob=[c.claim,c.subject,c.predicate,c.metric_name,c.metric,c.population_or_model,c.study_design,c.publication_status,c.scope?.population,c.scope?.method,src.title,src.type,src.evidence_class,src.source_type,...(c.facet_ids||[]).map(id=>(j.plan?.facets||[]).find(f=>f.id===id)?.label||'')].map(text).join(' '),hay=new Set(contentTerms(blob)),nblob=norm(blob);return ex.some(x=>{const nx=norm(x);if(/animal|mouse|mice|rat|rodent|murine/.test(nx)&&/\b(?:animal|mouse|mice|rat|rodent|murine|mouse model|animal model)\b/.test(nblob))return true;const terms=contentTerms(x);return terms.length&&terms.every(t=>researchTermPresent(hay,t));});};

const reportWordCount=value=>text(value).trim().split(/\s+/).filter(Boolean).length;

function u113BenchmarkMetrics(j){
    const claimMap=new Map(researchArray(j?.claims).map(c=>[c.id,c])),synthesisAllowed=new Set(effectiveReportClaimIds(j)),qualified=[...synthesisAllowed].map(id=>claimMap.get(id)).filter(Boolean).filter(c=>!claimViolatesExclusions(j,c));
    const trulyQualifiedIds=new Set(researchArray(j?.support_records).filter(r=>r.status==='qualified').map(r=>r.claim_id)),reportEligibleReviewIds=new Set(researchArray(j?.support_records).filter(r=>r.status==='review_candidate'&&synthesisAllowed.has(r.claim_id)).map(r=>r.claim_id)),actualWriterIds=new Set(researchArray(j?.writer_allowed_claim_ids)),verifiedPublishedIds=publishedVerifiedClaimIds(j);const wordCount=v=>reportWordCount(v),quoteWords=c=>wordCount(c?.quote),contextWords=c=>wordCount(c?.context_text);
    const blueprintSections=researchArray(j?.report_blueprint),verifiedSections=researchArray(j?.sections).filter(s=>s?.ok),metricSections=blueprintSections.length?blueprintSections:verifiedSections;
    const sectionRows=[];for(const section of metricSections){const directIds=researchArray(section?.claim_ids).length?researchArray(section?.claim_ids):researchArray(section?.anchors?.used),facetSet=new Set(researchArray(section?.facet_ids)),connections=researchArray(j?.connection_map).filter(c=>researchArray(c?.facet_ids).some(id=>facetSet.has(id))||researchArray(c?.claim_ids).some(id=>directIds.includes(id))),connectionIds=[...new Set(connections.flatMap(c=>researchArray(c?.claim_ids)).filter(id=>{const claim=claimMap.get(id);return synthesisAllowed.has(id)&&claim&&!claimViolatesExclusions(j,claim);} ))],authorizedIds=[...new Set([...directIds,...connectionIds])].filter(id=>claimMap.has(id));sectionRows.push({section_id:section?.id||'',authorized_claim_ids:authorizedIds});}
    const writerOccurrences=sectionRows.flatMap(s=>s.authorized_claim_ids),writerUnique=[...new Set(writerOccurrences)],writerClaims=writerUnique.map(id=>claimMap.get(id)).filter(Boolean),usedIds=[...new Set(researchArray(j?.sections).filter(s=>s?.ok).flatMap(s=>researchArray(s?.anchors?.used)))].filter(id=>claimMap.has(id)),usedClaims=usedIds.map(id=>claimMap.get(id)).filter(Boolean);
    const qualifiedQuoteWords=[...trulyQualifiedIds].reduce((n,id)=>n+quoteWords(claimMap.get(id)),0),writerQuoteUnique=writerClaims.reduce((n,c)=>n+quoteWords(c),0),writerContextUnique=writerClaims.reduce((n,c)=>n+contextWords(c),0),writerQuoteTotal=writerOccurrences.reduce((n,id)=>n+quoteWords(claimMap.get(id)),0),writerContextTotal=writerOccurrences.reduce((n,id)=>n+contextWords(claimMap.get(id)),0),usedQuoteWords=usedClaims.reduce((n,c)=>n+quoteWords(c),0),usedContextWords=usedClaims.reduce((n,c)=>n+contextWords(c),0);
    const report=text(j?.report),narrative=report.replace(/\n\nSources:\n[\s\S]*$/i,'').trim(),finalWords=wordCount(narrative),finalWithSources=wordCount(report),telemetry=u130RoleTelemetry(j),workerModel=text(j?.settings?.small_model||researchArray(j?.stage_runs).find(m=>m?.model&&m.model!==j?.settings?.report_model)?.model),reporterModel=text(j?.settings?.report_model||researchArray(j?.stage_runs).find(m=>m?.model&&/simple_|global_analysis|synthesis|section_|editor|adversarial|sufficiency|relation_verify/.test(text(m.stage)))?.model);
    const targetCounts={direct:j.claims.filter(c=>text(c.target_eligibility||'direct')==='direct').length,background:j.claims.filter(c=>text(c.target_eligibility)==='background').length,blocked:j.claims.filter(c=>text(c.target_eligibility)==='blocked').length,conflicts:j.claims.filter(c=>['CONFLICT','ADJACENT_VERSION'].includes(text(c.target_identity_status))).length,historical:j.claims.filter(c=>text(c.target_identity_status)==='HISTORICAL_REFERENCE').length},regionCounts={related_content:0,navigation:0,footer:0,metadata:0,references:0,main_content:0};for(const snap of researchArray(j.source_snapshots))for(const u of researchArray(snap.units)){const k=text(u.region_role||'main_content');if(Object.prototype.hasOwnProperty.call(regionCounts,k))regionCounts[k]++;}const canonicalSources=researchArray(j.sources).filter(x=>x.broad_canonical_source).map(x=>({source_id:x.id,main_section_count:Number(x.main_section_count)||0,main_section_names:researchArray(x.main_section_names),extraction_early_stop:x.extraction_early_stop||null}));
    j.benchmark_metrics={version:6,legacy_field_notes:{pre_report_qualified_claims:"Now counts distinct claim IDs with at least one qualified support; older exports counted report-eligible claims in this field."},semantic_loop:{semantic_loop_enabled:!!U130_SEMANTIC_LOOP_ENABLED,semantic_brief_confidence:Number(j?.semantic_brief?.interpretation_confidence)||0,requested_object_type:text(j?.semantic_brief?.requested_object_type),literal_query_used:!!j?.literal_query_used,context_search_attempted:!!j?.context_search_state?.attempted,context_search_resolved:!!j?.context_search_state?.resolved,semantic_drift_warning:researchArray(j?.simple_report_check?.warnings).includes('semantic_target_drift')},models:{worker:workerModel,reporter:reporterModel},thinking_policy:{contract_supplements:'adaptive_single_reasoning_attempt',facet_query:'off',extraction:'off',circuit_breaker:!!U131_WORKER_THINKING_CIRCUIT_BREAKER},context_peaks:{worker:telemetry.worker.context_peak_ratio,reporter:telemetry.reporter.context_peak_ratio},thinking_completion:{worker:{thinking_attempts:telemetry.worker.thinking_attempts,thinking_completed:telemetry.worker.thinking_completed,thinking_truncated:telemetry.worker.thinking_truncated,finalized_without_thinking:telemetry.worker.finalized_without_thinking},reporter:{thinking_attempts:telemetry.reporter.thinking_attempts,thinking_completed:telemetry.reporter.thinking_completed,thinking_truncated:telemetry.reporter.thinking_truncated,finalized_without_thinking:telemetry.reporter.finalized_without_thinking}},report_status:{quality_state:text(j?.synthesis?.quality_state||''),synthesis_status:text(j?.synthesis?.synthesis_status||''),completion:text(j?.synthesis?.completion||''),fallback_level:text(j?.synthesis?.fallback_level||j?.simple_fallback_level||'none'),fallback_reason_code:text(j?.simple_fallback_reason?.code||j?.synthesis?.fallback_reason?.code||''),fallback_reason_message:text(j?.simple_fallback_reason?.message||j?.synthesis?.fallback_reason?.message||''),pipeline:text(j?.synthesis?.pipeline||j?.report_pipeline||'')},target_integrity:{identity:researchObject(j.target_identity),revision:Number(j.target_identity_revision)||0,claims:targetCounts,packet:{direct:researchArray(j.simple_evidence_packet?.direct_evidence).length,background:researchArray(j.simple_evidence_packet?.background_evidence).length,blocked:Number(j.simple_evidence_packet?.blocked_evidence_count)||0}},document_regions:{units:regionCounts,blocked_unit_count:regionCounts.related_content+regionCounts.navigation+regionCounts.footer+regionCounts.metadata+(regionCounts.references||0)},canonical_source_coverage:{sources:canonicalSources,packet_sections:researchArray(j.simple_evidence_packet?.content_sections),canonical_saturation:!!(j.stop_reason==='canonical_source_saturation')},report_integrity:j.report_integrity||null,provenance_integrity:{repaired_claims:researchArray(j?.diagnostics?.provenance_repairs).length,quarantined_claims:researchArray(j?.diagnostics?.provenance_quarantined).length,repairs:researchArray(j?.diagnostics?.provenance_repairs).slice(-24),quarantines:researchArray(j?.diagnostics?.provenance_quarantined).slice(-24)},collection_stop:{stop_reason:j?.stop_reason||'',marginal_saturated:!!j?.marginal_saturated,rounds:researchArray(j?.rounds).length,max_rounds:Number(j?.settings?.max_rounds)||0,last_rounds:researchArray(j?.rounds).slice(-5).map(r=>({round:r.number,value:r.marginal_evidence_value,productive:!!r.productive_gain,qualified:r.novel_qualified_claims,review_candidates:r.review_candidate_gain,direct:r.direct_gain,counter:r.counter_gain,new_works:r.new_works,new_locked_requirement_evidence:r.new_locked_requirement_evidence,rejected:r.rejected_gain}))},qualification_health:j?.diagnostics?.qualification_health||null,word_count_method:'whitespace-separated words',definitions:{qualified_exact_evidence_words:'Exact quote words across unique report-eligible qualified claims before report writing.',report_input_exact_evidence_words_unique:'Exact quote words across unique claims made available to at least one final section writer.',report_input_exact_evidence_words_total:'Exact quote words summed across section-writer evidence payloads; a claim used in multiple section payloads is counted each time.',report_input_context_words_unique:'Nearby evidence-context words across unique writer-authorized claims; reported separately from exact quotes.',report_input_context_words_total:'Nearby evidence-context words summed across section-writer payloads, counting repeated claims across sections.',used_exact_evidence_words_unique:'Exact quote words for unique claims actually anchored in verified final sections.',final_report_words:'Final narrative word count excluding the Sources list.'},pre_report:{qualified_supports:researchArray(j?.support_records).filter(r=>r.status==='qualified').length,qualified_claims:trulyQualifiedIds.size,report_eligible_review_candidates:reportEligibleReviewIds.size,report_eligible_claims:qualified.length,writer_allowed_claims:actualWriterIds.size,qualified_exact_evidence_words:qualifiedQuoteWords,writer_sections:sectionRows.length,writer_claims_unique:writerUnique.length,writer_claim_occurrences:writerOccurrences.length,report_input_exact_evidence_words_unique:writerQuoteUnique,report_input_exact_evidence_words_total:writerQuoteTotal,report_input_context_words_unique:writerContextUnique,report_input_context_words_total:writerContextTotal,report_input_quote_plus_context_words_unique:writerQuoteUnique+writerContextUnique,report_input_quote_plus_context_words_total:writerQuoteTotal+writerContextTotal},post_report:{published_verified_claims:verifiedPublishedIds.size,used_claims_unique:usedIds.length,used_exact_evidence_words_unique:usedQuoteWords,used_context_words_unique:usedContextWords,final_report_words:finalWords,final_report_words_with_sources:finalWithSources},ratios:{unique_exact_evidence_to_report_words:finalWords?Number((writerQuoteUnique/finalWords).toFixed(3)):null,total_exact_evidence_to_report_words:finalWords?Number((writerQuoteTotal/finalWords).toFixed(3)):null,used_exact_evidence_to_report_words:finalWords?Number((usedQuoteWords/finalWords).toFixed(3)):null,used_claim_share:writerUnique.length?Number((usedIds.length/writerUnique.length).toFixed(3)):null},updated_at:researchNow()};
    if(U140_MASTER_ENABLE){const verdicts=researchArray(j.u140_verification?.verdicts),roles={};for(const src of researchArray(j.sources)){const role=text(src.study_role||'unknown');roles[role]=(roles[role]||0)+1;}j.benchmark_metrics.v140={role_searches:researchArray(j.rounds).filter(r=>/^role_/.test(text(r.task?.strategy))).map(r=>({strategy:r.task.strategy,round:r.number,selected:r.selected||0})),study_roles:roles,integrity_checks:Object.keys(researchObject(j.integrity_metadata_cache)).length,retraction_rejections:researchArray(j.diagnostics?.retraction_rejections).length,writer_allowed_claim_count:researchArray(j.writer_allowed_claim_ids).length,verified_claim_count:researchArray(j.u140_verified_claim_ids).length,verdicts:{supported:verdicts.filter(x=>x.status==='SUPPORTED'&&!x.removed).length,partial:verdicts.filter(x=>x.status==='PARTIAL').length,unsupported:verdicts.filter(x=>x.status==='UNSUPPORTED').length,contradicted:verdicts.filter(x=>x.status==='CONTRADICTED').length,repaired:Number(j.u140_verification?.repaired)||0,removed:Number(j.u140_verification?.removed)||0},validation_passed:!!j.simple_report_check?.validation_passed,forced_publish:!!j.simple_report_check?.forced_publish,runtime_minutes:j.started?Number(((Date.now()-Date.parse(j.started))/60000).toFixed(2)):null};}
    return j.benchmark_metrics;
  }

function canonicalCandidateURL(value){
    const valid=validURL(value);if(!valid)return '';
    try{const u=new URL(valid);u.protocol='https:';u.hostname=u.hostname.toLowerCase().replace(/^www\./,'');u.hash='';if(u.hostname==='youtu.be'){const id=u.pathname.split('/').filter(Boolean)[0];if(id)return 'https://youtube.com/watch?v='+encodeURIComponent(id);}if(/(?:^|\.)youtube\.com$/.test(u.hostname)&&u.pathname==='/watch'){const id=u.searchParams.get('v');if(id)return 'https://youtube.com/watch?v='+encodeURIComponent(id);}for(const k of [...u.searchParams.keys()])if(/^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid|ref|source|si|feature|pp)$/i.test(k))u.searchParams.delete(k);u.searchParams.sort();u.pathname=u.pathname.replace(/\/+$/,'')||'/';return u.origin+u.pathname+(u.search||'');}catch(_){return '';}
  }

const WORKING_MEMORY_START_TAG='<working_memory>';

const WORKING_MEMORY_END_TAG='</working_memory>';

function extractWorkingMemoryContent(text) {
  const start = text.indexOf(WORKING_MEMORY_START_TAG);
  if (start === -1) return null;

  const contentStart = start + WORKING_MEMORY_START_TAG.length;
  const end = text.indexOf(WORKING_MEMORY_END_TAG, contentStart);
  if (end === -1) return null;

  return text.substring(contentStart, end);
}
export {ocCoreWorkStart,ocCoreWorkEnd,VERSION,STORE,U140_MASTER_ENABLE,U140_RESEARCH_LIBRARY_V2,text,requestText,norm,words,hash,json,researchArray,researchObject,modelJSON,rows,human,recall,clean,researchClean,validURL,phraseIncludes,MEMORY_EMBED_MODEL_STORAGE,MEMORY_DB,MEMORY_SCHEMA_VERSION,SINGLE_PREDICATES,clamp,iso,tokenCounts,expandedWords,jaccard,predicateKey,activeObservation,contentTerms,historicalQuery,freshQuery,reuseSavedSearchQuery,refreshQuery,stripResearchOutput,RESEARCH_TASK_STOP,contextualResearchTopic,deepResearchReportIntent,requiresDeepResearch,researchRequest,researchMetrics,researchMetric,volatileResearchMetric,researchDomainList,domainAllowedByPolicy,sourceFitnessProfile,researchTemporalSourceStatus,researchSourceWithinContract,relationHints,simpleMemoryKey,compactResearchJobForStorage,boundedResearchJobForLocal,compactDocumentForStorage,v33Clone,v33Stable,v33Wait,u124LogicalSourceKey,u130WorkerPredictBudget,u11Performance,LIGHTYEAR_PROVIDER_LIMITS,clampInt,redactProviderMessage,anySearchCredential,tavilyCredential,tavilySearchRequest,anySearchRequest,providerFailureDetails,markAnySearchFailure,anySearchResponseError,buildAnySearchSearchRequest,buildAnySearchExtractRequest,buildOpenAlexSearchURL,chatAttachmentImages,isChatImageAttachment,localImagesOnlyMessage,chatMessagesHaveImages,MEMORY_SCHEMA,MEMORY_SYSTEM,OBSERVATION_SCHEMA,OBSERVATION_SYSTEM,exportRequest,researchTerms,researchMetricKey,sourceTypeInfo,researchEvidenceClass,facetLexicalScore,researchQualityReady,firstPartySourceConfidence,researchTermPresent,localCalendarDate,researchNow,canonicalCandidateURL,extractWorkingMemoryContent};