import {text,norm,words,researchArray,rows} from './helpers.js';

class DocumentService {
    constructor(store){this.store=store;this.cache=new Map();}
    chunks(doc){
      if(!doc||typeof doc!=='object')return [];
      const content=typeof doc.content==='string'?doc.content:'';
      // Durable localStorage rows intentionally omit content and act only as pointers to
      // IndexedDB. A metadata-only row is not an empty document and must never crash search.
      if(!content)return [];
      const id=text(doc.id||'document'),updated=text(doc.updated||''),name=text(doc.name||'Document'),key=id+'|'+updated+'|'+content.length;
      if(this.cache.has(key))return this.cache.get(key);const body=content.replace(/\r\n/g,'\n'),parts=[];let start=0,index=0;while(start<body.length&&index<500){let end=Math.min(start+1400,body.length);if(end<body.length){const candidates=[body.lastIndexOf('\n\n',end),body.lastIndexOf('\n',end),body.lastIndexOf('. ',end)];const cut=Math.max(...candidates);if(cut>start+650)end=cut+(body[cut]==='.'?1:0);}const passage=body.slice(start,end).trim();if(passage)parts.push({document_id:id,name,chunk:index++,passage,updated});if(end>=body.length)break;start=Math.max(end-180,start+1);}this.cache.clear();this.cache.set(key,parts);return parts;}
    search(query,limit=5){const docs=researchArray(this.store?.data?.documents),queryTokens=[...new Set(words(query))],phrase=norm(query),rows=[];if(queryTokens.length)for(const doc of docs){const parts=this.chunks(doc);for(const part of parts){const docName=text(doc?.name),body=norm(docName+' '+part.passage),tokens=new Set(words(body));let hits=0,frequency=0;for(const token of queryTokens)if(tokens.has(token)){hits++;frequency+=Math.min(3,body.split(token).length-1);}const coverage=hits/queryTokens.length,nameHits=queryTokens.filter(t=>norm(docName).includes(t)).length,exact=phrase.length>8&&body.includes(phrase)?1:0,score=coverage*3+frequency*.12+nameHits*.55+exact*1.5;if(hits&&(coverage>=.2||nameHits||exact))rows.push({...part,score:Number(score.toFixed(3))});}}
      if(!rows.length&&/\b(?:file|document|txt|uploaded text|upload)\b/i.test(query)){const usable=docs.filter(d=>typeof d?.content==='string'&&d.content.length);if(usable.length){const latest=[...usable].sort((a,b)=>text(b.updated).localeCompare(text(a.updated)))[0];return this.chunks(latest).slice(0,limit).map((part,i)=>({...part,score:Number((1-i*.01).toFixed(3)),fallback:'newest document reference'}));}}
      return rows.sort((a,b)=>b.score-a.score||text(b.updated).localeCompare(text(a.updated))).slice(0,limit);}
  }
export {DocumentService};
