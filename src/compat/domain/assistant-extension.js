import {TextMemoryWorkspace} from './text-memory-workspace.js';
import {ResearchEventBus} from './research-event-bus.js';
import {ResearchActivityPanel} from './research-activity-panel.js';
import {VERSION,text,norm,words,hash,researchArray,researchObject,rows,recall,researchClean,validURL,MEMORY_EMBED_MODEL_STORAGE,refreshQuery,deepResearchReportIntent,v33Clone,redactProviderMessage,anySearchCredential,anySearchRequest,providerFailureDetails,buildAnySearchExtractRequest,chatAttachmentImages,isChatImageAttachment,researchQualityReady,localCalendarDate,canonicalCandidateURL} from './helpers.js';
import {needsConversion as documentNeedsConversion,convertDocument as convertDocumentLocal} from './document-convert.js';

class AssistantExtension {
constructor(){this.engine=null;this.ready=null;this.session=null;this.researchEvents=new ResearchEventBus();this.liveThinking=localStorage.getItem('RAMO_LIVE_CHAT_THINKING')==='1';this.researchEvents.subscribe(evt=>this._recordTurnActivity(evt));}
showCoreActivityDetail(message){this.setVariable('Core Activity Detail',message);}
variable(name){return globalThis.RamoState.get(name);}
setVariable(name,value){globalThis.RamoState.set(name,value);}
    storage(){return localStorage;}
    _storageGet(k){try{return this.storage().getItem(k);}catch(_){return '';}}
    _storageSet(k,v){try{this.storage().setItem(k,v);return true;}catch(_){return false;}}
    _runtimeSeconds(s=this.session){let ui=0;try{ui=Math.max(0,Number(this.variable('Research Runtime Seconds'))||0);}catch(_){}const state=text(this.variable('Research Runtime Result')),pending=['PREPARING','RUNNING'].includes(state)?Number(this._pendingResearchStartMs||0):0,start=Number(s?.research_runtime_started_at_ms||s?.request_started_at_ms||pending||0),wall=start?Math.max(0,(Date.now()-start)/1000):0;return Math.max(ui,wall);}
    _setError(message){if(!text(message)){this.setVariable('Assistant Error','');return;}const d=new Date(),utc=d.toISOString(),local=d.toLocaleString(),secs=this._runtimeSeconds();this.setVariable('Research Error Timestamp',local);this.setVariable('Research Error UTC',utc);this.setVariable('Research Runtime Last Error','['+local+' | '+secs.toFixed(1)+'s] '+text(message));this.setVariable('Assistant Error','['+local+' | '+secs.toFixed(1)+'s] '+text(message));}
        _searchApiKey() { return anySearchCredential(this).key; }

