import '../compat/ramo-harness-core.js';
import {AssistantEngine,AssistantExtension}from'../compat/domain.js';
import {RamoWorkspaceUI}from'../compat/workspace.js';
import {ApplicationState}from'../core/state.js';
import {RamoApplication}from'./application.js';
import {MemorySurface}from'./memory-surface.js';
import type {LegacyObject}from'./legacy-boundary.js';
import defaults from '../config/defaults.json';
import '../compat/ramo-overlays.js';
import '../compat/ramo-conversations.js';
import '../compat/ramo-chat-dialogs.js';
import '../compat/ramo-studio-shell.js';
import '../compat/ramo-desktop-pages.js';
import '../compat/ramo-keys.js';
import '../compat/images.js';

window.RamoState=new ApplicationState(defaults);
const configNames=new Set(['Assistant Model','Research Report Model','Ollama Chat URL','Remote Ollama URL','Research Model Backend','Research OpenAI Chat URL','Research Report Context','Research Budget Seconds','Research Maximum Rounds','Voice Enabled']);
window.RamoState.subscribe((name:string)=>{if(!configNames.has(name))return;const saved=Object.fromEntries([...configNames].map(key=>[key,window.RamoState.get(key)]));try{localStorage.setItem('RAMO_UNIFIED_SETTINGS',JSON.stringify(saved));}catch(error){console.error('Ramo settings could not be saved.');}});
const application=new RamoApplication(window.ramoDesktop,(host,storage)=>new AssistantEngine(host,storage));
window.RamoApplication=application;
window.RamoRuntime={request:(method:string,params?:Record<string,unknown>)=>application.request(method,params),onEvent:(callback:(event:LegacyObject)=>void)=>application.onEvent(callback)};
const assistant:LegacyObject=new AssistantExtension();window.__ramoAssistantInstance=assistant;
assistant.clearContext=()=>application.clearContext();
// The memory surface is a viewer and an editor over the store the worker
// owns. It reads the projection the worker writes and sends commands back
// through the inbox, so the interface never writes a fact itself.
const memory=new MemorySurface(window.ramoDesktop);window.RamoMemory=memory;
assistant.openMemories=async()=>{try{await memory.open();}catch(error){assistant.setVariable('UI_TEXT_OUT',error instanceof Error?error.message:String(error));}};
assistant.rememberText=async(args:LegacyObject)=>{await assistant.initialize();if(assistant.engine.store.data.activeChatId!=='main')throw Error('Personal memory learning is limited to Main; switch to Main to save global memories.');const value=String(args?.TEXT||'').trim();if(!value)return;const reason=await memory.remember(value);assistant.setVariable('UI_TEXT_OUT',reason||'Memory saved.');};
const openResearch=assistant.openResearch.bind(assistant);
assistant.openResearch=async()=>{await openResearch();const workspace=assistant.workspace;if(!workspace?.body||workspace.body.querySelector('[data-unified-research]'))return;const bar=document.createElement('div');bar.className='bar';bar.dataset.unifiedResearch='true';const input=document.createElement('input');input.placeholder='Research a topic…';input.setAttribute('aria-label','Research topic');input.style.flex='1';const start=document.createElement('button');start.textContent='Start research';start.onclick=()=>{if(!input.value.trim())return;workspace.close();void application.prompt(assistant,input.value.trim(),{research:true}).catch(error=>assistant._setError(error.message));};bar.append(input,start);workspace.body.prepend(bar);};
void application.initialize(assistant).then(()=>{
 const ui=new RamoWorkspaceUI();ui.start();
}).catch(error=>{document.body.textContent='Ramo could not open local data: '+error.message;});

