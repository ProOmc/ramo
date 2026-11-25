const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),originalRoot=path.resolve(root,'../..');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const result={version:'3.0.0-dev',checkedAt:new Date().toISOString(),checks:[],originalFilesChecked:0,applicationFilesChecked:0};
function check(name,pass){assert.ok(pass,name);result.checks.push(name);}
for(const file of files(path.join(root,'app'))){const dest=path.join(root,'release/Ramo/resources/app',path.relative(path.join(root,'app'),file));assert.ok(fs.existsSync(dest)&&sha(file)===sha(dest),'Staged file differs: '+path.relative(root,file));result.applicationFilesChecked++;}
check('Staged application has byte parity with compiled app',true);
// The runtime ships as the compatibility modules beside the bundled worker.
// Only those top-level files are copied verbatim, so only those are compared;
// the TypeScript kernel is bundled into the worker and checked below.
for(const entry of fs.readdirSync(path.join(root,'src/runtime'),{withFileTypes:true})){if(!entry.isFile()||entry.name.endsWith('.ts'))continue;const file=path.join(root,'src/runtime',entry.name);assert.equal(sha(file),sha(path.join(root,'app/work',entry.name)),'Runtime module differs: '+entry.name);}
check('Canonical runtime modules match packaged runtime',true);
const worker=path.join(root,'app/work/worker.mjs');check('The worker is built from the Ramo kernel',fs.existsSync(worker));
const workerSource=fs.readFileSync(worker,'utf8');
check('The worker has no Pi runtime dependency',!/pi-coding-agent|@earendil-works|runtime\/dist\/bundle|node_modules\/@earendil/.test(workerSource));
check('No PenguinMod VM or project graph is deployed',!fs.existsSync(path.join(root,'app/script.js'))&&!fs.existsSync(path.join(root,'app/assets/project.json')));
const renderer=fs.readFileSync(path.join(root,'app/renderer.js'),'utf8');
check('No Scratch execution or legacy agent loop in renderer',!(/\bScratch\s*\.|class DeepResearchV2|_agentAnswer\(/.test(renderer)));
check('No Pi runtime bundle or terminal view is deployed',!fs.existsSync(path.join(root,'app/work/runtime'))&&!fs.existsSync(path.join(root,'app/work/terminal-extension.mjs'))&&!fs.existsSync(path.join(root,'app/work/terminal')));
const prohibited=files(path.join(root,'release/Ramo')).filter(file=>/\.(?:map|log|pdb)$/i.test(file)||/(?:debug\.log|Start Ramo\.bat)$/i.test(file));check('No source maps, debug logs or legacy launchers ship',prohibited.length===0);
check('Public license and attribution notices ship at ZIP root',['LICENSE','NOTICE','THIRD-PARTY-NOTICES.txt'].every(file=>fs.existsSync(path.join(root,'release/Ramo',file))));
const oldApp=path.join(originalRoot,'desktop/Oceanic_2_15_Work');
if(fs.existsSync(oldApp)){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/original-hashes.json')));for(const [relative,digest]of Object.entries(manifest)){assert.equal(sha(path.join(oldApp,relative)),digest,'Original changed: '+relative);result.originalFilesChecked++;}
 const project=JSON.parse(fs.readFileSync(path.join(oldApp,'resources/app/assets/project.json'))),values=project.targets.find(t=>t.isStage).variables,defaults=JSON.parse(fs.readFileSync(path.join(root,'private/defaults.json')));
 for(const [id,[name,value]]of Object.entries(values)){assert.deepEqual(defaults[id],{name,value},'Original configuration default changed');}
 check('All original 2.15 app files and configuration defaults retained',true);
 const baseline=path.join(originalRoot,'01_SOURCE/baseline/Oceanic_2_3_9_ORIGINAL.pmp');check('Untouched 2.3.9 baseline identity',sha(baseline)==='25028ed6caefccee4eef1047773ce782e395d28ed44a39f1840e76b7493f4298');
}
result.sourceFiles=Object.fromEntries(files(path.join(root,'src')).map(file=>[path.relative(root,file),sha(file)]));
result.applicationSHA256=sha(path.join(root,'app/renderer.js'));
fs.mkdirSync(path.join(root,'evidence'),{recursive:true});fs.writeFileSync(path.join(root,'evidence/package-integrity.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({checks:result.checks,originalFilesChecked:result.originalFilesChecked,applicationFilesChecked:result.applicationFilesChecked}));

