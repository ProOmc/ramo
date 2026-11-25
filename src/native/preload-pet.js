'use strict';
const {contextBridge, ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('ocPet', Object.freeze({
  onState:(cb)=>ipcRenderer.on('pet:state',(_,d)=>cb(d)),
  onCursor:(cb)=>ipcRenderer.on('pet:cursor',(_,d)=>cb(d)),
  onAudio:(cb)=>ipcRenderer.on('pet:audio',(_,d)=>cb(d)),
  onCaption:(cb)=>ipcRenderer.on('pet:caption',(_,d)=>cb(d)),
  onSettings:(cb)=>ipcRenderer.on('pet:settings',(_,d)=>cb(d)),
  audioDone:()=>ipcRenderer.send('pet:audio-done'),
  close:()=>ipcRenderer.send('pet:close'),
  hide:()=>ipcRenderer.send('pet:close')
}));