'use strict';
const os=require('os'),path=require('path'),{execFile}=require('child_process');
// Conservative admission estimates from this laptop's Q4_K_M / CPU-MoE / Q8 tests.
// This is a startup guard, not a reservation or a promise about concurrent applications.
// allowLowMemory is the user's explicit override: it reports the shortfall instead of
// blocking, and asks llama.cpp to size the layer split and context to what is actually free.
function contextPlan(profile,{freeMiB,ramFree},{allowUnknownVRAM=false,allowLowMemory=false}={}){
  const context=Number(profile.context)||16384;
  if(!profile.cpuMoe||String(profile.gpu)!=='all'||context<32768&&!profile.vision)return {context};
  const tuned=profile.cpuMoeLayers&&profile.cpuMoeLayers<40;
  const ramMinimum=profile.vision?19:6,minimum=tuned?7168:profile.vision?5376:4352,preferred=tuned?7424:profile.vision?5632:4608;
  const ramShort=ramFree<ramMinimum*2**30,vramShort=Number.isFinite(freeMiB)&&freeMiB<minimum;
  if(ramShort&&!allowLowMemory)throw Error('35B'+(profile.vision?' with vision':'')+' needs at least '+ramMinimum+' GiB available system RAM before startup. Close other memory-heavy applications or choose Fast/Smart and retry.');
  if(!Number.isFinite(freeMiB)){
   if(allowUnknownVRAM)return {context:Math.min(context,32768),message:'Starting at 32K with your override; VRAM could not be verified.'};
   if(allowLowMemory)return {context,fit:true,message:'Free VRAM could not be measured. llama.cpp will size the layer split and context to the memory it can find.'};
   throw Error('Could not measure free NVIDIA VRAM. Retry startup to choose the 32K override.');
  }
  if(vramShort&&!allowLowMemory)throw Error('Not enough free VRAM for 35B'+(profile.vision?' vision':'')+' with a safety margin (need at least '+minimum/1024+' GiB free). Close other GPU applications or unload other models and retry.');
  if(allowLowMemory){
   const short=[];
   if(ramShort)short.push((ramFree/2**30).toFixed(1)+' GiB free RAM against a '+ramMinimum+' GiB advisory');
   if(vramShort)short.push((freeMiB/1024).toFixed(1)+' GiB free VRAM against a '+(minimum/1024).toFixed(1)+' GiB advisory');
   return {context,fit:true,message:(short.length?'Loading with reduced guarantees: '+short.join('; ')+'.':'Loading with reduced guarantees.')+' llama.cpp will size the layer split and context to the memory that is actually free.'};
  }
  if(context>32768&&freeMiB<preferred)return {context:32768,message:'Using 32K context to retain about 1.5 GiB of GPU headroom.'};
  return {context};
 }
async function inspectMemory({platform=process.platform,arch=process.arch,env=process.env,run}={}){
  // Same WOW64 handling as Ramo's Computer monitor. PATH alone fails in ia32 Electron.
  const candidates=[];
  if(platform==='win32'){
   const win=env.SystemRoot||env.WINDIR||'C:\\Windows';
   if(arch==='ia32')candidates.push(path.win32.join(win,'Sysnative','nvidia-smi.exe'));
   candidates.push(path.win32.join(win,'System32','nvidia-smi.exe'),path.win32.join(env.ProgramW6432||env.ProgramFiles||'C:\\Program Files','NVIDIA Corporation','NVSMI','nvidia-smi.exe'));
  }
  candidates.push('nvidia-smi.exe','nvidia-smi');
  const execute=run||((exe,args)=>new Promise((resolve,reject)=>execFile(exe,args,{windowsHide:true,timeout:2000},(err,stdout)=>err?reject(err):resolve(stdout))));
  for(const exe of [...new Set(candidates)])for(const field of ['memory.free','memory.total,memory.used']){
   try{const output=await execute(exe,['--query-gpu='+field,'--format=csv,noheader,nounits']);const row=String(output).trim().split(/\r?\n/)[0].split(',').map(s=>s.trim());
    if(row.some(s=>!/^\d+(\.\d+)?$/.test(s)))continue;
    const values=row.map(Number),freeMiB=field==='memory.free'?values[0]:values[0]-values[1];
    if(Number.isFinite(freeMiB)&&freeMiB>=0)return {freeMiB,ramFree:os.freemem()};
   }catch(error){if(['ENOENT','EACCES'].includes(error.code))break;}
  }
  return {freeMiB:null,ramFree:os.freemem()};
 }
module.exports={contextPlan,inspectMemory};
