export interface RuntimeTransport { request(method:string, params?:Record<string,unknown>):Promise<unknown> }
/**
 * The request that opens a session.
 *
 * `memoryIsolation` is explicit: a separate conversation in Chat carries no
 * personal memory at all, while the main conversation and every Work session
 * share the one global store the worker owns. `legacyMemory` is the old
 * renderer store, offered once so the worker can import it.
 */
export interface OpenSession {key:string; cwd:string; model:string; sessionId?:string; permission?:'read'|'ask'|'full'; mode?:'assistant'|'project'; history?:HistoryMessage[]; context?:string; contextWindow?:number;generation?:{outputTokens?:number;temperature?:number};thinking?:string;hostTools?:unknown[];memoryIsolation?:boolean;legacyMemory?:unknown}
export interface HistoryMessage {role:'user'|'assistant';content:string;images?:{data:string;mimeType:string}[]}
export interface SessionState {sessionId:string;cwd?:string;messages?:PiMessage[];busy?:boolean;[key:string]:unknown}
export interface PiMessage {role:string;content:string|{type:string;text?:string;[key:string]:unknown}[];stopReason?:string;errorMessage?:string;[key:string]:unknown}
export function isSessionState(value:unknown):value is SessionState{return !!value&&typeof value==='object'&&typeof (value as Record<string,unknown>).sessionId==='string';}
