import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {loadSkills, formatSkillsForPrompt} from '../build/core/skills.js';
import {loadPromptTemplates, parseCommandArgs, substituteArgs, expandPromptTemplate} from '../build/core/prompts.js';

const require=createRequire(import.meta.url);
const {WorkService}=require('../app/work/service.cjs');

/**
 * Skills and prompt templates are the two Pi resources the kernel keeps.
 *
 * These tests are model-free. The loader tests read real files in a temporary
 * directory; the integration test drives the real worker through the real
 * service and inspects the request the worker would have sent to a model.
 */

function tempProject(){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ramo-resources-'));
  const cwd=path.join(tmp,'project'),dataDir=path.join(tmp,'data');
  fs.mkdirSync(cwd,{recursive:true});
  return {tmp,cwd,dataDir};
}

function writeSkill(root,name,body){
  const dir=path.join(root,name);
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'SKILL.md'),body);
}

test('skills load from the agent directory and a trusted project, and a disabled skill is not offered to the model',()=>{
  const {tmp,cwd,dataDir}=tempProject();
  try{
    writeSkill(path.join(dataDir,'agent','skills'),'house-style','---\nname: house-style\ndescription: The house writing style.\n---\nWrite plainly.\n');
    writeSkill(path.join(cwd,'.pi','skills'),'release','---\nname: release\ndescription: Cut a release.\n---\nRun the release steps.\n');
    writeSkill(path.join(cwd,'.pi','skills'),'secret','---\nname: secret\ndescription: Hidden from the prompt.\ndisable-model-invocation: true\n---\nOnly on request.\n');

    const loaded=loadSkills({cwd,agentDir:path.join(dataDir,'agent'),trusted:true});
    assert.deepEqual(loaded.skills.map(skill=>skill.name).sort(),['house-style','release','secret']);
    assert.equal(loaded.diagnostics.length,0);

    const prompt=formatSkillsForPrompt(loaded.skills);
    assert.match(prompt,/^The following skills provide specialized instructions/);
    assert.match(prompt,/<available_skills>/);
    assert.match(prompt,/<name>house-style<\/name>/);
    assert.match(prompt,/<name>release<\/name>/);
    assert.doesNotMatch(prompt,/<name>secret<\/name>/,'a disabled skill must not reach the model');
    assert.match(prompt,/<location>.*release.*SKILL\.md<\/location>/);

    const untrusted=loadSkills({cwd,agentDir:path.join(dataDir,'agent'),trusted:false});
    assert.deepEqual(untrusted.skills.map(skill=>skill.name),['house-style'],'project skills need trust');
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

test('a skill name collision keeps the first skill and reports it',()=>{
  const {tmp,cwd,dataDir}=tempProject();
  try{
    writeSkill(path.join(dataDir,'agent','skills'),'same','---\nname: same\ndescription: The user copy.\n---\nUser.\n');
    writeSkill(path.join(cwd,'.pi','skills'),'same','---\nname: same\ndescription: The project copy.\n---\nProject.\n');
    const loaded=loadSkills({cwd,agentDir:path.join(dataDir,'agent'),trusted:true});
    assert.equal(loaded.skills.length,1);
    assert.equal(loaded.skills[0].description,'The user copy.');
    const collision=loaded.diagnostics.find(diagnostic=>diagnostic.type==='collision');
    assert.ok(collision,'the collision is reported');
    assert.equal(collision.collision.winnerPath,loaded.skills[0].filePath);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

test('prompt templates load and substitute arguments like Pi',()=>{
  const {tmp,cwd,dataDir}=tempProject();
  try{
    const promptsDir=path.join(cwd,'.pi','prompts');
    fs.mkdirSync(promptsDir,{recursive:true});
    fs.writeFileSync(path.join(promptsDir,'greet.md'),'---\ndescription: Greet someone.\nargument-hint: <name>\n---\nHello $1 from $2');
    fs.writeFileSync(path.join(promptsDir,'all.md'),'All: $@\nFirst: ${1:-nobody}\nSlice: ${@:2}\nTwo: ${@:2:2}');

    const loaded=loadPromptTemplates({cwd,agentDir:path.join(dataDir,'agent'),trusted:true});
    assert.deepEqual(loaded.templates.map(template=>template.name).sort(),['all','greet']);
    const greet=loaded.templates.find(template=>template.name==='greet');
    assert.equal(greet.description,'Greet someone.');
    assert.equal(greet.argumentHint,'<name>');

    assert.deepEqual(parseCommandArgs('Alice "the team" \'\''),['Alice','the team','']);
    assert.equal(substituteArgs('Hello $1 from $2',['Alice','the team']),'Hello Alice from the team');
    assert.equal(substituteArgs('${1:-nobody}',[]),'nobody');
    assert.equal(substituteArgs('${@:2}',['a','b','c']),'b c');
    assert.equal(substituteArgs('${@:2:2}',['a','b','c']),'b c');
    assert.equal(substituteArgs('$ARGUMENTS',['a','b']),'a b');

    assert.equal(expandPromptTemplate('/greet Alice "the team"',loaded.templates),'Hello Alice from the team');
    assert.equal(expandPromptTemplate('/unknown Alice',loaded.templates),'/unknown Alice','an unmatched command reaches the model unchanged');
    assert.equal(expandPromptTemplate('hello',loaded.templates),'hello');
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

test('the worker lists real resources, puts skills in the system prompt and expands /name',async t=>{
  const {tmp,cwd,dataDir}=tempProject();
  writeSkill(path.join(dataDir,'agent','skills'),'house-style','---\nname: house-style\ndescription: The house writing style.\n---\nWrite plainly.\n');
  writeSkill(path.join(cwd,'.pi','skills'),'release','---\nname: release\ndescription: Cut a release.\n---\nRun the release steps.\n');
  writeSkill(path.join(cwd,'.pi','skills'),'secret','---\nname: secret\ndescription: Hidden from the prompt.\ndisable-model-invocation: true\n---\nOnly on request.\n');
  fs.mkdirSync(path.join(cwd,'.pi','prompts'),{recursive:true});
  fs.writeFileSync(path.join(cwd,'.pi','prompts','greet.md'),'---\ndescription: Greet someone.\n---\nHello $1 from $2');

  const requests=[];
  const model={id:'fixture',model:'fixture',label:'Protocol fixture',context:16384};
  const service=new WorkService({appDir:path.resolve('app'),dataDir,models:async()=>[model],
    chat:async(_model,body,{onChunk})=>{
      requests.push(body);
      onChunk({choices:[{delta:{role:'assistant',content:'Done.'}}]});
      onChunk({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:5,completion_tokens:2,total_tokens:7}});
    }});
  t.after(async()=>{await service.close();fs.rmSync(tmp,{recursive:true,force:true});});

  await service.request('open',{cwd,trusted:true,permission:'read',mode:'project',model:'fixture'});
  const listed=await service.request('resources');
  assert.deepEqual(listed.skills.map(skill=>skill.name).sort(),['house-style','release','secret']);
  assert.equal(listed.skills.find(skill=>skill.name==='secret').disableModelInvocation,true);
  assert.deepEqual(listed.prompts.map(prompt=>prompt.name),['greet']);
  assert.equal(listed.prompts[0].content,'Hello $1 from $2');
  assert.deepEqual(listed.extensions,[],'the extension system is not restored');

  await service.request('prompt',{text:'/greet Alice "the team"',model:'fixture'});
  assert.equal(requests.length,1);
  const system=requests[0].messages.find(message=>message.role==='system');
  assert.match(system.content,/<available_skills>/);
  assert.match(system.content,/<name>house-style<\/name>/);
  assert.match(system.content,/<name>release<\/name>/);
  assert.doesNotMatch(system.content,/<name>secret<\/name>/);
  const user=requests[0].messages.find(message=>message.role==='user');
  const userText=typeof user.content==='string'?user.content:user.content.filter(block=>block.type==='text').map(block=>block.text).join('');
  assert.equal(userText,'Hello Alice from the team','the slash command was expanded before it reached the model');

  // The assistant surface loads no skills, matching the old worker's noSkills.
  await service.request('open',{cwd,trusted:true,permission:'read',mode:'assistant',model:'fixture'});
  const assistant=await service.request('resources');
  assert.deepEqual(assistant.skills,[]);
  assert.deepEqual(assistant.prompts,[]);
});
