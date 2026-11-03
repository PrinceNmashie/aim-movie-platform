'use strict';
function isAdmin(){return S?.platform?.user?.role==='admin';}
function adminInfo(html){return isAdmin()?html:'';}
function usd(n,digits=2){return n==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:digits,maximumFractionDigits:digits}).format(n);}
function runwayModel(){return S.providers.runway_models.find(m=>m.id===S.settings.runway_model);}
function runwaySpec(){return runwayModel()?.modes[S.settings.runway_mode];}
function durationChoices(provider=S.settings.video_provider){return provider==='alibaba'?Array.from({length:29},(_,i)=>i+2):(runwaySpec()?.durations||[]);}
function fitVideoDuration(value){const choices=durationChoices();return choices.reduce((best,n)=>Math.abs(n-value)<Math.abs(best-value)?n:best,choices[0]);}
function videoCost(provider,seconds){
 const p=S.settings,c=S.providers;if(!durationChoices(provider).includes(seconds))return{total:null,rate:null,credits:null};
 if(provider==='alibaba'){const rate=c.rates_by_region[p.wan_region]?.[p.wan_resolution];return{total:rate==null?null:rate*seconds,rate,credits:null};}
 const price=c.runway_price,raw=Math.max(price.minimum_credits,seconds*price.credits_per_second+price.input_credits);
 const credits=price.round_up?Math.ceil(Math.ceil(raw)*price.discount):Math.round(raw*price.discount*1e6)/1e6;
 return{rate:price.credits_per_second*price.discount*c.runway_credit_usd,total:credits*c.runway_credit_usd,credits};
}
function videoReady(){
 const p=S.settings;
 if(p.video_provider==='runway')return S.configured.runway&&!!runwaySpec()&&(p.runway_mode==='text'||(p.runway_mode==='reference'?!!(S.references.ref_a.url||S.references.ref_b.url):!!S.references[p.runway_start_slot]?.url));
 return S.configured.alibaba&&(p.wan_mode==='text'||(p.wan_mode==='first_frame'?!!S.references[p.wan_start_slot]?.url:!!(S.references.ref_a.url||S.references.ref_b.url)));
}
function sizeLabel(value){return frameFormat(value);}
function frameFormat(value){
 if(value.startsWith('auto_')||value==='adaptive')return 'Match image';
 const [w,h]=value.split(':').map(Number),n=w/h;
 const formats=[[16/9,'Landscape · 16:9'],[9/16,'Portrait · 9:16'],[1,'Square · 1:1'],[4/3,'Classic · 4:3'],[3/4,'Portrait · 3:4'],[21/9,'Cinema · 21:9'],[3/2,'Landscape · 3:2'],[2/3,'Portrait · 2:3']];
 return formats.reduce((best,item)=>Math.abs(item[0]-n)<Math.abs(best[0]-n)?item:best,formats[0])[1];
}
function ratioTier(r,index,model){
 if(r.startsWith('auto_'))return r.slice(5);
 if(['gen4.5','gen4_turbo','gemini_omni_flash','kling3.0_standard','klingO3_standard'].includes(model))return '720p';
 if(['kling3.0_pro','klingO3_pro'].includes(model))return '1080p';
 if(model==='kling2.5_turbo_pro')return index<3?'1080p':'720p';
 if(model.endsWith('_4k'))return '2160p';
 if(model.startsWith('seedance2'))return ['480p','720p','1080p','2160p'][Math.floor(index/6)];
 if(['wan3','wan3_prime'].includes(model))return ['480p','720p','1080p'][Math.min(Math.floor(index/5),2)];
 if(model==='grok_imagine_1_5_lite')return ['480p','720p','1080p'][Math.min(Math.floor(index/7),2)];
 if(model==='gemini_omni_flash_1.1')return ['360p','720p','1080p','2160p'][Math.min(Math.floor(index/2),3)];
 if(model==='happyhorse_1_0')return index<5?'720p':'1080p';
 if(model==='kling_4')return ['1920:1080','1080:1920','1440:1440','2200:940'].includes(r)?'1080p':'720p';
 const nums=r.split(':').map(Number);return Math.max(...nums)>=1920?'1080p':'720p';
}
function runwayQualityGroups(){
 const model=runwayModel(),spec=runwaySpec(),groups=new Map();
 if(spec.resolutions.length)return spec.resolutions.map(q=>({id:q,ratios:spec.ratios}));
 spec.ratios.forEach((r,i)=>{const quality=ratioTier(r,i,model.id);if(!groups.has(quality))groups.set(quality,[]);groups.get(quality).push(r);});
 return [...groups].map(([id,ratios])=>({id,ratios}));
}
function runwayOptions(){
 const p=S.settings,spec=runwaySpec(),model=runwayModel(),makers=[...new Set(S.providers.runway_models.map(m=>m.maker))];
 const groups=runwayQualityGroups(),quality=spec.resolutions.length?p.runway_resolution:groups.find(g=>g.ratios.includes(p.runway_ratio))?.id;
 const ratios=(groups.find(g=>g.id===quality)?.ratios||spec.ratios);
 const labels={reference:'Character references',first_frame:'Opening image',text:'Text only'};
 return `<div class="field-grid provider-options"><label class="field"><span>Model</span><select data-video-option="runway_model">${makers.map(maker=>`<optgroup label="${esc(maker)}">${S.providers.runway_models.filter(m=>m.maker===maker).map(m=>`<option value="${m.id}" ${m.id===p.runway_model?'selected':''}>${esc(m.name)}</option>`).join('')}</optgroup>`).join('')}</select></label><label class="field"><span>Image use</span><select data-video-option="runway_mode">${Object.keys(model.modes).sort((a,b)=>({reference:0,first_frame:1,text:2}[a]-{reference:0,first_frame:1,text:2}[b])).map(mode=>`<option value="${mode}" ${mode===p.runway_mode?'selected':''}>${labels[mode]}</option>`).join('')}</select></label>${groups.length?`<label class="field"><span>Quality</span><select data-runway-quality>${groups.map(g=>`<option value="${g.id}" ${g.id===quality?'selected':''}>${g.id==='2k'?'2K':g.id}</option>`).join('')}</select></label>`:''}${ratios.length?`<label class="field"><span>Format</span><select data-video-option="runway_ratio">${ratios.map(r=>`<option value="${r}" ${r===p.runway_ratio?'selected':''}>${frameFormat(r)}</option>`).join('')}</select></label>`:''}${p.runway_mode==='first_frame'?`<label class="field"><span>Opening image</span><select data-video-option="runway_start_slot"><option value="ref_a" ${p.runway_start_slot==='ref_a'?'selected':''}>Image 1</option><option value="ref_b" ${p.runway_start_slot==='ref_b'?'selected':''}>Image 2</option></select></label>`:''}${isAdmin()&&spec.seed?`<details class="full"><summary>Advanced</summary><label class="field"><span>Seed</span><input type="number" min="0" max="4294967295" step="1" data-video-option="runway_seed" value="${p.runway_seed??''}" placeholder="Random"></label></details>`:''}</div>${p.runway_mode==='reference'?'<p class="reference-mode-note">Your images guide character identity and style. They won’t be used as the opening frame.</p>':p.runway_mode==='first_frame'?'<p class="reference-mode-note">Your video begins with the selected image. Choose a single scene image, not a character sheet.</p>':''}${!model.modes.reference?'<button type="button" class="button ghost small" data-action="choose-reference-model">Use character references instead</button>':''}${spec.audio_toggle?`<label class="check"><input type="checkbox" data-video-option="runway_audio" ${p.runway_audio?'checked':''}>Generate sound</label>`:''}${adminInfo(`<p class="hint">Runway Developer · ${esc(p.runway_model)} · ${spec.durations.join(', ')} seconds · ${spec.prompt_max} character limit.</p>`)}<p class="image-credit"><a href="https://runwayml.com" target="_blank" rel="noopener">Powered by Runway ↗</a></p>`;
}
async function changeRunwayQuality(input){
 const group=runwayQualityGroups().find(g=>g.id===input.value);if(!group)return;
 const old=S.settings.runway_ratio,oldFormat=frameFormat(old),ratio=group.ratios.find(r=>frameFormat(r)===oldFormat)||group.ratios[0];
 const updates=runwaySpec().resolutions.length?{runway_resolution:group.id}:{};if(ratio)updates.runway_ratio=ratio;
 const draft=renderOptions();await run('Updating quality…',async()=>{await api('settings',updates);S.render_prompt=draft.prompt;S.render_duration=fitVideoDuration(draft.duration);},{keepDirty:true});
}
async function changeVideoModel(model,mode){
 const draft=renderOptions(),nextAction=$('[data-field="next_action"]')?.value;
 await run('Updating your model…',async()=>{await api('settings',{runway_model:model,runway_mode:mode});S.render_prompt=draft.prompt;S.render_duration=fitVideoDuration(draft.duration);if(nextAction!=null)S.continuation={...S.continuation,next_action:nextAction};},{keepDirty:true});
}
function characterReferenceSummary(){
 const p=S.settings,mode=p.video_provider==='alibaba'?p.wan_mode:p.runway_mode;
 const shot=S.director.shots?.find(x=>x.id===S.selected_shot),wanted=shot?.characters?.map(x=>String(x).toLowerCase());
 const cast=S.characters.filter(c=>!wanted?.length||wanted.includes(c.id.toLowerCase())||wanted.includes(c.name.toLowerCase()));
 const selected=cast.filter(c=>c.use_as_reference!==false&&c.image_url),saved=cast.filter(c=>c.use_as_reference===false&&c.image_url);
 if(!selected.length&&!saved.length)return '';
 const canReference=p.video_provider==='alibaba'||!!runwayModel()?.modes.reference,canText=p.video_provider==='alibaba'||!!runwayModel()?.modes.text;
 const names=chars=>chars.map(c=>esc(c.name)).join(', ');
 let note='',action='';
 if(selected.length){
  if(mode==='reference')note='<p>Your selected images guide appearance, without becoming the opening frame. Build the shot prompt to attach them.</p>';
  else{note='<p class="reference-warning">Your current image-use setting does not send these as character references.</p>';action=canReference?button('Use selected references','use-image-references','secondary small'):button('Choose a reference-compatible model','choose-reference-model','secondary small');}
 }else if(mode!=='text'&&canText){note='<p>All character images for this shot are saved only. Choose Text only to generate without them, or upload a separate reference below.</p>';action=button('Use text only','use-text-only','secondary small');}
 if(!selected.length&&mode!=='text'&&!canText){note='<p class="reference-warning">This model requires an opening scene image. Create a scene frame below or choose a model that supports Text only.</p>';action=button('Choose a text-only model','choose-text-model','secondary small');}
 return `<section class="reference-summary" aria-label="Character image choices"><h3>Character image choices</h3>${selected.length?`<p><strong>Use as references:</strong> ${names(selected)}</p>`:''}${saved.length?`<p><strong>Saved only:</strong> ${names(saved)}</p>`:''}${note}<div class="row wrap">${action}${link('Change character choices','characters','ghost small')}</div></section>`;
}
function providerPanel(){
 const p=S.settings,wan=p.video_provider==='alibaba';
 return `<section class="panel provider-panel"><div class="panel-title"><h3>Video generator</h3><span class="badge">Per second</span></div><div class="provider-grid">${[['runway','Runway','25 models'],['alibaba','Alibaba','Wan 3.0 · 2–30 seconds']].map(([id,name,copy])=>`<label class="provider-card ${p.video_provider===id?'selected':''}"><div class="row between"><strong>${name}</strong><input type="radio" name="video-provider" data-video-option="video_provider" value="${id}" ${p.video_provider===id?'checked':''}></div><p>${copy}</p><strong class="provider-price" id="provider-cost-${id}"></strong><small id="provider-math-${id}"></small></label>`).join('')}</div>${wan?`<div class="field-grid provider-options"><label class="field"><span>Quality</span><select data-video-option="wan_resolution">${['480P','720P','1080P'].map(r=>`<option value="${r}" ${r===p.wan_resolution?'selected':''}>${r.toLowerCase()}</option>`).join('')}</select></label><label class="field"><span>How images are used</span><select data-video-option="wan_mode">${[['reference','Character references'],['first_frame','Opening image'],['text','Text only']].map(([value,label])=>`<option value="${value}" ${value===p.wan_mode?'selected':''}>${label}</option>`).join('')}</select></label>${p.wan_mode==='first_frame'?`<label class="field"><span>Opening image</span><select data-video-option="wan_start_slot"><option value="ref_a" ${p.wan_start_slot==='ref_a'?'selected':''}>Picture 1</option><option value="ref_b" ${p.wan_start_slot==='ref_b'?'selected':''}>Picture 2</option></select></label>`:''}</div><div class="row wrap provider-toggles"><label><input type="checkbox" data-video-option="wan_audio" ${p.wan_audio?'checked':''}>Generate sound</label>${adminInfo(`<label><input type="checkbox" data-video-option="wan_prompt_extend" ${p.wan_prompt_extend?'checked':''}>Let Wan expand the prompt</label>`)}</div>`:runwayOptions()}<div class="price-summary"><div><span class="subtle-label">ESTIMATED GENERATION COST</span><strong id="selected-video-cost"></strong>${adminInfo('<p id="selected-video-math"></p>')}</div>${isAdmin()?link('Provider settings','settings','ghost small'):''}</div>${adminInfo(`<p class="hint">Runway estimates checked ${esc(S.providers.runway_pricing_checked)}; Wan estimates checked ${esc(S.providers.pricing_checked)}. Provider list-price estimates, not invoices. Input charges, minimums, credit rounding and current promotions are included where applicable. Taxes and account-specific discounts may differ. <a href="${esc(S.providers.runway_pricing_url)}" target="_blank" rel="noopener">Runway API pricing ↗</a> · <a href="${esc(S.providers.wan_pricing_url)}" target="_blank" rel="noopener">Wan pricing ↗</a></p>`)}</section>`;
}
function updateVideoPricing(){
 if(page!=='render'||!S)return;
 const seconds=Number($('#render-duration')?.value||S.render_duration);
 for(const provider of ['runway','alibaba']){
  const q=videoCost(provider,seconds),amount=$('#provider-cost-'+provider),math=$('#provider-math-'+provider);
  if(amount)amount.textContent=q.total==null?'Choose a supported length':usd(q.total)+' estimated';
  if(math)math.textContent=q.rate==null?'':usd(q.rate,3)+'/second';
 }
 const q=videoCost(S.settings.video_provider,seconds),cost=$('#selected-video-cost'),math=$('#selected-video-math');
 if(cost)cost.textContent=usd(q.total);
 if(math&&isAdmin())math.textContent=q.total==null?'Unsupported duration.':seconds+' generated seconds × '+usd(q.rate,6)+'/second'+(q.credits!=null?' · '+q.credits+' developer credits (including applicable image charges, minimums and rounding)':'');
 const count=($('[data-field="render_prompt"]')?.value||'').length,spec=S.settings.video_provider==='runway'?runwaySpec():{prompt_min:1,prompt_max:20000},units=$('#runway-prompt-count');
 if(units){units.hidden=count<=spec.prompt_max;units.textContent=count>spec.prompt_max?'Your prompt is too long. Shorten it before generating.':'';}
 const generate=$('#render-generate');if(generate)generate.disabled=!videoReady()||!durationChoices().includes(seconds)||count<spec.prompt_min||count>spec.prompt_max;
 if(typeof updateRenderReview==='function')updateRenderReview();
 // GENERATION_TIME_ESTIMATE_ENABLE: uncomment after adding measured samples and enabling the helper block/HTML element.
 // updateGenerationTimeEstimate(seconds);
}
function jobCost(job){
 const q=job.cost_estimate;if(!q||!isAdmin())return '';
 const credits=job.provider==='runway'?job.usage?.credits:null;
 return `<p class="job-cost">Submission estimate: ${usd(q.estimated_cost_usd)}.${credits!=null?' Runway reports '+esc(credits)+' credits charged (list-value '+usd(credits*S.providers.runway_credit_usd)+', before tax/discounts).':' Final billing may differ.'}</p>`;
}
function referenceRole(slot){
 const p=S.settings;
 if(p.video_provider==='runway'){if(p.runway_mode==='reference')return 'Character reference';return p.runway_mode==='text'||slot!==p.runway_start_slot?'Saved reference':'Opening frame';}
 if(p.wan_mode==='text')return 'Saved image · not sent';
 if(p.wan_mode==='first_frame')return slot===p.wan_start_slot?'Starting frame':'Saved image · not sent';
 return S.references[slot].binding.kind==='last_frame'?'Continuity frame':'Visual reference';
}
function videoSettingsPanel(){
 const p=S.settings;
 return `<section class="panel settings-section"><h3>Video generator</h3><form id="video-settings-form"><div class="field-grid"><label class="field"><span>Default service</span><select data-video-setting="video_provider"><option value="runway" ${p.video_provider==='runway'?'selected':''}>Runway</option><option value="alibaba" ${p.video_provider==='alibaba'?'selected':''}>Alibaba Wan 3.0</option></select></label>${adminInfo(`<label class="field"><span>Alibaba region</span><select data-video-setting="wan_region">${S.providers.regions.map(r=>`<option value="${esc(r.id)}" ${r.id===p.wan_region?'selected':''}>${esc(r.name)}</option>`).join('')}</select></label><label class="field full"><span>Alibaba workspace ID</span><input data-video-setting="wan_workspace" value="${esc(p.wan_workspace||'')}"></label>`)}</div><button class="button primary" type="submit">Save preferences</button></form>${adminInfo(`<details class="details"><summary>Connect provider API keys</summary><p class="hint">Add keys in Render Environment and redeploy, or in .env locally and restart. Runway Developer credits are separate from a consumer subscription.</p><pre class="config-line">RUNWAYML_API_SECRET=your_runway_developer_key
ALIBABA_API_KEY=your_alibaba_key
ALIBABA_WORKSPACE_ID=your_workspace_id
ALIBABA_REGION=${esc(p.wan_region)}</pre></details><div class="row wrap"><span>Runway ${badge(S.configured.runway?'configured':'Setup needed')}</span><span>Alibaba ${badge(S.configured.alibaba?'configured':'Setup needed')}</span></div>`)}</section>`;
}
async function changeVideoOption(input){
 const field=input.dataset.videoOption,value=input.type==='checkbox'?input.checked:input.value;
 const draft=renderOptions(),nextAction=$('[data-field="next_action"]')?.value;
 await run('Updating your selection…',async()=>{await api('settings',{[field]:value});S.render_prompt=draft.prompt;S.render_duration=fitVideoDuration(draft.duration);if(nextAction!=null)S.continuation={...S.continuation,next_action:nextAction};},{keepDirty:true});
}

