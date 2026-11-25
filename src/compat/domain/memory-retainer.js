import {text,MEMORY_SCHEMA,MEMORY_SYSTEM} from './helpers.js';

class MemoryRetainer {
    constructor(host,store,memory,model,embedding){this.host=host;this.store=store;this.memory=memory;this.model=model;this.embedding=embedding;this.running=false;this.timer=null;this.controller=null;this.currentJob=null;this.lastError='';for(const j of this.store.data.retainQueue||[])if(j.status==='processing')j.status='pending';this.store.save();}
    shouldRetain(input){
      const q=text(input).trim();if(q.length<8||/^(?:thanks|thank you|ok(?:ay)?|cool|great|hello|hi|hey|bye|yes|no|sure)[.! ]*$/i.test(q))return false;
      if(/^remember(?: that)?\b/i.test(q))return false;
      const durable=/\b(?:i(?:'m| am|'ve| have|'ll| will)?|my|mine|we|our|named|called|prefer|favorite|like|love|hate|live|work|moved|bought|got|adopted|decided|using|use|building|project|goal|friend|brother|sister|partner|dog|cat|pet|actually|anymore|now|used to)\b/i.test(q);
      if(!durable)return false;
      const pureQuestion=/^(?:what|who|where|when|why|how|which|can|could|would|do|did|does|is|are|should|tell me|find|search)\b/i.test(q)&&/\?\s*$/.test(q);
      const declaration=/\b(?:i am|i'm|i have|i've|i like|i love|i hate|i prefer|i live|i work|my .+? is|we (?:use|decided|agreed|are|have)|actually|not anymore|used to)\b/i.test(q);
      return !pureQuestion||declaration;
    }
    enqueue(episode,context=[]){
      if(!this.shouldRetain(episode?.user))return false;
      if((this.store.data.retainQueue||[]).some(j=>j.episode_id===episode.id&&j.status!=='failed')||this.currentJob?.episode_id===episode.id)return false;
      const job={id:'retain_'+episode.id,episode_id:episode.id,user:episode.user,assistant:text(episode.assistant).slice(0,800),at:episode.at||new Date().toISOString(),context:context.slice(-2).map(t=>({user:t.user,assistant:t.assistant})),status:'pending',attempts:0,created_at:new Date().toISOString()};
      this.store.transact(d=>d.retainQueue.push(job));this.schedule(300);return true;
    }
    schedule(delay=300){if(this.timer||this.running)return;this.timer=setTimeout(()=>{this.timer=null;this.run();},delay);}
    interrupt(){if(this.timer){clearTimeout(this.timer);this.timer=null;}if(this.controller)this.controller.abort();}
    resume(delay=300){if((this.store.data.retainQueue||[]).some(j=>j.status==='pending'))this.schedule(delay);}
    async run(force=false){
      if(this.running)return;const job=(this.store.data.retainQueue||[]).find(j=>j.status==='pending');if(!job)return;
      if(!force&&this.host.session){this.schedule(600);return;}
      this.running=true;this.currentJob=job;this.controller=new AbortController();const previous=text(this.host.variable?.('Core Activity')||'READY');
      try{
        job.status='processing';job.attempts=(job.attempts||0)+1;this.store.save();if(!this.host.session)this.host.setVariable?.('Core Activity','LEARNING MEMORY');
        const payload=await this.model.structured([{role:'system',content:MEMORY_SYSTEM},{role:'user',content:JSON.stringify({EVENT_DATE:job.at,CONTEXT:job.context,CURRENT_USER:job.user})}],MEMORY_SCHEMA,this.controller.signal,'memory',1000);
        const accepted=this.memory.ingestExtraction({id:job.episode_id,user:job.user,assistant:job.assistant,at:job.at,context:job.context},payload);
        if(accepted.length)try{await this.embedding.index(accepted,this.controller.signal);}catch(e){if(this.controller.signal.aborted)throw e;}
        if(accepted.length)this.host.engine?.consolidator?.maybeSchedule(5000);
        this.store.transact(d=>{d.retainQueue=d.retainQueue.filter(x=>x.id!==job.id);});this.lastError='';return accepted;
      }catch(e){
        if(this.controller.signal.aborted){job.status='pending';this.store.save();}
        else{this.lastError=e.message;job.last_error=e.message;job.status=job.attempts>=3?'failed':'pending';this.store.save();}
        return [];
      }finally{
        this.controller=null;this.currentJob=null;this.running=false;
        if(!this.host.session&&text(this.host.variable?.('Core Activity'))==='LEARNING MEMORY')this.host.setVariable?.('Core Activity',previous==='READY'?'READY':previous);
        if((this.store.data.retainQueue||[]).some(j=>j.status==='pending'))this.schedule(this.lastError?1800:350);
      }
    }
    async flush(){if(this.timer){clearTimeout(this.timer);this.timer=null;}let guard=0;while((this.store.data.retainQueue||[]).some(j=>j.status==='pending')&&guard++<100)await this.run(true);}
  }
export {MemoryRetainer};
