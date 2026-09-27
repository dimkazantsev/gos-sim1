'use client';
import {FormEvent,useEffect,useMemo,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {supabase} from '@/lib/supabase';
import type {ActionItem,Activity,Ballot,Channel,Crisis,Evaluation,EventItem,FormalDocument,FormalHistory,Game,GameDocument,GameProfile,Member,Message,Metric,Party,PartyDocument,Presence,Stage,Vote} from './types';
import {CRISES,INTENSITY_LABEL} from './constants';

export function useRepublicGame(gameId:string){
 const router=useRouter();
 const [game,setGame]=useState<Game|null>(null),[me,setMe]=useState<Member|null>(null),[metrics,setMetrics]=useState<Metric[]>([]),[events,setEvents]=useState<EventItem[]>([]),[actions,setActions]=useState<ActionItem[]>([]),[members,setMembers]=useState<Member[]>([]);
 const [channels,setChannels]=useState<Channel[]>([]),[channelId,setChannelId]=useState(''),[messages,setMessages]=useState<Message[]>([]);
 const [stages,setStages]=useState<Stage[]>([]),[parties,setParties]=useState<Party[]>([]),[votes,setVotes]=useState<Vote[]>([]),[ballots,setBallots]=useState<Ballot[]>([]),[evaluations,setEvaluations]=useState<Evaluation[]>([]),[crises,setCrises]=useState<Crisis[]>([]),[documents,setDocuments]=useState<GameDocument[]>([]),[activities,setActivities]=useState<Activity[]>([]),[presence,setPresence]=useState<Presence[]>([]),[profiles,setProfiles]=useState<GameProfile[]>([]),[partyDocuments,setPartyDocuments]=useState<PartyDocument[]>([]),[formalDocuments,setFormalDocuments]=useState<FormalDocument[]>([]),[formalHistory,setFormalHistory]=useState<FormalHistory[]>([]);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[chatOpen,setChatOpen]=useState(true),[secondsLeft,setSecondsLeft]=useState(0);
 const [recording,setRecording]=useState<'audio'|'video'|null>(null),[realtimeState,setRealtimeState]=useState<'connecting'|'connected'|'disconnected'>('connecting');
 const liveRef=useRef<ReturnType<typeof supabase.channel>|null>(null),channelRef=useRef(''),recorder=useRef<MediaRecorder|null>(null),chunks=useRef<Blob[]>([]);

 const teacher=me?.kind==='teacher';
 const names=useMemo(()=>Object.fromEntries(members.map(x=>[x.user_id,x.full_name])),[members]);
 const currentStage=useMemo(()=>stages.find(s=>s.status==='open')||stages.find(s=>s.stage_no===game?.current_round)||stages[0],[stages,game?.current_round]);
 const myEvaluations=useMemo(()=>evaluations.filter(e=>e.user_id===me?.user_id),[evaluations,me?.user_id]);
 const averageVsn=myEvaluations.length?myEvaluations.reduce((a,b)=>a+b.score,0)/myEvaluations.length:0;

 useEffect(()=>{
  void loadAll();
  const live=supabase.channel('republic:'+gameId)
   .on('postgres_changes',{event:'*',schema:'public',table:'games',filter:'id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'game_members',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'state_metrics',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'game_stages',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'game_parties',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'game_votes',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'game_ballots'},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'game_evaluations',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'game_crises',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'game_events',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'player_actions',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'game_documents',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'game_activity',filter:'game_id=eq.'+gameId},()=>void loadClassroomTelemetry())
   .on('postgres_changes',{event:'*',schema:'public',table:'game_presence',filter:'game_id=eq.'+gameId},()=>void loadClassroomTelemetry())
   .on('postgres_changes',{event:'*',schema:'public',table:'game_profiles',filter:'game_id=eq.'+gameId},()=>void loadPartyAssets())
   .on('postgres_changes',{event:'*',schema:'public',table:'party_documents',filter:'game_id=eq.'+gameId},()=>void loadPartyAssets())
   .on('postgres_changes',{event:'*',schema:'public',table:'formal_documents',filter:'game_id=eq.'+gameId},()=>void loadFormalRegistry())
   .on('postgres_changes',{event:'*',schema:'public',table:'formal_document_history',filter:'game_id=eq.'+gameId},()=>void loadFormalRegistry())
   .on('postgres_changes',{event:'*',schema:'public',table:'chat_channels',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'channel_members'},()=>void loadAll(false))
   .on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_messages',filter:'game_id=eq.'+gameId},()=>{if(channelRef.current)void loadMessages(channelRef.current)})
   .subscribe(status=>{setRealtimeState(status==='SUBSCRIBED'?'connected':status==='CLOSED'||status==='CHANNEL_ERROR'?'disconnected':'connecting')});
  liveRef.current=live;
  return()=>{if(liveRef.current)void supabase.removeChannel(liveRef.current)};
 },[gameId]);

 useEffect(()=>{channelRef.current=channelId;if(channelId)void loadMessages(channelId)},[channelId]);

 useEffect(()=>{
  const tick=()=>{
   if(!game?.turn_ends_at||!game.turn_open){setSecondsLeft(0);return}
   setSecondsLeft(Math.max(0,Math.floor((new Date(game.turn_ends_at).getTime()-Date.now())/1000)));
  };
  tick();const id=setInterval(tick,1000);return()=>clearInterval(id);
 },[game?.turn_ends_at,game?.turn_open]);

 async function loadAll(show=true){
  if(show)setLoading(true);
  const u=(await supabase.auth.getUser()).data.user;
  if(!u){router.replace('/');return}
  const [g,m,mt,ev,ac,mb,ch,st,pa,vo,ba,ge,cr,dc,al,pr,pf,pd,fd,fh]=await Promise.all([
   supabase.from('games').select('*').eq('id',gameId).single(),
   supabase.from('game_members').select('*').eq('game_id',gameId).eq('user_id',u.id).single(),
   supabase.from('state_metrics').select('*').eq('game_id',gameId).order('label'),
   supabase.from('game_events').select('*').eq('game_id',gameId).order('published_at',{ascending:false}).limit(100),
   supabase.from('player_actions').select('*').eq('game_id',gameId).order('submitted_at',{ascending:false}),
   supabase.from('game_members').select('*').eq('game_id',gameId).order('full_name'),
   supabase.from('chat_channels').select('*').eq('game_id',gameId).order('name'),
   supabase.from('game_stages').select('*').eq('game_id',gameId).order('stage_no'),
   supabase.from('game_parties').select('*').eq('game_id',gameId).order('support',{ascending:false}),
   supabase.from('game_votes').select('*').eq('game_id',gameId).order('opened_at',{ascending:false}),
   supabase.from('game_ballots').select('*'),
   supabase.from('game_evaluations').select('*').eq('game_id',gameId).order('stage_no'),
   supabase.from('game_crises').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
   supabase.from('game_documents').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
   supabase.from('game_activity').select('*').eq('game_id',gameId).order('created_at',{ascending:false}).limit(250),
   supabase.from('game_presence').select('*').eq('game_id',gameId).order('last_seen_at',{ascending:false}),
   supabase.from('game_profiles').select('*').eq('game_id',gameId),
   supabase.from('party_documents').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
   supabase.from('formal_documents').select('*').eq('game_id',gameId).order('updated_at',{ascending:false}),
   supabase.from('formal_document_history').select('*').eq('game_id',gameId).order('created_at',{ascending:false})
  ]);
  if(g.error||m.error){setError(g.error?.message||m.error?.message||'Нет доступа к игре');setLoading(false);return}
  setGame(g.data as Game);setMe(m.data as Member);setMetrics((mt.data||[]) as Metric[]);setEvents((ev.data||[]) as EventItem[]);setActions((ac.data||[]) as ActionItem[]);
  setMembers((mb.data||[]) as Member[]);setChannels((ch.data||[]) as Channel[]);setStages((st.data||[]) as Stage[]);setVotes((vo.data||[]) as Vote[]);
  const voteIds=new Set(((vo.data||[]) as Vote[]).map(v=>v.id));setBallots(((ba.data||[]) as Ballot[]).filter(b=>voteIds.has(b.vote_id)));
  setEvaluations((ge.data||[]) as Evaluation[]);setCrises((cr.data||[]) as Crisis[]);setDocuments((dc.data||[]) as GameDocument[]);setActivities((al.data||[]) as Activity[]);setPresence((pr.data||[]) as Presence[]);
  const rawProfiles=(pf.data||[]) as GameProfile[];
  const rawPartyDocs=(pd.data||[]) as PartyDocument[];
  const profileRows=await Promise.all(rawProfiles.map(async x=>x.avatar_path?{...x,avatar_url:(await supabase.storage.from('game-assets').createSignedUrl(x.avatar_path,3600)).data?.signedUrl||null}:x));
  const partyRows=await Promise.all(((pa.data||[]) as Party[]).map(async x=>x.logo_path?{...x,logo_url:(await supabase.storage.from('game-assets').createSignedUrl(x.logo_path,3600)).data?.signedUrl||null}:x));
  const docRows=await Promise.all(rawPartyDocs.map(async x=>({...x,url:(await supabase.storage.from('game-assets').createSignedUrl(x.storage_path,3600)).data?.signedUrl||null})));
  setProfiles(profileRows);setParties(partyRows);setPartyDocuments(docRows);
  const formalRows=await Promise.all(((fd.data||[]) as FormalDocument[]).map(async x=>x.source_file_path?{...x,file_url:(await supabase.storage.from('game-assets').createSignedUrl(x.source_file_path,3600)).data?.signedUrl||null}:x));
  setFormalDocuments(formalRows);setFormalHistory((fh.data||[]) as FormalHistory[]);
  if(!channelRef.current&&ch.data?.[0])setChannelId(ch.data[0].id);
  if(show)setLoading(false);
 }

 async function loadClassroomTelemetry(){
  const [al,pr]=await Promise.all([
   supabase.from('game_activity').select('*').eq('game_id',gameId).order('created_at',{ascending:false}).limit(250),
   supabase.from('game_presence').select('*').eq('game_id',gameId).order('last_seen_at',{ascending:false})
  ]);
  if(!al.error)setActivities((al.data||[]) as Activity[]);
  if(!pr.error)setPresence((pr.data||[]) as Presence[]);
 }

 async function loadPartyAssets(){
  const [pa,pf,pd]=await Promise.all([
   supabase.from('game_parties').select('*').eq('game_id',gameId).order('support',{ascending:false}),
   supabase.from('game_profiles').select('*').eq('game_id',gameId),
   supabase.from('party_documents').select('*').eq('game_id',gameId).order('created_at',{ascending:false})
  ]);
  if(!pa.error){
   const rows=await Promise.all(((pa.data||[]) as Party[]).map(async x=>x.logo_path?{...x,logo_url:(await supabase.storage.from('game-assets').createSignedUrl(x.logo_path,3600)).data?.signedUrl||null}:x));
   setParties(rows);
  }
  if(!pf.error){
   const rows=await Promise.all(((pf.data||[]) as GameProfile[]).map(async x=>x.avatar_path?{...x,avatar_url:(await supabase.storage.from('game-assets').createSignedUrl(x.avatar_path,3600)).data?.signedUrl||null}:x));
   setProfiles(rows);
  }
  if(!pd.error){
   const rows=await Promise.all(((pd.data||[]) as PartyDocument[]).map(async x=>({...x,url:(await supabase.storage.from('game-assets').createSignedUrl(x.storage_path,3600)).data?.signedUrl||null})));
   setPartyDocuments(rows);
  }
 }

 async function loadFormalRegistry(){
  const [fd,fh]=await Promise.all([
   supabase.from('formal_documents').select('*').eq('game_id',gameId).order('updated_at',{ascending:false}),
   supabase.from('formal_document_history').select('*').eq('game_id',gameId).order('created_at',{ascending:false})
  ]);
  if(!fd.error){
   const rows=await Promise.all(((fd.data||[]) as FormalDocument[]).map(async x=>x.source_file_path?{...x,file_url:(await supabase.storage.from('game-assets').createSignedUrl(x.source_file_path,3600)).data?.signedUrl||null}:x));
   setFormalDocuments(rows);
  }
  if(!fh.error)setFormalHistory((fh.data||[]) as FormalHistory[]);
 }

 async function loadMessages(cid:string){
  const r=await supabase.from('chat_messages').select('*').eq('channel_id',cid).order('created_at').limit(150);
  const rows=await Promise.all(((r.data||[]) as Message[]).map(async m=>{if(!m.storage_path)return m;const x=await supabase.storage.from('game-media').createSignedUrl(m.storage_path,3600);return {...m,url:x.data?.signedUrl||null}}));
  setMessages(rows);
 }
 async function refresh(){await loadAll(false);if(channelRef.current)await loadMessages(channelRef.current)}

 async function logActivity(eventType:string,label:string,viewKey?:string,payload:Record<string,unknown>={}){
  const u=(await supabase.auth.getUser()).data.user;if(!u)return;
  await supabase.from('game_activity').insert({game_id:gameId,actor_id:u.id,event_type:eventType,label,view_key:viewKey||null,payload});
 }
 async function touchPresence(viewKey:string,label?:string){
  const u=(await supabase.auth.getUser()).data.user;if(!u)return;
  await supabase.from('game_presence').upsert({game_id:gameId,user_id:u.id,current_view:viewKey,last_seen_at:new Date().toISOString()},{onConflict:'game_id,user_id'});
  if(label)await logActivity('navigation',label,viewKey);
 }

 async function logout(){await supabase.auth.signOut();router.replace('/')}
 async function setTurn(open:boolean){const r=await supabase.from('games').update({turn_open:open,status:open?'running':'paused',turn_ends_at:open?new Date(Date.now()+12*60*1000).toISOString():null}).eq('id',gameId);if(r.error)setError(r.error.message);else await refresh()}
 async function setTurnMinutes(minutes:number){if(!game)return;const r=await supabase.from('games').update({turn_open:true,status:'running',turn_ends_at:new Date(Date.now()+minutes*60*1000).toISOString()}).eq('id',gameId);if(r.error)setError(r.error.message);else await refresh()}

 async function openStage(stageNo:number){
  if(!teacher)return;
  const r=await supabase.rpc('set_game_stage',{p_game_id:gameId,p_stage_no:stageNo,p_minutes:12});
  if(r.error)setError(r.error.message);else await refresh();
 }
 async function nextStage(){await openStage(Math.min(16,(currentStage?.stage_no||1)+1))}
 async function setStageDeadline(stageId:string,value:string){const r=await supabase.from('game_stages').update({deadline:value?new Date(value).toISOString():null}).eq('id',stageId);if(r.error)setError(r.error.message);else await refresh()}

 async function submitAction(e:FormEvent,data:{type:string;title:string;body:string;budget:number}){
  e.preventDefault();if(!me||!game)return false;
  const r=await supabase.from('player_actions').insert({game_id:gameId,round_no:currentStage?.stage_no||game.current_round,author_id:me.user_id,action_type:data.type,title:data.title,body:data.body,budget:data.budget,status:'submitted'});
  if(r.error){setError(r.error.message);return false}await refresh();return true;
 }
 async function judgeAction(id:string,status:'accepted'|'rejected'){const r=await supabase.from('player_actions').update({status,reviewed_by:me?.user_id,reviewed_at:new Date().toISOString()}).eq('id',id);if(r.error)setError(r.error.message);else await refresh()}

 async function createParty(name:string,ideology:string){
  if(!teacher||!me||!name.trim())return false;const n=name.trim();const colors=['#6f7cff','#4dc9ff','#55d99b','#ff8d72','#c77dff'];
  const p=await supabase.from('game_parties').insert({game_id:gameId,name:n,ideology:ideology.trim()||null,color:colors[parties.length%colors.length]});
  if(p.error){setError(p.error.message);return false}
  const c=await supabase.from('chat_channels').insert({game_id:gameId,name:'Фракция · '+n,kind:'team',created_by:me.user_id});if(c.error)setError(c.error.message);
  await refresh();return true;
 }
 async function updateParty(id:string,patch:Partial<Party>){const r=await supabase.from('game_parties').update(patch).eq('id',id);if(r.error)setError(r.error.message);else await refresh()}
 async function assignParty(userId:string,team:string){
  const r=await supabase.from('game_members').update({team:team||null}).eq('game_id',gameId).eq('user_id',userId);if(r.error){setError(r.error.message);return}
  const teamChannels=channels.filter(c=>c.kind==='team');if(teamChannels.length)await supabase.from('channel_members').delete().eq('user_id',userId).in('channel_id',teamChannels.map(c=>c.id));
  if(team){const c=teamChannels.find(x=>x.name==='Фракция · '+team);if(c)await supabase.from('channel_members').upsert({channel_id:c.id,user_id:userId})}
  await refresh();
 }
 async function updateMember(userId:string,patch:Partial<Pick<Member,'role_title'|'score'>>){const r=await supabase.from('game_members').update(patch).eq('game_id',gameId).eq('user_id',userId);if(r.error)setError(r.error.message);else await refresh()}

 async function createVote(data:{title:string;body:string;mode:'member'|'faction'|'mandate'}){
  if(!teacher||!me||!data.title.trim())return false;const r=await supabase.from('game_votes').insert({game_id:gameId,stage_no:currentStage?.stage_no||1,title:data.title.trim(),body:data.body.trim()||null,voting_mode:data.mode,created_by:me.user_id});
  if(r.error){setError(r.error.message);return false}await refresh();return true;
 }
 function partyForUser(uid:string){const m=members.find(x=>x.user_id===uid);return parties.find(p=>p.name===m?.team)}
 function canVote(v:Vote){if(!me)return false;if(v.voting_mode==='member')return me.kind!=='observer';const p=partyForUser(me.user_id);return !!p&&p.leader_user_id===me.user_id}
 function ballotWeight(v:Vote){if(v.voting_mode==='member')return 1;const p=partyForUser(me?.user_id||'');if(!p)return 0;return v.voting_mode==='mandate'?Math.max(1,p.mandates):1}
 function quorum(v:Vote){const eligible=v.voting_mode==='member'?members.filter(m=>m.kind==='student').length:parties.filter(p=>p.leader_user_id).length;const cast=ballots.filter(b=>b.vote_id===v.id).length;return {eligible,cast,needed:Math.ceil(eligible*2/3),met:eligible>0&&cast>=Math.ceil(eligible*2/3)}}
 function tally(v:Vote){const x=ballots.filter(b=>b.vote_id===v.id);const yes=x.filter(b=>b.choice==='yes').reduce((a,b)=>a+Number(b.weight),0),no=x.filter(b=>b.choice==='no').reduce((a,b)=>a+Number(b.weight),0);return {yes,no,total:yes+no}}
 async function castVote(v:Vote,choice:'yes'|'no'){if(!me||!canVote(v))return;const r=await supabase.from('game_ballots').upsert({vote_id:v.id,voter_id:me.user_id,choice,weight:ballotWeight(v)},{onConflict:'vote_id,voter_id'});if(r.error)setError(r.error.message);else await refresh()}
 async function closeVote(id:string){const r=await supabase.from('game_votes').update({status:'closed',closed_at:new Date().toISOString()}).eq('id',id);if(r.error)setError(r.error.message);else await refresh()}

 async function setEvaluation(userId:string,score:number,note?:string){
  if(!teacher||!me||!currentStage)return;const old=evaluations.find(e=>e.user_id===userId&&e.stage_no===currentStage.stage_no);
  const payload={score,note:note||old?.note||null,evaluator_id:me.user_id,updated_at:new Date().toISOString()};
  const r=old?await supabase.from('game_evaluations').update(payload).eq('id',old.id):await supabase.from('game_evaluations').insert({game_id:gameId,stage_no:currentStage.stage_no,user_id:userId,...payload});
  if(r.error){setError(r.error.message);return}
  await refresh();
 }

 async function publishEvent(title:string,body:string,severity='notice',category='Режиссёрская'){if(!me||!title.trim()||!body.trim())return false;const r=await supabase.from('game_events').insert({game_id:gameId,round_no:currentStage?.stage_no||1,category,severity,title:title.trim(),body:body.trim(),created_by:me.user_id});if(r.error){setError(r.error.message);return false}await refresh();return true}
 async function triggerCrisis(){
  if(!teacher||!me)return;const c=CRISES[Math.floor(Math.random()*CRISES.length)];const keys=['low','medium','high','ultra'] as const;const intensity=keys[Math.floor(Math.random()*keys.length)];const description=c.levels[intensity];
  const cr=await supabase.from('game_crises').insert({game_id:gameId,stage_no:15,crisis_type:c.type,intensity,description,created_by:me.user_id});
  const ev=await supabase.from('game_events').insert({game_id:gameId,round_no:currentStage?.stage_no||15,category:'Кризис',severity:intensity==='ultra'?'critical':intensity==='high'?'warning':'notice',title:c.type+' · '+INTENSITY_LABEL[intensity],body:description,created_by:me.user_id});
  if(cr.error||ev.error)setError(cr.error?.message||ev.error?.message||'Ошибка кризиса');else await refresh();
 }
 async function ghostVoting(){
  if(!teacher||!me||!parties.length){setError('Сначала создайте партии.');return}const loss=25+Math.floor(Math.random()*26);const p=parties[Math.floor(Math.random()*parties.length)];const description='Ghost voting: фракция «'+p.name+'» случайно теряет '+loss+' депутатов на ближайшем заседании ГД.';
  const cr=await supabase.from('game_crises').insert({game_id:gameId,stage_no:5,crisis_type:'Ghost voting',intensity:'medium',description,created_by:me.user_id});
  const ev=await supabase.from('game_events').insert({game_id:gameId,round_no:5,category:'Ghost voting',severity:'warning',title:'Результат ghost voting',body:description,created_by:me.user_id});
  if(cr.error||ev.error)setError(cr.error?.message||ev.error?.message||'Ошибка ghost voting');else await refresh();
 }

 async function createDocument(data:{title:string;type:string;body:string}){if(!teacher||!me||!data.title.trim())return false;const r=await supabase.from('game_documents').insert({game_id:gameId,title:data.title.trim(),doc_type:data.type.trim()||'Документ',body:data.body.trim()||null,created_by:me.user_id});if(r.error){setError(r.error.message);return false}await refresh();return true}

 async function updateMetric(id:string,value:number){if(!teacher)return;const m=metrics.find(x=>x.id===id);const r=await supabase.from('state_metrics').update({previous_value:m?.value??null,value,updated_at:new Date().toISOString()}).eq('id',id);if(r.error)setError(r.error.message);else await refresh()}

 async function saveProfile(bio:string,file?:File){
  if(!me)return false;
  let avatarPath=profiles.find(x=>x.user_id===me.user_id)?.avatar_path||null;
  if(file){
    const ext=(file.name.split('.').pop()||'jpg').toLowerCase();
    const path=gameId+'/profiles/'+me.user_id+'/avatar-'+Date.now()+'.'+ext;
    const up=await supabase.storage.from('game-assets').upload(path,file,{upsert:true,contentType:file.type});
    if(up.error){setError(up.error.message);return false}
    avatarPath=path;
  }
  const r=await supabase.from('game_profiles').upsert({game_id:gameId,user_id:me.user_id,bio:bio.trim()||null,avatar_path:avatarPath,updated_at:new Date().toISOString()},{onConflict:'game_id,user_id'});
  if(r.error){setError(r.error.message);return false}
  await loadPartyAssets();return true;
 }
 async function savePartyIdentity(partyId:string,description:string,file?:File){
  let logoPath=parties.find(x=>x.id===partyId)?.logo_path||null;
  if(file){
    const ext=(file.name.split('.').pop()||'png').toLowerCase();
    const path=gameId+'/parties/'+partyId+'/logo-'+Date.now()+'.'+ext;
    const up=await supabase.storage.from('game-assets').upload(path,file,{upsert:true,contentType:file.type});
    if(up.error){setError(up.error.message);return false}
    logoPath=path;
  }
  const r=await supabase.rpc('update_my_party_identity',{p_party_id:partyId,p_description:description.trim()||null,p_logo_path:logoPath});
  if(r.error){setError(r.error.message);return false}
  await loadPartyAssets();return true;
 }
 async function uploadPartyDocument(partyId:string,kind:PartyDocument['doc_kind'],title:string,file:File){
  if(!me)return false;
  const ext=(file.name.split('.').pop()||'bin').toLowerCase();
  const path=gameId+'/parties/'+partyId+'/docs/'+crypto.randomUUID()+'.'+ext;
  const up=await supabase.storage.from('game-assets').upload(path,file,{contentType:file.type});
  if(up.error){setError(up.error.message);return false}
  const r=await supabase.from('party_documents').insert({game_id:gameId,party_id:partyId,doc_kind:kind,title:title.trim()||file.name,storage_path:path,file_name:file.name,mime_type:file.type||null,file_size:file.size,uploaded_by:me.user_id,status:'submitted'});
  if(r.error){setError(r.error.message);return false}
  await loadPartyAssets();return true;
 }
 async function reviewPartyDocument(id:string,status:'accepted'|'revision',note?:string){
  if(!teacher)return;
  const r=await supabase.from('party_documents').update({status,note:note?.trim()||null}).eq('id',id);
  if(r.error)setError(r.error.message);else await loadPartyAssets();
 }

 async function createFormalDocument(data:{stageNo:number;title:string;docType:string;subjectKey:string;subjectLabel:string;bodyText:string;workflowKey:string;metadata?:Record<string,unknown>},file?:File){
  if(!me)return null;
  let filePath:string|null=null;
  if(file){
   const ext=(file.name.split('.').pop()||'bin').toLowerCase();
   filePath=gameId+'/formal/'+me.user_id+'/'+crypto.randomUUID()+'.'+ext;
   const up=await supabase.storage.from('game-assets').upload(filePath,file,{contentType:file.type||'application/octet-stream'});
   if(up.error){setError(up.error.message);return null}
  }
  const r=await supabase.rpc('create_formal_document',{
   p_game_id:gameId,p_stage_no:data.stageNo,p_title:data.title,p_doc_type:data.docType,
   p_subject_key:data.subjectKey,p_subject_label:data.subjectLabel,p_body_text:data.bodyText||'',
   p_file_path:filePath,p_file_name:file?.name||null,p_mime:file?.type||null,p_workflow_key:data.workflowKey,
   p_metadata:data.metadata||{}
  });
  if(r.error){setError(r.error.message);return null}
  await loadFormalRegistry();return r.data as string;
 }
 async function advanceFormalDocument(id:string,action:'advance'|'return'|'reject'='advance',note?:string){
  const r=await supabase.rpc('advance_formal_document',{p_document_id:id,p_action:action,p_note:note||null});
  if(r.error){setError(r.error.message);return false}
  await loadFormalRegistry();return true;
 }
 async function updateFormalDraft(id:string,title:string,bodyText:string,metadata?:Record<string,unknown>){
  const r=await supabase.rpc('update_formal_draft',{p_document_id:id,p_title:title,p_body_text:bodyText,p_metadata:metadata||null});
  if(r.error){setError(r.error.message);return false}
  await loadFormalRegistry();return true;
 }

 async function sendText(text:string){if(!me||!channelId||!text.trim())return false;const r=await supabase.from('chat_messages').insert({game_id:gameId,channel_id:channelId,author_id:me.user_id,kind:'text',text:text.trim()});if(r.error){setError(r.error.message);return false}await loadMessages(channelId);return true}
 async function toggleRecording(kind:'audio'|'video'){
  if(recorder.current?.state==='recording'){recorder.current.stop();return}
  if(!me||!channelId)return;
  try{
   const stream=await navigator.mediaDevices.getUserMedia(kind==='audio'?{audio:true}:{audio:true,video:{facingMode:'user'}});chunks.current=[];const rec=new MediaRecorder(stream);recorder.current=rec;setRecording(kind);
   rec.ondataavailable=e=>e.data.size&&chunks.current.push(e.data);
   rec.onstop=async()=>{const mime=rec.mimeType||'video/webm',blob=new Blob(chunks.current,{type:mime}),path=gameId+'/'+channelId+'/'+me.user_id+'/'+crypto.randomUUID()+'.webm';const up=await supabase.storage.from('game-media').upload(path,blob,{contentType:mime});if(up.error)setError(up.error.message);else await supabase.from('chat_messages').insert({game_id:gameId,channel_id:channelId,author_id:me.user_id,kind,storage_path:path,mime_type:mime});stream.getTracks().forEach(t=>t.stop());recorder.current=null;setRecording(null);await loadMessages(channelId)};
   rec.start();
  }catch(e){setError(e instanceof Error?e.message:'Нет доступа к микрофону/камере')}
 }

 return {game,me,metrics,events,actions,members,channels,channelId,setChannelId,messages,stages,parties,votes,ballots,evaluations,crises,documents,activities,presence,profiles,partyDocuments,formalDocuments,formalHistory,loading,error,setError,chatOpen,setChatOpen,recording,secondsLeft,realtimeState,teacher,names,currentStage,myEvaluations,averageVsn,
  logout,touchPresence,logActivity,setTurn,setTurnMinutes,openStage,nextStage,setStageDeadline,submitAction,judgeAction,createParty,updateParty,assignParty,updateMember,createVote,canVote,castVote,closeVote,tally,quorum,setEvaluation,publishEvent,triggerCrisis,ghostVoting,createDocument,updateMetric,saveProfile,savePartyIdentity,uploadPartyDocument,reviewPartyDocument,createFormalDocument,advanceFormalDocument,updateFormalDraft,sendText,toggleRecording};
}
