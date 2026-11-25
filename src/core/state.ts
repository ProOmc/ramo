export interface DefaultValue{name:string;value:unknown}
/** Explicit replacement for project variables; no VM, sprites or broadcasts. */
export class ApplicationState{
 private cells=new Map<string,unknown>();
 private names=new Map<string,string>();
 private listeners=new Set<(name:string,value:unknown)=>void>();
 constructor(defaults:Record<string,DefaultValue>,saved:Record<string,unknown>={}){
  for(const [id,{name,value}]of Object.entries(defaults)){this.names.set(name,id);this.cells.set(id,value);}
  for(const [name,value]of Object.entries(saved))this.set(name,value);
 }
 get(name:string){return this.cells.get(this.names.get(name)??name);}
 set(name:string,value:unknown){const id=this.names.get(name)??name;this.cells.set(id,value);for(const listener of this.listeners)listener(name,value);}
 subscribe(listener:(name:string,value:unknown)=>void){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
 snapshot(){return Object.fromEntries(this.cells);}
}
