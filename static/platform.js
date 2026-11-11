'use strict';
let bookAnalysisRunning=false, bookStop=false, reviewSelection=null;
function platformHeader(){
 const u=S.platform.user;
 $('#platform-nav').innerHTML=`<a href="/discover">Discover</a><a href="/overview" class="active" ${page==='overview'?'aria-current="page"':''}>My Studio</a>${['admin','reviewer'].includes(u.role)?'<a href="/review">Staff Review</a>':''}`;
 AIMInbox.account(u);
 if(page==='overview'){$('#studio-tabs').innerHTML='';return;}
 const groups=[['Develop','idea',['source','idea','brief']],['Plan','characters',['characters','script','shots']],['Produce','render',['render','library','assembly']],['Share','share',['share']]];
 const group=groups.find(g=>g[2].includes(page));
 $('#studio-tabs').innerHTML=`<div class="studio-breadcrumb"><a class="studio-back-link" href="/overview">← My Studio</a><span>${esc(S.vision.title||S.conversation_overview?.title||S.platform.projects.find(x=>x.id===S.platform.project_id)?.name||'Untitled movie')} ${isAdmin()&&!S.platform.paid_enabled?' · Paid API calls are off':''}</span></div><nav class="studio-main-tabs" aria-label="Movie workspace">${groups.map(([label,slug,pages])=>`<a href="/${slug}" data-nav="${slug}" class="${pages.includes(page)?'active':''}">${label}</a>`).join('')}<a href="/settings" data-nav="settings" class="studio-settings-link ${page==='settings'?'active':''}" aria-label="Studio settings">${AIMIcons.svg('gear')} Settings</a></nav><nav class="studio-step-tabs" aria-label="Current production steps">${(group?.[0]==='Develop'?[['idea','Your idea'],['source','Adapt a story'],['brief','Creative brief']]:group?.[0]==='Plan'?[['characters','Characters'],['script','Script'],['shots','Shots']]:group?.[0]==='Produce'?[['render','Render'],['library','Clips'],['assembly','Assemble']]:[['share','Submissions'],['activity','Creative history']]).map(([slug,label])=>`<a href="/${slug}" data-nav="${slug}" class="${slug===page?'active':''}">${label}</a>`).join('')}</nav>`;
}
function projectPicker(){return `<section class="panel" style="margin-bottom:25px"><div class="panel-title"><div><div class="eyebrow">YOUR PROJECTS</div><h3>A studio for every story.</h3></div><a href="/account" class="button secondary small">Manage projects & account →</a></div><div class="row wrap"><select id="platform-project" class="portal-input" style="max-width:320px" aria-label="Current project">${S.platform.projects.map(p=>`<option value="${p.id}" ${p.id===S.platform.project_id?'selected':''}>${esc(p.name)}</option>`).join('')}</select>${link('Import a whole book','source','secondary small')}${link('Type or talk through an idea','idea','ghost small')}</div></section>`;}
function sourcePage(){return adaptationPage();}

