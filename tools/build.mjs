import fs from 'node:fs';import path from 'node:path';import {fileURLToPath}from'node:url';import {builtinModules}from'node:module';import {build}from'esbuild';import {build as viteBuild}from'vite';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const builtins=new Set(builtinModules);
const copy=(source,target)=>{fs.mkdirSync(path.dirname(target),{recursive:true});fs.cpSync(source,target,{recursive:true,filter:(src,dst)=>fs.statSync(src).isDirectory()||!fs.existsSync(dst)||fs.statSync(src).size!==fs.statSync(dst).size||!fs.readFileSync(src).equals(fs.readFileSync(dst))});};
copy(root+'/src/native',root+'/app');
// The Moonshine speech worker was replaced by the Nemotron worker. A file that
// an earlier build produced and the current build no longer produces would
// otherwise stay in the packaged application forever.
fs.rmSync(root+'/app/ramo-moonshine-worker.py',{force:true});
// The Pi runtime bundle and the terminal view are no longer part of the application.
fs.rmSync(root+'/app/work/runtime',{recursive:true,force:true});
fs.rmSync(root+'/app/work/terminal',{recursive:true,force:true});
// Stale runtime modules from an earlier build must not ship.
// The runtime modules below live under app/work, which the earlier staged
// builds produced. Create it so a cold build (no app/ from a previous run)
// works too.
fs.mkdirSync(root+'/app/work',{recursive:true});
for(const name of fs.readdirSync(root+'/app/work'))if(name.endsWith('.mjs'))fs.rmSync(path.join(root,'app/work',name),{force:true});
// The runtime ships as JavaScript. The TypeScript sources are bundled below, so
// only the compatibility modules are copied verbatim.
for(const entry of fs.readdirSync(root+'/src/runtime',{withFileTypes:true}))if(entry.isFile()&&!entry.name.endsWith('.ts'))copy(root+'/src/runtime/'+entry.name,root+'/app/work/'+entry.name);
copy(root+'/src/presentation/work',root+'/app/work');
for(const file of ['index.html','ramo-studio.css','ramo-desktop-pages.css','memory.css'])copy(root+'/src/presentation/'+file,root+'/app/'+file);
copy(root+'/vendor/ramo-assets',root+'/app/assets');
for(const file of ['node','node_modules','THIRD-PARTY-NOTICES.txt'])copy(root+'/vendor/'+file,root+'/app/work/'+file);
// The on-device detector's model is a pinned local input like the rest of
// vendor/. It is copied into the application's own work directory, where the
// 64-bit Node host finds it next to the ONNX Runtime binding.
if(fs.existsSync(root+'/vendor/pet-models'))copy(root+'/vendor/pet-models',root+'/app/work/pet-models');
// Step-3 detector inputs are pinned local assets, copied into the app like
// the on-device models. vendor/ itself is gitignored, so this copy is the
// only way the staged application receives them.
if(fs.existsSync(root+'/vendor/detectors'))copy(root+'/vendor/detectors',root+'/app/work/detectors');
const filePlugin={name:'workspace-files',setup(b){b.onResolve({filter:/.*/},args=>{
  if(args.path.startsWith('node:')||args.path==='electron'||builtins.has(args.path))return {path:args.path,external:true};
  // The compatibility modules stay CommonJS and are shipped beside the worker,
  // so the bundle imports them at runtime instead of inlining them.
  if(args.path.endsWith('.cjs'))return {path:args.path,external:true};
  if(args.path==='highlight.js/lib/common')return {path:args.path,external:true};
  let p=path.resolve(args.importer?path.dirname(args.importer):root,args.path);
  if(!fs.existsSync(p)&&p.endsWith('.js')&&fs.existsSync(p.slice(0,-3)+'.ts'))p=p.slice(0,-3)+'.ts';
  return {path:p,namespace:'workspace'};
});b.onLoad({filter:/.*/,namespace:'workspace'},args=>({contents:fs.readFileSync(args.path,'utf8'),loader:args.path.endsWith('.ts')?'ts':args.path.endsWith('.json')?'json':'js'}));}};
const options={absWorkingDir:root,plugins:[filePlugin],tsconfigRaw:{compilerOptions:{target:'ES2022',useDefineForClassFields:true}},logLevel:'info'};
await build({...options,entryPoints:['./src/runtime/worker.ts'],outfile:'app/work/worker.mjs',bundle:true,platform:'node',format:'esm'});
await build({...options,entryPoints:{'session-coordinator':'./src/core/session-coordinator.ts','state':'./src/core/state.ts','evidence':'./src/core/evidence.ts','skills':'./src/runtime/kernel/skills.ts','prompts':'./src/runtime/kernel/prompts.ts'},outdir:'build/core',bundle:true,platform:'node',format:'esm'});
// The browser capability set is bundled on its own so the model-free suite can
// assert its typed surface without booting Electron or a model.
await build({...options,entryPoints:['./src/runtime/capabilities/browser.ts'],outfile:'build/browser-capabilities.js',bundle:true,platform:'node',format:'esm'});
// The untrusted reader is bundled on its own for model-free tests and the
// local 4B reader harness; it never imports a cloud provider.
await build({...options,entryPoints:['./src/runtime/untrusted-reader.ts'],outfile:'build/untrusted-reader.js',bundle:true,platform:'node',format:'esm'});
// L1 is CommonJS so the compatibility-layer service can load it without an
// ESM bridge. The same source is bundled as ESM for the model-free suite.
await build({...options,entryPoints:['./src/runtime/injection-l1.ts'],outfile:'build/injection-l1.cjs',bundle:true,platform:'node',format:'cjs'});
fs.copyFileSync(root+'/build/injection-l1.cjs',root+'/app/work/injection-l1.cjs');
await build({...options,entryPoints:['./src/runtime/hard-boundaries.ts'],outfile:'build/hard-boundaries.js',bundle:true,platform:'node',format:'esm'});
await build({...options,entryPoints:['./src/ui/browser/pane-wire.ts'],outfile:'build/browser-pane-wire.js',bundle:true,platform:'node',format:'esm'});
// Guard and file tools are bundled separately so the model-free suite can test
// the denylist, project scope and fuzzy edit tiers without booting Electron.
await build({...options,entryPoints:{'host-guard':'./src/runtime/capabilities/host-guard.ts','file-tools':'./src/runtime/capabilities/files.ts','shell-tier':'./src/runtime/capabilities/shell-tier.ts','tool-discovery':'./src/runtime/capabilities/tool-discovery.ts'},outdir:'build',bundle:true,platform:'node',format:'esm'});
await build({...options,entryPoints:['./src/compat/domain.js'],outfile:'build/domain.js',bundle:true,platform:'node',format:'esm'});
// Chart spec parser/renderer and markdown are bundled separately for the
// model-free generative-UI suite.
await build({...options,entryPoints:{'chart':'./src/ui/lib/chart.ts'},outdir:'build',bundle:true,platform:'node',format:'esm'});
await build({...options,entryPoints:['./src/ui/lib/markdown.ts'],outfile:'build/markdown.js',bundle:true,platform:'node',format:'esm',external:['highlight.js/lib/common']});
await build({...options,entryPoints:['./src/ui/lib/conversations.ts'],outfile:'build/conversations.js',bundle:true,platform:'node',format:'esm'});
await build({...options,entryPoints:['./src/renderer/application.ts'],outfile:'build/application.js',bundle:true,platform:'node',format:'esm'});
// The model transport is bundled on its own so the model-free suite can drive
// its failure handling directly, without a live model.
await build({...options,entryPoints:['./src/runtime/model/client.ts'],outfile:'build/model-client.js',bundle:true,platform:'node',format:'esm'});
// The memory subsystem is bundled on its own so the model-free suite can drive
// the store, the retrieval arms and the dream stages without a desktop session.
await build({...options,entryPoints:['./src/runtime/memory/index.ts'],outfile:'build/memory.js',bundle:true,platform:'node',format:'esm'});
// The workspace shell is a compatibility module that the renderer bundle
// inlines. It is copied here as well so the model-free suite can load the
// same file and check the conversation it renders, without a browser.
fs.mkdirSync(root+'/build',{recursive:true});
fs.copyFileSync(root+'/src/compat/workspace.js',root+'/build/workspace.js');
fs.writeFileSync(root+'/build/package.json','{"type":"module"}');
// The renderer is the React application built by Vite into the same single
// classic bundle the CSP has always allowed (script-src 'self'). esbuild
// still owns the kernel/worker bundles above.
if(fs.existsSync(root+'/src/ui/app.tsx'))await viteBuild({configFile:path.join(root,'vite.config.ts')});
// esbuild labels custom-namespace modules with their absolute input path. Do
// not leak the builder's home directory into public bundles or source maps.
for(const entry of fs.readdirSync(root+'/app',{recursive:true,withFileTypes:true})){
 if(entry.isFile()&&/\.(?:map|pdb|log)$/i.test(entry.name)){fs.rmSync(path.join(entry.parentPath,entry.name),{force:true});continue;}
 if(!entry.isFile()||!['.js','.cjs','.mjs'].includes(path.extname(entry.name)))continue;
 const file=path.join(entry.parentPath,entry.name),before=fs.readFileSync(file,'utf8');
 const after=before.split(root).join('.').split(root.replace(/\\/g,'/')).join('.').split(root.replace(/\\/g,'\\\\')).join('.');
 if(after!==before)fs.writeFileSync(file,after);
}
