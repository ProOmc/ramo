import {words,human,recall} from './helpers.js';

class EpisodeArchive {
    constructor(){this.error='';}
    async open(name,create){if(typeof indexedDB==='undefined')return null;return new Promise(resolve=>{const request=indexedDB.open(name);request.onupgradeneeded=()=>{if(!create){request.transaction.abort();return;}request.result.createObjectStore('episodes',{keyPath:'id'});};request.onsuccess=()=>resolve(request.result);request.onerror=request.onblocked=()=>resolve(null);});}
    async append(row){const db=await this.open('AI_ASSISTANT_V282_EPISODES',true);if(!db)return false;return new Promise(resolve=>{const tx=db.transaction('episodes','readwrite');tx.objectStore('episodes').put(row);tx.oncomplete=()=>{db.close();resolve(true);};tx.onerror=tx.onabort=()=>{this.error='Conversation archive write failed.';db.close();resolve(false);};});}
    async search(query){const tokens=words(query),generic=/what (?:were|are) we talking|what did we discuss/i.test(query),found=[];
      for(const name of ['AI_ASSISTANT_V282_EPISODES']){const db=await this.open(name,false);if(!db)continue;if(!db.objectStoreNames.contains('episodes')){db.close();continue;}await new Promise(resolve=>{const tx=db.transaction('episodes','readonly');let count=0;const req=tx.objectStore('episodes').openCursor(null,'prev');req.onsuccess=()=>{const c=req.result;if(!c)return;const r=c.value,u=r.user||r.user_message;if(human(u)&&!recall(u)&&(generic||tokens.some(k=>words(u).includes(k))))found.push({id:r.id,user:u,at:r.at||r.created||''});count++;if(count<3000&&found.length<12)c.continue();};tx.oncomplete=tx.onerror=tx.onabort=()=>{db.close();resolve();};});if(found.length>=12)break;}
      return found.slice(0,8);
    }
  }
export {EpisodeArchive};
