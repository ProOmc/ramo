'use strict';
const {contextBridge,ipcRenderer}=require('electron');
// Restricted methods, no arbitrary IPC, command strings, shell or file paths from the page.
contextBridge.exposeInMainWorld('ramoModels', Object.freeze({
  status:()=>ipcRenderer.invoke('ramo:models:status'),
  start:id=>ipcRenderer.invoke('ramo:models:start',id),
  startServerOnly:id=>ipcRenderer.invoke('ramo:models:startServerOnly',id),
  startWithOverride:id=>ipcRenderer.invoke('ramo:models:startWithOverride',id),
  stop:id=>ipcRenderer.invoke('ramo:models:stop',id),
  wake:id=>ipcRenderer.invoke('ramo:models:wake',id),
  choose:(id,type)=>ipcRenderer.invoke('ramo:models:choose',id,type),
  update:(id,options)=>ipcRenderer.invoke('ramo:models:update',id,options),
  add:(name,port,kind)=>ipcRenderer.invoke('ramo:models:add',name,port,kind),
  remove:id=>ipcRenderer.invoke('ramo:models:remove',id)
}));
