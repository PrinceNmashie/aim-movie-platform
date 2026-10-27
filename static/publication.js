'use strict';
// Shared creator-owned publication controls for Account and Studio → Share.
window.AIMPublication=(()=>{
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const labels={approved:'Approved · ready for you to publish',published:'Published · your creation',submitted:'Submitted for review',in_review:'Staff reviewing',changes_requested:'Changes requested',rejected:'Not approved',withdrawn:'Withdrawn',superseded:'Replaced by a newer version',taken_down:'Removed by staff'};
 function status(item){return labels[item.status]||item.status.replaceAll('_',' ');}
 function buttons(item,attribute='data-act'){
  if(!item.is_owner)return '';
  const edit=`<button type="button" class="button ghost small" ${attribute}="publication-edit" data-id="${escape(item.id)}">Edit public caption</button>`;
  if(item.status==='approved')return `<button type="button" class="button primary small" ${attribute}="publication-preview" data-id="${escape(item.id)}">Preview & publish →</button>`+edit;
  if(item.status==='published')return `<a class="button ghost small" href="${escape(item.creator_url)}">View on my profile</a><button type="button" class="button ghost small" ${attribute}="publication-unpublish" data-id="${escape(item.id)}">Unpublish</button>`+edit;
  return '';
 }
 async function request(path,body={}){
  const response=await fetch('/api/community/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-AIM-Token':document.querySelector('meta[name="aim-token"]').content},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Publication could not be updated.');return result;
 }
 async function preview(item,refresh){
  const dialog=document.createElement('dialog');dialog.className='publication-dialog';
  dialog.innerHTML=`<div class="eyebrow">YOUR PUBLIC POST PREVIEW</div><h2>${escape(item.title)}</h2><p class="hint">Created by <strong>${escape(item.author)}</strong> · Project: ${escape(item.project_name)}. Approved by ${escape(item.reviewer_name||'AIM.movie staff')}.</p><video src="${escape(item.video_url)}" controls playsinline preload="metadata"></video><div class="post-preview"><a href="${escape(item.creator_url)}" class="creator-line"><span class="creator-avatar">${escape(item.author.slice(0,1))}</span>${escape(item.author)}</a><h3>${escape(item.title)}</h3><p>${escape(item.public_caption||'No public caption.')}</p><div class="tag-row">${item.tags.map(t=>`<span class="tag">#${escape(t)}</span>`).join('')}</div></div><p class="hint">Only your approved video and public details appear on Discover. Review notes and project files stay private.</p><p class="portal-error" role="alert" id="publish-error"></p><div class="dialog-actions"><button type="button" class="button secondary" id="publish-cancel">Keep private</button><button type="button" class="button primary" id="publish-confirm">Publish as ${escape(item.author)}</button></div>`;
  document.body.append(dialog);dialog.addEventListener('close',()=>{dialog.querySelector('video')?.pause();dialog.remove();},{once:true});
  dialog.querySelector('#publish-cancel').addEventListener('click',()=>dialog.close());
  dialog.querySelector('#publish-confirm').addEventListener('click',async e=>{
   e.target.disabled=true;dialog.querySelector('#publish-error').textContent='';
   try{await request(item.id+'/publish');dialog.close();await refresh();}
   catch(error){dialog.querySelector('#publish-error').textContent=error.message;e.target.disabled=false;}
  });dialog.showModal();
 }
 async function unpublish(item,refresh){
  if(!window.confirm('Remove this post from Discover and your public profile? It will stay in your approved private creations.'))return;
  await request(item.id+'/unpublish');await refresh();
 }
 async function edit(item,refresh){
  const dialog=document.createElement('dialog');dialog.className='publication-dialog';
  dialog.innerHTML=`<div class="eyebrow">PUBLIC CAPTION / NEW REVIEW</div><h2>${escape(item.title)}</h2><p class="hint">Edit what viewers will read. The video stays the same. Staff review this new version before you can publish it; your existing post stays as it is until you publish the replacement.</p><label class="field"><span>Public caption</span><textarea id="caption-revision" maxlength="2000" rows="5">${escape(item.public_caption)}</textarea></label><p class="portal-error" id="caption-error" role="alert"></p><div class="dialog-actions"><button type="button" class="button secondary" id="caption-cancel">Cancel</button><button type="button" class="button primary" id="caption-save">Send revised caption for review</button></div>`;
  document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.querySelector('#caption-cancel').addEventListener('click',()=>dialog.close());
  dialog.querySelector('#caption-save').addEventListener('click',async e=>{e.target.disabled=true;try{await request(item.id+'/revise-caption',{public_caption:dialog.querySelector('#caption-revision').value});dialog.close();await refresh();}catch(error){dialog.querySelector('#caption-error').textContent=error.message;e.target.disabled=false;}});dialog.showModal();
 }
 return {status,buttons,preview,unpublish,edit};
})();