function reviewSource(choice){
 const [kind,id]=String(choice||'').split(':');
 if(kind==='job'){const row=S.jobs.find(j=>j.id===id&&j.status==='COMPLETED'&&j.video_url);return row?{choice,kind:'clip',title:clipLabel(row),video_url:row.video_url}:null;}
 if(kind==='assembly'){const row=S.assemblies.find(a=>a.id===id&&a.video_url);return row?{choice,kind:'scene',title:row.name,video_url:row.video_url}:null;}
 return null;
}
function currentReviewSelection(){return reviewSelection?.project_id===S.platform.project_id?reviewSource(reviewSelection.choice):null;}
function reviewSourcePreview(source){return source?`<div class="review-source-preview"><div><span class="badge">Saved ${esc(source.kind)}</span><h3>${esc(source.title)}</h3><p class="hint">Preview the version you’re sending for review.</p></div><video src="${esc(source.video_url)}" controls playsinline preload="metadata" aria-label="Selected review video"></video></div>`:'';}
async function openOutputForReview(kind,id){
 const source=reviewSource(kind+':'+id);if(!source)throw new Error('That output is no longer available. Refresh the studio and try again.');
 const previous=reviewSelection;reviewSelection={project_id:S.platform.project_id,choice:source.choice};
 await navigate('share');
 if(page!=='share'){reviewSelection=previous;return;}
 $('#review-source-preview')?.scrollIntoView?.({block:'start',behavior:'smooth'});
}
function changeReviewSource(select){
 const form=select.form||$('#share-form'),source=reviewSource(select.value);if(!form)return;
 const title=form.elements.title;
 if(source){
  if(!title.value||title.value===title.dataset.suggestedValue)title.value=source.title;
  title.dataset.suggestedValue=source.title;form.elements.kind.value=source.kind;
  reviewSelection={project_id:S.platform.project_id,choice:source.choice};
 }else reviewSelection=null;
 const preview=$('#review-source-preview');if(preview)preview.innerHTML=reviewSourcePreview(source);
}
function shareVersions(submissions) {
 return '<option value="">New submission</option>'+submissions
  .filter(s=>['changes_requested','rejected','approved','published','superseded'].includes(s.status))
  .map(s=>`<option value="${esc(s.id)}">${esc(s.title)} · ${esc(AIMPublication.status(s))}</option>`).join('');
}
function shareStatus(submissions) {
 return submissions.map(s=>`<article class="share-item">
   ${s.screening?.verdict==='file_problem'?'':`<video src="${esc(s.video_url)}" controls playsinline preload="metadata"></video>`}
   <div>
     <span class="review-status">${esc(AIMPublication.status(s))}</span>
     <h3 style="margin-top:12px">${esc(s.title)}</h3>
     <p class="hint">${esc(s.decision_note||s.screening?.reason||(s.status==='check_pending'
       ? 'Your video is being checked in the background. You can keep working on your movie.'
       : 'Status and reviewer notes appear here.'))}</p>
     <p class="hint"><strong>Public caption</strong> ${esc(s.public_caption||'None added')}</p>
     ${AIMPublication.buttons(s,'data-action')}
     ${s.history.map(h=>`<div class="review-history">${esc(h.action.replaceAll('_',' '))} · ${esc(h.actor_name||'Staff / creator')} · ${esc(h.note)}</div>`).join('')}
     ${s.status!=='withdrawn'?button('Withdraw','share-withdraw','ghost small',`data-id="${esc(s.id)}"`):''}
   </div>
 </article>`).join('')||'<p class="hint">Choose a video above when you are ready to share it on Discover.</p>';
}
function sharePage(){
 const selected=currentReviewSelection(),subs=S.platform.submissions;
 const clips=S.jobs.filter(j=>j.status==='COMPLETED'&&j.video_url);
 const automatic=S.platform.discover_review_mode!=='manual';
 const recent=(S.tasks||[]).find(t=>t.label==='Review submission');
 const failure=recent&&['failed','interrupted'].includes(recent.status);
 return heading('SHARE / DISCOVER','Ready for an audience?','Choose the clip or finished scene you want people to see. Preview your takes and assemble your movie privately in the studio.')+
 `<div class="source-layout">
   <section class="panel">
     <h3>Send a video for review</h3>
     <div id="review-source-preview">${reviewSourcePreview(selected)}</div>
     ${failure?`<div class="notice" role="alert"><strong>Couldn’t prepare the video.</strong> ${esc(recent.error||'Choose a playable video and submit again.')}</div>`:''}
     <form id="share-form" class="portal-form" enctype="multipart/form-data">
       <label>Choose an existing render or assembly<select name="source">
         <option value="" ${!selected?'selected':''}>Upload a video instead</option>
         <optgroup label="Completed clips">${clips.map(j=>`<option value="job:${esc(j.id)}" ${selected?.choice==='job:'+j.id?'selected':''}>${esc(j.shot_id||j.id.slice(0,10))} · ${esc(j.duration_seconds||'?')}s</option>`).join('')}</optgroup>
         <optgroup label="Assembled scenes">${S.assemblies.filter(a=>a.video_url).map(a=>`<option value="assembly:${esc(a.id)}" ${selected?.choice==='assembly:'+a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</optgroup>
       </select></label>
       <label>Or upload MP4, MOV or WebM (up to 256 MB)<input type="file" name="file" accept=".mp4,.mov,.webm"></label>
       <label>Creation type<select name="kind"><option value="clip" ${selected?.kind!=='scene'?'selected':''}>Clip</option><option value="scene" ${selected?.kind==='scene'?'selected':''}>Scene</option><option value="movie">Movie / finished cut</option></select></label>
       <label>Title<input name="title" required maxlength="120" value="${esc(selected?.title||S.vision.title)}" data-suggested-value="${esc(selected?.title||S.vision.title)}"></label>
       <label>Public caption (optional)<textarea name="public_caption" maxlength="2000" placeholder="What should viewers read below your video on Discover?"></textarea></label>
       <label>Tags (comma separated, up to five)<input name="tags" placeholder="sci-fi, animation, mystery"></label>
       <details><summary>Add private notes for staff</summary><label>Private review notes<textarea name="review_notes" maxlength="2000" placeholder="Include any context staff may need."></textarea></label></details>
       <label>Revised version of<select name="parent_id">${shareVersions(subs)}</select></label>
       <label class="check"><input type="checkbox" name="rights_confirmed" value="true" required>I can share this creation, including its source material, likenesses, audio and other included assets.</label>
       <button class="button primary">Send for review →</button>
     </form>
   </section>
   <aside><section class="panel">
     <div class="eyebrow">PUBLICATION PATH</div>
     <h3 style="margin-top:12px">You choose when to publish.</h3>
     <p class="hint">${automatic?'A moderation service checks this video and its public details in the background. Staff can review flags or incomplete checks.':'Staff review the video and public details you submit.'}</p>
     ${S.platform.discover_review_mode==='pilot'?'<p class="hint">During the pilot, staff make the final review decision.</p>':''}
     <p class="hint">When the status reads Ready to publish, preview the post and choose Publish. Each revision has its own check.</p>
     <a href="/discover" class="button secondary small">Visit Discover →</a>
     <details style="margin-top:18px"><summary>Current draft rules</summary><p class="hint preserve-lines">${esc(S.platform.policy.rules)}</p></details>
   </section></aside>
 </div>
 <div class="section-header row between wrap"><h2>Your creations in this project</h2>${button('Refresh status','share-refresh','ghost small')}</div>
 <section class="panel" id="review-status-list" tabindex="-1">${shareStatus(subs)}</section>`;
}
let shareRefreshRunning=false,shareRefreshVersion=0;
async function refreshShareStatus(){
 const root=$('#review-status-list');
 if(!root||page!=='share')return;
 const project=S.platform.project_id;
 const version=++shareRefreshVersion;
 shareRefreshRunning=true;
 try{
  const response=await fetch('/api/community/mine?project_id='+encodeURIComponent(project));
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'Status could not be refreshed.');
  if(version!==shareRefreshVersion||!root.isConnected||page!=='share'||S.platform.project_id!==project||busy)return;
  const signature=items=>JSON.stringify(items.map(item=>[item.id,item.status,item.history.length]));
  if(signature(S.platform.submissions)===signature(result.items))return;
  S.platform.submissions=result.items;
  root.innerHTML=shareStatus(result.items);
  const revision=$('#share-form select[name="parent_id"]');
  const choice=revision.value;
  revision.innerHTML=shareVersions(result.items);
  if([...revision.options].some(option=>option.value===choice))revision.value=choice;
 }finally{if(version===shareRefreshVersion)shareRefreshRunning=false;}
}
setInterval(()=>{
 if(!shareRefreshRunning&&!document.hidden&&page==='share'&&S?.platform?.submissions?.some(item=>item.status==='check_pending')){
  refreshShareStatus().catch(()=>{});
 }
},6000);
async function saveSource(){const f=$('#source-select-form');await api('source/select',{selected:$$('[data-source-unit]:checked').map(x=>x.dataset.sourceUnit),direction:f?.elements.direction.value??S.source.direction,bible:f?.elements.bible.value??S.source.bible,budget_usd:Number($('#source-budget')?.value||S.source.budget_usd||1)});}
async function platformAction(action,el){
 if(action==='review-output'){await openOutputForReview(el.dataset.kind,el.dataset.id);return true;}
 if(action.startsWith('publication-')){
  const item=S.platform.submissions.find(x=>x.id===el.dataset.id);
  if(item){
   if(action==='publication-preview')await AIMPublication.preview(item,refreshShareStatus);
   else if(action==='publication-edit')await AIMPublication.edit(item,refreshShareStatus);
   else await AIMPublication.unpublish(item,refreshShareStatus);
  }
  return true;
 }
 if(action==='source-stop'){bookStop=true;toast('Stopping after the current excerpt. Completed analysis remains saved.');return true;}
 if(action==='source-read'){const r=await fetch('/api/source/unit/'+el.dataset.id);const j=await r.json();if(!r.ok)throw new Error(j.error);const d=document.createElement('dialog');d.innerHTML=`<h2>${esc(j.unit.locator)}</h2><div class="source-reading">${esc(j.unit.text)}</div><form method="dialog"><button class="button secondary" style="margin-top:18px">Close excerpt</button></form>`;document.body.append(d);d.addEventListener('close',()=>d.remove());d.showModal();return true;}
 if(action==='source-analyze'){
  await run('Starting book analysis…',async()=>{await saveSource();await api('source/analyze-all',{source_id:S.source.id});});return true;
 }
 if(action==='source-synthesize'){
  await saveSource();const total=S.source.units.filter(x=>x.analysis).reduce((n,u)=>n+JSON.stringify(u.analysis).length+u.locator.length+40,0);const est=((total/4*.75)+(4000*4.5))/1e6;
  if(!window.confirm(isAdmin()?`Build a story bible from the completed notes? Planning estimate: $${est.toFixed(4)}. This is a separate paid request.`:'Build a story bible from your analyzed excerpts?'))return true;
  await run('Synthesizing source notes…',()=>api('source/synthesize',{}));return true;
 }
 if(action==='source-use'){await run('Attaching your adaptation source…',async()=>{await saveSource();await api('source/use',{});},{dest:'idea'});return true;}
 if(action==='share-refresh'){await refreshShareStatus();return true;}
 if(action==='share-withdraw'){await run('Withdrawing submission…',async()=>{await portalRequest('community/'+el.dataset.id+'/withdraw',{});await api('state');});return true;}
 return false;
}
async function portalRequest(path,data){const opts={method:'POST',headers:{'X-AIM-Token':token}};if(data instanceof FormData)opts.body=data;else{opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(data);}opts.headers['X-Workspace-ID']=S.workspace_id;const r=await AIMTasks.request(path,opts,S.workspace_id);const j=await r.json();if(!r.ok)throw new Error(j.error);if(r.status===202&&j.task){AIMTasks.track(j.task);taskQueued=true;}return j;}
async function platformSubmit(form){
 if(form.id==='source-upload-form'){await run('Importing your book…',()=>api('source/upload',new FormData(form)),{dest:'source',copy:isAdmin()?'Extracting text locally without AI requests.':'Preparing your source.'});return true;}
 if(form.id==='source-select-form'){await run('Saving adaptation scope…',saveSource);return true;}
 if(form.id==='share-form'){
  const f=new FormData(form);const choice=f.get('source');const file=f.get('file');
  if(choice&&file?.size)throw new Error('Choose an existing creation or upload a video, one at a time.');
  if(choice){f.delete('file');const [type,id]=choice.split(':');f.append(type==='job'?'job_id':'assembly_id',id);}else if(!file?.size)throw new Error('Choose a completed creation or upload a video.');
  f.append('project_id',S.platform.project_id);f.append('workspace_id',S.workspace_id);f.delete('source');if(!f.get('parent_id'))f.delete('parent_id');
  const success=await run('Sending for review…',async()=>{await portalRequest('community/submit',f);await api('state');reviewSelection=null;},{copy:'Saving the submitted version and checking playback.',message:'Submission saved. Check its status here before you publish.'});
  if(success){$('#review-status-list')?.scrollIntoView?.({block:'start',behavior:'smooth'});$('#review-status-list')?.focus?.({preventScroll:true});}return true;
 }
 return false;
}
