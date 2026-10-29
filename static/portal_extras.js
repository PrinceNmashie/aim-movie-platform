function reviewVisible(x){
 const filter=P.filter||'pending';if(filter==='all')return true;
 if(filter==='available')return x.status==='submitted'&&x.user_id!==P.auth.user.id;
 if(filter==='mine')return x.status==='in_review'&&x.reviewer_id===P.auth.user.id;
 if(filter==='claimed')return x.status==='in_review'&&x.reviewer_id!==P.auth.user.id;
 return ['submitted','in_review'].includes(x.status);
}
'use strict';
function extendedPost(r){
 if(r.unavailable)return `<div class="empty-saved"><p>This saved creation is no longer available.</p><button class="button ghost small" data-act="save-post" data-id="${pe(r.id)}" data-saved="true">Remove saved creation</button></div>`;
 const m=r.metadata||{},ratio=m.width>0&&m.height>0?m.width+'/'+m.height:'16/9';
 return `<article class="feed-post" data-post="${pe(r.id)}"><video class="feed-video" style="aspect-ratio:${pe(ratio)}" src="${pe(r.video_url)}" controls muted playsinline loop preload="metadata" aria-label="${pe(r.title)}"></video><div class="feed-meta"><div class="creator-line"><a class="creator-avatar" href="${pe(r.creator_url)}" aria-label="View ${pe(r.author)}’s profile">${r.author_avatar_url?`<img src="${pe(r.author_avatar_url)}" alt="" loading="lazy">`:pe(r.author.slice(0,1))}</a><a class="creator-name" href="${pe(r.creator_url)}">${pe(r.author)}</a><span>· ${pe(r.kind)}</span></div><h2><a href="/watch/${pe(r.id)}">${pe(r.title)}</a></h2><p>${pe(r.public_caption)}</p><div class="post-facts"><span>${Number(m.duration_seconds||0).toFixed(1)} seconds</span>${m.width&&m.height?`<span>${pe(m.width)} × ${pe(m.height)}</span>`:''}<span>${m.has_audio?'Sound available · starts muted':'Silent video'}</span></div><div class="tag-row">${r.tags.map(t=>`<span class="tag">#${pe(t)}</span>`).join('')}</div><div class="feed-actions"><div class="row"><button class="reaction-button ${r.liked?'liked':''}" data-act="like" data-id="${pe(r.id)}" aria-pressed="${r.liked}" aria-label="${r.liked?'Unlike':'Like'} ${pe(r.title)}">♡ ${r.likes}</button><button class="reaction-button ${r.saved?'saved':''}" data-act="save-post" data-id="${pe(r.id)}" data-saved="${!!r.saved}" aria-pressed="${!!r.saved}">${r.saved?'Saved':'Save'}</button><button class="button ghost small" data-act="share-post" data-id="${pe(r.id)}" data-title="${pe(r.title)}">Share</button>${m.has_audio?`<button class="button ghost small" data-act="sound" data-id="${pe(r.id)}" aria-pressed="false">Sound on</button>`:''}</div><span class="portal-muted">${r.views} signed-in ${r.views===1?'viewer':'viewers'}</span><button class="button ghost small" data-act="report" data-id="${pe(r.id)}">Report</button></div></div></article>`;
}
function extendedFeedPage(){
 pm().innerHTML=`<div class="feed-head"><div><div class="eyebrow">THE AIM.MOVIE COMMUNITY</div><h1 class="portal-title">Discover your next story.</h1></div><div class="feed-tabs"><button data-act="feed-foryou" class="${P.mode==='foryou'?'active':''}">For you</button><button data-act="feed-latest" class="${P.mode==='latest'?'active':''}">Latest</button>${P.auth.user?`<button data-act="feed-following" class="${P.mode==='following'?'active':''}">Following</button>`:''}</div></div><form id="feed-search-form" class="feed-search"><label class="sr-only" for="feed-search">Search creations or creators</label><input id="feed-search" class="portal-input" name="q" maxlength="120" value="${pe(P.search||'')}" placeholder="Search stories, tags or creators"><label class="sr-only" for="feed-kind">Creation type</label><select id="feed-kind" class="portal-input" name="kind">${[['','All creations'],['clip','Clips'],['scene','Scenes'],['movie','Movies']].map(([v,t])=>`<option value="${v}" ${P.kind===v?'selected':''}>${t}</option>`).join('')}</select><label class="sr-only" for="feed-audio">Sound</label><select id="feed-audio" class="portal-input" name="audio">${[['','Any sound'],['yes','With sound'],['no','Silent']].map(([v,t])=>`<option value="${v}" ${P.audio===v?'selected':''}>${t}</option>`).join('')}</select><button class="button secondary">Search</button></form><div class="feed-layout"><div id="feed-items">${P.items.map(post).join('')||`<div class="no-content"><h2>${P.search||P.kind||P.audio?'No matching creations.':P.mode==='following'?'Follow creators to see their stories here.':'The next story could be yours.'}</h2><a class="button secondary" href="/discover">Explore Discover</a></div>`}${P.next!==null?'<button class="button secondary" data-act="feed-more">Load more creations</button>':''}</div><aside class="feed-rail"><section class="portal-card"><h2>Your idea belongs on screen.</h2><p class="portal-muted">Start a conversation, shape your story, and make your first clip.</p><a class="button primary" href="/">Open my studio →</a></section><details class="portal-card"><summary>Why these creations?</summary><p class="portal-muted">For you considers themes you have liked, recent posts, community reactions, and creations you have already watched. Choose Latest for publication order, or Following for creators you follow.</p></details>${P.auth.user?'<a class="button ghost" href="/account/saved">Open saved creations →</a>':''}</aside></div>`;observeFeed();
}
function extendedObserveFeed(){
 if(P.observer)P.observer.disconnect();
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 P.observer=new IntersectionObserver(entries=>entries.forEach(entry=>{const v=entry.target;if(entry.isIntersecting&&!reduced)v.play().catch(()=>{});else v.pause();}),{threshold:.65});
 document.querySelectorAll('.feed-video').forEach(v=>{
  P.observer.observe(v);let counted=false;
  v.addEventListener('timeupdate',()=>{if(counted||!P.auth.user||v.paused||!Number.isFinite(v.duration))return;let played=0;for(let i=0;i<v.played.length;i++)played+=v.played.end(i)-v.played.start(i);if(played>=Math.min(3,v.duration*.8)){counted=true;req('community/'+v.closest('[data-post]').dataset.post+'/view',{}).catch(()=>{});}});
 });
}
async function loadSaved(reset=true){
 const r=await req('account/saved?offset='+(reset?0:P.savedNext));P.savedItems=reset?r.items:P.savedItems.concat(r.items);P.savedNext=r.next_offset;
 pm().innerHTML=`<a href="/account" class="button ghost small">← Your dashboard</a><div class="eyebrow">YOUR PRIVATE COLLECTION</div><h1 class="portal-title">Saved creations</h1><p class="portal-lead">Keep stories to come back to. Only you can see this list.</p><div class="profile-posts">${P.savedItems.map(post).join('')||'<div class="no-content"><h2>Save something for later.</h2><a class="button secondary" href="/discover">Explore Discover</a></div>'}</div>${P.savedNext!==null?'<button class="button secondary" data-act="saved-more">Load more saved creations</button>':''}`;observeFeed();
}
async function loadWatch(){
 const id=location.pathname.split('/')[2];
 try{const r=await req('community/posts/'+encodeURIComponent(id));P.watchItem=r.item;document.title=r.item.title+' · AIM.movie';pm().innerHTML='<a href="/discover" class="button ghost small">← Discover</a><div class="profile-posts">'+post(r.item)+'</div>';observeFeed();}
 catch(error){pm().innerHTML='<div class="no-content"><h1>This creation is unavailable.</h1><p>It may have been unpublished or removed.</p><a class="button secondary" href="/discover">Explore Discover</a></div>';}
}
async function loadInbox(reset=true){
 const r=await req('account/notifications?offset='+(reset?0:P.inboxNext));P.inboxItems=reset?r.items:P.inboxItems.concat(r.items);P.inboxNext=r.next_offset;
 pm().innerHTML=`<a href="/account" class="button ghost small">← Your dashboard</a><div class="row between wrap"><h1 class="portal-title">Notifications</h1><button class="button ghost small" data-act="notices-read">Mark all read</button></div><section class="portal-card">${P.inboxItems.map(n=>`<article class="notification-row ${n.read_at?'':'unread'}"><div><a href="${pe(n.link)}" data-notice="${pe(n.id)}">${pe(n.title)}</a><p class="portal-muted">${pe(new Date(n.created).toLocaleString())}</p></div>${n.read_at?'':`<button class="button ghost small" data-act="notice-read" data-id="${pe(n.id)}">Mark read</button>`}</article>`).join('')||'<p class="portal-muted">You’re all caught up.</p>'}</section>${P.inboxNext!==null?'<button class="button secondary" data-act="notices-more">Older notifications</button>':''}<a href="/account/settings#notifications" class="button secondary">Notification settings</a>`;
}
function tasksPage(items){
 pm().innerHTML=`<a href="/account" class="button ghost small">← Your dashboard</a><div class="row between"><h1 class="portal-title">Your tasks</h1><button class="button ghost small" data-act="tasks-refresh">Refresh</button></div><p class="portal-lead">Work continues while you are away. Open a result to return to its project.</p><section class="portal-card">${items.map(t=>`<article class="task-row"><div><strong>${pe(t.label)}</strong><p class="portal-muted">${pe(t.status.replaceAll('_',' '))}${t.total?' · '+t.progress+' of '+t.total+' excerpts saved':''} · ${pe(new Date(t.created).toLocaleString())}</p>${t.error?`<p class="task-error">${pe(t.error)}</p>`:''}</div><a class="button secondary small" href="${pe(t.url)}">Open project</a>${t.label==='Book analysis'&&['queued','running'].includes(t.status)?`<button class="button ghost small" data-task-pause="${pe(t.id)}">${t.cancel_requested?'Pausing after this excerpt':'Pause'}</button>`:''}</article>`).join('')||'<p class="portal-muted">No tasks yet.</p>'}</section>`;
}
async function loadTasks(){const r=await req('account/tasks');tasksPage(r.items);}
function notificationSettingsHTML(){
 const p=P.notificationPrefs||{events:[],email_enabled:false,verified:false,email_available:false,frequency:'instant'};
 const events=[['creation_ready','Images, scripts and scenes ready'],['creation_failed','Tasks needing attention'],['review_decision','Approval and review feedback']];
 if(['admin','reviewer'].includes(P.auth.user.role))events.push(['review_available','New submissions available'],['review_assigned','Reviews you claimed'],['review_reminder','Reminders for your claimed reviews']);
 return `<section class="portal-card notification-preferences" id="notifications"><h2>Notifications</h2><p class="portal-muted">Choose what appears in your notification inbox.</p><form id="notification-form" class="portal-form">${events.map(([id,text])=>`<label class="check"><input type="checkbox" name="event-${id}" ${p.events.includes(id)?'checked':''}>${text}</label>`).join('')}<label class="check"><input type="checkbox" name="email_enabled" ${p.email_enabled?'checked':''} ${!p.email_available||!p.verified?'disabled':''}>Also email me these updates</label>${!p.email_available?'<p class="portal-muted">Email alerts aren’t available yet. Your in-site inbox still works.</p>':!p.verified?'<button type="button" class="button ghost small" data-act="verify-email">Confirm my email for notifications</button>':'<p class="portal-muted">Email confirmed.</p>'}<label>Email frequency<select name="frequency"><option value="instant" ${p.frequency==='instant'?'selected':''}>When updates arrive</option><option value="daily" ${p.frequency==='daily'?'selected':''}>Daily digest</option></select></label><button class="button secondary">Save notification preferences</button></form>${portalAdmin('<p class="portal-muted">Email requires AIM_PUBLIC_URL (HTTPS), AIM_SMTP_HOST and AIM_EMAIL_FROM. See the installation guide for encrypted SMTP options. Failed email never prevents a submission or decision.</p>')}</section>`;
}
async function extraAct(a,el){
 if(a==='share-post'){const message=await AIMSocial.share(el.dataset.id,el.dataset.title);if(message)say(message);return true;}
 if(a==='save-post'){
  if(!P.auth.user){location.href='/login';return true;}
  const saved=el.dataset.saved!=='true';await req('community/'+el.dataset.id+'/save',{saved});
  el.dataset.saved=String(saved);el.setAttribute('aria-pressed',String(saved));el.classList.toggle('saved',saved);el.textContent=saved?'Saved':'Save';
  for(const collection of [P.items,P.profileItems,P.likedItems,P.savedItems])for(const item of collection||[])if(item.id===el.dataset.id)item.saved=saved;
  if(location.pathname==='/account/saved')await loadSaved();return true;
 }
 if(a==='sound'){const video=el.closest('[data-post]').querySelector('video');video.muted=!video.muted;el.textContent=video.muted?'Sound on':'Mute';el.setAttribute('aria-pressed',String(!video.muted));return true;}
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
 if(form.id==='feed-search-form'){P.search=v.q;P.kind=v.kind;P.audio=v.audio;await loadFeed();return true;}
 if(form.id==='notification-form'){const events=[...form.querySelectorAll('input[name^="event-"]:checked')].map(x=>x.name.slice(6));await req('account/notification-preferences',{events,email_enabled:!!form.elements.email_enabled.checked,frequency:v.frequency});await settings();say('Notification preferences saved.');return true;}
 return false;
}
document.addEventListener('aim:tasks',event=>{if(location.pathname==='/account/tasks')tasksPage(event.detail.items);});
document.addEventListener('aim:inbox',()=>{if(location.pathname==='/account/notifications')loadInbox().catch(()=>{});});
document.addEventListener('aim:resume',()=>{if(location.pathname==='/review'&&!P.reviewDirty)loadQueue().catch(()=>{});});
document.addEventListener('input',event=>{if(event.target.closest('#decision-form,#takedown-form'))P.reviewDirty=true;});
