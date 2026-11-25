'use strict';
/* App-owned, per-user document runtime. It never installs or invokes an LLM.
   OCRia-nano-1 is an 8.1M-parameter CPU document parser run by LiteParse. */
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const MARKITDOWN='markitdown[pdf,docx,xlsx,pptx]==0.1.9',LITEPARSE='liteparse==2.21.2';
const pending=new Map();
function run(command,args,options={}){return new Promise((resolve,reject)=>{
 const child=spawn(command,args,{windowsHide:true,shell:false,stdio:['ignore','ignore','pipe'],...options});let error='';
 child.stderr.on('data',chunk=>{error=(error+chunk.toString()).slice(-4000);});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error((error.trim()||command+' exited '+code).slice(-1200))));
});}
function pythonExecutable(root){return path.join(root,process.platform==='win32'?'Scripts/python.exe':'bin/python');}
async function findPython(){for(const candidate of process.platform==='win32'?[['py',['-3.12']],['py',['-3.11']],['python',[]]]:[['python3',[]],['python',[]]]){try{await run(candidate[0],[...candidate[1],'-c','import sys; assert sys.version_info >= (3,10)']);return candidate;}catch{}}throw Error('Python 3.10–3.14 is required for local document tools. Install Python, then retry the document.');}
async function ensure(dataDir,{ocr=false}={}){
 if(process.env.RAMO_MARKITDOWN_PYTHON)return process.env.RAMO_MARKITDOWN_PYTHON;
 const root=path.join(dataDir,'documents-venv'),python=pythonExecutable(root),key=root+':'+!!ocr;
 if(pending.has(key))return pending.get(key);
 const task=(async()=>{
  const packageMarker=path.join(root,'.ramo-document-packages-v1'),ocrMarker=path.join(root,'.ramo-ocria-nano-1-v1');
  if(!fs.existsSync(packageMarker)){
   const base=await findPython();fs.mkdirSync(root,{recursive:true});
   if(!fs.existsSync(python))await run(base[0],[...base[1],'-m','venv',root]);
   await run(python,['-m','pip','install','--disable-pip-version-check',MARKITDOWN,LITEPARSE]);
   fs.writeFileSync(packageMarker,JSON.stringify({markitdown:'0.1.9',liteparse:'2.21.2'}));
  }
  if(ocr&&!fs.existsSync(ocrMarker)){
   // LiteParse verifies its pinned model hashes. The separately licensed OCR
   // weights and ONNX Runtime are downloaded only on the first OCR fallback.
   await run(python,['-c','from liteparse import models; models.pull("ocria-nano")']);
   fs.writeFileSync(ocrMarker,'OCRia-nano-1; CPU; installed by LiteParse\n');
  }
  return python;
 })().catch(error=>{pending.delete(key);throw error;});
 pending.set(key,task);return task;
}
module.exports={ensureDocumentRuntime:ensure,MARKITDOWN_PACKAGE:MARKITDOWN,LITEPARSE_PACKAGE:LITEPARSE,OCR_MODEL_ID:'OCRia-nano-1'};
