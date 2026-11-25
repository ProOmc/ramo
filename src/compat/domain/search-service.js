import {text,norm,words,researchArray,researchObject,rows,clean,researchClean,validURL,contentTerms,freshQuery,refreshQuery,researchDomainList,domainAllowedByPolicy,researchSourceWithinContract,v33Wait,LIGHTYEAR_PROVIDER_LIMITS,redactProviderMessage,anySearchCredential,tavilyCredential,tavilySearchRequest,anySearchRequest,providerFailureDetails,markAnySearchFailure,anySearchResponseError,buildAnySearchSearchRequest,buildAnySearchExtractRequest,buildOpenAlexSearchURL,researchEvidenceClass,facetLexicalScore,canonicalCandidateURL} from './helpers.js';
import {needsConversion as documentNeedsConversion,convertDocument as convertDocumentLocal} from './document-convert.js';

class SearchService {
    constructor(host,transport,router){this.host=host;this.transport=transport;this.router=router;}
    async anySearch(query,signal,options={}){const {body,provider_query}=buildAnySearchSearchRequest(query,options);let result,transport_mode='';try{const response=await anySearchRequest(this.transport,this.host,'search',body,signal,30000);result=response.result;transport_mode=response.transport_mode;}catch(e){throw markAnySearchFailure(e,'search');}if(result?.code!==undefined&&Number(result.code)!==0)throw anySearchResponseError(result,'search');return {...result,_provider:'anysearch',_provider_query:provider_query,_transport_mode:transport_mode};}

    async webSearch(query,signal,options={}){try{return await this.anySearch(query,signal,options);}catch(error){if(!tavilyCredential(this.host).key||signal?.aborted)throw error;try{return await tavilySearchRequest(this.transport,this.host,query,options,signal);}catch(reserveError){reserveError.message='AnySearch failed; Tavily reserve also failed: '+redactProviderMessage(reserveError?.message);throw reserveError;}}}