    searchHeaders() {
      const key=this._searchApiKey(),headers={'Content-Type':'application/json'};if(key)headers.Authorization='Bearer '+key;return JSON.stringify(headers);
    }
initialize(){return globalThis.RamoApplication.initialize(this);}
    current(s){if(this.session!==s||s.controller.signal.aborted)throw Error('Request cancelled or timed out.');}
    archiveSearch(packet,scope='search',researchId=''){
      if(!packet||packet.cached||!['web','science'].includes(packet.lane))return;
      const now=packet.checked_at||new Date().toISOString(),row={id:'search_'+Date.now()+'_'+hash(packet.lane+'|'+packet.query+'|'+now),lane:packet.lane,scope,research_id:researchId||'',query:text(packet.query),status:text(packet.status||''),failure_kind:text(packet.failure_kind||''),provider_error:packet.provider_error?providerFailureDetails(packet.provider_error):null,verification:text(packet.verification||''),checked_at:now,result_count:researchArray(packet.sources).length,sources:(packet.sources||[]).map(s=>({title:text(s.title),url:text(s.url),text:text(s.text).slice(0,1800),published:text(s.published||''),kind:text(s.kind||packet.lane),official:!!s.official,score:Number(s.score||0)})).slice(0,12)};
      this.engine.store.transact(d=>{d.searches??=[];d.searches=[...d.searches,row].slice(-60);this.engine.store.log(d,'search archived',row.id,(scope==='research-search'?'Research search: ':'Search: ')+row.query);});
      this.engine.durable?.put('searches',row).catch(()=>{});
    }
    // Compact Hermes-style tool registry. All tools are read-only and optional.
    // A tool call is an action, not a textual !searchapi command.
    _agentTools(s){
      const config=this.harness.settings();if(!config.tools)return [];
      const tools=[];
      if(config.web&&!s.policy?.noWeb){
        if(!s.policy?.noSearch){
        tools.push({type:'function',function:{name:'web_search',description:'Search online for factual information, named things you cannot confidently identify, recent changes, or sources to cite. Searches the actual subject, not wording about an earlier search.',parameters:{type:'object',properties:{query:{type:'string',description:'A focused information retrieval query'},purpose:{type:'string',description:'What you need to verify'},fresh:{type:'boolean',description:'True when the user asks to check again or needs current information; bypass saved search snapshots'}},required:['query']}}});
        tools.push({type:'function',function:{name:'academic_search',description:'Find scholarly publications using OpenAlex. Returns bibliographic metadata and available abstracts, not full paper text. Choose this for literature questions.',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}}});
        }
        tools.push({type:'function',function:{name:'web_read',description:'Read a URL supplied by the user or returned by a tool. Follow next_offset for more, or find a phrase within the page; results are excerpts.',parameters:{type:'object',properties:{url:{type:'string',description:'User-supplied or previously returned URL'},offset:{type:'integer',description:'Character offset, normally next_offset from the previous read'},find:{type:'string',description:'Locate an exact phrase within this page and return surrounding text'}},required:['url']}}});
      }
      tools.push({type:'function',function:{name:'session_read',description:'Recover a full attachment or recorded tool result from THIS conversation by turn number and index. Use offset for additional text.',parameters:{type:'object',properties:{turn:{type:'integer'},kind:{type:'string',enum:['attachment','tool']},index:{type:'integer'},offset:{type:'integer'}},required:['turn','kind','index']}}});
      tools.push({type:'function',function:{name:'chat_note_save',description:'Save a note in THIS conversation only. Use it when the user asks to keep something for this chat. Personal memory that follows the user everywhere is saved with memory_save, which the worker owns.',parameters:{type:'object',properties:{content:{type:'string'},quote:{type:'string'}},required:['content','quote']}}});
      tools.push({type:'function',function:{name:'session_search',description:'Search older messages in THIS chat only. Use when the relevant detail is not in recent conversation context. Does not access other chats or personal memory.',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}}});
      tools.push({type:'function',function:{name:'todo_list',description:'Read this chat task list, or replace it with a validated plan for multi-step work. Task status records progress, not proof of completed actions.',parameters:{type:'object',properties:{todos:{type:'array',items:{type:'object',properties:{id:{type:'string'},content:{type:'string'},status:{type:'string',enum:['pending','in_progress','completed','cancelled']}},required:['id','content','status']}},revision:{type:'integer'}}}}});
      if(config.skills&&this.harness.skills().length)tools.push({type:'function',function:{name:'skill_read',description:'Load a user-created reusable procedure by name from the available skills catalog. Skills do not grant additional tool permissions.',parameters:{type:'object',properties:{name:{type:'string'}},required:['name']}}});
      return tools;
    }
    _agentPageLinks(content,fromURL){
      const excerpt=text(content).slice(0,9000),links=[],seen=new Set();
      for(const match of excerpt.matchAll(/\[([^\]\n]{1,180})\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/g)){
        if(links.length>=32)break;if(match.index>0&&excerpt[match.index-1]==='!')continue;
        const url=validURL(match[2]);if(!url||seen.has(url))continue;seen.add(url);links.push({url,title:match[1],from_url:fromURL});
      }
      return links;
    }
    async _agentTool(s,name,args,discovered){
      this.current(s);
      if(!this._agentTools(s).some(t=>t.function.name===name))return {status:'blocked',error:'Tool is not enabled in this chat.'};
      const query=text(args.query).trim().slice(0,300),url=validURL(args.url),signal=s.controller.signal;
      if(name==='chat_note_save'){
        const content=text(args.content).trim(),quote=text(args.quote).trim();
        if(!content||content.length>2000||!quote||!s.turn.raw.includes(quote))return {status:'error',error:'Supply a concise note and an exact quote from the current user request.'};
        try{
          return this.harness.write(()=>{const c=this.harness.chat();c.savedNotes??=[];if(c.savedNotes.length>=100)throw Error('Chat note limit reached.');const note={id:'note_'+Date.now(),content,quote,request:s.turn.raw,turn:(c.messages||[]).length+1,at:Date.now()};c.savedNotes.push(note);return {status:'saved',id:note.id,scope:'chat'};});
        }catch(e){return {status:'error',error:e.message};}
      }
      if(name==='session_read'){
        const rows=this.engine.store.activeChat()?.messages||[],row=rows[Number(args.turn)-1],item=args.kind==='attachment'?row?.attachments?.[Number(args.index)]:args.kind==='tool'?row?.toolResults?.[Number(args.index)]:null;
        if(!item)return {status:'error',error:'Unknown reference in this conversation.'};
        if(args.kind==='attachment'&&isChatImageAttachment(item))return {status:'read',turn:args.turn,kind:'attachment',index:args.index,images:chatAttachmentImages(item).map(image=>({name:image.name,mimeType:image.mimeType})),content:'Image attachment. The most recent four images are supplied visually with conversation context.'};
        const content=args.kind==='attachment'?text(item.content):JSON.stringify({...item.result,...(item.fullContent?{content:item.fullContent}:{}),imported:!!item.imported}),offset=Math.max(0,Math.floor(Number(args.offset)||0)),end=Math.min(content.length,offset+9000);
        return {status:'read',turn:args.turn,kind:args.kind,index:args.index,content:content.slice(offset,end),excerpt_start:offset,excerpt_end:end,next_offset:end<content.length?end:null,original_characters:content.length};
      }
      if(name==='todo_list'){try{return {status:'ok',...this.harness.tasks(args.todos,args.revision)};}catch(e){return {status:'error',error:e.message};}}
      if(name==='skill_read'){try{return {status:'ok',...this.harness.skill(args.name)};}catch(e){return {status:'error',error:e.message};}}
      if(name==='web_search'||name==='academic_search'){
        if(s.policy?.noWeb)return {status:'blocked',error:'Online search is not available for this private-memory request'};
        if(!query)return {status:'error',error:'Missing search query'};
        const packet=await this.engine.search.search(name==='academic_search'?'science':'web',query,signal,{no_cache:args.fresh===true||refreshQuery(s.turn.raw),purpose:text(args.purpose).slice(0,160)});
        this.current(s);
        if(packet.status==='ok')this.archiveSearch(packet,'agent-chat','');
        for(const source of packet.sources||[]){const url=validURL(source.url);if(url&&!discovered.has(url))discovered.set(url,{...source,_readText:undefined,_readTitle:undefined,read:false});}
        return {status:packet.status,query:packet.query,checked_at:packet.checked_at,cached:!!packet.cached,cache_age_ms:packet.cache_age_ms||0,
          sources:(packet.sources||[]).slice(0,6).map((r,i)=>{
            const academic=name==='academic_search',abstract=academic?text(r.text):'',snippet=academic?abstract||text(r.title):text(r.search_text||r.text);
            return {id:'S'+(i+1),title:text(r.title).slice(0,180),url:r.url,date:r.published||'',snippet:snippet.slice(0,academic?3000:1000),read:false,
              ...(academic?{doi:r.doi||'',openalex_id:r.openalex_id||'',authors:researchArray(r.authors).slice(0,12),year:r.year||null,journal:r.journal||'',is_retracted:!!r.is_retracted,
                evidence_kind:abstract?'abstract':'metadata_only',abstract_available:!!abstract,abstract_characters:abstract.length,abstract_truncated:abstract.length>3000,full_text_retrieved:false}:{})};
          }),
          ...(packet.provider_error?{error:text(packet.provider_error.message||'Search failed')}: {})};
      }
      if(name==='web_read'){
        if(s.policy?.noWeb)return {status:'blocked',error:'Online reading is not available for this private-memory request'};
        if(url&&!discovered.has(url)){
          const rows=this.engine.store.activeChat()?.messages||[],texts=[s.turn.raw,...rows.map(m=>m.user)];
          const supplied=texts.flatMap(t=>text(t).match(/https?:\/\/[^\s<>"']+/g)||[]).map(u=>validURL(u.replace(/[),.;]+$/,'')));
          const known=rows.flatMap(m=>(m.toolResults||[]).flatMap(t=>[t.result?.url,...(t.result?.sources||[]).map(x=>x.url),...(t.name==='web_read'&&t.result?.status==='read'?this._agentPageLinks(t.result.content,t.result.url).map(x=>x.url):[])])).filter(Boolean);
          if([...supplied,...known].some(u=>canonicalCandidateURL(u)===canonicalCandidateURL(url)))discovered.set(url,{url});
        }
        if(!url||!discovered.has(url))return {status:'error',error:'Use a URL supplied by the user or returned by a recorded source.'};
        const source=discovered.get(url),cached=typeof source._readText==='string',readId='read_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8),requestedAt=new Date().toISOString(),readOwner={chat_id:s.chatId,turn_index:s.turn.index,turn_id:s.turn.activity?.id};
        this.reportActivity('read',url,cached?'Requested a saved page excerpt':'Requested page extraction',{...readOwner,read_id:readId,phase:'requested',status:'pending',url,cached,requested_at:requestedAt});
        const outcome=result=>{this.reportActivity('read',url,result.status==='read'?'Returned a readable page excerpt':result.error||'Requested page passage was not found',{...readOwner,read_id:readId,phase:'result',status:result.status,url,cached,characters:result.content?.length||0,requested_at:requestedAt,completed_at:new Date().toISOString()});return result;};
        try{
          let data;
          if(cached)data={url,title:source._readTitle,content:source._readText};
          else{const response=await anySearchRequest(this.engine.transport,this,'extract',buildAnySearchExtractRequest(url),signal,25000);this.current(s);data=researchObject(response?.result?.data);}
          const returned=validURL(data.url||url),content=researchClean(data.content);
          if(returned&&canonicalCandidateURL(returned)!==canonicalCandidateURL(url))return outcome({status:'error',url,cached,error:'Extract returned a different URL'});
          if(!content&&documentNeedsConversion({url})){
            // Unsupported fetched type (PDF/DOCX/XLSX/PPTX/...): convert locally
            // to Markdown so the model never sees the raw binary.
            const converted=await convertDocumentLocal({url},signal);
            if(converted?.ok&&text(converted.markdown).trim()){
              const body=converted.markdown,start=Math.max(0,Math.min(body.length,Math.floor(Number(args.offset)||0))),end=Math.min(body.length,start+9000),excerpt=body.slice(start,end),links=this._agentPageLinks(excerpt,url);
              source._readText=body;source._readTitle=source.title||url;
              discovered.get(url).read=true;
              for(const link of links)if(!discovered.has(link.url))discovered.set(link.url,{url:link.url,title:link.title,discovered_from:url});
              return outcome({status:end>start?'read':'empty',url,title:source._readTitle,content:excerpt,links,excerpt_start:start,excerpt_end:end,next_offset:end<body.length?end:null,original_characters:body.length,truncated:end<body.length||start>0,cached:false,converted_by:'markitdown',ocr_used:converted.ocr_used});
            }
            return outcome({status:'empty',url,cached,error:converted?.error||'No readable text extracted'});
          }
          if(!content)return outcome({status:'empty',url,cached,error:'No readable text extracted'});
          source._readText=content;source._readTitle=text(data.title||source.title);
          discovered.get(url).read=true;
          let offset=Math.max(0,Math.min(content.length,Math.floor(Number(args.offset)||0))),focus={};
          const needle=text(args.find).trim();
          if(needle){const match=new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'iu').exec(content.slice(offset));if(!match)return outcome({status:'not_found',url,original_characters:content.length,cached});const found=offset+match.index;focus={focus_start:found,focus_end:found+match[0].length};offset=Math.max(0,found-1000);}
          const end=Math.min(content.length,offset+9000),excerpt=content.slice(offset,end),links=this._agentPageLinks(excerpt,url);
          for(const link of links)if(!discovered.has(link.url))discovered.set(link.url,{url:link.url,title:link.title,discovered_from:url});
          return outcome({status:end>offset?'read':'empty',url,title:source._readTitle,content:excerpt,links,excerpt_start:offset,excerpt_end:end,next_offset:end<content.length?end:null,original_characters:content.length,truncated:offset>0||end<content.length,cached,...focus,...(focus.focus_end>end?{focus_truncated:true}:{})});
        }catch(e){if(signal.aborted||this.session!==s){outcome({status:'cancelled',url,cached,error:'Page extraction cancelled'});throw e;}return outcome({status:'error',url,cached,error:redactProviderMessage(e.message).slice(0,220)});}
      }
      if(name==='session_search'){
        const lines=researchArray(this.engine.store.activeChat()?.messages),terms=[...new Set(words(query))].filter(x=>x.length>2).slice(0,12);
        if(!terms.length)return {status:'empty',results:[]};
        const ranked=lines.map((m,index)=>{const hay=norm(text(m.user)+' '+text(m.assistant)+' '+JSON.stringify((m.attachments||[]).map(a=>isChatImageAttachment(a)?{name:a.name,images:chatAttachmentImages(a).map(image=>({name:image.name,mimeType:image.mimeType}))}:a))+' '+JSON.stringify(m.toolResults||[])),hits=terms.filter(t=>hay.includes(t)).length;return {m,index,hits};}).filter(x=>x.hits>0).sort((a,b)=>b.hits-a.hits||b.index-a.index).slice(0,5);
        this.reportActivity('recall',query,'Searched messages in the current chat only');
        return {status:ranked.length?'ok':'empty',results:ranked.map(({m,index})=>({turn:index+1,user:text(m.user).slice(0,600),assistant:text(m.assistant).slice(0,900),attachments:(m.attachments||[]).map((a,index)=>({index,name:a.name})),tools:(m.toolResults||[]).map((t,index)=>({index,name:t.name,url:t.result?.url}))}))};
      }
      return {status:'error',error:'Unknown tool'};
    }
    _recordTurnActivity(evt){
      const s=this.session;if(!s?.turn||!evt.chat_id||evt.chat_id!==s.chatId||Number.isInteger(evt.turn_index)&&evt.turn_index!==(s.turn.index??this.engine.store.activeChat().messages.length))return;
      if(!s.turn.activity)s.turn.activity=RamoHarnessCore.createActivity(s.turn.index??this.engine.store.activeChat().messages.length,s.request_started_at_ms||Date.now());
      if(evt.turn_id&&evt.turn_id!==s.turn.activity.id)return;
      RamoHarnessCore.recordActivity(s.turn.activity,evt);
      if(evt.type==='model_thinking_chunk'&&s.attemptStarted&&Date.now()-(s.activitySavedAt||0)>2000){s.activitySavedAt=Date.now();this._saveAgentAttempt(s);}
    }
    _finishTurnActivity(s,status){
      if(!s?.turn?.activity)return;
      if(RamoHarnessCore.finishActivity(s.turn.activity,status))this.researchEvents.emit({type:'turn_end',chat_id:s.chatId,turn_index:s.turn.index,turn_id:s.turn.activity.id,status,at:s.turn.activity.finished_at});
    }
    publishTextArtifact(s){if([5,6,7,8,9,10,11,12,20,21,25,26].includes(s.job?.schema)){const artifact=this.engine.store.data.documents.find(d=>d.id===s.job.artifact?.id);if(artifact){this.workspace??=new TextMemoryWorkspace(this);this.workspace.offerDownload(artifact);}this.checkpoint();return;}if(!s.output?.output_format)return;const researchArtifact=s.output.task!=='answer'||s.route?.lane==='research'||deepResearchReportIntent(s.turn?.raw||'');if(researchArtifact&&!s.job){if(this.engine?.trace)this.engine.trace.artifact_skip='research_output_without_research_job';return;}if(researchArtifact&&s.job&&!s.job.sources?.length){if(this.engine?.trace)this.engine.trace.artifact_skip='research_output_without_sources';return;}const content=text(this.variable('Assistant Answer')).replace(/\n\nSaved source-linked research notes[\s\S]*$/,'').trim();if(!content||/^!/.test(content))return;const refusal=/\b(?:i (?:do not|don't) have|i (?:cannot|can't) (?:make|create|provide|generate)|provided research is about|this evidence is about|no (?:relevant|supporting) evidence|could not (?:research|produce|create))\b/i.test(content);if(researchArtifact&&refusal){if(this.engine?.trace)this.engine.trace.artifact_skip='research_refusal_not_exported';return;}const quality=text(s.job?.synthesis?.quality_state||s.job?.synthesis?.synthesis_status),fallback=s.job&&!researchQualityReady(quality),topic=s.job?.topic||s.output.subject||s.output.topic||'Assistant response',name=(topic.replace(/[^a-z0-9_-]+/ig,'_').slice(0,64)||'Assistant_response')+(fallback?'_Evidence_Fallback':'')+'_'+localCalendarDate()+'.txt',id='generated_'+Date.now()+'_'+hash(content),artifact={id,name,content,updated:new Date().toISOString(),revisions:[],generated:true,status:fallback?'fallback':'complete'};const saved=this.engine.store.transact(d=>{d.documents??=[];if(d.documents.length>=100)throw Error('File storage is full. Download or remove a file in Files first.');d.documents.push(artifact);});if(!saved)throw Error(this.engine.store.error||'Could not save generated TXT.');this.lastArtifact={id,name,status:artifact.status};if(s.job)s.job.artifact=this.lastArtifact;this.workspace??=new TextMemoryWorkspace(this);this.workspace.offerDownload(artifact);}
cancel(){return globalThis.RamoApplication.abort();}
    status(){
      const d=this.engine?.store.data;
      return JSON.stringify({
        version:VERSION,model_lifecycle:this.engine?.model?.lifecycle||{},trace:this.engine?.trace||{},live_research_progress:this.session?.job?.progress||this.engine?.trace?.progress||null,last_artifact:this.lastArtifact||null,synthesis:this.engine?.lastSynthesis||null,active_research:d?.researchState?.active||null,recent_research_contexts:d?.researchState?.recent||[],storage_error:this.engine?.store.error||'',
        memory:{facts:d?.facts?.length||0,history:d?.factHistory?.length||0,entities:d?.entities?.length||0,relations:d?.relations?.filter(r=>r.status==='active').length||0,observations:d?.observations?.length||0,pending:(d?.retainQueue||[]).filter(j=>j.status==='pending'||j.status==='processing').length,stats:d?.memoryStats||{}},
        embedding:{model:this.engine?.embedding?.model?.()||'',status:this.engine?.embedding?.model?.()?(this.engine?.embedding?.disabledReason?'error':'enabled'):'not_installed',error:this.engine?.embedding?.disabledReason||'',stats:this.engine?.embedding?.lastStats||{}},
        model_stats:this.engine?.model?.lastStats||{},memory_worker_error:this.engine?.retainer?.lastError||'',consolidator_error:this.engine?.consolidator?.lastError||''
      });
    }
    evidence(){return JSON.stringify(this.engine?.lastEvidence||{});}
    researchStatus(){return JSON.stringify(this.engine?.store.data.jobs.at(-1)||{});}
    memoryReview(){return JSON.stringify(this.engine?.store.data.review||[]);}
    exportMemory(){return JSON.stringify(this.engine?.store.data||{});}

    async harnessInfo(){await this.initialize();return {settings:this.harness.settings(),branches:this.harness.branches(),tasks:this.harness.tasks(),skills:this.harness.skills(),attempt:this.engine.store.activeChat()?.attempt||null,usage:this.engine.store.activeChat()?.contextUsage||null};}
    async updateHarnessSettings(changes){await this.initialize();if(this.session)throw Error('Wait for generation to finish.');return this.harness.settings(changes);}
    async selectChatBranch(id){await this.initialize();if(this.session)throw Error('Stop generation before switching branches.');this.harness.selectBranch(id);this._restoreChatSurface();}
    async forkChatAt(index){await this.initialize();if(this.session)throw Error('Wait for generation to finish.');const c=this.engine.store.activeChat();if(!Number.isInteger(index)||index<0||index>=c.messages.length)throw Error('Unknown message');const payload={format:'ramo-chat',version:1,chat:{title:(c.title||'Chat')+' · fork',messages:c.messages.slice(0,index+1),harness:this.harness.settings(),savedNotes:(c.savedNotes||[]).filter(n=>Number(n.turn)<=index+1),tasks:[],branches:[],branchId:'original'}};await this.harness.importChat(JSON.stringify(payload));this._restoreChatSurface();}
    async listChatSessions(){await this.initialize();return {active:this.engine.store.data.activeChatId,chats:this.engine.store.listChats().map(c=>({...c,pinned:!!this.engine.store.data.chats.find(x=>x.id===c.id)?.pinned,archived:!!this.engine.store.data.chats.find(x=>x.id===c.id)?.archived})),messages:this.engine.store.activeChat()?.messages||[],busy:!!this.session};}
    _restoreChatSurface(){
      const c=this.engine.store.activeChat(),last=c?.messages?.at(-1)?.assistant||'';
      for(const n of ['Assistant Answer','Final Response','UI_TEXT_OUT','tamai_shell_text_out_v1'])this.setVariable(n,last);
      for(const n of ['UI_TEXT_IN','User_Prompt','Current_Prompt','Conversation_State','Relevant_Memory','Memory_Query','Assistant Query','Assistant Trace'])this.setVariable(n,'');
      this.setVariable('Messages_Array',this.engine.store.data.working.turns.flatMap(t=>[JSON.stringify({role:'user',content:t.user}),JSON.stringify({role:'assistant',content:t.assistant})]));
      this.engine.lastEvidence=null;this.engine.trace={status:'idle',chat_id:c?.id||'main'};
      this.activityPanel?.close();this.activityPanel=null;this.researchEvents.history=[];this.researchEvents.current=null;
      const surface=globalThis.__ramoWorkspaceUIActive;
      if(surface){surface.chatView={active:this.engine.store.data.activeChatId,chats:this.engine.store.listChats(),messages:c?.messages||[]};surface.lastResponse='';surface._setWorkspaceHeader?.();surface._renderHome?.(true);}
    }
    async createChatSession(){await this.initialize();if(this.session)throw Error('Finish the active request before switching chats.');this.engine.retainer.interrupt();this.engine.consolidator.interrupt();const id=this.engine.store.newChat();this._restoreChatSurface();return id;}
    async selectChatSession(id){await this.initialize();if(this.session)throw Error('Finish the active request before switching chats.');this.engine.retainer.interrupt();this.engine.consolidator.interrupt();if(!this.engine.store.switchChat(id))throw Error('Unknown chat');this._restoreChatSurface();return id;}
    async renameChatSession(id,title){await this.initialize();return this.engine.store.renameChat(id,title);}
    async deleteChatSession(id){await this.initialize();if(this.session)throw Error('Finish the active request before deleting chats.');const ok=this.engine.store.deleteChat(id);this._restoreChatSurface();return ok;}
    async editChatMessageAt(index,value){await this.initialize();if(this.session)throw Error('Wait for the active response before editing.');if(!this.engine.store.editChatTurn(index,value))throw Error('Cannot edit this message.');this._restoreChatSurface();return true;}
    async deleteChatMessageAt(index,kind='exchange'){await this.initialize();if(this.session)throw Error('Wait for the active response before deleting.');const result=kind==='reply'?this.engine.store.deleteChatReply(index):this.engine.store.deleteChatTurn(index);if(!result)throw Error('Cannot delete this message.');this._restoreChatSurface();return true;}
    async regenerateChatMessageAt(index){await this.initialize();if(this.session)throw Error('Wait for the active response before regenerating.');const item=this.engine.store.activeChat()?.messages?.[index];if(!item?.user)throw Error('Unknown message.');const prompt=item.user,attachment=item.attachments?.[0];if(!this.engine.store.deleteChatTurn(index))throw Error('Cannot regenerate this message.');this._restoreChatSurface();if(attachment)this.pendingDocument=v33Clone(attachment);return this.askAI({TEXT:prompt});}
    async setLiveThinking(enabled){this.liveThinking=!!enabled;this._storageSet('RAMO_LIVE_CHAT_THINKING',this.liveThinking?'1':'0');return this.liveThinking;}
    clearContext(){if(this.engine&&!this.session){this.engine.conversation.reset();this.engine.store.save();this._restoreChatSurface();}}
    async indexDocument(args){try{await this.initialize();if(!this.engine||Number(this.variable('Engine Ready'))!==1)throw Error('Document storage is unavailable.');const content=text(args.CONTENT),name=text(args.NAME)||'uploaded.txt';if(!content.trim())return;this.workspace??=new TextMemoryWorkspace(this);const savedName=this.workspace.filename(name),id=this.workspace.saveDoc('',savedName,content),doc=this.engine.store.data.documents.find(x=>x.id===id),chunks=this.engine.documents.chunks(doc).length;this.setVariable('Attached Text File','');this.setVariable('UI_TEXT_OUT','Saved '+savedName+' to the document library ('+content.length.toLocaleString()+' characters, '+chunks+' searchable passages). Ask a question about it or open Files to edit it.');}catch(e){this.setVariable('UI_TEXT_OUT','Document import failed: '+e.message);}}
    async attachText(){try{this.workspace??=new TextMemoryWorkspace(this);await this.workspace.chooseAttachment();}catch(e){this.setVariable('UI_TEXT_OUT','File attachment failed: '+e.message);}}
    clearAttachment(){this.pendingDocument=null;this.setVariable('Attached Text File','');this.setVariable('UI_TEXT_OUT','Text attachment cleared.');}
    async openFiles(){try{this.workspace??=new TextMemoryWorkspace(this);await this.workspace.open('files');}catch(e){this.setVariable('UI_TEXT_OUT',e.message);}}
    async openMemories(){try{this.workspace??=new TextMemoryWorkspace(this);await this.workspace.open('facts');}catch(e){this.setVariable('UI_TEXT_OUT',e.message);}}
askAI(args){return globalThis.RamoApplication.prompt(this,args.TEXT);}
    answerText(){return text(this.variable('Final Response')||this.variable('Assistant Answer')||this.variable('UI_TEXT_OUT'));}
    lastError(){return text(this.variable('Assistant Error')||this.engine?.store.error||'');}
    async rememberText(args){await this.initialize();if(this.engine.store.data.activeChatId!=='main')throw Error('Personal memory learning is limited to Main; switch to Main to save global memories.');const value=text(args.TEXT).trim();if(!value)return;this.workspace??=new TextMemoryWorkspace(this);const count=this.workspace.addFacts(value);this.setVariable('UI_TEXT_OUT',count?'Memory saved.':'That memory is already saved.');}
    async recallText(args){
      await this.initialize();if(this.engine.store.data.activeChatId!=='main')return 'Global personal memory is disabled in separate chats.';const q=text(args.QUERY).trim();if(!q)return '';
      const packet=await this.engine.recall({raw:q,effective:q,entity:'',additional:false},null);
      const facts=(packet.facts||[]).slice(0,8).map(f=>f.content),episodes=(packet.episodes||[]).slice(0,3).map(e=>e.user);
      return [...facts,...episodes].join('\n')||'No matching saved memory.';
    }
    async openHub(){try{this.workspace??=new TextMemoryWorkspace(this);await this.workspace.open('overview');}catch(e){this.setVariable('UI_TEXT_OUT',e.message);}}
    async openHistory(){try{this.workspace??=new TextMemoryWorkspace(this);await this.workspace.open('history');}catch(e){this.setVariable('UI_TEXT_OUT',e.message);}}
    async openResearch(){try{this.workspace??=new TextMemoryWorkspace(this);await this.workspace.open('knowledge');}catch(e){this.setVariable('UI_TEXT_OUT',e.message);}}
    reportSearchResults(query,items,meta={}){
      // Publish only returned provider records. Never expose API-key configuration as source data.
      const safeText=(value,max)=>text(value||'').replace(/([?&](?:api[_-]?key|access[_-]?token|token|secret|password|authorization)=)[^&#\s]+/gi,'$1[hidden]').slice(0,max);
      const safeURL=value=>{try{const u=new URL(text(value));if(!/^https?:$/.test(u.protocol))return '';u.username='';u.password='';for(const k of [...u.searchParams.keys()])if(/key|token|secret|pass|auth|signature|credential/i.test(k))u.searchParams.set(k,'[hidden]');return u.href.slice(0,1200);}catch{return '';}};
      const sources=researchArray(items).slice(0,12).map(r=>({title:safeText(r.title||r.display_name||'Source',220),url:safeURL(r.url||r.doi||''),snippet:safeText(r.snippet||r.search_text||r.text||r.content,520),published:safeText(r.published||r.published_at||r.provider_date||'',55)})).filter(r=>r.url&&r.title);
      const owner=meta.activity_owner||{chat_id:this.session?.chatId||null,turn_index:this.session?.turn?.index,turn_id:this.session?.turn?.activity?.id};
      this.researchEvents.emit({type:'search_results',...owner,at:new Date().toISOString(),query:safeText(query,400),sources,count:sources.length,status:safeText(meta.status||(sources.length?'ok':'no_evidence'),40),provider:safeText(meta.provider||'',40),cached:!!meta.cached,error:safeText(meta.error||'',180)});
    }
    reportActivity(kind,message,why='',details={}){this.researchEvents.emit({type:'activity',kind,message,why,...details,chat_id:Object.prototype.hasOwnProperty.call(details,'chat_id')?details.chat_id:this.session?.chatId||null,turn_index:Object.prototype.hasOwnProperty.call(details,'turn_index')?details.turn_index:this.session?.turn?.index,turn_id:Object.prototype.hasOwnProperty.call(details,'turn_id')?details.turn_id:this.session?.turn?.activity?.id,at:new Date().toISOString()});}
    async openResearchActivity(){try{this.activityPanel??=new ResearchActivityPanel(this);await this.activityPanel.open();}catch(e){this.setVariable('UI_TEXT_OUT',e.message);}}
    modelName(){return text(this.variable('Assistant Model')||globalThis.__ramoModelRegistry?.find?.(profile=>profile.tier==='fast')?.model||'');}
    setModel(args){if(this.session)throw Error('Wait for generation to finish.');const value=text(args.MODEL).trim();if(!RamoHarnessCore.allowedModel(value))throw Error('Choose a valid model identifier.');if(value)this.setVariable('Assistant Model',value);}
    ollamaURL(){return text(this.variable('Ollama Chat URL')||'http://127.0.0.1:11434/api/chat');}
    setOllamaURL(args){let value=text(args.URL).trim();if(!value)return;try{const u=new URL(value);if(!/^https?:$/.test(u.protocol))throw Error();let path=u.pathname.replace(/\/+$/,'');if(!/\/api\/chat$/i.test(path))path=(path||'')+'/api/chat';u.pathname=path;u.search='';u.hash='';this.setVariable('Ollama Chat URL',u.href.replace(/\/api\/chat\/?$/,'/api/chat'));this.engine?.transport&&(this.engine.transport.remoteOllamaUntil=0);}catch(_){throw Error('Enter a valid http:// or https:// Ollama address.');}}
    remoteOllamaURL(){return text(this.variable('Remote Ollama URL')||'');}
    setRemoteOllamaURL(args){let value=text(args.URL).trim();if(!value){this.setVariable('Remote Ollama URL','');this.engine?.transport&&(this.engine.transport.remoteOllamaUntil=0);return;}try{const u=new URL(value);if(!/^https?:$/.test(u.protocol))throw Error();let path=u.pathname.replace(/\/+$/,'');if(!/\/api\/chat$/i.test(path))path=(path||'')+'/api/chat';u.pathname=path;u.search='';u.hash='';this.setVariable('Remote Ollama URL',u.href.replace(/\/api\/chat\/?$/,'/api/chat'));this.engine?.transport&&(this.engine.transport.remoteOllamaUntil=0);}catch(_){throw Error('Enter a valid http:// or https:// remote bridge address.');}}
    ollamaRoute(){return text(this.variable('Ollama Route')||this.engine?.transport?.lastOllamaRoute||'auto');}
    async ollamaStatus(){try{await this.initialize();const chat=this.ollamaURL(),url=chat.replace(/\/api\/chat(?:[/?#].*)?$/i,'/api/tags'),result=await this.engine.transport.get(url,{},null,5000),names=researchArray(result?.models).map(m=>text(m?.name||m?.model)),target=this.modelName(),tagged=target.includes(':'),base=target.split(':')[0],installed=names.some(n=>n===target||(!tagged&&n.split(':')[0]===base)),route=this.ollamaRoute();return installed?'Connected via '+route+' — model ready':'Connected via '+route+' — model not installed';}catch(e){return 'Not connected — '+e.message;}}
    memoryEmbeddingModel(){return this.engine?.embedding?.model?.()||text(this._storageGet(MEMORY_EMBED_MODEL_STORAGE)||'');}
    async setMemoryEmbeddingModel(args){
      await this.initialize();const value=text(args.MODEL).trim();this.engine.embedding.setModel(value);await this.engine.embedding.clear();
      this.setVariable('UI_TEXT_OUT',value?'Semantic memory model set to '+value+'. Run re-index semantic memory to build vectors.':'Semantic memory disabled.');
    }
    async reindexSemanticMemory(){
      await this.initialize();if(this.session)throw Error('Wait for the current answer to finish.');const model=await this.engine.embedding.detect();if(!model)throw Error('No embedding model is configured or installed in Ollama.');
      const c=new AbortController(),before=text(this.variable('Core Activity')||'READY');this.setVariable('Core Activity','INDEXING MEMORY');
      try{const n=await this.engine.embedding.reindexAll(c.signal);this.setVariable('UI_TEXT_OUT','Semantic memory indexed '+n+' memories with '+model+'.');}
      finally{this.setVariable('Core Activity',before==='READY'?'READY':before);}
    }
    async processMemoryQueue(){await this.initialize();if(this.session)throw Error('Wait for the current answer to finish.');await this.engine.retainer.flush();this.setVariable('UI_TEXT_OUT','Pending memory learning processed.');}
    async consolidateMemory(){await this.initialize();if(this.session)throw Error('Wait for the current answer to finish.');const ids=await this.engine.consolidator.run(true);this.setVariable('UI_TEXT_OUT',ids.length?'Learned '+ids.length+' higher-level observation'+(ids.length===1?'':'s')+'.':'No new stable observation was supported yet.');}
    memoryStats(){const d=this.engine?.store.data;return JSON.stringify({facts:d?.facts?.length||0,history:d?.factHistory?.length||0,entities:d?.entities?.length||0,relations:d?.relations?.filter(r=>r.status==='active').length||0,observations:d?.observations?.length||0,queue:d?.retainQueue||[],stats:d?.memoryStats||{},embedding_model:this.engine?.embedding?.model?.()||'',embedding_error:this.engine?.embedding?.disabledReason||''});}
    counts(){
      const d=this.engine?.store.data;
      return JSON.stringify({memories:d?.facts?.length||0,historical_memories:d?.factHistory?.length||0,entities:d?.entities?.length||0,relations:d?.relations?.filter(r=>r.status==='active').length||0,observations:d?.observations?.length||0,pending_learning:(d?.retainQueue||[]).filter(j=>j.status==='pending'||j.status==='processing').length||0,chats:d?.journal?.length||0,files:d?.documents?.length||0,research:d?.knowledge?.length||0,research_records:(d?.researchRecords||[]).filter(r=>r.status==='active').length,saved_searches:d?.searches?.length||0});
    }
  }
export {AssistantExtension};
