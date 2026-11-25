import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionCoordinator} from '../build/core/session-coordinator.js';

test('chat and work share ownership and reject a switch during generation',async()=>{
 const calls=[];let release;const wait=new Promise(r=>release=r);
 const transport={request:async(method,params)=>{calls.push({method,params});if(method==='prompt')await wait;return {sessionId:'one'};}};
 const c=new SessionCoordinator(transport);
 await c.open({key:'chat:main',cwd:'project',model:'fast'});
 const pending=c.prompt({text:'hello'});
 await assert.rejects(()=>c.open({key:'work:other',cwd:'other',model:'fast'}),/active/i);
 assert.equal(c.activeKey,'chat:main');
 release();await pending;
 assert.equal(c.busy,false);
});

test('a task sent while the session is opening waits for that session',async()=>{
 // The Work view can send a task while the project is still opening. That task
 // belongs to the session being opened, so it must wait rather than be lost.
 let release;const calls=[];
 const c=new SessionCoordinator({request:async method=>{calls.push(method);if(method==='open')await new Promise(r=>{release=r;});return {sessionId:'one'};}});
 const opened=c.open({key:'work:one',cwd:'project',model:'fast'});
 const prompted=c.prompt({text:'task'});
 await new Promise(r=>setTimeout(r,10));
 assert.deepEqual(calls,['open'],'the task reached the runtime before the session opened');
 assert.equal(c.busy,true);
 release();await opened;await prompted;
 assert.deepEqual(calls,['open','prompt']);
 assert.equal(c.activeKey,'work:one');
 assert.equal(c.busy,false);
});

test('failed open does not replace the canonical session identity',async()=>{
 const c=new SessionCoordinator({request:async(method,p)=>{if(p?.cwd==='bad')throw Error('failed');return {sessionId:'one'};}});
 await c.open({key:'main',cwd:'good',model:'fast'});
 await assert.rejects(()=>c.open({key:'other',cwd:'bad',model:'fast'}));
 assert.equal(c.activeKey,'main');
});

test('abort reaches the active runtime while prompt is pending',async()=>{
 let stopped=false,release;const c=new SessionCoordinator({request:async(method)=>{if(method==='prompt')await new Promise(r=>release=r);if(method==='abort'){stopped=true;release();}return {sessionId:'one'};}});
 await c.open({key:'main',cwd:'project',model:'fast'});
 const pending=c.prompt({text:'task'});await c.abort();await pending;assert.equal(stopped,true);
});
