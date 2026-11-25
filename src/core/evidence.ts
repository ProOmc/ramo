export interface EvidenceInput{url:string;title:string;snippet?:string;text?:string;read?:boolean;[key:string]:unknown}
export interface Evidence extends EvidenceInput{id:string;checked_at:string}
export class EvidenceRegistry{
 private byId=new Map<string,Evidence>();
 private byURL=new Map<string,string>();
 private nextId=1;
 constructor(saved:Evidence[]=[]){
  for(const source of saved){const url=new URL(source.url);url.hash='';if(!/^S[1-9]\d*$/.test(source.id)||this.byId.has(source.id)||this.byURL.has(url.href)||!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('Invalid saved evidence registry.');this.byId.set(source.id,{...source,url:url.href});this.byURL.set(url.href,source.id);this.nextId=Math.max(this.nextId,Number(source.id.slice(1))+1);}
 }
 register(input:EvidenceInput):Evidence{
  const url=new URL(input.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('Evidence requires a public HTTP URL without credentials.');
  url.hash='';const canonical=url.href;
  const id=this.byURL.get(canonical)||'S'+this.nextId++;
  const source={...this.byId.get(id),...input,id,url:canonical,checked_at:new Date().toISOString()};
  this.byId.set(id,source);this.byURL.set(canonical,id);return source;
 }
 get(id:string){return this.byId.get(id);}
 values(){return [...this.byId.values()];}
 publish(title:string,report:string,status:'complete'|'partial'){
  if(!report.trim()||report.length>300000)throw Error('Use a nonempty research report under 300,000 characters.');
  const ids=[...new Set([...report.matchAll(/\[(S\d+)\](?!\()/g)].map(m=>m[1]))];
  if(!ids.length)throw Error('Cite returned source IDs before publishing research.');
  const sources=ids.map(id=>{const source=this.byId.get(id);if(!source)throw Error('Unknown research citation: '+id);return source;});
  const linked=report.replace(/\[(S\d+)\](?!\()/g,(_match,id:string)=>`[${id}](${this.byId.get(id)!.url})`);
  const content=linked+'\n\nSources\n'+sources.map(s=>`[${s.id}] ${s.title} — ${s.url}`).join('\n');
  return {id:'pi_research_'+crypto.randomUUID(),topic:title.slice(0,200),title:title.slice(0,200),summary:content,content,sources,status:status==='complete'?'ready':'partial',quality_state:status,checked_at:new Date().toISOString(),verification:'source_identity_only' as const,generated:true};
 }
}
