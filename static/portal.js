'use strict';
const P={auth:null,mode:'foryou',items:[],next:0,queue:[],selected:new URLSearchParams(location.search).get('submission'),reports:[],policy:null,tab:'login',working:false,mine:null,profile:null,profileItems:[],profileNext:null,likedItems:[],likedNext:null,likedTotal:0};
const pe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pm=()=>document.querySelector('#portal-main');
const pt=()=>document.querySelector('meta[name="aim-token"]').content;
function say(t){const e=document.querySelector('#portal-toast');e.textContent=t;e.hidden=false;setTimeout(()=>e.hidden=true,8000);}
async function req(path, data, signal) {
  const options = {headers: {'X-AIM-Token': pt()}};
  if (data !== undefined) {
    options.method = 'POST';
    if (data instanceof FormData) options.body = data;
    else {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(data);
    }
  }
  const preview = path === 'account/avatar/preview';
  // Photo previews can take longer on a phone. The crop dialog can cancel this request.
  const response = preview
    ? await fetch('/api/' + path, {...options, signal})
    : await AIMTasks.request(path, options);
  if (!response.ok) {
    if (response.status === 413 && path.startsWith('account/avatar')) {
      throw new Error('This photo is too large to upload. Choose a smaller file.');
    }
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || 'This action could not be completed. Try again.');
  }
  if (preview) return response.blob();
  const result = await response.json();
  if (response.status === 202 && result.task) AIMTasks.track(result.task);
  return result;
}
function portalAdmin(html){return P.auth?.user?.role==='admin'?html:'';}
function nav(){const u=P.auth.user;document.querySelector('#platform-navigation').innerHTML=`<a href="/discover" class="${location.pathname==='/discover'?'active':''}">Discover</a><a href="${u?'/overview':'/login'}">${u&&P.auth.projects.length?'My Studio':'Start creating'}</a>${u&&['admin','reviewer'].includes(u.role)?`<a href="/review" class="${location.pathname==='/review'?'active':''}">Staff Review</a>`:''}${u?'':'<a href="/login" class="'+(location.pathname==='/login'?'active':'')+'">Sign in</a>'}`;AIMInbox.account(u);}
function authPage(){const reg=P.tab==='register';pm().innerHTML=`<div class="auth-layout"><div><div class="eyebrow">AIM.MOVIE / CREATOR PLATFORM</div><h1>Your stories.<br>Your people.<br><em>Your screen.</em></h1><p class="portal-lead">Watch what other people create, react to your favorites, and open your studio whenever you want to make something.</p><div class="auth-copy">Watch with the same account you use to create.<br>Your studio is there whenever you need it.<br>No creator account upgrade is required.</div></div><section class="portal-card"><div class="feed-tabs"><button data-act="auth-login" class="${!reg?'active':''}">Sign in</button><button data-act="auth-register" class="${reg?'active':''}">Create account</button></div><h2 style="margin-top:26px">${reg?'Make room for your next story.':'Welcome back.'}</h2>${portalAdmin(P.auth.first_account?'<p class="portal-muted">The first account becomes the administrator.</p>':'')}<form id="auth-form" class="portal-form">${reg?'<label>Display name<input name="name" autocomplete="nickname" required minlength="2" maxlength="60"></label>':''}<label>Email<input type="email" name="email" autocomplete="email" required></label><label>Password<input type="password" name="password" autocomplete="${reg?'new-password':'current-password'}" minlength="10" maxlength="200" required></label><p id="form-error" class="portal-error" role="alert"></p><button class="button primary" type="submit">${reg?'Create account':'Sign in'} →</button></form>${portalAdmin('<p class="portal-muted" style="margin-top:20px">Local accounts; email verification/recovery and MFA are not connected.</p>')}<a href="/discover" class="button ghost small">Explore the community</a></section></div>`;}
function avatarMarkup(url,name,large=false){return `<span class="${large?'profile-avatar':'creator-avatar'}">${url?`<img src="${pe(url)}" alt="${pe(name)}'s profile picture" loading="lazy">`:pe(String(name||'?').slice(0,1))}</span>`;}
function post(r){return extendedPost(r);}
function feedPage(){return extendedFeedPage();}
function observeFeed(){return extendedObserveFeed();}
async function loadFeed(reset=true){const r=await req('community/feed?mode='+P.mode+'&q='+encodeURIComponent(P.search||'')+'&kind='+encodeURIComponent(P.kind||'')+'&audio='+encodeURIComponent(P.audio||'')+'&offset='+(reset?0:P.next));P.items=reset?r.items:P.items.concat(r.items);P.next=r.next_offset;feedPage();}
function accountPage(mine){renderAccount(mine);}
async function refreshAuth(){P.auth=await req('auth/state');document.querySelector('meta[name="aim-token"]').content=P.auth.csrf;nav();}
async function account(){await refreshAuth();const mine=await req('community/mine');const details=await req('creators/'+P.auth.user.id);P.accountProfile=details.profile;accountPage(mine);}
function profilePage(){renderCreatorProfile();}
async function loadProfile(reset=true){
 const id=location.pathname.split('/')[2];const r=await req('creators/'+encodeURIComponent(id)+'?offset='+(reset?0:P.profileNext));P.profile=r.profile;P.profileItems=reset?r.items:P.profileItems.concat(r.items);P.profileNext=r.next_offset;profilePage();
}
function likesPage(){collectionPage('likes',P.likedItems,P.likedNext,P.likedTotal);}
async function loadLikes(reset=true){
 const r=await req('account/likes?offset='+(reset?0:P.likedNext));P.likedItems=reset?r.items:P.likedItems.concat(r.items);P.likedNext=r.next_offset;P.likedTotal=r.total;likesPage();
}
function reviewTime(seconds){
 return Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0');
}
function screeningPanel(item){
 const check=item.screening;
 if(!check)return '';
 const labels={pending:'Check pending',clear:'No flags found',flagged:'Policy flag',unavailable:'Incomplete check',file_problem:'Video needs changes',withdrawn:'Withdrawn'};
 return `<section class="portal-card">
   <div class="row between wrap"><h3>Automated check</h3><span class="review-status">${pe(labels[check.verdict]||check.verdict)}</span></div>
   <p class="portal-muted">${pe(check.reason||'Checking the submitted video and its public details.')}</p>
   ${check.evidence?.length?`<ul>${check.evidence.map(item=>`<li>
     <strong>${pe(item.source)}</strong> · ${pe(item.label.replaceAll('_',' '))}
     ${Number.isFinite(item.seconds)?`<button type="button" class="button ghost small" data-act="review-jump" data-seconds="${item.seconds}">Jump to ${reviewTime(item.seconds)}</button>`:''}
   </li>`).join('')}</ul>`:''}
 </section>`;
}
function reviewDetail(r){
 const own=r.user_id===P.auth.user.id;
 const reports=P.reports.filter(item=>item.submission_id===r.id);
 const spot=r.status==='published'&&r.screening?.spot_check;
 return `<div class="portal-card">
   <div class="row between wrap">
     <div><span class="review-status">${pe(AIMPublication.status(r))}</span><h2 style="margin-top:15px">${pe(r.title)}</h2></div>
     <span class="portal-muted">${pe(r.kind)} by ${pe(r.author)}</span>
   </div>
   ${r.screening?.verdict==='file_problem'?'':`<video id="staff-review-video" class="review-video" src="${pe(r.video_url)}" controls playsinline preload="metadata"></video>`}
   ${screeningPanel(r)}
   ${reports.length?`<section class="portal-card"><h3>Open viewer reports</h3><ul>${reports.map(item=>`<li>${pe(item.reason)}</li>`).join('')}</ul></section>`:''}
   ${spot?'<p class="notice">Selected for a publication spot check.</p>':''}
   <div class="review-copy-split">
     <section><h3>Private notes to staff</h3><p class="portal-muted preserve-lines">${pe(r.review_notes||'No private notes.')}</p></section>
     <section><h3>Public caption</h3><p class="portal-muted preserve-lines">${pe(r.public_caption||'No public caption.')}</p>
       <div class="tag-row">${r.tags.map(t=>`<span class="tag">#${pe(t)}</span>`).join('')}</div>
     </section>
   </div>
   ${portalAdmin(`<details class="details"><summary>Technical details</summary><p class="portal-muted">${pe(r.metadata.technical_precheck)}</p></details>`)}
   ${r.status==='approved'?'<div class="notice">This version is ready for the creator to preview and publish.</div>':''}
   ${r.metadata.context?.length?`<details><summary>Review adjacent clips (${r.metadata.context.length})</summary>
     <div class="review-neighbors">${r.metadata.context.map((x,i)=>`<div><p class="portal-muted">Segment ${i+1}</p>
       <video src="/api/review/${pe(r.id)}/context/${pe(x.index)}" controls preload="metadata"></video></div>`).join('')}</div></details>`:''}
   <details style="margin:20px 0"><summary>Rules attached to this submission · ${pe(r.policy.version)}</summary>
     <p class="portal-muted preserve-lines">${pe(r.policy.rules)}</p>
   </details>
   ${r.status==='submitted'?`<button class="button primary" data-act="review-claim" data-id="${pe(r.id)}" ${own?'disabled':''}>Claim for review</button>`:''}
   ${own&&(['submitted','approved','published'].includes(r.status))?'<p class="portal-muted">Another staff member can review your creation.</p>':''}
   ${r.status==='in_review'&&r.reviewer_id===P.auth.user.id?`<form id="decision-form" class="portal-form" style="margin-top:20px">
     ${r.policy.criteria.map(c=>`<label class="check"><input type="checkbox" name="${pe(c.id)}">${pe(c.label)}</label>`).join('')}
     <label class="check"><input type="checkbox" name="acknowledge_draft">I understand that these are draft rules, pending official AIM.movie guidelines.</label>
     <label>Decision<select name="decision"><option value="approved">Approve &amp; return to creator</option><option value="changes_requested">Request changes</option><option value="rejected">Reject</option></select></label>
     <label>Timecodes and feedback<textarea name="note" placeholder="Explain what you checked and what the creator can fix."></textarea></label>
     <button class="button primary">Save review decision</button>
   </form>`:''}
   ${!own&&r.status==='published'&&(reports.length||spot)?`<form id="keep-published-form" class="portal-form">
     <label>Review notes<textarea name="note" maxlength="3000" ${reports.length?'required':''}></textarea></label>
     <button class="button secondary">${reports.length?'Close reviewed reports and keep published':'Complete spot check and keep published'}</button>
   </form>`:''}
   ${!own&&['approved','published'].includes(r.status)?`<form id="takedown-form" class="portal-form">
     <label>Removal reason<textarea name="note" required></textarea></label>
     <button class="button secondary">Revoke approval / remove post</button>
   </form>`:''}
   <h3 style="margin-top:28px">Review record</h3>
   ${r.history.map(h=>`<div class="review-history"><strong>${pe(h.action.replaceAll('_',' '))}</strong> · ${pe(h.actor_name||'Staff / creator')}<p>${pe(h.note)}</p><small>${pe(new Date(h.created).toLocaleString())}</small></div>`).join('')}
 </div>`;
}
function reviewPage(){
 const pending=P.queue.filter(reviewVisible);
 const r=P.queue.find(item=>item.id===P.selected)||pending.find(item=>item.user_id!==P.auth.user.id)||pending[0]||P.queue[0];
 P.selected=r?.id;
 const stats=P.screeningStats;
 pm().innerHTML=`<div class="eyebrow">AIM.MOVIE / STAFF WORKSPACE</div>
 <h1 class="portal-title">Discover review</h1>
 <p class="portal-lead">Review submissions that need a staff decision, viewer reports, and a sample of automatically cleared posts.</p>
 ${stats&&P.reviewMode!=='manual'?`<p class="portal-muted"><strong>${P.reviewMode==='pilot'?'Pilot':'Automatic'} mode</strong> · ${stats.pending} checks pending · ${stats.cleared} automatically cleared. Pilot results: ${stats.pilot_clear} clear, ${stats.pilot_staff_concern} of those needed changes or were rejected by staff.</p>`:''}
 <div class="review-layout">
   <aside class="review-queue">
     <div class="row between"><h3>Review queue</h3><button class="button ghost small" data-act="review-refresh">Refresh</button></div>
     ${P.reports.length?`<section class="portal-card"><h3>Viewer reports</h3>
       ${P.reports.map(x=>`<button class="queue-item" data-act="review-select" data-id="${pe(x.submission_id)}"><strong>${pe(x.title)}</strong><small>${pe(x.reason)}</small></button>`).join('')}
     </section>`:''}
     ${P.spotChecks.length?`<section class="portal-card"><h3>Publication spot checks</h3>
       ${P.spotChecks.map(x=>`<button class="queue-item" data-act="review-select" data-id="${pe(x.id)}">${pe(x.title)}</button>`).join('')}
     </section>`:''}
     <label class="field"><span>Filter</span><select id="review-filter">${[['pending','Awaiting review'],['available','Available to claim'],['mine','Claimed by me'],['claimed','Claimed by others'],['all','All submissions']].map(([value,label])=>`<option value="${value}" ${(P.filter||'pending')===value?'selected':''}>${label}</option>`).join('')}</select></label>
     <div style="margin-top:15px">${pending.map(x=>`<button class="queue-item ${x.id===r?.id?'selected':''}" data-act="review-select" data-id="${pe(x.id)}">
       <small>${pe(x.author)} · ${pe(x.kind)}</small><strong>${pe(x.title)}</strong>
       <span class="review-status">${pe(AIMPublication.status(x))}${x.screening?.verdict==='flagged'?' · Policy flag':''}${x.reviewer_name?' · '+pe(x.reviewer_name):''}</span>
     </button>`).join('')||'<p class="portal-muted">No submissions match this filter.</p>'}</div>
   </aside>
   <section>
     ${r?reviewDetail(r):'<div class="no-content"><h2>Ready for the first submission.</h2><p>Creators submit from the Share tab in their studio.</p></div>'}
     ${portalAdmin(`<details class="portal-card"><summary>Edit provisional rules for future submissions</summary>
       <form id="policy-form" class="portal-form" style="margin-top:20px"><textarea name="rules" rows="8" minlength="20" maxlength="12000">${pe(P.policy.rules)}</textarea>
       <p class="portal-muted">Each submission is evaluated under the rules captured when it was submitted.</p>
       <button class="button secondary">Save new draft rules</button></form>
     </details>`)}
   </section>
 </div>`;
}
async function loadQueue(){
 const result=await req('review/queue?selected='+encodeURIComponent(P.selected||''));
 P.queue=result.items;
 P.reports=result.reports;
 P.spotChecks=result.spot_checks||[];
 P.screeningStats=result.screening_stats;
 P.reviewMode=result.review_mode;
 P.policy=result.policy;
 reviewPage();
}
async function act(a,e){if(P.working)return;P.working=true;try{
 if(await extraAct(a,e))return;
 if(a==='auth-login'||a==='auth-register'){P.tab=a.endsWith('register')?'register':'login';authPage();}
 if(a==='feed-foryou'||a==='feed-latest'){P.mode=a.endsWith('latest')?'latest':'foryou';await loadFeed();}
 if(a==='feed-more')await loadFeed(false);
 if(a==='profile-more')await loadProfile(false);
 if(a==='likes-more')await loadLikes(false);
 if(a==='likes-refresh')await loadLikes();
 if(a==='profile-edit'||a==='profile-cancel'){
  const form=document.querySelector('#profile-form'),editing=a==='profile-edit';
  if(!editing)form.reset();
  for(const field of [form.elements.name,form.elements.bio])field.readOnly=!editing;
  form.querySelector('#profile-edit').hidden=editing;
  form.querySelector('#profile-edit-actions').hidden=!editing;
  document.querySelector('#avatar-file').disabled=editing;
  const remove=document.querySelector('[data-act="avatar-remove"]');if(remove)remove.disabled=editing;
  (editing?form.elements.name:form.querySelector('#profile-edit')).focus();
  return;
 }
 if (a === 'avatar-remove') {
   const picker = document.querySelector('#avatar-file');
   picker.disabled = e.disabled = true;
   try {
     await req('account/avatar/remove', {});
     updateAccountAvatar(null);
     say('Profile picture removed.');
   } finally {
     picker.disabled = e.disabled = false;
     picker.focus({preventScroll: true});
   }
 }
 if(a==='account-refresh')await account();
 if(a==='admin-next')await loadAccounts(P.adminNext);
 if(a==='admin-reset')await loadAccounts(0);
 if(a.startsWith('publication-')){const r=P.mine?.items.find(x=>x.id===e.dataset.id);if(r){if(a==='publication-preview')await AIMPublication.preview(r,account);else if(a==='publication-edit')await AIMPublication.edit(r,account);else await AIMPublication.unpublish(r,account);}}
 if(a==='like'){if(!P.auth.user){location.href='/login';return;}const j=await req('community/'+e.dataset.id+'/like',{});P.items=P.items.map(x=>x.id===j.item.id?j.item:x);P.profileItems=P.profileItems.map(x=>x.id===j.item.id?j.item:x);if(location.pathname==='/account/likes'){await loadLikes();return;}const el=document.querySelector(`[data-post="${e.dataset.id}"] .reaction-button`);el.classList.toggle('liked',j.item.liked);const count=el.querySelector('span');if(count)count.textContent=j.item.likes;el.setAttribute('aria-pressed',j.item.liked);}
 if(a==='report'){if(!P.auth.user){location.href='/login';return;}AIMSocial.report(e.dataset.id,async(id,reason)=>{await req('community/'+id+'/report',{reason});say('Report sent to staff.');});}
 if(a==='logout'){await req('auth/logout',{});location.href='/login';}
 if(a==='open-project'){await req('platform/projects/select',{id:e.dataset.id});location.href=e.dataset.dest==='share'?'/share':'/overview';}
 if(a==='withdraw'){await req('community/'+e.dataset.id+'/withdraw',{});await account();}
 if(a==='review-select'){if(P.reviewDirty&&!confirm('Discard unsaved review notes?'))return;P.reviewDirty=false;P.selected=e.dataset.id;if(P.queue.some(x=>x.id===P.selected))reviewPage();else await loadQueue();}
 if(a==='review-refresh'){
  if(P.reviewDirty&&!confirm('Discard unsaved review notes?'))return;
  P.reviewDirty=false;
  await loadQueue();
 }
 if(a==='review-jump'){
  const video=document.querySelector('#staff-review-video'),seconds=Number(e.dataset.seconds);
  if(video&&Number.isFinite(seconds)){video.currentTime=seconds;video.focus();}
 }
 if(a==='review-claim'){await req('review/'+e.dataset.id+'/claim',{});await loadQueue();}
 }catch(error){say(error.message);}finally{P.working=false;}}
document.addEventListener('click',e=>{const el=e.target.closest('[data-act]');if(el){e.preventDefault();act(el.dataset.act,el);}});
document.addEventListener('change',e=>{if(e.target.id==='review-filter'){P.filter=e.target.value;reviewPage();}});
document.addEventListener('submit',async e=>{e.preventDefault();if(P.working)return;P.working=true;const form=e.target;if(form.closest('.engagement-dialog')){P.working=false;return;}const v=Object.fromEntries(new FormData(form));const b=form.querySelector('button[type=submit],button:not([type])');if(b)b.disabled=true;try{
 if(await extraSubmit(form,v))return;
 if(form.id==='auth-form'){const j=await req('auth/'+P.tab,v);location.href=j.redirect||'/discover';}
 if(form.id==='profile-form'&&!form.elements.name.readOnly){await req('account/profile',v);await settings();say('Your public profile was updated.');}
 if(form.id==='admin-search-form'){P.adminQuery=v.q;await loadAccounts(0);}
 if(form.classList.contains('role-form')){const j=await req('account/admin/role',v);form.reset();if(j.reauthenticate){location.href='/login';return;}await loadAccounts(P.adminOffset||0);say('Role updated. That account must sign in again.');}
 if(form.id==='delete-account-form'){if(!confirm('Permanently delete your account, projects and posts? This cannot be undone.'))return;const j=await req('account/delete',v);pm().innerHTML='<section class="portal-card"><h1>Account deleted</h1><p>Your account and posts are no longer accessible.</p><p>'+ (j.cleanup_pending?'File cleanup is pending and will retry when the server restarts.':'Your active project and media files were removed.')+'</p><a class="button secondary" href="/discover">Browse Discover</a></section>';document.querySelector('#platform-navigation').innerHTML='<a href="/discover">Discover</a><a href="/login">Sign in</a>';}
 if(form.id==='new-project-form'){await req('platform/projects',v);location.href='/overview';}
 if(form.id==='password-form'){await req('account/password',v);P.auth=await req('auth/state');document.querySelector('meta[name="aim-token"]').content=P.auth.csrf;say('Password updated. Other sessions were signed out.');form.reset();}
 if(form.id==='decision-form'){const checks=Object.fromEntries(P.queue.find(x=>x.id===P.selected).policy.criteria.map(c=>[c.id,!!form.elements[c.id]?.checked]));await req('review/'+P.selected+'/decision',{decision:v.decision,note:v.note,checks,acknowledge_draft:form.elements.acknowledge_draft.checked});P.reviewDirty=false;await loadQueue();say('Review decision saved.');}
 if(form.id==='keep-published-form'){
  const reports=P.reports.filter(item=>item.submission_id===P.selected).map(({id,reason,created})=>({id,reason,created}));
  await req('review/'+P.selected+'/keep-published',{reports,note:v.note});
  P.reviewDirty=false;await loadQueue();say('Publication review saved.');
 }
 if(form.id==='takedown-form'){await req('review/'+P.selected+'/decision',{decision:'taken_down',note:v.note});P.reviewDirty=false;await loadQueue();}
 if(form.id==='policy-form'){await req('review/policy',v);await loadQueue();say('New draft rules saved for future submissions.');}
 }catch(error){const err=form.querySelector('#form-error');if(err)err.textContent=error.message;else say(error.message);}finally{P.working=false;if(b)b.disabled=false;}});

function settingsPage(){
 const u=P.auth.user;
 pm().innerHTML=`<a href="/account" class="button ghost small">← Your dashboard</a><div class="eyebrow">YOUR ACCOUNT</div><h1 class="portal-title">Account settings</h1><div class="account-settings-grid"><section class="portal-card"><h2>Public profile</h2>${AIMAvatar.panel(u)}<p class="portal-muted">Your name, bio and published creations are public. Your email stays private.</p><form id="profile-form" class="portal-form"><label>Display name<input name="name" value="${pe(u.name)}" minlength="2" maxlength="60" required readonly></label><label>Bio<textarea name="bio" maxlength="500" readonly>${pe(u.bio||'')}</textarea></label><button type="button" class="button secondary" id="profile-edit" data-act="profile-edit">Edit profile</button><div id="profile-edit-actions" class="row wrap" hidden><button type="submit" class="button primary">Save profile</button><button type="button" class="button ghost" data-act="profile-cancel">Cancel</button></div></form></section><section class="portal-card"><h2>Security</h2><p class="portal-muted">Signed in as ${pe(u.email)}. Updating your password signs out your other sessions.</p><form id="password-form" class="portal-form"><label>Current password<input name="current_password" type="password" autocomplete="current-password" required></label><label>New password<input name="password" type="password" autocomplete="new-password" minlength="10" maxlength="200" required></label><button class="button secondary">Update password</button></form><div class="security-signout"><h3>Sign out of this device</h3><p class="portal-muted">End your current session. Your projects and saved creations stay available.</p><button type="button" class="button secondary" data-act="logout">Log out</button></div></section></div>
 ${u.role==='admin'?`<section class="portal-card"><h2>Manage user accounts</h2><p class="portal-muted">Only administrators can see this section. Ask a person to register first, then assign their role here. Members watch and create; reviewers review submissions; administrators also manage roles. This does not expose private project contents.</p><form id="admin-search-form" class="portal-form"><label>Find by name or email<input name="q" maxlength="100"></label><button class="button secondary">Search accounts</button></form><div id="admin-users" aria-live="polite"></div></section>`:''}
 ${notificationSettingsHTML()}<details class="portal-card account-danger"><summary>Delete account</summary><p>This permanently removes your account, private projects, source books, uploaded and generated media, submissions and published posts from this installation. Save anything you want to keep first.</p><p class="portal-muted">Some review/security records and backup copies may remain. Stop active generations and voice sessions before deleting.${portalAdmin(' The last administrator must promote a replacement first. Provider jobs are not cancelled automatically.')}</p><form id="delete-account-form" class="portal-form"><label>Current password<input name="current_password" type="password" autocomplete="current-password" required></label><label>Type DELETE to confirm<input name="confirmation" pattern="DELETE" autocomplete="off" required></label><button class="button secondary danger-button">Permanently delete my account</button></form></details>`;
}
function updateAccountAvatar(url) {
  const user = P.auth.user;
  user.avatar_url = url;
  AIMAvatar.update(user);
  AIMInbox.account(user);
}
async function settings(){await refreshAuth();P.notificationPrefs=await req('account/notification-preferences');settingsPage();prepareAccountSettings();AIMAvatar.bind(updateAccountAvatar);if(P.auth.user.role==='admin')await loadAccounts(0);}
async function loadAccounts(offset=0){
 const r=await req('account/admin/users?q='+encodeURIComponent(P.adminQuery||'')+'&offset='+offset);P.adminOffset=offset;P.adminNext=r.next_offset;
 document.querySelector('#admin-users').innerHTML=`<p class="portal-muted">${r.total} matching accounts · showing ${r.items.length?offset+1:0}–${offset+r.items.length}</p>${r.items.map(u=>`<article class="account-user"><div><strong>${pe(u.name)}</strong><p class="portal-muted">${pe(u.email)} · ${pe(u.role==='creator'?'Member':u.role)}${u.id===P.auth.user.id?' · You':''}</p></div><form class="role-form portal-form"><input type="hidden" name="user_id" value="${pe(u.id)}"><label>Role<select name="role">${[['creator','Member'],['reviewer','Reviewer'],['admin','Administrator']].map(([value,label])=>`<option value="${value}" ${u.role===value?'selected':''}>${label}</option>`).join('')}</select></label><label>Your current password<input type="password" name="current_password" autocomplete="current-password" required></label><button class="button secondary small">Save role</button></form></article>`).join('')}<div class="row wrap"><button class="button ghost small" data-act="admin-reset">First page</button>${r.next_offset!==null?'<button class="button secondary small" data-act="admin-next">Next page →</button>':''}</div>`;
}

(async()=>{try{P.auth=await req('auth/state');document.querySelector('meta[name="aim-token"]').content=P.auth.csrf;nav();if(location.pathname==='/login')authPage();else if(location.pathname==='/discover')await loadFeed();else if(location.pathname==='/account/settings')await settings();else if(location.pathname==='/account/likes')await loadLikes();else if(location.pathname==='/account/saved')await loadSaved();else if(location.pathname==='/account/tasks')await loadTasks();else if(location.pathname==='/account/notifications')await loadInbox();else if(location.pathname.startsWith('/watch/'))await loadWatch();else if(location.pathname==='/review')await loadQueue();else if(location.pathname.startsWith('/creators/'))await loadProfile();else if(P.auth.user)await account();else location.href='/login';}catch(e){pm().textContent=e.message;}})();
