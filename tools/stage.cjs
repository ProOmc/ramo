const fs=require('node:fs'),path=require('node:path');
const dev=path.resolve(__dirname,'..');
const same=(a,b)=>fs.statSync(a).size===fs.statSync(b).size&&fs.readFileSync(a).equals(fs.readFileSync(b));

/**
 * Remove what the source no longer has.
 *
 * Copying alone is not enough. A file that an earlier build produced and the
 * current build does not produce would stay in the release forever, because a
 * copy only adds and overwrites. That is how the Pi runtime bundle, the
 * terminal view and the terminal extension survived in the staged release
 * after they were removed from the build.
 */
function prune(source,dest){
	for(const entry of fs.readdirSync(dest,{withFileTypes:true})){
		const from=path.join(source,entry.name),to=path.join(dest,entry.name);
		if(!fs.existsSync(from)){fs.rmSync(to,{recursive:true,force:true});continue;}
		if(entry.isDirectory())prune(from,to);
	}
}

fs.cpSync(path.join(dev,'vendor/electron'),path.join(dev,'release/Ramo'),{recursive:true,filter:(src,dst)=>fs.statSync(src).isDirectory()||!fs.existsSync(dst)||!same(src,dst)});
const appSource=path.join(dev,'app'),appDest=path.join(dev,'release/Ramo/resources/app');
fs.cpSync(appSource,appDest,{recursive:true,filter:(src,dst)=>fs.statSync(src).isDirectory()||!fs.existsSync(dst)||!same(src,dst)});
// The staged application must mirror the built application exactly.
prune(appSource,appDest);
fs.rmSync(path.join(dev,'release/Ramo/ramoresearchresponsiveuinativeeditor.exe'),{force:true});
// The Electron executable is the public entry point; no launcher script is needed.
fs.rmSync(path.join(dev,'release/Ramo/Start Ramo.bat'),{force:true});
fs.rmSync(path.join(dev,'release/Ramo/debug.log'),{force:true});
for(const file of ['LICENSE','NOTICE'])fs.copyFileSync(path.join(dev,file),path.join(dev,'release/Ramo',file));
fs.copyFileSync(path.join(dev,'vendor/THIRD-PARTY-NOTICES.txt'),path.join(dev,'release/Ramo/THIRD-PARTY-NOTICES.txt'));
console.log('Standalone application staged.');
