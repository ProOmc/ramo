/* User-selected raster attachments shared by every conversation. No capture or external upload. */
(function(root){
 'use strict';
 if(root.RamoImages)return;
 const MAX_FILES=4, MAX_BYTES=20*1024*1024, MAX_EDGE=1536;
 const node=(tag,cls)=>{const n=document.createElement(tag);if(cls)n.className=cls;return n;};
 function raster(bytes){return bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71||bytes[0]===255&&bytes[1]===216&&bytes[2]===255||String.fromCharCode(...bytes.slice(0,6)).match(/^GIF8[79]a$/)||String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'||bytes[0]===66&&bytes[1]===77;}
 async function prepare(file){
  if(!file||file.size>MAX_BYTES)throw Error((file?.name||'Image')+': choose an image under 20 MiB.');
  const header=new Uint8Array(await file.slice(0,16).arrayBuffer());
  if(!raster(header))throw Error((file.name||'File')+': use a PNG, JPEG, WebP, GIF or BMP image. SVG and document files are not supported here.');
  const url=URL.createObjectURL(file),image=new Image();let canvas;
  try{
   await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error((file.name||'Image')+': this image could not be decoded. Try exporting it as PNG or JPEG.'));image.src=url;});
   if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>50000000)throw Error('This image is too large to decode safely. Export a smaller PNG or JPEG.');
   const scale=Math.min(1,MAX_EDGE/Math.max(image.naturalWidth,image.naturalHeight));canvas=node('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
   const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('Image preparation is unavailable in this browser.');ctx.drawImage(image,0,0,canvas.width,canvas.height);
   const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let transparent=false;for(let i=3;i<pixels.length;i+=4){if(pixels[i]<255){transparent=true;break;}}
   let dataURL=canvas.toDataURL(transparent?'image/png':'image/jpeg',.85);
   // Keep useful transparency; flatten very large alpha images to bound prompt memory.
   if(transparent&&dataURL.length>4*1024*1024*4/3){ctx.globalCompositeOperation='destination-over';ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);dataURL=canvas.toDataURL('image/jpeg',.85);}
   const split=dataURL.indexOf(',');if((dataURL.length-split-1)*3/4>4*1024*1024)throw Error('Prepared image is too large. Export a smaller JPEG or PNG and try again.');return {type:'image',data:dataURL.slice(split+1),mimeType:dataURL.slice(5,dataURL.indexOf(';')),name:String(file.name||'Pasted image').slice(0,180)};
  }finally{image.src='';URL.revokeObjectURL(url);if(canvas){canvas.width=1;canvas.height=1;}}
 }
 function source(image){return image&&/^image\/(png|jpeg|webp|gif|bmp)$/.test(image.mimeType)&&typeof image.data==='string'&&/^[A-Za-z0-9+/=]+$/.test(image.data)?'data:'+image.mimeType+';base64,'+image.data:'';}
 function thumbnails(images){const row=node('div','oc-image-thumbnails');for(const image of images||[]){const src=source(image);if(!src)continue;const img=node('img');img.src=src;img.alt=image.name||'Attached image';img.title=img.alt;img.loading='lazy';row.append(img);}return row;}
 function mount(host,options){
  const tray=node('div','oc-image-attachments'),pick=node('button','oc-image-pick'),input=node('input'),previews=node('div','oc-image-previews'),message=node('span','oc-image-notice');let processing=false,revision=0,owner=options.owner();
  pick.type='button';pick.textContent='Attach images';pick.setAttribute('aria-label','Attach images');pick.title='Up to 4 images, 20 MiB each. Paste or drop images into the composer.';input.type='file';input.accept='image/png,image/jpeg,image/webp,image/gif,image/bmp';input.multiple=true;input.hidden=true;input.setAttribute('aria-label','Choose image files');message.setAttribute('role','status');tray.append(pick,input,previews,message);host.append(tray);
  const report=text=>{message.textContent=text||'';options.notice?.(text||'');};
  function sync(){const next=options.owner();if(next!==owner){owner=next;revision++;options.clear?.();report('');}const disabled=processing||!options.enabled();pick.disabled=disabled;for(const b of previews.querySelectorAll('button'))b.disabled=disabled;const images=options.get()||[];if(previews._images!==images){previews._images=images;previews.replaceChildren();images.forEach((image,index)=>{const figure=node('span','oc-image-preview'),img=node('img'),remove=node('button');img.src=source(image);img.alt=image.name||'Attached image';img.title=img.alt;remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remove image '+(index+1));remove.disabled=disabled;remove.onclick=()=>{if(!options.enabled()||processing)return;options.set((options.get()||[]).filter((_,i)=>i!==index));sync();};figure.append(img,remove);previews.append(figure);});}tray.classList.toggle('has-images',images.length>0);tray.dataset.processing=String(processing);options.onSync?.();}
  async function add(files){
   if(!files.length)return;if(processing){report('Wait for image preparation to finish.');return;}
   if(!options.enabled()){report('Stop the active response before adding or changing images.');return;}
   if(options.occupied?.()){report('Remove the attached text document before adding images.');return;}
   sync();const start=revision,startOwner=owner,current=options.get()||[];
   if(current.length+files.length>MAX_FILES){report('Attach up to 4 images. Remove an image or choose fewer files.');return;}
   processing=true;report('Preparing images…');sync();const prepared=[];
   try{for(const file of files){prepared.push(await prepare(file));if(start!==revision||startOwner!==options.owner())return;}if(!options.enabled()||options.occupied?.())throw Error('The composer changed while preparing images. Please attach them again.');const combined=[...current,...prepared];if(combined.reduce((total,image)=>total+image.data.length*3/4,0)>8*1024*1024)throw Error('These prepared images exceed 8 MiB together. Attach fewer images or export smaller copies.');options.set(combined);report('');}
   catch(error){report(error.message||String(error));}finally{processing=false;input.value='';sync();}
  }
  pick.onclick=()=>{if(options.enabled()&&!processing){if(options.occupied?.())report('Remove the attached text document before adding images.');else input.click();}};input.onchange=()=>add(Array.from(input.files||[]));
  host.addEventListener('paste',event=>{if(!options.active())return;const files=Array.from(event.clipboardData?.items||[]).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);if(files.length){event.preventDefault();add(files);}});
  host.addEventListener('dragover',event=>{if(options.active()&&Array.from(event.dataTransfer?.types||[]).includes('Files')){event.preventDefault();event.dataTransfer.dropEffect=options.enabled()?'copy':'none';}});
  host.addEventListener('drop',event=>{if(!options.active())return;const files=Array.from(event.dataTransfer?.files||[]);if(files.length){event.preventDefault();add(files);}});
  sync();return {sync,clear(){revision++;options.set([]);report('');sync();},get processing(){return processing;},element:tray};
 }
 root.RamoImages={prepare,mount,thumbnails,source,MAX_FILES,MAX_BYTES,MAX_EDGE};
 if(typeof document==='undefined')return;
 const imageStyle=document.createElement('style');imageStyle.id='ramo-image-style';imageStyle.textContent=".oc-image-attachments{display:flex;align-items:center;gap:8px;flex-wrap:wrap;max-width:100%;font:12px/1.4 \"Segoe UI\",sans-serif;color:var(--oc-text,#edf1ef)}.oc-image-pick{font:inherit!important;border:1px solid var(--oc-rule,#46524c)!important;border-radius:9px!important;background:var(--oc-field,#282e2b)!important;color:inherit!important;padding:6px 10px!important;cursor:pointer;white-space:nowrap}.oc-image-pick:disabled,.oc-image-preview button:disabled{opacity:.45;cursor:default}.oc-image-previews,.oc-image-thumbnails{display:flex;gap:8px;flex-wrap:wrap}.oc-image-preview{position:relative;display:inline-flex;margin-right:3px}.oc-image-preview img{width:52px;height:44px;object-fit:contain;border:1px solid var(--oc-rule,#46524c);border-radius:7px;background:var(--oc-paper,#202324)}.oc-image-preview button{position:absolute;right:-5px;top:-5px;border:1px solid var(--oc-rule,#46524c);border-radius:50%;width:20px;height:20px;padding:0;background:var(--oc-paper,#202324);color:var(--oc-text,#edf1ef);font-size:15px;line-height:16px;cursor:pointer}.oc-image-notice{max-width:100%;color:var(--oc-soft,#c9b88d);overflow-wrap:anywhere}.oc-image-notice:empty{display:none}.oc-image-thumbnails{margin:10px 0}.oc-image-thumbnails img{width:140px;height:110px;max-width:100%;object-fit:contain;border:1px solid var(--oc-rule,#46524c);border-radius:9px;background:var(--oc-paper,#202324)}.ow-composer>.oc-image-attachments{margin-bottom:8px}#ramo-composer-v180>.oc-image-attachments{position:absolute;left:8px;right:8px;bottom:calc(100% + 9px);padding:6px 8px;border-radius:10px;background:var(--oc-bg,#202324);pointer-events:auto}#ramo-composer-v180:has(.oc-image-attachments.has-images)>.oc-attached-text{display:none}#ramo-composer-v180:has(.oc-queued)>.oc-image-attachments{bottom:calc(100% + 40px)}#ramo-composer-v180 .oc-image-pick:focus-visible,.oc-image-preview button:focus-visible{outline:2px solid var(--oc-focus,#a6c9b7);outline-offset:2px}@media(max-width:550px){.oc-image-thumbnails img{width:100px;height:85px}.oc-image-preview img{width:42px;height:38px}}\n";document.head.append(imageStyle);
 let mounted=null,lastHost=null;
 setInterval(()=>{
  const ui=root.__ramoWorkspaceUIActive,api=root.__ramoAssistantInstance,host=ui?.composer;if(!host||!api)return;
  if(host!==lastHost){lastHost=host;const empty=[];let ownDocument=null;
   const active=()=>ui.currentPage==='home'&&!document.body.classList.contains('oc-work-active')&&!root.ramoDesktop?.pages?.current?.();
   mounted=mount(host,{owner:()=>api.engine?.store?.data?.activeChatId,get:()=>api.pendingDocument?.kind==='images'?api.pendingDocument.images:empty,set:images=>{if(images.length){ownDocument={kind:'images',name:images.length===1?images[0].name:images.length+' images',images,content:''};api.pendingDocument=ownDocument;}else if(api.pendingDocument?.kind==='images'){api.pendingDocument=null;ownDocument=null;}},clear:()=>{if(api.pendingDocument?.kind==='images')api.pendingDocument=null;ownDocument=null;},enabled:()=>active()&&!api.session,active,onSync:()=>ui._syncComposerState?.(true),occupied:()=>!!api.pendingDocument&&api.pendingDocument.kind!=='images',notice:text=>{if(text)ui._showSmallStatus?.(text);}});
   const syncComposer=ui._syncComposerState;ui._syncComposerState=function(...args){const result=syncComposer?.apply(this,args),button=host.querySelector('#ramo-composer-send');if(button){if(mounted?.processing){button.disabled=true;button.title='Preparing images…';}else if(active()&&!api.session&&api.pendingDocument?.kind==='images'&&api.pendingDocument.images?.length){button.disabled=false;button.setAttribute('aria-label','Send');button.title='Send images (Enter)';}}return result;};
   // Existing button/Enter handlers call the method dynamically. Block half-decoded sends.
   const send=ui._sendComposer;ui._sendComposer=function(){mounted.sync();if(mounted.processing){this._showSmallStatus?.('Wait for image preparation to finish.');return;}const input=this.composer?.querySelector('#ramo-command-input-v180');if(api.pendingDocument?.kind==='images'&&!input?.value.trim()){
    if(api.session){this._showSmallStatus?.('Stop the active response before sending images.');return;}
    if(root.ramoDesktop?.modelSummary&&!Array.isArray(root.__ramoModelRegistry)){this._showSmallStatus?.('Checking local model status. Your images are preserved; send again when its status appears.');return;}
    const profile=(root.__ramoModelRegistry||[]).find(p=>p.model===api.modelName());if(profile&&profile.kind!=='ollama'&&(!profile.ready||/unloaded|sleeping/i.test(profile.state||''))){this._showSmallStatus?.('Start this model in the chat header first. Your images are preserved.');return;}
    Promise.resolve(api.askAI({TEXT:''})).catch(error=>this._showSmallStatus?.(error.message||String(error)));return;
   }return send.call(this);};
  }
  mounted.sync();
 },200);
})(typeof window==='undefined'?globalThis:window);
