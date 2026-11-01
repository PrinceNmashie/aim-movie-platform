function reviewVisible(x){
 const filter=P.filter||'pending';if(filter==='all')return true;
 if(filter==='available')return x.status==='submitted'&&x.user_id!==P.auth.user.id;
 if(filter==='mine')return x.status==='in_review'&&x.reviewer_id===P.auth.user.id;
 if(filter==='claimed')return x.status==='in_review'&&x.reviewer_id!==P.auth.user.id;
 return ['submitted','in_review'].includes(x.status);
}
'use strict';
function extendedPost(r){return AIMFeed.card(r);}
function extendedFeedPage(){
 AIMFeed.stop();document.body.classList.add('feed-route');
 const toolbar=`<div class="feed-toolbar"><div class="feed-tabs"><button data-act="feed-foryou" class="${P.mode==='foryou'?'active':''}">For you</button><button data-act="feed-latest" class="${P.mode==='latest'?'active':''}">Latest</button>${P.auth.user?`<button data-act="feed-following" class="${P.mode==='following'?'active':''}">Following</button>`:''}</div><button class="icon-control" data-act="search-toggle" aria-label="Search creations" aria-expanded="false">${AIMIcons.svg('search')}</button></div><form id="feed-search-form" class="feed-search" hidden><label class="sr-only" for="feed-search">Search creations or creators</label><input id="feed-search" class="portal-input" name="q" maxlength="120" value="${pe(P.search||'')}" placeholder="Search AIM"><select name="kind" class="portal-input" aria-label="Creation type">${[['','All creations'],['clip','Clips'],['scene','Scenes'],['movie','Movies']].map(([v,t])=>`<option value="${v}" ${P.kind===v?'selected':''}>${t}</option>`).join('')}</select><button class="button secondary">Search</button></form>`;
 pm().innerHTML=AIMFeed.shell(P.items,toolbar);observeFeed();
}
function extendedObserveFeed(){AIMFeed.mount();}

async function loadSaved(reset=true){
 const r=await req('account/saved?offset='+(reset?0:P.savedNext));P.savedItems=reset?r.items:P.savedItems.concat(r.items);P.savedNext=r.next_offset;collectionPage('saved',P.savedItems,P.savedNext);
}
async function loadWatch(){
 const id=location.pathname.split('/')[2];document.body.classList.add('feed-route');
 try{const r=await req('community/posts/'+encodeURIComponent(id));P.watchItem=r.item;document.title=r.item.title+' · AIM.movie';const others=await req('community/feed?mode=foryou');P.items=[r.item,...others.items.filter(x=>x.id!==r.item.id)];P.next=others.next_offset;pm().innerHTML=AIMFeed.shell(P.items,'<div class="feed-toolbar"><a class="feed-back" href="/discover">← Discover</a><span>Now playing</span></div>');observeFeed();}
 catch(error){pm().innerHTML='<div class="feed-empty"><h1>This creation is unavailable.</h1><a class="button secondary" href="/discover">Explore Discover</a></div>';}
}

