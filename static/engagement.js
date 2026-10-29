'use strict';
// Shared inbox, background status and public-link sharing; no push permission required.
const AIMText = (()=>{
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const inline=v=>escape(v).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*\n]+)\*/g,'<em>$1</em>');
 function markdown(v){let list=false;let result='';for(const line of String(v||'').split('\n')){const bullet=/^\s*(?:[-*]|\d+\.)\s+(.+)$/.exec(line);if(bullet){if(!list)result+='<ul>';list=true;result+='<li>'+inline(bullet[1])+'</li>';continue;}if(list){result+='</ul>';list=false;}if(/^#{1,4}\s+/.test(line))result+='<h3>'+inline(line.replace(/^#{1,4}\s+/,''))+'</h3>';else if(line.trim())result+='<p>'+inline(line)+'</p>';}return result+(list?'</ul>':'');}
 return {escape,markdown};
})();

const AIMTasks = (()=>{
 const e=AIMText.escape;
 const long=/^(?:chat(?:\/retry)?|generate\/(?:vision|characters|script|director)|characters\/[^/]+\/image|ensemble|render\/(?:submit|first-frame)|jobs\/[^/]+\/(?:last-frame|continue)|sequence\/combine|source\/(?:upload|analyze-next|analyze-all|synthesize)|community\/submit)$/;
 let latest=[],checking=false,previous=null;
 const csrf=()=>document.querySelector('meta[name="aim-token"]')?.content||'';
 async function request(path,opts={},workspace=''){
  const isLong=opts.method==='POST'&&long.test(path);let storageKey,signature,record;
  opts.headers={...(opts.headers||{})};
  if(isLong){
   const description=opts.body instanceof FormData?[...opts.body.entries()].map(([k,v])=>[k,v instanceof File?[v.name,v.size,v.lastModified]:v]):opts.body;
   signature=JSON.stringify([path,workspace,description]);storageKey='aim-pending:'+workspace+':'+path;
   try{record=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{}
   if(!record||record.signature!==signature)record={signature,key:crypto.randomUUID?.().replaceAll('-','')||String(Date.now())+Math.random().toString(36).slice(2).padEnd(16,'0')};
   try{sessionStorage.setItem(storageKey,JSON.stringify(record));}catch{}
   opts.headers['X-AIM-Async']='1';opts.headers['X-AIM-Key']=record.key;
  }
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),25000);
  try{
   const response=await fetch('/api/'+path,{...opts,signal:controller.signal});
   if(isLong&&response.ok){try{sessionStorage.removeItem(storageKey);}catch{}}
   return response;
  }catch(error){throw new Error(isLong?'Connection interrupted. Check Tasks before trying again; an accepted task keeps working.':error.name==='AbortError'?'This request took too long. Refresh to see your saved work.':'Connection interrupted. Please try again.');}
  finally{clearTimeout(timeout);}
 }
 function track(task){latest=[task,...latest.filter(t=>t.id!==task.id)];showBar(latest);poll();}
 function showBar(tasks){
  const slot=document.querySelector('#task-status');if(!slot)return;
  const active=tasks.filter(t=>['queued','running','waiting'].includes(t.status));
  slot.innerHTML=active.length?`<div class="task-banner" role="status"><span class="spinner small-spinner"></span><div><strong>${e(active[0].label)} · ${active[0].status==='queued'?'Queued':'In progress'}</strong><span>${active[0].total?`${active[0].progress} of ${active[0].total} excerpts saved. `:''}You can leave this page and return when it’s ready.</span></div><a href="/account/tasks" class="button ghost small">Tasks${active.length>1?' · '+active.length:''}</a>${active[0].label==='Book analysis'?`<button class="button ghost small" data-task-pause="${e(active[0].id)}">Pause</button>`:''}</div>`:'';
 }
 async function poll(){
  if(checking||document.hidden)return;checking=true;
  try{
   const r=await fetch('/api/account/tasks');if(!r.ok)return;const j=await r.json();latest=j.items;
   const signature=JSON.stringify(latest.map(t=>[t.id,t.status,t.updated,t.progress,t.cancel_requested]));
   if(signature!==previous){const initial=previous===null;previous=signature;document.dispatchEvent(new CustomEvent('aim:tasks',{detail:{items:latest,initial}}));}
  }catch{}finally{checking=false;}
 }
 document.addEventListener('click',async event=>{const b=event.target.closest('[data-task-pause]');if(!b)return;b.disabled=true;try{const r=await fetch('/api/account/tasks/'+encodeURIComponent(b.dataset.taskPause)+'/pause',{method:'POST',headers:{'X-AIM-Token':csrf()}});if(r.ok)b.textContent='Pausing after this excerpt';else b.disabled=false;poll();}catch{b.disabled=false;}});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){poll();document.dispatchEvent(new Event('aim:resume'));}});
 window.addEventListener('pageshow',()=>poll());window.addEventListener('online',()=>poll());
 setInterval(poll,5000);document.addEventListener('DOMContentLoaded',poll);
 return {request,track,showBar,poll,items:()=>latest};
})();

