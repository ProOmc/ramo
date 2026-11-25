import {DurableResearchStore} from './durable-research-store.js';
import {StateStore} from './state-store.js';
import {EpisodeArchive} from './episode-archive.js';
import {ConversationManager} from './conversation-manager.js';
import {MemoryService} from './memory-service.js';
import {DocumentService} from './document-service.js';
import {ResearchLibrary} from './research-library.js';
import {Router} from './router.js';
import {Transport} from './transport.js';
import {SearchService} from './search-service.js';
import {ModelService} from './model-service.js';
import {MemoryEmbeddingService} from './memory-embedding-service.js';
import {MemoryRetainer} from './memory-retainer.js';
import {MemoryConsolidator} from './memory-consolidator.js';
import {text,norm,recall,validURL,predicateKey} from './helpers.js';

class AssistantEngine {
constructor(host,storage){this.host=host;this.durable=new DurableResearchStore();this.store=new StateStore(storage);this.store.attachDurable(this.durable);this.archive=new EpisodeArchive();this.conversation=new ConversationManager(this.store);this.memory=new MemoryService(this.store);this.documents=new DocumentService(this.store);this.researchLibrary=new ResearchLibrary(this.store);this.transport=new Transport(host);this.search=new SearchService(host,this.transport,new Router());this.model=new ModelService(host,this.transport);this.embedding=new MemoryEmbeddingService(host,this.store,this.transport);this.retainer=new MemoryRetainer(host,this.store,this.memory,this.model,this.embedding);this.consolidator=new MemoryConsolidator(host,this.store,this.memory,this.model,this.embedding);this.trace={status:'idle'};}
    async recall(turn,signal){
      if(this.host.session?.chatMemoryIsolation)return {schema:2,status:'no_evidence',lane:'memory',facts:[],episodes:[],knowledge:[],documents:[],sources:[],retrieval_trace:{blocked:'chat_isolation'}};
      let semantic=[];try{semantic=await this.embedding.search(turn.effective,14,signal);}catch(e){if(signal?.aborted)throw e;}
      const evidence=this.memory.lookup(turn,semantic);evidence.documents=this.documents.search(turn.effective,5);if(evidence.documents.length)evidence.status='ok';
      if(/\b(?:earlier|before|decide|decided|discuss|told|talking|previous|used to|formerly)\b/i.test(turn.effective)){
        const archived=await this.archive.search(turn.effective);evidence.episodes=[...new Map([...evidence.episodes,...archived].map(r=>[norm(r.user),r])).values()].slice(-6);if(evidence.episodes.length)evidence.status='ok';
      }
      evidence.semantic_status=this.embedding.model()?this.embedding.disabledReason?'unavailable':'enabled':'not_installed';
      evidence.episodes=(evidence.episodes||[]).filter(e=>{
        if((this.store.data.forgottenEvidence||[]).some(f=>f.episodeId===e.id||f.quote&&norm(e.user).includes(f.quote)))return false;
        const parsed=this.memory._fastParse(text(e.user).replace(/^remember(?: that)?\s+/i,''));
        return !parsed||!(this.store.data.forgotten||[]).includes(norm(parsed.subject)+'|'+predicateKey(parsed.predicate)+'|'+norm(parsed.object));
      });
      evidence.status=(evidence.facts.length||evidence.episodes.length||evidence.knowledge.length||evidence.documents.length)?'ok':'no_evidence';
      return evidence;
    }
    dedup(sources){const seen=new Set();return sources.filter(s=>{const key=validURL(s.url)||norm(s.title);if(!key||seen.has(key))return false;seen.add(key);return true;}).map((s,i)=>({...s,id:'S'+(i+1)}));}
  }
export {AssistantEngine};
