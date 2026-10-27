'use strict';
function usd(value, digits=2) {
  return value == null ? 'Estimate not configured' : '$'+Number(value).toFixed(digits);
}
function videoCost(provider, seconds) {
  const p=S.settings, catalog=S.providers;
  if(provider==='alibaba'){
    const rate=catalog.rates_by_region[p.wan_region]?.[p.wan_resolution];
    return {rate,total:rate==null ? null : rate*seconds,basis:'generated video second'};
  }
  const rate=p.runpod_gpu_rate, benchmark=p.runpod_seconds_for_15s;
  const compute=benchmark==null ? null : benchmark*seconds/15;
  return {rate,compute,total:rate==null || compute==null ? null : rate*compute,basis:'GPU worker second'};
}
function videoReady() {
  const p=S.settings;
  if(p.video_provider==='runpod')return S.configured.runpod && S.configured.workflow && S.references.ref_a.url && S.references.ref_b.url;
  if(!S.configured.alibaba)return false;
  if(p.wan_mode==='text')return true;
  if(p.wan_mode==='first_frame')return !!S.references[p.wan_start_slot]?.url;
  return !!(S.references.ref_a.url || S.references.ref_b.url);
}
function providerPanel() {
  const p=S.settings, wan=p.video_provider==='alibaba';
  return `<section class="panel provider-panel"><div class="panel-title"><div><div class="subtle-label">VIDEO GENERATION</div><h3>Choose your video provider.</h3><p>Compare the billing unit and estimated cost in USD for this clip.</p></div><span class="badge">Pay as you go</span></div>
    <div class="provider-grid">${[['runpod','Runpod','Your self-hosted workflow','Billed per second of GPU worker time.'],['alibaba','Alibaba Wan 3.0','Managed video generation','Billed per second of generated video.']].map(([id,name,copy,billing])=>`<label class="provider-card ${p.video_provider===id ? 'selected' : ''}"><div class="row between"><strong>${name}</strong><input type="radio" name="video-provider" data-video-option="video_provider" value="${id}" ${p.video_provider===id ? 'checked' : ''}></div><p>${copy}</p><span class="provider-billing">${billing}</span><strong class="provider-price" id="provider-cost-${id}"></strong><small id="provider-math-${id}"></small></label>`).join('')}</div>
    ${wan ? `<div class="field-grid provider-options"><label class="field"><span>Video resolution</span><select data-video-option="wan_resolution">${['480P','720P','1080P'].map(r=>`<option ${r===p.wan_resolution ? 'selected' : ''}>${r}</option>`).join('')}</select></label><label class="field"><span>How should Wan use your images?</span><select data-video-option="wan_mode">${[['reference','Use image references'],['first_frame','Start from one scene frame'],['text','Text only']].map(([value,label])=>`<option value="${value}" ${value===p.wan_mode ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${p.wan_mode==='first_frame' ? `<label class="field full"><span>Starting frame</span><select data-video-option="wan_start_slot"><option value="ref_a" ${p.wan_start_slot==='ref_a' ? 'selected' : ''}>Picture 1</option><option value="ref_b" ${p.wan_start_slot==='ref_b' ? 'selected' : ''}>Picture 2</option></select><div class="hint">This mode sends the selected starting frame. Other images remain saved for later renders.</div></label>` : ''}</div><div class="row wrap provider-toggles"><label><input type="checkbox" data-video-option="wan_audio" ${p.wan_audio ? 'checked' : ''}> Generate sound</label><label><input type="checkbox" data-video-option="wan_prompt_extend" ${p.wan_prompt_extend ? 'checked' : ''}> Let Wan expand the prompt</label></div><p class="hint">Region: ${esc(S.providers.regions.find(r=>r.id===p.wan_region)?.name || p.wan_region)}. Audio on/off has the same video price. Prompt expansion is off by default to preserve your direction.</p>` : '<p class="hint" style="margin-top:16px">Runpod uses your existing workflow and its resolution. Configure your worker rate and typical render time in Settings to calculate an estimate.</p>'}
    <div class="price-summary"><div><span class="subtle-label">SELECTED PROVIDER ESTIMATE</span><strong id="selected-video-cost"></strong><p id="selected-video-math"></p></div>${link('Provider settings','settings','ghost small')}</div>
    <p class="hint">Wan estimates use published list prices checked ${esc(S.providers.pricing_checked)}; promotions may change your bill. Runpod estimates use your rate and benchmark; startup, idle time, and storage can change the total. <a href="${esc(S.providers.wan_pricing_url)}" target="_blank" rel="noopener">Wan pricing ↗</a> · <a href="${esc(S.providers.runpod_pricing_url)}" target="_blank" rel="noopener">Runpod billing ↗</a></p></section>`;
}
function updateVideoPricing() {
  if(page!=='render' || !S)return;
  const seconds=Number($('#render-duration')?.value || S.render_duration);
  for(const provider of ['runpod','alibaba']){
    const quote=videoCost(provider,seconds);
    const amount=$('#provider-cost-'+provider),math=$('#provider-math-'+provider);
    if(amount)amount.textContent=quote.total==null ? provider==='runpod' ? 'Set your worker estimate' : 'Select a valid region' : usd(quote.total)+' estimated / '+seconds+' sec clip';
    if(math)math.textContent=provider==='alibaba' ? quote.rate==null ? '' : usd(quote.rate,6)+' / generated video second' : quote.rate==null || quote.compute==null ? 'Worker rate and benchmark time are needed.' : quote.compute.toFixed(1)+' GPU seconds × '+usd(quote.rate,6)+'/GPU second';
  }
  const selected=videoCost(S.settings.video_provider,seconds);
  $('#selected-video-cost').textContent=usd(selected.total);
  $('#selected-video-math').textContent=selected.total==null ? S.settings.video_provider==='alibaba' ? 'Choose a supported Alibaba region in Settings.' : 'Configure the Runpod worker rate and benchmark for a price comparison.' : S.settings.video_provider==='alibaba' ? seconds+' generated seconds × '+usd(selected.rate,6)+'/second' : 'About '+selected.compute.toFixed(1)+' GPU worker seconds for this '+seconds+'-second clip';
}
function jobCost(job){
  const q=job.cost_estimate;
  if(!q)return '';
  return `<p class="job-cost">Submission estimate: ${usd(q.estimated_cost_usd)}${q.unit_rate_usd==null ? '' : ' · '+usd(q.unit_rate_usd,6)+' / '+(q.basis==='generated_video_second' ? 'generated video second' : 'GPU worker second')}. Final billing may differ.</p>`;
}
function referenceRole(slot) {
  const p=S.settings;
  if(p.video_provider==='alibaba' && p.wan_mode==='text')return 'Saved image · not sent';
  if(p.video_provider==='alibaba' && p.wan_mode==='first_frame')return slot===p.wan_start_slot ? 'Starting frame' : 'Saved image · not sent';
  return S.references[slot].binding.kind==='last_frame' ? 'Continuity frame' : 'Visual reference';
}
function videoSettingsPanel() {
  const p=S.settings;
  return `<section class="panel settings-section"><div class="panel-title"><div><h3>Video providers & price estimates</h3><p>Your keys stay in .env. Match Alibaba’s region to your API key.</p></div></div><form id="video-settings-form"><div class="field-grid">
    <label class="field"><span>Default video provider</span><select data-video-setting="video_provider"><option value="runpod" ${p.video_provider==='runpod' ? 'selected' : ''}>Runpod</option><option value="alibaba" ${p.video_provider==='alibaba' ? 'selected' : ''}>Alibaba Wan 3.0</option></select></label>
    <label class="field"><span>Alibaba region</span><select data-video-setting="wan_region">${S.providers.regions.map(r=>`<option value="${esc(r.id)}" ${r.id===p.wan_region ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
    <label class="field full"><span>Alibaba workspace ID</span><input data-video-setting="wan_workspace" value="${esc(p.wan_workspace)}" placeholder="From Model Studio → Workspace details"><div class="hint">The workspace ID is separate from your API key. The app selects the correct regional endpoint automatically.</div></label>
    <label class="field"><span>Runpod GPU rate (USD per GPU second)</span><input type="number" min="0" step="any" data-video-setting="runpod_gpu_rate" value="${p.runpod_gpu_rate ?? ''}" placeholder="Your worker's hourly price ÷ 3600"><div class="hint">Use the rate for your actual worker configuration.</div></label>
    <label class="field"><span>Typical GPU time for a 15-second clip (seconds)</span><input type="number" min="0" step="any" data-video-setting="runpod_seconds_for_15s" value="${p.runpod_seconds_for_15s ?? ''}" placeholder="Your measured render time"><div class="hint">Use a representative benchmark. Include billed startup/idle time when known.</div></label>
    </div><button class="button primary" type="submit">Save provider settings</button></form>
    <details class="details" ${!S.configured.alibaba ? 'open' : ''}><summary>Connect your Alibaba API key</summary><p class="hint">Add your existing key to .env and restart. You can use either ALIBABA_API_KEY or DASHSCOPE_API_KEY. Set the region and workspace above.</p><pre class="config-line">ALIBABA_API_KEY=your_alibaba_api_key
ALIBABA_WORKSPACE_ID=your_workspace_id
ALIBABA_REGION=${esc(p.wan_region)}</pre><p class="hint">Wan 3.0 is called directly through Alibaba Model Studio. A ComfyUI subscription is not part of this integration.</p></details>
    <div class="row wrap" style="margin-top:18px"><span>Alibaba ${badge(S.configured.alibaba ? 'configured' : 'Setup needed')}</span><span>Runpod ${badge(S.configured.runpod ? 'configured' : 'Setup needed')}</span></div></section>`;
}
async function changeVideoOption(input) {
  const field=input.dataset.videoOption,value=input.type==='checkbox' ? input.checked : input.value;
  const draft=renderOptions(),nextAction=$('[data-field="next_action"]')?.value;
  await run('Updating the video provider…',async()=>{
    await api('settings',{[field]:value});
    S.render_prompt=draft.prompt;S.render_duration=draft.duration;S.render_turbo=draft.turbo;
    if(nextAction!=null)S.continuation={...S.continuation,next_action:nextAction};
  },{keepDirty:true});
}
