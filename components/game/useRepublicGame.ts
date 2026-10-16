'use client';
import {userError} from '@/lib/userError';
import {notifyGameDataRefresh} from './useGameTableSync';
import {useBudgetPulse,withBudgetIncome} from './useBudgetPulse';
import {VOTING_BODIES,bodyQuorum} from './votingBodies';
import {useEffect,useMemo,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {supabase} from '@/lib/supabase';
import type {Activity,Ballot,Channel,ChatPin,Crisis,Evaluation,EventItem,FormalDocument,FormalHistory,Game,GameDocument,GameProfile,ImpactLedger,ImpactRule,Member,Message,Metric,MetricHistory,Party,PartyAgreement,PartyDocument,PartyInvitation,PartyMandateAllocation,PartySupportHistory,PoliticalPost,PoliticalPostFormalLink,PoliticalPostMedia,Presence,Stage,Vote,View} from './types';
import {CRISES} from './constants';
import {CHAT_MAX_FILE_BYTES,preferredRecordingMime,recordingFileName,uploadedChatKind,inferChatMime} from './recordingMedia';
import type {ChatMediaKind} from './recordingMedia';
import {sendChatMedia} from './chatMediaTransport';
import {analyseVoiceBlob} from './voiceWaveform';
import {currentGameMembers,currentGameProfiles} from './gameRoster';
import {resolveChatChannelId,visibleChatChannels} from './chatChannelSelection';
import {mergeChatMessages} from './chatRealtime';
import type {GameOfficeAssignment,ChatOverview} from './types';
import type {PendingMediaUpload,MediaUploadPhase} from './chatMediaTransport';
export type RecordingPreview={kind:ChatMediaKind;blob:Blob;url:string;mime:string;fileName:string;channelId:string;duration:number;waveform?:number[]};
type ReadScope='all'|'core'|'members'|'metrics'|'telemetry'|'profiles'|'parties'|'partyDocuments'|'partyRepresentation'|'formal'|'political'|'impact'|'overview'|'channels'|'offices'|'messages'|'pins';
type ReadTicket={gameId:string;epoch:number;versions:Partial<Record<ReadScope,number>>};
const BOOTSTRAP_TIMEOUT_MS=12000;
const SESSION_BOOTSTRAP_TIMEOUT_MS=16000;
async function within<T>(promise:PromiseLike<T>,ms=BOOTSTRAP_TIMEOUT_MS,label='Запрос к серверу'):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([Promise.resolve(promise),new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' не завершился за '+Math.round(ms/1000)+' с. '+(label==='Проверка сессии'?'Сервер авторизации отвечает слишком долго. Повторите вход.':'Сервер игровых данных не отвечает.'))),ms)})])}
 finally{if(timer)clearTimeout(timer)}
}

