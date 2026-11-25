'use strict';
// Desktop-owned offline Nemotron Streaming dictation; intentionally independent
// of M89. This replaces the earlier Moonshine worker. The public methods,
// events and the persistent-worker protocol are unchanged so the composer, the
// pet and the renderer keep using the same seam.
//
// English only by design: the English checkpoint is the one NVIDIA recommends
// for English, it is smaller to run, and nothing in the app requests another
// language.
const {spawn} = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MODEL = {
  dir: 'sherpa-onnx-nemotron-speech-streaming-en-0.6b-560ms-int8-2026-04-25',
  label: 'Nemotron Streaming 0.6B'
};

class LocalSpeech {
  constructor({dataDir,workerPath,spawnProcess=spawn,sendEvent=()=>{}}={}) {
    this.root=path.join(dataDir||path.join(os.homedir(),'.ramo'),'speech');
    this.workerPath=workerPath||path.join(__dirname,'ramo-nemotron-worker.py');
    this.spawn=spawnProcess;
    this.sendEvent=sendEvent;
    this.child=null;
    this.busy=false;
    this.phase='idle';
    this.lastError='';
    this.stopRequested=false;
    this.modelInstalled=false;
    // Hot persistent worker: one long-lived process holding the model; the
    // microphone is opened per session and released between turns.
    this.hotChild=null;
    this.hotReady=false;
    this.hotSession=null;
    this.hotPromise=null;
  }
  _emit(type, fields={}) {
    this.sendEvent({type,...fields});
  }
  status(){return {active:this.busy,phase:this.phase,error:this.lastError,engine:'Nemotron Streaming 0.6B (local)',offlineAfterSetup:true};}
  _python(){return process.platform==='win32'?path.join(this.root,'venv','Scripts','python.exe'):path.join(this.root,'venv','bin','python');}
  _modelDir(){return path.join(this.root,'models',MODEL.dir);}
  _modelReady(){
    if(this.modelInstalled)return true;
    const dir=this._modelDir();
    const ready=['encoder.int8.onnx','decoder.int8.onnx','joiner.int8.onnx','tokens.txt']
      .every(name=>{try{return fs.statSync(path.join(dir,name)).size>0}catch(_){return false}});
    if(ready)this.modelInstalled=true;
    return ready;
  }
  _exec(command,args,opts={}){
    return new Promise((resolve,reject)=>{
      const {timeoutMs: _ignored, ...spawnOpts}=opts;
      const p=this.spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],...spawnOpts});
      let stderr='',stdout='';let settled=false;
      const timeout=Number(opts.timeoutMs)||300000;
      const timer=setTimeout(()=>{if(settled)return;settled=true;p.kill();reject(Error('Local STT setup timed out. Check your connection for the one-time install.'))},timeout);
      const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result)};
      p.stdout?.on('data',x=>{stdout=(stdout+String(x)).slice(-1600);});
      p.stderr?.on('data',x=>{stderr=(stderr+String(x)).slice(-1800);});
      p.once('error',error=>finish(error));
      p.once('close',code=>{if(code===0)finish(null,stdout);else finish(Error((stderr||stdout||'Process failed')+' (exit '+code+')'))});
    });
  }
  async _ensure(){
    fs.mkdirSync(this.root,{recursive:true});
    const python=this._python();
    if(!fs.existsSync(python)){
      this.phase='setup';this._emit('status',{message:'Preparing local speech recognition (first use)'});
      let lastError;
      const launchers=process.platform==='win32'?[
        ['py',['-3.11']],['py',['-3.12']],['python',[]]
      ]:[['python3.11',[]],['python3',[]]];
      for(const [exe,args] of launchers){
        try{await this._exec(exe,[...args,'-m','venv',path.join(this.root,'venv')]);lastError=null;break;}
        catch(e){lastError=e;}
      }
      if(lastError)throw Error('Python 3.11 or 3.12 with venv is required for offline speech setup. '+lastError.message);
    }
    const marker=path.join(this.root,'nemotron-installed-v1');
    if(!fs.existsSync(marker)){
      this.phase='setup';this._emit('status',{message:'Installing the Nemotron speech runtime (first use; internet required)'});
      await this._exec(python,['-m','pip','install','--disable-pip-version-check','sherpa-onnx','sounddevice','numpy'],{cwd:this.root,timeoutMs:900000});
      fs.writeFileSync(marker,'sherpa-onnx\n');
    }
    if(!this._modelReady()){
      this.phase='setup';
      this._emit('status',{message:'Installing '+MODEL.label+' (first use; about 450 MB)'});
      await this._exec(python,['-u',this.workerPath,'--setup','--root',this.root],{cwd:this.root,timeoutMs:1800000});
      if(!this._modelReady())throw Error(MODEL.label+' did not install correctly');
    }
    return python;
  }
  async recognize(){
    if(this.busy)throw Error('Speech recognition is already running');
    // The guard is claimed before the first await: two callers must never own
    // the capture device at the same time, and a second turn has to wait for
    // the first one rather than start a second session.
    this.busy=true;this.lastError='';this.stopRequested=false;
    try{
      // Always prefer the warm worker: the model stays loaded across turns, so a
      // recognition starts with the microphone rather than with a model load.
      try{await this.hot();}catch(_){}
      if(this.hotReady&&this.hotChild){
        this.phase='listening';
        return await new Promise((resolve,reject)=>{
          this.hotSession={
            settle:(text)=>{resolve(text);},
            fail:(error)=>{reject(error);}
          };
          try{this.hotChild.stdin.write('start\n');}catch(error){reject(error);}
        });
      }
      // Fallback only: the warm worker could not start. This path loads the
      // model in a one-shot process and is slower, but keeps dictation usable.
      this.phase='setup';
      let current='';let receivedFinal=false;let actualError=null;
      const py=await this._ensure();
      if(this.stopRequested)return '';
      const child=this.spawn(py,['-u',this.workerPath,'--root',this.root],{
        cwd:this.root,windowsHide:true,stdio:['pipe','pipe','pipe'],
        env:{...process.env,PYTHONUNBUFFERED:'1'}
      });
      this.child=child;
      this.phase='loading';
      await new Promise((resolve,reject)=>{
        let buffer='',errs='',finished=false;
        const finish=(err)=>{if(finished)return;finished=true;err?reject(err):resolve()};
        child.stdout.on('data',chunk=>{
          buffer+=String(chunk);
          const lines=buffer.split(/\r?\n/);buffer=lines.pop()||'';
          if(buffer.length>131072){actualError=Error('Speech worker output too large');child.kill();return;}
          for(const line of lines){
            let packet;try{packet=JSON.parse(line)}catch{return;}
            if(packet.type==='status')this._emit('status',{message:String(packet.message||'')});
            if(packet.type==='ready'){this.phase='listening';this._emit('ready',{message:'Listening'});}
            if(packet.type==='partial'){
              current=String(packet.text||'').slice(0,16000);this._emit('partial',{text:current});
            }
            if(packet.type==='final'){
              current=String(packet.text||'').slice(0,16000);receivedFinal=true;
              this._emit('final',{text:current});
            }
            if(packet.type==='error'){
              actualError=Error(String(packet.message||'Speech recognition failed'));
              this._emit('error',{message:actualError.message});
            }
          }
        });
        child.stderr.on('data',b=>{errs=(errs+String(b)).slice(-2200)});
        child.on('error',finish);
        child.on('close',code=>{
          if(actualError)finish(actualError);
          else if(code!==0)finish(Error('Local recognition exited '+code+': '+errs.slice(-900)));
          else if(!receivedFinal&&!this.stopRequested)finish(Error('No transcript returned from local recognizer'));
          else finish();
        });
        if(this.stopRequested)child.stdin.write('stop\n');
      });
      return current;
    }catch(error){
      this.lastError=String(error.message||error);
      this._emit('error',{message:this.lastError});
      throw error;
    }finally{
      this.busy=false;this.phase='idle';this.child=null;this.hotSession=null;
    }
  }
  stop(){
    this.stopRequested=true;
    if(this.child && !this.child.killed){
      try{this.child.stdin.write('stop\n');}catch(_){}
      // Do not terminate immediately; allow the worker to flush final text.
    }
    if(this.hotChild && !this.hotChild.killed){
      try{this.hotChild.stdin.write('stop\n');}catch(_){}
    }
    return true;
  }
  shutdown(){
    if(this.child&&!this.child.killed){try{this.child.kill()}catch(_){}}this.child=null;this.busy=false;
    this.hotStop();
  }

  // ---- Hot persistent worker (keeps the model loaded) ------------------------
  _hotRoute(packet){
    switch(packet.type){
      case 'status':
        this._emit('status',{message:String(packet.message||'')});
        break;
      case 'hot':
        this.hotReady=true;
        this.phase='idle';
        break;
      case 'ready':
        this.phase='listening';
        this._emit('ready',{message:'Listening'});
        break;
      case 'partial':{
        const text=String(packet.text||'').slice(0,16000);
        this._emit('partial',{text});
        break;
      }
      case 'final':{
        const text=String(packet.text||'').slice(0,16000);
        this._emit('final',{text});
        const session=this.hotSession;
        if(session){this.hotSession=null;session.settle(text);}
        break;
      }
      case 'error':{
        const message=String(packet.message||'Speech recognition failed');
        this._emit('error',{message});
        const session=this.hotSession;
        if(session){this.hotSession=null;session.fail(Error(message));}
        break;
      }
    }
  }
  _hotSpawn(py){
    const child=this.spawn(py,['-u',this.workerPath,'--persistent','--root',this.root],{
      cwd:this.root,windowsHide:true,stdio:['pipe','pipe','pipe'],
      env:{...process.env,PYTHONUNBUFFERED:'1'}
    });
    this.hotChild=child;this.hotReady=false;this.hotSession=null;
    let buffer='';
    child.stdout.on('data',chunk=>{
      buffer+=String(chunk);
      const lines=buffer.split(/\r?\n/);buffer=lines.pop()||'';
      for(const line of lines){
        let packet;try{packet=JSON.parse(line)}catch{return;}
        this._hotRoute(packet);
      }
    });
    child.stderr.on('data',()=>{});
    child.on('error',()=>{});
    child.on('close',()=>{
      if(this.hotChild!==child)return;
      this.hotChild=null;this.hotReady=false;
      const session=this.hotSession;
      if(session){this.hotSession=null;session.fail(Error('Local speech worker stopped'));}
    });
    return child;
  }
  async hot(){
    if(this.hotChild&&this.hotReady)return true;
    // One warm-up at a time: a second caller waits for the same worker
    // instead of killing it and starting over.
    if(this.hotPromise)return this.hotPromise;
    this.hotPromise=(async()=>{
      const py=await this._ensure();
      this._hotSpawn(py);
      await new Promise((resolve)=>{
        const started=Date.now();
        const timer=setInterval(()=>{
          if(this.hotReady||!this.hotChild||Date.now()-started>180000){clearInterval(timer);resolve();}
        },150);
      });
      if(!this.hotReady)throw Error('Local speech worker did not warm up');
      return true;
    })().finally(()=>{this.hotPromise=null});
    return this.hotPromise;
  }
  hotStop(){
    if(this.hotChild){try{this.hotChild.stdin.end('shutdown\n')}catch(_){}try{this.hotChild.kill()}catch(_){}}
    this.hotChild=null;this.hotReady=false;
    const session=this.hotSession;
    if(session){this.hotSession=null;session.fail(Error('Local speech worker stopped'));}
  }
}
module.exports={LocalSpeech,MODEL};
