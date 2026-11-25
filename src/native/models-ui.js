'use strict';
(()=>{
  const api=window.ramoModels;
  const root=document.getElementById('models');
  const message=document.getElementById('message');
  const notify=(msg,err=false)=>{message.textContent=String(msg);message.className='message'+(err?' err':'');};
  const el=(tag,txt,cls)=>{const n=document.createElement(tag);if(txt!=null)n.textContent=String(txt);if(cls)n.className=cls;return n;};
  const button=(label,cb,cls)=>{const b=el('button',label,cls);b.type='button';b.addEventListener('click',async()=>{
    b.disabled=true;try{notify('Working…');const result=await cb();notify(result?.message||'Saved.');await render();}
    catch(e){notify(e.message||String(e),true);}finally{b.disabled=false;}
  });return b;};
  const field=(label,value,type='text')=>{
    const holder=el('label',null,'field');holder.append(el('span',label));const input=el('input');input.type=type;
    if(type==='checkbox')input.checked=!!value;else input.value=value??'';
    holder.append(input);return {holder,input};
  };
  async function render(){
    const rows=await api.status();
    // Status polling must never pull the user to the top of the model list.
    const scrollNodes=[document.scrollingElement,root,...(function*(){let node=root.parentElement;while(node){if(node.scrollHeight>node.clientHeight)yield node;node=node.parentElement;}})()].filter(Boolean);
    const positions=scrollNodes.map(node=>[node,node.scrollTop,node.scrollLeft]);
    root.replaceChildren();
    for(const p of rows){
      const card=el('section',null,'model');
      const top=el('div',null,'top');
      top.append(el('div',p.title,'title'));
      const pill=el('span',(p.state||'Offline')+' · '+p.ownership,'pill '+(p.online?'online':'offline'));
      top.append(pill);card.append(top);
      card.append(el('div',p.description,'meta'));
      card.append(el('div',`${p.kind.toUpperCase()} · ${p.model} · ${p.endpoint}`,'meta'));
      const actions=el('div',null,'actions');
      actions.append(button('Start server',()=>api.start(p.id),'secondary'));
      if(p.canStartServerOnly)actions.append(button('Start server only (do not load the model)',()=>api.startServerOnly(p.id),'secondary'));
      if(p.kind==='llama'||p.kind==='custom')actions.append(button('Load anyway (ignore the RAM/VRAM advisory)',()=>api.startWithOverride(p.id),'secondary'));
      actions.append(button('Wake / load model',()=>api.wake(p.id)));
      if(p.canStop)actions.append(button('Stop server',()=>api.stop(p.id),'danger'));
      if(p.kind==='script'){
        actions.append(button('Select PowerShell loader',async()=>({message:await api.choose(p.id,'loaderPath')||'Unchanged'}),'secondary'));
      }
      if(p.kind!=='ollama'&&p.kind!=='script'){
        actions.append(button('Select llama-server.exe',async()=>({message:await api.choose(p.id,'exe')||'Unchanged'}),'secondary'));
        actions.append(button('Select GGUF',async()=>({message:await api.choose(p.id,'modelPath')||'Unchanged'}),'secondary'));
      }
      if(p.kind==='bonsai')actions.append(button('Select router preset',async()=>({message:await api.choose(p.id,'preset')||'Unchanged'}),'secondary'));
      if(p.id.startsWith('custom_'))actions.append(button('Delete profile',()=>api.remove(p.id),'danger'));
      card.append(actions);
      if(p.preset)card.append(el('div','Router preset: '+p.preset,'inputpath'));
      if(p.loaderPath)card.append(el('div','PowerShell loader: '+p.loaderPath,'inputpath'));
      if(p.kind==='script'&&!p.loaderPath)card.append(el('div','Choose your trusted .ps1 loader script.','inputpath'));
      if(p.exe)card.append(el('div','Server: '+p.exe,'inputpath'));
      if(p.modelPath)card.append(el('div','Model: '+p.modelPath,'inputpath'));
      if(p.id==='qwen36'&&!p.modelPath)card.append(el('div','Choose your Qwen3.6 GGUF before starting this profile.','inputpath'));
      if(p.id==='qwen36'&&p.modelPath&&p.modelState==='unloaded')card.append(el('div','The server is running but the model is not loaded. It loads on the first request, or use Wake / load model.','inputpath'));
      if(p.kind==='custom'&&!p.modelPath)card.append(el('div','Choose both a llama-server.exe and GGUF.','inputpath'));
      const details=el('details',null,'advanced');
      details.append(el('summary','Profile options and logs'));
      const controls=el('div',null,'row');
      const alias=field('Model name / Ollama tag',p.model);
      const ctx=field('Context tokens',p.context||8192,'number');
      const threads=field('CPU threads',p.threads||8,'number');
      const port=field('Port',p.port,'number');
      const gpu=field('GPU layers',p.gpu||'all');
      const cpuMoe=field('CPU MoE',p.cpuMoe,'checkbox');
      const flash=field('Flash attention',p.flash,'checkbox');
      const kv=field('KV quantization',p.kv||'q8_0');
      controls.append(alias.holder);
      if(p.kind!=='ollama'&&p.kind!=='script')controls.append(ctx.holder,threads.holder);
      if(p.kind==='custom'||p.kind==='llama')controls.append(port.holder,gpu.holder,cpuMoe.holder,flash.holder,kv.holder);
      if(p.kind==='script')controls.append(port.holder);
      details.append(controls);
      const save=button('Save profile',()=>api.update(p.id,{
        ...(p.kind==='bonsai'?{}:{model:alias.input.value}),
        ...(p.kind==='ollama'||p.kind==='script'?{}:{context:Number(ctx.input.value),threads:Number(threads.input.value)}),
        ...((p.kind==='llama'||p.kind==='custom')?{port:Number(port.input.value),gpu:gpu.input.value,cpuMoe:cpuMoe.input.checked,flash:flash.input.checked,kv:kv.input.value}:{}),
        ...(p.kind==='script'?{port:Number(port.input.value)}:{})
      }));
      details.append(save);
      if(p.kind==='bonsai')details.append(el('p','When a router preset exists, context and GPU settings come from that preset. Select the existing preset you intend to use.'));
      const log=el('pre',p.logs.join('\n')||'No events recorded yet.','logs');details.append(log);card.append(details);
      root.append(card);
    }
    for(const [node,top,left] of positions){node.scrollTop=top;node.scrollLeft=left;}
  }
  document.getElementById('refresh').addEventListener('click',()=>render().catch(e=>notify(e.message,true)));
  document.getElementById('add').addEventListener('click',async()=>{
    try{const name=document.getElementById('new-name').value;const port=Number(document.getElementById('new-port').value);const result=await api.add(name,port,document.getElementById('new-kind').value);notify('Added '+result.title);await render();}
    catch(e){notify(e.message,true);}
  });
  render().catch(e=>notify('Could not load profiles: '+e.message,true));
  let lastUserScroll=0;
  root.addEventListener('wheel',()=>{lastUserScroll=Date.now();},{passive:true});
  root.addEventListener('touchmove',()=>{lastUserScroll=Date.now();},{passive:true});
  setInterval(()=>{ if(root.querySelector('details[open]') || root.contains(document.activeElement) || Date.now()-lastUserScroll<15000)return; render().catch(()=>{}); },12000);
})();
