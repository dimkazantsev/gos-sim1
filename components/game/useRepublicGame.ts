'use client';
import {userError} from '@/lib/userError';
import {VOTING_BODIES,bodyQuorum} from './votingBodies';
import {FormEvent,useEffect,useMemo,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {supabase} from '@/lib/supabase';
import type {ActionItem,Activity,Ballot,Channel,ChatPin,Crisis,Evaluation,EventItem,FormalDocument,FormalHistory,Game,GameDocument,GameProfile,ImpactLedger,ImpactRule,Member,Message,Metric,MetricHistory,Party,PartyAgreement,PartyDocument,PartyInvitation,PartyMandateAllocation,PartySupportHistory,PoliticalPost,PoliticalPostFormalLink,PoliticalPostMedia,Presence,Stage,Vote} from './types';
import {CRISES} from './constants';
import {CHAT_MAX_FILE_BYTES,preferredRecordingMime,recordingFileName,uploadedChatKind,inferChatMime} from './recordingMedia';
import type {ChatMediaKind} from './recordingMedia';
import {sendChatMedia} from './chatMediaTransport';
import {analyseVoiceBlob} from './voiceWaveform';
import {currentGameMembers,currentGameProfiles} from './gameRoster';
import type {GameOfficeAssignment} from './types';
import type {PendingMediaUpload,MediaUploadPhase} from './chatMediaTransport';
export type RecordingPreview={kind:ChatMediaKind;blob:Blob;url:string;mime:string;fileName:string;channelId:string;duration:number;waveform?:number[]};

export function useRepublicGame(gameId:string){
 const router=useRouter();
 const setError=(value:unknown)=>setErrorRaw(userError(value));
 const [game,setGame]=useState<Game|null>(null),[me,setMe]=useState<Member|null>(null),[metrics,setMetrics]=useState<Metric[]>([]),[events,setEvents]=useState<EventItem[]>([]),[actions,setActions]=useState<ActionItem[]>([]),[memberRows,setMembers]=useState<Member[]>([]);
 const [officeRows,setOfficeRows]=useState<GameOfficeAssignment[]>([]);
 const activeGameRef=useRef(gameId),officeRequest=useRef(0);activeGameRef.current=gameId;
 const members=useMemo(()=>currentGameMembers(memberRows,gameId),[memberRows,gameId]);
 const [channels,setChannels]=useState<Channel[]>([]),[channelId,setChannelId]=useState(''),[messages,setMessages]=useState<Message[]>([]),[chatPins,setChatPins]=useState<ChatPin[]>([]),[pinnedMessages,setPinnedMessages]=useState<Message[]>([]),[chatLoading,setChatLoading]=useState(false);
 const [stages,setStages]=useState<Stage[]>([]),[parties,setParties]=useState<Party[]>([]),[votes,setVotes]=useState<Vote[]>([]),[ballots,setBallots]=useState<Ballot[]>([]),[evaluations,setEvaluations]=useState<Evaluation[]>([]),[crises,setCrises]=useState<Crisis[]>([]),[documents,setDocuments]=useState<GameDocument[]>([]),[activities,setActivities]=useState<Activity[]>([]),[presence,setPresence]=useState<Presence[]>([]),[profileRows,setProfiles]=useState<GameProfile[]>([]),[partyDocuments,setPartyDocuments]=useState<PartyDocument[]>([]),[partyInvitations,setPartyInvitations]=useState<PartyInvitation[]>([]),[partyMandates,setPartyMandateRows]=useState<PartyMandateAllocation[]>([]),[partyAgreements,setPartyAgreements]=useState<PartyAgreement[]>([]),[formalDocuments,setFormalDocuments]=useState<FormalDocument[]>([]),[formalHistory,setFormalHistory]=useState<FormalHistory[]>([]),[politicalPosts,setPoliticalPosts]=useState<PoliticalPost[]>([]),[politicalMedia,setPoliticalMedia]=useState<PoliticalPostMedia[]>([]),[postFormalLinks,setPostFormalLinks]=useState<PoliticalPostFormalLink[]>([]),[metricHistory,setMetricHistory]=useState<MetricHistory[]>([]),[partySupportHistory,setPartySupportHistory]=useState<PartySupportHistory[]>([]),[impactRules,setImpactRules]=useState<ImpactRule[]>([]),[impactLedger,setImpactLedger]=useState<ImpactLedger[]>([]);
 const [loading,setLoading]=useState(true),[error,setErrorRaw]=useState(''),[chatOpen,setChatOpen]=useState(false),[secondsLeft,setSecondsLeft]=useState(0);
 const [profileGameId,setProfileGameId]=useState('');
 const [introAccountSeen,setIntroAccountSeen]=useState(false);
 const [chatMediaError,setChatMediaError]=useState(''),[chatMediaPhase,setChatMediaPhase]=useState<MediaUploadPhase>('idle');
 const [recording,setRecording]=useState<ChatMediaKind|null>(null),[recordingPreview,setRecordingPreview]=useState<RecordingPreview|null>(null),[recordingSaving,setRecordingSaving]=useState(false),[recordingStartedAt,setRecordingStartedAt]=useState<number|null>(null),[realtimeState,setRealtimeState]=useState<'connecting'|'connected'|'disconnected'>('connecting');
 const liveRef=useRef<ReturnType<typeof supabase.channel>|null>(null),channelRef=useRef(''),recorder=useRef<MediaRecorder|null>(null),chunks=useRef<Blob[]>([]);
 const videoLimitTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const recordingStream=useRef<MediaStream|null>(null),previewRef=useRef<RecordingPreview|null>(null),captureRef=useRef<{kind:ChatMediaKind;channelId:string;started:number;discard:boolean}|null>(null),mediaOperationRef=useRef(false),pendingChatUploads=useRef(new WeakMap<Blob,PendingMediaUpload>()),voiceAnalysisRef=useRef<Promise<{waveform:number[];duration:number}|null>|null>(null);

 const profiles=useMemo(()=>currentGameProfiles(profileRows,members,gameId),[profileRows,members,gameId]);
 const officeAssignments=useMemo(()=>officeRows.filter(o=>o.game_id===gameId&&members.some(m=>m.user_id===o.user_id)),[officeRows,members,gameId]);
 const teacher=me?.kind==='teacher';
 const names=useMemo(()=>Object.fromEntries(memberRows.filter(m=>m.game_id===gameId).map(x=>[x.user_id,x.full_name])),[memberRows,gameId]);
 const currentStage=useMemo(()=>stages.find(s=>s.status==='open')||stages.find(s=>s.stage_no===game?.current_round)||stages[0],[stages,game?.current_round]);
 const myEvaluations=useMemo(()=>evaluations.filter(e=>e.user_id===me?.user_id),[evaluations,me?.user_id]);
 const averageVsn=myEvaluations.length?myEvaluations.reduce((a,b)=>a+b.score,0)/myEvaluations.length:0;

 // Synchronize an existing simulator while the group works in documents or events.
 // Opening another section must not pause delivery or the application of a published budget.
 const budgetSyncBusy=useRef(false);
 async function syncBudget(){
  if(budgetSyncBusy.current)return;budgetSyncBusy.current=true;
  try{
   const marker=await supabase.from('budget_simulator_state').select('game_id').eq('game_id',gameId).maybeSingle();
   if(marker.data&&activeGameRef.current===gameId){const r=await supabase.rpc('get_budget_simulator',{p_game_id:gameId});if(r.error&&activeGameRef.current===gameId)setError(r.error);}
  }catch(e){if(activeGameRef.current===gameId)setError(e);}
  finally{budgetSyncBusy.current=false;}
 }
 useEffect(()=>{
  if(!me||me.kind==='observer')return;
  void syncBudget();const timer=setInterval(()=>{if(document.visibilityState==='visible')void syncBudget();},30000);
  const resume=()=>{if(document.visibilityState==='visible')void syncBudget();};document.addEventListener('visibilitychange',resume);
  return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',resume);};
 },[gameId,me?.user_id,me?.kind]);

 useEffect(()=>{
  setProfileGameId('');
  void loadAll();
  const live=supabase.channel('republic:'+gameId)
   .on('postgres_changes',{event:'*',schema:'public',table:'games',filter:'id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'game_members',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'game_office_assignments',filter:'game_id=eq.'+gameId},()=>void loadRepublicOffices())
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
   .on('postgres_changes',{event:'*',schema:'public',table:'party_invitations',filter:'game_id=eq.'+gameId},()=>void loadPartyRepresentation())
   .on('postgres_changes',{event:'*',schema:'public',table:'party_member_mandates',filter:'game_id=eq.'+gameId},()=>void loadPartyRepresentation())
   .on('postgres_changes',{event:'*',schema:'public',table:'party_agreements',filter:'game_id=eq.'+gameId},()=>void loadPartyRepresentation())
   .on('postgres_changes',{event:'*',schema:'public',table:'formal_documents',filter:'game_id=eq.'+gameId},()=>void loadFormalRegistry())
   .on('postgres_changes',{event:'*',schema:'public',table:'formal_document_history',filter:'game_id=eq.'+gameId},()=>void loadFormalRegistry())
   .on('postgres_changes',{event:'INSERT',schema:'public',table:'event_case_outcomes',filter:'game_id=eq.'+gameId},()=>void syncBudget())
   .on('postgres_changes',{event:'*',schema:'public',table:'political_posts',filter:'game_id=eq.'+gameId},()=>void loadPoliticalWall())
   .on('postgres_changes',{event:'*',schema:'public',table:'political_post_media',filter:'game_id=eq.'+gameId},()=>void loadPoliticalWall())
   .on('postgres_changes',{event:'*',schema:'public',table:'state_metric_history',filter:'game_id=eq.'+gameId},()=>void loadPoliticalWall())
   .on('postgres_changes',{event:'*',schema:'public',table:'impact_rules',filter:'game_id=eq.'+gameId},()=>void loadImpactEngine())
   .on('postgres_changes',{event:'*',schema:'public',table:'impact_ledger',filter:'game_id=eq.'+gameId},()=>void loadImpactEngine())
   .on('postgres_changes',{event:'*',schema:'public',table:'chat_channels',filter:'game_id=eq.'+gameId},()=>void loadAll(false))
   .on('postgres_changes',{event:'*',schema:'public',table:'channel_members'},()=>void loadAll(false))
   .on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_messages',filter:'game_id=eq.'+gameId},()=>{if(channelRef.current)void loadMessages(channelRef.current)})
   .on('postgres_changes',{event:'*',schema:'public',table:'chat_pins',filter:'game_id=eq.'+gameId},()=>{if(channelRef.current)void loadChatPins(channelRef.current)})
   .subscribe(status=>{setRealtimeState(status==='SUBSCRIBED'?'connected':status==='CLOSED'||status==='CHANNEL_ERROR'?'disconnected':'connecting')});
  liveRef.current=live;
  return()=>{if(liveRef.current)void supabase.removeChannel(liveRef.current)};
 },[gameId]);

 useEffect(()=>()=>{
  const rec=recorder.current;
  if(rec&&rec.state!=='inactive'){
   if(captureRef.current)captureRef.current.discard=true;
   rec.stop();
  }
  recordingStream.current?.getTracks().forEach(track=>track.stop());
  if(previewRef.current)URL.revokeObjectURL(previewRef.current.url);
 },[]);

 useEffect(()=>{channelRef.current=channelId;setMessages([]);setChatPins([]);setPinnedMessages([]);if(channelId){void loadMessages(channelId,true);void loadChatPins(channelId)}else setChatLoading(false)},[channelId]);

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
  if(activeGameRef.current!==gameId)return;
  if(!u){router.replace('/');return}
  const access=await supabase.rpc('ensure_my_game_access',{p_game:gameId});
  if(activeGameRef.current!==gameId)return;
  if(access.error){setError(access.error.message);setLoading(false);return}
  const [g,m,mt,ev,ac,mb,ch,st,pa,vo,ba,ge,cr,dc,al,pr,pf,pd,pi,pm,ag,fd,fh,pp,px,pl,mh,psh]=await Promise.all([
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
   supabase.from('party_invitations').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
   supabase.from('party_member_mandates').select('*').eq('game_id',gameId),
   supabase.from('party_agreements').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
   supabase.from('formal_documents').select('*').eq('game_id',gameId).order('updated_at',{ascending:false}),
   supabase.from('formal_document_history').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
   supabase.from('political_posts').select('*').eq('game_id',gameId).order('created_at',{ascending:false}).limit(250),
   supabase.from('political_post_media').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
   supabase.from('political_post_formal_links').select('*').eq('game_id',gameId),
   supabase.from('state_metric_history').select('*').eq('game_id',gameId).order('recorded_at',{ascending:true}).limit(3000),
   supabase.from('party_support_history').select('*').eq('game_id',gameId).order('recorded_at',{ascending:true}).limit(3000)
  ]);
  if(activeGameRef.current!==gameId)return;
  if(g.error||m.error){setError(g.error?.message||m.error?.message||'Нет доступа к игре');setLoading(false);return}
  if(pf.error){setError('Не удалось загрузить профиль. '+pf.error.message);setLoading(false);return}
  setGame(g.data as Game);setMe(m.data as Member);setMetrics((mt.data||[]) as Metric[]);setEvents((ev.data||[]) as EventItem[]);setActions((ac.data||[]) as ActionItem[]);
  setMembers((mb.data||[]) as Member[]);setChannels((ch.data||[]) as Channel[]);setStages((st.data||[]) as Stage[]);setVotes((vo.data||[]) as Vote[]);
  const voteIds=new Set(((vo.data||[]) as Vote[]).map(v=>v.id));setBallots(((ba.data||[]) as Ballot[]).filter(b=>voteIds.has(b.vote_id)));
  setEvaluations((ge.data||[]) as Evaluation[]);setCrises((cr.data||[]) as Crisis[]);setDocuments((dc.data||[]) as GameDocument[]);setActivities((al.data||[]) as Activity[]);setPresence((pr.data||[]) as Presence[]);
  const rawProfiles=(pf.data||[]) as GameProfile[];
  setProfiles(previous=>rawProfiles.map(row=>{
   const old=previous.find(p=>p.user_id===row.user_id);
   return {...row,avatar_url:old?.avatar_path===row.avatar_path?old?.avatar_url:null,signature_url:old?.signature_path===row.signature_path?old?.signature_url:null};
  }));
  const intro=await supabase.rpc('has_seen_my_intro');
  if(activeGameRef.current!==gameId)return;
  if(intro.error){setError('Не удалось проверить первый вход. '+intro.error.message);setLoading(false);return}
  setIntroAccountSeen(!!intro.data);setProfileGameId(gameId);
  const rawPartyDocs=(pd.data||[]) as PartyDocument[];
  const profileRows=await Promise.all(rawProfiles.map(async x=>({...x,avatar_url:x.avatar_path?(await supabase.storage.from('game-assets').createSignedUrl(x.avatar_path,3600)).data?.signedUrl||null:null,signature_url:x.signature_path?(await supabase.storage.from('game-assets').createSignedUrl(x.signature_path,3600)).data?.signedUrl||null:null})));
  const partyRows=await Promise.all(((pa.data||[]) as Party[]).map(async x=>x.logo_path?{...x,logo_url:(await supabase.storage.from('game-assets').createSignedUrl(x.logo_path,3600)).data?.signedUrl||null}:x));
  const docRows=await Promise.all(rawPartyDocs.map(async x=>({...x,url:(await supabase.storage.from('game-assets').createSignedUrl(x.storage_path,3600)).data?.signedUrl||null})));
  if(activeGameRef.current!==gameId)return;
  setProfiles(profileRows);setParties(partyRows);setPartyDocuments(docRows);setPartyInvitations((pi.data||[]) as PartyInvitation[]);setPartyMandateRows((pm.data||[]) as PartyMandateAllocation[]);setPartyAgreements((ag.data||[]) as PartyAgreement[]);
  const formalRows=await Promise.all(((fd.data||[]) as FormalDocument[]).map(async x=>x.source_file_path?{...x,file_url:(await supabase.storage.from('game-assets').createSignedUrl(x.source_file_path,3600)).data?.signedUrl||null}:x));
  if(activeGameRef.current!==gameId)return;
  setFormalDocuments(formalRows);setFormalHistory((fh.data||[]) as FormalHistory[]);
  const mediaRows=await Promise.all(((px.data||[]) as PoliticalPostMedia[]).map(async x=>({...x,url:(await supabase.storage.from('game-assets').createSignedUrl(x.storage_path,3600)).data?.signedUrl||null})));
  if(activeGameRef.current!==gameId)return;
  setPoliticalPosts((pp.data||[]) as PoliticalPost[]);setPoliticalMedia(mediaRows);setPostFormalLinks((pl.data||[]) as PoliticalPostFormalLink[]);setMetricHistory((mh.data||[]) as MetricHistory[]);setPartySupportHistory((psh.data||[]) as PartySupportHistory[]);
  if(!channelRef.current&&ch.data?.[0])setChannelId(ch.data[0].id);
  await Promise.all([loadImpactEngine(),loadRepublicOffices()]);
  if(activeGameRef.current===gameId&&show)setLoading(false);
 }

 async function loadRepublicOffices(){
  const token=++officeRequest.current;
  const result=await supabase.from('game_office_assignments').select('*').eq('game_id',gameId).order('created_at');
  if(activeGameRef.current!==gameId||token!==officeRequest.current)return;
  if(result.error){setError('Не удалось загрузить состав руководства. '+result.error.message);return}
  setOfficeRows((result.data||[]) as GameOfficeAssignment[]);
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
   const rows=await Promise.all(((pf.data||[]) as GameProfile[]).map(async x=>({...x,avatar_url:x.avatar_path?(await supabase.storage.from('game-assets').createSignedUrl(x.avatar_path,3600)).data?.signedUrl||null:null,signature_url:x.signature_path?(await supabase.storage.from('game-assets').createSignedUrl(x.signature_path,3600)).data?.signedUrl||null:null})));
   setProfiles(rows);
  }
  if(!pd.error){
   const rows=await Promise.all(((pd.data||[]) as PartyDocument[]).map(async x=>({...x,url:(await supabase.storage.from('game-assets').createSignedUrl(x.storage_path,3600)).data?.signedUrl||null})));
   setPartyDocuments(rows);
  }
 }

 async function loadPartyRepresentation(){
  const [pi,pm,pa,mb,ag]=await Promise.all([
   supabase.from('party_invitations').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
   supabase.from('party_member_mandates').select('*').eq('game_id',gameId),
   supabase.from('game_parties').select('*').eq('game_id',gameId).order('support',{ascending:false}),
   supabase.from('game_members').select('*').eq('game_id',gameId).order('full_name'),
   supabase.from('party_agreements').select('*').eq('game_id',gameId).order('created_at',{ascending:false})
  ]);
  if(!pi.error)setPartyInvitations((pi.data||[]) as PartyInvitation[]);
  if(!pm.error)setPartyMandateRows((pm.data||[]) as PartyMandateAllocation[]);
  if(!ag.error)setPartyAgreements((ag.data||[]) as PartyAgreement[]);
  if(!mb.error)setMembers((mb.data||[]) as Member[]);
  if(!pa.error){
   const rows=await Promise.all(((pa.data||[]) as Party[]).map(async x=>x.logo_path?{...x,logo_url:(await supabase.storage.from('game-assets').createSignedUrl(x.logo_path,3600)).data?.signedUrl||null}:x));
   setParties(rows);
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
  if(fd.data?.some(d=>d.status_code==='published'&&d.metadata?.budget_simulator_plan_id))void syncBudget();
 }

 async function loadPoliticalWall(){
  const [pp,px,pl,mh,psh,mt,pa]=await Promise.all([
   supabase.from('political_posts').select('*').eq('game_id',gameId).order('created_at',{ascending:false}).limit(250),
   supabase.from('political_post_media').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
   supabase.from('political_post_formal_links').select('*').eq('game_id',gameId),
   supabase.from('state_metric_history').select('*').eq('game_id',gameId).order('recorded_at',{ascending:true}).limit(3000),
   supabase.from('party_support_history').select('*').eq('game_id',gameId).order('recorded_at',{ascending:true}).limit(3000),
   supabase.from('state_metrics').select('*').eq('game_id',gameId).order('sort_order'),
   supabase.from('game_parties').select('*').eq('game_id',gameId).order('support',{ascending:false})
  ]);
  if(!pp.error)setPoliticalPosts((pp.data||[]) as PoliticalPost[]);
  if(!px.error){
   const rows=await Promise.all(((px.data||[]) as PoliticalPostMedia[]).map(async x=>({...x,url:(await supabase.storage.from('game-assets').createSignedUrl(x.storage_path,3600)).data?.signedUrl||null})));
   setPoliticalMedia(rows);
  }
  if(!pl.error)setPostFormalLinks((pl.data||[]) as PoliticalPostFormalLink[]);
  if(!mh.error)setMetricHistory((mh.data||[]) as MetricHistory[]);
  if(!psh.error)setPartySupportHistory((psh.data||[]) as PartySupportHistory[]);
  if(!mt.error)setMetrics((mt.data||[]) as Metric[]);
  if(!pa.error){
   const rows=await Promise.all(((pa.data||[]) as Party[]).map(async x=>x.logo_path?{...x,logo_url:(await supabase.storage.from('game-assets').createSignedUrl(x.logo_path,3600)).data?.signedUrl||null}:x));
   setParties(rows);
  }
 }

 async function loadImpactEngine(){
  const [ir,il]=await Promise.all([
   supabase.from('impact_rules').select('*').eq('game_id',gameId).order('priority'),
   supabase.from('impact_ledger').select('*').eq('game_id',gameId).order('created_at',{ascending:false}).limit(500)
  ]);
  if(!ir.error)setImpactRules((ir.data||[]) as ImpactRule[]);
  if(!il.error)setImpactLedger((il.data||[]) as ImpactLedger[]);
 }

 async function loadMessages(cid:string,initial=false){
  if(initial)setChatLoading(true);
  try{
   const r=await supabase.from('chat_messages').select('*').eq('channel_id',cid).order('created_at',{ascending:false}).limit(150);
   if(r.error){setError(r.error.message);return}
   const rows=await Promise.all(((r.data||[]) as Message[]).map(async m=>{if(!m.storage_path)return m;const x=await supabase.storage.from('game-media').createSignedUrl(m.storage_path,3600);return {...m,url:x.data?.signedUrl||null}}));
   if(channelRef.current===cid)setMessages(rows.reverse());
  }finally{if(initial&&channelRef.current===cid)setChatLoading(false)}
 }
 async function refreshChatMediaUrl(messageId:string,storagePath:string):Promise<string|null>{
  if(!messageId||!storagePath)return null;
  if(!messages.some(m=>m.id===messageId&&m.storage_path===storagePath)&&
     !pinnedMessages.some(m=>m.id===messageId&&m.storage_path===storagePath))return null;
  const r=await supabase.storage.from('game-media').createSignedUrl(storagePath,3600);
  if(r.error||!r.data?.signedUrl){setChatMediaError('Не удалось обновить ссылку на аудио: '+(r.error?.message||'Повторите попытку.'));return null}
  const url=r.data.signedUrl;
  setMessages(previous=>previous.map(m=>m.id===messageId&&m.storage_path===storagePath?{...m,url}:m));
  setPinnedMessages(previous=>previous.map(m=>m.id===messageId&&m.storage_path===storagePath?{...m,url}:m));
  return url;
 }
 async function loadChatPins(cid:string){
  const r=await supabase.from('chat_pins').select('id,game_id,channel_id,message_id,pinned_by,pinned_at').eq('channel_id',cid).order('pinned_at',{ascending:false}).limit(12);
  if(r.error){setError(r.error.message);return}
  const pins=(r.data||[]) as ChatPin[];
  const ids=pins.map(p=>p.message_id);
  if(!ids.length){if(channelRef.current===cid){setChatPins([]);setPinnedMessages([])}return}
  const linked=await supabase.from('chat_messages').select('*').in('id',ids).eq('channel_id',cid);
  if(linked.error){setError(linked.error.message);return}
  const media=await Promise.all(((linked.data||[]) as Message[]).map(async m=>{
   if(!m.storage_path)return m;
   const url=await supabase.storage.from('game-media').createSignedUrl(m.storage_path,3600);
   return {...m,url:url.data?.signedUrl||null};
  }));
  if(channelRef.current===cid){setChatPins(pins);setPinnedMessages(media)}
 }
 async function setChatPin(messageId:string,pin:boolean){
  if(!me||!channelId)return false;
  const original=chatPins;
  if(pin&&chatPins.length>=12){setError('Можно закрепить не более 12 сообщений в одном канале.');return false}
  try{
   const r=await supabase.rpc('set_chat_pin',{p_message_id:messageId,p_pin:pin});
   if(r.error){setError(r.error.message);return false}
   await loadChatPins(channelId);
   return true;
  }catch(e){setChatPins(original);setError(e instanceof Error?e.message:'Не удалось изменить закрепление');return false}
 }
 async function refresh(){await loadAll(false);if(channelRef.current)await loadMessages(channelRef.current)}

 async function logActivity(eventType:string,label:string,viewKey?:string,payload:Record<string,unknown>={}){
  const u=(await supabase.auth.getUser()).data.user;if(!u)return;
  await supabase.from('game_activity').insert({game_id:gameId,actor_id:u.id,event_type:eventType,label,view_key:viewKey||null,payload});
 }
 async function touchPresence(viewKey:string,label?:string){
  if(typeof document!=='undefined'&&document.visibilityState==='hidden')return;
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
 async function nextStage(){const active=stages.find(s=>s.status==='open');const next=active?Math.min(16,active.stage_no+1):(stages.find(s=>s.status!=='completed')?.stage_no||1);await openStage(next)}
 async function resetStageProgress(stageNo:number|null):Promise<boolean>{
  if(!teacher||!me){setError('Сброс этапов доступен только преподавателю.');return false}
  if(stageNo!==null&&(!Number.isInteger(stageNo)||stageNo<1||stageNo>16)){setError('Неверный номер этапа.');return false}
  const r=await supabase.rpc('reset_game_stage_progress',{p_game_id:gameId,p_stage_no:stageNo});
  if(r.error){setError(r.error.message);return false}
  await refresh();
  return true;
 }

 async function configureStageDeadline(stageNo:number,deadline:string|null,inclusive:boolean,penalty:number,description:string){
  if(!teacher){setError('Настройки этапов доступны только преподавателю.');return false}
  const r=await supabase.rpc('configure_stage_deadline',{p_game_id:gameId,p_stage_no:stageNo,p_deadline:deadline,
   p_inclusive:inclusive,p_penalty_points:penalty,p_penalty_description:description});
  if(r.error){setError(r.error.message);return false}
  await refresh();return true;
 }
 async function setStageDeadline(stageId:string,value:string){const r=await supabase.from('game_stages').update({deadline:value?new Date(value).toISOString():null}).eq('id',stageId);if(r.error)setError(r.error.message);else await refresh()}

 async function submitAction(e:FormEvent,data:{type:string;title:string;body:string;budget:number}){
  e.preventDefault();if(!me||!game)return false;
  const r=await supabase.from('player_actions').insert({game_id:gameId,round_no:currentStage?.stage_no||game.current_round,author_id:me.user_id,action_type:data.type,title:data.title,body:data.body,budget:data.budget,status:'submitted'});
  if(r.error){setError(r.error.message);return false}await refresh();return true;
 }
 async function judgeAction(id:string,status:'accepted'|'rejected'){const r=await supabase.from('player_actions').update({status,reviewed_by:me?.user_id,reviewed_at:new Date().toISOString()}).eq('id',id);if(r.error)setError(r.error.message);else await refresh()}

 function availableActors(){
  if(!me)return [];
  const role=(me.role_title||'').toLowerCase();
  const x:{key:string;label:string}[]=[{key:'participant',label:me.full_name}];
  if(me.team)x.push({key:'party',label:me.team});
  if(teacher||role.includes('президент'))x.push({key:'president',label:'Президент Российской Федерации'});
  if(teacher||role.includes('правительств')||role.includes('министр'))x.push({key:'government',label:'Правительство Российской Федерации'});
  if(teacher||role.includes('депутат')||role.includes('государственн')&&role.includes('дум'))x.push({key:'gd',label:'Государственная Дума'});
  if(teacher||role.includes('совет федерац')||role.includes('сенатор'))x.push({key:'sf',label:'Совет Федерации'});
  if(teacher||role.includes('министр'))x.push({key:'ministry',label:me.role_title||'Федеральный орган исполнительной власти'});
  if(teacher||role.includes('муницип')||role.includes('глава города'))x.push({key:'municipality',label:'Орган местного самоуправления'});
  if(teacher||role.includes('сми')||role.includes('журналист'))x.push({key:'media',label:'Средства массовой информации'});
  if(teacher)x.unshift({key:'teacher',label:'GOS//SIMS · Нейтральная публикация'});
  if(teacher||role.includes('юстиц'))x.push({key:'minjust',label:'Министерство юстиции Российской Федерации'});
  if(teacher||role.includes('внутренн'))x.push({key:'interior',label:'Министерство внутренних дел Российской Федерации'});
  const offices=[['cec','Избирательная комиссия',/избирательн.*комисс|цик/i],['ks','Конституционный Суд Российской Федерации',/конституционн.*суд/i],['vs','Верховный Суд Российской Федерации',/верховн.*суд/i],['central_bank','Банк России',/центральн.*банк|банк.*россии/i],['accounts','Счётная палата Российской Федерации',/сч[её]тн.*палат/i]] as const;
  for(const [key,label,pattern] of offices)if(teacher||pattern.test(role))x.push({key,label});
  return x;
 }
 async function createPoliticalPost(data:{processType:string;actorKey:string;actorLabel:string;title:string;body:string;tags:string[];externalUrl?:string;internalView?:string;internalRefId?:string;formalIds?:string[]},files:File[]=[]){
  if(!me||!data.title.trim()||!data.body.trim())return null;
  const r=await supabase.rpc('create_political_post',{
   p_game_id:gameId,p_process_type:data.processType,p_actor_key:data.actorKey,p_title:data.title.trim(),p_body:data.body.trim(),
   p_tags:data.tags,p_external_url:data.externalUrl?.trim()||null,p_internal_view:data.internalView||null,p_internal_ref_id:data.internalRefId||null
  });
  if(r.error){setError(r.error.message);return null}
  const postId=r.data as string;
  if(data.formalIds?.length){
   const links=data.formalIds.map(id=>({game_id:gameId,post_id:postId,formal_document_id:id,created_by:me.user_id}));
   const lr=await supabase.from('political_post_formal_links').insert(links);if(lr.error)setError(lr.error.message);
  }
  for(const file of files){
   const ext=(file.name.split('.').pop()||'bin').toLowerCase();
   const path=gameId+'/wall/'+postId+'/'+crypto.randomUUID()+'.'+ext;
   const up=await supabase.storage.from('game-assets').upload(path,file,{contentType:file.type||'application/octet-stream'});
   if(up.error){setError(up.error.message);continue}
   const kind:'image'|'audio'|'video'|'file'=file.type.startsWith('image/')?'image':file.type.startsWith('audio/')?'audio':file.type.startsWith('video/')?'video':'file';
   const mr=await supabase.from('political_post_media').insert({game_id:gameId,post_id:postId,uploader_id:me.user_id,media_kind:kind,storage_path:path,file_name:file.name,mime_type:file.type||null,file_size:file.size});
   if(mr.error)setError(mr.error.message);
  }
  await logActivity('political_post','Опубликовал политический процесс «'+data.title.trim()+'»','dashboard',{post_id:postId});
  await loadPoliticalWall();return postId;
 }
 async function addMediaToPoliticalPost(postId:string,files:File[]){
  if(!me||!files.length)return false;
  for(const file of files){
   const ext=(file.name.split('.').pop()||'bin').toLowerCase();
   const path=gameId+'/wall/'+postId+'/'+crypto.randomUUID()+'.'+ext;
   const up=await supabase.storage.from('game-assets').upload(path,file,{contentType:file.type||'application/octet-stream'});
   if(up.error){setError(up.error.message);return false}
   const kind:'image'|'audio'|'video'|'file'=file.type.startsWith('image/')?'image':file.type.startsWith('audio/')?'audio':file.type.startsWith('video/')?'video':'file';
   const mr=await supabase.from('political_post_media').insert({
    game_id:gameId,post_id:postId,uploader_id:me.user_id,media_kind:kind,
    storage_path:path,file_name:file.name,mime_type:file.type||null,file_size:file.size
   });
   if(mr.error){setError(mr.error.message);return false}
  }
  await loadPoliticalWall();return true;
 }
 async function updatePoliticalPost(postId:string,data:{title:string;body:string;processType:string;tags:string[];externalUrl?:string;internalView?:string;formalIds?:string[]},files:File[]=[]){
  const r=await supabase.rpc('update_process_post',{p_post_id:postId,p_title:data.title.trim(),p_body:data.body.trim(),p_process_type:data.processType,p_tags:data.tags,p_external_url:data.externalUrl?.trim()||null,p_internal_view:data.internalView||null,p_formal_ids:data.formalIds||[]});
  if(r.error){setError(r.error.message);return false}
  if(files.length)return await addMediaToPoliticalPost(postId,files);
  await loadPoliticalWall();return true;
 }
 async function acceptPoliticalPost(postId:string,impactPlan?:Record<string,unknown>){
  const r=await supabase.rpc('accept_political_post',{p_post_id:postId,p_impact_plan:impactPlan||null});
  if(r.error){setError(r.error.message);return false}await loadPoliticalWall();return true;
 }
 async function rejectPoliticalPost(postId:string){
  const r=await supabase.rpc('reject_political_post',{p_post_id:postId});
  if(r.error){setError(r.error.message);return false}await loadPoliticalWall();return true;
 }
 async function approvePostImpact(postId:string,impactPlan:Record<string,unknown>){
  const r=await supabase.rpc('approve_post_impact',{p_post_id:postId,p_impact_plan:impactPlan});
  if(r.error){setError(r.error.message);return false}await loadPoliticalWall();return true;
 }
 async function createVoteFromPost(postId:string,institutionKey='all',mode:'member'|'faction'|'mandate'='member',groupName?:string){
  const r=await supabase.rpc('open_process_vote',{p_post_id:postId,p_institution_key:institutionKey,p_group_name:groupName||null});
  if(r.error){setError(r.error.message);return null}await refresh();return r.data as string;
 }
 async function updateMetric(id:string,value:number,note?:string){
  if(!teacher)return;const r=await supabase.rpc('set_state_metric',{p_metric_id:id,p_value:value,p_note:note||null});
  if(r.error)setError(r.error.message);else await loadPoliticalWall();
 }
 async function updateImpactRule(ruleId:string,enabled:boolean,autoApply:boolean,effects:Record<string,unknown>,description?:string){
  const r=await supabase.rpc('update_impact_rule',{p_rule_id:ruleId,p_enabled:enabled,p_auto_apply:autoApply,p_effects:effects,p_description:description||null});
  if(r.error){setError(r.error.message);return false}await loadImpactEngine();return true;
 }
 async function revertImpactEntry(id:number){
  const r=await supabase.rpc('revert_impact_entry',{p_ledger_id:id});
  if(r.error){setError(r.error.message);return false}await Promise.all([loadImpactEngine(),loadPoliticalWall()]);return true;
 }
 async function createParty(name:string,ideology:string){
  if(!teacher||!me||!name.trim())return false;const n=name.trim();const colors=['#6f7cff','#4dc9ff','#55d99b','#ff8d72','#c77dff'];
  const p=await supabase.from('game_parties').insert({game_id:gameId,name:n,ideology:ideology.trim()||null,color:colors[parties.length%colors.length]});
  if(p.error){setError(p.error.message);return false}
  const c=await supabase.from('chat_channels').insert({game_id:gameId,name:'Фракция · '+n,kind:'team',created_by:me.user_id});if(c.error)setError(c.error.message);
  await refresh();return true;
 }
 async function updateParty(id:string,patch:Partial<Party>){const r=await supabase.from('game_parties').update(patch).eq('id',id);if(r.error)setError(r.error.message);else await refresh()}
 async function setPartyLeader(partyId:string,userId:string){
  const r=await supabase.rpc('set_party_leader',{p_party_id:partyId,p_user_id:userId});
  if(r.error){setError(r.error.message);return false}
  await loadPartyRepresentation();return true;
 }
 async function setPartyMandates(partyId:string,mandates:number){
  const r=await supabase.rpc('set_party_mandates',{p_party_id:partyId,p_mandates:mandates});
  if(r.error){setError(r.error.message);return false}
  await loadPartyRepresentation();return true;
 }
 async function inviteToParty(partyId:string,userId:string){
  const r=await supabase.rpc('invite_to_party',{p_party_id:partyId,p_user_id:userId});
  if(r.error){setError(r.error.message);return false}
  await loadPartyRepresentation();return true;
 }
 async function respondPartyInvitation(invitationId:string,accept:boolean){
  const r=await supabase.rpc('respond_party_invitation',{p_invitation_id:invitationId,p_accept:accept});
  if(r.error){setError(r.error.message);return false}
  await loadPartyRepresentation();return true;
 }
 async function cancelPartyInvitation(invitationId:string){
  const r=await supabase.rpc('cancel_party_invitation',{p_invitation_id:invitationId});
  if(r.error){setError(r.error.message);return false}
  await loadPartyRepresentation();return true;
 }
 async function removePartyMember(partyId:string,userId:string){
  const r=await supabase.rpc('remove_party_member',{p_party_id:partyId,p_user_id:userId});
  if(r.error){setError(r.error.message);return false}
  await loadPartyRepresentation();return true;
 }
 async function proposePartyAgreement(data:{counterpartyPartyId:string;title:string;terms:string;targetVoteId?:string|null;proposerChoice?:'yes'|'no'|null;counterpartyChoice?:'yes'|'no'|null}){
  const r=await supabase.rpc('propose_party_agreement',{
   p_game_id:gameId,p_counterparty_party_id:data.counterpartyPartyId,p_title:data.title,p_terms:data.terms,
   p_target_vote_id:data.targetVoteId||null,p_proposer_choice:data.proposerChoice||null,p_counterparty_choice:data.counterpartyChoice||null
  });
  if(r.error){setError(r.error.message);return false}
  await loadPartyRepresentation();return true;
 }
 async function respondPartyAgreement(agreementId:string,accept:boolean){
  const r=await supabase.rpc('respond_party_agreement',{p_agreement_id:agreementId,p_accept:accept});
  if(r.error){setError(r.error.message);return false}
  await loadPartyRepresentation();return true;
 }
 async function submitPartyRegistration(partyId:string){
  const r=await supabase.rpc('submit_party_registration',{p_party_id:partyId});
  if(r.error){setError(r.error.message);return false}
  await refresh();return true;
 }
 async function reviewPartyRegistration(partyId:string,status:'registered'|'revision'|'rejected',note?:string){
  const r=await supabase.rpc('issue_party_justice_response',{p_party_id:partyId,p_status:status,p_note:note||''});
  if(r.error){setError(r.error.message);return false}
  await refresh();return true;
 }
 async function applyPartyGhostLoss(partyId:string,loss:number){
  const r=await supabase.rpc('apply_party_ghost_loss',{p_party_id:partyId,p_loss:loss});
  if(r.error){setError(r.error.message);return false}
  await refresh();return true;
 }
 async function drawGhostVoting(totalLoss?:number){
  const r=await supabase.rpc('draw_ghost_voting',{p_game_id:gameId,p_total_loss:totalLoss??null});
  if(r.error){setError(r.error.message);return null}
  await refresh();
  return r.data as {round_id:string;total_loss:number;result:{party_id:string;party_name:string;loss:number}[]};
 }
 async function applyGhostVotingBatch(losses:{party_id:string;loss:number}[]){
  if(!teacher){setError('Ghost Voting доступен только преподавателю.');return false}
  const r=await supabase.rpc('apply_ghost_voting_batch',{p_game_id:gameId,p_losses:losses});
  if(r.error){setError(r.error.message);return false}
  await refresh();return true;
 }
 async function deleteParty(partyId:string){
  if(!teacher){setError('Удаление партий доступно только преподавателю.');return false}
  const r=await supabase.rpc('delete_party_with_assets',{p_party_id:partyId});
  if(r.error){setError(r.error.message);return false}
  const result=r.data as {assets?:{bucket:string;path:string}[]};
  const paths=(result?.assets||[]).filter(a=>a.bucket==='game-assets').map(a=>a.path);
  if(paths.length){
   const removed=await supabase.storage.from('game-assets').remove(paths);
   if(removed.error)setError('Партия удалена из базы, но часть файлов осталась в хранилище: '+removed.error.message);
  }
  await refresh();return true;
 }
 async function clearPartyGhostLoss(partyId?:string){
  const r=await supabase.rpc('clear_party_ghost_loss',{p_game_id:gameId,p_party_id:partyId||null});
  if(r.error){setError(r.error.message);return false}
  await refresh();return true;
 }
 async function updateMember(userId:string,patch:Partial<Pick<Member,'role_title'|'score'>>){
  if(!teacher)return false;
  const r=await supabase.from('game_members').update(patch).eq('game_id',gameId).eq('user_id',userId).select('user_id,role_title').single();
  if(r.error||!r.data){setError(r.error?.message||'Не удалось подтвердить изменение должности.');return false}
  await refresh();return true;
 }

 async function createVote(data:{
  title:string;body:string;mode:'member'|'faction'|'mandate';
  institutionKey?:string;procedureKey?:string;quorumKind?:'none'|'fraction';quorumValue?:number;
  majorityKind?:'yes_no_simple'|'present_majority'|'eligible_majority'|'eligible_fraction';majorityValue?:number;
  allowAbstain?:boolean;tieBreakerChair?:boolean;formalDocumentId?:string|null;
  passTransition?:string;failTransition?:string;groupName?:string|null;
 }){
  if(!me||!data.title.trim())return false;
  const r=await supabase.rpc('create_civic_vote',{
   p_game_id:gameId,
   p_title:data.title.trim(),
   p_body:data.body.trim()||null,
   p_voting_mode:data.mode,
   p_institution_key:data.institutionKey||'all',
   p_procedure_key:data.procedureKey||'generic',
   p_quorum_kind:data.quorumKind||'fraction',
   p_quorum_value:data.quorumValue??0.6666667,
   p_majority_kind:data.majorityKind||'yes_no_simple',
   p_majority_value:data.majorityValue??0.5,
   p_allow_abstain:data.allowAbstain??true,
   p_tie_breaker_chair:data.tieBreakerChair??false,
   p_formal_document_id:data.formalDocumentId||null,
   p_pass_transition:data.passTransition||'none',
   p_fail_transition:data.failTransition||'none',
   p_group_name:data.groupName||null
  });
  if(r.error){setError(r.error.message);return false}await refresh();return true;
 }
 function partyForUser(uid:string){const m=members.find(x=>x.user_id===uid);return parties.find(p=>p.name===m?.team)}
 function memberMatchesInstitution(uid:string,institution:string){
  const m=members.find(x=>x.user_id===uid);if(!m||m.kind==='observer')return false;
  const role=(m.role_title||'').trim();
  if(institution==='all'||institution==='factions')return m.kind==='student'||(m.kind==='teacher'&&!['','Руководитель симуляции','Преподаватель','Администратор'].includes(role));
  return VOTING_BODIES.find(b=>b.key===institution)?.role.test(role)||false;
 }
 function canVote(v:Vote){
  if(!me||me.kind==='observer'||v.status!=='open')return false;
  if(v.electorate_snapshot?.weights){return Number(v.electorate_snapshot.weights[me.user_id]||0)>0&&(v.institution_key.startsWith('unit:')||memberMatchesInstitution(me.user_id,v.institution_key))}
  if(!memberMatchesInstitution(me.user_id,v.institution_key||'all'))return false;
  if(v.voting_mode==='member')return true;
  const p=partyForUser(me.user_id);if(!p)return false;
  if(v.voting_mode==='faction')return p.leader_user_id===me.user_id;
  return (partyMandates.find(x=>x.user_id===me.user_id&&x.party_id===p.id)?.effective_mandates||0)>0;
 }
 function ballotWeight(v:Vote){
  if(!canVote(v)||!me)return 0;
  if(v.electorate_snapshot?.weights)return Number(v.electorate_snapshot.weights[me.user_id]||0);
  if(v.voting_mode==='member'||v.voting_mode==='faction')return 1;
  return partyMandates.find(x=>x.user_id===me.user_id)?.effective_mandates||0;
 }
 function eligibleWeight(v:Vote){
  if(v.status==='closed'&&v.result_eligible!=null)return Number(v.result_eligible);
  if(v.electorate_snapshot)return Number(v.electorate_snapshot.eligible);
  if(v.institution_key==='gd')return 450;
  if(['government','municipality'].includes(v.institution_key))return members.filter(m=>m.kind==='student'&&(!v.group_name||m.group_name===v.group_name)).length;
  if(v.voting_mode==='faction')return parties.filter(p=>p.leader_user_id).length;
  if(v.voting_mode==='mandate')return parties.reduce((a,p)=>a+Math.max(0,Number(p.mandates)||0),0);
  return members.filter(m=>memberMatchesInstitution(m.user_id,v.institution_key||'all')).length;
 }
 function quorum(v:Vote,registrations:{user_id:string;institution_key:string;stage_no:number}[]=[]){
  const eligible=eligibleWeight(v),cast=ballots.filter(b=>b.vote_id===v.id).reduce((n,b)=>n+Number(b.weight),0);
  const attendance=v.electorate_snapshot?.attendance_required||v.procedure_key==='registered_session';
  const present=v.status==='closed'&&v.result_present!=null?Number(v.result_present):attendance?registrations.filter(r=>r.institution_key===v.institution_key&&r.stage_no===v.stage_no).reduce((n,r)=>n+(v.electorate_snapshot?Number(v.electorate_snapshot.weights[r.user_id]||0):v.voting_mode==='mandate'?(partyMandates.find(a=>a.user_id===r.user_id)?.effective_mandates||0):memberMatchesInstitution(r.user_id,v.institution_key)?1:0),0):cast;
  const needed=v.quorum_kind==='none'?0:bodyQuorum(v.institution_key,eligible,Number(v.quorum_value));
  return {eligible,cast,present,needed,met:v.quorum_kind==='none'||eligible>0&&present>=needed};
 }
 function tally(v:Vote){
  const x=ballots.filter(b=>b.vote_id===v.id);
  const sum=(choice:'yes'|'no'|'abstain')=>x.reduce((a,b)=>a+Number(b[choice==='yes'?'yes_weight':choice==='no'?'no_weight':'abstain_weight']??(b.choice===choice?b.weight:0)),0);
  const yes=sum('yes'),no=sum('no'),abstain=sum('abstain');return {yes,no,abstain,total:yes+no+abstain};
 }
 async function castVoteAllocation(v:Vote,yes:number,no:number,abstain:number){
  if(!me||!canVote(v))return false;
  const r=await supabase.rpc('cast_vote_allocation',{p_vote_id:v.id,p_yes:yes,p_no:no,p_abstain:abstain});
  if(r.error){setError(r.error.message);return false}await refresh();return true;
 }
 async function castVote(v:Vote,choice:'yes'|'no'|'abstain',quantity?:number){const n=quantity??ballotWeight(v);return castVoteAllocation(v,choice==='yes'?n:0,choice==='no'?n:0,choice==='abstain'?n:0)}
 async function setStudentMandates(partyId:string,allocations:Record<string,number>|null){
  if(!teacher)return false;const r=await supabase.rpc('set_student_mandates',{p_party_id:partyId,p_allocations:allocations});
  if(r.error){setError(r.error.message);return false}await refresh();return true;
 }
 async function closeVote(id:string,note?:string){
  const r=await supabase.rpc('close_procedural_vote',{p_vote_id:id,p_note:note||null});
  if(r.error){setError(r.error.message);return null}
  await refresh();return r.data;
 }

 async function setEvaluation(userId:string,score:number,note?:string){
  if(!teacher||!me||!currentStage)return;const old=evaluations.find(e=>e.user_id===userId&&e.stage_no===currentStage.stage_no);
  const payload={score,note:note||old?.note||null,evaluator_id:me.user_id,updated_at:new Date().toISOString()};
  const r=old?await supabase.from('game_evaluations').update(payload).eq('id',old.id):await supabase.from('game_evaluations').insert({game_id:gameId,stage_no:currentStage.stage_no,user_id:userId,...payload});
  if(r.error){setError(r.error.message);return}
  await refresh();
 }

 async function publishEvent(title:string,body:string,severity='notice',category='Режиссёрская'){if(!me||!title.trim()||!body.trim())return false;const r=await supabase.from('game_events').insert({game_id:gameId,round_no:currentStage?.stage_no||1,category,severity,title:title.trim(),body:body.trim(),created_by:me.user_id});if(r.error){setError(r.error.message);return false}await refresh();return true}
 async function triggerCrisis(){
  if(!teacher||!me)return;
  const c=CRISES[Math.floor(Math.random()*CRISES.length)];
  const keys=['low','medium','high','ultra'] as const;
  const intensity=keys[Math.floor(Math.random()*keys.length)];
  const description=c.levels[intensity];
  const r=await supabase.rpc('launch_crisis',{p_game_id:gameId,p_crisis_type:c.type,p_intensity:intensity,p_description:description,p_response_minutes:20});
  if(r.error)setError(r.error.message);else await refresh();
 }
 async function ghostVoting(){
  if(!teacher||!me||!parties.length){setError('Сначала создайте партии.');return}
  const eligible=parties.filter(p=>p.mandates>0);if(!eligible.length){setError('Сначала распределите мандаты между партиями.');return}
  return await drawGhostVoting();
 }

 async function createDocument(data:{title:string;type:string;body:string}){if(!teacher||!me||!data.title.trim())return false;const r=await supabase.from('game_documents').insert({game_id:gameId,title:data.title.trim(),doc_type:data.type.trim()||'Документ',body:data.body.trim()||null,created_by:me.user_id});if(r.error){setError(r.error.message);return false}await refresh();return true}


 async function saveProfile(bio:string,file?:File,gender?:'male'|'female'|'unspecified'){
  if(!me||me.kind==='observer')return false;
  const prior=profiles.find(p=>p.user_id===me.user_id);
  const oldPath=prior?.avatar_path||null;
  let avatarPath=oldPath;
  if(file){
    const path=gameId+'/profiles/'+me.user_id+'/avatar-'+crypto.randomUUID()+'.webp';
    const up=await supabase.storage.from('game-assets').upload(path,file,{upsert:false,contentType:file.type});
    if(up.error){setError(up.error.message);return false}
    avatarPath=path;
  }
  const changes={bio:bio.trim()||null,avatar_path:avatarPath,...(gender?{gender}:{}),updated_at:new Date().toISOString()};
  const r=prior?await supabase.from('game_profiles').update(changes).eq('game_id',gameId).eq('user_id',me.user_id).select('user_id,avatar_path').single():
   await supabase.from('game_profiles').insert({game_id:gameId,user_id:me.user_id,...changes}).select('user_id,avatar_path').single();
  if(r.error||!r.data){
   if(file&&avatarPath)await supabase.storage.from('game-assets').remove([avatarPath]);
   setError(r.error?.message||'Не удалось подтвердить сохранение профиля.');return false;
  }
  if(file&&oldPath&&oldPath!==avatarPath)await supabase.storage.from('game-assets').remove([oldPath]);
  await loadPartyAssets();return true;
 }

 async function saveSignature(file:File){
  if(!me||me.kind==='observer'||file.type!=='image/png'||file.size>2*1024*1024){setError('Загрузите PNG-подпись размером до 2 МБ.');return false}
  const path=gameId+'/profiles/'+me.user_id+'/signature-'+Date.now()+'.png';
  const up=await supabase.storage.from('game-assets').upload(path,file,{contentType:'image/png',upsert:false});
  if(up.error){setError(up.error.message);return false}
  const row=profiles.find(p=>p.user_id===me.user_id);
  const r=row?await supabase.from('game_profiles').update({signature_path:path,updated_at:new Date().toISOString()})
     .eq('game_id',gameId).eq('user_id',me.user_id).select('user_id,signature_path').single():
    await supabase.from('game_profiles').insert({game_id:gameId,user_id:me.user_id,signature_path:path,updated_at:new Date().toISOString()}).select('user_id,signature_path').single();
  if(r.error||!r.data){setError(r.error?.message||'Не удалось подтвердить сохранение подписи.');return false}
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
 async function vetoFormalDocument(id:string,note?:string){
  const r=await supabase.rpc('veto_formal_document',{p_document_id:id,p_note:note||null});
  if(r.error){setError(r.error.message);return false}
  await loadFormalRegistry();return true;
 }
 async function resolveBudgetConciliation(id:string,action:'agreed'|'government_revision',note?:string){
  const r=await supabase.rpc('resolve_budget_conciliation',{p_document_id:id,p_action:action,p_note:note||null});
  if(r.error){setError(r.error.message);return false}
  await loadFormalRegistry();return true;
 }
 async function startBudgetRejectionBranch(id:string,action:'conciliation'|'government_revision',note?:string){
  const r=await supabase.rpc('start_budget_rejection_branch',{p_document_id:id,p_action:action,p_note:note||null});
  if(r.error){setError(r.error.message);return false}
  await loadFormalRegistry();return true;
 }

 async function sendText(text:string,targetChannel=channelId){if(!me||!targetChannel||!text.trim())return false;const r=await supabase.from('chat_messages').insert({game_id:gameId,channel_id:targetChannel,author_id:me.user_id,kind:'text',text:text.trim()});if(r.error){setError(r.error.message);return false}await loadMessages(targetChannel);return true}
 async function storeChatAttachment(blob:Blob,fileName:string,mime:string,kind:'file'|ChatMediaKind,targetChannel:string,voiceMeta?:{duration?:number;waveform?:number[]}){
  if(!me||!targetChannel){setChatMediaError('Канал недоступен. Повторно откройте чат.');return false}
  setChatMediaError('');
  const result=await sendChatMedia({
   blob,fileName,mime,kind,voiceMeta,gameId,channelId:targetChannel,userId:me.user_id,
   pending:pendingChatUploads.current.get(blob),generateId:()=>crypto.randomUUID(),
   onPhase:setChatMediaPhase,
   transport:{
    upload:async(path,data,type)=>{
     const r=await supabase.storage.from('game-media').upload(path,data,{contentType:type,upsert:false});
     return{error:r.error?{message:r.error.message}:null};
    },
    insert:async row=>{
     const r=await supabase.from('chat_messages').insert(row);
     return{error:r.error?{message:r.error.message,code:r.error.code}:null};
    },
    exists:async id=>{
     const r=await supabase.from('chat_messages').select('id').eq('id',id).eq('channel_id',targetChannel).maybeSingle();
     if(r.error)throw r.error;
     return!!r.data;
    }
   }
  });
  setChatMediaPhase('idle');
  if(!result.ok){
   if(result.pending)pendingChatUploads.current.set(blob,result.pending);
   setChatMediaError(result.error);
   return false;
  }
  pendingChatUploads.current.delete(blob);
  if(channelRef.current===targetChannel){
   void loadMessages(targetChannel).catch(()=>setChatMediaError('Файл отправлен, но история не обновилась. Переключите канал, чтобы увидеть сообщение.'));
  }
  return true;
 }
 async function sendChatFile(file:File){
  const target=channelId;
  if(!me||!target)return false;
  const mime=inferChatMime(file);
  return storeChatAttachment(file,file.name,mime,uploadedChatKind(mime),target);
 }
 function discardRecording(){
  if(videoLimitTimer.current){clearTimeout(videoLimitTimer.current);videoLimitTimer.current=null}
  if(mediaOperationRef.current)return;
  if(captureRef.current)captureRef.current.discard=true;
  if(recorder.current?.state==='recording')recorder.current.stop();
  else recordingStream.current?.getTracks().forEach(track=>track.stop());
  const previous=previewRef.current;
  previewRef.current=null;voiceAnalysisRef.current=null;setRecordingPreview(null);setRecording(null);setRecordingStartedAt(null);
  if(previous)URL.revokeObjectURL(previous.url);
 }
 async function toggleRecording(kind:ChatMediaKind){
  if(recorder.current?.state==='recording'){recorder.current.stop();return}
  if(recorder.current||mediaOperationRef.current||previewRef.current||!me||!channelId)return;
  if(typeof navigator==='undefined'||!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){
   setError('Этот браузер не поддерживает запись аудио и видео.');return;
  }
  const target=channelId;
  mediaOperationRef.current=true;
  let stream:MediaStream|null=null;
  try{
   stream=await navigator.mediaDevices.getUserMedia(kind==='audio'?{audio:true}:{audio:true,video:{facingMode:'user'}});
   if(channelRef.current!==target){stream.getTracks().forEach(track=>track.stop());return}
   const mime=preferredRecordingMime(kind,t=>MediaRecorder.isTypeSupported(t));
   const rec=mime?new MediaRecorder(stream,{mimeType:mime}):new MediaRecorder(stream);
   const started=Date.now();
   recordingStream.current=stream;recorder.current=rec;chunks.current=[];
   captureRef.current={kind,channelId:target,started,discard:false};
   setRecording(kind);setRecordingStartedAt(started);
   rec.ondataavailable=e=>{
    if(!e.data.size)return;
    chunks.current.push(e.data);
    if(chunks.current.reduce((sum,chunk)=>sum+chunk.size,0)>CHAT_MAX_FILE_BYTES&&rec.state==='recording'){
     setError('Лимит записи — 25 МБ. Завершите запись или запишите более короткий фрагмент.');
     rec.stop();
    }
   };
   rec.onerror=()=>setError('Ошибка записи. Попробуйте ещё раз или прикрепите готовый файл.');
   rec.onstop=()=>{
    if(videoLimitTimer.current){clearTimeout(videoLimitTimer.current);videoLimitTimer.current=null}
    const current=captureRef.current;
    const parts=chunks.current;chunks.current=[];
    stream?.getTracks().forEach(track=>track.stop());
    if(recordingStream.current===stream)recordingStream.current=null;
    if(recorder.current===rec)recorder.current=null;
    captureRef.current=null;setRecording(null);setRecordingStartedAt(null);
    if(!current||current.discard)return;
    const actualMime=rec.mimeType||parts[0]?.type||(kind==='audio'?'audio/webm':'video/webm');
    const blob=new Blob(parts,{type:actualMime});
    if(!blob.size){setError('Запись получилась пустой. Проверьте микрофон или камеру.');return}
    const url=URL.createObjectURL(blob);
    const fallbackDuration=Math.max(1,Math.round((Date.now()-current.started)/1000));
    const preview:RecordingPreview={blob,url,mime:actualMime,kind:current.kind,channelId:current.channelId,
     fileName:recordingFileName(current.kind,actualMime,new Date(current.started)),
     duration:fallbackDuration};
    if(previewRef.current)URL.revokeObjectURL(previewRef.current.url);
    previewRef.current=preview;setRecordingPreview(preview);
    voiceAnalysisRef.current=current.kind==='audio'?analyseVoiceBlob(blob):null;
    if(voiceAnalysisRef.current)void voiceAnalysisRef.current.then(analysis=>{
     if(!analysis||previewRef.current?.url!==url)return;
     const updated:RecordingPreview={...previewRef.current,duration:analysis.duration,waveform:analysis.waveform};
     previewRef.current=updated;setRecordingPreview(updated);
    }).catch(()=>{});
    if(blob.size>CHAT_MAX_FILE_BYTES)setError('Запись превышает 25 МБ. Сохраните её на устройство или запишите заново.');
   };
   rec.start(1000);
   if(kind==='video')videoLimitTimer.current=setTimeout(()=>{if(rec.state==='recording')rec.stop()},30000);
  }catch(e){
   stream?.getTracks().forEach(track=>track.stop());
   if(videoLimitTimer.current){clearTimeout(videoLimitTimer.current);videoLimitTimer.current=null}
   recordingStream.current=null;recorder.current=null;captureRef.current=null;
   setRecording(null);setRecordingStartedAt(null);
   setError(e instanceof Error?e.message:'Не удалось получить доступ к микрофону или камере.');
  }finally{mediaOperationRef.current=false}
 }
 async function sendRecordingPreview(){
  const preview=previewRef.current;
  if(!preview||mediaOperationRef.current||!me)return false;
  if(preview.blob.size>CHAT_MAX_FILE_BYTES){setError('Запись больше 25 МБ — сохраните её на устройство или сделайте короче.');return false}
  mediaOperationRef.current=true;setRecordingSaving(true);setChatMediaError('');
  try{
   if(preview.kind==='audio'&&voiceAnalysisRef.current){
    setChatMediaPhase('analyzing');
    await voiceAnalysisRef.current;
   }
   const ready=previewRef.current?.url===preview.url?previewRef.current:preview;
   const ok=await storeChatAttachment(ready.blob,ready.fileName,ready.mime,ready.kind,ready.channelId,
    ready.kind==='audio'?{duration:ready.duration,...(ready.waveform?{waveform:ready.waveform}:{})}:undefined);
   if(ok&&previewRef.current?.url===preview.url){
    previewRef.current=null;voiceAnalysisRef.current=null;setRecordingPreview(null);URL.revokeObjectURL(preview.url);
   }
   return ok;
  }catch(e){setChatMediaError(e instanceof Error?e.message:'Не удалось отправить запись. Она доступна для повторной отправки.');return false}
  finally{mediaOperationRef.current=false;setRecordingSaving(false)}
 }

 return {game,me,metrics,events,actions,members,officeAssignments,channels,channelId,setChannelId,messages,chatPins,pinnedMessages,chatLoading,stages,parties,votes,ballots,evaluations,crises,documents,activities,presence,profiles,profilesLoaded:profileGameId===gameId,introAccountSeen,partyDocuments,partyInvitations,partyMandates,partyAgreements,politicalPosts,politicalMedia,postFormalLinks,metricHistory,partySupportHistory,impactRules,impactLedger,formalDocuments,formalHistory,loading,error,setError,chatOpen,setChatOpen,recording,recordingPreview,recordingSaving,chatMediaError,chatMediaPhase,recordingStartedAt,recordingStream:recordingStream.current,secondsLeft,realtimeState,teacher,names,currentStage,myEvaluations,averageVsn,
  refresh,logout,touchPresence,logActivity,setTurn,setTurnMinutes,openStage,nextStage,resetStageProgress,configureStageDeadline,setStageDeadline,submitAction,judgeAction,availableActors,createPoliticalPost,updatePoliticalPost,addMediaToPoliticalPost,acceptPoliticalPost,rejectPoliticalPost,approvePostImpact,createVoteFromPost,updateImpactRule,revertImpactEntry,createParty,updateParty,setPartyLeader,setPartyMandates,inviteToParty,respondPartyInvitation,cancelPartyInvitation,removePartyMember,proposePartyAgreement,respondPartyAgreement,submitPartyRegistration,reviewPartyRegistration,applyPartyGhostLoss,drawGhostVoting,clearPartyGhostLoss,applyGhostVotingBatch,deleteParty,updateMember,createVote,canVote,ballotWeight,castVote,castVoteAllocation,setStudentMandates,closeVote,tally,quorum,setEvaluation,publishEvent,triggerCrisis,ghostVoting,createDocument,updateMetric,saveProfile,saveSignature,savePartyIdentity,uploadPartyDocument,reviewPartyDocument,createFormalDocument,advanceFormalDocument,updateFormalDraft,vetoFormalDocument,resolveBudgetConciliation,startBudgetRejectionBranch,sendText,sendChatFile,setChatPin,refreshChatMediaUrl,toggleRecording,discardRecording,sendRecordingPreview};
}
