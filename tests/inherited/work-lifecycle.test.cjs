const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {WorkService}=require('../../app/work/service.cjs');
const appDir=path.resolve(__dirname,'../../app');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('Work serializes mutations, retains model ownership, enforces permissions, cancels and searches offline',async t=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ramo-lifecycle-')),cwd=path.join(tmp,'project');fs.mkdirSync(cwd);
  const models=['a','b'].map(id=>({id,model:id,context:16384}));let mode='block',started,ready=new Promise(r=>started=r),action=null;
  const service=new WorkService({appDir,dataDir:path.join(tmp,'data'),models:async()=>models,chat:async(model,body,{onChunk,signal})=>{
   if(mode==='block'){started();await new Promise(resolve=>{signal.addEventListener('abort',resolve,{once:true});if(signal.aborted)resolve();});return;}
   const last=body.messages.at(-1);
   if(action&&last.role!=='tool'){onChunk({choices:[{delta:{role:'assistant',tool_calls:[{index:0,id:'x'+Date.now(),type:'function',function:{name:action[0],arguments:JSON.stringify(action[1])}}]},finish_reason:'tool_calls'}]});}
   else onChunk({choices:[{delta:{role:'assistant',content:'Done'},finish_reason:'stop'}]});
  }});
  t.after(async()=>{await service.close();fs.rmSync(tmp,{recursive:true,force:true});});
  await service.request('open',{cwd,trusted:true,permission:'read',model:'a'});
  const running=service.request('prompt',{text:'Wait',model:'a'});await ready;
  await assert.rejects(service.request('open',{cwd,trusted:true,model:'b'}),/active task/);
  await assert.rejects(service.request('settings',{permission:'full'}),/active task/);
  assert.equal(service.activeModelId,'a');assert.equal((await service.request('state')).permission,'read');
  await service.request('abort');await running;mode='tools';
  action=['write',{path:'denied.txt',content:'must not exist'}];await service.request('prompt',{text:'Try write',model:'a'});assert.ok(!fs.existsSync(path.join(cwd,'denied.txt')));
  await service.request('settings',{permission:'ask'});let approvals=0;service.on('event',e=>{if(e.type==='ui_request'){approvals++;service.request('uiResponse',{id:e.id,value:false});}});
  await service.request('prompt',{text:'Try write with approval',model:'a'});assert.equal(approvals,1);assert.ok(!fs.existsSync(path.join(cwd,'denied.txt')));
  fs.writeFileSync(path.join(cwd,'needle.txt'),'ramo_unique_needle');
  for(const tool of [['grep',{pattern:'ramo_unique_needle',path:'.'}],['find',{pattern:'*.txt',path:'.'}]]){action=tool;const state=await service.request('prompt',{text:'Search '+tool[0],model:'a'});const result=state.messages.filter(m=>m.role==='toolResult').at(-1);assert.equal(result.isError,false,JSON.stringify(result));assert.match(JSON.stringify(result),/needle.txt/);}
  assert.ok(fs.existsSync(path.join(appDir,'work/node/fd.exe')));assert.ok(fs.existsSync(path.join(appDir,'work/node/rg.exe')));
  await assert.rejects(service.request('import',{text:'{"type":"session"}\n{"type":"message","id":"x","parentId":"missing"}'}),/parent/);
  await service.request('settings',{permission:'full'});
  action=['powershell',{command:'Start-Sleep -Seconds 3; Set-Content escaped.txt fail'}];
  let began;const toolStarted=new Promise(r=>began=r);service.on('event',e=>{if(e.type==='tool_execution_start'&&e.toolName==='powershell')began();});
  const command=service.request('prompt',{text:'Start cancellable command',model:'a'});await toolStarted;await service.request('abort');await command;await delay(3200);assert.ok(!fs.existsSync(path.join(cwd,'escaped.txt')),'Cancelled PowerShell never reaches delayed write');
});
test('actual local MCP connects, executes and exits when switching projects',async t=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ramo-mcp-')),cwd=path.join(tmp,'one'),other=path.join(tmp,'two');fs.mkdirSync(path.join(cwd,'.pi'),{recursive:true});fs.mkdirSync(other);
  const script=path.join(tmp,'server.cjs'),pidFile=path.join(tmp,'pid');
  fs.writeFileSync(script,`const fs=require('fs'),rl=require('readline');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));rl.createInterface({input:process.stdin}).on('line',line=>{const p=JSON.parse(line);if(p.id===undefined)return;let result={};if(p.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'local-test',version:'1'}};if(p.method==='tools/list')result={tools:[{name:'echo',description:'Echo local test',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}}]};if(p.method==='tools/call')result={content:[{type:'text',text:'MCP_ACTUAL:'+p.params.arguments.text}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:p.id,result})+'\\n');}).on('close',()=>process.exit(0));`);
  fs.writeFileSync(path.join(cwd,'.pi/mcp.json'),JSON.stringify({mcpServers:{local:{command:path.join(appDir,'work/node/node.exe'),args:[script],exposure:'direct'}}}));
  // Lazy discovery: the first call to an indexed MCP tool returns its schema;
  // the retry is the one that reaches the local MCP server.
  const model={id:'mcp',model:'mcp',context:16384};const service=new WorkService({appDir,dataDir:path.join(tmp,'data'),models:async()=>[model],chat:async(_m,body,{onChunk})=>{const results=body.messages.filter(m=>m.role==='tool').length;if(results===0)onChunk({choices:[{delta:{role:'assistant',tool_calls:[{index:0,id:'mcp',type:'function',function:{name:'mcp__local__echo',arguments:'{"text":"hello"}'}}]},finish_reason:'tool_calls'}]});else if(results===1)onChunk({choices:[{delta:{role:'assistant',tool_calls:[{index:0,id:'mcp2',type:'function',function:{name:'mcp__local__echo',arguments:'{"text":"hello"}'}}]},finish_reason:'tool_calls'}]});else onChunk({choices:[{delta:{role:'assistant',content:'Done'},finish_reason:'stop'}]});}});
  t.after(async()=>{await service.close();if(fs.existsSync(pidFile)){try{process.kill(Number(fs.readFileSync(pidFile)));}catch{}}fs.rmSync(tmp,{recursive:true,force:true});});
  await service.request('open',{cwd,trusted:true,permission:'full',model:'mcp'});let resources;
  for(let i=0;i<100;i++){resources=await service.request('resources');if(resources.tools.some(x=>x.name==='mcp__local__echo'))break;await delay(50);}
  assert.ok(resources.tools.some(x=>x.name==='mcp__local__echo'),'Actual MCP tool discovered');await service.request('settings',{tools:[...resources.activeTools,'mcp__local__echo']});
  const state=await service.request('prompt',{text:'Echo through MCP',model:'mcp'});assert.match(JSON.stringify(state.messages),/MCP_ACTUAL:hello/);
  const pid=Number(fs.readFileSync(pidFile));await service.request('open',{cwd:other,trusted:true,permission:'read',model:'mcp'});
  let alive=true;for(let i=0;i<60;i++){try{process.kill(pid,0);}catch{alive=false;break;}await delay(50);}assert.equal(alive,false,'Old MCP process exited');
});
