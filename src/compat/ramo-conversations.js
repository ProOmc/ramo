/* Desktop lifecycle. The legacy shared library record remains internal to the engine. */
(function () {
  'use strict';
  const defaultTitles = new Set(['', 'Main', 'New chat']);
  function hasContent(c) {
    return !!(c.messages?.length || c.attempt || c.tasks?.length || c.branches?.length || c.savedNotes?.length ||
      c.queuedFollowups?.length || c.working?.turns?.length || c.researchState?.active || !defaultTitles.has(c.title || ''));
  }
  function title(c) {
    if(c.id !== 'main' || !defaultTitles.has(c.title || '')) return c.title || 'New conversation';
    return String(c.messages?.find(m => m.user?.trim())?.user || 'Saved conversation').replace(/\s+/g,' ').trim().slice(0,72);
  }
  function conversations(a) { return a.engine.store.data.chats.filter(hasContent).map(c => ({...c,title:title(c)})); }
  function install(a,u) {
    if(a.studioConversationsInstalled) return;
    a.studioConversationsInstalled=true;
    const create=a.createChatSession.bind(a),select=a.selectChatSession.bind(a),remove=a.deleteChatSession.bind(a),list=a.listChatSessions.bind(a);
    a.createChatSession=async()=>{
      await a.initialize();if(a.session) throw Error('Finish the active request before starting a new conversation.');
      const store=a.engine.store;
      // Never reuse an archived blank as the fresh chat: the React sidebar
      // intentionally hides archived rows, so that would strand the new chat.
      const empty=store.data.chats.find(c=>c.id===store.data.activeChatId&&c.id!=='main'&&!c.archived&&!hasContent(c)) || store.data.chats.find(c=>c.id!=='main'&&!c.archived&&!hasContent(c));
      const id=empty?await select(empty.id):await create();
      a.pendingDocument=null;const input=u.composer?.querySelector('#ramo-command-input-v180');if(input)input.value='';
      u._writeProjectPrompt('');u._resizeComposer();return id;
    };
    const startBlank=a.createChatSession;let pendingBlank=null;
    a.createChatSession=()=>pendingBlank||(pendingBlank=startBlank().finally(()=>{pendingBlank=null;}));
    a.listChatSessions=async()=>{
      const info=await list(),visible=new Map(conversations(a).map(c=>[c.id,c]));
      return {...info,chats:info.chats.filter(c=>visible.has(c.id)).map(c=>({...c,title:visible.get(c.id).title,main:false}))};
    };
    a.deleteChatSession=async id=>{
      await a.initialize();if(a.session)throw Error('Stop generation before deleting a conversation.');
      const wasActive=a.engine.store.data.activeChatId===id;
      if(id==='main'){
        // Delete the confirmed transcript while preserving skills and global personal memory.
        a.harness.write(()=>{
          const c=a.engine.store.data.chats.find(c=>c.id==='main');
          for(const k of ['contextSummary','contextSummaryThroughAt','toolRuns','tasks','taskRevision','attempt','savedNotes','branches','branchId','queuedFollowups','contextUsage','harness','pinned','archived'])delete c[k];
          c.messages=[];c.title='Main';c.working=a.engine.store._blankWorking();c.researchState=a.engine.store._blankResearch();
          if(wasActive){a.engine.store.data.working=c.working;a.engine.store.data.researchState=c.researchState;}
        });
        if(wasActive)a._restoreChatSurface();
      }else await remove(id);
      if(wasActive)await a.createChatSession();
    };
    u._renderDrawerChats=function(){
      const box=this.navShell?.querySelector('.ramo-drawer-chat-list');if(!box)return;
      const active=a.engine.store.data.activeChatId,query=this.chatSearch||'';
      const rows=conversations(a).filter(c=>(this.showArchived||!c.archived||c.id===active)&&(!query||(c.title+' '+c.messages.map(m=>m.user+' '+m.assistant).join(' ')).toLowerCase().includes(query)))
        .sort((x,y)=>Number(!!y.pinned)-Number(!!x.pinned)||(y.updated||y.created||0)-(x.updated||x.created||0)).slice(0,100);
      const stamp=JSON.stringify(rows.map(c=>[c.id,c.title,!!c.pinned,!!c.archived]))+active;
      if(box.dataset.stamp===stamp)return;box.dataset.stamp=stamp;box.replaceChildren();
      for(const c of rows){const b=document.createElement('button');b.type='button';b.dataset.chatId=c.id;b.className='ramo-drawer-chat-entry'+(c.id===active?' active':'');b.textContent=(c.pinned?'★ ':'')+c.title+(c.archived?' · archived':'');b.title=b.textContent;box.append(b);}
      if(!rows.length){const hint=document.createElement('p');hint.className='oc-history-empty';hint.textContent=query?'No matching conversations':'Your conversations will appear here.';box.append(hint);}
    };
  }
  window.RamoConversations={install,conversations,title};
})();
