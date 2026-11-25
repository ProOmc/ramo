'use strict';
class Progress{
 constructor(sessionId){this.sessionId=sessionId;this.startedAt=Date.now();this.phase='preparing';this.calls=[];this.lastTokenAt=null;this.endedAt=null;}
 begin(policy={}){const call={characters:0,tokens:null,done:false};this.calls.push(call);this.phase='processing';this.outputLimit=policy.max_tokens;this.mode=policy.ramo_work_mode;return call;}
 chunk(call,event){let chars=0;for(const choice of event.choices||[]){const d=choice.delta||{};chars+=String(d.content||'').length+String(d.reasoning_content||d.reasoning||'').length;for(const t of d.tool_calls||[])chars+=String(t.function?.arguments||'').length;if(d.reasoning_content||d.reasoning)this.phase='thinking';else if(d.content)this.phase='writing';else if(d.tool_calls?.length)this.phase='planning';}call.characters+=chars;if(chars)this.lastTokenAt=Date.now();const count=event.usage?.completion_tokens;if(Number.isFinite(count)&&count>=0)call.tokens=count;}
 end(call){call.done=true;}
 snapshot(){const generated=this.calls.reduce((n,c)=>n+(c.tokens??Math.ceil(c.characters/4)),0);return {sessionId:this.sessionId,phase:this.phase,generated,exact:this.calls.length>0&&this.calls.every(c=>c.tokens!==null),requests:this.calls.length,mode:this.mode,requestedOutputTokens:this.outputLimit,startedAt:this.startedAt,lastTokenAt:this.lastTokenAt,endedAt:this.endedAt};}
}
module.exports={Progress};
