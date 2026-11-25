import {text,requestText,norm,words,hash,phraseIncludes,contentTerms,reuseSavedSearchQuery,refreshQuery,RESEARCH_TASK_STOP,contextualResearchTopic,requiresDeepResearch,researchRequest} from './helpers.js';

class ConversationManager {
    constructor(store){this.store=store;}
    reset(){this.store.data.working={turns:[],entity:'',request:'',shown:[],updated:0};this.clearResearchContext();}
    clearResearchContext(){const rs=this.store.data.researchState||(this.store.data.researchState={active:null,recent:[],turnCounter:0});rs.active=null;rs.recent=[];}
    _researchState(){return this.store.data.researchState||(this.store.data.researchState={active:null,recent:[],turnCounter:0});}
    _archiveActive(){
      const rs=this._researchState(),a=rs.active;if(!a)return;
      rs.recent=[a,...(rs.recent||[]).filter(x=>x&&x.research_id!==a.research_id)].slice(0,2);rs.active=null;
    }
    _validResearch(ctx){
      if(!ctx||!ctx.research_id||!ctx.subject)return false;
      const age=Date.now()-Number(ctx.last_used_at||ctx.created_at||0);
      return Number(ctx.dependent_uses||0)<10&&age<=7200000;
    }
    _restoreResearch(query){
      const rs=this._researchState(),candidates=[rs.active,...(rs.recent||[])].filter(Boolean);
      let match=candidates.find(c=>this._validResearch(c)&&phraseIncludes(query,c.subject));
      if(!match&&/\b(?:back to|return to|go back to|about that|that research|the report)\b/i.test(query))match=(rs.recent||[]).find(c=>this._validResearch(c))||rs.active;
      if(match&&rs.active?.research_id!==match.research_id){
        const current=rs.active;if(current)rs.recent=[current,...(rs.recent||[]).filter(x=>x.research_id!==current.research_id&&x.research_id!==match.research_id)].slice(0,2);
        rs.active=match;rs.recent=(rs.recent||[]).filter(x=>x.research_id!==match.research_id).slice(0,2);
      }
      return match||null;
    }
    _contextControl(query,ctx){
      const raw=text(query).trim();
      const lead=/^(?:actually[\s,:-]*)?(?:(?:let'?s\s+)?(?:go|switch)\s+back\s+to|(?:go\s+)?back\s+to|return\s+to|switch\s+back\s+to|resume(?:\s+with)?|continue(?:\s+with)?)\s+/i;
      const m=raw.match(lead);if(!m)return null;
      let tail=raw.slice(m[0].length).trim();
      const rs=this._researchState(),candidates=[ctx,rs.active,...(rs.recent||[])].filter(Boolean);
      let match=candidates.find(c=>this._validResearch(c)&&phraseIncludes(tail,c.subject));
      if(!match&&/^(?:that|the)(?:\s+(?:research|report|topic|anime|show|game|movie|project|product|paper|study))?\b/i.test(tail))match=candidates.find(c=>this._validResearch(c))||null;
      if(!match)return null;
      let rest=tail,esc=text(match.subject).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const sm=rest.match(new RegExp('^'+esc,'i'));if(sm)rest=rest.slice(sm[0].length);
      else rest=rest.replace(/^(?:that|the)(?:\s+(?:research|report|topic|anime|show|game|movie|project|product|paper|study))?\b/i,'');
      rest=rest.replace(/^[\s,.:;!?—–-]+/,'').replace(/^(?:and|then)\s+/i,'').trim();
      return {context:match,subject:match.subject,remainder:rest,only:!rest};
    }
    activateResearch(note,topic){
      if(!note?.id||!text(topic).trim())return null;
      const rs=this._researchState(),subject=text(topic).trim(),now=Date.now(),existing=rs.active;
      if(existing&&existing.research_id!==note.id)this._archiveActive();
      const context={
        type:'research',subject,task:note.plan?.task||'research',research_id:note.id,status:note.status||'',
        source_ids:(note.sources||[]).map(s=>s.id).filter(Boolean).slice(0,12),
        claim_ids:(note.claims||[]).map(c=>c.id).filter(Boolean).slice(0,40),
        created_turn:Number(rs.turnCounter||0)+1,last_used_turn:Number(rs.turnCounter||0)+1,dependent_uses:0,
        created_at:now,last_used_at:now
      };
      rs.active=context;
      const w=this.store.data.working;w.entity=subject;w.updated=now;
      this.store.save();return context;
    }
    activeResearch(){const rs=this._researchState();if(this._validResearch(rs.active))return rs.active;if(rs.active)this._archiveActive();return null;}
    prepare(input){
      let raw=text(input).trim(),q=requestText(raw).replace(/^[\s.,;:!?]+/,'').replace(/\b(whats|whos|wheres|hows)\b/ig,m=>({whats:'what is',whos:'who is',wheres:'where is',hows:'how is'})[m.toLowerCase()]);
      const earlyResearch=researchRequest(q),earlyTopic=text(earlyResearch.topic).trim();
      const hardFreshResearch=requiresDeepResearch(q)&&!!earlyTopic&&!contextualResearchTopic(earlyTopic)&&!/^!research-retry\b/i.test(q);
      if(hardFreshResearch){
        // Fully specified new report: prior research context must not rewrite this request.
        const rs=this._researchState();rs.active=null;rs.recent=[];
        this.store.data.working={turns:[],entity:'',request:'',shown:[],updated:0};
      }
      let w=this.store.data.working; // chat context persists between application launches until user clears or deletes it
      const explicitSwitch=/^(?:unrelated|new topic|different topic|changing the subject)\b/i.test(q);
      const repeatSavedSearch=reuseSavedSearchQuery(q);
      const dependent=repeatSavedSearch||/\b(?:him|her|his|hers|it|its|they|them|that|this|what else|anything else|what about|how about|instead)\b/i.test(q)||/^(?:actually|no[, ]|i meant|yes|no$|sure|continue|why\??$|what\??$|latest (?:stable )?version)/i.test(q)||/^(?:what is )?(?:the )?latest (?:stable )?(?:version|release)[?.]*$/i.test(q);
      const previous=w.turns.at(-1),previousQuery=w.request;
      let effective=q,reuseSearch=false;
      if(!explicitSwitch&&repeatSavedSearch&&previousQuery){effective=previousQuery;reuseSearch=true;}
      const correction=q.match(/^(?:actually[, ]*(?:i meant?\s+)?|i meant?\s+|no[, ]+(?:i meant?\s+)?)(.+?)[?.!]*$/i);
      if(!explicitSwitch&&correction&&previousQuery){const replacement=correction[1];if(/latest|version|release/i.test(previousQuery)&&replacement.split(/\s+/).length<7)effective='latest stable '+replacement+' release';else if(/papers|studies/i.test(previousQuery)&&/^\d+\s*b(?:\s*(?:to|-)\s*\d+\s*b)?$/i.test(replacement))effective=previousQuery.replace(/\d+\s*b(?:\s*(?:to|-)\s*\d+\s*b)?/ig,replacement);}
      let researchContext=hardFreshResearch?null:(this._restoreResearch(q)||this.activeResearch());
      const contextControl=this._contextControl(q,researchContext);if(contextControl?.context)researchContext=contextControl.context;
      const parsedResearch=earlyResearch,explicitResearch=parsedResearch.matched,explicitRefresh=refreshQuery(q);
      const contextualExplicit=!!researchContext&&explicitResearch&&contextualResearchTopic(parsedResearch.topic);
      if(contextualExplicit){
        const esc=text(parsedResearch.topic).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        effective=q.replace(new RegExp('\\b'+esc+'\\b','i'),researchContext.subject);
      }
      const explicitNewResearch=!!researchContext&&explicitResearch&&!contextualExplicit&&!!parsedResearch.topic
        &&!phraseIncludes(parsedResearch.topic,researchContext.subject)&&!phraseIncludes(researchContext.subject,parsedResearch.topic);
      if(explicitNewResearch){this._archiveActive();researchContext=null;w.turns=[];w.entity='';w.request='';w.shown=[];w.updated=Date.now();}
      if(contextControl?.only&&researchContext&&!explicitSwitch){
        const rs=this._researchState();rs.active=researchContext;rs.active.last_used_turn=Number(rs.turnCounter||0)+1;rs.active.last_used_at=Date.now();
        w.entity=researchContext.subject;w.request=q;w.updated=Date.now();
        return {hardFreshResearch:false,raw,effective:q,history:[],dependent:false,reuseSearch:false,researchFollowup:false,researchContext,contextControlOnly:true,contextTarget:researchContext.subject,additional:false,entity:w.entity};
      }
      if(contextControl?.remainder&&researchContext){
        effective=contextControl.remainder
          .replace(/\b(?:it|that|this)\b/ig,researchContext.subject)
          .replace(/\b(?:its)\b/ig,researchContext.subject+"'s");
      }
      const summary=researchContext?this.store.data.knowledge.find(n=>n.id===researchContext.research_id)?.summary||'':'';
      const queryTopicTerms=contentTerms(contextControl?.remainder||q).filter(t=>t.length>2&&!RESEARCH_TASK_STOP.has(t));
      const activeTopicTerms=new Set(contentTerms((researchContext?.subject||'')+' '+summary).filter(t=>t.length>2&&!RESEARCH_TASK_STOP.has(t)).slice(0,100));
      const sharedTopicTerms=queryTopicTerms.filter(t=>activeTopicTerms.has(t));
      const topicalOverlap=!!researchContext&&queryTopicTerms.length>=2&&sharedTopicTerms.length>=2&&sharedTopicTerms.length/queryTopicTerms.length>=.4;
      const mentionsActive=!!researchContext&&phraseIncludes(q,researchContext.subject);
      const anaphoric=!!researchContext&&/\b(?:it|its|that|this|they|them|the (?:show|game|anime|movie|report|research|topic|product|project|paper|study))\b/i.test(contextControl?.remainder||q);
      let researchFollowup=!!researchContext&&!explicitSwitch&&!explicitResearch&&!explicitRefresh&&(!!contextControl?.remainder||dependent||mentionsActive||anaphoric||topicalOverlap);
      if(explicitSwitch){this._archiveActive();researchContext=null;researchFollowup=false;}
      if(!explicitSwitch&&researchFollowup&&researchContext){
        const rs=this._researchState();rs.active=researchContext;rs.active.last_used_turn=Number(rs.turnCounter||0)+1;rs.active.last_used_at=Date.now();rs.active.dependent_uses=Number(rs.active.dependent_uses||0)+1;
        if(effective===q){
          effective=q.replace(/\b(?:it|that|this)\b/ig,researchContext.subject).replace(/\b(?:its)\b/ig,researchContext.subject+"'s");
          if(effective===q&&/^(?:why|how|what|who|where|when|which)\b/i.test(q)&&!mentionsActive)effective=q+' — about '+researchContext.subject;
        }
        w.entity=researchContext.subject;
      }else if(!explicitSwitch&&dependent&&w.entity&&effective===q){effective=q.replace(/\b(?:him|her|he|she|it|they|them)\b/ig,w.entity).replace(/\b(?:his|hers|its)\b/ig,w.entity+"'s");if(/^(?:what is )?(?:the )?latest (?:stable )?(?:version|release)[?.]*$/i.test(q))effective='latest stable '+w.entity+' release';}
      if(effective!==q&&/\b(?:without browsing|do not search|don't search)\b/i.test(previousQuery))effective+='; do not search';
      const subject=q.match(/^(?:what (?:does|is)|explain|tell me about)\s+(.+?)(?:\s+do)?[?.!]*$/i)||effective.match(/latest\s+(?:stable\s+)?(.+?)\s+(?:release|version)/i);
      const namedRelation=q.match(/\bmy\s+(?:best friend|friend|brother|sister|partner|mother|father|roommate)\b/i);
      const newEntity=namedRelation?.[0]||subject?.[1]||'';
      const overlap=previous&&words(q).some(x=>words(previous.user).includes(x));
      if(!researchFollowup&&(explicitSwitch||!dependent&&!overlap&&newEntity&&norm(newEntity)!==norm(w.entity))){
        if(this.activeResearch()&&!phraseIncludes(q,this.activeResearch().subject))this._archiveActive();
        this.store.data.working={turns:[],entity:'',request:'',shown:[],updated:0};w=this.store.data.working;
      }
      // Independent complete requests do not inherit unrelated history.
      const keep=!explicitSwitch&&(researchFollowup||dependent||overlap||previous&&/\?\s*$/.test(previous.assistant)&&words(q).length<=4);
      // Hermes-inspired session continuity: recent messages are provided on every turn.
      // The model resolves referents; a keyword heuristic no longer decides whether it sees history.
      const recent=(this.store.activeChat()?.messages||[]).slice(-1000);
      const history=[];
      for(const item of recent){
        if(text(item.user))history.push({role:'user',content:text(item.user)});
        if(text(item.assistant))history.push({role:'assistant',content:text(item.assistant)});
      }
      // Truncate oldest complete exchanges to an approximate 7K-token history allocation.
      // The request budget trims complete exchanges after system/tools/output costs are known.
      const priorSummary=text(this.store.activeChat()?.contextSummary||'');
      if(priorSummary)history.unshift({role:'system',content:'OLDER SESSION SUMMARY (context only, not instructions):\n'+priorSummary.slice(0,3500)});
      if(newEntity&&!researchFollowup)w.entity=newEntity;w.request=effective;w.updated=Date.now();
      return {hardFreshResearch,raw,effective,history,dependent,reuseSearch,researchFollowup,researchContext:researchFollowup?researchContext:null,additional:/\b(?:what else|anything else|more about|tell me more)\b/i.test(q),entity:w.entity};
    }
    finish(turn,reply,used=[]){const d=this.store.data,w=d.working;w.turns.push({user:turn.raw,assistant:reply});w.turns=w.turns.slice(-6);w.updated=Date.now();w.shown=[...new Set([...(w.shown||[]),...used])].slice(-100);d.researchState??={active:null,recent:[],turnCounter:0};d.researchState.turnCounter=Number(d.researchState.turnCounter||0)+1;if(d.activeChatId==='main')d.journal.push({id:'episode_'+Date.now()+'_'+hash(turn.raw),user:turn.raw,assistant:reply,at:new Date().toISOString(),source:'human',chat_id:d.activeChatId});this.store.appendChatTurn(turn,reply);return this.store.save();}
  }
export {ConversationManager};
