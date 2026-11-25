'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');

test('The 35B admission gate still refuses insufficient RAM and VRAM by default',()=>{
  const {contextPlan}=require('../../app/work/context.cjs');
  const p={vision:true,context:65536,cpuMoe:true,gpu:'all',cpuMoeLayers:35};
  assert.throws(()=>contextPlan(p,{ramFree:15*2**30,freeMiB:7145}),/RAM/);
  assert.throws(()=>contextPlan(p,{ramFree:24*2**30,freeMiB:7000}),/VRAM/);
});

test('The explicit override reports the shortfall instead of blocking the launch',()=>{
  const {contextPlan}=require('../../app/work/context.cjs');
  const p={vision:true,context:65536,cpuMoe:true,gpu:'all',cpuMoeLayers:35};
  const plan=contextPlan(p,{ramFree:15*2**30,freeMiB:7145},{allowLowMemory:true});
  assert.equal(plan.fit,true);
  assert.equal(plan.context,65536);
  assert.match(plan.message,/15\.0 GiB free RAM/);
  assert.match(plan.message,/free VRAM/);
  assert.match(plan.message,/size the layer split and context/);
});

test('The override also covers an unreadable VRAM reading',()=>{
  const {contextPlan}=require('../../app/work/context.cjs');
  const p={vision:true,context:65536,cpuMoe:true,gpu:'all'};
  const plan=contextPlan(p,{ramFree:24*2**30,freeMiB:null},{allowLowMemory:true});
  assert.equal(plan.fit,true);
  assert.match(plan.message,/could not be measured/);
});

test('The original unknown-VRAM 32K override keeps its behaviour',()=>{
  const {contextPlan}=require('../../app/work/context.cjs');
  const p={vision:true,context:65536,cpuMoe:true,gpu:'all'};
  assert.equal(contextPlan(p,{ramFree:24*2**30,freeMiB:null},{allowUnknownVRAM:true}).context,32768);
  assert.throws(()=>contextPlan(p,{ramFree:24*2**30,freeMiB:null}),/VRAM/);
});

test('The router preset keeps the tuned launch settings and defers loading the model',()=>{
  const {buildPreset}=require('../../app/work/llama-preset.cjs');
  const preset=buildPreset({model:'qwen36-tune',modelPath:'C:\\models\\qwen36.gguf',context:65536,gpu:'all',flash:true,kv:'q8_0',threads:12,threadsBatch:12,batchSize:8192,ubatchSize:8192,cpuMoe:true,cpuMoeLayers:35,vision:true,mmprojPath:'C:\\models\\mmproj.gguf'},{loadOnStartup:false});
  assert.match(preset,/^version = 1$/m);
  assert.match(preset,/^\[qwen36-tune\]$/m);
  assert.match(preset,/^load-on-startup = false$/m);
  assert.match(preset,/^model = C:\\models\\qwen36\.gguf$/m);
  assert.match(preset,/^mmproj = C:\\models\\mmproj\.gguf$/m);
  assert.match(preset,/^no-mmproj-offload = true$/m);
  assert.match(preset,/^n-cpu-moe = 35$/m);
  assert.match(preset,/^ctx-size = 65536$/m);
  assert.match(preset,/^cache-type-k = q8_0$/m);
  assert.match(preset,/^cache-type-v = q8_0$/m);
  assert.match(preset,/^threads-batch = 12$/m);
  assert.match(preset,/^batch-size = 8192$/m);
  assert.match(preset,/^ubatch-size = 8192$/m);
  assert.match(preset,/^sleep-idle-seconds = 600$/m);
  assert.match(preset,/^prio = 2$/m);
  assert.match(preset,/^prio-batch = 2$/m);
  assert.match(preset,/^ubatch-size = 8192$/m);
});

