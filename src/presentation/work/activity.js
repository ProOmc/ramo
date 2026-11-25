(function(root){
 'use strict';
 function mode(value){return value==='off'?'off':['high','xhigh','max'].includes(value)?'max':'on';}
 const labels={idle:'Ready',preparing:'Preparing',loading:'Loading model',processing:'Processing prompt',thinking:'Thinking',writing:'Writing',planning:'Preparing tool call',tool:'Running tool',approval:'Waiting for you',compacting:'Compacting context',complete:'Completed',stopped:'Stopped',limited:'Output/server limit reached',error:'Needs attention'};
 function view(progress,now=Date.now()){
  const p=progress||{},generated=Math.max(0,Number(p.generated)||0);let phase=p.phase||'idle',label=labels[phase]||'Working';
  if(!p.endedAt&&['thinking','writing','planning'].includes(phase)&&p.lastTokenAt&&now-p.lastTokenAt>4000){phase='processing';label='Waiting for next token';}
  const seconds=p.startedAt?Math.max(0,Math.floor(((p.endedAt||now)-p.startedAt)/1000)):0;
  return {phase,label,tokenLabel:(generated&&!p.exact?'~':'')+generated.toLocaleString('en-US')+' generated tokens',tokenTitle:p.exact?'Reported by the model backend, including thinking and tool-call output.':'Live estimate from streamed text, thinking and tool arguments; replaced by backend totals when supplied.',elapsed:seconds>=60?Math.floor(seconds/60)+'m '+seconds%60+'s':seconds+'s'};
 }
 const api={mode,view};if(typeof module==='object'&&module.exports)module.exports=api;else root.OceanicWorkActivity=api;
})(typeof globalThis==='object'?globalThis:this);
