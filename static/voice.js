'use strict';
window.AIMVoice=(()=>{
 let phase='idle',pc=null,dc=null,stream=null,audio=null,sid=null,epoch=0,queue=Promise.resolve(),timer=null,started=0,lastActivity=0,turns=new Map(),usage=[],lastAssistant=null,ending=null;
 let muted=false,userSpeaking=false,responding=false,playing=false,playbackEvents=false,playbackBlocked=false;
 let context=null,meters={},frame=null,wave=null,bars=[],levels=[];
 const motion=window.matchMedia?.('(prefers-reduced-motion: reduce)');
 const active=()=>phase!=='idle';
 const supported=()=>!!(navigator.mediaDevices?.getUserMedia && window.RTCPeerConnection);
 const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({mic:'<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',muted:'<path d="m3 3 18 18M9 9v3a3 3 0 0 0 5 2M9 5a3 3 0 0 1 6 0v4M5 10v2a7 7 0 0 0 12 5m2-5v-2M12 19v3m-4 0h8"/>',keyboard:'<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 15h10"/>',end:'<path d="M4 17H2v-5c5-5 15-5 20 0v5h-5v-4a15 15 0 0 0-10 0v4H4Z"/>',live:'<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4m8.4-8.4a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2m14.2-14.2a10 10 0 0 1 0 14.2"/>'})[name]}</svg>`;
 const displayPhase=()=>playbackBlocked?'playback':muted&&phase==='listening'?'muted':phase;
 function send(event){if(dc?.readyState==='open')dc.send(JSON.stringify(event));}
 function setText(node,text){if(node&&node.textContent!==text)node.textContent=text;}
 function clock(){const seconds=started?Math.max(0,Math.floor((Date.now()-started)/1000)):0;setText(document.querySelector('#voice-elapsed'),String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0'));}
 function update(){
  const live=active(),state=displayPhase(),toolbar=document.querySelector('.voice-toolbar'),panel=document.querySelector('#voice-live-panel');
  const start=document.querySelector('#voice-start'),stop=document.querySelector('#voice-stop'),mute=document.querySelector('#voice-mute'),type=document.querySelector('#voice-type');
  if(start)start.hidden=live;if(panel){panel.hidden=!live;panel.dataset.state=state;}
  if(toolbar)toolbar.dataset.active=String(live);
  const form=document.querySelector('#chat-form');form?.classList.toggle('is-voice-active',live);
  if(form){const input=form.querySelector('textarea'),submit=form.querySelector('[type="submit"]');if(input)input.disabled=live||busy;if(submit)submit.disabled=live||busy||!S.configured.openai||!S.platform.paid_enabled;}
  const root=document.querySelector('.conversation-page');root?.classList.toggle('is-voice-live',live);
  if(live&&typeof showConversationStarted==='function')showConversationStarted();
  if(stop)stop.disabled=phase==='stopping';if(type)type.disabled=phase==='stopping';
  if(mute){mute.disabled=!stream||phase==='stopping';mute.setAttribute('aria-pressed',String(muted));if(mute.dataset.muted!==String(muted)){mute.innerHTML=icon(muted?'muted':'mic')+`<span>${muted?'Unmute mic':'Mute mic'}</span>`;mute.dataset.muted=String(muted);}}
  const labels={idle:'Ready to talk',connecting:'Connecting…',listening:'Listening…',thinking:'Thinking…',speaking:'MIA is speaking',muted:'Mic muted',stopping:'Ending voice…',playback:'Press Play to hear MIA'};
  const hints={idle:'',connecting:'Allow microphone access if your browser asks.',listening:userSpeaking?'I’m listening. Keep going.':'Tell MIA what you’re imagining.',thinking:'Giving your idea a little thought.',speaking:muted?'Your microphone is muted.':'You can start talking to interrupt.',muted:'MIA can’t hear you until you unmute.',stopping:'Finishing your saved transcript.',playback:'Your browser paused audio. Use the player below.'};
  setText(document.querySelector('#voice-status'),labels[state]||labels.listening);
  setText(document.querySelector('#voice-hint'),hints[state]||'');
  setText(document.querySelector('#voice-mic-state'),phase==='connecting'&&!stream?'Waiting for mic':muted||!stream||phase==='stopping'?'Mic off':'Mic on');
  clock();if(live)animate();
 }
 function controls(compact=false){return `<div class="voice-toolbar ${compact?'is-compact':''}" data-active="${active()}"><button type="button" class="button secondary small" id="voice-start" data-action="voice-start" ${!supported()||!S.configured.openai||!S.platform.paid_enabled?'disabled':''}>${icon('mic')}Talk with MIA</button><section id="voice-live-panel" class="voice-live-panel" aria-label="Live voice conversation" data-state="${displayPhase()}" hidden><div class="voice-live-header"><div class="voice-live-title">${icon('live')}<span>Live with MIA</span><i aria-hidden="true"></i><time id="voice-elapsed" aria-label="Voice session duration">00:00</time></div><span id="voice-mic-state" class="voice-mic-state">Mic on</span></div><div class="voice-visualizer" aria-hidden="true"><div class="voice-wave-glow"></div><div class="voice-wave-bars">${Array.from({length:57},(_,i)=>`<i style="--bar:${i};--shape:${(.2+.8*Math.exp(-Math.pow((i-28)/15,2))).toFixed(3)};--delay:${(-i*.055).toFixed(3)}s"></i>`).join('')}</div></div><div class="voice-state-copy"><p id="voice-status" role="status" aria-live="polite" aria-atomic="true"></p><p id="voice-hint"></p></div><div class="voice-live-actions"><button type="button" class="button secondary small" id="voice-mute" data-action="voice-mute" aria-pressed="false">${icon('mic')}<span>Mute mic</span></button><button type="button" class="button secondary small" id="voice-type" data-action="voice-type" title="End voice and return to typing">${icon('keyboard')}<span>Type instead</span></button><button type="button" class="button secondary small" id="voice-stop" data-action="voice-stop">${icon('end')}<span>End voice</span></button></div></section><audio id="aim-voice-audio" aria-label="MIA voice playback" controls hidden></audio></div>`;}

 // Read local microphone / remote playback levels only. Never connect the mic
 // to speakers or record audio for the visualizer. Voice still works without it.
 function startMeters(){
  try{const AudioContext=window.AudioContext||window.webkitAudioContext;if(!AudioContext)return;context=new AudioContext();context.resume().catch(()=>{});}catch{context=null;}
 }
 function attachMeter(media,name){
  if(!context||context.state==='closed')return;
  try{meters[name]?.source.disconnect();meters[name]?.analyser.disconnect();const source=context.createMediaStreamSource(media),analyser=context.createAnalyser();analyser.fftSize=256;analyser.smoothingTimeConstant=.72;source.connect(analyser);meters[name]={source,analyser,time:new Uint8Array(analyser.fftSize),frequency:new Uint8Array(analyser.frequencyBinCount)};}catch{/* State animation remains available when Web Audio is unsupported. */}
 }
 function pauseAnimation(){if(frame!==null)cancelAnimationFrame(frame);frame=null;}
 function draw(now){
  frame=null;if(!active()||document.hidden||motion?.matches)return;
  const node=document.querySelector('.voice-wave-bars');
  if(node!==wave){wave=node;bars=node?[...node.children]:[];levels=bars.map(()=>.06);}
  const state=displayPhase(),meter=state==='speaking'?meters.output:state==='listening'&&!muted?meters.input:null;
  let energy=0;
  if(meter){meter.analyser.getByteTimeDomainData(meter.time);meter.analyser.getByteFrequencyData(meter.frequency);energy=Math.sqrt(meter.time.reduce((sum,value)=>sum+Math.pow((value-128)/128,2),0)/meter.time.length);}
  if(wave){wave.dataset.reactive=String(!!meter);if(state==='thinking'||state==='connecting'||state==='stopping'||!meter){bars.forEach(bar=>bar.style.removeProperty('transform'));}
   else bars.forEach((bar,i)=>{const shape=.2+.8*Math.exp(-Math.pow((i-28)/15,2)),bin=Math.min(meter.frequency.length-1,Math.floor(Math.abs(i-28)*2));const sound=energy>.009?Math.min(1,energy*2.8+meter.frequency[bin]/255*.55):0,ripple=.7+.3*Math.sin(now*.011-i*.52);const target=.045+shape*(sound*ripple*.94+.018*(1+Math.sin(now*.002+i*.23)));levels[i]+=(target-levels[i])*.24;bar.style.transform=`scaleY(${levels[i].toFixed(3)})`;});
  }
  frame=requestAnimationFrame(draw);
 }
 function animate(){if(frame===null&&active()&&!document.hidden&&!motion?.matches)frame=requestAnimationFrame(draw);}
 function releaseMeters(){pauseAnimation();for(const meter of Object.values(meters)){try{meter.source.disconnect();meter.analyser.disconnect();}catch{}}meters={};if(context){context.close().catch(()=>{});context=null;}wave=null;bars=[];levels=[];}
 function settle(){if(['idle','connecting','stopping'].includes(phase))return;phase=userSpeaking?'listening':playing?'speaking':responding?'thinking':'listening';update();}
 function row(item,role){
  if(turns.has(item))return turns.get(item);
  const thread=document.querySelector('#chat-thread');if(!thread)return null;
  const node=document.createElement('div');node.className='message voice-message '+(role==='user'?'user':'ai');
  node.innerHTML=`<span class="avatar ${role==='assistant'?'ai':''}">${role==='user'?'Y':'M'}</span><div class="message-body"><div class="message-author">${role==='user'?'You · voice':'MIA · voice'}</div><div class="message-copy"></div></div>`;
  thread.append(node);if(typeof showConversationStarted==='function')showConversationStarted();const t={role,text:'',node:node.querySelector('.message-copy'),author:node.querySelector('.message-author'),phase:'pending'};turns.set(item,t);thread.scrollTop=thread.scrollHeight;return t;
 }
 function paintTurn(t){
  const thread=document.querySelector('#chat-thread'),follow=thread&&thread.scrollHeight-thread.scrollTop-thread.clientHeight<80;
  t.node.textContent=t.text||(t.role==='user'?'Listening…':'');t.node.classList.toggle('is-live-transcript',t.phase==='pending'&&!!t.text);
  t.author.textContent=t.phase==='pending'?(t.role==='assistant'?'MIA · speaking':'You · speaking'):(t.role==='assistant'?'MIA · voice':'You · voice');
  if(follow)thread.scrollTop=thread.scrollHeight;
 }
 function persist(item,role,text,status='complete'){
  if(!sid)return;
  const sessionId=sid,workspace=S.workspace_id;
  queue=queue.then(async()=>{
   const r=await fetch('/api/voice/turn',{method:'POST',headers:{'Content-Type':'application/json','X-AIM-Token':token,'X-Workspace-ID':workspace},body:JSON.stringify({session_id:sessionId,item_id:item,role,text,phase:status})});
   if(!r.ok){const j=await r.json();throw new Error(j.error||'Voice transcript could not be saved.');}
  }).catch(e=>toast(e.message,true));
 }
 function onEvent(e){
  if(['idle','stopping'].includes(phase))return;
  lastActivity=Date.now();const type=e.type;
  if(type==='session.created'||type==='session.updated'){settle();}
  if(type==='input_audio_buffer.speech_started'){
   userSpeaking=true;playing=false;responding=false;
   if(e.item_id){const t=row(e.item_id,'user');if(t)paintTurn(t);persist(e.item_id,'user','','pending');}settle();
  }
  if(type==='input_audio_buffer.speech_stopped'){userSpeaking=false;responding=true;settle();}
  if(type==='conversation.item.input_audio_transcription.delta'){
   const t=row(e.item_id,'user');if(t){t.text+=e.delta||'';paintTurn(t);}
  }
  if(type==='conversation.item.input_audio_transcription.completed'){
   const t=row(e.item_id,'user');if(t){t.text=e.transcript||'';t.phase='complete';paintTurn(t);persist(e.item_id,'user',t.text);}
  }
  if(type==='conversation.item.input_audio_transcription.failed'){
   const t=row(e.item_id,'user');if(t){t.text='Voice transcription unavailable. Please type that idea to keep it in the saved conversation.';t.phase='failed';paintTurn(t);persist(e.item_id,'user','','failed');}
  }
  if(type==='response.created'){responding=true;lastAssistant=null;settle();}
  if(type==='output_audio_buffer.started'){playbackEvents=true;playing=true;settle();}
  if(type==='output_audio_buffer.stopped'||type==='output_audio_buffer.cleared'){playbackEvents=true;playing=false;settle();}
  if(type==='response.output_audio_transcript.delta'){
   const t=row(e.item_id,'assistant');if(t){lastAssistant=e.item_id;t.text+=e.delta||'';paintTurn(t);}
   if(!playbackEvents&&!userSpeaking){playing=true;settle();}
  }
  if(type==='response.output_audio_transcript.done'){
   const t=row(e.item_id,'assistant');if(t){t.text=e.transcript||t.text;if(t.phase!=='interrupted')t.phase='complete';paintTurn(t);persist(e.item_id,'assistant',t.text,t.phase==='interrupted'?'interrupted':'complete');}
  }
  if(type==='conversation.item.truncated'){
   const t=turns.get(e.item_id);if(t){t.phase='interrupted';paintTurn(t);t.node.textContent=t.text+' [Interrupted; text may include unplayed words]';persist(e.item_id,'assistant',t.text,'interrupted');}
  }
  if(type==='response.done'){
   if(e.response?.usage)usage.push(e.response.usage);
   if(e.response?.status==='cancelled'&&lastAssistant){const t=turns.get(lastAssistant);if(t){t.phase='interrupted';paintTurn(t);persist(lastAssistant,'assistant',t.text,'interrupted');}}
   responding=false;if(!playbackEvents)playing=false;settle();
  }
  if(type==='error'){toast(e.error?.message||'The voice service reported an error.',true);responding=false;settle();}
 }
 async function begin(){
  if(active()||busy)return;if(!supported())return toast('Live voice needs a supported browser on localhost or HTTPS.',true);
  if(dirty&&document.querySelector('#chat-message')?.value.trim())return toast('Send your typed message before starting voice.',true);
  const current=++epoch,workspace=S.workspace_id;phase='connecting';muted=userSpeaking=responding=playing=playbackEvents=playbackBlocked=false;started=0;lastAssistant=null;turns=new Map();usage=[];startMeters();update();
  document.querySelector('#voice-live-panel')?.scrollIntoView?.({block:'nearest',behavior:motion?.matches?'instant':'smooth'});
  try{
   const media=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   if(current!==epoch){media.getTracks().forEach(t=>t.stop());return;}
   stream=media;attachMeter(stream,'input');const connection=pc=new RTCPeerConnection(),player=audio=document.querySelector('#aim-voice-audio')||new Audio();player.autoplay=true;player.hidden=true;update();
   player.onplaying=()=>{if(current===epoch){playbackBlocked=false;player.hidden=true;update();}};
   connection.ontrack=e=>{if(current!==epoch)return;const incoming=e.streams[0]||new MediaStream([e.track]);player.srcObject=incoming;attachMeter(incoming,'output');player.play().catch(()=>{if(current===epoch){playbackBlocked=true;player.hidden=false;update();}});};
   stream.getTracks().forEach(t=>connection.addTrack(t,stream));dc=connection.createDataChannel('oai-events');
   dc.onmessage=e=>{if(current!==epoch)return;try{onEvent(JSON.parse(e.data));}catch{toast('A voice event could not be read.',true);}};
   connection.onconnectionstatechange=()=>{if(current===epoch&&['failed','disconnected'].includes(connection.connectionState))stop('Connection ended.');};
   dc.onopen=()=>{if(current!==epoch)return;phase='listening';responding=true;update();send({type:'response.create',response:{instructions:'Briefly greet the creator and invite them to continue brainstorming based on the project context. Do not perform project actions.'}});settle();};
   const offer=await connection.createOffer();await connection.setLocalDescription(offer);
   await new Promise((resolve,reject)=>{
    if(connection.iceGatheringState==='complete')return resolve();
    const timeout=setTimeout(()=>reject(new Error('Voice connection timed out. Try again.')),10000);
    const check=()=>{if(connection.iceGatheringState==='complete'){clearTimeout(timeout);connection.removeEventListener('icegatheringstatechange',check);resolve();}};
    connection.addEventListener('icegatheringstatechange',check);
   });
   if(current!==epoch)return;
   const r=await fetch('/api/voice/session',{method:'POST',headers:{'Content-Type':'application/json','X-AIM-Token':token,'X-Workspace-ID':workspace},body:JSON.stringify({sdp:connection.localDescription.sdp})});
   const result=await r.json();if(!r.ok)throw new Error(result.error||'Voice could not connect.');
   if(current!==epoch){await closeSession(result.session_id,[],workspace);return;}
   sid=result.session_id;await connection.setRemoteDescription({type:'answer',sdp:result.sdp});
   if(current!==epoch)return;started=lastActivity=Date.now();clock();
   timer=setInterval(()=>{clock();if(Date.now()-started>result.max_seconds*1000||Date.now()-lastActivity>result.idle_seconds*1000)stop('Voice session ended at its time or inactivity limit.');},1000);
  }catch(e){if(current===epoch){await stop();toast(e.name==='NotAllowedError'?'Allow microphone access, then try again.':e.message,true);}}
 }
 async function closeSession(id,sessionUsage,workspace=S.workspace_id){
  if(!id)return;
  try{const r=await fetch('/api/voice/close',{method:'POST',headers:{'Content-Type':'application/json','X-AIM-Token':token,'X-Workspace-ID':workspace},body:JSON.stringify({session_id:id,usage:sessionUsage})});if(!r.ok)throw new Error();}catch{toast('Could not record voice-session closure. The microphone has stopped.',true);}
 }
 async function stop(message){
  if(ending)return ending;if(!active()&&!sid)return;
  ending=(async()=>{
   phase='stopping';update();send({type:'response.cancel'});send({type:'output_audio_buffer.clear'});
   // Persist partial replies; server VAD still handles automatic interruption.
   for(const [id,t] of turns){if(t.phase==='pending')persist(id,t.role,t.text,t.text?'interrupted':'failed');}
   epoch++;if(timer)clearInterval(timer);timer=null;releaseMeters();
   stream?.getTracks().forEach(t=>t.stop());stream=null;dc?.close();pc?.close();dc=null;pc=null;
   if(audio){audio.onplaying=null;audio.pause();audio.srcObject=null;audio.hidden=true;}audio=null;
   const id=sid,sessionUsage=usage;sid=null;await queue;await closeSession(id,sessionUsage);phase='idle';muted=false;started=0;playbackBlocked=false;update();
   if(page==='idea'){try{await api('state');render();}catch(e){toast(e.message,true);}}
   if(message)toast(message);
  })();try{await ending;}finally{ending=null;}
 }
 function toggleMute(){if(!stream||['idle','stopping'].includes(phase))return;muted=!muted;stream.getAudioTracks().forEach(track=>track.enabled=!muted);if(muted)userSpeaking=false;update();}
 async function typeInstead(){await stop();document.querySelector('#chat-message')?.focus();}
 function interrupt(){if(!active())return;if(lastAssistant){const t=turns.get(lastAssistant);if(t){t.phase='interrupted';paintTurn(t);persist(lastAssistant,'assistant',t.text,'interrupted');}}send({type:'response.cancel'});send({type:'output_audio_buffer.clear'});playing=responding=false;settle();}
 function typed(text){
  if(!active()||dc?.readyState!=='open')return false;
  const id='typed_'+Date.now(),t=row(id,'user');if(t){t.text=text;t.phase='complete';paintTurn(t);}persist(id,'user',text);
  send({type:'conversation.item.create',item:{id,type:'message',role:'user',content:[{type:'input_text',text}]}});send({type:'response.create'});responding=true;settle();return true;
 }
 document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseAnimation();else animate();});
 motion?.addEventListener?.('change',()=>{pauseAnimation();if(wave)bars.forEach(bar=>bar.style.removeProperty('transform'));animate();});
 window.addEventListener('pagehide',()=>{if(active())stop();});
 return {active,begin,stop,cancel:stop,controls,update,toggleMute,typeInstead,interrupt,typed,stopPlayback:()=>{},speak:()=>{},speakLast:()=>{}};
})();