/* GENERATION_TIME_ESTIMATE_HELPERS_START
// Inactive until this entire block is uncommented. No guessed timings are used.
// Enter measured wall-clock seconds for the sample clip length, including queue time.
// Use the same provider, model, region, input mode and quality you measured.
const GENERATION_TIME_SAMPLES = {
 'alibaba|wan3.0-video|ap-southeast-1|reference|720P': {clipSeconds:null,fastSeconds:null,slowSeconds:null},
 'alibaba|wan3.0-video|ap-southeast-1|reference|1080P': {clipSeconds:null,fastSeconds:null,slowSeconds:null},
 // Add other measured combinations as needed, for example:
 // 'runway|wan3||reference|1280:720': {clipSeconds:null,fastSeconds:null,slowSeconds:null},
};
function updateGenerationTimeEstimate(seconds){
 const element=$('#generation-time-estimate');if(!element)return;
 const p=S.settings,wan=p.video_provider==='alibaba';
 const key=[p.video_provider,wan?'wan3.0-video':p.runway_model,wan?p.wan_region:'',wan?p.wan_mode:p.runway_mode,wan?p.wan_resolution:(p.runway_resolution||p.runway_ratio)].join('|');
 const sample=GENERATION_TIME_SAMPLES[key];
 if(!sample||![seconds,sample.clipSeconds,sample.fastSeconds,sample.slowSeconds].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0)||sample.fastSeconds>sample.slowSeconds){element.hidden=true;element.textContent='';return;}
 // Approximate scaling from a measured sample; this is a range, not a countdown.
 const low=Math.max(1,Math.ceil(sample.fastSeconds*seconds/sample.clipSeconds/60));
 const high=Math.max(low,Math.ceil(sample.slowSeconds*seconds/sample.clipSeconds/60));
 element.textContent='Estimated generation time: about '+(low===high?low:low+'–'+high)+' '+(high===1?'minute':'minutes')+'.';
 element.hidden=false;
}
GENERATION_TIME_ESTIMATE_HELPERS_END */
