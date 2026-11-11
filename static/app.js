'use strict';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const clone = value => JSON.parse(JSON.stringify(value));
const initials = value => (String(value || 'Character').split(/\s+/).slice(0,2).map(v=>v[0]).join('')).toUpperCase();
const token = $('meta[name="aim-token"]').content;
let taskQueued=false;
let S, page = location.pathname.slice(1) || 'overview', currentCID = null, dirty = false, busy = false, polling = false;
let draftEdit = null;
const draftEditors = {
  vision: {page:'brief',label:'brief',fields:'#brief-form [data-field]'},
  characters: {page:'characters',label:'character',fields:'#character-form [data-field], [name="character-reference-use"]'},
  script: {page:'script',label:'screenplay',fields:'[data-group="script"], #script-form [data-group="scene"], #script-form [data-dialogue]'},
  director: {page:'shots',label:'shot plan',fields:'#shots-form [data-group="shot"]'},
  'shot-model': {page:'shots',label:'video model',fields:'#shot-planning-model'},
  render: {page:'render',label:'video instructions',fields:'[data-field="render_prompt"], #render-duration'},
};
const steps = [
  ['idea','Your idea','A conversation to get started',null],
  ['brief','Creative brief','The direction of your movie','vision'],
  ['characters','Characters','Your cast and reference sheets','characters'],
  ['script','Script','Scenes that tell your story','script'],
  ['shots','Shot plan','Turn scenes into clear shots','director'],
  ['render','Render','Bring one shot to life',null]
];
const titles = {overview:'My studio',idea:'Your idea',brief:'Creative brief',characters:'Characters',script:'Script',shots:'Shot plan',render:'Render',library:'Video library',assembly:'Scene builder',settings:'Settings',activity:'Creative history',source:'Adapt a story',share:'Review & publication'};
function badge(status) {
  const map = {approved:['Approved','green'],completed:['Completed','green'],configured:['Configured','green'],failed:['Failed','red'],draft:['Draft','gold'],review:['Review needed','gold'],empty:['Not started','']};
  const [text, color] = map[status] || [status,''];
  return `<span class="badge ${color}">${esc(text)}</span>`;
}
function button(text, action, klass='secondary', attrs='') {
  return `<button type="button" class="button ${klass}" data-action="${action}" ${attrs}>${text}</button>`;
}
function link(text, dest, klass='secondary') {
  return `<a href="/${dest}" data-nav="${dest}" class="button ${klass}">${text}</a>`;
}
function heading(eyebrow, title, copy, right='') {
  return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${copy}</p></div>${right}</div>`;
}
function field(label, value, name, opts={}) {
  const attrs = `${opts.group ? `data-group="${opts.group}"` : ''} ${opts.index != null ? `data-index="${opts.index}"` : ''} data-field="${name}"`;
  const input = opts.area ? `<textarea ${attrs} rows="${opts.rows || 3}" ${opts.required ? 'required' : ''} placeholder="${esc(opts.placeholder || '')}">${esc(value)}</textarea>` : `<input ${attrs} type="${opts.type || 'text'}" value="${esc(value)}" ${opts.required ? 'required' : ''} ${opts.readonly ? 'readonly' : ''} ${opts.min != null ? `min="${opts.min}"` : ''} ${opts.max != null ? `max="${opts.max}"` : ''} ${opts.step != null ? `step="${opts.step}"` : ''} placeholder="${esc(opts.placeholder || '')}">`;
  return `<label class="field ${opts.full ? 'full' : ''}"><span>${label}</span>${input}${opts.hint ? `<div class="hint">${opts.hint}</div>` : ''}</label>`;
}
function notice(text, kind='') { return `<div class="notice ${kind}">${text}</div>`; }
function noKey() {return !S.configured.openai ? notice(isAdmin()?`Connect OpenAI to generate drafts and character art. ${link('Open settings','settings','small ghost')}`:'MIA is temporarily unavailable. You can still edit your project.') : '';}
function stale(stage) {
  return S.statuses[stage] === 'review' ? notice('An earlier step changed. Your draft is still here. Review it, edit it, or generate a new version before approving it again.') : '';
}
function reviewFooter(title, copy, back, action, label) {
  return `<div class="review-footer"><div><h3>${title}</h3><p>${copy}</p></div><div class="row">${link('Back',back,'ghost')}${button(label+' <span class="arrow">→</span>',action,'primary')}</div></div>`;
}
function draftControls(stage) {
  const label = draftEditors[stage].label;
  const attrs = `data-stage="${stage}"`;
  const controls = draftEdit?.stage === stage
    ? button('Save '+label,'save-draft','primary small',attrs) + button('Cancel','cancel-draft','ghost small',attrs)
    : button('Edit '+label,'edit-draft','secondary small',attrs);
  return `<div class="row wrap draft-controls">${controls}</div>`;
}
function applyDraftLocks() {
  for (const [stage, editor] of Object.entries(draftEditors)) {
    if (editor.page !== page) continue;
    const locked = draftEdit?.stage !== stage;
    $$(editor.fields).forEach(field=>{
      field.dataset.draftField = stage;
      if (field.tagName === 'SELECT' || field.type === 'radio') field.disabled = locked;
      else field.readOnly = locked;
    });
  }
  $$('[data-draft-operation]').forEach(control=>{
    control.hidden = control.dataset.draftOperation !== draftEdit?.stage;
  });
  if (!draftEdit) return;
  const stage = draftEdit.stage;
  const allowed = `[data-draft-field="${stage}"], [data-draft-operation="${stage}"], [data-action="save-draft"], [data-action="cancel-draft"]`;
  $$('#main input, #main textarea, #main select, #main button').forEach(control=>{
    if (!control.matches(allowed)) control.disabled = true;
  });
}
function startDraft(stage, newCharacter=false) {
  if (draftEditors[stage]?.page !== page || draftEdit) return;
  draftEdit = {stage,newCharacter};
  if (stage === 'script' || stage === 'director') draftEdit.value = clone(S[stage]);
  render();
  draftEdit.initial = draftFieldValues(stage);
  $(draftEditors[stage].fields)?.focus();
  if (newCharacter) setDirty(true);
}
function draftFieldValues(stage) {
  return $$(draftEditors[stage].fields).map(field=>field.type==='radio' ? field.checked : field.value);
}
function closeDraft(stage) {
  draftEdit=null;
  setDirty(false);
  render();
  focusDraftControl(stage);
}
function focusDraftControl(stage) {
  const control = $(`[data-action="edit-draft"][data-stage="${stage}"]`);
  const details = control?.closest('details');
  if (details) details.open = true;
  (control || $('#main')).focus();
}
function toast(message, error=false) {
  const item = document.createElement('div'); item.className = 'toast' + (error ? ' error' : ''); item.textContent = message;
  $('#toasts').append(item); setTimeout(()=>item.remove(), error ? 13000 : 4500);
}
function setDirty(value) {
  dirty = value; $('#save-status').classList.toggle('dirty',value);
  $('#save-status').innerHTML = `<span></span>${value ? 'Unsaved edits' : 'Saved'}`;
}
function setBusy(value, label='MIA is working on your movie…', copy='Your saved work will stay available.') {
  busy = value; $('#busy-overlay').hidden = !value; $('#busy-title').textContent = label; $('#busy-copy').textContent = copy;
  document.body.setAttribute('aria-busy',String(value));
  if(typeof updateRenderReview==='function')updateRenderReview();
}
async function api(path, data) {
  const opts = {headers:{'X-AIM-Token':token,'X-Workspace-ID':S?.workspace_id || ''}};
  if (data !== undefined) {
    opts.method = 'POST';
    if (data instanceof FormData) opts.body = data;
    else {opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(data);}
  }
  const response = await AIMTasks.request(path,opts,S?.workspace_id || '');
  let result;
  try { result = await response.json(); } catch { throw new Error('The server did not respond. Check that the studio is still running.'); }
  if (!response.ok) throw new Error(result.error || 'This action could not be completed.');
  if(response.status===202 && result.task){AIMTasks.track(result.task);taskQueued=true;const state=await fetch('/api/state');if(!state.ok)throw new Error('Your work was accepted. Reopen this movie to check its progress.');S=await state.json();return S;}
  S = result; return result;
}
async function run(label, work, options={}) {
  if (busy) return;
  taskQueued=false;setBusy(true,label,options.copy || 'Your saved work will stay available.');
  let success = false;
  try {
    await work(); success = true;
    if (!options.keepDirty) setDirty(false);
    if (options.dest) navigate(options.dest, true);
    else if (options.repaint !== false) render();
    else renderShell();
    if(taskQueued)toast('Task saved. You can leave this page while it finishes.');else if (options.message) toast(options.message);
  } catch (error) {toast(error.message,true);}
  finally {setBusy(false);}
  return success;
}
async function navigate(dest, force=false) {
  if(bookAnalysisRunning)return toast('Stop book analysis before changing pages.');
  if (!force && (busy || (dirty || AIMVoice.active()) && !window.confirm('Leave this page? Unsaved edits and any current recording will be discarded.'))) return;
  await AIMVoice.cancel();AIMVoice.stopPlayback();
  if(dest==='overview' || S?.dashboard) {
    try { await api(dest==='overview'?'platform/dashboard':'state'); }
    catch(error) { return toast(error.message,true); }
  }
  page = dest; draftEdit = null; setDirty(false);
  const path = '/' + dest;
  if (location.pathname !== path) history.pushState({},'',path);
  $('#sidebar').classList.remove('open');$('#menu-toggle').setAttribute('aria-expanded','false');
  render();window.scrollTo(0,0);$('#main').focus({preventScroll:true});
}
function resumePage() {
  if (!S.messages.length && !S.vision.logline) return 'idea';
  if (S.statuses.vision !== 'approved') return S.vision.logline ? 'brief' : 'idea';
  if (S.statuses.characters !== 'approved') return 'characters';
  if (S.statuses.script !== 'approved') return 'script';
  if (S.statuses.director !== 'approved') return 'shots';
  return 'render';
}
function renderShell() {
  document.body.classList.toggle('studio-dashboard',page==='overview');
  document.body.classList.toggle('creation-flow',!['overview','settings','activity'].includes(page));
  document.body.dataset.studioPage=page;
  platformHeader();
  AIMTasks.showBar(S.tasks||[]);
  document.title = `${titles[page] || 'Studio'} · AIM.movie`;
  if(page==='overview')return;
  $('#project-title').textContent = S.vision.title || 'Untitled movie';
  $('#global-model').innerHTML = S.text_models.map(m=>`<option value="${esc(m)}" ${m===S.settings.model ? 'selected' : ''}>${esc(m)}</option>`).join('');
  $('#workflow-nav').innerHTML = steps.map(([slug,label,copy,stage],index)=>{
    const status = stage ? S.statuses[stage] : slug==='idea' ? S.messages.length ? 'draft' : 'empty' : S.jobs.length ? 'draft' : 'empty';
    return `<a href="/${slug}" data-nav="${slug}" class="step-link ${page===slug ? 'active' : ''}" ${page===slug ? 'aria-current="page"' : ''}><span class="step-number ${status==='approved' ? 'done' : ''}">${status==='approved' ? '✓' : '0'+(index+1)}</span><span class="step-text">${label}<small>${status==='approved' ? 'Approved' : status==='review' ? 'Review needed' : copy}</small></span></a>`;
  }).join('');
  $$('.sidebar [data-nav]').forEach(a=>a.classList.toggle('active',a.dataset.nav===page));
  $('#library-count').textContent = S.jobs.length || '';
}
function overview() {
  return studioDashboardPage();
}
function idea() {return conversationPage();}

function brief() {
  const v = S.vision;
  return heading('02 / CREATIVE DIRECTION','Make the vision yours.','Review what MIA understood. Choose Edit brief to make changes.',`<div class="row wrap">${badge(S.statuses.vision)}${draftControls('vision')}</div>`) + noKey() + stale('vision') +
    `<form id="brief-form"><div class="grid-two"><section class="panel"><div class="panel-title"><h3>Your movie</h3></div><div class="field-grid">${field('Working title',v.title,'title',{full:true,placeholder:'Give your movie a name'})}${field('Premise',v.logline,'logline',{full:true,area:true,rows:4,required:true,placeholder:'What happens in your story?'})}${field('Genre',v.genre,'genre',{placeholder:'Action, drama, comedy…'})}${field('Tone',v.tone,'tone',{placeholder:'Hopeful, tense, playful…'})}${field('Setting',v.setting,'setting',{area:true,full:true,placeholder:'Where and when does it take place?'})}</div></section><section class="panel"><div class="panel-title"><h3>The look and creative choices</h3></div><div class="field-grid">${field('Visual style',v.visual_style,'visual_style',{full:true,area:true,rows:3,placeholder:'Cinematic realism, bold comic-book ink…'})}${field('Target duration in seconds',v.duration_seconds || 30,'duration_seconds',{type:'number',full:true,hint:'Target length for your completed movie.'})}${field('Themes',v.themes?.join('\n'),'themes',{area:true,full:true,hint:'One theme per line.'})}${field('Creative decisions to preserve',v.creative_decisions?.join('\n'),'creative_decisions',{area:true,full:true,hint:'One decision per line.'})}</div></section></div></form>
    ${v.open_questions?.length ? `<details class="panel" style="margin-top:22px"><summary>Suggestions still open to your direction (${v.open_questions.length})</summary>${v.open_questions.map(q=>`<div class="list-note">${esc(q)}</div>`).join('')}</details>` : ''}
    <div class="row wrap" style="margin-top:22px">${button(S.source?.selected?.length?'Refresh from source':'Refresh from conversation','generate-vision','ghost',!S.configured.openai || (!S.messages.length&&!S.source?.selected?.length) ? 'disabled' : '')}</div>
    ${reviewFooter('Does this capture your idea?','Your approved brief becomes the starting point for the character sheets.',S.source?.selected?.length?'source':'idea','approve-vision','Approve & build characters')}`;
}
function imagePreview(url,name) {
  return `<div class="sheet-view">${url ? `<img src="${esc(url)}" alt="${esc(name)} character reference sheet">` : `<div class="sheet-placeholder"><span class="initials">${esc(initials(name))}</span><strong>Your character, visualized.</strong><p>Generate a reference sheet from the details on the left, or upload one you already like.</p></div>`}</div>`;
}
function uploadButton(text, action, attrs='') {
  return `<label class="button ghost small upload-label">${text}<input type="file" accept="image/png,image/jpeg,image/webp" data-upload="${action}" ${attrs} aria-label="${esc(text)}"></label>`;
}
function characterReferenceChoice(c) {
  const enabled=c.use_as_reference!==false;
  return `<fieldset class="reference-choice"><legend>How should this image be used?</legend><label><input type="radio" name="character-reference-use" form="character-form" value="reference" ${enabled?'checked':''}><span><strong>Use as character reference</strong><small>Guide this character’s appearance without making the image the opening frame.</small></span></label><label><input type="radio" name="character-reference-use" form="character-form" value="save_only" ${!enabled?'checked':''}><span><strong>Save only</strong><small>Keep the image here without sending it to video generation.</small></span></label><p class="hint">Your choice carries into Render. ${draftEdit?.stage==='characters'?'Save the character to apply this choice.':'Choose Edit character to change it.'}</p></fieldset>`;
}
function characters() {
  const newCharacter = draftEdit?.stage === 'characters' && draftEdit.newCharacter;
  if (!S.characters.length && !newCharacter) {
    return heading('03 / THE CAST','Meet your characters.','Develop your cast from the approved creative brief, whether you started with an idea or a source story.',badge(S.statuses.characters)) + noKey() +
      (S.statuses.vision !== 'approved' ? notice(`Approve your creative brief to draft character profiles. ${link('Review brief','brief','ghost small')}`) : '') +
      `<div class="empty-state"><div class="empty-symbol">♙</div><h2>Your cast starts with your idea.</h2><p>MIA uses your approved brief to draft each character’s appearance, personality, and visual reference.</p><div class="row wrap">${button('Draft your characters','generate-characters','primary',S.statuses.vision !== 'approved' || !S.configured.openai ? 'disabled' : '')}${button('Add a character myself','add-character','secondary')}</div></div>` +
      (S.statuses.vision==='approved' ? `<div class="review-footer"><div><h3>A movie without characters?</h3><p>You can continue with a scenery or abstract film.</p></div>${button('Continue without a cast','skip-characters','ghost')}</div>` : '');
  }
  const c = newCharacter ? {id:'',name:'',images:[]} : (S.characters.find(c=>c.id===currentCID) || S.characters[0]);
  if (!newCharacter) currentCID = c.id;
  const image = c.images?.find(v=>v.id===c.current_image);
  return heading('03 / THE CAST','Give your characters a face.','Review the profile and choose Edit character to update it. Generate or upload a sheet when you’re ready.',badge(S.statuses.characters)) + noKey() + stale('characters') +
    `<div class="cast-bar">${S.characters.map(char=>`<button class="cast-tab ${char.id===c.id ? 'active' : ''}" data-action="select-character" data-id="${esc(char.id)}"><span class="initials">${esc(initials(char.name))}</span><span>${esc(char.name || 'Unnamed character')}<small>${esc(char.role || 'Character')}</small></span></button>`).join('')}${button('＋ Add character','add-character','ghost small')}<span class="spacer"></span>${button('Refresh profiles','generate-characters','ghost small',!S.configured.openai || S.statuses.vision!=='approved' ? 'disabled' : '')}</div>
    <div class="cast-workspace"><section class="panel"><div class="panel-title"><div><div class="subtle-label">CHARACTER PROFILE</div><h2>${esc(c.name || 'New character')}</h2></div>${draftControls('characters')}</div><form id="character-form" data-id="${esc(c.id)}"><div class="field-grid">${field('Name',c.name,'name',{required:true})}${field('Role in the story',c.role,'role',{placeholder:'Protagonist, rival…'})}${field('Age / life stage',c.age,'age',{full:true,placeholder:'Mid-20s, older adult…'})}${field('Appearance',c.appearance,'appearance',{area:true,rows:4,full:true,required:true,placeholder:'Face, hair, build, distinguishing details…'})}${field('Wardrobe',c.wardrobe,'wardrobe',{area:true,full:true,placeholder:'The outfit that should stay consistent.'})}${field('Personality',c.personality,'personality',{area:true,full:true})}</div><details class="details"><summary>Backstory & visual direction</summary><div class="field-grid">${field('Backstory',c.backstory,'backstory',{area:true,full:true})}${field('Identity details to preserve',c.identity_constraints,'identity_constraints',{area:true,full:true,placeholder:'Keep the face, hair, outfit, and proportions consistent.'})}${field('Additional sheet direction',c.reference_image_prompt,'reference_image_prompt',{area:true,rows:4,full:true,hint:'The sheet also uses all of the profile details above and the visual style from your brief.'})}</div></details></form><div class="row between" style="margin-top:20px">${newCharacter?'':button('Remove character','delete-character','danger small',`data-id="${esc(c.id)}"`)}</div></section>
    <section class="panel"><div class="panel-title"><div><div class="subtle-label">VISUAL REFERENCE</div><h3>Character sheet</h3></div>${image ? `<a class="button ghost small" href="${esc(c.image_url)}" download="${esc(c.name)}-sheet.png">Download</a>` : '<span class="badge">No image yet</span>'}</div>${imagePreview(c.image_url,c.name)}
    ${c.image_outdated ? notice('Your profile changed after this image was made. Edit the image or generate a new sheet to match the latest details.') : ''}
    <div class="image-actions">${button(c.image_url ? 'Generate new version' : 'Generate character sheet','generate-image','primary',!S.configured.openai ? 'disabled' : '')}${uploadButton('Upload a sheet','character-sheet')}</div>${adminInfo(`<p class="image-credit">Image model: ${esc(S.settings.image_model)} · ${esc(S.settings.image_quality)} quality · Uses your OpenAI API</p>`)}
    ${characterReferenceChoice(c)}
    ${c.images?.length ? `<div class="versions" aria-label="Previous image versions">${c.images.map((v,i)=>`<button class="version ${v.id===c.current_image ? 'active' : ''}" data-action="select-image" data-id="${esc(v.id)}"><img src="${esc(v.url)}" alt="Sheet version ${i+1}"><span>Version ${i+1}</span></button>`).join('')}</div><details class="reference-tools"><summary>Refine this image</summary><label class="field"><span>What should change?</span><textarea id="image-correction" rows="3" placeholder="Keep the face and outfit, but make the hair shorter and fix the side view."></textarea></label><div class="row" style="margin-top:12px">${button('Apply image correction','edit-image','secondary',!S.configured.openai ? 'disabled' : '')}</div><p class="hint">Your earlier version stays saved.</p></details>` : ''}
    <details class="details"><summary>Add an identity photo</summary>${c.reference_photo_url ? `<div class="reference-photo"><img src="${esc(c.reference_photo_url)}" alt="Identity photo"><div><strong>Reference photo saved</strong><p>Included in future sheet generation and image corrections.</p></div></div>` : '<p class="hint" style="margin-bottom:12px">Upload a photo or character portrait. MIA will include it as an identity reference when generating the sheet.</p>'}${uploadButton('Upload identity photo','character-photo')}</details></section></div>
    <details class="panel ensemble-section"><summary>Combined cast reference</summary><div class="panel-title"><div><h3>A single sheet for the whole cast</h3><p>Combine the edited profiles and their selected images into one reference.</p></div>${button(S.ensemble.image_url ? 'Generate new cast sheet' : 'Build combined cast sheet','ensemble','secondary',!S.configured.openai ? 'disabled' : '')}</div>${S.ensemble.image_url ? `${imagePreview(S.ensemble.image_url,'Combined cast')}<div class="versions" aria-label="Cast-sheet versions">${S.ensemble.images.map((v,i)=>`<button class="version ${v.id===S.ensemble.current_image ? 'active' : ''}" data-action="select-ensemble-image" data-id="${esc(v.id)}"><img src="${esc(v.url)}" alt="Cast sheet version ${i+1}"><span>Version ${i+1}</span></button>`).join('')}</div><div class="row wrap"><span class="reference-selected">Available for shots with this cast</span><a class="button ghost small" href="${esc(S.ensemble.image_url)}" download="cast-sheet.png">Download</a></div><div class="details">${field('What should change in the cast sheet?','','ensemble_correction',{area:true,rows:2,placeholder:'Make the characters more distinct. Keep both outfits and faces.'})}<div style="margin-top:12px">${button('Apply cast-sheet correction','edit-ensemble','secondary',!S.configured.openai ? 'disabled' : '')}</div></div>` : '<p class="hint">Useful when your video needs multiple distinct characters in the same reference image.</p>'}</details>
    ${reviewFooter('Happy with your cast?','Images can be refined later. Your edited profiles carry into the script and shot plan.','brief','approve-characters','Approve & continue to script')}`;
}
function scriptPage() {
  const script = draftEdit?.stage==='script' ? draftEdit.value : S.script;
  const header = heading('04 / THE STORY','Write the scene. Find the story.','MIA writes from your approved brief and edited cast. You can change every scene.',badge(S.statuses.script)) + noKey() + stale('script');
  if (!script.scenes?.length && draftEdit?.stage!=='script') return header + `<div class="empty-state"><div class="empty-symbol">▤</div><h2>Your characters are ready for a story.</h2><p>Draft a connected sequence, then revise the action and dialogue in plain language.</p><div class="row wrap">${button('Draft screenplay','generate-script','primary',S.statuses.characters!=='approved' || !S.configured.openai ? 'disabled' : '')}${button('Write a scene myself','add-scene')}</div>${S.statuses.characters!=='approved' ? `<p class="hint">${link('Review and approve characters','characters','ghost small')}</p>` : ''}</div>`;
  return header + `<section class="panel" style="margin-bottom:22px"><div class="panel-title"><h3>The screenplay</h3>${draftControls('script')}</div><div class="field-grid" id="script-meta">${field('Title',script.title,'title',{group:'script',full:true})}${field('Synopsis',script.synopsis,'synopsis',{group:'script',full:true,area:true})}${field('Notes for the next AI revision','','revision_notes',{group:'revision',full:true,area:true,rows:2,placeholder:'Make the dialogue more natural. Keep the ending, but shorten the opening.'})}</div><div class="row wrap">${button('Generate a revised draft','generate-script','ghost small',!S.configured.openai || S.statuses.characters!=='approved' ? 'disabled' : '')}</div></section><form id="script-form">${(script.scenes || []).map((scene,i)=>`<details class="panel scene compact-editor" ${i===0?'open':''}><summary>Scene ${i+1} · ${esc(scene.title||'Untitled scene')}</summary><div class="scene-header"><span class="scene-number">SCENE ${String(i+1).padStart(2,'0')}</span><h3>${esc(scene.title || 'Untitled scene')}</h3>${button('Remove','remove-scene','ghost small',`data-draft-operation="script" data-index="${i}"`)}</div><div class="field-grid">${field('Scene title',scene.title,'title',{group:'scene',index:i,full:true})}${field('Location',scene.location,'location',{group:'scene',index:i})}${field('Time / lighting',scene.time,'time',{group:'scene',index:i})}${field('Purpose of this scene',scene.purpose,'purpose',{group:'scene',index:i,full:true,area:true,rows:2})}${field('Action',scene.action,'action',{group:'scene',index:i,full:true,area:true,rows:4})}</div>${Array.isArray(scene.source_refs)&&scene.source_refs.length?`<details class="details"><summary>Source links and adaptation choices</summary><p class="hint">Source: ${scene.source_refs.map(esc).join('; ')}</p><p class="hint">${Array.isArray(scene.adaptation_changes)?scene.adaptation_changes.map(esc).join('; '):''}</p></details>`:''}<div class="dialogue-label">Dialogue</div>${(scene.dialogue || []).map((line,j)=>`<div class="dialogue-row"><label class="sr-only" for="speaker-${i}-${j}">Speaker</label><input id="speaker-${i}-${j}" data-dialogue="speaker" data-scene="${i}" data-line="${j}" value="${esc(line.speaker)}" placeholder="Speaker"><label class="sr-only" for="line-${i}-${j}">Dialogue line</label><textarea id="line-${i}-${j}" data-dialogue="line" data-scene="${i}" data-line="${j}" rows="1" placeholder="What they say…">${esc(line.line)}</textarea><button type="button" class="icon-button" data-action="remove-dialogue" data-draft-operation="script" data-index="${i}" data-line="${j}" aria-label="Remove dialogue line">×</button></div>`).join('')}${button('＋ Add dialogue','add-dialogue','ghost small',`data-draft-operation="script" data-index="${i}"`)}</details>`).join('')}</form><div class="row wrap">${button('＋ Add scene','add-scene','ghost','data-draft-operation="script"')}</div>${reviewFooter('Does the story feel right?','Review the action and dialogue before turning each scene into shots.','characters','approve-script','Approve & continue to shots')}`;
}
function shotModelPanel() {
  const current = S.settings.video_provider==='alibaba' ? 'alibaba' : 'runway:'+S.settings.runway_model;
  const durations = S.limits.durations;
  const supported = durations.length === S.limits.max_duration - S.limits.min_duration + 1
    ? (durations.length===1 ? durations[0] : S.limits.min_duration+'–'+S.limits.max_duration)
    : durations.join(', ');
  return `<section class="panel shot-planning-model">
    <div class="panel-title"><h3>Video model for this plan</h3>${draftControls('shot-model')}</div>
    <label class="field"><span>Model</span><select id="shot-planning-model">
      <option value="alibaba" ${current==='alibaba'?'selected':''}>Alibaba Wan 3.0</option>
      <optgroup label="Runway models">${S.providers.runway_models.map(model=>`<option value="runway:${esc(model.id)}" ${current==='runway:'+model.id?'selected':''}>${esc(model.name)}</option>`).join('')}</optgroup>
    </select></label>
    <p class="hint">Supported clip lengths for the saved model are ${supported} seconds. MIA uses the action, dialogue and pauses in your script to choose each length.</p>
  </section>`;
}
function shotDurationField(shot,index) {
  const seconds = Number(shot.duration_seconds);
  const supported = S.limits.durations;
  const choices = supported.includes(seconds) ? supported : [seconds,...supported];
  return `<label class="field"><span>Clip duration in seconds</span>
    <select data-field="duration_seconds" data-group="shot" data-index="${index}">
      ${choices.map(length=>`<option value="${length}" ${length===seconds?'selected':''}>${length} seconds${supported.includes(length)?'':' · previous plan'}</option>`).join('')}
    </select>${shot.duration_reason?`<span class="hint">Timing: ${esc(shot.duration_reason)}</span>`:''}
  </label>`;
}
function shotsPage() {
  const shots = (draftEdit?.stage==='director' ? draftEdit.value : S.director).shots || [];
  const header = heading('05 / THE DIRECTION','Plan the moments that matter.','Give each shot the time its action and dialogue need.',badge(S.statuses.director)) + noKey() + stale('director') + shotModelPanel();
  if (!shots.length && draftEdit?.stage!=='director') return header + `<div class="empty-state"><div class="empty-symbol">▣</div><h2>Turn your scenes into shots.</h2><p>MIA times each shot from the screenplay using the model above. Review the plan before generating a video.</p><div class="row wrap">${button('Create shot plan','generate-director','primary',S.statuses.script!=='approved' || !S.configured.openai ? 'disabled' : '')}${button('Add a shot myself','add-shot')}</div>${S.statuses.script!=='approved' ? `<p class="hint">${link('Review and approve script','script','ghost small')}</p>` : ''}</div>`;
  return header + `<section class="panel" style="margin-bottom:22px"><div class="row between"><div><h3>${shots.length} shots to bring your story to life</h3><p class="hint">Plan the action, camera movement and continuity for each shot.</p></div>${draftControls('director')}</div><div style="margin-top:16px">${field('Notes for the next AI revision','','revision_notes',{group:'revision',area:true,rows:2,placeholder:'Use a quick insert of the key, then hold on the conversation.'})}</div><div class="row wrap">${button('Revise shot plan','generate-director','ghost small',!S.configured.openai || S.statuses.script!=='approved' ? 'disabled' : '')}</div></section><form id="shots-form"><div class="shot-grid">${shots.map((shot,i)=>`<details class="panel shot-card compact-editor" ${i===0?'open':''}><summary>Clip ${i+1} · ${shot.duration_seconds}s · ${esc(shot.shot_type||'Continuous take')}</summary><div class="scene-header"><span class="scene-number">SHOT ${String(i+1).padStart(2,'0')}</span><h3>${esc(shot.shot_type || 'New shot')}</h3>${button('Remove','remove-shot','ghost small',`data-draft-operation="director" data-index="${i}"`)}</div><div class="field-grid">${field('Shot type',shot.shot_type,'shot_type',{group:'shot',index:i})}${shotDurationField(shot,i)}${field('Scene',shot.scene_id,'scene_id',{group:'shot',index:i})}${field('Characters',shot.characters?.join(', '),'characters',{group:'shot',index:i,placeholder:'Names, separated by commas'})}${field('Camera',shot.camera,'camera',{group:'shot',index:i,area:true,full:true,rows:2})}${field('On-screen action',shot.on_screen_action,'on_screen_action',{group:'shot',index:i,area:true,full:true,rows:3})}${field('Continuity',shot.continuity,'continuity',{group:'shot',index:i,area:true,full:true,rows:2})}${field('Reason for starting a new clip',shot.cut_reason,'cut_reason',{group:'shot',index:i,full:true,area:true,rows:2,placeholder:'Duration limit, a new camera angle, or a real scene change.'})}${field('Sound direction',shot.sound,'sound',{group:'shot',index:i,full:true})}${field('Extra prompt direction',shot.prompt,'prompt',{group:'shot',index:i,area:true,full:true,rows:2})}</div></details>`).join('')}</div></form><div class="row wrap" style="margin-top:22px">${button('＋ Add shot','add-shot','ghost','data-draft-operation="director"')}</div>${reviewFooter('Ready to bring a shot to life?','Approve the plan, then choose a shot and review the final video prompt.','script','approve-director','Approve & continue to render')}`;
}
function continuationPanel() {
  const c=S.continuation;
  if(!c.source_job_id)return '';
  const source=S.jobs.find(j=>j.id===c.source_job_id);
  const frame=S.references[c.slot]?.url;
  const firstFrame=S.settings.video_provider==='runway' ? S.settings.runway_mode==='first_frame'&&S.settings.runway_start_slot===c.slot : S.settings.wan_mode==='first_frame'&&S.settings.wan_start_slot===c.slot;
  const copy=firstFrame ? 'The selected frame starts the new clip. Other saved reference images are not sent in this mode.' : (S.settings.video_provider==='alibaba'?S.settings.wan_mode==='text':S.settings.runway_mode==='text') ? 'Text-only mode sends no images. Choose Opening image in Advanced settings to continue from the saved final image.' : 'Use the saved final image as the opening image to continue from this exact moment.';
  return `<section class="panel continuity-panel" id="review-continuation"><div class="panel-title"><div><div class="subtle-label">CONTINUE THE SCENE</div><h3>Pick up where the previous clip ended.</h3><p>Picture ${c.slot==='ref_a' ? '1' : '2'} holds its last frame. Describe the next moment.</p></div>${button('Clear continuation','clear-ref','ghost small',`data-slot="${esc(c.slot)}"`)}</div><div class="continuity-layout">${frame ? `<img class="continuity-frame" src="${esc(frame)}" alt="Last frame of the previous clip">` : ''}<div>${field('What happens next?',c.next_action,'next_action',{area:true,rows:3,placeholder:'The fighter regains his balance and steps back while the other lowers his fist.'})}<div class="row wrap" style="margin-top:12px">${button('Build continuation prompt','compile-continuation','primary')}${source ? link('View previous clip','library','ghost small') : ''}</div></div></div><p class="hint">${copy}</p></section>`;
}
function renderPage() {return renderReviewPage();}

function clipLabel(job) {
  const index=S.jobs.findIndex(j=>j.id===job.id);
  return `${job.shot_id || 'Clip '+(S.jobs.length-index)}${job.duration_seconds ? ' · '+Number(job.duration_seconds).toFixed(1)+' sec' : ''}`;
}
function libraryPage() {
  const header=heading('YOUR OUTPUT','The video library.','Capture a last frame, continue a clip, or add it to a scene.',`<div class="row wrap">${link('Scene builder','assembly','secondary small')}${link('Render a clip','render','primary small')}</div>`);
  if(!S.jobs.length)return header + `<div class="empty-state"><div class="empty-symbol">▷</div><h2>Your first clip belongs here.</h2><p>Render a clip, then continue its action or combine it with other clips.</p>${link('Open render studio','render','primary')}</div>`;
  return header + (!S.configured.video_tools ? notice(isAdmin()?'Install the updated requirements and restart the app to enable last-frame capture and scene export.':'Video editing is temporarily unavailable.') : '') +
    `${adminInfo('<p class="hint" style="margin-bottom:20px">The server checks saved video task IDs and downloads results independently of this page.</p>')}${S.jobs.map(j=>{
      const active=['IN_QUEUE','IN_PROGRESS','RUNNING','PENDING'].includes(j.status);
      const ready=j.status==='COMPLETED' && !!j.video_url;
      const added=S.sequence.clip_ids.includes(j.id);
      let summary={};try{summary=JSON.parse(j.summary || '{}');}catch{}
      return `<section class="panel job-card"><div class="row between wrap"><div><div class="eyebrow" style="margin-bottom:5px">${j.continued_from ? 'CONTINUED SEGMENT' : 'RENDERED CLIP'}</div><h3>${esc(clipLabel(j))}</h3><div class="job-meta">${esc(j.provider_label)} · ${esc(new Date(j.created).toLocaleString())}${adminInfo(' · '+esc(j.id.slice(0,22)))}</div>${jobCost(j)}${j.status_note?`<p class="hint" role="status">${esc(j.status_note)}</p>`:''}<p class="hint">Discover status ${esc((j.staff_review||'not submitted').replaceAll('_',' '))} · ${link('Open Share','share','ghost small')}</p></div><div class="row wrap">${badge(j.status==='COMPLETED' ? 'completed' : j.status==='FAILED' ? 'failed' : j.status.replaceAll('_',' ').toLowerCase())}${button('Check status','refresh-job','ghost small',`data-id="${esc(j.id)}" ${!j.can_refresh ? 'disabled' : ''}`)}</div></div>
      ${j.video_url ? `<video controls preload="metadata" src="${esc(j.video_url)}" aria-label="${esc(clipLabel(j))}"></video><div class="row wrap"><a class="button ghost small" href="${esc(j.video_url)}" ${j.video_url.startsWith('/') ? 'download' : 'target="_blank" rel="noopener"'}>Download / open clip</a>${ready ? `${!j.last_frame_url ? button('Capture last frame','capture-frame','secondary small',`data-id="${esc(j.id)}" ${!S.configured.video_tools ? 'disabled' : ''}`) : ''}${button('Continue from last frame','continue-clip','primary small',`data-id="${esc(j.id)}" ${!S.configured.video_tools ? 'disabled' : ''}`)}${button('Prepare for Discover','review-output','secondary small',`data-kind="job" data-id="${esc(j.id)}"`)}${button(added ? 'Added to scene' : 'Add to scene','add-clip','secondary small',`data-id="${esc(j.id)}" ${added ? 'disabled' : ''}`)}` : ''}</div>` : `<div class="video-wait">${active ? '<span class="spinner"></span>' : '<span class="gold" style="font-size:26px">▷</span>'}<p>${active ? 'Your clip is on its way.' : j.status==='COMPLETED' ? 'The video file has not been saved yet. Check status to retry downloading the result.' : 'No playable clip yet. Check the status for details.'}</p></div>`}
      ${j.last_frame_url ? `<div class="last-frame-result"><img src="${esc(j.last_frame_url)}" alt="Last frame of ${esc(clipLabel(j))}"><div><strong>Final frame saved</strong><p class="hint">Use this exact moment as the visual reference for your next segment.</p><a class="button ghost small" href="${esc(j.last_frame_url)}" download="${esc(j.id)}-last-frame.png">Download last frame</a></div></div>` : ''}
      ${summary.error ? notice(esc(summary.error),'error') : ''}${summary.cache_warning ? notice(esc(summary.cache_warning)) : ''}<details class="details"><summary>Prompt used for this clip</summary><div class="job-prompt">${esc(j.prompt)}</div></details></section>`;
    }).join('')}`;
}
function assemblyPage() {
  const ids=S.sequence.clip_ids;
  const ready=S.jobs.filter(j=>j.status==='COMPLETED' && j.video_url);
  const remaining=ready.filter(j=>!ids.includes(j.id));
  const exports=[...S.assemblies].reverse();
  const canCombine=ids.length>=2 && ids.every(id=>ready.some(j=>j.id===id)) && S.configured.video_tools;
  return heading('07 / THE SCENE','Turn your clips into a scene.','Arrange private drafts into an MP4, then use Prepare for Discover beside the finished scene to continue.',link('Video library','library','ghost small')) +
    (!S.configured.video_tools ? notice(isAdmin()?'Install the updated requirements and restart the app to enable scene export.':'Scene export is temporarily unavailable.') : '') +
    `<section class="panel sequence-panel"><div class="panel-title"><div><div class="subtle-label">YOUR ARRANGEMENT</div><h3>${ids.length} ${ids.length===1 ? 'clip' : 'clips'} in this scene</h3><p>Move clips up or down to choose the order.</p></div><span class="badge">MP4 export</span></div>${field('Scene name',S.sequence.name,'sequence_name',{placeholder:'Rainy street — Scene 1'})}
    <div class="sequence-list">${ids.map((id,index)=>{
      const j=S.jobs.find(j=>j.id===id);
      return `<div class="sequence-row"><span class="sequence-number">${String(index+1).padStart(2,'0')}</span><div class="sequence-thumb">${j?.last_frame_url ? `<img src="${esc(j.last_frame_url)}" alt="Clip ${index+1} preview">` : '<span>▷</span>'}</div><div class="sequence-info"><strong>${esc(j ? clipLabel(j) : 'Unavailable clip')}</strong><p>${j ? esc(j.prompt.slice(0,100)) : 'Restore the clip file to use it.'}</p>${j?.video_url ? `<a href="${esc(j.video_url)}" target="_blank" rel="noopener">View clip ↗</a>` : ''}</div><div class="sequence-controls">${button('↑','move-clip','ghost small',`data-index="${index}" data-direction="-1" aria-label="Move clip ${index+1} up" ${index===0 ? 'disabled' : ''}`)}${button('↓','move-clip','ghost small',`data-index="${index}" data-direction="1" aria-label="Move clip ${index+1} down" ${index===ids.length-1 ? 'disabled' : ''}`)}${button('Remove','remove-clip','ghost small',`data-index="${index}"`)}</div></div>`;
    }).join('') || '<div class="sequence-empty"><p>Add completed clips from your library to start building a scene.</p></div>'}</div>
    <div class="row wrap sequence-add"><label class="field"><span>Add a rendered clip</span><select id="sequence-clip-choice">${remaining.length ? remaining.map(j=>`<option value="${esc(j.id)}">${esc(clipLabel(j))}</option>`).join('') : '<option value="">No additional completed clips</option>'}</select></label>${button('Add clip','add-selected-clip','secondary',!remaining.length ? 'disabled' : '')}${link('Render next segment','render','ghost')}</div>
    <div class="row between wrap sequence-footer">${button('Save arrangement','save-sequence','secondary')}${button('Combine & export MP4 <span class="arrow">→</span>','combine-scene','primary',!canCombine ? 'disabled' : '')}</div>${adminInfo('<p class="hint">Exports use the first clip’s dimensions and preserve each clip’s audio. Combining runs on the app server without generation API calls.</p>')}</section>
    ${exports.length ? `<div class="section-heading"><h2>Your exported scenes</h2><p>Each export stays available when you change the arrangement.</p></div>${exports.map(a=>`<section class="panel job-card" id="assembly-${esc(a.id)}"><div class="row between wrap"><div><h3>${esc(a.name)}</h3><p class="job-meta">${a.clip_ids.length} clips · ${Number(a.duration_seconds).toFixed(1)} sec · ${a.width} × ${a.height} · ${esc(new Date(a.created).toLocaleString())}</p></div>${badge('completed')}</div>${a.video_url ? `<video controls preload="metadata" src="${esc(a.video_url)}" aria-label="${esc(a.name)}"></video><div class="row wrap">${button('Prepare for Discover →','review-output','primary small',`data-kind="assembly" data-id="${esc(a.id)}"`)}<a class="button secondary small" href="${esc(a.video_url)}?download=1">Download scene</a>${button('Load this arrangement','load-assembly','secondary small',`data-id="${esc(a.id)}"`)}${button('Continue this scene','continue-clip','ghost small',`data-id="${esc(a.clip_ids.at(-1))}"`)}</div>` : notice('The scene file is missing. Restore the video file or export the arrangement again.')}</section>`).join('')}` : ''}`;
}
function archivesPanel() {
  return `<section class="panel settings-section"><div class="panel-title"><div><h3>Your movies & saved versions</h3><p>Save named checkpoints for this movie. Each new movie gets its own workspace in My Studio.</p></div><a class="button ghost small" href="/api/projects/export">Export project database</a></div><div class="row wrap">${button('Save named version','archive-project','primary')}${button('Start a new movie','new-project','secondary')}</div>${S.archives.length ? `<hr><label class="field"><span>Saved movie versions</span><select id="archive-choice">${S.archives.map(a=>`<option value="${esc(a.id)}">${esc(a.name+' · '+new Date(a.created).toLocaleString())}</option>`).join('')}</select></label><div class="row wrap" style="margin-top:14px">${button('Restore selected version','restore-project','secondary')}${button('Rename selected version','rename-archive','ghost')}</div>` : '<p class="hint">Your named versions will appear here after you save a checkpoint.</p>'}${adminInfo('<p class="hint">Keep your full persistent data directory when updating the app to retain saved versions and media.</p>')}</section>`;
}

function settingsPage() {
  const prefs = S.settings;
  return heading('STUDIO SETTINGS','Make the studio work for you.','Choose your preferences and manage saved versions.') +
    `<section class="panel settings-section"><div class="panel-title"><div><h3>AI models</h3><p>Your selection applies immediately to new requests. Existing work stays saved.</p></div>${button('Refresh available models','refresh-models','ghost small',!S.configured.openai ? 'disabled' : '')}</div><form id="settings-form"><div class="field-grid"><label class="field"><span>GPT model for conversation and all text layers</span><select data-setting="model">${S.text_models.map(m=>`<option value="${esc(m)}" ${m===prefs.model ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label><label class="field"><span>Image model for character sheets</span><select data-setting="image_model">${S.image_models.map(m=>`<option value="${esc(m)}" ${m===prefs.image_model ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label><label class="field"><span>Image quality</span><select data-setting="image_quality">${['low','medium','high'].map(q=>`<option ${q===prefs.image_quality ? 'selected' : ''}>${q}</option>`).join('')}</select><div class="hint">Low is useful for drafts. Higher quality can cost more and take longer.</div></label>${adminInfo(field('Custom GPT model ID','','custom_model',{placeholder:'Optional exact API model ID'})+field('Custom image model ID','','custom_image_model',{placeholder:'Optional GPT Image model ID',full:true}))}</div><button class="button primary" type="submit">Save model preferences</button></form>${adminInfo('<p class="hint">Refresh loads models available to the server API account. Preferences are saved for each project.</p>')}</section>
    ${videoSettingsPanel()}
    ${archivesPanel()}
    ${adminInfo(`<section class="panel settings-section"><div class="panel-title"><div><h3>Connections</h3><p>API keys are read from your server environment or local .env file.</p></div></div><div class="grid-two"><div><div class="row between"><h3 style="font-size:13px">OpenAI</h3>${badge(S.configured.openai ? 'configured' : 'Missing key')}</div><p class="hint">Used for the conversation, voice transcription, creative drafts, and character-sheet images.</p></div><div><div class="row between"><h3 style="font-size:13px">Runway Developer</h3>${badge(S.configured.runway ? 'configured' : 'Missing credentials')}</div><p class="hint">Used for the video models in the Runway catalog.</p></div></div><details class="details" ${!S.configured.openai || !S.configured.runway ? 'open' : ''}><summary>Connection setup</summary><p class="hint" style="margin-bottom:12px">Copy .env.example to .env, add your own keys, and restart with python app.py. Keys never appear in the model menus.</p><pre class="config-line">OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=${esc(prefs.model)}
OPENAI_IMAGE_MODEL=${esc(prefs.image_model)}
RUNWAYML_API_SECRET=your_runway_developer_key</pre><p class="hint">OpenAI API usage is separate from your ChatGPT subscription. Runway video generation uses your Runway Developer project credits. This local test server supports separate creator accounts and private projects. All paid requests use the server owner’s API accounts.</p></details></section>`)}`;
}
function activityPage() {
  return heading('YOUR CREATIVE DECISIONS','A record of your direction.','Keep track of the ideas, edits, approvals, and choices you made.') +
    `<section class="panel"><form id="activity-form">${field('What did you creatively change or choose?','','note',{area:true,placeholder:'I changed the ending so the rival chooses to walk away instead of fighting.'})}<button class="button secondary" style="margin-top:14px">Record creative decision</button></form><hr>${S.actions.length ? S.actions.map(a=>`<div class="timeline-entry"><time>${esc(new Date(a.created).toLocaleDateString())}<br>${esc(new Date(a.created).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))}</time><div><strong>${esc(a.layer)}</strong><p>${esc(a.description)}</p></div></div>`).join('') : '<p class="hint">Your creative decisions will appear as you work on your movie.</p>'}${adminInfo('<p class="hint" style="margin-top:20px">Creative contribution records do not determine legal copyright ownership.</p><a class="button secondary small" href="/api/projects/benchmark.csv">Export sponsor test log (CSV)</a><p class="hint">Includes app task timings, saved video jobs and newly recorded API usage. Estimates require reconciliation with provider billing. Realtime voice usage is not fully metered here.</p>')}</section>`;
}
function render() {
  if (!S) return;
  const notes = page===document.body.dataset.studioPage ? $('[data-group="revision"]')?.value : null;
  renderShell();
  const views={overview,source:sourcePage,share:sharePage,idea,brief,characters,script:scriptPage,shots:shotsPage,render:renderPage,library:libraryPage,assembly:assemblyPage,settings:settingsPage,activity:activityPage};
  $('#main').innerHTML=(views[page] || overview)();
  const revisionField = $('[data-group="revision"]');
  if (revisionField && notes != null) revisionField.value = notes;
  applyDraftLocks();
  if((S.tasks||[]).some(t=>t.kind==='operation'&&['queued','running'].includes(t.status))){
    $$('#main input, #main textarea, #main select, #main button').forEach(e=>{if(e.id!=='platform-project'&&!['source-read','cancel-draft'].includes(e.dataset.action))e.disabled=true;});
  }
  if(bookAnalysisRunning)$$('#main input, #main textarea, #main select, #main button').forEach(e=>{if(e.dataset.action!=='source-stop')e.disabled=true;});
  if (page==='idea') {const thread=$('#chat-thread');thread.scrollTop=thread.scrollHeight;AIMVoice.update();}
  if (page==='render') updateVideoPricing();
}
function collectFields(root) {
  return Object.fromEntries($$('[data-field]',root).filter(e=>e.dataset.group!=='revision').map(e=>[e.dataset.field,e.value]));
}
function collectBrief() {
  const updated={...clone(S.vision),...collectFields($('#brief-form'))};
  for (const field of ['themes','creative_decisions']) updated[field]=String(updated[field] || '').split('\n').map(s=>s.trim()).filter(Boolean);
  updated.duration_seconds=Number(updated.duration_seconds) || 30;
  return updated;
}
function collectScript() {
  const script=clone(draftEdit.value);script.scenes ||= [];
  $$('[data-group="script"]').forEach(e=>script[e.dataset.field]=e.value);
  $$('[data-group="scene"]').forEach(e=>script.scenes[Number(e.dataset.index)][e.dataset.field]=e.value);
  $$('[data-dialogue]').forEach(e=>script.scenes[Number(e.dataset.scene)].dialogue[Number(e.dataset.line)][e.dataset.dialogue]=e.value);
  return script;
}
function collectShots() {
  const director=clone(draftEdit.value);director.shots ||= [];
  $$('[data-group="shot"]').forEach(e=>{
    let v=e.value;if(e.dataset.field==='duration_seconds') v=Number(v);
    if(e.dataset.field==='characters') v=v.split(',').map(s=>s.trim()).filter(Boolean);
    const shot=director.shots[Number(e.dataset.index)],field=e.dataset.field;
    if (['duration_seconds','on_screen_action'].includes(field) && shot[field]!==v) delete shot.duration_reason;
    shot[field]=v;
  });return director;
}
async function saveDraft(stage) {
  if (draftEdit?.stage !== stage) return;
  if (!draftEdit.newCharacter && !draftEdit.structureChanged &&
      draftFieldValues(stage).every((value,index)=>value===draftEdit.initial[index])) {
    closeDraft(stage);
    return;
  }
  const editor=draftEditors[stage],invalid=$$(editor.fields).find(field=>!field.checkValidity());
  if (invalid) {
    const details=invalid.closest('details');if(details)details.open=true;
    invalid.reportValidity();
    return;
  }
  const saved = await run('Saving your '+editor.label+'…',async()=>{
    if (stage==='characters') {
      const values=collectFields($('#character-form'));
      values.use_as_reference=$('[name="character-reference-use"]:checked').value==='reference';
      if (draftEdit.newCharacter) {
        await api('characters',values);
        currentCID=S.characters.at(-1).id;
      } else await api('characters/'+currentCID,values);
    } else if (stage==='shot-model') {
      const model=$('#shot-planning-model').value;
      const settings=model==='alibaba' ? {video_provider:'alibaba'} : {video_provider:'runway',runway_model:model.slice(7)};
      await api('settings',settings);
    } else if (stage==='render') {
      await api('render/save',renderOptions());
      renderReviewErrors=[];
    } else {
      const collect={vision:collectBrief,script:collectScript,director:collectShots}[stage];
      await api('save/'+stage,collect());
    }
    draftEdit=null;
  },{message:'Changes saved.'});
  if(saved)focusDraftControl(stage);
}
function changeDraftStructure(stage, change) {
  if (!draftEdit) startDraft(stage);
  if (draftEdit?.stage !== stage) return;
  const draft=stage==='script' ? collectScript() : collectShots();
  change(draft);
  draftEdit.value=draft;
  draftEdit.structureChanged=true;
  setDirty(true);
  render();
}
function sequenceOptions() {
  return {name:$('[data-field="sequence_name"]').value.trim() || 'Untitled scene',clip_ids:[...S.sequence.clip_ids]};
}
function renderOptions() {
  const prefs=S.settings;
  return {prompt:$('[data-field="render_prompt"]').value,duration:Number($('#render-duration').value),video_provider:prefs.video_provider,...Object.fromEntries(['wan_resolution','wan_mode','wan_start_slot','wan_audio','wan_prompt_extend','runway_model','runway_mode','runway_start_slot','runway_ratio','runway_resolution','runway_audio','runway_seed'].map(k=>[k,prefs[k]]))};
}
async function confirmAction(title,copy,label='Continue',inputOptions=null) {
  $('#confirm-title').textContent=title;$('#confirm-copy').textContent=copy;$('#confirm-button').textContent=label;
  $('#confirm-input-wrap').hidden=!inputOptions;
  if(inputOptions){$('#confirm-input-label').textContent=inputOptions.label || 'Version name';$('#confirm-input').value=inputOptions.value || '';$('#confirm-input').placeholder=inputOptions.placeholder || 'Give this version a name';}
  const dialog=$('#confirm-dialog');dialog.returnValue='';dialog.showModal();
  if(inputOptions)$('#confirm-input').focus();
  return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(inputOptions ? dialog.returnValue==='confirm' ? $('#confirm-input').value.trim() : null : dialog.returnValue==='confirm'),{once:true}));
}
async function generate(stage) {
  const dest={vision:'brief',characters:'characters',script:'script',director:'shots'}[stage];
  const revision=$('[data-group="revision"]');
  if(page==='idea' && $('#chat-message')?.value.trim()) return toast('Send your latest message first so the brief includes it.',true);
  await run('MIA is creating your '+({vision:'creative brief',characters:'character profiles',script:'screenplay',director:'shot plan'}[stage])+'…',async()=>{
    await api('generate/'+stage,{instructions:revision?.value || ''});
    if (revision) revision.value='';
  },{dest,copy:'MIA is using '+S.settings.model+'. Review the draft before continuing.'});
}
async function approveStep(stage) {
  const dest={vision:'characters',characters:'script',script:'shots',director:'render'}[stage];
  await run('Saving your creative choices…',async()=>{
    await api('approve/'+stage,{});
    if(stage==='vision' && !S.characters.length && S.configured.openai && S.platform.paid_enabled) await api('generate/characters',{});
    if(stage==='director' && S.director.shots?.length && !S.render_prompt) await api('render/compile',{shot_id:S.director.shots[0].id});
  },{dest,message:'Creative choices saved.'});
}
async function handleAction(action,el) {
  if(studioDashboardAction(action,el))return;
  if(action==='source-stop')return platformAction(action,el);
  if(busy || bookAnalysisRunning) return;
  if(AIMVoice.active() && !action.startsWith('voice-') && !['clear-conversation','clear-composer'].includes(action))return toast('Stop your voice conversation before changing the project.',true);
  if (draftEdit && !['save-draft','cancel-draft'].includes(action) && el.dataset.draftOperation!==draftEdit.stage) return;
  if(await renderReviewAction(action,el))return;
  if(await creationAction(action,el))return;
  if(await platformAction(action,el))return;
  if(action.startsWith('generate-') && ['vision','characters','script','director'].includes(action.slice(9))) return generate(action.slice(9));
  if(action.startsWith('approve-')) return approveStep(action.slice(8));
  switch(action) {
    case 'clear-composer':$('#chat-message').value='';setDirty(false);$('#chat-message').focus();return;
    case 'clear-conversation':
      if(await confirmAction('Start a new conversation?','This clears the conversation. Your existing drafts, character images and videos stay saved.','Clear conversation')){
        conversationError='';conversationStarter='idea';
        await AIMVoice.stop();return run('Clearing your conversation…',()=>api('chat/clear',{confirm:true}),{dest:'idea',message:'Conversation cleared.'});
      }return;
    case 'voice-start':return AIMVoice.begin();
    case 'voice-stop':return AIMVoice.stop();
    case 'voice-mute':return AIMVoice.toggleMute();
    case 'voice-type':return AIMVoice.typeInstead();
    case 'voice-interrupt':return AIMVoice.interrupt();
    case 'voice-cancel':return AIMVoice.cancel();
    case 'voice-read-last':return AIMVoice.speakLast();
    case 'voice-stop-reading':return AIMVoice.stopPlayback();
    case 'edit-draft': return startDraft(el.dataset.stage);
    case 'save-draft': return saveDraft(el.dataset.stage);
    case 'cancel-draft':
      if (draftEdit?.stage===el.dataset.stage) closeDraft(el.dataset.stage);
      return;
    case 'select-character':
      if(dirty && !window.confirm('You have unsaved edits. Switch characters without saving them?')) return;
      currentCID=el.dataset.id;setDirty(false);render();return;
    case 'add-character': return startDraft('characters',true);
    case 'delete-character':
      if(await confirmAction('Remove this character?','The character will leave this movie’s cast. Existing image files and archived projects will remain available.','Remove character')) return run('Updating the cast…',()=>api('characters/'+el.dataset.id+'/delete',{}),{message:'Character removed.'});return;
    case 'skip-characters':
      return run('Saving your direction…',()=>api('characters/skip',{}),{dest:'script'});
    case 'generate-image':case 'edit-image': {
      const instructions=$('#image-correction')?.value || '';
      if(action==='edit-image' && !instructions.trim()) return toast('Describe what you want to change in the image.',true);
      return run(action==='edit-image' ? 'Refining the character sheet…' : 'Generating the character sheet…',
        ()=>api('characters/'+currentCID+'/image',{mode:action==='edit-image' ? 'edit' : 'generate',instructions}),
        {copy:'This uses '+S.settings.image_model+'. Image generation can take a few minutes.',message:'New image version saved.'});
    }
    case 'select-image': return run('Selecting an image version…',()=>api('characters/'+currentCID+'/select-image',{image_id:el.dataset.id}));
    case 'assign-ref': return run('Selecting the video reference…',()=>api('references/'+el.dataset.slot,{character_id:currentCID}),{message:'Video reference selected.'});
    case 'ensemble-ref': return run('Selecting the cast reference…',()=>api('references/'+el.dataset.slot,{kind:'ensemble'}),{message:'Cast sheet selected.'});
    case 'select-ensemble-image': return run('Selecting a cast-sheet version…',()=>api('ensemble/select-image',{image_id:el.dataset.id}));
    case 'edit-ensemble': {
      const instructions=$('[data-field="ensemble_correction"]').value.trim();
      if(!instructions) return toast('Describe the cast-sheet correction first.',true);
      return run('Refining the cast sheet…',()=>api('ensemble',{mode:'edit',instructions}),{copy:'Editing the current cast sheet. This may take a few minutes.',message:'New cast-sheet version saved.'});
    }
    case 'clear-ref': return run('Clearing the reference…',()=>api('references/'+el.dataset.slot,{clear:true}));
    case 'ensemble': return run('Building the combined cast sheet…',()=>api('ensemble',{}),{copy:'Your edited cast and selected images guide this sheet. It may take a few minutes.',message:'Combined cast sheet saved.'});
    case 'retry-chat': {
      await sendConversation('',true);return;
    }
    case 'example': {
      const examples=['Two rivals face off on a rainy neon street. One charges forward while the other dodges at the last second.','A student finds out their ordinary neighbor is secretly protecting the city.'];
      $('#chat-message').value=examples[Number(el.dataset.index)];$('#chat-message').focus();setDirty(true);return;
    }
    case 'add-scene': return changeDraftStructure('script',draft=>{
      draft.title ||= S.vision.title || 'Untitled movie';
      draft.scenes.push({id:'S'+Date.now(),title:'New scene',location:'',time:'',purpose:'',action:'',dialogue:[]});
    });
    case 'remove-scene': return changeDraftStructure('script',draft=>{
      draft.scenes.splice(Number(el.dataset.index),1);
    });
    case 'add-dialogue': return changeDraftStructure('script',draft=>{
      const scene=draft.scenes[Number(el.dataset.index)];
      scene.dialogue ||= [];
      scene.dialogue.push({speaker:'',line:''});
    });
    case 'remove-dialogue': return changeDraftStructure('script',draft=>{
      draft.scenes[Number(el.dataset.index)].dialogue.splice(Number(el.dataset.line),1);
    });
    case 'add-shot': return changeDraftStructure('director',draft=>{
      draft.shots.push({id:'SH'+Date.now(),scene_id:S.script.scenes?.[0]?.id || 'S1',duration_seconds:fitVideoDuration(5),
        shot_type:'New shot',camera:'',on_screen_action:'',characters:[],sound:'',continuity:'',prompt:''});
    });
    case 'remove-shot': return changeDraftStructure('director',draft=>{
      draft.shots.splice(Number(el.dataset.index),1);
    });
    case 'compile-shot':
      if(S.render_prompt_custom && !await confirmAction('Replace these video instructions?','The selected scene and its references will become the new video instructions.','Update instructions')) return;
      return run('Building the video instructions…',async()=>{await api('render/compile',{shot_id:$('#render-shot').value});renderReviewErrors=[];},{message:'Scene ready to review.'});
    case 'use-text-only':return changeVideoOption({dataset:{videoOption:S.settings.video_provider==='alibaba'?'wan_mode':'runway_mode'},value:'text',type:'select-one'});
    case 'use-image-references':return changeVideoOption({dataset:{videoOption:S.settings.video_provider==='alibaba'?'wan_mode':'runway_mode'},value:'reference',type:'select-one'});
    case 'choose-text-model':return changeVideoModel('gen4.5','text');
    case 'choose-reference-model':return changeVideoModel('wan3','reference');
    case 'create-first-frame':return run('Creating your starting frame…',()=>api('render/first-frame',{}),{message:'Starting frame ready.'});
    case 'submit-render': {
      if(renderPreflightBusy)return;
      renderPreflightBusy=true;updateRenderReview();
      try {
      const workspace=S.workspace_id,options=renderOptions();const r=await AIMTasks.request('render/preflight',{method:'POST',headers:{'Content-Type':'application/json','X-AIM-Token':token,'X-Workspace-ID':workspace},body:JSON.stringify(options)},workspace);
      if(page!=='render'||S.workspace_id!==workspace||draftEdit)return;
      if(JSON.stringify(renderOptions())!==JSON.stringify(options))return toast('Your video settings changed. Review them and choose Generate video again.');
      const checks=await r.json();if(!r.ok)throw new Error(checks.error||'The preflight check failed.');
      if(checks.errors.length){renderReviewErrors=checks.errors;await api('state');render();reviewReveal('review-submit-errors');return;}
      const quote=checks.estimate?.estimated_cost_usd;const copy=[quote!=null?'Estimated cost: $'+Number(quote).toFixed(2)+'. Final billing may differ.':'The final cost will be billed by the video provider.',reviewMode()==='first_frame'?'Your video will begin with the opening image you confirmed.':'Your video will use the scene and image-use settings shown on the review page.',...(checks.warnings||[]),'Generate this video now?'].filter(Boolean).join('\n\n');
      if(!await confirmAction('Generate this video?',copy,'Generate video'))return;
      if(page!=='render'||S.workspace_id!==workspace||draftEdit||JSON.stringify(renderOptions())!==JSON.stringify(options))return toast('Your project or video settings changed. Review the video before generating.');
      return await run('Submitting your clip…',()=>api('render/submit',options),{dest:'library',message:'Render submitted.'});
      }finally{renderPreflightBusy=false;updateRenderReview();}
    }
    case 'refresh-job':return run('Checking your render…',()=>api('jobs/'+el.dataset.id+'/refresh',{}));
    case 'refresh-models':return run('Loading available models…',()=>api('models/refresh',{}),{message:'Model list updated for your API account.'});
    case 'capture-frame':return run('Capturing the final frame…',()=>api('jobs/'+el.dataset.id+'/last-frame',{}),{copy:'Reading the completed video on your computer.',message:'Final frame saved.'});
    case 'continue-clip':return run('Preparing the next segment…',()=>api('jobs/'+el.dataset.id+'/continue',{}),{dest:'render',copy:'Capturing the last frame and setting the continuity reference.',message:'Describe what happens next, then build the prompt.'});
    case 'compile-continuation': {
      const next_action=$('[data-field="next_action"]').value.trim();
      if(!next_action)return toast('Describe what happens next first.',true);
      return run('Building your continuation prompt…',()=>api('render/continuation',{next_action}),{message:'Next segment ready to review.'});
    }
    case 'add-clip':return run('Adding the clip to your scene…',()=>api('sequence/add',{job_id:el.dataset.id}),{message:'Clip added. Open Scene builder to arrange and export.'});
    case 'add-selected-clip': {
      const value=sequenceOptions();value.clip_ids.push($('#sequence-clip-choice').value);
      return run('Adding the clip…',()=>api('sequence',value));
    }
    case 'move-clip': {
      const value=sequenceOptions(),index=Number(el.dataset.index),other=index+Number(el.dataset.direction);
      [value.clip_ids[index],value.clip_ids[other]]=[value.clip_ids[other],value.clip_ids[index]];
      return run('Saving the clip order…',()=>api('sequence',value));
    }
    case 'remove-clip': {
      const value=sequenceOptions();value.clip_ids.splice(Number(el.dataset.index),1);
      return run('Updating the scene…',()=>api('sequence',value));
    }
    case 'save-sequence':return run('Saving your arrangement…',()=>api('sequence',sequenceOptions()),{message:'Scene arrangement saved.'});
    case 'combine-scene': {
      const success=await run('Combining your scene…',()=>api('sequence/combine',sequenceOptions()),{copy:'Joining the selected clips and their audio on your computer. This can take a few minutes.',message:'Scene exported. Preview it, then use Prepare for Discover to continue.'});
      if(success){const latest=S.assemblies.at(-1);if(latest)$('#assembly-'+latest.id)?.scrollIntoView?.({block:'start',behavior:'smooth'});}return;
    }
    case 'load-assembly': {
      const a=S.assemblies.find(a=>a.id===el.dataset.id);
      return run('Loading the scene arrangement…',()=>api('sequence',{name:a.name,clip_ids:a.clip_ids}),{message:'Arrangement loaded.'});
    }
    case 'archive-project': {
      const name=await confirmAction('Save a version of this movie?','Your conversation, creative choices, and clip arrangement will be saved. Your current movie stays open.','Save version',{value:S.vision.title || 'Untitled movie'});
      if(name!==null)return run('Saving your named version…',()=>api('projects/archive',{name}),{message:'Version saved. Keep creating in your current workspace.'});return;
    }
    case 'rename-archive': {
      const archive=$('#archive-choice').value;
      const selected=S.archives.find(a=>a.id===archive);
      const name=await confirmAction('Rename this saved version?','The saved movie and its files keep their identity.','Save name',{value:selected.name});
      if(name!==null)return run('Renaming the saved version…',()=>api('projects/rename',{archive,name}),{message:'Version renamed.'});return;
    }
    case 'new-project': {
      const name=await confirmAction('Start a new movie','Give your new project a name. Your existing movies will stay in My Studio.','Create movie',{label:'Movie name',value:'',placeholder:'Untitled movie'});
      if(name!==null)return run('Creating your movie…',async()=>{
        const result=await portalRequest('platform/projects',{name:name||'Untitled movie'});
        setDirty(false);location.href=result.url||'/idea';
      },{repaint:false});return;
    }
    case 'restore-project': {
      const archive=$('#archive-choice').value;
      const archive_label=await confirmAction('Restore this movie?','Your current workspace will be archived first. Give it a name before opening the selected version.','Restore movie',{label:'Name for the current version',value:S.vision.title || 'Untitled movie'});
      if(archive_label!==null)return run('Opening your saved movie…',async()=>{await api('projects/restore',{archive,archive_label});currentCID=null;},{dest:'overview',message:'Movie restored.'});return;
    }
  }
}
document.addEventListener('click',event=>{
  const nav=event.target.closest('[data-nav]');
  if(nav && !event.metaKey && !event.ctrlKey){event.preventDefault();navigate(nav.dataset.nav);return;}
  const action=event.target.closest('[data-action]');
  if(action){event.preventDefault();handleAction(action.dataset.action,action).catch(error=>toast(error.message,true));}
});
document.addEventListener('input',event=>{
  if(page!=='overview' && event.target.matches('#main input:not([type=file]), #main textarea, #main select') && !event.target.dataset.videoOption && !['archive-choice','sequence-clip-choice','voice-read-replies'].includes(event.target.id)) setDirty(true);
  if(event.target.matches?.('[data-field="render_prompt"]'))updateVideoPricing();
  if(event.target.id==='render-duration') {$('#duration-value').textContent=event.target.value+'s';updateVideoPricing();}
});
document.addEventListener('change',async event=>{
  const input=event.target;
  if(input.id==='studio-sort') {studioDisplay.sort=['recent','oldest','title'].includes(input.value)?input.value:'recent';render();$('#studio-sort').focus();return;}
  if(input.name==='source'&&input.closest('#share-form')){changeReviewSource(input);return;}
  if(input.id==='platform-project'){if(dirty&&!window.confirm('Switch projects and discard unsaved edits?'))return;await AIMVoice.stop();await portalRequest('platform/projects/select',{id:input.value});location.href='/overview';return;}
  if(draftEdit)return;
  if(input.hasAttribute('data-runway-quality')){await changeRunwayQuality(input);return;}
  if(input.dataset.videoOption){await changeVideoOption(input);return;}
  if(input.id==='voice-read-replies'){
    await run('Saving spoken reply preferences…',()=>api('settings',{speak_replies:input.checked}),{repaint:false,keepDirty:true});
    if(!S.settings.speak_replies)AIMVoice.stopPlayback();return;
  }
  if(input.id==='global-model') {
    const model=input.value;
    await run('Switching GPT model…',async()=>{
      const local=S;const next=await api('settings',{model});
      S={...local,settings:next.settings,text_models:next.text_models,image_models:next.image_models};
    },{repaint:false,keepDirty:true,message:'GPT model changed for future text requests.'});return;
  }
  if(!input.dataset.upload || !input.files[0]) return;
  const upload=input.dataset.upload;
  const data=new FormData();data.append('file',input.files[0]);
  data.append('kind',upload==='character-photo' ? 'photo' : 'sheet');
  await run('Saving the image…',
    ()=>api(upload==='reference' ? 'references/'+input.dataset.slot+'/upload' : 'characters/'+currentCID+'/upload',data),
    {message:'Image uploaded and saved.'});
});
document.addEventListener('submit',async event=>{
  if(event.target.closest('dialog')) return;
  event.preventDefault();
  const id=event.target.id;
  try{if(await platformSubmit(event.target))return;}catch(e){toast(e.message,true);return;}
  if(id==='chat-form') {
    const text=$('#chat-message').value.trim();if(!text)return;
    if(AIMVoice.active()){if(AIMVoice.typed(text)){$('#chat-message').value='';setDirty(false);}return;}
    await sendConversation(text);
  }
  if(id==='settings-form') {
    const updates=Object.fromEntries($$('[data-setting]').map(e=>[e.dataset.setting,e.value]));
    const custom=($('[data-field="custom_model"]')?.value||'').trim();if(custom) updates.model=custom;
    const image=($('[data-field="custom_image_model"]')?.value||'').trim();if(image) updates.image_model=image;
    await run('Saving model preferences…',()=>api('settings',updates),{message:'Model preferences saved.'});
  }
  if(id==='video-settings-form'){
    const updates=Object.fromEntries($$('[data-video-setting]').map(e=>[e.dataset.videoSetting,e.value]));
    await run('Saving video provider settings…',()=>api('settings',updates),{message:'Video provider settings saved.'});
  }
  if(id==='activity-form')await run('Saving your creative decision…',()=>api('activity',{note:$('[data-field="note"]').value}),{message:'Creative decision recorded.'});
});
document.addEventListener('keydown',event=>{
  if(event.target.id==='chat-message' && event.key==='Enter' && !event.shiftKey && !event.isComposing && event.keyCode!==229 && !event.repeat) {event.preventDefault();if(!busy)$('#chat-form').requestSubmit();}
});
$('#menu-toggle').addEventListener('click',()=>{const open=$('#sidebar').classList.toggle('open');$('#menu-toggle').setAttribute('aria-expanded',String(open));});
window.addEventListener('popstate',async()=>{
  if(busy || (dirty || AIMVoice.active()) && !window.confirm('Leave this page? Unsaved edits and any current recording will be discarded.')) {history.pushState({},'', '/'+page);return;}
  await AIMVoice.cancel();AIMVoice.stopPlayback();
  const next=location.pathname.slice(1) || 'overview';
  if(next==='overview' || S?.dashboard) {
    try { await api(next==='overview'?'platform/dashboard':'state'); }
    catch(error) { history.replaceState({},'','/'+page);toast(error.message,true);return; }
  }
  page=next;draftEdit=null;setDirty(false);render();
});
window.addEventListener('beforeunload',event=>{if(dirty || busy || bookAnalysisRunning || AIMVoice.active()){event.preventDefault();event.returnValue='';}});
document.addEventListener('aim:tasks',async event=>{
 if(!S)return;
 const local=event.detail.items.filter(t=>t.project_id===S.platform.project_id);const old=JSON.stringify((S.tasks||[]).map(t=>[t.id,t.status,t.progress]));
 S.tasks=local;AIMTasks.showBar(local);
 if(!event.detail.initial&&old!==JSON.stringify(local.map(t=>[t.id,t.status,t.progress]))&&!busy&&!dirty&&!draftEdit&&!AIMVoice.active()){
  try{await api(page==='overview'?'platform/dashboard':'state');if(!draftEdit&&!dirty)render();}catch{}
 }
});
document.addEventListener('aim:resume',async()=>{if(S&&!dirty&&!draftEdit&&!busy&&!AIMVoice.active()){try{await api(page==='overview'?'platform/dashboard':'state');if(!draftEdit&&!dirty)render();}catch{}}});
// STUDIO_STARTUP
api(page==='overview'?'platform/dashboard':'state').then(()=>render()).catch(error=>{
  $('#main').innerHTML=`<div class="empty-state"><h2>The studio could not open.</h2><p>${esc(error.message)}</p><button class="button primary" onclick="location.reload()">Try again</button></div>`;
});