async function loadInbox(reset=true){
 const r=await req('account/notifications?offset='+(reset?0:P.inboxNext));P.inboxItems=reset?r.items:P.inboxItems.concat(r.items);P.inboxNext=r.next_offset;
 pm().innerHTML=`<a href="/account" class="button ghost small">← Your dashboard</a><div class="row between wrap"><h1 class="portal-title">Notifications</h1><button class="button ghost small" data-act="notices-read">Mark all read</button></div><section class="portal-card">${P.inboxItems.map(n=>`<article class="notification-row ${n.read_at?'':'unread'}"><div><a href="${pe(n.link)}" data-notice="${pe(n.id)}">${pe(n.title)}</a><p class="portal-muted">${pe(new Date(n.created).toLocaleString())}</p></div>${n.read_at?'':`<button class="button ghost small" data-act="notice-read" data-id="${pe(n.id)}">Mark read</button>`}</article>`).join('')||'<p class="portal-muted">You’re all caught up.</p>'}</section>${P.inboxNext!==null?'<button class="button secondary" data-act="notices-more">Older notifications</button>':''}<a href="/account/settings#notifications" class="button secondary">Notification settings</a>`;
}
function tasksPage(items){
 pm().innerHTML=`<a href="/" class="button ghost small">← My Studio</a><div class="row between"><h1 class="portal-title">Generation history</h1><button class="button ghost small" data-act="tasks-refresh">Refresh</button></div><p class="portal-lead">Work continues while you are away. Open a result to return to its project.</p><section class="portal-card">${items.map(t=>`<article class="task-row"><div><strong>${pe(t.label)}</strong><p class="portal-muted">${pe(t.status.replaceAll('_',' '))}${t.total?' · '+t.progress+' of '+t.total+' excerpts saved':''} · ${pe(new Date(t.created).toLocaleString())}</p>${t.error?`<p class="task-error">${pe(t.error)}</p>`:''}</div><a class="button secondary small" href="${pe(t.url)}">Open project</a>${t.label==='Book analysis'&&['queued','running'].includes(t.status)?`<button class="button ghost small" data-task-pause="${pe(t.id)}">${t.cancel_requested?'Pausing after this excerpt':'Pause'}</button>`:''}</article>`).join('')||'<p class="portal-muted">No tasks yet.</p>'}</section>`;
}
async function loadTasks(){const r=await req('account/tasks');tasksPage(r.items);}
function notificationSettingsHTML(){
 const p=P.notificationPrefs||{events:[],email_enabled:false,verified:false,email_available:false,frequency:'instant'};
 return `<section class="portal-card notification-preferences" id="notifications"><h2>Notifications</h2><p class="portal-muted">Get an update when a finished clip is ready to watch.</p><form id="notification-form" class="portal-form"><label class="check"><input type="checkbox" name="event-clip_ready" ${p.events.includes('clip_ready')?'checked':''}>Notify me when a clip is ready</label>${p.email_available?`<details class="notification-delivery"><summary>Email delivery</summary><label class="check"><input type="checkbox" name="email_enabled" ${p.email_enabled?'checked':''} ${!p.verified?'disabled':''}>Also email me when my clip is ready</label>${!p.verified?'<button type="button" class="button ghost small" data-act="verify-email">Confirm my email</button>':''}<label>Email frequency<select name="frequency"><option value="instant" ${p.frequency==='instant'?'selected':''}>When the clip is ready</option><option value="daily" ${p.frequency==='daily'?'selected':''}>Daily digest</option></select></label></details>`:''}<button class="button secondary">Save notification preferences</button></form></section>`;
}
async function extraAct(a,el){
 if(await uiAction(a,el))return true;
 if(a==='share-post'){const message=await AIMSocial.share(el.dataset.id,el.dataset.title);if(message)say(message);return true;}
 if(a==='save-post'){
  if(!P.auth.user){location.href='/login';return true;}
  const saved=el.dataset.saved!=='true';await req('community/'+el.dataset.id+'/save',{saved});
  el.dataset.saved=String(saved);el.setAttribute('aria-pressed',String(saved));el.classList.toggle('saved',saved);const label=el.querySelector('span');if(label)label.textContent=saved?'Saved':'Save';else el.textContent=saved?'Saved':'Save';
  for(const collection of [P.items,P.profileItems,P.likedItems,P.savedItems])for(const item of collection||[])if(item.id===el.dataset.id)item.saved=saved;
  if(location.pathname==='/account/saved')await loadSaved();return true;
 }
 
 if(a==='follow'){if(!P.auth.user){location.href='/login';return true;}await req('creators/'+el.dataset.id+'/follow',{following:!P.profile.following});await loadProfile();return true;}
 if(a==='feed-following'){P.mode='following';await loadFeed();return true;}
 if(a==='saved-more'){await loadSaved(false);return true;}
 if(a==='tasks-refresh'){await loadTasks();return true;}
 if(a==='notices-more'){await loadInbox(false);return true;}
 if(a==='notice-read'||a==='notices-read'){await req('account/notifications/read',a==='notice-read'?{id:el.dataset.id}:{});await loadInbox();AIMInbox.refresh();return true;}
 if(a==='verify-email'){await req('account/notification-email/verify',{});say('Confirmation email queued. Check your inbox shortly.');return true;}
 return false;
}
async function extraSubmit(form,v){
 if(form.id==='feed-search-form'){P.search=v.q;P.kind=v.kind;P.audio='';await loadFeed();return true;}
 if(form.id==='notification-form'){const events=[...form.querySelectorAll('input[name^="event-"]:checked')].map(x=>x.name.slice(6));await req('account/notification-preferences',{events,email_enabled:!!form.elements.email_enabled?.checked,frequency:v.frequency||'instant'});await settings();say('Notification preferences saved.');return true;}
 return false;
}
document.addEventListener('aim:tasks',event=>{if(location.pathname==='/account/tasks')tasksPage(event.detail.items);});
document.addEventListener('aim:inbox',()=>{if(location.pathname==='/account/notifications')loadInbox().catch(()=>{});});
document.addEventListener('aim:resume',()=>{if(location.pathname==='/review'&&!P.reviewDirty)loadQueue().catch(()=>{});});
document.addEventListener('input',event=>{if(event.target.closest('#decision-form,#takedown-form'))P.reviewDirty=true;});
