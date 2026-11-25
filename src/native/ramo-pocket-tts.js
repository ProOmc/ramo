'use strict';
// Ramo-owned Pocket TTS. The engine is installed into the app's own profile,
// never loaded from (or started by) a second project.
const {app}=require('electron');
const fs=require('fs');
const path=require('path');
const http=require('http');
const net=require('net');
const crypto=require('crypto');
const {spawn}=require('child_process');

const HOST='127.0.0.1', DEFAULT_PORT=7792, MAX_PCM=35*1024*1024;
const VOICES=new Set(['michael','george','alba','lola']);
const LANGUAGES=new Set(['en','es']);
const PYTHON_MIN=[3,10], PYTHON_MAX=[3,14];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function brief(x,n=400){return String(x??'').slice(0,n);}
// A port that is free right now. The server is told to listen on this exact
// port and binds it exclusively, so two Ramo instances (or a server left
// behind by a crash) can never end up sharing one port.
function freePort(){
  return new Promise((resolve,reject)=>{
    const probe=net.createServer();
    probe.unref();
    probe.on('error',reject);
    probe.listen(0,HOST,()=>{
      const port=probe.address().port;
      probe.close(()=>resolve(port));
    });
  });
}
function toWav(pcm,rate){
  const frames=Math.floor(pcm.length/4),out=Buffer.alloc(44+frames*2);
  out.write('RIFF',0);out.writeUInt32LE(out.length-8,4);out.write('WAVEfmt ',8);
  out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);
  out.writeUInt32LE(rate,24);out.writeUInt32LE(rate*2,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);
  out.write('data',36);out.writeUInt32LE(frames*2,40);
  for(let i=0;i<frames;i++){
    let x=pcm.readFloatLE(i*4);if(!Number.isFinite(x))x=0;x=Math.max(-1,Math.min(1,x));
    out.writeInt16LE(Math.round(x<0?x*32768:x*32767),44+i*2);
  }
  return out;
}
function execFile(command,args,{cwd,timeout=120000,env}={}){
  return new Promise((resolve,reject)=>{
    let stderr='',stdout='',settled=false;
    const proc=spawn(command,args,{cwd,env:env||process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const timer=setTimeout(()=>{proc.kill();fail(new Error('Command timed out'))},timeout);
    function fail(err){if(settled)return;settled=true;clearTimeout(timer);reject(err);}
    proc.on('error',fail);
    proc.stdout.on('data',chunk=>{stdout=brief(stdout+chunk.toString('utf8'),6000);});
    proc.stderr.on('data',chunk=>{stderr=brief(stderr+chunk.toString('utf8'),6000);});
    proc.on('exit',code=>{if(settled)return;settled=true;clearTimeout(timer);
      if(code===0)resolve(stdout.trim());else reject(new Error(brief(stderr||stdout||('Process exited with '+code),600)));});
  });
}
async function findPython(){
  const commands=process.platform==='win32'
    ? [['py',['-3.11']],['py',['-3.12']],['py',['-3.13']],['py',['-3.10']],['py',['-3']],['python',[]]]
    : [['python3',[]],['python',[]]];
  for(const [cmd,prefix] of commands){
    try{
      const ver=await execFile(cmd,[...prefix,'-c','import sys;print(sys.version_info.major,sys.version_info.minor)'],{timeout:8000});
      const m=ver.match(/(\d+)\s+(\d+)/);if(!m)continue;
      const major=+m[1],minor=+m[2];
      if(major===3&&minor>=PYTHON_MIN[1]&&minor<=PYTHON_MAX[1])return {cmd,prefix};
    }catch{}
  }
  throw Error('Pocket TTS setup needs Python 3.10–3.14 installed on Windows. Install Python, then click Enable voice again. No M89 project is needed.');
}
class PocketVoice{
  constructor(){
    this.configPath=path.join(app.getPath('userData'),'ramo-pocket-voice.json');
    this.runtime=path.join(app.getPath('userData'),'ramo-pocket-runtime');
    this.script=path.join(__dirname,'ramo-pocket-server.py');
    this.python=process.platform==='win32'?path.join(this.runtime,'.venv','Scripts','python.exe'):path.join(this.runtime,'.venv','bin','python');
    this.installPromise=null;this.startPromise=null;this.child=null;this.token=null;
    this.port=null;
    this.lastError='';this.installing=false;
    this.config={enabled:false,voice:'michael',language:'en',migratedAutoSpeak:false};
    try{const old=JSON.parse(fs.readFileSync(this.configPath,'utf8'));
      this.config.enabled=old.enabled===true;
      this.config.voice=VOICES.has(old.voice)?old.voice:'michael';
      this.config.language=LANGUAGES.has(old.language)?old.language:'en';
      this.config.migratedAutoSpeak=old.migratedAutoSpeak===true;
    }catch{}
  }
  save(){fs.mkdirSync(path.dirname(this.configPath),{recursive:true});fs.writeFileSync(this.configPath,JSON.stringify(this.config,null,2),'utf8');}
  ready(){return fs.existsSync(this.python)&&fs.existsSync(path.join(this.runtime,'installed.ok'));}
  statusInfo(online){return {enabled:this.config.enabled,voice:this.config.voice,language:this.config.language,
    online,installed:this.ready(),installing:this.installing,managed:true,autostart:true,
    scriptConfigured:true,server:'127.0.0.1:'+(this.port||DEFAULT_PORT),error:this.lastError};}
  async status(){return this.statusInfo(await this.online());}
  async query(method,route,payload=null,timeout=180000){
    const body=payload==null?null:Buffer.from(JSON.stringify(payload));
    return new Promise((resolve,reject)=>{
      const req=http.request({hostname:HOST,port:this.port||DEFAULT_PORT,path:route,method,timeout,headers:{
        'X-Ramo-Token':this.token||'',...(body?{'Content-Type':'application/json','Content-Length':body.length}:{})
      }},res=>{
        const chunks=[];let size=0;
        res.on('data',b=>{size+=b.length;if(size>MAX_PCM){req.destroy(Error('Pocket audio exceeded limit'));return;}chunks.push(b);});
        res.on('end',()=>{
          if(res.headers['x-ramo-pocket']!=='1')return reject(Error('Port belongs to a different server'));
          const buffer=Buffer.concat(chunks);
          if(res.statusCode<200||res.statusCode>=300)return reject(Error('Pocket TTS '+res.statusCode+': '+brief(buffer,250)));
          resolve({bytes:buffer,headers:res.headers});
        });
        res.on('error',reject);
      });
      req.on('error',reject);req.on('timeout',()=>req.destroy(Error('Pocket TTS request timed out')));
      if(body)req.write(body);req.end();
    });
  }
  async online(){
    if(!this.child||!this.token||!this.port)return false;
    try{await this.query('GET','/v1/health',null,1250);return true;}catch{return false;}
  }
  async install(){
    if(this.ready())return;
    if(this.installPromise)return this.installPromise;
    this.installPromise=(async()=>{
      this.installing=true;
      fs.mkdirSync(this.runtime,{recursive:true});
      const log=path.join(this.runtime,'install-status.txt');
      const write=x=>fs.writeFileSync(log,x+'\n',{flag:'a'});
      try{
        write('Starting Ramo Pocket TTS first-time setup.');
        const found=await findPython();
        if(!fs.existsSync(this.python)){
          write('Creating private Python environment.');
          await execFile(found.cmd,[...found.prefix,'-m','venv',path.join(this.runtime,'.venv')],{timeout:120000});
        }
        write('Installing official pocket-tts package and dependencies from PyPI.');
        await execFile(this.python,['-m','pip','install','--disable-pip-version-check','pocket-tts'],{timeout:12*60*1000});
        await execFile(this.python,['-c','from pocket_tts import TTSModel; print("ok")'],{timeout:30000});
        fs.writeFileSync(path.join(this.runtime,'installed.ok'),'ramo-pocket-runtime-v1\n');
        write('Pocket TTS Python environment ready.');
      }catch(e){write('Setup failed: '+brief(e.message));throw Error('Pocket TTS installation failed. '+brief(e.message,280)+' See '+log);}
      finally{this.installing=false;}
    })().finally(()=>{this.installPromise=null;});
    return this.installPromise;
  }
  async ensure(){
    if(!this.config.enabled)return false;
    return this._ensureEngine();
  }
  // The engine lifecycle without the enabled gate. Callers that legitimately
  // speak regardless of the global setting (per-message read-out) use this.
  async _ensureEngine(){
    if(await this.online())return true;
    if(this.startPromise)return this.startPromise;
    this.startPromise=(async()=>{
      await this.install();
      if(!fs.existsSync(this.script))throw Error('Ramo Pocket TTS server file is missing from this installation.');
      if(this.child){try{this.child.kill();}catch{}this.child=null;}
      this.token=crypto.randomBytes(24).toString('hex');
      const logs=path.join(this.runtime,'server.log');
      // Its own port, chosen at launch. A Pocket server left behind by an
      // earlier instance (or a crash) can hold the default port forever, and
      // on Windows a second server would still bind it while the stale one
      // keeps answering with a different token - every request then fails
      // with 403 Unauthorized. A per-launch port makes that impossible. If
      // something else takes the chosen port in the moment between the probe
      // and the spawn, the exclusive bind fails immediately and the next
      // attempt uses a fresh port.
      for(let attempt=0;attempt<2;attempt++){
        this.port=await freePort();
        const stream=fs.createWriteStream(logs,{flags:'a'});
        const env={...process.env,RAMO_POCKET_TOKEN:this.token,PYTHONUNBUFFERED:'1'};
        const child=spawn(this.python,[this.script,'--port',String(this.port)],{cwd:this.runtime,windowsHide:true,stdio:['ignore','pipe','pipe'],env});
        this.child=child;
        child.stdout.pipe(stream,{end:false});child.stderr.pipe(stream,{end:false});
        child.on('error',e=>{this.lastError='Cannot launch Pocket TTS: '+brief(e.message);});
        child.on('exit',()=>{if(this.child===child)this.child=null;stream.end();});
        // Model weights and voice state are fetched by pocket-tts on first use.
        for(let i=0;i<100;i++){
          if(await this.online())return true;
          if(!this.child)break;
          await delay(400);
        }
      }
      throw Error('Ramo Pocket server did not start. See '+logs);
    })().finally(()=>{this.startPromise=null;});
    // Warm the loaded voice so the first request is faster.
    if(this.config.enabled){
      try{ await this.warm(); }catch{}
    }
    return this.startPromise;
  }
  async configure(){return this.status();} // Backwards-compatible renderer bridge. No script picker.
  async settings(value={}){
    if(VOICES.has(value.voice))this.config.voice=value.voice;
    if(LANGUAGES.has(value.language))this.config.language=value.language;
    if(value.enabled===false){this.config.enabled=false;this.save();this.stop();this.lastError='';return this.status();}
    if(value.enabled===true){
      this.config.enabled=true;this.lastError='';
      try{await this.ensure();this.save();}
      catch(err){this.config.enabled=false;this.save();this.stop();this.lastError=brief(err.message,550);throw err;}
    }else this.save();
    return this.status();
  }
  async warm(){
    if(!this.config.enabled)return false;
    await this.ensure();
    try{ await this.query('POST','/v1/warm',{text:'Hi.',voice:this.config.voice,language:this.config.language},30000); }catch(e){ this.lastError=brief(e.message,200); }
    return this.online();
  }

  async _synthesize(content){
    const result=await this.query('POST','/v1/pcm',{text:content,voice:this.config.voice,language:this.config.language});
    const rate=Number(result.headers['x-sample-rate']);
    if(!Number.isFinite(rate)||rate<8000||rate>96000||result.bytes.length%4)throw Error('Invalid PCM from Pocket TTS');
    const wav=toWav(result.bytes,rate);
    return {wavBase64:wav.toString('base64'),voice:brief(result.headers['x-voice-used']||this.config.voice,60),rate};
  }
  async speak(text){
    if(!this.config.enabled)return {disabled:true};
    const content=brief(text,6000).trim();if(!content)return {empty:true};
    await this.ensure();
    return this._synthesize(content);
  }
  // One-shot read-out: speaks even when voice is globally disabled. Used by
  // the per-message speaker button — explicit request, one shot, never
  // persisted. The engine starts on demand and idles until the next call.
  async speakOnce(text){
    const content=brief(text,6000).trim();if(!content)return {empty:true};
    const started=await this._ensureEngine();
    if(!started&&!await this.online())throw Error('Ramo Pocket voice could not be started. Install voice from System › Voice, or check the voice log.');
    return this._synthesize(content);
  }
  stop(){const p=this.child;this.child=null;this.token=null;this.port=null;if(p){try{p.kill();}catch{}}}
}
module.exports={PocketVoice,toWav,findPython,VOICES,LANGUAGES};
