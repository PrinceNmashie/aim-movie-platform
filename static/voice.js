'use strict';
window.AIMVoice=(()=>{
 let phase='idle',pc=null,dc=null,stream=null,audio=null,sid=null,epoch=0,queue=Promise.resolve(),timer=null,started=0,lastActivity=0,turns=new Map(),usage=[],lastAssistant=null,ending=null;
 const active=()=>phase!=='idle';
 const supported=()=>!!(navigator.mediaDevices?.getUserMedia && window.RTCPeerConnection);
 function send(event){if(dc?.readyState==='open')dc.send(JSON.stringify(event));}
 function update(){
  const start=document.querySelector('#voice-start'),stop=document.querySelector('#voice-stop'),status=document.querySelector('#voice-status');
  if(start)start.hidden=active();if(stop)stop.hidden=!active();
  if(status)status.textContent=({idle:'Start a live voice conversation. You can interrupt MIA while it speaks.',connecting:'Connecting your microphone…',listening:'Listening · speak naturally',thinking:'MIA is thinking…',speaking:'MIA is speaking · interrupt whenever you like',stopping:'Saving the conversation…'})[phase]||phase;
 }
 function controls(){return `<div class="voice-toolbar"><div class="row wrap"><button type="button" class="button secondary small" id="voice-start" data-action="voice-start" ${!supported() || !S.configured.openai || !S.platform.paid_enabled?'disabled':''}>◉ Talk with MIA</button><button type="button" class="button primary small" id="voice-stop" data-action="voice-stop" hidden>■ Stop conversation</button><button type="button" class="button ghost small" data-action="voice-interrupt">Interrupt MIA</button><span id="voice-status" role="status"></span></div><p class="hint">AI-generated voice. Uses your OpenAI API balance. Your microphone stays on until Stop, leaving this page, 90 seconds of inactivity, or the 10-minute session limit. Spoken turns appear in this conversation. Headphones help avoid echo.</p><audio id="aim-voice-audio" controls hidden></audio></div>`;}
 function row(item,role){
  if(turns.has(item))return turns.get(item);
  const thread=document.querySelector('#chat-thread');if(!thread)return null;
  const node=document.createElement('div');node.className='message '+(role==='user'?'user':'ai');
  node.innerHTML=`<span class="avatar ${role==='assistant'?'ai':''}">${role==='user'?'Y':'M'}</span><div class="message-body"><div class="message-author">${role==='user'?'You · voice':'MIA · voice'}</div><div class="message-copy"></div></div>`;
  thread.append(node);const t={role,text:'',node:node.querySelector('.message-copy'),phase:'pending'};turns.set(item,t);thread.scrollTop=thread.scrollHeight;return t;
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
  lastActivity=Date.now();const type=e.type;
  if(type==='session.created' || type==='session.updated'){phase='listening';update();}
  if(type==='input_audio_buffer.speech_started'){
   phase='listening';if(e.item_id){row(e.item_id,'user');persist(e.item_id,'user','','pending');}
   update();
  }
  if(type==='input_audio_buffer.speech_stopped'){phase='thinking';update();}
  if(type==='conversation.item.input_audio_transcription.completed'){
   const t=row(e.item_id,'user');if(t){t.text=e.transcript||'';t.node.textContent=t.text;t.phase='complete';persist(e.item_id,'user',t.text);}
  }
  if(type==='conversation.item.input_audio_transcription.failed'){
   const t=row(e.item_id,'user');if(t){t.node.textContent='Voice transcription unavailable. Please type that idea to keep it in the saved conversation.';persist(e.item_id,'user','','failed');}
  }
  if(type==='response.output_audio_transcript.delta'){
   const t=row(e.item_id,'assistant');if(t){lastAssistant=e.item_id;t.text+=e.delta||'';t.node.textContent=t.text;phase='speaking';update();}
  }
  if(type==='response.output_audio_transcript.done'){
   const t=row(e.item_id,'assistant');if(t){t.text=e.transcript||t.text;t.node.textContent=t.text;if(t.phase!=='interrupted')t.phase='complete';persist(e.item_id,'assistant',t.text,t.phase==='interrupted'?'interrupted':'complete');}
  }
  if(type==='conversation.item.truncated'){
   const t=turns.get(e.item_id);if(t){t.phase='interrupted';t.node.textContent=t.text+' [Interrupted; text may include unplayed words]';persist(e.item_id,'assistant',t.text,'interrupted');}
  }
  if(type==='response.done'){
   if(e.response?.usage)usage.push(e.response.usage);
   if(e.response?.status==='cancelled' && lastAssistant){const t=turns.get(lastAssistant);if(t){t.phase='interrupted';persist(lastAssistant,'assistant',t.text,'interrupted');}}
   phase='listening';update();
  }
  if(type==='error'){toast(e.error?.message||'The voice service reported an error.',true);}
 }
 async function begin(){
  if(active() || busy)return;if(!supported())return toast('Live voice needs a supported browser on localhost or HTTPS.',true);
  if(dirty && document.querySelector('#chat-message')?.value.trim())return toast('Send your typed message before starting voice.',true);
  const current=++epoch;phase='connecting';turns=new Map();usage=[];update();
  try{
   const media=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   if(current!==epoch){media.getTracks().forEach(t=>t.stop());return;}
   stream=media;pc=new RTCPeerConnection();audio=document.querySelector('#aim-voice-audio')||new Audio();audio.autoplay=true;audio.hidden=false;
   pc.ontrack=e=>{audio.srcObject=e.streams[0];audio.play().catch(()=>toast('Press Play on the voice audio control to hear MIA.'));};
   stream.getTracks().forEach(t=>pc.addTrack(t,stream));dc=pc.createDataChannel('oai-events');
   dc.onmessage=e=>{if(current!==epoch)return;try{onEvent(JSON.parse(e.data));}catch{toast('A voice event could not be read.',true);}};
   pc.onconnectionstatechange=()=>{if(current===epoch && ['failed','disconnected'].includes(pc?.connectionState))stop('Connection ended.');};
   dc.onopen=()=>{phase='listening';update();send({type:'response.create',response:{instructions:'Briefly greet the creator and invite them to continue brainstorming based on the project context. Do not perform project actions.'}});};
   const offer=await pc.createOffer();await pc.setLocalDescription(offer);
   await new Promise((resolve,reject)=>{
    if(pc.iceGatheringState==='complete')return resolve();
    const timeout=setTimeout(()=>reject(new Error('Voice connection timed out. Try again.')),10000);
    const check=()=>{if(pc?.iceGatheringState==='complete'){clearTimeout(timeout);pc.removeEventListener('icegatheringstatechange',check);resolve();}};
    pc.addEventListener('icegatheringstatechange',check);
   });
   const r=await fetch('/api/voice/session',{method:'POST',headers:{'Content-Type':'application/json','X-AIM-Token':token,'X-Workspace-ID':S.workspace_id},body:JSON.stringify({sdp:pc.localDescription.sdp})});
   const result=await r.json();if(!r.ok)throw new Error(result.error||'Voice could not connect.');
   sid=result.session_id;
   if(current!==epoch){await closeSaved();return;}
   await pc.setRemoteDescription({type:'answer',sdp:result.sdp});started=lastActivity=Date.now();
   timer=setInterval(()=>{if(Date.now()-started>result.max_seconds*1000 || Date.now()-lastActivity>result.idle_seconds*1000)stop('Voice session ended at its time or inactivity limit.');},1000);
  }catch(e){if(current===epoch){await stop();toast(e.name==='NotAllowedError'?'Allow microphone access, then try again.':e.message,true);}}
 }
 async function closeSaved(){
  if(!sid)return;const id=sid;sid=null;
  try{await fetch('/api/voice/close',{method:'POST',headers:{'Content-Type':'application/json','X-AIM-Token':token,'X-Workspace-ID':S.workspace_id},body:JSON.stringify({session_id:id,usage})});}catch{toast('Could not record voice-session closure. The microphone has stopped.',true);}
 }
 async function stop(message){
  if(ending)return ending;
  if(!active()&&!sid)return;
  ending=(async()=>{
   phase='stopping';update();send({type:'response.cancel'});send({type:'output_audio_buffer.clear'});
   // Save partial replies before releasing media. Server-side WebRTC handles spoken interruption truncation.
   for(const [id,t] of turns){if(t.phase==='pending')persist(id,t.role,t.text,t.text?'interrupted':'failed');}
   epoch++;if(timer)clearInterval(timer);timer=null;
   stream?.getTracks().forEach(t=>t.stop());stream=null;dc?.close();pc?.close();dc=null;pc=null;
   if(audio){audio.pause();audio.srcObject=null;}audio=null;
   await queue;await closeSaved();phase='idle';update();
   if(page==='idea'){try{await api('state');render();}catch(e){toast(e.message,true);}}
   if(message)toast(message);
  })();try{await ending;}finally{ending=null;}
 }
 function interrupt(){if(!active())return;if(lastAssistant){const t=turns.get(lastAssistant);if(t){t.phase='interrupted';persist(lastAssistant,'assistant',t.text,'interrupted');}}send({type:'response.cancel'});send({type:'output_audio_buffer.clear'});phase='listening';update();}
 function typed(text){
  if(!active() || dc?.readyState!=='open')return false;
  const id='typed_'+Date.now();const t=row(id,'user');t.text=text;t.node.textContent=text;persist(id,'user',text);
  send({type:'conversation.item.create',item:{id,type:'message',role:'user',content:[{type:'input_text',text}]}});send({type:'response.create'});return true;
 }
 return {active,begin,stop,cancel:stop,controls,update,interrupt,typed,stopPlayback:()=>{},speak:()=>{},speakLast:()=>{}};
})();
