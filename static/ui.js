'use strict';
function creationGrid(items,empty='No creations yet.'){
 return `<div class="creation-grid">${items.map(r=>r.unavailable?`<div class="creation-unavailable">Unavailable<button class="button ghost small" data-act="save-post" data-id="${pe(r.id)}" data-saved="true">Remove</button></div>`:`<a class="creation-tile" href="/watch/${pe(r.id)}" aria-label="Watch ${pe(r.title)}"><video src="${pe(r.video_url)}#t=0.1" muted playsinline preload="metadata"></video><div><strong>${pe(r.title)}</strong><span>${AIMIcons.svg('heart')}${r.likes||0}</span></div></a>`).join('')||`<div class="profile-empty">${pe(empty)}</div>`}</div>`;
}
function creatorHeader(profile,own=false){
 return `<section class="aim-profile-head"><div class="aim-profile-avatar">${avatarMarkup(profile.avatar_url,profile.name,true)}</div><div class="aim-profile-info"><div class="profile-name-row"><div><span class="eyebrow">AIM CREATOR</span><h1>${pe(profile.name)}</h1></div></div><div class="profile-stat-line"><span><strong>${profile.published_count||0}</strong> creations</span><span><strong>${profile.followers||0}</strong> followers</span><span><strong>${profile.following_count||0}</strong> following</span><span><strong>${profile.likes||0}</strong> likes</span></div>${profile.bio?`<p class="aim-bio">${pe(profile.bio)}</p>`:''}<div class="profile-primary-actions">${own?'<a class="button secondary" href="/account/settings#profile">Edit profile</a><a class="button secondary profile-settings" href="/account/settings" aria-label="Account settings">'+AIMIcons.svg('gear')+'<span>Settings</span></a><a class="button primary" href="/">Open studio</a>':`<button class="button ${profile.following?'secondary':'primary'}" data-act="follow" data-id="${pe(profile.id)}" aria-pressed="${!!profile.following}">${profile.following?'Following':'Follow'}</button>`}<button class="icon-control" data-act="share-profile" data-id="${pe(profile.id)}" data-title="${pe(profile.name)} on AIM.movie" aria-label="Share profile">${AIMIcons.svg('share')}</button></div></div></section>`;
}
function renderCreatorProfile(){
 const u=P.profile;pm().innerHTML=`<a href="/discover" class="button ghost small profile-back">← Discover</a>${creatorHeader(u,u.is_owner)}<div class="profile-tabs"><span class="active">Creations</span></div>${creationGrid(P.profileItems,'This creator hasn’t published anything yet.')}${P.profileNext!==null?'<button class="button secondary" data-act="profile-more">Load more</button>':''}`;
}
function ownCreations(items){
 return items.map(r=>`<article class="own-creation"><video src="${pe(r.video_url)}" controls playsinline preload="metadata"></video><div><span class="review-status">${pe(AIMPublication.status(r))}</span><h3>${pe(r.title)}</h3>${r.decision_note?`<p>${pe(r.decision_note)}</p>`:''}<div class="row wrap">${AIMPublication.buttons(r)}<button class="button ghost small" data-act="open-project" data-id="${pe(r.project_id)}" data-dest="share">Open project</button>${r.status!=='withdrawn'?`<button class="button ghost small" data-act="withdraw" data-id="${pe(r.id)}">Withdraw</button>`:''}</div></div></article>`).join('')||'<div class="profile-empty">Your drafts and review updates will appear here.</div>';
}
function renderAccount(mine){
 AIMFeed.stop();P.mine=mine;const profile=P.accountProfile||{...P.auth.user,published_count:mine.items.filter(r=>r.status==='published').length};
 const tab=P.accountTab||'creations';
 const tabs=[['creations','Creations'],['drafts','Drafts & reviews'],['projects','Projects']];
 let content=tab==='creations'?creationGrid(mine.items.filter(r=>r.status==='published'&&r.publish),'Publish your first creation to share it here.'):tab==='drafts'?ownCreations(mine.items.filter(r=>r.status!=='published')):`<div class="project-grid">${P.auth.projects.map(p=>`<div class="project-tile"><h3>${pe(p.name)}</h3><button class="button secondary small" data-act="open-project" data-id="${pe(p.id)}">Open studio</button></div>`).join('')}</div><form id="new-project-form" class="portal-form new-project-inline"><label>New project name<input name="name" maxlength="120" required></label><button class="button primary">Create project</button></form>`;
 pm().innerHTML=`${creatorHeader(profile,true)}<nav class="profile-tabs" aria-label="Your collections">${tabs.map(([id,label])=>`<button class="${tab===id?'active':''}" data-act="account-tab" data-tab="${id}">${label}</button>`).join('')}<a href="/account/likes">Liked <span class="private-mark" aria-label="Private">⌑</span></a><a href="/account/saved">Saved <span class="private-mark" aria-label="Private">⌑</span></a></nav><section class="profile-content">${content}</section>`;
}
function collectionPage(kind,items,next,total){
 AIMFeed.stop();pm().innerHTML=`<a href="/account" class="button ghost small">← Profile</a><div class="collection-heading"><h1>${kind==='likes'?'Liked videos':'Saved creations'}</h1><span>Only you</span></div>${creationGrid(items,kind==='likes'?'Tap the heart on a creation to keep it here.':'Save creations to watch again later.')}${next!==null?`<button class="button secondary" data-act="${kind==='likes'?'likes-more':'saved-more'}">Load more</button>`:''}`;
}
function prepareAccountSettings(){
 const main=pm(),sections=[...main.querySelectorAll(':scope > .account-settings-grid > section,:scope > section.portal-card,:scope > details.account-danger')];
 const names=[];
 for(const section of sections){const title=section.querySelector('h2,summary')?.textContent||'';const key=/Public profile/.test(title)?'profile':/Security/.test(title)?'security':/Notifications/.test(title)?'notifications':/Manage user/.test(title)?'administration':'account';section.dataset.settingsSection=key;section.id=key;names.push([key,key==='profile'?'Profile':key==='administration'?'Administration':title]);}
 // Flatten the earlier two-column layout into consistent settings panels.
 const grid=main.querySelector('.account-settings-grid');if(grid)grid.replaceWith(...grid.children);
 const shell=document.createElement('div');shell.className='settings-workspace';const nav=document.createElement('nav');nav.className='account-settings-nav';nav.setAttribute('aria-label','Account settings');nav.innerHTML=names.map(([id,label])=>`<button data-act="settings-section" data-section="${id}">${pe(label)}</button>`).join('');
 const panels=document.createElement('div');panels.className='settings-panels';sections.forEach(s=>panels.append(s));shell.append(nav,panels);main.append(shell);
 const heading=main.querySelector('h1');if(heading)heading.textContent='Settings';
 const selected=location.hash.slice(1);selectSettingsSection(names.some(([key])=>key===selected)?selected:'profile');
}
function selectSettingsSection(key){
 document.querySelectorAll('[data-settings-section]').forEach(s=>{s.hidden=s.dataset.settingsSection!==key;});document.querySelectorAll('[data-act="settings-section"]').forEach(b=>{b.classList.toggle('active',b.dataset.section===key);b.setAttribute('aria-current',b.dataset.section===key?'page':'false');});
 history.replaceState(null,'','#'+key);
}
async function uiAction(a,el){
 if(a==='account-tab'){P.accountTab=el.dataset.tab;renderAccount(P.mine);return true;}
 if(a==='settings-section'){selectSettingsSection(el.dataset.section);return true;}
 if(a==='search-toggle'){const panel=document.querySelector('#feed-search-form');panel.hidden=!panel.hidden;el.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)panel.querySelector('input').focus();return true;}
 if(a==='share-profile'){const url=new URL('/creators/'+encodeURIComponent(el.dataset.id),location.origin).href;if(navigator.share){try{await navigator.share({title:el.dataset.title,url});return true;}catch(err){if(err.name==='AbortError')return true;}}if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url);say('Profile link copied.');}else{const d=document.createElement('dialog');d.className='engagement-dialog';d.innerHTML=`<h2>Share profile</h2><input class="portal-input" readonly aria-label="Profile link" value="${pe(url)}"><form method="dialog"><button class="button secondary">Done</button></form>`;document.body.append(d);d.addEventListener('close',()=>d.remove());d.showModal();d.querySelector('input').select();}return true;}
 return false;
}
window.addEventListener('hashchange',()=>{if(location.pathname==='/account/settings')selectSettingsSection(location.hash.slice(1)||'profile');});
