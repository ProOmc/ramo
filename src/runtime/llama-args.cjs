'use strict';
// Builds the llama-server command line for a configured profile.
// Pure and separate from the Electron controller so the launch contract can be checked
// without a desktop session.
//
// The expert split and context window compete for the same VRAM. Ramo leaves
// layer placement to llama.cpp's fitter unless the user deliberately overrides it.
function llamaLaunchArgs(p,{id='qwen36',mode='normal',projector=[]}={}){
  const args=[];
  const gpuAll=String(p.gpu)==='all';
  // 'override' lets llama.cpp size both the split and the context to the free memory.
  // Every other launch of the 35B profile is fitted: the context is pinned to what the
  // user asked for and the fitter owns the layer placement.
  const fitted=mode==='override'&&gpuAll;
  const autoFit=(mode==='fit'||(mode==='normal'&&id==='qwen36'))&&gpuAll;
  args.push('-m',p.modelPath,'--alias',p.model,'--host','127.0.0.1','--port',String(p.port));
  if(fitted||autoFit){
    args.push('--fit','on','--fit-target',String(p.fitTarget||512),'--fit-ctx',String(p.context||65536));
  }else{
    args.push('-ngl',String(p.gpu||'all'));
  }
  args.push('-fa',p.flash===false?'off':'on','-np','1','--jinja');
  // Windows gives a background process a lower CPU priority. This is not a measured
  // speed-up on this machine (the apparent 4x was a GPU clock ramp artefact in
  // llama-bench), but it is harmless and keeps the worker responsive to the desktop.
  args.push('--prio',String(p.prio??2),'--prio-batch',String(p.prioBatch??2));
  // Release the weights when the model has been idle so the GPU and RAM are free for
  // other work. Matches the tuned qwen36.ini value.
  args.push('--sleep-idle-seconds',String(p.sleepIdleSeconds||600));
  // The context is pinned except in the explicit low-memory override, which lets the
  // fitter choose a smaller one.
  if(!fitted)args.push('-c',String(p.context||65536));
  // A pinned CPU-MoE split overrides the fitter, so a fitted launch leaves it unset. The
  // only pinned fallback is the explicit blanket offload, never a guessed number.
  if(p.cpuMoe&&!fitted&&!autoFit){
    if(id==='qwen36'&&p.cpuMoeLayers)args.push('--n-cpu-moe',String(p.cpuMoeLayers));
    else if(!id)args.push('--cpu-moe');
  }
  args.push('-t',String(p.threads||12));
  if(id==='qwen36'){
    if(p.threadsBatch)args.push('-tb',String(p.threadsBatch));
    if(p.batchSize)args.push('-b',String(p.batchSize));
    if(p.ubatchSize)args.push('-ub',String(p.ubatchSize));
  }
  if(p.kv){args.push('-ctk',p.kv,'-ctv',p.kv);}
  // Speculative decoding, when the profile asks for it. The draft is always verified by
  // the target model, so the generated text is unchanged.
  if(p.specType){args.push('--spec-type',String(p.specType));if(p.specDraftNMax)args.push('--spec-draft-n-max',String(p.specDraftNMax));}
  if(id==='qwen36')args.push(...projector);
  return {args,fitted,autoFit};
}
module.exports={llamaLaunchArgs};
