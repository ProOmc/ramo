import type {RuntimeTransport,OpenSession,SessionState} from './contracts.js';
import {isSessionState} from './contracts.js';

/** One owner across all views. The Ramo session is authoritative model context. */
export class SessionCoordinator {
  private transport:RuntimeTransport;
  private opening=false;
  private running=false;
  /** The open that is in flight, so a task can wait for the session it belongs to. */
  private pendingOpen:Promise<SessionState>|undefined;
  private currentKey:string|undefined;
  private currentState:SessionState|undefined;
  constructor(transport:RuntimeTransport){this.transport=transport;}
  get activeKey(){return this.currentKey;}
  get busy(){return this.running||this.opening;}
  get state(){return this.currentState;}
  /** Re-attaching the same session is harmless; switching it during a task is not. */
  attach(key:string,state:SessionState){if(this.busy&&this.currentKey!==key)throw Error('The active task owns the session.');this.currentKey=key;this.currentState=state;}
  async open(input:OpenSession):Promise<SessionState>{
   if(this.busy)throw Error('Stop the active task before switching sessions.');
   this.opening=true;
   const attempt=(async()=>{
    const value=await this.transport.request('open',input as unknown as Record<string,unknown>);
    if(!isSessionState(value))throw Error('Runtime returned an invalid session.');
    this.currentKey=input.key;this.currentState=value;return value;
   })();
   this.pendingOpen=attempt;
   try{return await attempt;}
   finally{if(this.pendingOpen===attempt)this.pendingOpen=undefined;this.opening=false;}
  }
  async prompt(input:Record<string,unknown>):Promise<SessionState>{
   if(this.running)throw Error('The active task is still running.');
   // A task that arrives while the session is still opening belongs to that
   // session, so it waits for the open instead of being rejected and lost.
   const opening=this.pendingOpen;
   if(opening)await opening;
   if(!this.currentKey)throw Error('Open a session first.');
   if(this.running)throw Error('The active task is still running.');
   this.running=true;
   try{const value=await this.transport.request('prompt',input);if(!isSessionState(value))throw Error('Runtime returned invalid completion state.');this.currentState=value;return value;}
   finally{this.running=false;}
  }
  async abort(){return this.transport.request('abort');}
}
