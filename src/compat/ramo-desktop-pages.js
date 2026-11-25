'use strict';
/* Computer and model overview live inside Ramo's existing desktop and navigation shell.
   Only read-only data crosses into the project renderer; advanced model control stays isolated. */
(()=>{
  const api=window.ramoDesktop;
  if(!api?.computer?.snapshot)return;
  let page=null,body=null,current='',pollHandle=null,pending=false,modelBusy=false;
  const charts=new Map();
  const temperatureCharts=new Map();
  const number=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
  const pct=v=>number(v)===null?null:Math.min(100,Math.max(0,v));
  const fmt=v=>pct(v)===null?'—':`${Math.round(pct(v))}%`;
  const gib=v=>number(v)===null?'—':`${(v/1073741824).toFixed(1)} GiB`;
  function shell(){
    let root=document.getElementById('ramo-stage-overlay-v180');
    if(!root)return null;
    if(!page){
      page=document.createElement('section');page.id='oc-desktop-sections';page.setAttribute('aria-label','Ramo desktop section');page.dataset.view='';page.dataset.connected='false';
      page.innerHTML='<div class="oc-section-scroll" id="oc-desktop-scroll"><div class="oc-section-content" id="oc-desktop-body"></div></div>';
      root.appendChild(page);body=page.querySelector('#oc-desktop-body');
    }
    const nav=document.getElementById('ramo-nav-shell-v190');
    if(nav){const w=getComputedStyle(nav).getPropertyValue('--rail-w').trim();if(w)page.style.setProperty('--oc-desktop-rail',w);}
    return page;
  }
  function setActive(name){
    document.body.dataset.ocDesktopPage=name;
    const nav=document.getElementById('ramo-nav-shell-v190');
    if(nav)for(const node of nav.querySelectorAll('[data-page]')){
      node.classList.toggle('active',node.dataset.page===(name||'home'));
    }
  }
  function stop(){if(pollHandle!==null){clearInterval(pollHandle);pollHandle=null;}}
  function close(){stop();current='';setActive('');if(page)page.dataset.view='';}
  const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const elText=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=String(text||'');if(cls)e.className=cls;return e;};
  function metric(id,label,description){
    return `<section class="oc-metric" id="oc-metric-${escapeHtml(id)}" data-metric="${escapeHtml(id)}">
    <div class="oc-metric-main">
      <div><div class="oc-metric-name">${escapeHtml(label)}</div><span class="oc-metric-model" data-role="name">${escapeHtml(description||'Checking…')}</span><span class="oc-metric-memory" data-role="memory"></span><div class="oc-meterbar"><span class="oc-meterfill" data-role="fill"></span></div></div>
      <svg class="oc-graph" role="img" aria-label="Recent utilization" viewBox="0 0 240 57" preserveAspectRatio="none"><polyline class="oc-graph-line" data-role="line" points=""></polyline></svg>
      <div class="oc-metric-value" data-role="value">—</div>
    </div><div data-role="temperature" style="margin-top:12px;color:var(--oc-muted);font-size:13px;line-height:1.6"></div></section>`;
  }
  function setRows(sensors){
    const existing=[...body.querySelectorAll('.oc-metric')].map(x=>x.dataset.metric);
    const wanted=sensors.map(x=>x.id);
    if(JSON.stringify(existing)!==JSON.stringify(wanted)){
      // Keep nodes and their graphs alive when values update. Only change membership.
      for(const node of body.querySelectorAll('.oc-metric'))if(!wanted.includes(node.dataset.metric)){charts.delete(node.dataset.metric);temperatureCharts.delete(node.dataset.metric);node.remove();}
      const list=body.querySelector('#oc-sensor-list');
      for(const x of sensors){let node=list.querySelector(`[data-metric="${x.id}"]`);
        if(!node){list.insertAdjacentHTML('beforeend',metric(x.id,x.title,x.name));node=list.lastElementChild;}
        list.appendChild(node);
      }
    }
    for(const x of sensors){const node=body.querySelector(`[data-metric="${x.id}"]`);if(!node)continue;
      const q=name=>node.querySelector(`[data-role="${name}"]`);
      q('name').textContent=x.name||'Unavailable';q('name').title=x.name||'';
      q('memory').textContent=x.memory||'';q('memory').title=x.note||'';
      const t=x.temperature,box=q('temperature');
      if(t){
        const stale=number(t.timestamp)!==null&&Date.now()-t.timestamp>15000;
        const values=(t.values||[]).filter(v=>number(v.value)!==null&&v.value>=0&&v.value<=150);
        const label=values.map(v=>`${v.label}: ${v.value.toFixed(0)} °C`).join(' · ');
        box.replaceChildren();
        const line=elText('div',values.length?label+(stale?' · Stale':''):'Temperature unavailable');
        line.dataset.role='temperature-value';box.append(line);
        box.append(elText('div',values.length?`${t.source||'Hardware sensor'} · Read ${new Date(t.timestamp).toLocaleTimeString()}`:t.detail||'No temperature reading is available from this adapter\'s current provider.'));
        if(values.length&&!stale){
          const history=temperatureCharts.get(x.id)||[];
          if(history.at(-1)?.at!==t.timestamp)history.push({at:t.timestamp,value:Math.max(...values.map(v=>v.value))});
          if(history.length>44)history.shift();temperatureCharts.set(x.id,history);
          const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
          svg.setAttribute('viewBox','0 0 240 35');svg.setAttribute('aria-label','Recent sensor temperature in Celsius');svg.setAttribute('role','img');
          svg.style.cssText='display:block;width:240px;max-width:100%;height:35px;margin-top:5px;opacity:.8';
          const plot=document.createElementNS(svg.namespaceURI,'polyline');plot.setAttribute('fill','none');plot.setAttribute('stroke','currentColor');plot.setAttribute('stroke-width','1.5');
          plot.setAttribute('points',history.map((v,i)=>`${(i/Math.max(1,history.length-1)*240).toFixed(1)},${(33-Math.min(150,v.value)/150*30).toFixed(1)}`).join(' '));
          svg.append(plot);box.append(svg);
          box.append(elText('small',`Recent peak: ${Math.max(...history.map(v=>v.value)).toFixed(0)} °C · while this page is open`));
        }
      }else box.replaceChildren();
      const value=pct(x.usage);q('value').innerHTML=(value===null?'—':Math.round(value))+(value===null?'':'<span>%</span>');
      q('fill').style.width=(value??0)+'%';
      if(value!==null){const list=charts.get(x.id)||[];list.push(value);if(list.length>44)list.shift();charts.set(x.id,list);
        q('line').setAttribute('points',list.map((v,i)=>`${(i/Math.max(1,list.length-1)*240).toFixed(1)},${(55-v*.52).toFixed(1)}`).join(' '));
      }
    }
  }
  function renderComputer(){
    body.innerHTML='<div class="oc-section-titleline"><h1 class="oc-section-title">Computer</h1><div class="oc-section-live" id="oc-desktop-status"><span class="oc-live-dot"></span><span>Connecting…</span></div></div><div id="oc-sensor-list"></div><p class="oc-note">GPU temperature is read from the NVIDIA driver, never estimated. NVIDIA VRAM is dedicated memory; Intel graphics generally use shared system memory. GPU utilization is engine activity, not memory allocation.</p>';
  }
  async function pollComputer(){
    if(current!=='computer'||pending)return;pending=true;
    try{
      const d=await api.computer.snapshot();if(current!=='computer')return;
      const gpus=Array.isArray(d.gpus)&&d.gpus.length?d.gpus:(d.gpu?[{...d.gpu,id:'gpu-0',index:0}]:[]);
      const sensors=[{id:'cpu',title:'CPU',name:d.cpu?.name,usage:d.cpu?.percent,memory:d.cpu?.logicalCores?`${d.cpu.logicalCores} logical processors`:''},
        ...gpus.map((g,i)=>({id:`gpu-${Number.isInteger(g.index)?g.index:i}`,title:`GPU ${Number.isInteger(g.index)?g.index:i}`,name:g.name||`Graphics adapter ${i}`,usage:g.percent,temperature:{timestamp:g.temperatureTimestamp,source:g.source,values:[{label:'GPU core',value:g.temperatureC}]},memory:number(g.vramTotalMiB)>0?`${(g.vramUsedMiB/1024).toFixed(1)} / ${(g.vramTotalMiB/1024).toFixed(1)} GiB dedicated VRAM`:g.source==='Windows GPU engine counters'?'Windows GPU-engine utilization':g.available?'No dedicated VRAM reading':'Usage unavailable',note:g.attribution||g.detail||''})),
        {id:'ram',title:'RAM',name: number(d.ram?.totalBytes)!==null?`${gib(d.ram.totalBytes)} physical memory`:'Physical memory',usage:d.ram?.percent,memory:`${gib(d.ram?.usedBytes)} used · ${gib(d.ram?.availableBytes)} available`}];
      setRows(sensors);
      page.dataset.connected='true';body.querySelector('#oc-desktop-status span:last-child').textContent=`Live · ${new Date(d.timestamp||Date.now()).toLocaleTimeString()}`;
    }catch(e){if(current==='computer'){page.dataset.connected='false';body.querySelector('#oc-desktop-status span:last-child').textContent='Sensor unavailable';for(const v of body.querySelectorAll('[data-role="temperature-value"]'))if(!v.textContent.includes('unavailable')&&!v.textContent.includes('Stale'))v.textContent+=' · Stale';}}
    finally{pending=false;}
  }
  async function renderModels(){
    body.innerHTML='<div class="oc-section-titleline"><h1 class="oc-section-title">Models</h1><button class="oc-section-action" id="oc-manage-models">Server settings</button></div><p class="oc-note">The same three local profiles are available in Chat and Research.</p><div class="oc-model-summary" id="oc-model-summary"><p class="oc-muted">Checking local services…</p></div>';
    body.querySelector('#oc-manage-models').addEventListener('click',()=>api.openModelManager().catch(()=>{}));await refreshModels();
  }
  async function refreshModels(){
    if(current!=='models'||modelBusy)return;modelBusy=true;
    try{const [rows,inventory]=await Promise.all([api.modelSummary(),api.ollamaModels()]);if(current!=='models')return;
      const ollama=rows.find(p=>p.id==='ollama');
      const choices=(globalThis.__ramoModelRegistry||[]).filter(p=>p.tier).map(p=>({label:p.label,model:p.model,detail:p.model,runtime:p.kind==='ollama'?ollama:p}));
      const host=body.querySelector('#oc-model-summary');host.classList.remove('oc-error-note');host.replaceChildren();
      for(const p of choices){const row=elText('div','','oc-model-row'),left=elText('div','');left.append(elText('div',p.label,'oc-model-name'),elText('div',p.detail,'oc-model-detail'));const installed=inventory.models?.some(m=>m.name===p.model);const state=p.runtime?.startup?.cancellable?'Starting':p.runtime?.ready?(p.runtime.kind==='ollama'?(installed?'Available':'Not installed'):'Ready'):p.runtime?.online?'Not ready':'Service stopped';const stat=elText('span',state,'oc-model-state'+(['Available','Ready'].includes(state)?' online':''));row.append(left,stat);host.append(row);}
      host.append(elText('p','Local and cloud models load when you send a task. Assign any available profile to any tier in Setup.','oc-note'));
    }catch(e){if(current==='models'){const host=body.querySelector('#oc-model-summary');host.textContent='Model status unavailable. Open Server settings for details.';host.classList.add('oc-error-note');}}finally{modelBusy=false;}
  }
  function open(which){
    if(!['computer','models'].includes(which)||!shell())return;
    stop();current=which;setActive(which);page.dataset.view=which;page.dataset.connected='false';
    const scroll=page.querySelector('.oc-section-scroll');scroll.scrollTop=0;charts.clear();temperatureCharts.clear();
    if(which==='computer'){renderComputer();pollComputer();pollHandle=setInterval(pollComputer,2000);}
    else {renderModels();pollHandle=setInterval(refreshModels,12000);}
  }
  document.addEventListener('ramo:desktop-page-open',e=>open(e.detail));
  window.addEventListener('ramo:desktop-page-close',close);
  document.addEventListener('keydown',e=>{if(current&&e.key==='Escape')close();});
  // The original renderer may mount asynchronously; navigation is in its real drawer.
  let attempts=0;const locate=setInterval(()=>{if(shell()||++attempts>200)clearInterval(locate);},250);
  window.addEventListener('resize',()=>{if(page)shell()});
})();
