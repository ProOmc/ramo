'use strict';
const fs=require('fs'),path=require('path'),os=require('os');
function validateImages(images){
 if(images===undefined)return undefined;
 if(!Array.isArray(images)||images.length>4)throw Error('Attach at most four images.');let total=0;
 return images.map(img=>{
  if(!['image/png','image/jpeg','image/webp'].includes(img?.mimeType))throw Error('Unsupported image format; use PNG, JPEG or WebP.');
  if(typeof img.data!=='string'||!img.data.length||img.data.length>6*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(img.data))throw Error('Image must contain bounded local base64 data.');
  const bytes=Buffer.from(img.data,'base64');total+=bytes.length;
  if(bytes.length>4*1024*1024||total>8*1024*1024)throw Error('Images exceed the 8 MiB request limit.');
  const magic=img.mimeType==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):img.mimeType==='image/jpeg'?bytes[0]===255&&bytes[1]===216:bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
  if(!magic)throw Error('Image data does not match its format.');
  return {type:'image',data:img.data,mimeType:img.mimeType,name:String(img.name||'image').slice(0,200)};
 });
}
function isGGUF(file){
  let fd;try{fd=fs.openSync(file,'r');const magic=Buffer.alloc(4);const n=fs.readSync(fd,magic,0,4,0);return n===4&&magic.toString()==='GGUF';}
  catch{return false;}finally{if(fd!==undefined)try{fs.closeSync(fd);}catch{}}
}
function snapshotDir(){
  return path.join(os.homedir(),'.cache','huggingface','hub','models--ggml-org--Qwen3.6-35B-A3B-GGUF','snapshots');
}
// The 35B GGUF usually lives in the Hugging Face cache, not in Ollama's store.
// Read only the file name; never download, copy or mutate it.
function findQwenModel(){
  try{for(const entry of fs.readdirSync(snapshotDir())){const file=path.join(snapshotDir(),entry,'Qwen3.6-35B-A3B-Q4_K_M.gguf');if(isGGUF(file))return file;}}catch{}
  return '';
}
function findProjector(modelPath){
 const name='mmproj-Qwen3.6-35B-A3B-Q8_0.gguf',near=path.join(path.dirname(modelPath||''),name);
 if(fs.existsSync(near))return near;
 const snapshots=snapshotDir();
 try{for(const entry of fs.readdirSync(snapshots)){const file=path.join(snapshots,entry,name);if(fs.existsSync(file))return file;}}catch{}
 return '';
}
function projectorArgs(p){return p.vision&&p.mmprojPath?['--mmproj',p.mmprojPath,'--no-mmproj-offload','--image-max-tokens','2048']:[];}
function tunedQwenOptions(exe){
 // Read only known numerical settings from the user's existing preset; never execute it.
 try{const file=path.join(path.dirname(exe),'qwen36.ini'),text=fs.readFileSync(file,'utf8'),section=text.split(/\[qwen36-tune\]/i)[1]?.split(/\n\s*\[/)[0];if(!section)return {};
  const result={};for(const [key,name,lo,hi] of [['n-cpu-moe','cpuMoeLayers',1,40],['threads','threads',1,128],['threads-batch','threadsBatch',1,128],['batch-size','batchSize',32,32768],['ubatch-size','ubatchSize',32,32768],['ctx-size','context',4096,262144],['sleep-idle-seconds','sleepIdleSeconds',0,86400],['spec-draft-n-max','specDraftNMax',1,16]]){const match=section.match(new RegExp('^\\s*'+key+'\\s*=\\s*(\\d+)\\s*$','im')),n=Number(match?.[1]);if(Number.isInteger(n)&&n>=lo&&n<=hi)result[name]=n;}
  // Speculative decoding type, when the preset asks for one. Only the known llama.cpp
  // values are accepted; anything else is ignored rather than passed through.
  const spec=section.match(/^\s*spec-type\s*=\s*([a-z0-9,-]+)\s*$/im)?.[1]?.trim().toLowerCase();
  if(spec&&/^(none|draft-simple|draft-eagle3|draft-mtp|draft-dflash|draft-dspark|ngram-simple|ngram-map-k|ngram-map-k4v|ngram-mod|ngram-cache)$/.test(spec))result.specType=spec;
  // The tuned preset may also name the GGUF. Accept it only when it is an existing GGUF file.
  const model=section.match(/^\s*model\s*=\s*(.+?)\s*$/im)?.[1]?.trim();
  if(model&&/^[A-Za-z]:[\\/]/.test(model)&&isGGUF(model))result.modelPath=model;
  return result;
 }catch{return {};}
}
function hasImages(body){return (body.messages||[]).some(m=>m.images?.length||Array.isArray(m.content)&&m.content.some(c=>['image','image_url'].includes(c.type)));}
module.exports={validateImages,findProjector,findQwenModel,projectorArgs,hasImages,tunedQwenOptions,isGGUF};