test('A preset that loads on startup is available for a direct launch',()=>{
  const {buildPreset}=require('../../app/work/llama-preset.cjs');
  assert.match(buildPreset({model:'m',modelPath:'x.gguf',context:8192,gpu:'all'}),/^load-on-startup = true$/m);
  // Without a tuned value the preset uses the measured micro-batch, not the 512 default.
  assert.match(buildPreset({model:'m',modelPath:'x.gguf',context:8192,gpu:'all'}),/^ubatch-size = 8192$/m);
});

test('The tuned preset may name the GGUF, but only when it is a real GGUF file',()=>{
  const {tunedQwenOptions}=require('../../app/work/vision.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ramo-preset-'));
  try{
    const gguf=path.join(dir,'model.gguf');
    fs.writeFileSync(gguf,Buffer.from([0x47,0x47,0x55,0x46,0x03,0,0,0]));
    fs.writeFileSync(path.join(dir,'qwen36.ini'),'[qwen36-tune]\nmodel = '+gguf+'\nn-cpu-moe = 35\n');
    const options=tunedQwenOptions(path.join(dir,'llama-server.exe'));
    assert.equal(options.modelPath,gguf);
    assert.equal(options.cpuMoeLayers,35);
    fs.writeFileSync(path.join(dir,'qwen36.ini'),'[qwen36-tune]\nmodel = '+path.join(dir,'missing.gguf')+'\n');
    assert.equal(tunedQwenOptions(path.join(dir,'llama-server.exe')).modelPath,undefined);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('The tuned preset also supplies the context window and the idle release',()=>{
  const {tunedQwenOptions}=require('../../app/work/vision.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ramo-preset-'));
  try{
    fs.writeFileSync(path.join(dir,'qwen36.ini'),'[qwen36-tune]\nctx-size = 16384\nsleep-idle-seconds = 600\nubatch-size = 2048\n');
    const options=tunedQwenOptions(path.join(dir,'llama-server.exe'));
    assert.equal(options.context,16384);
    assert.equal(options.sleepIdleSeconds,600);
    assert.equal(options.ubatchSize,2048);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('The tuned preset may ask for speculative decoding, but only with a known type',()=>{
  const {tunedQwenOptions}=require('../../app/work/vision.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ramo-preset-'));
  try{
    const exe=path.join(dir,'llama-server.exe');
    fs.writeFileSync(path.join(dir,'qwen36.ini'),'[qwen36-tune]\nspec-type = draft-mtp\nspec-draft-n-max = 3\n');
    const options=tunedQwenOptions(exe);
    assert.equal(options.specType,'draft-mtp');
    assert.equal(options.specDraftNMax,3);
    fs.writeFileSync(path.join(dir,'qwen36.ini'),'[qwen36-tune]\nspec-type = rm -rf\n');
    assert.equal(tunedQwenOptions(exe).specType,undefined);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('The launch contract asks for HIGH priority, releases the weights when idle, and scales to the requested context',()=>{
  const {llamaLaunchArgs}=require('../../app/work/llama-args.cjs');
  const profile={modelPath:'C:\\models\\qwen36.gguf',model:'qwen36-tune',port:8081,gpu:'all',flash:true,
    cpuMoe:true,cpuMoeLayers:35,kv:'q8_0',threads:12,threadsBatch:12,batchSize:8192,ubatchSize:8192,context:65536};
  const {args,autoFit}=llamaLaunchArgs(profile,{id:'qwen36',projector:['--mmproj','C:\\models\\mmproj.gguf']});
  const value=flag=>args[args.indexOf(flag)+1];
  assert.equal(autoFit,true);
  assert.equal(value('--prio'),'2');
  assert.equal(value('--prio-batch'),'2');
  assert.equal(value('--sleep-idle-seconds'),'600');
  assert.equal(value('-ub'),'8192');
  assert.equal(value('-c'),'65536');
  assert.equal(value('--fit-ctx'),'65536');
  assert.equal(value('--mmproj'),'C:\\models\\mmproj.gguf');
  // The tuned launch is fitted: neither a pinned split nor a pinned layer count, since
  // either overrides the fitter that keeps the 64K context at full throughput.
  assert.equal(args.includes('--n-cpu-moe'),false);
  assert.equal(args.includes('-ngl'),false);
  assert.equal(args.includes('--cpu-moe'),false);
});

test('The override launch still lets llama.cpp size the split and the context',()=>{
  const {llamaLaunchArgs}=require('../../app/work/llama-args.cjs');
  const profile={modelPath:'C:\\models\\qwen36.gguf',model:'qwen36-tune',port:8081,gpu:'all',flash:true,
    cpuMoe:true,cpuMoeLayers:35,kv:'q8_0',threads:12,context:65536};
  const {args,fitted}=llamaLaunchArgs(profile,{id:'qwen36',mode:'override'});
  assert.equal(fitted,true);
  assert.equal(args[args.indexOf('--fit')+1],'on');
  assert.equal(args[args.indexOf('--fit-target')+1],'512');
  assert.equal(args.includes('-c'),false);
  assert.equal(args.includes('--n-cpu-moe'),false);
});

test('The fitted launch keeps the requested context and leaves the split to llama.cpp',()=>{
  const {llamaLaunchArgs}=require('../../app/work/llama-args.cjs');
  const profile={modelPath:'C:\\models\\qwen36.gguf',model:'qwen36-tune',port:8081,gpu:'all',flash:true,
    cpuMoe:true,cpuMoeLayers:30,kv:'q8_0',threads:12,threadsBatch:12,batchSize:8192,ubatchSize:8192,context:16384};
  const {args,autoFit}=llamaLaunchArgs(profile,{id:'qwen36',mode:'fit'});
  const value=flag=>args[args.indexOf(flag)+1];
  assert.equal(autoFit,true);
  assert.equal(value('--fit'),'on');
  assert.equal(value('--fit-ctx'),'16384');
  assert.equal(value('--fit-target'),'512');
  assert.equal(value('-c'),'16384');
  // A pinned split would override the fitter, and -ngl would abort the fit entirely.
  assert.equal(args.includes('--n-cpu-moe'),false);
  assert.equal(args.includes('-ngl'),false);
  assert.equal(value('-ub'),'8192');
});

test('The router preset for a fitted launch leaves the split to llama.cpp',()=>{
  const {buildPreset}=require('../../app/work/llama-preset.cjs');
  const profile={model:'qwen36-tune',modelPath:'C:\\models\\qwen36.gguf',context:65536,gpu:'all',
    cpuMoe:true,cpuMoeLayers:35,batchSize:8192,ubatchSize:8192,threads:12};
  const pinned=buildPreset(profile,{fit:true});
  // A pinned layer count and expert split override the fitter, and both are absent.
  assert.doesNotMatch(pinned,/^n-gpu-layers = /m);
  assert.doesNotMatch(pinned,/^n-cpu-moe = /m);
  assert.doesNotMatch(pinned,/^cpu-moe = /m);
  assert.match(pinned,/^fit = on$/m);
  assert.match(pinned,/^fit-target = 512$/m);
  assert.match(pinned,/^fit-ctx = 65536$/m);
  assert.match(pinned,/^ctx-size = 65536$/m);
  assert.match(pinned,/^ubatch-size = 8192$/m);
  assert.match(pinned,/^prio = 2$/m);
  assert.match(pinned,/^sleep-idle-seconds = 600$/m);
  // The non-fitted preset keeps the pinned placement it had before.
  const explicit=buildPreset(profile,{fit:false});
  assert.match(explicit,/^n-gpu-layers = all$/m);
  assert.match(explicit,/^n-cpu-moe = 35$/m);
  assert.doesNotMatch(explicit,/^fit = on$/m);
});

test('A router preset without a fitted launch still starts unloaded',()=>{
  const {buildPreset}=require('../../app/work/llama-preset.cjs');
  assert.match(buildPreset({model:'m',modelPath:'x.gguf',context:8192,gpu:'all'},{loadOnStartup:false}),/^load-on-startup = false$/m);
  assert.match(buildPreset({model:'m',modelPath:'x.gguf',context:8192,gpu:'all'}),/^load-on-startup = true$/m);
});
