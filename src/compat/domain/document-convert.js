import {text,validURL} from './helpers.js';

/**
 * Renderer side of local document conversion. The actual conversion happens in
 * the Electron main process (ramo:document:convert -> Python worker). This
 * module only decides whether a URL/file needs it and unwraps the result.
 * No cloud call, no raw bytes handed to the model.
 */
// Only binary document types the reader cannot handle itself. Plain text,
// HTML and JSON already work in web_read, so they must not be diverted here.
const EXT = /\.(?:pdf|docx?|xlsx?|pptx?|csv|zip|epub|msg|rtf|od[stp]|wav|mp3|m4a)(?:[?#].*)?$/i;
const MIME = /^(?:application\/(?:pdf|vnd\.openxmlformats-|msword|vnd\.ms-|zip|epub\+zip|vnd\.oasis)|audio\/(?:wav|mpeg|mp4))/i;

function convertibleName(name,url){
  const fromName=text(name),fromURL=validURL(url)?new URL(url).pathname:'';
  return EXT.test(fromName)||EXT.test(fromURL);
}
function convertibleMime(contentType){return MIME.test(text(contentType));}

/** True when a fetched URL or attachment should go through MarkItDown. */
function needsConversion({name='',url='',contentType=''}={}){
  return convertibleName(name,url)||convertibleMime(contentType);
}

function bridge(){
  const api=globalThis.ramoDesktop?.documents;
  return api&&typeof api.convert==='function'?api:null;
}
function available(){return !!bridge();}

/**
 * Convert a document through the local worker. Returns null when no bridge is
 * present (browser-only builds) so callers can keep their existing behaviour.
 */
async function convertDocument(input,signal){
  const api=bridge();
  if(!api)return null;
  try{
    const result=await api.convert({...input});
    if(signal?.aborted)return null;
    if(!result?.ok||!text(result.markdown).trim())return {ok:false,error:text(result?.error||'No text extracted')};
    return {ok:true,markdown:text(result.markdown),chars:Number(result.chars)||0,
      ocr_used:!!result.ocr_used,ocr_error:text(result.ocr_error),ocr_model:text(result.ocr_model),name:text(result.name||input.name)};
  }catch(e){return {ok:false,error:text(e?.message||e).slice(0,300)};}
}

export {needsConversion,convertibleName,convertibleMime,available,convertDocument};
