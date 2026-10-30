'use strict';
const AIMIcons={
 speaker:'<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
 muted:'<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m16 9 5 6m0-6-5 6"/>',
 heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
 save:'<path d="M6 3h12v18l-6-4-6 4V3Z"/>',
 share:'<path d="m14 3 7 7-7 7v-5c-7 0-10 3-11 7 0-8 4-12 11-12V3Z"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
 gear:'<path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 1 3h4l1-3 3-1 2-3-2-2 1-3-3-2-1-3H9Z"/><circle cx="10.5" cy="11.5" r="3"/>',
 more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
 play:'<path d="m8 4 12 8-12 8V4Z"/>',up:'<path d="m6 15 6-6 6 6"/>',down:'<path d="m6 9 6 6 6-6"/>',
 svg(name){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${this[name]||this.more}</svg>`;}
};
const AIMFeed=(()=>{
 let observer=null,root=null,activeId=null,muted=false,loading=false,epoch=0,resumeOnVisible=false,headerObserver=null;
 const e=v=>AIMText.escape(v);
 function card(r){
  if(r.unavailable)return `<div class="empty-saved">This saved creation is unavailable.<button class="button ghost small" data-act="save-post" data-id="${e(r.id)}" data-saved="true">Remove</button></div>`;
  return `<article class="feed-post cinema-card" data-post="${e(r.id)}" tabindex="0" aria-label="${e(r.title)} by ${e(r.author)}"><video class="feed-video" data-src="${e(r.video_url)}" playsinline loop preload="none" aria-label="${e(r.title)}"></video><button type="button" class="feed-touch" data-feed-toggle aria-label="Pause video"></button><button type="button" class="feed-play-gate" data-feed-start hidden aria-label="Play video with sound">${AIMIcons.svg('play')}<span>Tap to play</span></button><button type="button" class="feed-sound icon-control" data-feed-sound aria-label="Mute video" aria-pressed="false">${AIMIcons.svg('speaker')}</button><div class="feed-caption"><a class="creator-line" href="${e(r.creator_url)}"><span class="creator-avatar">${r.author_avatar_url?`<img src="${e(r.author_avatar_url)}" alt="">`:e((r.author||'C')[0])}</span><strong>${e(r.author)}</strong></a><h2>${e(r.title)}</h2>${r.public_caption?`<p>${e(r.public_caption)}</p>`:''}<div class="tag-row">${(r.tags||[]).map(t=>`<span>#${e(t)}</span>`).join(' ')}</div></div><div class="feed-actions"><button type="button" class="feed-action reaction-button ${r.liked?'liked':''}" data-act="like" data-id="${e(r.id)}" aria-pressed="${!!r.liked}" aria-label="Like ${e(r.title)}">${AIMIcons.svg('heart')}<span>${r.likes||0}</span></button><button type="button" class="feed-action ${r.saved?'saved':''}" data-act="save-post" data-id="${e(r.id)}" data-saved="${!!r.saved}" aria-pressed="${!!r.saved}" aria-label="${r.saved?'Remove from saved':'Save creation'}">${AIMIcons.svg('save')}<span>Save</span></button><button type="button" class="feed-action" data-act="share-post" data-id="${e(r.id)}" data-title="${e(r.title)}" aria-label="Share creation">${AIMIcons.svg('share')}<span>Share</span></button><button type="button" class="feed-action" data-act="report" data-id="${e(r.id)}" aria-label="Report creation">${AIMIcons.svg('more')}</button></div><progress class="feed-progress" value="0" max="1" aria-label="Video progress"></progress></article>`;
 }
 function controls(){return `<div class="feed-navigation"><button class="icon-control" data-feed-step="-1" aria-label="Previous video">${AIMIcons.svg('up')}</button><button class="icon-control" data-feed-step="1" aria-label="Next video">${AIMIcons.svg('down')}</button></div>`;}
 function shell(items,toolbar=''){return `${toolbar}<div class="cinema-layout"><div id="feed-scroller" class="feed-scroller" tabindex="0" aria-label="Swipe through videos">${items.map(card).join('')||'<div class="feed-empty"><h2>No creations here yet.</h2><a href="/discover" class="button secondary">Explore Discover</a></div>'}<div id="feed-sentinel" aria-hidden="true"></div></div>${controls()}</div>`;}
 function stop(){epoch++;if(observer)observer.disconnect();observer=null;headerObserver?.disconnect();headerObserver=null;resumeOnVisible=false;document.querySelectorAll('.feed-video').forEach(v=>v.pause());root=null;activeId=null;}
 function updateSound(card){const b=card.querySelector('[data-feed-sound]');if(!b)return;b.innerHTML=AIMIcons.svg(muted?'muted':'speaker');b.setAttribute('aria-label',muted?'Unmute video':'Mute video');b.setAttribute('aria-pressed',String(muted));}
 function attach(v){if(!v.getAttribute('src')&&v.dataset.src){v.src=v.dataset.src;v.preload='metadata';}}
 async function play(card){
  if(!card)return;const version=++epoch;activeId=card.dataset.post;
  document.querySelectorAll('.cinema-card').forEach(c=>{const v=c.querySelector('video');if(c!==card){v.pause();c.querySelector('[data-feed-start]').hidden=true;}});
  const video=card.querySelector('video');attach(video);video.muted=muted;updateSound(card);
  const gate=card.querySelector('[data-feed-start]');gate.hidden=true;
  try{await video.play();if(version!==epoch){if(activeId!==card.dataset.post||!root||card.classList.contains('paused'))video.pause();return;}card.classList.remove('paused');card.querySelector('[data-feed-toggle]').setAttribute('aria-label','Pause video');}
  catch(error){if(version!==epoch)return;gate.hidden=false;card.classList.add('paused');card.querySelector('[data-feed-toggle]').setAttribute('aria-label','Play video');}
  const cards=[...document.querySelectorAll('.cinema-card')],index=cards.indexOf(card);
  for(const neighbor of cards.slice(Math.max(0,index-1),index+2)){const v=neighbor.querySelector('video');if(v!==video)attach(v);}
  // Keep loaded media bounded, even after a long scrolling session.
  for(let i=0;i<cards.length;i++)if(Math.abs(i-index)>2){const v=cards[i].querySelector('video');if(v.hasAttribute('src')){v.pause();v.removeAttribute('src');v.load();}}
  if(index>=cards.length-3)more();
 }
 async function more(){
  if(loading||typeof P==='undefined'||P.next==null||!root)return;loading=true;
  const pageRoot=root,mode=P.mode;
  try{const query=new URLSearchParams({mode,q:P.search||'',kind:P.kind||'',audio:P.audio||'',offset:P.next});const r=await req('community/feed?'+query);if(root!==pageRoot||P.mode!==mode)return;const known=new Set(P.items.map(x=>x.id)),fresh=r.items.filter(x=>!known.has(x.id));P.items.push(...fresh);P.next=r.next_offset;for(const item of fresh){pageRoot.querySelector('#feed-sentinel').insertAdjacentHTML('beforebegin',card(item));}wire(pageRoot);}
  catch(error){if(typeof say==='function')say('Couldn’t load more videos. Swipe back and try again.');}
  finally{loading=false;}
 }
 function wire(container){
  container.querySelectorAll('.cinema-card:not([data-wired])').forEach(card=>{
   card.dataset.wired='true';const v=card.querySelector('video');let counted=false;
   v.addEventListener('timeupdate',()=>{const p=card.querySelector('progress');if(Number.isFinite(v.duration)&&v.duration>0)p.value=v.currentTime/v.duration;if(!counted&&typeof P!=='undefined'&&P.auth?.user&&!v.paused&&Number.isFinite(v.duration)){let played=0;for(let i=0;i<v.played.length;i++)played+=v.played.end(i)-v.played.start(i);if(played>=Math.min(3,v.duration*.8)){counted=true;req('community/'+card.dataset.post+'/view',{}).catch(()=>{});}}});
   v.addEventListener('error',()=>{card.querySelector('[data-feed-start]').hidden=false;});
   observer?.observe(card);
  });
 }
 function mount(){
  stop();root=document.querySelector('#feed-scroller');if(!root)return;
  const header=document.querySelector('.platform-header'),measure=()=>{if(header)document.documentElement.style.setProperty('--header-height',header.getBoundingClientRect().height+'px');};measure();
  if(header&&typeof ResizeObserver!=='undefined'){headerObserver=new ResizeObserver(measure);headerObserver.observe(header);}
  observer=new IntersectionObserver(entries=>{const candidates=entries.filter(x=>x.isIntersecting&&x.intersectionRatio>=.6).sort((a,b)=>b.intersectionRatio-a.intersectionRatio);if(candidates[0]&&candidates[0].target.dataset.post!==activeId)play(candidates[0].target);},{root,threshold:[0,.6,.85]});
  wire(root);const first=root.querySelector('.cinema-card');if(first)play(first);else activeId=null;
 }
 function step(direction){const cards=[...document.querySelectorAll('#feed-scroller .cinema-card')],i=cards.findIndex(c=>c.dataset.post===activeId),next=cards[Math.max(0,Math.min(cards.length-1,i+direction))];if(next){next.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}}
 document.addEventListener('click',event=>{
  const target=event.target.closest('[data-feed-sound],[data-feed-start],[data-feed-toggle],[data-feed-step]');if(!target)return;
  if(target.dataset.feedStep){step(Number(target.dataset.feedStep));return;}
  const card=target.closest('[data-post]'),v=card.querySelector('video');
  if(target.hasAttribute('data-feed-sound')){muted=!muted;v.muted=muted;updateSound(card);if(v.paused)play(card);return;}
  if(target.hasAttribute('data-feed-start')){play(card);return;}
  if(v.paused)play(card);else{epoch++;v.pause();card.classList.add('paused');target.setAttribute('aria-label','Play video');card.querySelector('[data-feed-start]').hidden=false;}
 });
 document.addEventListener('keydown',event=>{if(!root||event.target.closest('input,textarea,select,dialog,summary'))return;if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();step(event.key==='ArrowDown'?1:-1);}if(event.code==='Space'&&event.target===root){event.preventDefault();root.querySelector(`[data-post="${activeId}"] [data-feed-toggle]`)?.click();}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){resumeOnVisible=!!root&&[...root.querySelectorAll('video')].some(v=>!v.paused);epoch++;root?.querySelectorAll('video').forEach(v=>v.pause());}else if(resumeOnVisible&&root&&activeId){resumeOnVisible=false;const card=root.querySelector(`[data-post="${activeId}"]`);if(card)play(card);}});
 return {card,shell,mount,stop,more,step,current:()=>activeId};
})();
