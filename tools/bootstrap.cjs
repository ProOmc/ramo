'use strict';
/* Download the large, unmodified desktop runtime inputs after a clean clone.
   Ramo source, artwork and detector weights are repository inputs; Electron,
   Node, ripgrep, fd and the two native npm packages are fetched from their
   official releases. No administrator rights or model downloads are used. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),downloads=path.join(root,'build','downloads');
fs.mkdirSync(downloads,{recursive:true});
async function download(url,file,sha256){const valid=()=>fs.existsSync(file)&&fs.statSync(file).size>100000&&crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')===sha256;if(valid())return;console.log('Downloading '+url);const response=await fetch(url,{redirect:'follow'});if(!response.ok)throw Error('Download failed ('+response.status+'): '+url);fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()));if(!valid())throw Error('SHA-256 mismatch for '+url);}
function unzip(file,dest){fs.rmSync(dest,{recursive:true,force:true});fs.mkdirSync(dest,{recursive:true});const quote=value=>"'"+String(value).replace(/'/g,"''")+"'";const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Expand-Archive -LiteralPath '+quote(file)+' -DestinationPath '+quote(dest)+' -Force'],{stdio:'inherit'});if(result.status!==0)throw Error('Could not extract '+file);}
(async()=>{
 if(process.platform!=='win32')throw Error('The public desktop build currently targets Windows x64.');
 const electron=path.join(downloads,'electron.zip'),node=path.join(downloads,'node.zip'),rg=path.join(downloads,'ripgrep.zip'),fd=path.join(downloads,'fd.zip');
 await Promise.all([
  download('https://github.com/electron/electron/releases/download/v45.3.3/electron-v45.3.3-win32-x64.zip',electron,'49dd2d3875944f08de03d34595cd30093c588b9edcabb41a0ac481028a3a5a8a'),
  download('https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip',node,'57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73'),
  download('https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-pc-windows-msvc.zip',rg,'71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5'),
  download('https://github.com/sharkdp/fd/releases/download/v10.5.0/fd-v10.5.0-x86_64-pc-windows-msvc.zip',fd,'a227701b8551c35a9931d9f6da75503cf86d88e182d71fb849a70864c5d57cd7'),
 ]);
 if(!fs.existsSync(path.join(root,'vendor/electron/electron.exe')))unzip(electron,path.join(root,'vendor/electron'));
 const electronExe=path.join(root,'vendor/electron/electron.exe'),ramoExe=path.join(root,'vendor/electron/Ramo.exe');
 if(fs.existsSync(electronExe)){fs.copyFileSync(electronExe,ramoExe);fs.rmSync(electronExe);}
 if(!fs.existsSync(path.join(root,'vendor/node/node.exe'))){const temp=path.join(downloads,'node-extracted');unzip(node,temp);const extracted=path.join(temp,'node-v24.19.0-win-x64');fs.cpSync(extracted,path.join(root,'vendor/node'),{recursive:true});}
 if(!fs.existsSync(path.join(root,'vendor/node/rg.exe'))){const temp=path.join(downloads,'rg-extracted');unzip(rg,temp);const found=fs.readdirSync(temp,{recursive:true}).find(name=>String(name).endsWith('rg.exe'));if(!found)throw Error('ripgrep executable missing');fs.copyFileSync(path.join(temp,String(found)),path.join(root,'vendor/node/rg.exe'));}
 if(!fs.existsSync(path.join(root,'vendor/node/fd.exe'))){const temp=path.join(downloads,'fd-extracted');unzip(fd,temp);const found=fs.readdirSync(temp,{recursive:true}).find(name=>String(name).endsWith('fd.exe'));if(!found)throw Error('fd executable missing');fs.copyFileSync(path.join(temp,String(found)),path.join(root,'vendor/node/fd.exe'));}
 if(!fs.existsSync(path.join(root,'vendor/node_modules/onnxruntime-node/package.json'))||!fs.existsSync(path.join(root,'vendor/node_modules/node-pty/package.json'))){
  const prefix=path.join(root,'build/native-runtime');fs.mkdirSync(prefix,{recursive:true});fs.writeFileSync(path.join(prefix,'package.json'),JSON.stringify({private:true,dependencies:{'onnxruntime-node':'1.31.1','node-pty':'1.1.0'}},null,2));
  const npmArgs=['install','--ignore-scripts=false','--cache',path.relative(prefix,path.join(root,'.npm-cache'))],result=process.env.npm_execpath?spawnSync(process.execPath,[process.env.npm_execpath,...npmArgs],{cwd:prefix,stdio:'inherit',shell:false}):spawnSync(process.platform==='win32'?'npm.cmd':'npm',npmArgs,{cwd:prefix,stdio:'inherit',shell:false});if(result.status!==0)throw Error('Native runtime npm install failed: '+(result.error?.message||'exit '+result.status));
  fs.cpSync(path.join(prefix,'node_modules'),path.join(root,'vendor/node_modules'),{recursive:true});
 }
 console.log('Desktop runtime inputs are ready.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
