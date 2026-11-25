import {requestText,freshQuery,refreshQuery,requiresDeepResearch,researchRequest,exportRequest} from './helpers.js';

class Router {
    classify(turn){
      const effective=requestText(turn.effective),exported=exportRequest(effective),q=exported.topic,deepReport=requiresDeepResearch(effective),command=q.match(/^!(memories|searchapi|sciapi)\s+([^\r\n]+)$/i);
      // Restrict remote capabilities by the requested operation, independently of the subject.
      const noWeb=/\b(?:do not|don't|never)\s+(?:(?:search|look up)(?:\s+the web)?(?:\s+again)?\s+(?:or|and)\s+)?(?:browse|use\s+(?:the\s+)?(?:web|internet)|access\s+(?:the\s+)?(?:web|internet))\b|\bwithout\s+(?:browsing|(?:the\s+)?(?:internet|web)(?:\s+access)?)\b|\bno\s+(?:browsing|(?:internet|web)\s+access)\b|\bno\s+(?:internet|web)(?=\s*(?:[.!;,]|$))|\bweb\s*(?:is\s*)?(?:off|disabled)\b/i.test(effective);
      const noSearch=noWeb||/\b(?:do not|don't|never)\s+search\b|\bwithout\s+searching\b|\bno\s+(?:more\s+)?(?:web\s+)?search(?:ing|es)?\b/i.test(effective);
      const privateNeed=researchRequest(effective).personal||/\b(?:do i (?:like|prefer|own|have)|did i|where (?:do|did) i|what (?:is|was) my|what (?:have|did) (?:i|we)|who (?:is|was) my|my .+? (?:layout|decision|preference))\b/i.test(q)||/\b(?:my (?:best friend|friend|brother|sister|partner|mother|father|roommate|dog|cat|pet|name|address|birthday|favorite|password)|our (?:decision|conversation)|told you|we (?:decided|agreed|discussed)|what did we|what (?:were|are) we talking|what.+(?:about me|do you remember)|know about|remember about)\b/i.test(q)||/\b(?:what|where|when|who)\b.*\b(?:i live|i work|i bought|my .+? name|decide.+earlier)\b/i.test(q);
      const reuseSearch=!!turn.reuseSearch,explicit=refreshQuery(q),question=/\?|^(?:what|who|where|when|why|how|which|tell|find|search|look|check|can|could|do|did|have|list|latest|recent|current|research|learn|investigate|create|write|generate|make|conduct|!)/i.test(q);
      const research=researchRequest(effective);
      const science=/\b(?:papers?|studies|academic|scientific evidence|peer.reviewed|doi|arxiv)\b/i.test(q)&&! /^(?:explain|define|what is (?:a |an )?)/i.test(q);
      const creative=/^(?:write|rewrite|translate|summarize|brainstorm|give me ideas|help me organize)\b/i.test(q);
      const math=/^(?:what is|calculate|solve|evaluate)\s+[\d\s+*/().^%=−-]+[?.]*$/i.test(q);
      const factual=/^(?:what (?:is|are|does|did)|who|where|when|which|how (?:many|much|old|long)|tell me about|list)\b/i.test(q)&&!math;
      const stableDefinition=/^(?:what (?:is|are)|explain|define|tell me about)\b/i.test(q)&&!freshQuery(q);
      let lane='direct';
      if(command)lane=({memories:'memory',searchapi:'web',sciapi:'science'})[command[1].toLowerCase()];
      else if(deepReport||exported.task!=='answer')lane='research';
      else if(research.matched&&!research.personal)lane='research';
      else if(privateNeed&&(question||research.matched))lane='memory';
      else if(reuseSearch)lane=science?'science':'web';
      else if(explicit&&!creative||question&&science)lane=science?'science':'web';
      else if(question&&!creative&&(freshQuery(q)||(factual&&!stableDefinition)))lane='web';
      if(privateNeed&&!/^remember\b/i.test(q)&&lane!=='direct'&&lane!=='research')lane='memory';
      if(noSearch&&['web','science','research'].includes(lane))lane='direct';
      return {lane,noWeb,noSearch,privateNeed,reuseSearch,explicit:!!command||explicit||deepReport||research.matched,query:command?.[2]||research.topic||q,learn:research.matched||deepReport,deepReport,output_format:exported.output_format,route_reason:lane==='research'?(deepReport?'deep_report_intent':'research_intent'):lane};
    }
    query(input,lane){let q=requestText(input).replace(/^[\s.,;:!?]+/,'').replace(/^!(?:memories|sciapi|searchapi)\s+/i,'');for(let i=0;i<3;i++)q=q.replace(/^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:search(?: the web)?(?: for)?|look up|look online(?: for)?|find(?: me)?|tell me|show me|research|learn about|what(?:'s| is)|which is)\s+/i,'');q=q.replace(/^(?:recent |latest )?(?:scientific |academic )?(?:papers?|studies) (?:on|about|testing|evaluating)\s+/i,'').replace(/[?!]+$/,'').replace(/\s+/g,' ').trim();if(!refreshQuery(input))q=q.replace(/\s+again$/i,'').trim();if(lane==='science')q=q.replace(/\brag\b/ig,'retrieval augmented generation').replace(/\bslms?\b/ig,'small language models');if(lane==='web'&&/latest.*(?:release|version)/i.test(q)&&! /official/i.test(q))q+=' official';return q.slice(0,300);}
  }
export {Router};
