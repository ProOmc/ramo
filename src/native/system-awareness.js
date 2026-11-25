'use strict';
// Read-only, on-demand hardware telemetry. No service to install and no shell execution.
const os = require('node:os');
const path = require('node:path');
const {execFile} = require('node:child_process');

const finite = n => Number.isFinite(n) ? n : null;
const clamp = n => Math.min(100, Math.max(0, n));
const temperature = n => typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=150?n:null;
const WINDOWS_GPU_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
$readings=@()
try {
  $readings=@(Get-CimInstance -Namespace 'root/cimv2' -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | ForEach-Object {
    [pscustomobject]@{ Name=[string]$_.Name; Usage=[double]$_.UtilizationPercentage }
  })
} catch { $readings=@() }
if($readings.Count -eq 0){
  try { $readings=@(Get-Counter -Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop | Select-Object -ExpandProperty CounterSamples | ForEach-Object {
    [pscustomobject]@{ Name=[string]$_.InstanceName; Usage=[double]$_.CookedValue }
  }) } catch { $readings=@() }
}
$named=@()
try { $named=@(Get-CimInstance Win32_VideoController -ErrorAction Stop | Where-Object { $_.Name } | ForEach-Object { [string]$_.Name }) } catch {}
# Each per-process measurement is grouped by the physical adapter and engine.
# Usage for a physical adapter is the busiest aggregated engine, not the sum
# across 3D, Copy, and Video Decode engines.
$groups=@{}
foreach($sample in $readings){
  if([double]::IsNaN($sample.Usage) -or [double]::IsInfinity($sample.Usage)) { continue }
  $m=[regex]::Match($sample.Name,'phys_(\d+)','IgnoreCase')
  if(-not $m.Success){continue}
  $index=[int]$m.Groups[1].Value
  $engine=[regex]::Replace($sample.Name,'^pid_\d+_','','IgnoreCase')
  if(-not $groups.ContainsKey($index)){$groups[$index]=@{}}
  if(-not $groups[$index].ContainsKey($engine)){$groups[$index][$engine]=0.0}
  $groups[$index][$engine]+=[double]$sample.Usage
}
$out=@()
foreach($i in @($groups.Keys | Sort-Object)){
  $peak=($groups[$i].Values|Measure-Object -Maximum).Maximum
  $out+=@{index=[int]$i;percent=[math]::Round([math]::Max(0,[math]::Min(100,[double]$peak)),1)}
}
@{engines=$out;adapterNames=$named;source='Windows GPU engine counters'}|ConvertTo-Json -Depth 6 -Compress
`;

class SystemAwareness {
  constructor({osApi=os, execute=execFile, platform=process.platform, arch=process.arch,
               env=process.env, clock=()=>Date.now()}={}) {
    this.os=osApi;
    this.execute=execute;
    this.platform=platform;
    this.arch=arch;
    this.env=env;
    this.clock=clock;
    this.previous=this.cpuCounters();
    this.lastCpu=null;
    this.gpuCache=null;
    this.gpuInFlight=null;
    this.nvidiaRetryAfter=0;


  }
  cpuCounters() {
    const cores=this.os.cpus();
    if (!cores?.length) return null;
    let idle=0,total=0;
    for(const {times} of cores) {
      idle+=Number(times.idle)||0;
      for(const value of Object.values(times)) total+=Number(value)||0;
    }
    return {idle,total,count:cores.length,model:cores[0].model||'CPU'};
  }
  cpuSample() {
    const now=this.cpuCounters();
    if(!now)return {name:'CPU',logicalCores:null,percent:null};
    let percent=this.lastCpu;
    if(this.previous&&now.total>this.previous.total) {
      const difference=now.total-this.previous.total;
      const idleDifference=Math.max(0,now.idle-this.previous.idle);
      percent=clamp(100*(1-idleDifference/difference));
      this.lastCpu=percent;
    }
    this.previous=now;
    return {name:now.model,logicalCores:now.count,percent:finite(percent)};
  }
  run(executable,args,options) {
    return new Promise((resolve,reject)=>{
      this.execute(executable,args,{windowsHide:true,timeout:3500,maxBuffer:65536,...options},(error,stdout,stderr)=>{
        if(error){
          error.detail=String(stderr||'').trim().slice(0,150)||error.message;
          return reject(error);
        }
        resolve(String(stdout||''));
      });
    });
  }
  // Windows 32-bit Electron is subject to WOW64 System32 redirection. Sysnative
  // accesses the real 64-bit System32 folder, where DCH drivers put nvidia-smi.
  nvidiaCandidates() {
    const names=[];
    if(this.platform==='win32') {
      const win=this.env.SystemRoot||this.env.WINDIR||'C:\\Windows';
      const pf=this.env.ProgramW6432||this.env.ProgramFiles||'C:\\Program Files';
      if(this.arch==='ia32') names.push(path.win32.join(win,'Sysnative','nvidia-smi.exe'));
      names.push(path.win32.join(win,'System32','nvidia-smi.exe'));
      names.push(path.win32.join(pf,'NVIDIA Corporation','NVSMI','nvidia-smi.exe'));
    }
    names.push('nvidia-smi.exe','nvidia-smi');
    return [...new Set(names)];
  }
  parseNvidia(stdout,{withTemperature=true}={}) {
    const row=stdout.split(/\r?\n/).map(s=>s.trim()).find(Boolean);
    if(!row)throw new Error('No NVIDIA GPU data returned');
    const values=row.split(/\s*,\s*/);
    if(values.length<2)throw new Error('Unexpected NVIDIA GPU response');
    const number=v=>{
      const match=String(v||'').match(/^\s*(-?\d+(?:\.\d+)?)/);
      return match?Number(match[1]):null;
    };
    let at=0;
    const next=()=>values[at++];
    const name=next();
    const util=number(next());
    const used=number(next());
    const total=number(next());
    const temperatureC=withTemperature?temperature(number(next())):null;
    const driverVersion=String(next()??'').trim()||null;
    const computeCapability=String(next()??'').trim()||null;
    if(util===null&&(!Number.isFinite(total)||total<=0)&&temperature(temperatureC)===null)throw new Error('NVIDIA metrics not supported');
    return {available:true,source:'NVIDIA driver',name:name||'NVIDIA GPU',
      temperatureC,temperatureTimestamp:this.clock(),
      percent:util===null?null:clamp(util),
      vramUsedMiB:finite(used),vramTotalMiB:finite(total),
      vramPercent:total>0&&used!==null?clamp(100*used/total):null,
      driverVersion,computeCapability};
  }
  async readNvidia() {
    const argv=['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,driver_version,compute_cap','--format=csv,noheader,nounits'];
    const withoutTemperature=['--query-gpu=name,utilization.gpu,memory.used,memory.total,driver_version,compute_cap','--format=csv,noheader,nounits'];
    const minimum=['--query-gpu=name,utilization.gpu','--format=csv,noheader,nounits'];
    let lastError=null;
    for(const executable of this.nvidiaCandidates()) {
      try {return this.parseNvidia(await this.run(executable,argv,{timeout:3000}))}
      catch(e) {
        lastError=e;
        // A real NVIDIA binary may reject one field while still supporting GPU load.
        if(e.code!=='ENOENT'&&e.code!=='EACCES') {
          try {return this.parseNvidia(await this.run(executable,withoutTemperature,{timeout:3000}),{withTemperature:false})}
          catch(other){lastError=other}
          try{return this.parseNvidia(await this.run(executable,minimum,{timeout:3000}))}
          catch(other){lastError=other}
        }
      }
    }
    throw lastError||new Error('NVIDIA monitoring utility not found');
  }
  powershellCandidates() {
    const names=[];
    if(this.platform==='win32') {
      const win=this.env.SystemRoot||this.env.WINDIR||'C:\\Windows';
      if(this.arch==='ia32')names.push(path.win32.join(win,'Sysnative','WindowsPowerShell','v1.0','powershell.exe'));
      names.push(path.win32.join(win,'System32','WindowsPowerShell','v1.0','powershell.exe'));
    }
    names.push('powershell.exe');
    return [...new Set(names)];
  }
  async readWindowsGpu() {
    let lastError=null;
    for(const executable of this.powershellCandidates()) {
      try {
        const stdout=await this.run(executable,['-NoProfile','-NonInteractive','-Command',WINDOWS_GPU_SCRIPT],{timeout:6000});
        const line=stdout.trim();
        const result=JSON.parse(line);
        const engines=Array.isArray(result.engines)?result.engines:result.engines?[result.engines]:[];
        const names=Array.isArray(result.adapterNames)?result.adapterNames:result.adapterNames?[result.adapterNames]:[];
        return {engines:engines.filter(x=>Number.isInteger(Number(x.index))&&Number.isFinite(Number(x.percent))).map(x=>({index:Number(x.index),percent:clamp(Number(x.percent))})),names:names.map(String)};
      } catch(e) {lastError=e}
    }
    throw lastError||new Error('Windows GPU performance counters unavailable');
  }
  async readGpuNow() {
    // Driver metrics and Windows adapter counters are deliberately independent.
    // Driver readings identify NVIDIA memory and compute; Windows reports GPU 0/1 engine activity.
    let nvidia=null,windows=null,driverError=null,windowsError=null;
    const [a,b]=await Promise.allSettled([
      this.clock()>=this.nvidiaRetryAfter?this.readNvidia():Promise.reject(new Error('NVIDIA retry cooling down')),
      this.platform==='win32'?this.readWindowsGpu():Promise.resolve({engines:[],names:[]})
    ]);
    if(a.status==='fulfilled')nvidia=a.value;
    else {driverError=String(a.reason?.detail||a.reason?.message||'unavailable').slice(0,150);if(this.clock()>=this.nvidiaRetryAfter)this.nvidiaRetryAfter=this.clock()+30000;}
    if(b.status==='fulfilled')windows=b.value;
    else windowsError=String(b.reason?.detail||b.reason?.message||'unavailable').slice(0,150);
    const engineMap=new Map((windows?.engines||[]).map(x=>[x.index,x.percent]));
    const named=windows?.names||[];
    const nvidiaName=nvidia?.name||named.find(x=>/nvidia|geforce|rtx|quadro/i.test(x))||'';
    const intelName=named.find(x=>/intel|uhd|iris|arc/i.test(x))||'';
    // WMI adapter-name order isn't guaranteed to equal Task Manager numbering.
    // Associate driver with an engine only when NVIDIA utilization is close to a
    // unique engine, or on the known two-adapter hybrid configuration (when the
    // other engine is demonstrably busier). Otherwise leave labels unverified.
    let nvidiaIndex=null;
    if(nvidia){
      const sorted=[...engineMap].map(([index,p])=>({index,diff:Math.abs(p-(nvidia.percent??0))})).sort((x,y)=>x.diff-y.diff);
      if(sorted.length===1){
        if(sorted[0].diff<=8)nvidiaIndex=sorted[0].index;
        else if(intelName&&nvidiaName&&[0,1].includes(sorted[0].index)) nvidiaIndex=1-sorted[0].index;
      }
      else if(sorted.length>1&&sorted[0].diff<=8&&sorted[1].diff-sorted[0].diff>=5)nvidiaIndex=sorted[0].index;
      else if(engineMap.size===0)nvidiaIndex=0;
    }
    let indices=new Set(engineMap.keys());
    if(nvidia&&nvidiaIndex!==null)indices.add(nvidiaIndex);
    if(intelName&&nvidiaIndex!==null&&indices.size<2)indices.add(nvidiaIndex===1?0:1);
    const gpus=[...indices].sort((a,b)=>a-b).map(index=>{
      const isNvidia=!!nvidia&&nvidiaIndex!==null&&index===nvidiaIndex;
      const likelyIntel=!isNvidia&&!!intelName&&!!nvidia&&nvidiaIndex!==null&&engineMap.size<=2;
      const candidate=named.length===1?named[0]:'';
      const displayName=isNvidia?(nvidiaName||'NVIDIA GPU'):likelyIntel?intelName:(candidate||'Windows GPU adapter (identity not verified)');
      return {id:`gpu-${index}`,index,name:displayName,
        percent:isNvidia&&nvidia?Number.isFinite(nvidia.percent)?nvidia.percent:engineMap.get(index)??null:engineMap.get(index)??null,
        vramUsedMiB:isNvidia?nvidia?.vramUsedMiB??null:null,
        vramTotalMiB:isNvidia?nvidia?.vramTotalMiB??null:null,
        vramPercent:isNvidia?nvidia?.vramPercent??null:null,
        temperatureC:isNvidia?nvidia?.temperatureC??null:null,
        temperatureTimestamp:isNvidia?nvidia?.temperatureTimestamp??null:null,
        driverVersion:isNvidia?nvidia?.driverVersion??null:null,
        computeCapability:isNvidia?nvidia?.computeCapability??null:null,
        source:isNvidia?'NVIDIA driver':engineMap.has(index)?'Windows GPU engine counters':'Detected adapter',
        available:isNvidia||engineMap.has(index),
        attribution:isNvidia&&!engineMap.has(index)?'NVIDIA GPU; Windows adapter index unverified':(!isNvidia&&likelyIntel?'Intel adapter name inferred; inspect Task Manager if indices differ':''),
        detail:isNvidia?'NVIDIA GPU utilization from driver telemetry':engineMap.has(index)?'Busiest aggregate GPU engine from Windows performance counters':'No engine readings available'};
    });
    if(!gpus.length){gpus.push({id:'gpu-0',index:0,name:nvidiaName||'GPU',available:false,percent:null,detail:`NVIDIA: ${driverError||'unavailable'}; Windows: ${windowsError||'unavailable'}`});}
    const gpu=nvidia || {available:!!gpus[0]?.available,source:gpus[0]?.source||'',name:gpus[0]?.name||'GPU',percent:gpus[0]?.percent??null,detail:gpus[0]?.detail||''};
    return {gpu,gpus,diagnostics:{driverError,windowsError}};
  }
  async gpuSample() {
    const time=this.clock();
    if(this.gpuCache && time-this.gpuCache.time<this.gpuCache.ttl) return this.gpuCache.value;
    if(this.gpuInFlight)return this.gpuInFlight;
    this.gpuInFlight=this.readGpuNow().then(value=>{
      this.gpuCache={time:this.clock(),ttl:value.gpu?.source==='NVIDIA driver'?2200:4000,value};
      return value;
    }).finally(()=>{this.gpuInFlight=null});
    return this.gpuInFlight;
  }
  async snapshot() {
    const cpu=this.cpuSample();
    const total=this.os.totalmem(),available=this.os.freemem();
    const used=Math.max(0,total-available);
    const ram={totalBytes:total,usedBytes:used,availableBytes:available,
      percent:total>0?clamp(100*used/total):null};
    const gpu=await this.gpuSample();
    const osInfo={platform:this.platform||'win32',arch:this.arch||'',release:this.os.release?.()||'',version:this.os.version?.()||'',node:process.versions?.node||''};
    return {timestamp:this.clock(),cpu,ram,gpu:gpu.gpu,gpus:gpu.gpus,diagnostics:gpu.diagnostics,os:osInfo};
  }
}
module.exports={SystemAwareness};