export function useRepublicGame(gameId:string){
 const router=useRouter();
 const setError=(value:unknown)=>setErrorRaw(userError(value));
 const [game,setGame]=useState<Game|null>(null),[me,setMe]=useState<Member|null>(null),[metrics,setMetrics]=useState<Metric[]>([]),[events,setEvents]=useState<EventItem[]>([]),[memberRows,setMembers]=useState<Member[]>([]);
 const [officeRows,setOfficeRows]=useState<GameOfficeAssignment[]>([]);
 const activeGameRef=useRef(gameId),readEpoch=useRef(0),readVersions=useRef<Partial<Record<ReadScope,number>>>({}),alive=useRef(true),authUser=useRef<string|null|undefined>(undefined),acceptedMember=useRef<Member|null>(null);
 if(activeGameRef.current!==gameId){activeGameRef.current=gameId;readEpoch.current++}
 const members=useMemo(()=>currentGameMembers(memberRows,gameId),[memberRows,gameId]);
 const [channels,setChannels]=useState<Channel[]>([]),[channelId,setChannelId]=useState(''),[messages,setMessages]=useState<Message[]>([]),[chatPins,setChatPins]=useState<ChatPin[]>([]),[pinnedMessages,setPinnedMessages]=useState<Message[]>([]),[chatOverview,setChatOverview]=useState<ChatOverview[]>([]),[chatLoading,setChatLoading]=useState(false);
 const messageRowsRef=useRef<Message[]>([]),recentChatRecoveryRunning=useRef(false);
 useEffect(()=>{messageRowsRef.current=messages},[messages]);
 const [stages,setStages]=useState<Stage[]>([]),[parties,setParties]=useState<Party[]>([]),[votes,setVotes]=useState<Vote[]>([]),[ballots,setBallots]=useState<Ballot[]>([]),[evaluations,setEvaluations]=useState<Evaluation[]>([]),[crises,setCrises]=useState<Crisis[]>([]),[documents,setDocuments]=useState<GameDocument[]>([]),[activities,setActivities]=useState<Activity[]>([]),[presence,setPresence]=useState<Presence[]>([]),[profileRows,setProfiles]=useState<GameProfile[]>([]),[partyDocuments,setPartyDocuments]=useState<PartyDocument[]>([]),[partyInvitations,setPartyInvitations]=useState<PartyInvitation[]>([]),[partyMandates,setPartyMandateRows]=useState<PartyMandateAllocation[]>([]),[partyAgreements,setPartyAgreements]=useState<PartyAgreement[]>([]),[formalDocuments,setFormalDocuments]=useState<FormalDocument[]>([]),[formalHistory,setFormalHistory]=useState<FormalHistory[]>([]),[politicalPosts,setPoliticalPosts]=useState<PoliticalPost[]>([]),[politicalMedia,setPoliticalMedia]=useState<PoliticalPostMedia[]>([]),[postFormalLinks,setPostFormalLinks]=useState<PoliticalPostFormalLink[]>([]),[metricHistory,setMetricHistory]=useState<MetricHistory[]>([]),[partySupportHistory,setPartySupportHistory]=useState<PartySupportHistory[]>([]),[impactRules,setImpactRules]=useState<ImpactRule[]>([]),[impactLedger,setImpactLedger]=useState<ImpactLedger[]>([]);
 const [loading,setLoading]=useState(true),[error,setErrorRaw]=useState(''),[chatOpen,setChatOpen]=useState(false),[secondsLeft,setSecondsLeft]=useState(0),[activeView,setActiveView]=useState<View>('dashboard');
 const [profileGameId,setProfileGameId]=useState('');
 const [introAccountSeen,setIntroAccountSeen]=useState(false);
 const [chatMediaError,setChatMediaError]=useState(''),[chatMediaPhase,setChatMediaPhase]=useState<MediaUploadPhase>('idle');
 const [recording,setRecording]=useState<ChatMediaKind|null>(null),[recordingPreview,setRecordingPreview]=useState<RecordingPreview|null>(null),[recordingSaving,setRecordingSaving]=useState(false),[recordingStartedAt,setRecordingStartedAt]=useState<number|null>(null),[realtimeState,setRealtimeState]=useState<'connecting'|'connected'|'disconnected'>('disconnected');
 const liveRef=useRef<ReturnType<typeof supabase.channel>|null>(null),channelRef=useRef(''),recorder=useRef<MediaRecorder|null>(null),chunks=useRef<Blob[]>([]),activeViewRef=useRef<View>('dashboard'),chatOpenRef=useRef(false);
 activeViewRef.current=activeView;chatOpenRef.current=chatOpen;
 const realtimeReloadTimer=useRef<ReturnType<typeof setTimeout>|null>(null),realtimeReloadRunning=useRef(false),realtimeReloadQueued=useRef(false),realtimeReloadVersion=useRef(0),lastFullReloadAt=useRef(0);
 const videoLimitTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const lastTelegramDispatch=useRef(0);
 const lastCoreSuccessAt=useRef(0);
 const overviewRealtimeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const lastRealtimeOverviewAt=useRef(0);
 function scheduleRealtimeChatOverview(){
  if(overviewRealtimeTimer.current!==null)return;
  const delay=Math.max(0,1500-(Date.now()-lastRealtimeOverviewAt.current));
  overviewRealtimeTimer.current=setTimeout(()=>{
   overviewRealtimeTimer.current=null;
   if(!alive.current||!authUser.current||document.visibilityState==='hidden')return;
   lastRealtimeOverviewAt.current=Date.now();
   void loadChatOverview();
  },delay);
 }
 const coreReadQueue=useRef({active:0,waiting:[] as Array<()=>void>});
 function limitedCoreRead<T>(query:PromiseLike<T>):Promise<T>{
  return new Promise<T>((resolve,reject)=>{
   const run=()=>{
    coreReadQueue.current.active++;
    void Promise.resolve(query).then(resolve,reject).finally(()=>{
     coreReadQueue.current.active--;
     coreReadQueue.current.waiting.shift()?.();
    });
   };
   if(coreReadQueue.current.active<4)run();
   else coreReadQueue.current.waiting.push(run);
  });
 }
 const assetSignatures=useRef(new Map<string,{expiresAt:number;promise:Promise<string|null>}>());
 const assetSignQueue=useRef({active:0,waiting:[] as Array<()=>void>});
 function signedAssetUrl(bucket:'game-assets'|'game-media',path:string,force=false):Promise<string|null>{
  if(!path)return Promise.resolve(null);
  const key=bucket+':'+path,now=Date.now();
  const old=assetSignatures.current.get(key);
  if(!force&&old&&old.expiresAt>now)return old.promise;
  // Links and in-flight requests are shared only inside the current authorised game session.
  if(assetSignatures.current.size>=600){
   const first=assetSignatures.current.keys().next().value;
   if(first)assetSignatures.current.delete(first);
  }
  const epoch=readEpoch.current;
  const promise=new Promise<string|null>(resolve=>{
   const run=()=>{
    assetSignQueue.current.active++;
    const finish=(url:string|null)=>{
     assetSignQueue.current.active--;
     assetSignQueue.current.waiting.shift()?.();
     resolve(url);
    };
    if(epoch!==readEpoch.current||!alive.current){finish(null);return}
    void supabase.storage.from(bucket).createSignedUrl(path,3600).then(({data,error})=>{
     const url=error?null:data?.signedUrl||null;
     if(!url&&assetSignatures.current.get(key)?.promise===promise)assetSignatures.current.delete(key);
     finish(url);
    }).catch(()=>{
     if(assetSignatures.current.get(key)?.promise===promise)assetSignatures.current.delete(key);
     finish(null);
    });
   };
   if(assetSignQueue.current.active<4)run();
   else assetSignQueue.current.waiting.push(run);
  });
  assetSignatures.current.set(key,{expiresAt:now+45*60*1000,promise});
  return promise;
 }
 async function kickTelegramDispatch(){
  if(typeof window==='undefined'||!me?.user_id||Date.now()-lastTelegramDispatch.current<12000)return;
  lastTelegramDispatch.current=Date.now();
  try{
   const {data}=await supabase.auth.getSession();
   if(!data.session?.access_token)return;
   const origin=(process.env.NEXT_PUBLIC_GAME_API_ORIGIN||
    (window.location.hostname.endsWith('.github.io')?'https://gos-sim1.vercel.app':'')).replace(/[/]$/,'');
   await fetch(origin+'/api/telegram/dispatch',{
    method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+data.session.access_token},
    body:JSON.stringify({gameId}),keepalive:true
   });
  }catch{
   // Telegram delivery has its own durable outbox; never block in-game actions.
  }
 }

 const recordingStream=useRef<MediaStream|null>(null),previewRef=useRef<RecordingPreview|null>(null),captureRef=useRef<{kind:ChatMediaKind;channelId:string;started:number;discard:boolean}|null>(null),mediaOperationRef=useRef(false),pendingChatUploads=useRef(new WeakMap<Blob,PendingMediaUpload>()),voiceAnalysisRef=useRef<Promise<{waveform:number[];duration:number}|null>|null>(null);

 const profiles=useMemo(()=>currentGameProfiles(profileRows,members,gameId),[profileRows,members,gameId]);
 const officeAssignments=useMemo(()=>officeRows.filter(o=>o.game_id===gameId&&members.some(m=>m.user_id===o.user_id)),[officeRows,members,gameId]);
 const visibleMe=me?.game_id===gameId&&me.user_id===authUser.current?me:null;
 const teacher=visibleMe?.kind==='teacher';
 const names=useMemo(()=>Object.fromEntries(memberRows.filter(m=>m.game_id===gameId).map(x=>[x.user_id,x.full_name])),[memberRows,gameId]);
 const currentStage=useMemo(()=>stages.find(s=>s.status==='open')||stages.find(s=>s.stage_no===game?.current_round)||stages[0],[stages,game?.current_round]);
 const myEvaluations=useMemo(()=>evaluations.filter(e=>e.user_id===me?.user_id),[evaluations,me?.user_id]);
 const averageVsn=myEvaluations.length?myEvaluations.reduce((a,b)=>a+b.score,0)/myEvaluations.length:0;

 function startRead(...scopes:ReadScope[]):ReadTicket{
  const versions:ReadTicket['versions']={};
  for(const scope of scopes){const next=(readVersions.current[scope]||0)+1;readVersions.current[scope]=next;versions[scope]=next}
  return{gameId,epoch:readEpoch.current,versions};
 }
 function readActive(ticket:ReadTicket){return alive.current&&ticket.gameId===activeGameRef.current&&ticket.epoch===readEpoch.current}
 function readCurrent(ticket:ReadTicket,scope?:ReadScope){
  return readActive(ticket)&&(scope?ticket.versions[scope]===readVersions.current[scope]:Object.entries(ticket.versions).every(([key,version])=>readVersions.current[key as ReadScope]===version));
 }
 function requireSuccessful(results:readonly {error:unknown}[]){const failed=results.find(result=>result.error);if(failed)throw failed.error}
 async function readSafely<T>(scopes:ReadScope[],load:(ticket:ReadTicket)=>Promise<T>):Promise<T|undefined>{
  const ticket=startRead(...scopes);
  if(!readActive(ticket)||authUser.current===null)return;
  try{return await load(ticket)}catch(error){if(readActive(ticket)&&Object.keys(ticket.versions).some(scope=>readCurrent(ticket,scope as ReadScope)))setError(error)}
 }
 function clearGameData(){
  acceptedMember.current=null;
  assetSignatures.current.clear();lastCoreSuccessAt.current=0;
  if(overviewRealtimeTimer.current!==null){clearTimeout(overviewRealtimeTimer.current);overviewRealtimeTimer.current=null}
  lastRealtimeOverviewAt.current=0;
  setGame(null);setMe(null);setMetrics([]);setEvents([]);setMembers([]);setOfficeRows([]);
  setChannels([]);channelRef.current='';setChannelId('');setMessages([]);setChatPins([]);setPinnedMessages([]);setChatOverview([]);setChatLoading(false);setChatOpen(false);
  setStages([]);setParties([]);setVotes([]);setBallots([]);setEvaluations([]);setCrises([]);setDocuments([]);setActivities([]);setPresence([]);setProfiles([]);
  setPartyDocuments([]);setPartyInvitations([]);setPartyMandateRows([]);setPartyAgreements([]);setFormalDocuments([]);setFormalHistory([]);
  setPoliticalPosts([]);setPoliticalMedia([]);setPostFormalLinks([]);setMetricHistory([]);setPartySupportHistory([]);setImpactRules([]);setImpactLedger([]);
  setProfileGameId('');setIntroAccountSeen(false);setSecondsLeft(0);
  if(captureRef.current)captureRef.current.discard=true;
  if(recorder.current&&recorder.current.state!=='inactive')recorder.current.stop();
  recordingStream.current?.getTracks().forEach(track=>track.stop());
  recordingStream.current=null;
  if(videoLimitTimer.current){clearTimeout(videoLimitTimer.current);videoLimitTimer.current=null}
  if(previewRef.current)URL.revokeObjectURL(previewRef.current.url);
  previewRef.current=null;voiceAnalysisRef.current=null;pendingChatUploads.current=new WeakMap();
  setRecordingPreview(null);setRecording(null);setRecordingSaving(false);setRecordingStartedAt(null);setChatMediaError('');setChatMediaPhase('idle');
 }
 function adoptUser(userId:string|null,force=false){
  if(!force&&authUser.current===userId)return false;
  authUser.current=userId;readEpoch.current++;clearGameData();return true;
 }

 function chatMemoryKey(userId:string){return 'gos-sims:last-chat:'+gameId+':'+userId}
 function rememberChatChannel(targetChannel:string,userId=me?.user_id){
  if(typeof window==='undefined'||!userId||!targetChannel)return;
  try{window.localStorage.setItem(chatMemoryKey(userId),targetChannel)}catch{}
 }
 function recalledChatChannel(userId:string,available:Channel[]){
  if(typeof window==='undefined'||!userId||!available.length)return '';
  try{const saved=window.localStorage.getItem(chatMemoryKey(userId))||'';return available.some(channel=>channel.id===saved)?saved:''}catch{return ''}
 }

 const {budgetPulse,budgetPulseError,refreshBudgetPulse}=useBudgetPulse(gameId,!!me&&me.game_id===gameId&&activeView==='budget');
 const sharedMetrics=useMemo(()=>withBudgetIncome(metrics,budgetPulse),[metrics,budgetPulse]);
 const sharedMetricHistory=useMemo(()=>budgetPulse?[...metricHistory.filter(h=>h.metric_key!=='budget'),...budgetPulse.history]:metricHistory,[metricHistory,budgetPulse]);
 async function syncBudget(){await refreshBudgetPulse();}
 function scheduleRealtimeReload(delay=1200){
  // Keep the first pending refresh: continuous Realtime events must not
  // indefinitely postpone it or refetch dozens of tables on every change.
  if(typeof document!=='undefined'&&document.visibilityState==='hidden')return;
  if(realtimeReloadTimer.current)return;
  const cooldown=Math.max(0,8000-(Date.now()-lastFullReloadAt.current));
  realtimeReloadTimer.current=setTimeout(()=>{realtimeReloadTimer.current=null;void flushRealtimeReload()},Math.max(delay,cooldown));
 }
 async function flushRealtimeReload(){
  if(realtimeReloadRunning.current){realtimeReloadQueued.current=true;return}
  const version=++realtimeReloadVersion.current;
  realtimeReloadRunning.current=true;
  lastFullReloadAt.current=Date.now();
  try{await loadCoreSections()}
  finally{
   if(version!==realtimeReloadVersion.current)return;
   realtimeReloadRunning.current=false;
   if(realtimeReloadQueued.current){realtimeReloadQueued.current=false;scheduleRealtimeReload()}
  }
 }

 useEffect(()=>{
  alive.current=true;
  clearGameData();setLoading(true);setRealtimeState('disconnected');
  let disposed=false,authReloadTimer:ReturnType<typeof setTimeout>|undefined;
  const {data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
   if(disposed)return;
   const nextUser=session?.user.id||null;
   // The explicit loadAll below owns the initial bootstrap. Ignoring the
   // duplicate INITIAL_SESSION callback avoids a second simultaneous entry.
   if(event==='INITIAL_SESSION'&&authUser.current===undefined)return;
   if(!nextUser&&event!=='SIGNED_OUT')return;
   if(!adoptUser(nextUser,event==='SIGNED_OUT'))return;
   setError('');setLoading(!!nextUser);
   if(!nextUser)setRealtimeState('disconnected');
   clearTimeout(authReloadTimer);
   authReloadTimer=setTimeout(()=>{if(!disposed){if(nextUser)void loadAll();else router.replace('/')}},0);
  });
  setProfileGameId('');
  void loadAll();
  const recover=()=>{if(authUser.current&&acceptedMember.current){void hydrateActiveView();notifyGameDataRefresh(gameId);if(activeViewRef.current==='budget')void refreshBudgetPulse()}};
  const visible=()=>{if(document.visibilityState==='visible')recover()};
  window.addEventListener('focus',recover);window.addEventListener('online',recover);document.addEventListener('visibilitychange',visible);
  return()=>{disposed=true;alive.current=false;readEpoch.current++;subscription.unsubscribe();clearTimeout(authReloadTimer);window.removeEventListener('focus',recover);window.removeEventListener('online',recover);document.removeEventListener('visibilitychange',visible);if(realtimeReloadTimer.current){clearTimeout(realtimeReloadTimer.current);realtimeReloadTimer.current=null}realtimeReloadVersion.current++;realtimeReloadRunning.current=false;realtimeReloadQueued.current=false;};
 },[gameId]);

 useEffect(()=>{
  if(!me?.user_id||me.game_id!==gameId)return;
  let disposed=false,scheduled=false;
  let dirtyCore=false,dirtyPartyDocuments=false,dirtyChat=false,dirtyPins=false,dirtyOverview=false,telegramWake=false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  function flush(){
   if(disposed||document.visibilityState==='hidden')return;
   const core=dirtyCore,partyDocs=dirtyPartyDocuments,chat=dirtyChat,pins=dirtyPins,overview=dirtyOverview,wake=telegramWake;
   dirtyCore=false;dirtyPartyDocuments=false;dirtyChat=false;dirtyPins=false;dirtyOverview=false;telegramWake=false;
   // Read tickets in the loaders guard overlapping requests: never serialize
   // new events behind a stalled, older fetch.
   if(core){void hydrateActiveView();notifyGameDataRefresh(gameId)}
   // A document version changes no core identity or party membership.
   if(partyDocs&&(activeViewRef.current==='parties'||activeViewRef.current==='teacher'))void loadPartyDocuments();
   if(overview||chat)scheduleRealtimeChatOverview();
   if(chat&&channelRef.current)void loadMessages(channelRef.current);
   if(pins&&channelRef.current)void loadChatPins(channelRef.current);
   if(wake)void kickTelegramDispatch();
  }
  function schedule(){
   if(disposed||scheduled)return;
   scheduled=true;
   // Collapse bursts in the same JS turn without delaying the first update.
   void Promise.resolve().then(()=>{scheduled=false;flush()});
  }
  const channel=supabase.channel('gos-id-live:'+gameId+':'+me.user_id);
  // Render the authorised INSERT payload immediately rather than waiting
  // for another PostgREST query. RLS still governs Realtime visibility.
  channel.on('postgres_changes',{event:'*',schema:'public',table:'chat_messages',filter:'game_id=eq.'+gameId},payload=>{
   if(payload.eventType==='INSERT'){
    const row=payload.new as unknown as Message;
    if(row?.id&&row.game_id===gameId&&row.channel_id===channelRef.current){
     setMessages(previous=>mergeChatMessages(previous,[row]));
     if(row.storage_path){
      void signedAssetUrl('game-media',row.storage_path).then(url=>{
       if(!disposed&&channelRef.current===row.channel_id&&url)
        setMessages(previous=>mergeChatMessages(previous,[{...row,url}]));
      }).catch(()=>{/* A later media URL refresh can retry. */});
     }
    }
   }else if(payload.eventType==='DELETE'){
    const id=(payload.old as {id?:string}|null)?.id;
    if(id)setMessages(previous=>previous.filter(m=>m.id!==id));
   }else dirtyChat=true;
   dirtyOverview=true;telegramWake=true;schedule();
  });
  for(const table of ['chat_mentions','chat_channel_state','chat_pins']){
   channel.on('postgres_changes',{event:'*',schema:'public',table,filter:'game_id=eq.'+gameId},()=>{
    if(table==='chat_pins')dirtyPins=true;
    else dirtyOverview=true;
    telegramWake=true;schedule();
   });
  }
  for(const table of ['game_stages','game_parties','party_invitations','party_chair_ballots','formal_documents','political_posts','game_votes','blitz_assignments','stage_deadline_rules']){
   channel.on('postgres_changes',{event:'*',schema:'public',table,filter:'game_id=eq.'+gameId},()=>{
    dirtyCore=true;telegramWake=true;schedule();
   });
  }
  channel.on('postgres_changes',{event:'*',schema:'public',table:'party_documents',filter:'game_id=eq.'+gameId},()=>{
   dirtyPartyDocuments=true;telegramWake=true;schedule();
  });
  liveRef.current=channel;
  setRealtimeState('connecting');
  channel.subscribe(status=>{if(!disposed)setRealtimeState(status==='SUBSCRIBED'?'connected':'disconnected')});
  // Visible-tab recovery works even when a WebSocket cannot connect.
  // Deterministic jitter prevents 40 simultaneous clients from polling in lockstep.
  const pollJitter=[...me.user_id].reduce((hash,char)=>(Math.imul(hash,31)+char.charCodeAt(0))>>>0,0)%10000;
  const poll=setInterval(()=>{
   if(document.visibilityState!=='visible')return;
   dirtyCore=true;dirtyOverview=true;
   if(chatOpenRef.current){dirtyChat=true;dirtyPins=true}
   schedule();
  },30000+pollJitter);
  // Realtime handles unread counters while chat is closed. Full chat recovery
  // runs only for an actively open conversation.
  const chatRecovery=setInterval(()=>{
   if(document.visibilityState!=='visible'||!chatOpenRef.current)return;
   if(channelRef.current)void loadRecentChatMessages(channelRef.current);
   void loadChatOverview();
  },6000);
  return()=>{
   disposed=true;clearTimeout(timer);clearInterval(poll);clearInterval(chatRecovery);
   if(liveRef.current===channel)liveRef.current=null;
   void supabase.removeChannel(channel);
  };
 },[gameId,me?.user_id]);

 useEffect(()=>()=>{
  const rec=recorder.current;
  if(rec&&rec.state!=='inactive'){
   if(captureRef.current)captureRef.current.discard=true;
   rec.stop();
  }
  recordingStream.current?.getTracks().forEach(track=>track.stop());
  if(previewRef.current)URL.revokeObjectURL(previewRef.current.url);
 },[]);

 useEffect(()=>{channelRef.current=channelId;messageRowsRef.current=[];setMessages([]);setChatPins([]);setPinnedMessages([]);if(channelId){void loadMessages(channelId,true);void loadChatPins(channelId);if(chatOpen)void markChatRead(channelId)}else setChatLoading(false)},[channelId]);
 useEffect(()=>{if(chatOpen&&channelId)void markChatRead(channelId)},[chatOpen,channelId,messages.length]);
 useEffect(()=>{
  // The chat header and composer must reflect exactly the same selected ID.
  // On opening, restore the user's last channel, then fall back to the latest
  // conversation or the first available channel. Never override a valid choice.
  if(!chatOpen||!visibleMe||!channels.length)return;
  const available=visibleChatChannels(channels,chatOverview);
  const saved=recalledChatChannel(visibleMe.user_id,available);
  const next=resolveChatChannelId(available,channelId,saved,chatOverview);
  if(next!==channelId){setChannelId(next);return}
  if(next)rememberChatChannel(next,visibleMe.user_id);
 },[chatOpen,channels,chatOverview,channelId,visibleMe?.user_id,gameId]);

 useEffect(()=>{if(me?.user_id)void hydrateActiveView(true);},[activeView,me?.user_id,gameId]);
 useEffect(()=>{if(chatOpen&&me?.user_id)void loadChatOverview();},[chatOpen,me?.user_id,gameId]);

 useEffect(()=>{
  const tick=()=>{
   if(!game?.turn_ends_at||!game.turn_open){setSecondsLeft(0);return}
   setSecondsLeft(Math.max(0,Math.floor((new Date(game.turn_ends_at).getTime()-Date.now())/1000)));
  };
  tick();const id=setInterval(tick,1000);return()=>clearInterval(id);
 },[game?.turn_ends_at,game?.turn_open]);

 async function readIdentity(userId:string){
  const r=await supabase.rpc('get_my_game_identity',{p_game:gameId});
  if(r.error)return [{data:null,error:r.error},{data:null,error:r.error}] as const;
  const payload=(r.data||{}) as {game?:Game|null;member?:Member|null};
  const member=payload.member&&payload.member.user_id===userId?payload.member:null;
  return [{data:payload.game||null,error:null},{data:member,error:null}] as const;
 }

 async function acceptIdentity(g:{data:unknown;error:unknown},m:{data:unknown;error:unknown},userId:string){
  if(g.error||m.error)throw (g.error||m.error);
  if(!g.data||!m.data)return false;
  const member=m.data as Member;
  const previousMember=acceptedMember.current;
  const roleChanged=!!previousMember&&(['kind','role_title','team','group_name','roster_archived_at'] as const).some(key=>previousMember[key]!==member[key]);
  if(roleChanged){readEpoch.current++;clearGameData();}
  authUser.current=userId;acceptedMember.current=member;setGame(g.data as Game);setMe(member);setError('');
  return true;
 }

 async function loadAll(show=true){
  let ticket=startRead('all');
  if(show)setLoading(true);
  try{
   const auth=await within(supabase.auth.getSession(),SESSION_BOOTSTRAP_TIMEOUT_MS,'Проверка сессии');
   if(!readCurrent(ticket,'all'))return;
   if(auth.error)throw auth.error;
   const u=auth.data.session?.user;
   if(!u){adoptUser(null);setLoading(false);router.replace('/');return}
   if(adoptUser(u.id)){ticket=startRead('all');if(show)setLoading(true)}
   let [g,m]=await within(readIdentity(u.id),BOOTSTRAP_TIMEOUT_MS,'Открытие игровой сессии');
   if(!readCurrent(ticket,'all'))return;
   if(g.error||m.error){
    await new Promise(resolve=>setTimeout(resolve,250));
    [g,m]=await within(readIdentity(u.id),BOOTSTRAP_TIMEOUT_MS,'Повторное открытие игровой сессии');
    if(!readCurrent(ticket,'all'))return;
   }
   if(!g.error&&!m.error&&(!g.data||!m.data)){
    const access=await within(supabase.rpc('ensure_my_game_access',{p_game:gameId}),BOOTSTRAP_TIMEOUT_MS,'Проверка доступа к игре');
    if(!readCurrent(ticket,'all'))return;
    if(access.error)throw access.error;
    [g,m]=await within(readIdentity(u.id),BOOTSTRAP_TIMEOUT_MS,'Чтение доступа к игре');
    if(!readCurrent(ticket,'all'))return;
   }
   if(!await acceptIdentity(g,m,u.id)){
    readEpoch.current++;clearGameData();setError('Нет доступа к игре');setLoading(false);return;
   }
   setLoading(false);
  }catch(error){if(readCurrent(ticket,'all'))setError(error)}
  finally{if(readCurrent(ticket,'all'))setLoading(false)}
 }

 async function loadCoreSections(){
  const uid=authUser.current;
  if(!uid)return;
  const ticket=startRead('core','members','metrics','profiles','parties','formal','channels');
  const [g,m,mt,ev,mb,ch,st,pa,vo,ge,cr,dc,pf,fd,intro]=await Promise.all([
   limitedCoreRead(supabase.from('games').select('*').eq('id',gameId).maybeSingle()),
   limitedCoreRead(supabase.from('game_members').select('*').eq('game_id',gameId).eq('user_id',uid).maybeSingle()),
   limitedCoreRead(supabase.from('state_metrics').select('*').eq('game_id',gameId).order('label')),
   limitedCoreRead(supabase.from('game_events').select('*').eq('game_id',gameId).order('published_at',{ascending:false}).limit(100)),
   limitedCoreRead(supabase.from('game_members').select('*').eq('game_id',gameId).order('full_name')),
   limitedCoreRead(supabase.from('chat_channels').select('*').eq('game_id',gameId).order('name')),
   limitedCoreRead(supabase.from('game_stages').select('*').eq('game_id',gameId).order('stage_no')),
   limitedCoreRead(supabase.from('game_parties').select('*').eq('game_id',gameId).order('support',{ascending:false}).order('created_at').order('id')),
   limitedCoreRead(supabase.from('game_votes').select('*').eq('game_id',gameId).order('opened_at',{ascending:false})),
   limitedCoreRead(supabase.from('game_evaluations').select('*').eq('game_id',gameId).order('stage_no')),
   limitedCoreRead(supabase.from('game_crises').select('*').eq('game_id',gameId).order('created_at',{ascending:false})),
   limitedCoreRead(supabase.from('game_documents').select('*').eq('game_id',gameId).order('created_at',{ascending:false})),
   limitedCoreRead(supabase.from('game_profiles').select('*').eq('game_id',gameId)),
   limitedCoreRead(supabase.from('formal_documents').select('*').eq('game_id',gameId).order('updated_at',{ascending:false})),
   limitedCoreRead(supabase.rpc('has_seen_my_intro'))
  ]);
  if(!readCurrent(ticket,'core'))return;
  if(g.error||m.error){
   const code=String((g.error as {code?:string}|null)?.code||(m.error as {code?:string}|null)?.code||'');
   if(code==='PGRST116'||code==='42501'){readEpoch.current++;clearGameData();setError('Нет доступа к игре');}
   return;
  }
  if(!g.data||!m.data){readEpoch.current++;clearGameData();setError('Нет доступа к игре');return}
  const member=m.data as Member;
  const previousMember=acceptedMember.current;
  if(previousMember&&(['kind','role_title','team','group_name','roster_archived_at'] as const).some(key=>previousMember[key]!==member[key])){
   readEpoch.current++;clearGameData();authUser.current=uid;acceptedMember.current=member;setGame(g.data as Game);setMe(member);void hydrateActiveView();return;
  }
  acceptedMember.current=member;lastCoreSuccessAt.current=Date.now();setGame(g.data as Game);setMe(member);
  if(!mt.error&&readCurrent(ticket,'metrics'))setMetrics((mt.data||[]) as Metric[]);
  if(mt.error&&readCurrent(ticket,'metrics'))setError(mt.error);
  if(!ev.error)setEvents((ev.data||[]) as EventItem[]);
  if(!mb.error&&readCurrent(ticket,'members'))setMembers((mb.data||[]) as Member[]);
  if(!ch.error&&readCurrent(ticket,'channels'))setChannels((ch.data||[]) as Channel[]);
  if(!st.error)setStages((st.data||[]) as Stage[]);
  if(!pa.error&&readCurrent(ticket,'parties'))setParties(previous=>((pa.data||[]) as Party[]).map(row=>{
    const old=previous.find(p=>p.id===row.id);
    return {...row,logo_url:old?.logo_path===row.logo_path?old?.logo_url||null:null};
   }));
  if(!vo.error){
   const voteRows=(vo.data||[]) as Vote[];setVotes(voteRows);
   const ids=voteRows.map(v=>v.id);
   if(ids.length){
    const ba=await supabase.from('game_ballots').select('*').in('vote_id',ids);
    // Session, game or a newer core refresh may have changed during this read.
    if(!readCurrent(ticket,'core'))return;
    if(!ba.error)setBallots((ba.data||[]) as Ballot[]);
   }else setBallots([]);
  }
  if(!ge.error)setEvaluations((ge.data||[]) as Evaluation[]);
  if(!cr.error)setCrises((cr.data||[]) as Crisis[]);
  if(!dc.error)setDocuments((dc.data||[]) as GameDocument[]);
  if(!pf.error&&readCurrent(ticket,'profiles')){
   setProfiles(previous=>((pf.data||[]) as GameProfile[]).map(row=>{
    const old=previous.find(p=>p.user_id===row.user_id);
    return {...row,avatar_url:old?.avatar_path===row.avatar_path?old?.avatar_url:null,signature_url:old?.signature_path===row.signature_path?old?.signature_url:null};
   }));
   setProfileGameId(gameId);
  }
  if(!fd.error&&readCurrent(ticket,'formal'))setFormalDocuments((fd.data||[]) as FormalDocument[]);
  if(!intro.error)setIntroAccountSeen(!!intro.data);
 }

 async function hydrateActiveView(allowFreshCore=false){
  // Rapid view navigation can reuse recently updated common data.
  // Realtime, recovery and explicit refresh still force the core read.
  const jobs:Promise<unknown>[]=[loadRepublicOffices()];
  if(!allowFreshCore||Date.now()-lastCoreSuccessAt.current>15000)jobs.unshift(loadCoreSections());
  const view=activeViewRef.current;
  if(view==='parties'||view==='profile')jobs.push(loadPartyAssets());
  // Teacher dossiers must fetch document rows, not just party representation.
  if(view==='teacher')jobs.push(loadPartyDocuments());
  if(view==='parties'||view==='teacher')jobs.push(loadPartyRepresentation(false));
  if(view==='documents')jobs.push(loadFormalRegistry());
  if(view==='actions'||view==='dashboard')jobs.push(loadPoliticalWall());
  if(view==='teacher')jobs.push(loadClassroomTelemetry(),loadImpactEngine());
  if(chatOpenRef.current)jobs.push(loadChatOverview());
  await Promise.allSettled(jobs);
 }

 async function loadRepublicOffices(){
  await readSafely(['offices'],async ticket=>{
  const result=await supabase.from('game_office_assignments').select('*').eq('game_id',gameId).order('created_at');
  if(!readCurrent(ticket))return;
  requireSuccessful([result]);
  setOfficeRows((result.data||[]) as GameOfficeAssignment[]);
  });
 }

 async function loadClassroomTelemetry(){
  await readSafely(['telemetry'],async ticket=>{
  const [al,pr]=await Promise.all([
   supabase.from('game_activity').select('*').eq('game_id',gameId).order('created_at',{ascending:false}).limit(250),
   supabase.from('game_presence').select('*').eq('game_id',gameId).order('last_seen_at',{ascending:false})
  ]);
  if(!readCurrent(ticket))return;
  requireSuccessful([al,pr]);
  setActivities((al.data||[]) as Activity[]);setPresence((pr.data||[]) as Presence[]);
  });
 }

 function acceptPartyDocuments(rows:PartyDocument[],ticket:ReadTicket){
  if(!readCurrent(ticket,'partyDocuments'))return;
  // Review metadata must not wait for Storage. Keep only URLs belonging to
  // exactly the same authorised row and object while new links are prepared.
  setPartyDocuments(previous=>{
   const oldRows=new Map(previous.map(row=>[row.id,row]));
   return rows.map(row=>{
    const old=oldRows.get(row.id),url=old&&old.storage_path===row.storage_path?old.url||null:null;
    return {...row,url,url_loading:!url};
   });
  });
  void Promise.all(rows.map(async row=>{
   try{return {id:row.id,path:row.storage_path,url:await signedAssetUrl('game-assets',row.storage_path)}}
   catch{return {id:row.id,path:row.storage_path,url:null}}
  })).then(links=>{
   if(!readCurrent(ticket,'partyDocuments'))return;
   const byId=new Map(links.map(link=>[link.id,link]));
   setPartyDocuments(previous=>previous.map(row=>{
    const link=byId.get(row.id);
    return link&&link.path===row.storage_path?{...row,url:link.url||row.url||null,url_loading:false}:row;
   }));
  });
 }

 async function loadPartyDocuments(){
  // Separate from party identity/profile reads so the teacher's 30-second
  // refresh doesn't re-sign every participant avatar.
  await readSafely(['partyDocuments'],async ticket=>{
   const pd=await supabase.from('party_documents').select('*').eq('game_id',gameId).order('created_at',{ascending:false});
   if(!readCurrent(ticket,'partyDocuments'))return;
   requireSuccessful([pd]);
   acceptPartyDocuments((pd.data||[]) as PartyDocument[],ticket);
  });
 }

 function acceptPartyRows(rows:Party[],ticket:ReadTicket){
  if(!readCurrent(ticket,'parties'))return;
  // Publish database metadata immediately. Signed Storage URLs are optional
  // decoration and must never make a real party appear to be missing.
  setParties(previous=>rows.map(row=>{
   const old=previous.find(p=>p.id===row.id);
   return {...row,logo_url:old?.logo_path===row.logo_path?old?.logo_url||null:null};
  }));
  void Promise.all(rows.filter(row=>row.logo_path).map(async row=>{
   try{return {id:row.id,path:row.logo_path,url:await signedAssetUrl('game-assets',row.logo_path!)}}
   catch{return {id:row.id,path:row.logo_path,url:null}}
  })).then(links=>{
   if(!readCurrent(ticket,'parties'))return;
   const urls=new Map(links.map(link=>[link.id,link]));
   setParties(previous=>previous.map(row=>{
    const link=urls.get(row.id);
    return link&&link.path===row.logo_path?{...row,logo_url:link.url||row.logo_url||null}:row;
   }));
  }).catch(()=>{});
 }

 async function loadPartyAssets(){
  await readSafely(['parties','profiles','partyDocuments'],async ticket=>{
   // Render each table as soon as its own query completes.
   // An overloaded document service must not make parties disappear.
   const partyRead=Promise.resolve(supabase.from('game_parties').select('*').eq('game_id',gameId).order('support',{ascending:false}).order('created_at').order('id')).then(({data,error})=>{
    if(!readCurrent(ticket,'parties'))return;
    if(error)setError(error);
    else acceptPartyRows((data||[]) as Party[],ticket);
   });
   const documentRead=Promise.resolve(supabase.from('party_documents').select('*').eq('game_id',gameId).order('created_at',{ascending:false})).then(({data,error})=>{
    if(!readCurrent(ticket,'partyDocuments'))return;
    if(error)setError(error);
    else acceptPartyDocuments((data||[]) as PartyDocument[],ticket);
   });
   const profileRead=Promise.resolve(supabase.from('game_profiles').select('*').eq('game_id',gameId)).then(({data,error})=>{
    if(!readCurrent(ticket,'profiles'))return;
    if(error){setError(error);return}
   if(readCurrent(ticket,'profiles')){
    const rows=(data||[]) as GameProfile[];
    setProfiles(previous=>rows.map(row=>{
     const old=previous.find(p=>p.user_id===row.user_id);
     return {...row,avatar_url:old?.avatar_path===row.avatar_path?old?.avatar_url||null:null,signature_url:old?.signature_path===row.signature_path?old?.signature_url||null:null};
    }));
    void Promise.all(rows.map(async row=>{
     try{
      const [avatar,signature]=await Promise.all([
       row.avatar_path?signedAssetUrl('game-assets',row.avatar_path):Promise.resolve(null),
       row.signature_path?signedAssetUrl('game-assets',row.signature_path):Promise.resolve(null)
      ]);
      return {id:row.user_id,avatarPath:row.avatar_path,signaturePath:row.signature_path,avatar:avatar||null,signature:signature||null};
     }catch{return {id:row.user_id,avatarPath:row.avatar_path,signaturePath:row.signature_path,avatar:null,signature:null}}
    })).then(links=>{
     if(!readCurrent(ticket,'profiles'))return;
     const urls=new Map(links.map(link=>[link.id,link]));
     setProfiles(previous=>previous.map(row=>{
      const link=urls.get(row.user_id);
      return link&&link.avatarPath===row.avatar_path&&link.signaturePath===row.signature_path?
       {...row,avatar_url:link.avatar||row.avatar_url||null,signature_url:link.signature||row.signature_url||null}:row;
     }));
    }).catch(()=>{});
   }
   });
   await Promise.all([partyRead,documentRead,profileRead]);
  });
 }

 async function loadPartyRepresentation(refreshParties=true){
  const scopes:ReadScope[]=refreshParties?['partyRepresentation','members','parties']:['partyRepresentation','members'];
  await readSafely(scopes,async ticket=>{
   const [pi,pm,pa,mb,ag]=await Promise.all([
    supabase.from('party_invitations').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
    supabase.from('party_member_mandates').select('*').eq('game_id',gameId),
    refreshParties?supabase.from('game_parties').select('*').eq('game_id',gameId).order('support',{ascending:false}).order('created_at').order('id'):Promise.resolve({data:null,error:null}),
    supabase.from('game_members').select('*').eq('game_id',gameId).order('full_name'),
    supabase.from('party_agreements').select('*').eq('game_id',gameId).order('created_at',{ascending:false})
   ]);
   if(!readActive(ticket))return;
   if(readCurrent(ticket,'partyRepresentation')){
    if(!pi.error)setPartyInvitations((pi.data||[]) as PartyInvitation[]);else setError(pi.error);
    if(!pm.error)setPartyMandateRows((pm.data||[]) as PartyMandateAllocation[]);else setError(pm.error);
    if(!ag.error)setPartyAgreements((ag.data||[]) as PartyAgreement[]);else setError(ag.error);
   }
   if(!mb.error&&readCurrent(ticket,'members'))setMembers((mb.data||[]) as Member[]);
   else if(mb.error&&readCurrent(ticket,'members'))setError(mb.error);
   if(refreshParties){
    if(!pa.error)acceptPartyRows((pa.data||[]) as Party[],ticket);
    else if(readCurrent(ticket,'parties'))setError(pa.error);
   }
  });
 }

 async function loadFormalRegistry(){
  await readSafely(['formal'],async ticket=>{
   const [fd,fh]=await Promise.all([
    supabase.from('formal_documents').select('*').eq('game_id',gameId).order('updated_at',{ascending:false}),
    supabase.from('formal_document_history').select('*').eq('game_id',gameId).order('created_at',{ascending:false})
   ]);
   if(!readCurrent(ticket))return;
   requireSuccessful([fd,fh]);
   const rows=(fd.data||[]) as FormalDocument[];
   // Render the register independently from Storage availability.
   setFormalDocuments(previous=>{
    const cached=new Map(previous.map(row=>[row.id,row]));
    return rows.map(row=>{
     const old=cached.get(row.id);
     return {...row,file_url:old?.source_file_path===row.source_file_path?old.file_url||null:null};
    });
   });
   setFormalHistory((fh.data||[]) as FormalHistory[]);
   void Promise.all(rows.filter(row=>row.source_file_path).map(async row=>({
    id:row.id,path:row.source_file_path,url:await signedAssetUrl('game-assets',row.source_file_path!)
   }))).then(links=>{
    if(!readCurrent(ticket))return;
    const byId=new Map(links.map(link=>[link.id,link]));
    setFormalDocuments(previous=>previous.map(row=>{
     const link=byId.get(row.id);
     return link&&link.path===row.source_file_path?{...row,file_url:link.url||row.file_url||null}:row;
    }));
   });
   if(fd.data?.some(doc=>doc.status_code==='published'&&doc.metadata?.budget_simulator_plan_id))void syncBudget();
  });
 }
 async function loadPoliticalWall(){
  await readSafely(['political','metrics','parties'],async ticket=>{
   const [pp,px,pl,mh,psh,mt,pa]=await Promise.all([
    supabase.from('political_posts').select('*').eq('game_id',gameId).order('created_at',{ascending:false}).limit(250),
    supabase.from('political_post_media').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
    supabase.from('political_post_formal_links').select('*').eq('game_id',gameId),
    supabase.from('state_metric_history').select('*').eq('game_id',gameId).order('recorded_at',{ascending:true}).limit(3000),
    supabase.from('party_support_history').select('*').eq('game_id',gameId).order('recorded_at',{ascending:true}).limit(3000),
    supabase.from('state_metrics').select('*').eq('game_id',gameId).order('sort_order'),
    supabase.from('game_parties').select('*').eq('game_id',gameId).order('support',{ascending:false}).order('created_at').order('id')
   ]);
   if(!readActive(ticket))return;
   requireSuccessful([pp,px,pl,mh,psh,mt,pa]);
   if(readCurrent(ticket,'political')){
    // Only sign files belonging to posts still visible under RLS.
    const posts=(pp.data||[]) as PoliticalPost[];
    const visiblePostIds=new Set(posts.map(post=>post.id));
    const rows=((px.data||[]) as PoliticalPostMedia[]).filter(item=>visiblePostIds.has(item.post_id));
    setPoliticalPosts(posts);
    setPoliticalMedia(previous=>{
     const cached=new Map(previous.map(row=>[row.id,row]));
     return rows.map(row=>{
      const old=cached.get(row.id);
      return {...row,url:old?.storage_path===row.storage_path?old.url||null:null};
     });
    });
    setPostFormalLinks((pl.data||[]) as PoliticalPostFormalLink[]);
    setMetricHistory((mh.data||[]) as MetricHistory[]);
    setPartySupportHistory((psh.data||[]) as PartySupportHistory[]);
    void Promise.all(rows.filter(row=>row.storage_path).map(async row=>({
     id:row.id,path:row.storage_path,url:await signedAssetUrl('game-assets',row.storage_path)
    }))).then(links=>{
     if(!readCurrent(ticket,'political'))return;
     const byId=new Map(links.map(link=>[link.id,link]));
     setPoliticalMedia(previous=>previous.map(row=>{
      const link=byId.get(row.id);
      return link&&link.path===row.storage_path?{...row,url:link.url||row.url||null}:row;
     }));
    });
    if(posts.some(post=>post.source_key?.startsWith('media-party-registration:')))void loadPartyDocuments();
   }
   if(readCurrent(ticket,'metrics'))setMetrics((mt.data||[]) as Metric[]);
   if(readCurrent(ticket,'parties'))acceptPartyRows((pa.data||[]) as Party[],ticket);
  });
 }

 async function loadImpactEngine(){
  await readSafely(['impact'],async ticket=>{
  const [ir,il]=await Promise.all([
   supabase.from('impact_rules').select('*').eq('game_id',gameId).order('priority'),
   supabase.from('impact_ledger').select('*').eq('game_id',gameId).order('created_at',{ascending:false}).limit(500)
  ]);
  if(!readCurrent(ticket))return;
  requireSuccessful([ir,il]);
  setImpactRules((ir.data||[]) as ImpactRule[]);setImpactLedger((il.data||[]) as ImpactLedger[]);
  });
 }

 async function loadChatOverview(){
  const result=await readSafely(['overview'],async ticket=>{
  const r=await supabase.rpc('get_my_chat_overview',{p_game_id:gameId});
  if(!readCurrent(ticket))return [] as ChatOverview[];
  requireSuccessful([r]);
  const rows=(r.data||[]) as ChatOverview[];
  setChatOverview(rows);
  return rows;
  });
  return result||[];
 }
 async function markChatRead(cid:string){
  if(!cid)return;
  const r=await supabase.rpc('mark_chat_channel_read',{p_channel_id:cid});
  if(!r.error)await loadChatOverview();
 }
 async function setChatChannelPinned(cid:string,pin:boolean){
  const r=await supabase.rpc('set_my_chat_channel_pin',{p_channel_id:cid,p_pin:pin});
  if(r.error){setError(r.error.message);return false}
  await loadChatOverview();return true;
 }
 async function loadMessages(cid:string,initial=false){
  if(channelRef.current!==cid)return;
  if(initial)setChatLoading(true);
  await readSafely(['messages'],async ticket=>{
   try{
    const r=await supabase.from('chat_messages').select('*').eq('channel_id',cid).order('created_at',{ascending:false}).limit(150);
    if(!readCurrent(ticket)||channelRef.current!==cid)return;
    requireSuccessful([r]);
    // Render text before potentially slow private Storage signatures.
    const cached=new Map(messageRowsRef.current.filter(m=>m.channel_id===cid).map(m=>[m.id,m]));
    const rows=((r.data||[]) as Message[]).map(m=>{
     const old=cached.get(m.id);
     return {...m,url:m.storage_path&&old?.storage_path===m.storage_path?old.url||null:null};
    });
    const ordered=[...rows].reverse(),latest=ordered.at(-1)?.created_at||'';
    setMessages(previous=>ordered.length?mergeChatMessages(ordered,previous.filter(m=>m.channel_id===cid&&m.created_at>latest)):[]);
    const pending=rows.filter(m=>m.storage_path&&!m.url);
    if(pending.length)void Promise.all(pending.map(async m=>({
     id:m.id,path:m.storage_path,url:await signedAssetUrl('game-media',m.storage_path!)
    }))).then(links=>{
     if(!readCurrent(ticket)||channelRef.current!==cid)return;
     const byId=new Map(links.map(link=>[link.id,link]));
     setMessages(previous=>previous.map(m=>{
      const link=byId.get(m.id);
      return link&&link.path===m.storage_path?{...m,url:link.url||m.url||null}:m;
     }));
    });
   }finally{if(readCurrent(ticket)&&channelRef.current===cid)setChatLoading(false)}
  });
 }
 async function loadRecentChatMessages(cid:string){
  if(recentChatRecoveryRunning.current||channelRef.current!==cid)return;
  // A recovery poll must not invalidate an in-flight initial history load.
  const ticket:ReadTicket={gameId,epoch:readEpoch.current,versions:{}};
  recentChatRecoveryRunning.current=true;
  try{
   const latest=messageRowsRef.current.filter(m=>m.channel_id===cid).at(-1)?.created_at;
   let query=supabase.from('chat_messages').select('*').eq('channel_id',cid)
    .order('created_at',{ascending:!!latest}).limit(75);
   if(latest)query=query.gte('created_at',latest);
   const result=await query;
   if(!readActive(ticket)||channelRef.current!==cid||result.error||!result.data?.length)return;
   // Inclusive cursor handles identical timestamps. Never re-sign the same
   // media on every poll, particularly with 30 simultaneous participants.
   const unseen=(result.data as Message[]).filter(m=>!messageRowsRef.current.some(old=>old.id===m.id));
   if(!unseen.length)return;
   const rows=await Promise.all(unseen.map(async m=>{
    if(!m.storage_path)return m;
    const url=await signedAssetUrl('game-media',m.storage_path);
    return {...m,url};
   }));
   if(readActive(ticket)&&channelRef.current===cid)setMessages(previous=>mergeChatMessages(previous,rows));
  }catch{
   // Polling is a best-effort fallback; an intermittent request must not
   // overwrite the chat with a global game error or break Realtime delivery.
  }finally{recentChatRecoveryRunning.current=false}
 }
 async function refreshChatMediaUrl(messageId:string,storagePath:string):Promise<string|null>{
  const ticket:ReadTicket={gameId,epoch:readEpoch.current,versions:{}};
  if(!messageId||!storagePath)return null;
  if(!messages.some(m=>m.id===messageId&&m.storage_path===storagePath)&&
     !pinnedMessages.some(m=>m.id===messageId&&m.storage_path===storagePath))return null;
  const url=await signedAssetUrl('game-media',storagePath,true);
  if(!readActive(ticket))return null;
  if(!url){setChatMediaError('Не удалось обновить ссылку на аудио. Повторите попытку.');return null}
  setMessages(previous=>previous.map(m=>m.id===messageId&&m.storage_path===storagePath?{...m,url}:m));
  setPinnedMessages(previous=>previous.map(m=>m.id===messageId&&m.storage_path===storagePath?{...m,url}:m));
  return url;
 }
 async function loadChatPins(cid:string){
  if(channelRef.current!==cid)return;
  await readSafely(['pins'],async ticket=>{
  const r=await supabase.from('chat_pins').select('id,game_id,channel_id,message_id,pinned_by,pinned_at').eq('channel_id',cid).order('pinned_at',{ascending:false}).limit(12);
  if(!readCurrent(ticket)||channelRef.current!==cid)return;
  requireSuccessful([r]);
  const pins=(r.data||[]) as ChatPin[];
  const ids=pins.map(p=>p.message_id);
  if(!ids.length){if(channelRef.current===cid){setChatPins([]);setPinnedMessages([])}return}
  const linked=await supabase.from('chat_messages').select('*').in('id',ids).eq('channel_id',cid);
  if(!readCurrent(ticket)||channelRef.current!==cid)return;
  requireSuccessful([linked]);
  const media=await Promise.all(((linked.data||[]) as Message[]).map(async m=>{
   if(!m.storage_path)return m;
   const url=await signedAssetUrl('game-media',m.storage_path);
   return {...m,url};
  }));
  if(readCurrent(ticket)&&channelRef.current===cid){setChatPins(pins);setPinnedMessages(media)}
  });
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
 async function refresh(){await loadAll(false);await Promise.all([hydrateActiveView(),refreshBudgetPulse()]);notifyGameDataRefresh(gameId);if(channelRef.current)await loadMessages(channelRef.current)}

 async function logActivity(eventType:string,label:string,viewKey?:string,payload:Record<string,unknown>={}){
  const uid=me?.user_id;if(!uid||authUser.current!==uid)return;
  await supabase.from('game_activity').insert({game_id:gameId,actor_id:uid,event_type:eventType,label,view_key:viewKey||null,payload});
 }
 async function touchPresence(viewKey:string,label?:string){
  if(typeof document!=='undefined'&&document.visibilityState==='hidden')return;
  const uid=me?.user_id;if(!uid||authUser.current!==uid)return;
  await supabase.from('game_presence').upsert({game_id:gameId,user_id:uid,current_view:viewKey,last_seen_at:new Date().toISOString()},{onConflict:'game_id,user_id'});
  if(label)await logActivity('navigation',label,viewKey);
 }

 async function logout(){await supabase.auth.signOut();router.replace('/')}
 async function setTurn(open:boolean){const r=await supabase.from('games').update({turn_open:open,status:open?'running':'paused',turn_ends_at:open?new Date(Date.now()+12*60*1000).toISOString():null}).eq('id',gameId);if(r.error)setError(r.error.message);else await refresh()}
 async function setTurnMinutes(minutes:number){if(!game)return;const r=await supabase.from('games').update({turn_open:true,status:'running',turn_ends_at:new Date(Date.now()+minutes*60*1000).toISOString()}).eq('id',gameId);if(r.error)setError(r.error.message);else await refresh()}

 async function manageStage(stageNo:number,action:'open'|'close'|'extend',minutes=30):Promise<boolean>{
  if(!teacher){setError('Только преподаватель может управлять этапами.');return false}
  if(action==='close'){
   const check=await supabase.rpc('get_stage_readiness',{p_game_id:gameId,p_stage_no:stageNo});
   const data=check.data as {ready?:boolean;blockers?:unknown;warnings?:unknown}|null;
   if(check.error||!data||typeof data.ready!=='boolean'||!Array.isArray(data.blockers)||!Array.isArray(data.warnings)){
    setError(check.error?.message||'Не удалось проверить обязательные процедуры этапа перед завершением.');return false;
   }
   const blockers=data.blockers.filter((item):item is string=>typeof item==='string');
   const warnings=data.warnings.filter((item):item is string=>typeof item==='string');
   const notice=data.ready?'Обязательные процедуры выполнены.':'Не завершены обязательные процедуры:\n'+blockers.slice(0,7).join('\n');
   if(!window.confirm('Этап '+stageNo+'. '+notice+(warnings.length?'\nЗамечаний: '+warnings.length+'.':'')+'\n\nЗавершить этап?'))return false;
  }
  const r=await supabase.rpc('manage_game_stage',{p_game_id:gameId,p_stage_no:stageNo,p_action:action,p_minutes:minutes});
  if(r.error){setError(r.error.message);return false}
  await refresh();
  return true;
 }
 async function openStage(stageNo:number){
  if(!teacher)return;
  await manageStage(stageNo,'open',30);
 }
 async function nextStage(){
  if(!teacher)return;
  const firstLocked=stages.filter(s=>s.status==='locked').sort((a,b)=>a.stage_no-b.stage_no)[0];
  if(firstLocked)await openStage(firstLocked.stage_no);
 }

 async function resetStageProgress(stageNo:number|null):Promise<boolean>{
  if(!teacher||!me){setError('Сброс этапов доступен только преподавателю.');return false}
  if(stageNo!==null&&(!Number.isInteger(stageNo)||stageNo<1||stageNo>16)){setError('Неверный номер этапа.');return false}
  const r=await supabase.rpc('reset_game_stage_progress',{p_game_id:gameId,p_stage_no:stageNo});
  if(r.error){setError(r.error.message);return false}
  await refresh();
  return true;
 }

  async function configureStageDeadline(stageNo:number,deadline:string|null,inclusive:boolean,penalty:number,description:string,consequenceType:'none'|'representation_loss'|'regional_seat_loss'|'ghost_risk'|'presidential_rating_loss'='none',consequenceMagnitude:number|null=null){
   if(!teacher){setError('Настройки этапов доступны только преподавателю.');return false}
   const r=await supabase.rpc('configure_stage_deadline_rule',{p_game_id:gameId,p_stage_no:stageNo,p_deadline:deadline,
    p_inclusive:inclusive,p_penalty_points:penalty,p_penalty_description:description,
    p_consequence_type:consequenceType,p_consequence_magnitude:consequenceMagnitude});
   if(r.error){setError(r.error.message);return false}
   await refresh();
   if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('gos-stage-policy-updated',{detail:{gameId,stageNo}}));
   return true;
  }
 async function setStageDeadline(stageId:string,value:string){const r=await supabase.from('game_stages').update({deadline:value?new Date(value).toISOString():null}).eq('id',stageId);if(r.error)setError(r.error.message);else await refresh()}


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
  // The retired system publisher is intentionally absent; the server enumerates real actors.
  if(teacher||me.kind==='student')x.push({key:'ksrf',label:'КСРФ'});
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
  if(r.error)setError(r.error.message);else await Promise.all([loadPoliticalWall(),refreshBudgetPulse()]);
 }
 async function updateImpactRule(ruleId:string,enabled:boolean,autoApply:boolean,effects:Record<string,unknown>,description?:string){
  const r=await supabase.rpc('update_impact_rule',{p_rule_id:ruleId,p_enabled:enabled,p_auto_apply:autoApply,p_effects:effects,p_description:description||null});
  if(r.error){setError(r.error.message);return false}await loadImpactEngine();return true;
 }
 async function revertImpactEntry(id:number){
  const r=await supabase.rpc('revert_impact_entry',{p_ledger_id:id});
  if(r.error){setError(r.error.message);return false}await Promise.all([loadImpactEngine(),loadPoliticalWall(),refreshBudgetPulse()]);return true;
 }
 async function createParty(name:string,ideology:string){
  if(!me||me.kind==='observer'||!name.trim())return false;
  const r=await supabase.rpc('found_game_party',{p_game:gameId,p_name:name.trim(),p_ideology:ideology.trim()});
  if(r.error){setError(r.error.message);return false}
  await refresh();return true;
 }
 async function voteForPartyChair(partyId:string,candidateId:string){
  if(!me||me.kind!=='student'){setError('На выборах председателя голосуют участники партии.');return false}
  const r=await supabase.rpc('vote_for_party_chair',{p_party_id:partyId,p_candidate_id:candidateId});
  if(r.error){setError(r.error.message);return false}
  await Promise.all([loadPartyRepresentation(),loadPartyAssets()]);notifyGameDataRefresh(gameId);return true;
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
 async function updatePartyStatistics(
  partyId:string,
  values:{rating:number|null;support:number;mandates:number},
  expected:{rating:number|null;support:number;mandates:number},
  onFailure?:(message:string)=>void
 ){
  function report(message:string){if(onFailure)onFailure(message);else setError(message)}
  if(!teacher){report('Изменять показатели партий может только преподаватель.');return false}
  try{
   const r=await supabase.rpc('teacher_update_party_statistics',{
    p_party_id:partyId,
    p_rating:values.rating,p_support:values.support,p_mandates:values.mandates,
    p_expected_rating:expected.rating,p_expected_support:expected.support,p_expected_mandates:expected.mandates
   });
   if(r.error){report(r.error.message||'Не удалось сохранить показатели.');return false}
   await loadPartyRepresentation();
   notifyGameDataRefresh(gameId);
   return true;
  }catch(error){
   report(error instanceof Error?error.message:'Сервер не ответил. Повторите попытку.');
   return false;
  }
 }
 async function inviteToParty(partyId:string,userId:string,onFailure?:(message:string)=>void){
  try{
   const r=await supabase.rpc('invite_to_party',{p_party_id:partyId,p_user_id:userId});
   if(r.error){setError(r.error.message);onFailure?.(r.error.message);return false}
   await loadPartyRepresentation();notifyGameDataRefresh(gameId);void kickTelegramDispatch();return true;
  }catch(e){
   const message=e instanceof Error?e.message:'Не удалось отправить приглашение. Повторите попытку.';
   setError(message);onFailure?.(message);return false;
  }
 }
 async function respondPartyInvitation(invitationId:string,accept:boolean){
  const r=await supabase.rpc('respond_party_invitation',{p_invitation_id:invitationId,p_accept:accept});
  if(r.error){setError(r.error.message);return false}
  await refresh();notifyGameDataRefresh(gameId);return true;
 }
 async function cancelPartyInvitation(invitationId:string){
  const r=await supabase.rpc('cancel_party_invitation',{p_invitation_id:invitationId});
  if(r.error){setError(r.error.message);return false}
  await loadPartyRepresentation();notifyGameDataRefresh(gameId);return true;
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
  if(institution==='ksrf'&&m.kind==='student')return true;
  const body=VOTING_BODIES.find(b=>b.key===institution);
  return !!body&&(body.role.test(role)||(m.kind==='student'&&officeAssignments.some(o=>o.user_id===uid&&o.status==='active'&&body.role.test(o.role_title))));
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
  if(v.institution_key==='government')return members.filter(m=>(!v.group_name||m.group_name===v.group_name)&&memberMatchesInstitution(m.user_id,'government')).length;
  if(v.institution_key==='municipality')return members.filter(m=>m.kind==='student'&&(!v.group_name||m.group_name===v.group_name)).length;
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
  const procedure=votes.find(v=>v.id===id)?.procedure_key;
  const rpc=procedure==='bill_amendments'?'close_bill_amendment_vote':procedure==='budget_second_reading_amendment'?'close_budget_law_amendment_vote':procedure==='budget_government_submission'?'close_budget_government_vote':'close_procedural_vote';
  const r=await supabase.rpc(rpc,{p_vote_id:id,p_note:note||null});
  if(r.error){setError(r.error.message);return null}
  await refresh();return r.data;
 }
 async function deleteVote(id:string){
  const r=await supabase.rpc('delete_procedural_vote',{p_vote_id:id});
  if(r.error){setError(r.error.message);return false}
  await refresh();return r.data===true;
 }

 async function setEvaluation(userId:string,score:number,note?:string){
  if(!teacher||!me||!currentStage)return;const old=evaluations.find(e=>e.user_id===userId&&e.stage_no===currentStage.stage_no);
  const payload={score,note:note||old?.note||null,evaluator_id:me.user_id,updated_at:new Date().toISOString()};
  const r=old?await supabase.from('game_evaluations').update(payload).eq('id',old.id):await supabase.from('game_evaluations').insert({game_id:gameId,stage_no:currentStage.stage_no,user_id:userId,...payload});
  if(r.error){setError(r.error.message);return}
  await refresh();
 }

 async function publishEvent(title:string,body:string,severity='notice',category='Режиссёрская'){if(!me||!title.trim()||!body.trim())return false;const r=await supabase.from('game_events').insert({game_id:gameId,round_no:currentStage?.stage_no||1,category,severity,title:title.trim(),body:body.trim(),created_by:me.user_id});if(r.error){setError(r.error.message);return false}await refresh();return true}
 async function triggerCrisis(choice?:{type:string;intensity:'low'|'medium'|'high'|'ultra'}){
  if(!teacher||!me)return;
  const c=choice?CRISES.find(scenario=>scenario.type===choice.type):CRISES[Math.floor(Math.random()*CRISES.length)];
  const keys=['low','medium','high','ultra'] as const;
  if(!c||choice&&!keys.includes(choice.intensity)){setError('Выберите сценарий и интенсивность из каталога.');return}
  const intensity=choice?.intensity||keys[Math.floor(Math.random()*keys.length)];
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
 async function savePartyIdentity(partyId:string,description?:string,file?:File){
  let logoPath=parties.find(x=>x.id===partyId)?.logo_path||null;
  if(file){
    const ext=(file.name.split('.').pop()||'png').toLowerCase();
    const path=gameId+'/parties/'+partyId+'/logo-'+Date.now()+'.'+ext;
    const up=await supabase.storage.from('game-assets').upload(path,file,{upsert:true,contentType:file.type});
    if(up.error){setError(up.error.message);return false}
    logoPath=path;
  }
  const r=await supabase.rpc('update_my_party_identity',{p_party_id:partyId,p_description:description?.trim()||null,p_logo_path:logoPath});
  if(r.error){setError(r.error.message);return false}
  await loadPartyAssets();return true;
 }
 async function uploadPartyDocument(partyId:string,kind:PartyDocument['doc_kind'],title:string,file:File,onFailure?:(message:string)=>void){
  const fail=(message:string)=>{if(onFailure)onFailure(message);else setError(message);return false};
  if(!me||!game||!parties.some(p=>p.id===partyId&&p.game_id===gameId)){
   return fail('Партия не найдена. Обновите страницу.');
  }
  if(file.size===0)return fail('Выбран пустой файл.');
  if(file.size>20*1024*1024)return fail('Файл больше 20 МБ.');
  const ext=(file.name.split('.').pop()||'bin').toLowerCase();
  const path=gameId+'/parties/'+partyId+'/docs/'+crypto.randomUUID()+'.'+ext;
  const up=await supabase.storage.from('game-assets').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});
  if(up.error){
   const message=up.error.message||'';
   return fail(/row.level security|permission|unauthorized|forbidden/i.test(message)?'Загрузка в эту партию недоступна.':
    /mime|content.type|file.type|invalidkey/i.test(message)?'Этот формат файла не поддерживается.':
    /network|fetch|timeout|timed out/i.test(message)?'Нет связи с сервером. Повторите загрузку.':'Не удалось загрузить файл. Повторите попытку.');
  }
  const r=await supabase.from('party_documents')
   .insert({game_id:gameId,party_id:partyId,doc_kind:kind,title:title.trim()||file.name,storage_path:path,file_name:file.name,mime_type:file.type||null,file_size:file.size,uploaded_by:me.user_id,status:'submitted'})
   .select('id,storage_path').single();
  if(r.error||!r.data){
   // Preserve the uploaded object for investigation/recovery instead of deleting user files.
   return fail('Файл загружен, но не отправлен. Повторите попытку.');
  }
  await loadPartyDocuments();
  notifyGameDataRefresh(gameId);
  void kickTelegramDispatch();
  return true;
 }
 async function reviewPartyDocument(id:string,status:'accepted'|'revision',note?:string):Promise<boolean>{
  if(!teacher){setError('Рассмотрение документов доступно только преподавателю.');return false}
  if(status==='revision'&&(note||'').trim().length<5){setError('Укажите конкретные замечания к документу (не менее 5 символов).');return false}
  const r=await supabase.from('party_documents')
   .update({status,note:note?.trim()||null})
   .eq('id',id).eq('game_id',gameId).in('status',['submitted','draft'])
   .select('id,status,note').maybeSingle();
  if(r.error){setError(r.error.message);return false}
  const reviewed=r.data;
  if(reviewed)setPartyDocuments(previous=>previous.map(row=>row.id===reviewed.id?{...row,status:reviewed.status,note:reviewed.note}:row));
  await loadPartyDocuments();
  if(r.data){notifyGameDataRefresh(gameId);void kickTelegramDispatch()}
  else setError('Документ уже рассмотрен или недоступен. Список обновлён; проверьте последнюю версию.');
  return !!r.data;
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
 async function deleteFormalDocument(id:string){
  const r=await supabase.rpc('delete_formal_document',{p_document_id:id});
  if(r.error){setError(r.error.message);return false}
  await loadFormalRegistry();return !!r.data?.deleted;
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

 async function sendText(text:string,targetChannel=channelId,mentionedUserIds:string[]=[]){if(!me||!targetChannel||!text.trim())return false;const r=await supabase.rpc('send_chat_text',{p_game:gameId,p_channel:targetChannel,p_text:text.trim(),p_mentioned_users:mentionedUserIds});if(r.error){setError(r.error.message);return false}rememberChatChannel(targetChannel,me.user_id);void Promise.allSettled([loadMessages(targetChannel),loadChatOverview()]);return true}
 async function storeChatAttachment(blob:Blob,fileName:string,mime:string,kind:'file'|ChatMediaKind,targetChannel:string,voiceMeta?:{duration?:number;waveform?:number[]}){
  if(!me||!targetChannel){setChatMediaError('Канал недоступен. Повторно откройте чат.');return false}
  const ticket:ReadTicket={gameId,epoch:readEpoch.current,versions:{}};
  if(!readActive(ticket)||authUser.current!==me.user_id)return false;
  setChatMediaError('');
  const result=await sendChatMedia({
   blob,fileName,mime,kind,voiceMeta,gameId,channelId:targetChannel,userId:me.user_id,
   pending:pendingChatUploads.current.get(blob),generateId:()=>crypto.randomUUID(),
   onPhase:phase=>{if(readActive(ticket))setChatMediaPhase(phase)},
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
  if(!readActive(ticket))return false;
  setChatMediaPhase('idle');
  if(!result.ok){
   if(result.pending)pendingChatUploads.current.set(blob,result.pending);
   setChatMediaError(result.error);
   return false;
  }
  pendingChatUploads.current.delete(blob);
  rememberChatChannel(targetChannel,me.user_id);
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
  const ticket:ReadTicket={gameId,epoch:readEpoch.current,versions:{}};
  mediaOperationRef.current=true;
  let stream:MediaStream|null=null;
  try{
   stream=await navigator.mediaDevices.getUserMedia(kind==='audio'?{audio:true}:{audio:true,video:{facingMode:'user'}});
   if(!readActive(ticket)||authUser.current!==me.user_id||channelRef.current!==target){stream.getTracks().forEach(track=>track.stop());return}
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
   if(readActive(ticket))setError(e instanceof Error?e.message:'Не удалось получить доступ к микрофону или камере.');
  }finally{mediaOperationRef.current=false}
 }
 async function sendRecordingPreview(){
  const preview=previewRef.current;
  if(!preview||mediaOperationRef.current||!me)return false;
  const ticket:ReadTicket={gameId,epoch:readEpoch.current,versions:{}};
  if(preview.blob.size>CHAT_MAX_FILE_BYTES){setError('Запись больше 25 МБ — сохраните её на устройство или сделайте короче.');return false}
  mediaOperationRef.current=true;setRecordingSaving(true);setChatMediaError('');
  try{
   if(preview.kind==='audio'&&voiceAnalysisRef.current){
    setChatMediaPhase('analyzing');
    await voiceAnalysisRef.current;
   }
   if(!readActive(ticket)||authUser.current!==me.user_id)return false;
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

 return {game:game?.id===gameId?game:null,me:visibleMe,metrics:sharedMetrics,budgetPulse,budgetPulseError,refreshBudgetPulse,activeView,setActiveView,events,members,officeAssignments,channels,channelId,setChannelId,messages,chatPins,pinnedMessages,chatOverview,chatUnreadCount:chatOverview.reduce((sum,row)=>sum+Number(row.unread_count||0),0),chatMentionCount:chatOverview.reduce((sum,row)=>sum+Number(row.mention_count||0),0),setChatChannelPinned,markChatRead,chatLoading,stages,parties,votes,ballots,evaluations,crises,documents,activities,presence,profiles,profilesLoaded:profileGameId===gameId,introAccountSeen,partyDocuments,partyInvitations,partyMandates,partyAgreements,politicalPosts,politicalMedia,postFormalLinks,metricHistory:sharedMetricHistory,partySupportHistory,impactRules,impactLedger,formalDocuments,formalHistory,loading,error,setError,chatOpen,setChatOpen,recording,recordingPreview,recordingSaving,chatMediaError,chatMediaPhase,recordingStartedAt,recordingStream:recordingStream.current,secondsLeft,realtimeState,teacher,names,currentStage,myEvaluations,averageVsn,
  refresh,logout,touchPresence,logActivity,setTurn,setTurnMinutes,openStage,manageStage,nextStage,resetStageProgress,configureStageDeadline,setStageDeadline,availableActors,createPoliticalPost,updatePoliticalPost,addMediaToPoliticalPost,acceptPoliticalPost,rejectPoliticalPost,approvePostImpact,createVoteFromPost,updateImpactRule,revertImpactEntry,createParty,voteForPartyChair,updateParty,setPartyLeader,setPartyMandates,updatePartyStatistics,inviteToParty,respondPartyInvitation,cancelPartyInvitation,removePartyMember,proposePartyAgreement,respondPartyAgreement,submitPartyRegistration,reviewPartyRegistration,applyPartyGhostLoss,drawGhostVoting,clearPartyGhostLoss,applyGhostVotingBatch,deleteParty,updateMember,createVote,canVote,ballotWeight,castVote,castVoteAllocation,setStudentMandates,closeVote,deleteVote,tally,quorum,setEvaluation,publishEvent,triggerCrisis,ghostVoting,createDocument,updateMetric,saveProfile,saveSignature,savePartyIdentity,uploadPartyDocument,reviewPartyDocument,createFormalDocument,deleteFormalDocument,advanceFormalDocument,updateFormalDraft,vetoFormalDocument,resolveBudgetConciliation,startBudgetRejectionBranch,sendText,sendChatFile,setChatPin,refreshChatMediaUrl,toggleRecording,discardRecording,sendRecordingPreview};
}