const AIMInbox = (()=>{
 let items=[],unread=0,checking=false,initialized=false;
 const e=AIMText.escape;
 function render(){
  const header=document.querySelector('.platform-header');if(!header)return;
  let menu=document.querySelector('#notification-menu');
  if(!menu){menu=document.createElement('details');menu.id='notification-menu';menu.className='notification-menu';header.append(menu);}
  const opened=menu.open;
  menu.innerHTML=`<summary aria-label="Notifications${unread?', '+unread+' unread':''}"><span aria-hidden="true">🔔</span><span class="notification-label">Updates</span>${unread?`<span class="notification-count">${unread>99?'99+':unread}</span>`:''}</summary><div class="notification-popover"><div class="row between"><strong>Notifications</strong><a href="/account/notifications">View all</a></div>${items.slice(0,5).map(n=>`<a class="notification-preview ${n.read_at?'':'unread'}" href="${e(n.link)}" data-notice="${e(n.id)}">${e(n.title)}<small>${e(new Date(n.created).toLocaleString())}</small></a>`).join('')||'<p class="portal-muted">You’re all caught up.</p>'}<a href="/account/settings#notifications" class="button ghost small">Notification settings</a></div>`;
  menu.open=opened;
 }
 async function refresh(){
  if(checking||document.hidden)return;checking=true;
  try{const r=await fetch('/api/account/notifications');if(!r.ok){document.querySelector('#notification-menu')?.remove();return;}const j=await r.json();items=j.items;unread=j.unread;render();if(initialized)document.dispatchEvent(new CustomEvent('aim:inbox',{detail:j}));initialized=true;}catch{}finally{checking=false;}
 }
 document.addEventListener('click',event=>{
  const link=event.target.closest('[data-notice]');if(link){fetch('/api/account/notifications/read',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json','X-AIM-Token':document.querySelector('meta[name="aim-token"]').content},body:JSON.stringify({id:link.dataset.notice})}).catch(()=>{});}
  const menu=document.querySelector('#notification-menu');if(menu&&!menu.contains(event.target))menu.open=false;
 });
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){const menu=document.querySelector('#notification-menu');if(menu)menu.open=false;}});
 document.addEventListener('aim:resume',refresh);document.addEventListener('DOMContentLoaded',refresh);setInterval(refresh,15000);
 return {refresh};
})();

const AIMSocial = (()=>{
 const e=AIMText.escape;
 function dialog(markup){const d=document.createElement('dialog');d.className='engagement-dialog';d.innerHTML=markup;document.body.append(d);d.addEventListener('close',()=>d.remove());d.showModal();return d;}
 async function share(id,title){
  const url=new URL('/watch/'+encodeURIComponent(id),location.origin).href;
  if(navigator.share){try{await navigator.share({title,url});return;}catch(error){if(error.name==='AbortError')return;}}
  if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(url);return 'Link copied.';}catch{}}
  const d=dialog(`<h2>Share creation</h2><p>Send this link to a friend.</p><input class="portal-input" readonly value="${e(url)}" aria-label="Public creation link"><form method="dialog"><button class="button secondary">Done</button></form>`);const input=d.querySelector('input');input.focus();input.select();
 }
 function report(id,submit){
  const d=dialog('<h2>Report creation</h2><form class="portal-form"><label>What should staff review?<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label><p class="portal-error" role="alert"></p><div class="row"><button class="button primary">Send report</button><button type="button" class="button ghost" data-close>Cancel</button></div></form>');
  d.querySelector('[data-close]').onclick=()=>d.close();d.querySelector('form').onsubmit=async event=>{event.preventDefault();event.stopPropagation();const b=d.querySelector('button');b.disabled=true;try{await submit(id,d.querySelector('textarea').value);d.close();}catch(error){d.querySelector('[role=alert]').textContent=error.message;b.disabled=false;}};
 }
 return {share,report};
})();