    cached(lane,input){
      // Fresh/current requests and explicit refreshes must hit the provider.
      // Ordinary repeated questions and "show the previous search again" may reuse a saved snapshot.
      if(freshQuery(input)||refreshQuery(input)||/^!/.test(input))return null;
      const terms=contentTerms(this.router.query(input,lane));if(!terms.length)return null;
      const now=Date.now(),ttl=lane==='science'?7*86400000:30*86400000,records=this.host.engine?.store.data.searches||[];
      for(const row of [...records].reverse()){
        const age=now-Date.parse(row.checked_at);if(row.lane!==lane||row.status!=='ok'||!Number.isFinite(age)||age<0||age>ttl||!row.sources?.length||row.verification==='unavailable')continue;
        const saved=contentTerms(row.query),match=terms.filter(t=>saved.includes(t)).length/terms.length,reverse=saved.filter(t=>terms.includes(t)).length/Math.max(1,saved.length);
        if(match<.9||reverse<.75)continue;
        const sources=row.sources.filter(r=>validURL(r.url)&&r.title&&text(r.text).trim());if(!sources.length)continue;
        return {schema:2,lane,query:this.router.query(input,lane),status:'ok',verification:row.verification||'not_applicable',sources,cached:true,checked_at:row.checked_at,cache_age_ms:age};
      }
      return null;
    }
    abstract(index){const out=[];for(const [word,positions] of Object.entries(index||{}))for(const p of Array.isArray(positions)?positions:[])if(Number.isInteger(p)&&p>=0&&p<10000)out[p]=word;return out.filter(Boolean).join(' ');}
    academicQuery(input){
      const expanded=this.router.query(input,'science'),terms=contentTerms(expanded).filter(t=>!/^20\d\d$/.test(t)&&!new Set(['systematic','review','empirical','studies','study','paper','papers','evidence','research','report','detailed','current','recent']).has(t));
      return [...new Set(terms)].slice(0,18).join(' ').slice(0,220)||expanded.slice(0,220);
    }
    openAlexSource(r,checkedAt){const abstract=this.abstract(r.abstract_inverted_index),journal=r.primary_location?.source?.display_name||'',url=validURL(r.doi||r.primary_location?.landing_page_url||r.id);return {title:clean(r.title||r.display_name),url,is_retracted:r.is_retracted===true,text:abstract.slice(0,18000),search_text:researchClean(r.title||r.display_name).slice(0,1800),published:r.publication_date||'',doi:r.doi||'',openalex_id:r.id||'',authors:researchArray(r.authorships).map(a=>a.author?.display_name).filter(Boolean),year:r.publication_year||null,journal,type:text(r.type||''),cited_by_count:Number(r.cited_by_count)||0,is_oa:!!r.open_access?.is_oa,referenced_works:researchArray(r.referenced_works).slice(0,100),related_works:researchArray(r.related_works).slice(0,50),cited_by_api_url:r.cited_by_api_url||'',kind:'science',provider_relevance:Number.isFinite(Number(r.relevance_score))?Number(r.relevance_score):Number.isFinite(Number(r.score))?Number(r.score):null,raw_content_used:false,discovered_at:checkedAt,abstractAvailable:!!abstract};}
    async citationSearch(seed,query,signal,options={}){
      const id=text(seed?.openalex_id).match(/W\d+/i)?.[0];if(!id)return {schema:4,lane:'science',query,status:'no_evidence',verification:'not_applicable',sources:[],cached:false,checked_at:new Date().toISOString(),provider_query:query,request_count:0,graph_seed:''};
      const checkedAt=new Date().toISOString(),filters=[];if(options?.date_start)filters.push('from_publication_date:'+options.date_start);if(options?.date_end)filters.push('to_publication_date:'+options.date_end);let requests=0,rows=[];
      const addRows=r=>{for(const x of researchArray(r?.results))if(x?.id)rows.push(x);};
      const outgoing=[...researchArray(seed?.referenced_works),...researchArray(seed?.related_works)].map(x=>text(x).match(/W\d+/i)?.[0]).filter(Boolean).slice(0,80);
      if(outgoing.length){requests++;const f=['openalex:'+outgoing.join('|'),...filters].join(',');try{addRows(await this.transport.get('https://api.openalex.org/works?filter='+encodeURIComponent(f)+'&per_page='+Math.min(100,outgoing.length),{},signal));}catch(e){if(signal?.aborted)throw e;}}
      requests++;try{const f=['cites:'+id,...filters].join(',');addRows(await this.transport.get('https://api.openalex.org/works?filter='+encodeURIComponent(f)+'&per_page=30',{},signal));}catch(e){if(signal?.aborted)throw e;}
      const seen=new Set(),sources=rows.map(r=>this.openAlexSource(r,checkedAt)).filter(x=>x.url&&x.title&&!seen.has(x.openalex_id)&&(seen.add(x.openalex_id),true));
      const terms=contentTerms(query),rank=x=>{const hay=new Set(contentTerms(x.title+' '+x.text));return terms.filter(t=>hay.has(t)).length/Math.max(1,terms.length)+Math.min(.18,Math.log10(1+x.cited_by_count)*.035);};sources.forEach(x=>x.score=rank(x));sources.sort((a,b)=>b.score-a.score);
      return {schema:4,lane:'science',query,status:sources.length?'ok':'no_evidence',verification:'not_applicable',sources:sources.slice(0,12),cached:false,checked_at:checkedAt,provider_query:query,request_count:requests,graph_seed:id,graph_relation:'references_citations_related'};
    }
    async search(lane,input,signal,options={}){
      const session=this.host?.session,activityOwner={chat_id:session?.chatId||null,turn_index:session?.turn?.index,turn_id:session?.turn?.activity?.id};
      const report=(query,sources,meta)=>this.host?.reportSearchResults?.(query,sources,{...meta,activity_owner:activityOwner});
      const cached=options?.no_cache?null:this.cached(lane,input);if(cached){this.host?.reportActivity?.('search',String(cached.query).slice(0,300),'Using a previously saved search snapshot',activityOwner);report(cached.query,cached.sources,{status:'ok',provider:'saved',cached:true});return cached;}let query=this.router.query(input,lane),result,provider_query=query,retry_query='';
      this.host?.reportActivity?.('search',String(query).slice(0,300),String(options?.purpose||options?.reason||options?.strategy||'Evidence discovery / verification'),activityOwner);
      if(lane==='science'){
        const semantic=options?.strategy==='semantic_academic';
        const fetchOpenAlex=async q=>this.transport.get(buildOpenAlexSearchURL(q,{semantic,date_start:options?.date_start,date_end:options?.date_end,per_page:semantic?30:20}),{},signal);
        try{result=await fetchOpenAlex(query);}catch(e){
          if(signal?.aborted||options?.research)throw e;retry_query=this.academicQuery(query);if(!retry_query||norm(retry_query)===norm(query))throw e;
          result=await fetchOpenAlex(retry_query);provider_query=retry_query;
        }
      }else{
        try{result=await this.webSearch(query,signal,{max_results:10,format:'markdown',tag:options?.anysearch_tag,zone:options?.zone,language:options?.language,params:options?.anysearch_params,date_start:options?.date_start,date_end:options?.date_end,date_filter_mode:options?.date_filter_mode||'none',temporal_news:!!options?.temporal_news,source_restrictions:options?.source_restrictions||{},preferred_domains:options?.preferred_domains||[]});}
        catch(e){const failure=markAnySearchFailure(e,'search'),details=providerFailureDetails(failure);report(query,[],{status:'provider_failed',provider:'anysearch',error:details.message||'Search provider failed'});return {schema:4,lane,query,status:'provider_failed',result_kind:'SEARCH_PROVIDER_FAILED',failure_kind:'SEARCH_PROVIDER_FAILED',provider_error:details,verification:'unavailable',sources:[],cached:false,checked_at:new Date().toISOString(),provider_query:query,retry_query:'',request_id:details.request_id,response_time:0,usage:{},date_start:options?.date_start||'',date_end:options?.date_end||'',date_filter_mode:options?.date_filter_mode||'none',temporal_news:!!options?.temporal_news,auth_mode:anySearchCredential(this.host).source};}
        provider_query=text(result?._provider_query||query);
      }
      const checkedAt=new Date().toISOString();
      const resultRows=researchArray(lane==='science'?result?.results:result?.data?.results);let sources=lane==='science'?resultRows.map(r=>this.openAlexSource(r,checkedAt)).filter(r=>r.url&&r.title):resultRows.map((r,index)=>{const snippet=researchClean(r.snippet),providerContent=researchClean(r.content),chosen=providerContent||snippet,providerDate=text(r.published_date||r.published_at||r.date);return {title:clean(r.title),url:validURL(r.url),text:chosen.slice(0,26000),search_text:(snippet||providerContent).slice(0,1800),published:providerDate,provider_date:providerDate,date_provenance:providerDate?'provider_estimate':'unknown',doi:'',openalex_id:'',authors:[],year:null,journal:'',type:'',cited_by_count:0,is_oa:false,kind:lane,provider_name:text(result?._provider||'anysearch'),provider_relevance:Number.isFinite(Number(r.score))?Number(r.score):null,provider_rank:index+1,raw_content_used:!!providerContent,discovered_at:checkedAt};}).filter(r=>r.url&&r.title);
      const sourcePolicy=options?.source_restrictions||{};if(lane!=='science')sources=sources.filter(r=>domainAllowedByPolicy(r,sourcePolicy));
      if(options?.date_start||options?.date_end)sources=sources.filter(r=>researchSourceWithinContract(r,{contract:{date_start:options.date_start||'',date_end:options.date_end||'',date_filter_mode:options?.date_filter_mode||'hard',temporal_intent:options?.temporal_intent||{}}}).ok);
      const qs=words(query),preferredDomains=new Set(researchDomainList(options?.preferred_domains));sources=sources.map(r=>{let domain='';try{domain=new URL(r.url).hostname.replace(/^www\./,'');}catch(_){}const lexical=qs.filter(k=>words(r.title+' '+r.text).includes(k)).length/Math.max(qs.length,1),preferred=[...preferredDomains].some(d=>domain===d||domain.endsWith('.'+d));return {...r,score:lexical,preferred_domain:preferred};}).sort((a,b)=>(Number(b.preferred_domain)-Number(a.preferred_domain))||(Number(a.provider_rank)||999)-(Number(b.provider_rank)||999)||b.score-a.score).slice(0,options?.research?10:6);
      sources=sources.map(r=>({...r,abstractAvailable:!!r.text}));
      // Search results are reported after optional source verification below.
      let verification='not_applicable';
      if(lane==='web'&&/latest.*(?:release|version)/i.test(query)){verification='unavailable';const repos=[...new Set(sources.map(r=>r.url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:releases|tags)/i)?.[1]).filter(Boolean))];if(repos.length===1){try{const release=await this.transport.get('https://api.github.com/repos/'+repos[0]+'/releases/latest',{headers:{Accept:'application/vnd.github+json'}},signal,10000);if(release.tag_name&&!release.prerelease&&!release.draft){sources.unshift({title:repos[0]+' official latest stable release',url:release.html_url,text:'Verified stable tag: '+release.tag_name+'; published: '+release.published_at+'. '+clean(release.body).slice(0,900),published:release.published_at,kind:'web',official:true,extraction_status:'official_api',extracted_at:checkedAt});verification='verified';}}catch(_){}}}
      report(query,sources.slice(0,options?.research?12:6),{status:sources.length?'ok':'no_evidence',provider:lane==='science'?'openalex':text(result?._provider||'anysearch')});
      return {schema:4,lane,query,status:sources.length?'ok':'no_evidence',result_kind:sources.length?'SEARCH_SUCCEEDED':'SEARCH_SUCCEEDED_BUT_NO_USEFUL_EVIDENCE',verification,sources:sources.slice(0,options?.research?12:6),cached:false,checked_at:checkedAt,provider_query,retry_query,request_id:text(result?.request_id).slice(0,120),response_time:Number(result?.data?.metadata?.search_time_ms)||0,usage:{},date_start:options?.date_start||'',date_end:options?.date_end||'',date_filter_mode:options?.date_filter_mode||'none',temporal_news:!!options?.temporal_news};
    }
    async verifyResearchSources(sources,query,signal,options={}){
      const all=researchArray(sources).map(s=>({...s})),web=all.filter(s=>s.kind==='web'&&validURL(s.url)&&!s.official),science=all.filter(s=>s.kind==='science'&&validURL(s.url)&&text(s.text).length>=120),policy=options?.plan?.contract?.source_restrictions||options?.source_restrictions||{};
      const ranked=[...web].filter(s=>domainAllowedByPolicy(s,policy)).sort((a,b)=>(Number(b.provider_relevance)||Number(b.score)||0)-(Number(a.provider_relevance)||Number(a.score)||0));
      const chosen=[],domainCounts=new Map();for(const s of ranked){let domain='';try{domain=new URL(s.url).hostname.replace(/^www\./,'');}catch(_){}if((domainCounts.get(domain)||0)>=3)continue;domainCounts.set(domain,(domainCounts.get(domain)||0)+1);chosen.push(s);if(chosen.length>=20)break;}
      const canAcademicEscalate=options?.fulltext!==false,academicChosen=canAcademicEscalate?[...science].filter(s=>domainAllowedByPolicy(s,policy)).sort((a,b)=>{
        const rank=x=>{const hay=new Set(contentTerms(x.title+' '+x.text)),facetHit=facetLexicalScore(options?.facet,hay),cls=researchEvidenceClass(x),primary=['peer_reviewed_primary','academic_primary','academic_data','preprint_primary'].includes(cls)?.25:0;return facetHit*.55+primary+(Number(x.score)||0)*.15+Math.min(.12,Math.log10(1+(Number(x.cited_by_count)||0))*.03);};return rank(b)-rank(a);
      }).slice(0,Math.max(1,Math.min(20,Number(options?.academic_limit)||8))):[];
      const targets=[...new Map([...chosen,...academicChosen].map(s=>[validURL(s.url),s])).values()],chosenUrls=new Set(targets.map(s=>validURL(s.url))),extracted=new Map(),failed=new Set();let requests=0,rateLimited=false;const networkEvents=[];
      const extractOne=async(source,depth=0)=>{const u=validURL(source?.url);if(!u)return;requests++;this.host?.reportActivity?.('read',u,String(source?.title||'Fetching source page').slice(0,160));const started=Date.now(),event={provider:'anysearch',operation:'extract',url:u,retry:depth};networkEvents.push(event);try{
          const response=await anySearchRequest(this.transport,this.host,'extract',buildAnySearchExtractRequest(u),signal,LIGHTYEAR_PROVIDER_LIMITS.anysearch_extract.timeout_ms),r=response.result;event.transport_mode=response.transport_mode;if(r?.code!==undefined&&Number(r.code)!==0)throw anySearchResponseError(r,'extract');
          const data=researchObject(r?.data),returned=validURL(data.url||u),raw=researchClean(data.content);event.request_id=text(r?.request_id).slice(0,120);event.returned_url=returned;event.title=text(data.title).slice(0,300);if(returned&&canonicalCandidateURL(returned)!==canonicalCandidateURL(u))throw Object.assign(Error('AnySearch Extract returned mismatched URL'),{error_class:'identity'});if(raw.length>=40){extracted.set(u,raw.slice(0,50000));event.outcome='ok';event.extracted_chars=raw.length;}else{
            // Unsupported document type: fetch and convert locally to Markdown.
            let converted=null;
            if(documentNeedsConversion({url:u})){
              try{converted=await convertDocumentLocal({url:u},signal);event.content_type=event.content_type||'';}
              catch(ce){event.convert_error=redactProviderMessage(ce?.message).slice(0,300);}
            }
            if(converted?.ok&&researchClean(converted.markdown).length>=40){extracted.set(u,researchClean(converted.markdown).slice(0,50000));event.outcome='markitdown_extract';event.extracted_chars=converted.chars;event.ocr_used=!!converted.ocr_used;}
            else{failed.add(u);event.outcome='empty';event.convert_error=event.convert_error||converted?.error||'';}
          }
        }catch(e){if(signal?.aborted)throw e;if((e.http_status===429||e.status===429||e.code===429||/429|rate.limit/i.test(text(e.message)))&&depth<1){rateLimited=true;event.outcome='rate_limited';await v33Wait(Math.min(5000,Math.max(1000,Number(e.retry_after_ms)||1000)),signal);return extractOne(source,depth+1);}const fallback=researchClean(source?.text);if(fallback.length>=300){extracted.set(u,fallback.slice(0,50000));event.outcome='search_content_fallback';event.fallback_reason=redactProviderMessage(e?.message).slice(0,500);event.extracted_chars=fallback.length;}else{
            let converted=null;
            if(documentNeedsConversion({url:u,contentType:event.content_type||''})){
              try{converted=await convertDocumentLocal({url:u},signal);}catch(ce){event.convert_error=redactProviderMessage(ce?.message).slice(0,300);}
            }
            if(converted?.ok&&researchClean(converted.markdown).length>=40){extracted.set(u,researchClean(converted.markdown).slice(0,50000));event.outcome='markitdown_extract';event.extracted_chars=converted.chars;event.ocr_used=!!converted.ocr_used;}
            else{failed.add(u);event.outcome='failed';event.error=redactProviderMessage(e?.message);event.convert_error=event.convert_error||converted?.error||'';}
          }}finally{event.latency_ms=Date.now()-started;}};
      let targetIndex=0;while(targetIndex<targets.length){const width=rateLimited?1:LIGHTYEAR_PROVIDER_LIMITS.anysearch_extract.concurrency,batch=targets.slice(targetIndex,targetIndex+width);targetIndex+=batch.length;const results=await Promise.allSettled(batch.map(row=>extractOne(row)));const aborted=results.find(x=>x.status==='rejected'&&signal?.aborted);if(aborted)throw aborted.reason;}
      const now=new Date().toISOString(),merged=all.map(s=>{const u=validURL(s.url),raw=extracted.get(u);
        if(raw){if(s.kind==='science'){const abstract=text(s.text),useFull=raw.length>=Math.max(1200,abstract.length*1.05);return {...s,search_text:text(s.search_text).slice(0,1800),text:useFull?(abstract+'\n\nFULL-TEXT/PUBLISHER EXTRACT:\n'+raw).slice(0,50000):abstract,raw_content_used:useFull,extraction_status:useFull?'academic_fulltext_extract':'abstract_supported',extracted_at:now};}return {...s,search_text:text(s.search_text||s.text).slice(0,1800),text:raw,raw_content_used:true,extraction_status:'verified_extract',extracted_at:now};}
        if(chosenUrls.has(u))return {...s,extraction_status:s.kind==='science'?(s.text?'abstract_supported':'metadata_only'):'extract_failed',extracted_at:now};return {...s,extraction_status:s.kind==='science'?(s.text?'abstract_supported':'metadata_only'):(s.official?'official_api':'not_selected')};});
      return {network_events:networkEvents,rate_limited:rateLimited,sources:merged,verified:extracted.size,failed:failed.size,attempted:targets.length,requests,academic_escalated:academicChosen.length,successful_urls:extracted.size,failed_urls:failed.size,provider:'anysearch'};
    }
  }
export {SearchService};
