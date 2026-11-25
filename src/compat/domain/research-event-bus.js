import {text} from './helpers.js';

class ResearchEventBus {
    constructor(){this.listeners=new Set();this.current=null;this.history=[];}
    emit(event){this.current=event;this.history.push({...event,text:undefined});if(this.history.length>120)this.history.shift();for(const fn of [...this.listeners])try{fn(event);}catch(_){}}
    subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  }
export {ResearchEventBus};
