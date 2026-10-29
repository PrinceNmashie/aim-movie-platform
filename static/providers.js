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
 if(p.video_provider==='runway')return S.configured.runway&&!!runwaySpec()&&(p.runway_mode==='text'||!!S.references[p.runway_start_slot]?.url);
 return S.configured.alibaba&&(p.wan_mode==='text'||(p.wan_mode==='first_frame'?!!S.references[p.wan_start_slot]?.url:!!(S.references.ref_a.url||S.references.ref_b.url)));
}
function sizeLabel(value){return value.startsWith('auto_')?'Match image · '+value.slice(5):value.replace(':',' × ');}
function runwayOptions(){
 const p=S.settings,spec=runwaySpec(),text=p.runway_mode==='text',makers=[...new Set(S.providers.runway_models.map(m=>m.maker))];
 return `<div class="field-grid provider-options"><label class="field"><span>Model</span><select data-video-option="runway_model">${makers.map(maker=>`<optgroup label="${esc(maker)}">${S.providers.runway_models.filter(m=>m.maker===maker).map(m=>`<option value="${m.id}" ${m.id===p.runway_model?'selected':''}>${esc(m.name)}</option>`).join('')}</optgroup>`).join('')}</select></label><label class="field"><span>Start with</span><select data-video-option="runway_mode">${Object.keys(runwayModel().modes).map(mode=>`<option value="${mode}" ${mode===p.runway_mode?'selected':''}>${mode==='first_frame'?'An image':'Text'}</option>`).join('')}</select></label>${spec.ratios.length?`<label class="field"><span>Output size</span><select data-video-option="runway_ratio">${spec.ratios.map(r=>`<option value="${r}" ${r===p.runway_ratio?'selected':''}>${sizeLabel(r)}</option>`).join('')}</select></label>`:''}${spec.resolutions.length?`<label class="field"><span>Quality</span><select data-video-option="runway_resolution">${spec.resolutions.map(r=>`<option value="${r}" ${r===p.runway_resolution?'selected':''}>${esc(r)}</option>`).join('')}</select></label>`:''}${!text?`<label class="field"><span>Starting frame</span><select data-video-option="runway_start_slot"><option value="ref_a" ${p.runway_start_slot==='ref_a'?'selected':''}>Picture 1</option><option value="ref_b" ${p.runway_start_slot==='ref_b'?'selected':''}>Picture 2</option></select></label>`:''}${isAdmin()&&spec.seed?`<label class="field"><span>Seed (optional)</span><input type="number" min="0" max="4294967295" step="1" data-video-option="runway_seed" value="${p.runway_seed??''}" placeholder="Random"></label>`:''}</div>${spec.audio_toggle?`<label class="check"><input type="checkbox" data-video-option="runway_audio" ${p.runway_audio?'checked':''}>Generate sound</label>`:''}${adminInfo(`<p class="hint">Runway Developer · ${esc(p.runway_model)} · ${spec.durations.join(', ')} seconds. Prompt: ${spec.prompt_min}–${spec.prompt_max} UTF-16 units. ${text?'No saved images are sent.':'Only the selected first frame is sent. Additional keyframes and reference video/audio are not sent by this workflow.'}</p>`)}<p class="image-credit"><a href="https://runwayml.com" target="_blank" rel="noopener">Powered by Runway ↗</a></p>`;
}
function providerPanel(){
 const p=S.settings,wan=p.video_provider==='alibaba';
 return `<section class="panel provider-panel"><div class="panel-title"><h3>Video generator</h3><span class="badge">Per second</span></div><div class="provider-grid">${[['runway','Runway','25 models'],['alibaba','Alibaba','Wan 3.0 · 2–30 seconds']].map(([id,name,copy])=>`<label class="provider-card ${p.video_provider===id?'selected':''}"><div class="row between"><strong>${name}</strong><input type="radio" name="video-provider" data-video-option="video_provider" value="${id}" ${p.video_provider===id?'checked':''}></div><p>${copy}</p><strong class="provider-price" id="provider-cost-${id}"></strong><small id="provider-math-${id}"></small></label>`).join('')}</div>${wan?`<div class="field-grid provider-options"><label class="field"><span>Quality</span><select data-video-option="wan_resolution">${['480P','720P','1080P'].map(r=>`<option ${r===p.wan_resolution?'selected':''}>${r}</option>`).join('')}</select></label><label class="field"><span>Start with</span><select data-video-option="wan_mode">${[['reference','Image references'],['first_frame','A starting frame'],['text','Text']].map(([value,label])=>`<option value="${value}" ${value===p.wan_mode?'selected':''}>${label}</option>`).join('')}</select></label>${p.wan_mode==='first_frame'?`<label class="field"><span>Starting frame</span><select data-video-option="wan_start_slot"><option value="ref_a" ${p.wan_start_slot==='ref_a'?'selected':''}>Picture 1</option><option value="ref_b" ${p.wan_start_slot==='ref_b'?'selected':''}>Picture 2</option></select></label>`:''}</div><div class="row wrap provider-toggles"><label><input type="checkbox" data-video-option="wan_audio" ${p.wan_audio?'checked':''}>Generate sound</label>${adminInfo(`<label><input type="checkbox" data-video-option="wan_prompt_extend" ${p.wan_prompt_extend?'checked':''}>Let Wan expand the prompt</label>`)}</div>`:runwayOptions()}<div class="price-summary"><div><span class="subtle-label">ESTIMATED GENERATION COST</span><strong id="selected-video-cost"></strong>${adminInfo('<p id="selected-video-math"></p>')}</div>${isAdmin()?link('Provider settings','settings','ghost small'):''}</div>${adminInfo(`<p class="hint">Runway estimates checked ${esc(S.providers.runway_pricing_checked)}; Wan estimates checked ${esc(S.providers.pricing_checked)}. Provider list-price estimates, not invoices. Input charges, minimums, credit rounding and current promotions are included where applicable. Taxes and account-specific discounts may differ. <a href="${esc(S.providers.runway_pricing_url)}" target="_blank" rel="noopener">Runway API pricing ↗</a> · <a href="${esc(S.providers.wan_pricing_url)}" target="_blank" rel="noopener">Wan pricing ↗</a></p>`)}</section>`;
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
 if(units)units.textContent=count+' / '+spec.prompt_max;
 const generate=$('#render-generate');if(generate)generate.disabled=!videoReady()||!durationChoices().includes(seconds)||count<spec.prompt_min||count>spec.prompt_max;
}
function jobCost(job){
 const q=job.cost_estimate;if(!q||!isAdmin())return '';
 const credits=job.provider==='runway'?job.usage?.credits:null;
 return `<p class="job-cost">Submission estimate: ${usd(q.estimated_cost_usd)}.${credits!=null?' Runway reports '+esc(credits)+' credits charged (list-value '+usd(credits*S.providers.runway_credit_usd)+', before tax/discounts).':' Final billing may differ.'}</p>`;
}
function referenceRole(slot){
 const p=S.settings;
 if(p.video_provider==='runway')return p.runway_mode==='text'||slot!==p.runway_start_slot?'Saved image · not sent':'Starting frame';
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
