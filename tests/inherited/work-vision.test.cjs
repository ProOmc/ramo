'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
test('Work accepts bounded actual raster image content and rejects remote, malformed and excessive payloads',()=>{
 const {validateImages}=require('../../app/work/vision.cjs');
 const valid={type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',name:'test.png'};
 assert.equal(validateImages([valid])[0].mimeType,'image/png');
 assert.throws(()=>validateImages([{...valid,mimeType:'image/svg+xml'}]),/format/);
 assert.throws(()=>validateImages([{...valid,data:'https://example.com/a.png'}]),/base64/);
 assert.throws(()=>validateImages(Array(5).fill(valid)),/four/);
});
test('Vision launch locates the existing matched projector without changing offload settings',()=>{
 const {projectorArgs}=require('../../app/work/vision.cjs');
 assert.deepEqual(projectorArgs({mmprojPath:'local.gguf',vision:true}),['--mmproj','local.gguf','--no-mmproj-offload','--image-max-tokens','2048']);
 assert.deepEqual(projectorArgs({vision:false}),[]);
});
test('Vision startup reserves RAM and VRAM and refuses a tuned launch under insufficient game headroom',()=>{
 const {contextPlan}=require('../../app/work/context.cjs'),p={vision:true,context:65536,cpuMoe:true,gpu:'all'};
 assert.equal(contextPlan(p,{ramFree:20*2**30,freeMiB:7000}).context,65536);
 assert.throws(()=>contextPlan(p,{ramFree:16*2**30,freeMiB:7000}),/RAM/);
 assert.throws(()=>contextPlan(p,{ramFree:20*2**30,freeMiB:4500}),/VRAM/);
 assert.throws(()=>contextPlan({...p,cpuMoeLayers:35},{ramFree:15*2**30,freeMiB:5350}),/RAM/);
 assert.throws(()=>contextPlan({...p,context:16384,cpuMoeLayers:35},{ramFree:15*2**30,freeMiB:5350}),/RAM/);
});
test('Existing tuned INI retains expert placement, threads and large input batches',()=>{
 const fs=require('fs'),os=require('os'),path=require('path'),{tunedQwenOptions}=require('../../app/work/vision.cjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ramo-tuned-'));
 try{fs.writeFileSync(path.join(dir,'qwen36.ini'),'[qwen36-tune]\nn-cpu-moe = 35\nthreads = 12\nthreads-batch = 12\nbatch-size = 8192\nubatch-size = 8192\ncommand = ignored\n');assert.deepEqual(tunedQwenOptions(path.join(dir,'llama-server.exe')),{cpuMoeLayers:35,threads:12,threadsBatch:12,batchSize:8192,ubatchSize:8192});}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Chat budgeting treats image media separately from base64 text and preserves image imports',()=>{
 const core=require('../../src/compat/ramo-harness-core.js');
 const image='iVBORw0KGgo'+('A'.repeat(200000));
 const fitted=core.budgetMessages([{role:'system',content:'Helpful assistant'},{role:'user',content:'Read this picture',images:[image]}],16384,1400,[],'Read this picture');
 assert.equal(fitted.messages.at(-1).images[0],image);assert.ok(fitted.estimatedTokens<5000);
});
