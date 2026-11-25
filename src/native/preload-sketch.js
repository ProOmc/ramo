'use strict';
const {contextBridge, ipcRenderer} = require('electron');
// The overlay is display-only: it receives validated strokes and reports when
// its fade-out has finished. It never asks the main process for anything else.
contextBridge.exposeInMainWorld('ocSketch', Object.freeze({
  onDraw: (cb) => ipcRenderer.on('pet:sketch', (_, data) => cb(data)),
  onClear: (cb) => ipcRenderer.on('pet:sketch-clear', () => cb()),
  done: () => ipcRenderer.send('pet:sketch-done')
}));
