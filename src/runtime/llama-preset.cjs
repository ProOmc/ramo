'use strict';
const fs=require('fs'),path=require('path');
// llama.cpp router preset (INI). With load-on-startup=false the server starts with
// no weights resident and loads the model on the first request that names it.
// The key names are llama.cpp's own parameter names, not aliases.
function buildPreset(p,{loadOnStartup=true,sleepIdleSeconds=600,fit=false}={}){
  const lines=['version = 1','','[*]','parallel = 1','jinja = true','','['+p.model+']'];
  const put=(key,value)=>{if(value!==undefined&&value!==null&&value!=='')lines.push(key+' = '+value);};
  put('model',p.modelPath);
  if(p.vision&&p.mmprojPath){put('mmproj',p.mmprojPath);put('no-mmproj-offload','true');put('image-max-tokens','2048');}
  put('ctx-size',Number(p.context)||65536);
  // A pinned layer count overrides the fitter, so the fitted launch leaves both the
  // layer count and the expert split unset and lets llama.cpp size them to the free
  // VRAM with the requested context as the floor.
  if(!fit){
    put('n-gpu-layers',String(p.gpu||'all'));
    if(p.cpuMoe){if(p.cpuMoeLayers)put('n-cpu-moe',Number(p.cpuMoeLayers));else put('cpu-moe','true');}
  }else{
    put('fit','on');
    put('fit-target',Number(p.fitTarget||512));
    put('fit-ctx',Number(p.context)||65536);
  }
  put('flash-attn',p.flash===false?'off':'on');
  put('cache-type-k',p.kv||'q8_0');
  put('cache-type-v',p.kv||'q8_0');
  put('threads',Number(p.threads)||8);
  put('threads-batch',Number(p.threadsBatch)||Number(p.threads)||8);
  put('batch-size',Number(p.batchSize)||8192);
  // The physical micro-batch drives CPU-MoE prompt throughput: measured on an 8,211-token
  // prompt, 1024 gave 624 tok/s, 2048 gave 989, 4096 gave 1,313 and 8192 gave 1,542.
  put('ubatch-size',Number(p.ubatchSize)||8192);
  put('parallel',1);
  // Windows gives a background process a lower CPU priority. Harmless and keeps the
  // worker responsive to the desktop; not a measured speed-up on this machine.
  put('prio',Number(p.prio??2));
  put('prio-batch',Number(p.prioBatch??2));
  put('load-on-startup',loadOnStartup?'true':'false');
  put('sleep-idle-seconds',sleepIdleSeconds);
  put('stop-timeout',10);
  return lines.join('\r\n')+'\r\n';
}
function writePreset(p,dir,{loadOnStartup=true,fit=false}={}){
  fs.mkdirSync(dir,{recursive:true});
  const safe=String(p.model||'model').replace(/[^a-z0-9_.-]/gi,'_').slice(0,60);
  const file=path.join(dir,safe+'-router.ini');
  fs.writeFileSync(file,buildPreset(p,{loadOnStartup,fit}),'utf8');
  return file;
}
module.exports={buildPreset,writePreset};
