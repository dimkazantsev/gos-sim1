'use client';
import {userError} from '@/lib/userError';
import {notifyGameDataRefresh,notifySectionUpdates,setGameRealtimeConnection} from './useGameTableSync';
import {assetFailureBackoffMs} from './assetFailureBackoff';
import {useBudgetPulse,withBudgetIncome} from './useBudgetPulse';
import {VOTING_BODIES,bodyQuorum} from './votingBodies';
import {useEffect,useMemo,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {supabase} from '@/lib/supabase';
import {readLocalGameSnapshot,writeLocalGameSnapshot,deleteLocalGameSnapshot} from '@/lib/localGameSnapshot';
import {resolveStoredAsset} from '@/lib/resolveStoredAsset';
import {signDocumentAssetBatch} from './signDocumentAssetBatch';
import {FORMAL_DOCUMENT_SUMMARY_COLUMNS,mergeFormalDocumentSummaries,type FormalDocumentSummary} from './formalDocumentSummary';
import {PARTY_LIST_COLUMNS,PROFILE_ASSET_COLUMNS,normalizePartyRows,mergeProfileAssetRows,type PartyListRow,type ProfileAssetRow} from './partyProfileSummary';
import type {Activity,Ballot,Channel,ChatPin,Crisis,Evaluation,EventItem,FormalDocument,FormalHistory,Game,GameDocument,GameProfile,ImpactLedger,ImpactRule,Member,Message,Metric,MetricHistory,Party,PartyAgreement,PartyDocument,PartyInvitation,PartyMandateAllocation,PartySupportHistory,PoliticalPost,PoliticalPostFormalLink,PoliticalPostMedia,Presence,Stage,Vote,View} from './types';
import {CRISES} from './constants';
import {CHAT_MAX_FILE_BYTES,preferredRecordingMime,recordingFileName,uploadedChatKind,inferChatMime} from './recordingMedia';
import type {ChatMediaKind} from './recordingMedia';
import {sendChatMedia} from './chatMediaTransport';
import {analyseVoiceBlob} from './voiceWaveform';
import {currentGameMembers,currentGameProfiles} from './gameRoster';
import {coalesceInFlight} from './coalesceInFlight';
import {resolveChatChannelId,visibleChatChannels} from './chatChannelSelection';
import {mergeChatMessages} from './chatRealtime';
import {CHAT_HISTORY_PAGE_SIZE,chatHistoryCursorFilter} from './chatHistoryPaging';
import type {GameOfficeAssignment,ChatOverview} from './types';
import type {PendingMediaUpload,MediaUploadPhase} from './chatMediaTransport';
export type RecordingPreview={kind:ChatMediaKind;blob:Blob;url:string;mime:string;fileName:string;channelId:string;duration:number;waveform?:number[]};
type ReadScope='all'|'core'|'game'|'events'|'documents'|'evaluations'|'crises'|'stages'|'votes'|'members'|'metrics'|'telemetry'|'profiles'|'parties'|'partyDocuments'|'partyRepresentation'|'formal'|'political'|'impact'|'overview'|'channels'|'offices'|'messages'|'pins';
type ReadTicket={gameId:string;epoch:number;versions:Partial<Record<ReadScope,number>>};
const BOOTSTRAP_TIMEOUT_MS=20000;
// A reconciliation may contain several individually bounded requests. Do not
// mistake a 12s aggregate wall-clock limit for one failed database operation.
const RECONCILE_TIMEOUT_MS=30000;
const PRESENTATION_CACHE_TTL_MS=600000;
const SESSION_BOOTSTRAP_TIMEOUT_MS=16000;
// Explicit projection avoids transferring unused ballot timestamps to every classroom client.
const GAME_BALLOT_COLUMNS='vote_id,voter_id,choice,weight,yes_weight,no_weight,abstain_weight';
// No role, seniority, score or archived-membership fields may be omitted.
const MEMBER_ROSTER_COLUMNS='game_id,user_id,full_name,group_name,kind,role_title,team,score,joined_at,party_joined_at,roster_archived_at' as const;
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
 const formalFullVersion=useRef('');
 if(activeGameRef.current!==gameId){activeGameRef.current=gameId;readEpoch.current++;formalFullVersion.current=''}
 const members=useMemo(()=>currentGameMembers(memberRows,gameId),[memberRows,gameId]);
 const [channels,setChannels]=useState<Channel[]>([]),[channelId,setChannelId]=useState(''),[messages,setMessages]=useState<Message[]>([]),[chatPins,setChatPins]=useState<ChatPin[]>([]),[pinnedMessages,setPinnedMessages]=useState<Message[]>([]),[chatOverview,setChatOverview]=useState<ChatOverview[]>([]),[chatLoading,setChatLoading]=useState(false);
 const messageRowsRef=useRef<Message[]>([]),recentChatRecoveryRunning=useRef(false);
 const [hasOlderChatMessages,setHasOlderChatMessages]=useState(false);
 const [olderChatLoading,setOlderChatLoading]=useState(false);
 const oldestChatCursor=useRef<Pick<Message,'created_at'|'id'>|null>(null);
 const chatChannelVersion=useRef(0);
 const loadingOlderChatRef=useRef(false);
 const requestedHistoryCount=useRef(CHAT_HISTORY_PAGE_SIZE);
 // The ordinary live view keeps its existing cap; older pages stay in memory
 // only after the reader explicitly requests them.
 const chatWindowLimit=()=>requestedHistoryCount.current===CHAT_HISTORY_PAGE_SIZE?150:Math.max(150,requestedHistoryCount.current+200);
 useEffect(()=>{messageRowsRef.current=messages},[messages]);
 const [stages,setStages]=useState<Stage[]>([]),[parties,setParties]=useState<Party[]>([]),[votes,setVotes]=useState<Vote[]>([]),[ballots,setBallots]=useState<Ballot[]>([]),[evaluations,setEvaluations]=useState<Evaluation[]>([]),[crises,setCrises]=useState<Crisis[]>([]),[documents,setDocuments]=useState<GameDocument[]>([]),[activities,setActivities]=useState<Activity[]>([]),[presence,setPresence]=useState<Presence[]>([]),[profileRows,setProfiles]=useState<GameProfile[]>([]),[partyDocuments,setPartyDocuments]=useState<PartyDocument[]>([]),[partyInvitations,setPartyInvitations]=useState<PartyInvitation[]>([]),[partyMandates,setPartyMandateRows]=useState<PartyMandateAllocation[]>([]),[partyAgreements,setPartyAgreements]=useState<PartyAgreement[]>([]),[formalDocuments,setFormalDocuments]=useState<FormalDocument[]>([]),[formalHistory,setFormalHistory]=useState<FormalHistory[]>([]),[politicalPosts,setPoliticalPosts]=useState<PoliticalPost[]>([]),[politicalMedia,setPoliticalMedia]=useState<PoliticalPostMedia[]>([]),[postFormalLinks,setPostFormalLinks]=useState<PoliticalPostFormalLink[]>([]),[metricHistory,setMetricHistory]=useState<MetricHistory[]>([]),[partySupportHistory,setPartySupportHistory]=useState<PartySupportHistory[]>([]),[impactRules,setImpactRules]=useState<ImpactRule[]>([]),[impactLedger,setImpactLedger]=useState<ImpactLedger[]>([]);
 const [politicalActorOptions,setPoliticalActorOptions]=useState<{actor_key:string;actor_label:string}[]>([]);
 const [politicalHasOlder,setPoliticalHasOlder]=useState(false);
 const [politicalOlderLoading,setPoliticalOlderLoading]=useState(false);
 const [politicalSearchLoading,setPoliticalSearchLoading]=useState(false);
 const [politicalPostTotal,setPoliticalPostTotal]=useState(0);
 const politicalCursor=useRef<Pick<PoliticalPost,'id'|'created_at'|'pinned'>|null>(null);
 const politicalOlderLoaded=useRef(false),politicalPagePending=useRef(false),politicalFullMode=useRef(false);
 const votesRef=useRef(votes);votesRef.current=votes;
 const changedFormalIds=useRef(new Set<string>()),changedVoteIds=useRef(new Set<string>());
 const [loading,setLoading]=useState(true),[error,setErrorRaw]=useState(''),[chatOpen,setChatOpen]=useState(false),[activeView,setActiveView]=useState<View>('dashboard');
 const [profileGameId,setProfileGameId]=useState('');
 const [introAccountSeen,setIntroAccountSeen]=useState(false);
 const [chatMediaError,setChatMediaError]=useState(''),[chatMediaPhase,setChatMediaPhase]=useState<MediaUploadPhase>('idle');
 const [recording,setRecording]=useState<ChatMediaKind|null>(null),[recordingPreview,setRecordingPreview]=useState<RecordingPreview|null>(null),[recordingSaving,setRecordingSaving]=useState(false),[recordingStartedAt,setRecordingStartedAt]=useState<number|null>(null),[realtimeState,setRealtimeState]=useState<'connecting'|'connected'|'disconnected'>('disconnected');
 const liveRef=useRef<ReturnType<typeof supabase.channel>|null>(null),channelRef=useRef(''),recorder=useRef<MediaRecorder|null>(null),chunks=useRef<Blob[]>([]),activeViewRef=useRef<View>('dashboard'),chatOpenRef=useRef(false);
 activeViewRef.current=activeView;chatOpenRef.current=chatOpen;
 const realtimeReloadTimer=useRef<ReturnType<typeof setTimeout>|null>(null),realtimeReloadRunning=useRef(false),realtimeReloadQueued=useRef(false),realtimeReloadVersion=useRef(0),lastFullReloadAt=useRef(0);
 const realtimeDirtyTables=useRef(new Set<string>()),presenceInFlight=useRef('');
 const videoLimitTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const lastTelegramDispatch=useRef(0);
 const lastCoreSuccessAt=useRef(0),lastFullPresentationAt=useRef(0);
 // Sections outside the Realtime publication must still reconcile on demand.
 const passiveSyncAt=useRef(new Map<string,number>());
 function passiveSections(view:View){
  const groups:string[]=[];
  if(['dashboard','events','stages','teacher','actions'].includes(view))groups.push('game_events');
  if(['dashboard','grades','profile','stages','teacher'].includes(view))groups.push('game_evaluations');
  if(['dashboard','stages','teacher'].includes(view))groups.push('game_crises');
  if(['documents','stages','teacher'].includes(view))groups.push('game_documents');
  if(['profile','teacher'].includes(view))groups.push('game_profiles');
  if(chatOpenRef.current)groups.push('chat_channels');
  return groups;
 }
 // Only simultaneous first-entry reads share a promise; later refreshes recheck RLS.
 const initialCoreReads=useRef(new Map<string,Promise<void>>());
 const reusedEntryMemberScope=useRef('');
 // Avoid amplifying PostgREST pool/statement timeouts with repeated 15-table reads.
 const backendRecoveryAfter=useRef(0);
 const overviewRealtimeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const readReceipt=useRef({scope:'',timer:null as ReturnType<typeof setTimeout>|null,running:false,queued:false,lastAt:0});
 const lastRealtimeOverviewAt=useRef(0);
 // Share only in-flight overview reads across chat, Realtime and reconnect handlers.
 const chatOverviewReads=useRef(new Map<string,Promise<ChatOverview[]>>());
 function scheduleRealtimeChatOverview(){
  if(overviewRealtimeTimer.current!==null)return;
  // Message bodies arrive via the game Realtime socket; this RPC updates
  // only the derived chat overview. Coalesce bursts from 100 clients without
  // delaying delivery of messages or explicit read receipts.
  const delay=Math.max(0,8000-(Date.now()-lastRealtimeOverviewAt.current));
  overviewRealtimeTimer.current=setTimeout(()=>{
   overviewRealtimeTimer.current=null;
   if(!alive.current||!authUser.current||document.visibilityState==='hidden')return;
   lastRealtimeOverviewAt.current=Date.now();
   void loadChatOverview();
  },delay);
 }
 const coreReadQueue=useRef({active:0,waiting:[] as Array<()=>void>});
 const rosterReads=useRef(new Map<string,Promise<{data:Member[]|null;error:{message:string;code?:string}|null}>>());
 function limitedCoreRead<T>(query:PromiseLike<T>):Promise<T>{
  const epoch=readEpoch.current,user=authUser.current,targetGame=gameId;
  return new Promise<T>((resolve,reject)=>{
   const run=()=>{
    coreReadQueue.current.active++;
    const controller=new AbortController();
    let timeout:ReturnType<typeof setTimeout>|undefined;
    const request=async()=>{
     if(!alive.current||epoch!==readEpoch.current||user!==authUser.current||targetGame!==activeGameRef.current)
      throw new Error('Игровая сессия изменилась.');
     const abortable=query as PromiseLike<T>&{abortSignal?:(signal:AbortSignal)=>PromiseLike<T>};
     return Promise.race([
      Promise.resolve(abortable.abortSignal?abortable.abortSignal(controller.signal):query),
      new Promise<T>((_,fail)=>{timeout=setTimeout(()=>{
       controller.abort();fail(new Error('Запрос игровых данных не завершился за '+Math.round(BOOTSTRAP_TIMEOUT_MS/1000)+' с. Повторите попытку.'));
      },BOOTSTRAP_TIMEOUT_MS)})
     ]);
    };
    void request().then(resolve,reject).finally(()=>{
     clearTimeout(timeout);
     coreReadQueue.current.active--;
     coreReadQueue.current.waiting.shift()?.();
    });
   };
   if(coreReadQueue.current.active<2)run();
   else coreReadQueue.current.waiting.push(run);
  });
 }
 // Bootstrap and party/teacher panels may need the same roster concurrently.
 // Share only the pending request; never reuse resolved role data.
 function loadMemberRoster(){
  const key=gameId+':'+(authUser.current||'')+':'+readEpoch.current;
  return coalesceInFlight(rosterReads.current,key,async()=>{
   const response=await limitedCoreRead(supabase.from('game_members').select(MEMBER_ROSTER_COLUMNS).eq('game_id',gameId).order('full_name'));
   return {data:(response.data||null) as Member[]|null,error:response.error};
  });
 }
 const lastPresenceWrite=useRef({scope:'',view:'',at:0});
 const pendingPresenceWrite=useRef<{scope:string;view:string;label?:string}|null>(null);
 const presenceFlushTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const PRESENCE_MIN_WRITE_INTERVAL_MS=12000;
 const officeReadState=useRef({scope:'',lastSuccessAt:0,lastAttemptAt:0,inflight:null as Promise<void>|null});
 type PartyRead={data:Party[]|null;error:{message:string;code?:string}|null};
 const partyReadState=useRef({scope:'',lastSuccessAt:0,rows:null as Party[]|null,full:false,
  inflight:null as Promise<PartyRead>|null,inflightFull:false});
 function invalidatePartyRows(){partyReadState.current={scope:'',lastSuccessAt:0,rows:null,full:false,inflight:null,inflightFull:false}}
 function loadCachedParties(force=false):Promise<PartyRead>{
  const scope=gameId+':'+(authUser.current||'')+':'+readEpoch.current;
  if(partyReadState.current.scope!==scope){invalidatePartyRows();partyReadState.current.scope=scope}
  const cache=partyReadState.current;
  const needFull=activeViewRef.current==='parties'||activeViewRef.current==='teacher';
  if(cache.inflight){
   // A fast navigation to the party/teacher dossier must upgrade a pending
   // summary read rather than treating it as a full registration package.
   if(needFull&&!cache.inflightFull)return cache.inflight.then(()=>loadCachedParties(false));
   return cache.inflight;
  }
  if(!force&&cache.rows!==null&&(!needFull||cache.full)&&Date.now()-cache.lastSuccessAt<PRESENTATION_CACHE_TTL_MS)
   return Promise.resolve({data:cache.rows,error:null});
  const query=needFull
   ?supabase.from('game_parties').select('*').eq('game_id',gameId).order('support',{ascending:false}).order('created_at').order('id')
   :supabase.from('game_parties').select(PARTY_LIST_COLUMNS).eq('game_id',gameId).order('support',{ascending:false}).order('created_at').order('id');
  const request=limitedCoreRead(query)
   .then(result=>{
    const rows=result.data?normalizePartyRows(result.data as unknown as PartyListRow[],needFull):null;
    const response:PartyRead={data:rows,error:result.error};
    if(!response.error&&partyReadState.current===cache){cache.rows=response.data??[];cache.full=needFull;cache.lastSuccessAt=Date.now()}
    return response;
   }).finally(()=>{if(cache.inflight===request){cache.inflight=null;cache.inflightFull=false}});
  cache.inflight=request;cache.inflightFull=needFull;
  return request;
 }
 const assetSignatures=useRef(new Map<string,{expiresAt:number;promise:Promise<string|null>}>());
 const assetSignQueue=useRef({active:0,waiting:[] as Array<()=>void>});
 function signedAssetUrl(bucket:'game-assets'|'game-media',path:string,force=false):Promise<string|null>{
  if(!path)return Promise.resolve(null);
  const storage=resolveStoredAsset(bucket,path);
  const key=storage.bucket+':'+storage.path,now=Date.now();
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
    void supabase.storage.from(storage.bucket).createSignedUrl(storage.path,3600).then(({data,error})=>{
     const url=error?null:data?.signedUrl||null;
     // On NoSuchKey, the same immutable path will not magically appear on
     // every profile refresh. Cache the negative result inside this session.
     if(!url&&assetSignatures.current.get(key)?.promise===promise){
      assetSignatures.current.set(key,{expiresAt:Date.now()+assetFailureBackoffMs(error),promise});
     }
     finish(url);
    }).catch(error=>{
     if(assetSignatures.current.get(key)?.promise===promise){
      assetSignatures.current.set(key,{expiresAt:Date.now()+assetFailureBackoffMs(error),promise});
     }
     finish(null);
    });
   };
   if(assetSignQueue.current.active<4)run();
   else assetSignQueue.current.waiting.push(run);
  });
  assetSignatures.current.set(key,{expiresAt:now+45*60*1000,promise});
  return promise;
 }
 function signedDocumentLinks(rows:readonly {id:string;path:string}[]){
  const epoch=readEpoch.current,uid=authUser.current;
  const valid=()=>alive.current&&readEpoch.current===epoch&&authUser.current===uid&&activeGameRef.current===gameId;
  return signDocumentAssetBatch(rows,{
   isCurrent:valid,
   cached:key=>{
    const value=assetSignatures.current.get(key);
    return value&&value.expiresAt>Date.now()?value.promise:undefined;
   },
   store:(key,url)=>{
    if(valid())assetSignatures.current.set(key,{expiresAt:Date.now()+45*60*1000,promise:Promise.resolve(url)});
   },
   signOne:path=>signedAssetUrl('game-assets',path),
   signMany:async(bucket,paths)=>{
    const client=supabase.storage.from(bucket);
    // Retain legacy single signing for test transports without this API.
    if(typeof client.createSignedUrls!=='function')return {data:null,error:new Error('Batch signing unavailable')};
    return client.createSignedUrls(paths,3600);
   }
  });
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
 function formalVersion(rows:FormalDocument[]){return rows.length?rows.map(d=>d.id+':'+d.updated_at).sort().join('|'):'empty'}
 function clearGameData(){
  formalFullVersion.current='';acceptedMember.current=null;
  chatOverviewReads.current.clear();
  rosterReads.current.clear();
  initialCoreReads.current.clear();
  reusedEntryMemberScope.current='';
  realtimeDirtyTables.current.clear();
  changedFormalIds.current.clear();changedVoteIds.current.clear();
  if(readReceipt.current.timer!==null)clearTimeout(readReceipt.current.timer);
  readReceipt.current={scope:'',timer:null,running:false,queued:false,lastAt:0};
  assetSignatures.current.clear();lastCoreSuccessAt.current=0;lastFullPresentationAt.current=0;passiveSyncAt.current.clear();
  officeReadState.current={scope:'',lastSuccessAt:0,lastAttemptAt:0,inflight:null};
  invalidatePartyRows();
  if(overviewRealtimeTimer.current!==null){clearTimeout(overviewRealtimeTimer.current);overviewRealtimeTimer.current=null}
  lastRealtimeOverviewAt.current=0;
  if(presenceFlushTimer.current!==null){clearTimeout(presenceFlushTimer.current);presenceFlushTimer.current=null}
  pendingPresenceWrite.current=null;
  lastPresenceWrite.current={scope:'',view:'',at:0};
  setGame(null);setMe(null);setMetrics([]);setEvents([]);setMembers([]);setOfficeRows([]);
  setChannels([]);channelRef.current='';setChannelId('');setMessages([]);
  oldestChatCursor.current=null;requestedHistoryCount.current=CHAT_HISTORY_PAGE_SIZE;
  loadingOlderChatRef.current=false;setHasOlderChatMessages(false);setOlderChatLoading(false);
  setChatPins([]);setPinnedMessages([]);setChatOverview([]);setChatLoading(false);setChatOpen(false);
  setStages([]);setParties([]);setVotes([]);setBallots([]);setEvaluations([]);setCrises([]);setDocuments([]);setActivities([]);setPresence([]);setProfiles([]);
  setPartyDocuments([]);setPartyInvitations([]);setPartyMandateRows([]);setPartyAgreements([]);setFormalDocuments([]);setFormalHistory([]);
  setPoliticalPosts([]);setPoliticalMedia([]);setPostFormalLinks([]);
  politicalCursor.current=null;politicalOlderLoaded.current=false;politicalPagePending.current=false;politicalFullMode.current=false;
  setPoliticalHasOlder(false);setPoliticalOlderLoading(false);setPoliticalSearchLoading(false);setPoliticalPostTotal(0);setPoliticalActorOptions([]);
  setMetricHistory([]);setPartySupportHistory([]);setImpactRules([]);setImpactLedger([]);
  setProfileGameId('');setIntroAccountSeen(false);
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
 function scheduleRealtimeReload(delay=1000,tables:readonly string[]=['*']){
  for(const table of tables)realtimeDirtyTables.current.add(table);
  // Keep the first pending refresh: continuous Realtime events must not
  // indefinitely postpone it or refetch dozens of tables on every change.
  if(typeof document!=='undefined'&&document.visibilityState==='hidden')return;
  if(Date.now()<backendRecoveryAfter.current)return;
  if(realtimeReloadTimer.current)return;
  const cooldown=Math.max(0,3000-(Date.now()-lastFullReloadAt.current));
  realtimeReloadTimer.current=setTimeout(()=>{realtimeReloadTimer.current=null;void flushRealtimeReload()},Math.max(delay,cooldown));
 }
 async function flushRealtimeReload(){
  if(!alive.current||document.visibilityState==='hidden')return;
  if(realtimeReloadRunning.current){realtimeReloadQueued.current=true;return}
  const tables=new Set(realtimeDirtyTables.current);realtimeDirtyTables.current.clear();
  const version=++realtimeReloadVersion.current;
  realtimeReloadRunning.current=true;
  lastFullReloadAt.current=Date.now();
  try{await within(loadRealtimeSections(tables),RECONCILE_TIMEOUT_MS,'Обновление игровых данных')}
  catch(error){
   if(version===realtimeReloadVersion.current){backendRecoveryAfter.current=Date.now()+90000;setError(error)}
  }
  finally{
   if(version!==realtimeReloadVersion.current)return;
   realtimeReloadRunning.current=false;
   if(realtimeReloadQueued.current){realtimeReloadQueued.current=false;scheduleRealtimeReload(1000,[])}
  }
 }

 useEffect(()=>{
  alive.current=true;
  backendRecoveryAfter.current=0;
  clearGameData();setLoading(true);setRealtimeState('disconnected');
  let disposed=false,authReloadTimer:ReturnType<typeof setTimeout>|undefined,lastRecoveryAt=0;
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
  const recover=()=>{
    if(disposed||document.visibilityState==='hidden'||!authUser.current||!acceptedMember.current)return;
    // Focus + visibilitychange arrive together on some browsers. One recovery
    // suffices; explicit mutations and subscribed Realtime events bypass this guard.
    const now=Date.now();if(now-lastRecoveryAt<30000)return;
    lastRecoveryAt=now;
    // Focus, online and visibility events arrive together. Stage widgets
    // already own their focused reconciliation; do not broadcast a full refresh.
    if(realtimeDirtyTables.current.size)scheduleRealtimeReload(0,[]);
    else if(now-lastCoreSuccessAt.current>180000)
     scheduleRealtimeReload(0,['session_recovery','game_stages','game_votes']);
   };
  const visible=()=>{if(document.visibilityState==='visible')recover()};
  window.addEventListener('focus',recover);window.addEventListener('online',recover);document.addEventListener('visibilitychange',visible);
  return()=>{disposed=true;alive.current=false;readEpoch.current++;subscription.unsubscribe();clearTimeout(authReloadTimer);window.removeEventListener('focus',recover);window.removeEventListener('online',recover);document.removeEventListener('visibilitychange',visible);if(realtimeReloadTimer.current){clearTimeout(realtimeReloadTimer.current);realtimeReloadTimer.current=null}realtimeReloadVersion.current++;realtimeReloadRunning.current=false;realtimeReloadQueued.current=false;};
 },[gameId]);

 useEffect(()=>{
  if(!me?.user_id||me.game_id!==gameId)return;
  let disposed=false,scheduled=false;
  const subscriptionEpoch=readEpoch.current;
  const currentConnection=()=>!disposed&&subscriptionEpoch===readEpoch.current&&activeGameRef.current===gameId&&authUser.current===me.user_id;
  let liveConnected=false,lastPollAt=0;
  let dirtyPartyDocuments=false,dirtyChat=false,dirtyPins=false,dirtyOverview=false;
  const dirtyTables=new Set<string>();
  const reconcileTables=new Set<string>();
  let timer:ReturnType<typeof setTimeout>|undefined;
  let partyDocumentBurstTimer:ReturnType<typeof setTimeout>|undefined;
  function flush(){
   if(!currentConnection()||document.visibilityState==='hidden')return;
   const partyDocs=dirtyPartyDocuments,chat=dirtyChat,pins=dirtyPins,overview=dirtyOverview;
   const tables=[...dirtyTables];dirtyTables.clear();
   const reconcile=[...reconcileTables];reconcileTables.clear();
   dirtyPartyDocuments=false;dirtyChat=false;dirtyPins=false;dirtyOverview=false;
   // Another pushed table may have flushed a queued document delta already.
   // Cancel the burst timer so it cannot trigger an extra redundant read.
   if(partyDocs&&partyDocumentBurstTimer!==undefined){
    clearTimeout(partyDocumentBurstTimer);partyDocumentBurstTimer=undefined;
   }
   // Coalesce dependent reads; read tickets reject stale results after a delta.
   if(reconcile.length)scheduleRealtimeReload(1000,reconcile);
   for(const table of tables)notifyGameDataRefresh(gameId,table);
   // A document version changes no core identity or party membership.
   if(partyDocs&&(activeViewRef.current==='parties'||activeViewRef.current==='teacher'))void loadPartyDocuments();
    if(partyDocs)notifySectionUpdates(gameId);
   if(overview||chat)scheduleRealtimeChatOverview();
   if(chat&&chatOpenRef.current&&channelRef.current)void loadMessages(channelRef.current);
   if(pins&&channelRef.current)void loadChatPins(channelRef.current);
   
  }
  function schedule(){
   if(disposed||scheduled)return;
   scheduled=true;
   // Collapse bursts in the same JS turn without delaying the first update.
   void Promise.resolve().then(()=>{scheduled=false;flush()});
  }
  // Events received while hidden remain dirty and reconcile on return;
  // clearing the flags while hidden would silently lose these updates.
  const resumePending=()=>{
   // Visibility only changes ephemeral Realtime Presence; the existing
   // authoritative SQL presence and navigation journal are unchanged.
   syncNetworkPresence();
   if(document.visibilityState==='visible'&&chatOpenRef.current&&channelRef.current)void markChatRead(channelRef.current);
   if(document.visibilityState==='visible'&&
     (reconcileTables.size>0||dirtyTables.size>0||dirtyPartyDocuments||dirtyChat||dirtyPins||dirtyOverview))schedule();
  };
  document.addEventListener('visibilitychange',resumePending);
  const channel=supabase.channel('gos-id-live:'+gameId,{config:{private:true}});
  // State pulse: reuse the existing game channel. One UPDATE notification
  // replaces a 15-query core reload for all connected classroom clients.
  // The source payload is still scoped by game_id and Realtime RLS.
  // Postgres DELETE events are not RLS-filtered: subscribe only to INSERT
  // and UPDATE, both of which enforce each game's existing SELECT policy.
  for(const metricEvent of ['INSERT','UPDATE'] as const){
   channel.on('postgres_changes',{event:metricEvent,schema:'public',table:'state_metrics',filter:'game_id=eq.'+gameId},payload=>{
    if(!currentConnection())return;
    const next=payload.new as unknown as Metric;
    if(!next?.id||next.game_id!==gameId)return;
    setMetrics(previous=>previous.some(item=>item.id===next.id)
     ?previous.map(item=>item.id===next.id?next:item)
     :[...previous,next]);
    if(activeViewRef.current==='budget')notifyGameDataRefresh(gameId,'state_metrics');
   });
  }
  // A chart/history entry arrives on the same socket. Until a metric dialog
  // explicitly loads older records, keep only the latest 50 history rows.
  channel.on('postgres_changes',{event:'INSERT',schema:'public',table:'state_metric_history',filter:'game_id=eq.'+gameId},payload=>{
   if(!currentConnection())return;
   const entry=payload.new as unknown as MetricHistory;
   if(!entry?.id||entry.game_id!==gameId)return;
   setMetricHistory(previous=>previous.some(item=>item.id===entry.id)?previous:
    [...previous,entry].sort((a,b)=>a.recorded_at.localeCompare(b.recorded_at)||a.id-b.id).slice(-50));
  });
  // Render the authorised INSERT payload immediately rather than waiting
  // for another PostgREST query. RLS still governs Realtime visibility.
  channel.on('postgres_changes',{event:'*',schema:'public',table:'chat_messages',filter:'game_id=eq.'+gameId},payload=>{
   if(!currentConnection())return;
   if(payload.eventType==='INSERT'){
    const row=payload.new as unknown as Message;
    if(row?.id&&row.game_id===gameId&&row.channel_id===channelRef.current){
     setMessages(previous=>mergeChatMessages(previous,[row],chatWindowLimit()));
     if(row.storage_path){
      void signedAssetUrl('game-media',row.storage_path).then(url=>{
       if(currentConnection()&&channelRef.current===row.channel_id&&url)
        setMessages(previous=>mergeChatMessages(previous,[{...row,url}],chatWindowLimit()));
      }).catch(()=>{/* A later media URL refresh can retry. */});
     }
    }
   }else if(payload.eventType==='DELETE'){
    const id=(payload.old as {id?:string}|null)?.id;
    if(id)setMessages(previous=>previous.filter(m=>m.id!==id));
   }else if(payload.eventType==='UPDATE'){
    // An edit in another channel must not reload the visible channel.
    // Still reconcile a moved row that was previously visible here.
    const next=payload.new as Partial<Message>;
    if(!next.channel_id||next.channel_id===channelRef.current||messageRowsRef.current.some(row=>row.id===next.id))dirtyChat=true;
   }
   dirtyOverview=true;schedule();
  });
  for(const table of ['chat_mentions','chat_channel_state','chat_pins']){
   channel.on('postgres_changes',{event:'*',schema:'public',table,filter:'game_id=eq.'+gameId},payload=>{
    if(table==='chat_pins'){
     const next=payload.new as Partial<ChatPin>|null,previous=payload.old as Partial<ChatPin>|null;
     if(chatOpenRef.current&&channelRef.current&&
       (next?.channel_id===channelRef.current||previous?.channel_id===channelRef.current||
        (payload.eventType==='INSERT'?!next?.channel_id:!previous?.channel_id)))dirtyPins=true;
    }else dirtyOverview=true;
    schedule();
   });
  }
  function acceptCoreDelta(table:string,payload:{eventType:string;new:Record<string,unknown>}){
   if(!currentConnection()||!alive.current)return true;
   if(payload.eventType!=='INSERT'&&payload.eventType!=='UPDATE')return false;
   const row=payload.new;
   if(row.game_id&&row.game_id!==gameId)return true;
   if(row.game_id!==gameId||typeof row.id!=='string'||typeof row.title!=='string'||!Number.isInteger(row.stage_no))return false;
   if(table==='game_stages'){
    if(!['locked','open','completed'].includes(String(row.status)))return false;
    const next=row as unknown as Stage;
    startRead('stages');
    setStages(previous=>[...previous.filter(old=>old.id!==next.id),next].sort((a,b)=>a.stage_no-b.stage_no));
    reconcileTables.add('stage_game');
    return true;
   }
   if(table==='game_votes'){
    if(!['open','closed'].includes(String(row.status))||typeof row.opened_at!=='string')return false;
    const next=row as unknown as Vote;
    startRead('votes');
    setVotes(previous=>[...previous.filter(old=>old.id!==next.id),next].sort((a,b)=>b.opened_at.localeCompare(a.opened_at)));
    if(['votes','stages','teacher'].includes(activeViewRef.current)){changedVoteIds.current.add(next.id);reconcileTables.add('vote_ballots')}
    return true;
   }
   if(table==='formal_documents'){
    if(typeof row.updated_at!=='string'||typeof row.status_code!=='string')return false;
    const next=row as unknown as FormalDocument;
    startRead('formal');
    formalFullVersion.current='';
    setFormalDocuments(previous=>{
     const old=previous.find(doc=>doc.id===next.id);
     return [...previous.filter(doc=>doc.id!==next.id),{...next,file_url:old?.source_file_path===next.source_file_path?old?.file_url||null:null}]
      .sort((a,b)=>b.updated_at.localeCompare(a.updated_at));
    });
    if(activeViewRef.current==='documents'){changedFormalIds.current.add(next.id);reconcileTables.add('formal_document_changes')}
    return true;
   }
   return false;
  }
  for(const table of ['game_stages','party_invitations','party_chair_ballots','formal_documents','political_posts','game_votes','blitz_assignments','stage_deadline_rules']){
   channel.on('postgres_changes',{event:'*',schema:'public',table,filter:'game_id=eq.'+gameId},payload=>{
    if(!currentConnection())return;
    if('game_id' in payload.new&&payload.new.game_id!==gameId)return;
    dirtyTables.add(table);
    if(!acceptCoreDelta(table,payload))reconcileTables.add(table);
    schedule();
   });
  }
  // Metadata-only Broadcast replaces one per-row Postgres Changes handler.
  // The private topic is authorised with game membership in realtime.messages RLS.
  // Never trust Broadcast as data: existing RLS queries supply document content.
  // All game members can already SELECT game_parties under RLS. Its former
  // Postgres Changes handler used only invalidation, never the full row.
  // Keep the same immediate refresh semantics and existing RLS read path.
  channel.on('broadcast',{event:'game_parties_changed'},payload=>{
   if(!currentConnection()||payload.payload?.table!=='game_parties')return;
   invalidatePartyRows();
   dirtyTables.add('game_parties');
   reconcileTables.add('game_parties');
   schedule();
  });
  channel.on('broadcast',{event:'party_documents_changed'},payload=>{
   if(!currentConnection()||payload.payload?.table!=='party_documents')return;
   dirtyPartyDocuments=true;
   // One changed document can reach 100 clients; several uploads or status
   // updates must not cause one REST read per individual Broadcast message.
   // Cap the delay from the *first* change, not from the last (no starvation).
   // Hidden tabs keep the dirty flag for the existing visibility recovery.
   if(document.visibilityState!=='visible'||partyDocumentBurstTimer!==undefined)return;
   partyDocumentBurstTimer=setTimeout(()=>{
    partyDocumentBurstTimer=undefined;
    if(currentConnection())schedule();
   },600);
  });
  // KSRF proposals use this existing authorised game socket, not five widget channels.
  // Only interested stage views refresh their proposal lists.
  for(const table of ['parliamentary_election_rules','regional_election_rules']){
   channel.on('postgres_changes',{event:'*',schema:'public',table,filter:'game_id=eq.'+gameId},()=>notifyGameDataRefresh(gameId,table));
  }
  for(const table of ['duma_sessions','duma_agenda_items','institution_session_registrations','bill_amendments','bill_amendment_packs']){
   channel.on('postgres_changes',{event:'*',schema:'public',table,filter:'game_id=eq.'+gameId},()=>notifyGameDataRefresh(gameId,table));
  }
  liveRef.current=channel;
  // The already-private game channel also carries low-frequency Presence.
  // Supabase assigns an ephemeral presence key. Never publish user IDs, roles,
  // names, current pages or other personally identifying game data.
  let networkPresenceTracked=false,networkPresencePending=false,networkPresenceEpoch=0;
  function syncNetworkPresence(){
   if(!currentConnection()||!liveConnected||networkPresencePending)return;
   const shouldTrack=document.visibilityState==='visible';
   if(shouldTrack===networkPresenceTracked)return;
   const requestEpoch=networkPresenceEpoch;
   networkPresencePending=true;
   let succeeded=false;
   void (shouldTrack?channel.track({connected:true}):channel.untrack())
    .then(result=>{
     // An old socket's ACK cannot mark Presence as tracked on a new socket.
     if(!currentConnection()||!liveConnected||requestEpoch!==networkPresenceEpoch)return;
     if(result!=='ok')return; // Failed joins must not trigger retry loops.
     networkPresenceTracked=shouldTrack;succeeded=true;
    })
    .catch(()=>{/* Offline/browser limitations keep the SQL recovery path. */})
    .finally(()=>{
     networkPresencePending=false;
     if(!currentConnection()||!liveConnected)return;
     // Only a changed connection epoch authorises one new attempt after a
     // stale ACK. An ordinary error must never create a retry storm.
     if(requestEpoch!==networkPresenceEpoch){syncNetworkPresence();return}
     if(succeeded&&(document.visibilityState==='visible')!==networkPresenceTracked)
      syncNetworkPresence();
    });
  }
  setRealtimeState('connecting');
  // A private Realtime topic needs the user's current JWT before joining.
  // Keep the original single game channel and its offline/visible-tab recovery.
  void supabase.realtime.setAuth().then(()=>{
   if(!currentConnection())return;
   channel.subscribe(status=>{
    if(disposed)return;
    const wasConnected=liveConnected;
    liveConnected=status==='SUBSCRIBED';
    if(wasConnected&&!liveConnected){
     networkPresenceEpoch++;
     networkPresenceTracked=false;
    }
    setGameRealtimeConnection(gameId,liveConnected);
    if(liveConnected){lastPollAt=Date.now();syncNetworkPresence()}
    setRealtimeState(liveConnected?'connected':'disconnected');
   });
  }).catch(()=>{
   // A failed private join never authorises a public fallback.
   // The existing bounded visible-tab poll remains the recovery path.
   if(currentConnection()){setGameRealtimeConnection(gameId,false);setRealtimeState('disconnected')}
  });
  // Visible-tab recovery works even when a WebSocket cannot connect.
  // Deterministic jitter prevents 40 simultaneous clients from polling in lockstep.
  const pollJitter=[...me.user_id].reduce((hash,char)=>(Math.imul(hash,31)+char.charCodeAt(0))>>>0,0)%10000;
  const poll=setInterval(()=>{
   if(document.visibilityState!=='visible')return;
   // Realtime already dispatches targeted refreshes. A backup full read is
   // necessary only occasionally while connected; polling every 30s even
   // on healthy subscriptions multiplied database requests and egress.
   // When disconnected, retain the existing prompt 30–40s recovery.
   const now=Date.now();
   const officeCache=officeReadState.current;
   if(officeCache.lastSuccessAt&&now-officeCache.lastSuccessAt>=PRESENTATION_CACHE_TTL_MS&&
      !officeCache.inflight&&now-officeCache.lastAttemptAt>=60000&&now>=backendRecoveryAfter.current)
    void loadRepublicOffices();
   if(liveConnected&&now-lastPollAt<180000)return;
   // Preserve explicit actions and Realtime updates, but back off automatic
   // full reloads while the server reports exhausted connections/timeouts.
   if(!liveConnected&&now<backendRecoveryAfter.current)return;
   lastPollAt=now;
   // The existing single-game Realtime socket already supplies hot deltas.
   // Verify the current authority every 3m, but do not request all 11 core
   // collections from 40 clients. Offline clients additionally reconcile
   // stages and vote status through two scoped RLS reads.
   reconcileTables.add('session_recovery');
   if(!liveConnected){reconcileTables.add('game_stages');reconcileTables.add('game_votes')}
   // Non-published data must not remain stale when full polling is removed.
   // Recover just the visible screen's collections every 3 minutes.
   const view=activeViewRef.current,lastPassive=passiveSyncAt.current.get(view)||lastFullPresentationAt.current;
   if(now-lastPassive>=180000){
    const groups=passiveSections(view);
    for(const table of groups)reconcileTables.add(table);
    if(groups.length)passiveSyncAt.current.set(view,now);
   }
   dirtyOverview=true;
   if(chatOpenRef.current){dirtyChat=true;dirtyPins=true}
   schedule();
  },30000+pollJitter);
  // Realtime handles unread counters while chat is closed. Full chat recovery
  // runs only for an actively open conversation.
  let lastChatRecoveryAt=Date.now();
  const recoverVisibleChatAndBallots=()=>{
   if(document.visibilityState!=='visible'||!currentConnection())return;
   // Ordinary ballots are outside Realtime publication; reconcile only open
   // procedures on their visible screens, using the existing six-second timer.
   if(Date.now()>=backendRecoveryAfter.current&&['votes','stages','teacher'].includes(activeViewRef.current)){
    const openVotes=votesRef.current.filter(vote=>vote.status==='open');
    if(openVotes.length){for(const vote of openVotes)changedVoteIds.current.add(vote.id);scheduleRealtimeReload(0,['vote_ballots'])}
   }
   if(!chatOpenRef.current)return;
   const now=Date.now();
   // Incoming messages update from the existing authorised Realtime payload.
   // When that socket is healthy, a full chat recovery once per minute is
   // sufficient; when disconnected, preserve the 6s recovery cadence.
   if(liveConnected&&now-lastChatRecoveryAt<60000)return;
   lastChatRecoveryAt=now;
   if(channelRef.current)void loadRecentChatMessages(channelRef.current);
   void loadChatOverview();
  };
  // Spread identical six-second recovery work across the classroom, instead
  // of making 100 devices hit PostgREST at the same wall-clock instant.
  // Keep the interval itself at six seconds: no additional staleness window.
  const recoveryHash=[...me.user_id].reduce((hash,char)=>
   Math.imul(hash^char.charCodeAt(0),16777619)>>>0,2166136261);
  const initialRecoveryDelay=500+recoveryHash%5500;
  let chatRecovery:ReturnType<typeof setInterval>|null=null;
  const startChatRecovery=setTimeout(()=>{
   if(disposed)return;
   recoverVisibleChatAndBallots();
   chatRecovery=setInterval(recoverVisibleChatAndBallots,6000);
  },initialRecoveryDelay);
  return()=>{
   disposed=true;clearTimeout(timer);clearTimeout(partyDocumentBurstTimer);clearInterval(poll);clearTimeout(startChatRecovery);
   if(chatRecovery!==null)clearInterval(chatRecovery);
   document.removeEventListener('visibilitychange',resumePending);
   setGameRealtimeConnection(gameId,false);
   if(liveRef.current===channel)liveRef.current=null;
   void supabase.removeChannel(channel);
  };
 },[gameId,me?.user_id,me?.kind,me?.role_title,me?.team,me?.group_name,me?.roster_archived_at]);

 useEffect(()=>()=>{
  const rec=recorder.current;
  if(rec&&rec.state!=='inactive'){
   if(captureRef.current)captureRef.current.discard=true;
   rec.stop();
  }
  recordingStream.current?.getTracks().forEach(track=>track.stop());
  if(previewRef.current)URL.revokeObjectURL(previewRef.current.url);
 },[]);

 useEffect(()=>{
  chatChannelVersion.current++;
  channelRef.current=channelId;messageRowsRef.current=[];setMessages([]);
  oldestChatCursor.current=null;requestedHistoryCount.current=CHAT_HISTORY_PAGE_SIZE;
  loadingOlderChatRef.current=false;
  setHasOlderChatMessages(false);setOlderChatLoading(false);
  setChatPins([]);setPinnedMessages([]);
  // Don't load message bodies for a closed panel.
  if(channelId&&chatOpen){
   void loadMessages(channelId,true);void loadChatPins(channelId);void markChatRead(channelId);
  }else setChatLoading(false);
 },[channelId]);
 // Reconcile changes missed while closed. Switching channels already loads history.
 useEffect(()=>{
  if(chatOpen&&channelRef.current&&oldestChatCursor.current===null)
   void loadMessages(channelRef.current,true);
  else if(chatOpen&&channelRef.current)
   void loadMessages(channelRef.current);
  if(chatOpen&&channelRef.current)void loadChatPins(channelRef.current);
 },[chatOpen]);
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

 // Persist authorised presentation deltas from Realtime without fetching
 // anything extra. Debounce successive changes to avoid storage-write bursts.
 useEffect(()=>{
  const uid=me?.user_id;
  if(!uid||me?.game_id!==gameId||authUser.current!==uid||
     acceptedMember.current?.user_id!==uid||lastCoreSuccessAt.current===0)return;
  const epoch=readEpoch.current;
  const timer=setTimeout(()=>{
   if(!alive.current||authUser.current!==uid||epoch!==readEpoch.current||
      acceptedMember.current?.user_id!==uid)return;
   void writeLocalGameSnapshot(gameId,uid,{stages,metrics,events});
  },1500);
  return()=>clearTimeout(timer);
 },[gameId,me?.user_id,stages,metrics,events]);
 useEffect(()=>{
  if(!me?.user_id)return;
  void hydrateActiveView(true);
  const now=Date.now(),last=passiveSyncAt.current.get(activeView)||lastFullPresentationAt.current;
  if(lastCoreSuccessAt.current>0&&now-last>=180000){
   const groups=passiveSections(activeView);
   if(groups.length){
    passiveSyncAt.current.set(activeView,now);
    scheduleRealtimeReload(0,groups);
   }
  }
 },[activeView,me?.user_id,gameId]);
 useEffect(()=>{if(chatOpen&&me?.user_id)void loadChatOverview();},[chatOpen,me?.user_id,gameId]);

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
    const transient=[g.error,m.error].some(error=>{
     const code=String((error as {code?:string}|null)?.code||'');
     const message=String((error as {message?:string}|null)?.message||'');
     return ['PGRST003','PGRST000','PGRST001','57014'].includes(code)||
      /timeout|timed out|connection|gateway|unavailable|fetch failed|too many/i.test(message);
    });
    if(!transient)throw (g.error||m.error);
    // One staggered recovery; do not retry 40 students in sync.
    const retryJitter=[...u.id].reduce((hash,char)=>hash+char.charCodeAt(0),0)%2500;
    await new Promise(resolve=>setTimeout(resolve,4000+retryJitter));
    [g,m]=await within(readIdentity(u.id),BOOTSTRAP_TIMEOUT_MS,'Повторное открытие игровой сессии');
    if(!readCurrent(ticket,'all'))return;
    if(g.error||m.error)throw (g.error||m.error);
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
   // Restore public display-only data after authoritative role verification.
   // A completed network refresh always has precedence over the local copy.
   const identityEpoch=readEpoch.current;
   void readLocalGameSnapshot(gameId,u.id).then(snapshot=>{
    if(!snapshot||!alive.current||authUser.current!==u.id||
      acceptedMember.current?.user_id!==u.id||readEpoch.current!==identityEpoch||
      lastCoreSuccessAt.current>0)return;
    setStages(previous=>previous.length?previous:snapshot.stages);
    setMetrics(previous=>previous.length?previous:snapshot.metrics);
    setEvents(previous=>previous.length?previous:snapshot.events);
   });
   setLoading(false);
  }catch(error){if(readCurrent(ticket,'all'))setError(error)}
  finally{if(readCurrent(ticket,'all'))setLoading(false)}
 }

 async function loadRealtimeSections(tables:Set<string>){
  if(tables.has('session_recovery')){
   const uid=authUser.current,epoch=readEpoch.current;
   if(!uid)return;
   // A small authoritative identity read preserves role revocation and game
   // isolation without downloading the entire game on each recovery tick.
   const [g,m]=await within(readIdentity(uid),BOOTSTRAP_TIMEOUT_MS,'Проверка доступа к игре');
   if(!alive.current||epoch!==readEpoch.current||uid!==authUser.current||activeGameRef.current!==gameId)return;
   if(g.error||m.error)throw g.error||m.error;
   if(!g.data||!m.data){
    readEpoch.current++;clearGameData();setError('Нет доступа к игре');return;
   }
   const old=acceptedMember.current,newMember=m.data as Member;
   const roleChanged=!!old&&(['kind','role_title','team','group_name','roster_archived_at'] as const)
    .some(key=>old[key]!==newMember[key]);
   await acceptIdentity(g,m,uid);
   if(roleChanged){void hydrateActiveView();return}
   lastCoreSuccessAt.current=Date.now();
  }
  if(tables.has('*')){await hydrateActiveView();return}
   const jobs:Promise<unknown>[]=[];
   if(tables.has('game_members')){
    // Revalidate membership and refresh only the roster, not eleven core tables.
    if(!tables.has('session_recovery')){
     const previousEpoch=readEpoch.current;
     await loadRealtimeSections(new Set(['session_recovery']));
     if(previousEpoch!==readEpoch.current||!acceptedMember.current)return;
    }
    jobs.push(readSafely(['members'],async ticket=>{
     const roster=await loadMemberRoster();
     if(!readCurrent(ticket))return;
     requireSuccessful([roster]);
     setMembers((roster.data||[]) as Member[]);
    }));
   }
  const view=activeViewRef.current;
  if(tables.has('game_stages'))jobs.push(readSafely(['game','stages'],async ticket=>{
   const [g,st]=await Promise.all([
    supabase.from('games').select('*').eq('id',gameId).maybeSingle(),
    supabase.from('game_stages').select('*').eq('game_id',gameId).order('stage_no')
   ]);
   if(!readCurrent(ticket))return;
   requireSuccessful([g,st]);
   if(g.data)setGame(g.data as Game);
   setStages((st.data||[]) as Stage[]);
  }));
  else if(tables.has('stage_game'))jobs.push(readSafely(['game'],async ticket=>{
   const g=await supabase.from('games').select('*').eq('id',gameId).maybeSingle();
   if(!readCurrent(ticket))return;
   requireSuccessful([g]);if(g.data)setGame(g.data as Game);
  }));
  if(tables.has('game_votes')||tables.has('vote_ballots'))jobs.push(readSafely(['votes'],async ticket=>{
   const retryStale=()=>{if(readActive(ticket))scheduleRealtimeReload(3000,[tables.has('game_votes')?'game_votes':'vote_ballots'])};
   const vo=tables.has('game_votes')
    ?await supabase.from('game_votes').select('*').eq('game_id',gameId).order('opened_at',{ascending:false})
    :{data:votesRef.current,error:null};
   if(!readCurrent(ticket)){retryStale();return}
   requireSuccessful([vo]);
   const rows=(vo.data||[]) as Vote[];setVotes(rows);
   if(!rows.length){setBallots([]);return}
   const ids=tables.has('game_votes')?rows.map(row=>row.id):[...changedVoteIds.current];
   if(!ids.length)return;
   const ba=await limitedCoreRead(supabase.from('game_ballots').select(GAME_BALLOT_COLUMNS).in('vote_id',ids));
   if(!readCurrent(ticket)){retryStale();return}
   requireSuccessful([ba]);for(const id of ids)changedVoteIds.current.delete(id);
   setBallots(previous=>[...previous.filter(row=>!ids.includes(row.vote_id)),...(ba.data||[]) as Ballot[]]);
  }));
  if(tables.has('game_events'))jobs.push(readSafely(['events'],async ticket=>{
   const r=await limitedCoreRead(supabase.from('game_events').select('*')
    .eq('game_id',gameId).order('published_at',{ascending:false}).limit(100));
   if(!readCurrent(ticket))return;
   requireSuccessful([r]);setEvents((r.data||[]) as EventItem[]);
  }));
  if(tables.has('game_documents'))jobs.push(readSafely(['documents'],async ticket=>{
   const r=await limitedCoreRead(supabase.from('game_documents').select('*')
    .eq('game_id',gameId).order('created_at',{ascending:false}));
   if(!readCurrent(ticket))return;
   requireSuccessful([r]);setDocuments((r.data||[]) as GameDocument[]);
  }));
  if(tables.has('game_crises'))jobs.push(readSafely(['crises'],async ticket=>{
   const r=await limitedCoreRead(supabase.from('game_crises').select('*')
    .eq('game_id',gameId).order('created_at',{ascending:false}));
   if(!readCurrent(ticket))return;
   requireSuccessful([r]);setCrises((r.data||[]) as Crisis[]);
  }));
  if(tables.has('game_profiles'))jobs.push(readSafely(['profiles'],async ticket=>{
   const r=await limitedCoreRead(supabase.from('game_profiles').select('*').eq('game_id',gameId));
   if(!readCurrent(ticket))return;
   requireSuccessful([r]);
   setProfiles(previous=>((r.data||[]) as GameProfile[]).map(row=>{
    const old=previous.find(p=>p.user_id===row.user_id);
    return {...row,avatar_url:old?.avatar_path===row.avatar_path?old?.avatar_url:null,
     signature_url:old?.signature_path===row.signature_path?old?.signature_url:null};
   }));
  }));
  if(tables.has('chat_channels'))jobs.push(readSafely(['channels'],async ticket=>{
   const r=await limitedCoreRead(supabase.from('chat_channels').select('*')
    .eq('game_id',gameId).order('name'));
   if(!readCurrent(ticket))return;
   requireSuccessful([r]);setChannels((r.data||[]) as Channel[]);
  }));
  if(tables.has('game_evaluations'))jobs.push(readSafely(['evaluations'],async ticket=>{
   const result=await limitedCoreRead(supabase.from('game_evaluations').select('*')
    .eq('game_id',gameId).order('stage_no'));
   if(!readCurrent(ticket))return;
   requireSuccessful([result]);setEvaluations((result.data||[]) as Evaluation[]);
  }));
  if(tables.has('game_parties'))jobs.push(readSafely(['parties'],async ticket=>{
   const pa=await loadCachedParties(true);
   if(!readCurrent(ticket))return;
   requireSuccessful([pa]);acceptPartyRows((pa.data||[]) as Party[],ticket);
  }));
  if(tables.has('game_office_assignments'))jobs.push(loadRepublicOffices(true));
  if(tables.has('formal_document_changes')){
   const ids=[...changedFormalIds.current];
   if(view==='documents'&&ids.length)jobs.push(loadFormalRegistry(ids));
  }
  if(tables.has('formal_documents')){
   if(view==='documents')jobs.push(loadFormalRegistry());
   else jobs.push(readSafely(['formal'],async ticket=>{
    // Realtime reconciliation uses table RLS, but skips every document's
    // body and metadata unless the user opens a document-dependent section.
    const fd=await limitedCoreRead(supabase.from('formal_documents')
     .select(FORMAL_DOCUMENT_SUMMARY_COLUMNS).eq('game_id',gameId)
     .order('updated_at',{ascending:false}));
    if(!readCurrent(ticket))return;
    requireSuccessful([fd]);
    const summaries=(fd.data||[]) as FormalDocumentSummary[];
    // A summary-only response must never be mistaken for a fully hydrated cache.
    if(formalFullVersion.current!==formalVersion(summaries as FormalDocument[]))
     formalFullVersion.current='';
    setFormalDocuments(previous=>mergeFormalDocumentSummaries(previous,summaries));
   }));
  }
  if(tables.has('political_posts')&&(view==='actions'||view==='dashboard'))jobs.push(loadPoliticalWall());
  if([...tables].some(table=>['party_invitations','party_chair_ballots','game_parties'].includes(table))
    &&(view==='parties'||view==='teacher'))jobs.push(loadPartyRepresentation(false));
  await Promise.allSettled(jobs);
 }

 function readLegacyBootstrap(){
  // Retained for schema-cache rollout only; never retry on 402, 429 or 5xx.
  return Promise.all([
   limitedCoreRead(supabase.from('games').select('*').eq('id',gameId).maybeSingle()),
   limitedCoreRead(supabase.from('state_metrics').select('*').eq('game_id',gameId).order('label')),
   limitedCoreRead(supabase.from('game_events').select('*').eq('game_id',gameId).order('published_at',{ascending:false}).limit(100)),
   limitedCoreRead(supabase.from('chat_channels').select('*').eq('game_id',gameId).order('name')),
   limitedCoreRead(supabase.from('game_stages').select('*').eq('game_id',gameId).order('stage_no')),
   limitedCoreRead(supabase.from('game_votes').select('*').eq('game_id',gameId).order('opened_at',{ascending:false})),
   limitedCoreRead(supabase.from('game_evaluations').select('*').eq('game_id',gameId).order('stage_no')),
   limitedCoreRead(supabase.from('game_crises').select('*').eq('game_id',gameId).order('created_at',{ascending:false})),
   limitedCoreRead(supabase.from('game_documents').select('*').eq('game_id',gameId).order('created_at',{ascending:false})),
   limitedCoreRead(supabase.from('game_profiles').select('*').eq('game_id',gameId)),
   limitedCoreRead(supabase.from('formal_documents').select('*').eq('game_id',gameId).order('updated_at',{ascending:false}))
  ]);
 }
 async function loadCoreSections(){
  const uid=authUser.current;
  if(!uid)return;
  const ticket=startRead('core','game','stages','votes','members','metrics','profiles','parties','formal','channels');
  const results=await (async()=>{
   // One RLS-scoped HTTP request for the initial core, current member, roster,
   // lightweight parties and the unchanged personal intro flag. Only missing RPCs
   // fall back during mixed-version publication.
   const entry=await limitedCoreRead(supabase.rpc('get_game_entry_v4',{p_game_id:gameId}));
   if(!entry.error){
    const payload=entry.data as Record<string,unknown>|null;
    const fields=['game','metrics','events','channels','stages','votes','evaluations','crises',
     'documents','profiles','formal_documents','member','roster','parties','intro'] as const;
    if(!payload||!fields.every(key=>Object.prototype.hasOwnProperty.call(payload,key))||
       !Array.isArray(payload.roster)||!Array.isArray(payload.parties))
     throw new Error('Сервер вернул неполные данные первоначального входа.');
    const row=(key:typeof fields[number])=>({data:payload[key],error:null});
    const partyRows=normalizePartyRows(payload.parties as PartyListRow[],false);
    const scope=gameId+':'+uid+':'+readEpoch.current;
    if(partyReadState.current.scope!==scope){
     invalidatePartyRows();
     partyReadState.current.scope=scope;
    }
    const cache=partyReadState.current;
    // Never downgrade a full party dossier or overwrite a pending full read.
    if(!cache.full&&!cache.inflight){
     cache.rows=partyRows;
     cache.lastSuccessAt=Date.now();
    }
    return [row('game'),row('member'),row('metrics'),row('events'),row('roster'),
     row('channels'),row('stages'),{data:partyRows,error:null},row('votes'),
     row('evaluations'),row('crises'),row('documents'),row('profiles'),
     row('formal_documents'),row('intro')];
   }
   const entryCode=String(entry.error.code||'');
   if(['42501','PGRST116'].includes(entryCode)){
    // The RLS/member gate is authoritative. Never leave a previously
    // rendered game or teacher panel visible after access is revoked.
    readEpoch.current++;
    clearGameData();
    setError('Нет доступа к игре');
    return null;
   }
   if(!['PGRST202','42883'].includes(entryCode))
    throw entry.error;
   // Entry identity was just verified by the server. Do not request the same
   // personal member row a second time before the first core snapshot.
   // Every subsequent core refresh reads it again to detect role changes.
   const entryScope=gameId+':'+uid+':'+readEpoch.current;
   const entryMember=lastCoreSuccessAt.current===0&&reusedEntryMemberScope.current!==entryScope&&
    acceptedMember.current?.game_id===gameId&&acceptedMember.current?.user_id===uid
     ?acceptedMember.current:null;
   // Even if the first request fails, a later retry rechecks the current role.
   if(entryMember)reusedEntryMemberScope.current=entryScope;
   const [bundle,m,mb,pa,intro]=await Promise.all([
    (async()=>{
     const primary=await limitedCoreRead(supabase.rpc('get_game_bootstrap_v3',{p_game_id:gameId}));
     // Mixed-version rollout: only a missing RPC may fall back to the legacy full bundle.
     return primary.error&&['PGRST202','42883'].includes(String(primary.error.code||''))
      ?limitedCoreRead(supabase.rpc('get_game_bootstrap_v2',{p_game_id:gameId})):primary;
    })(),
    entryMember?Promise.resolve({data:entryMember,error:null}):
     limitedCoreRead(supabase.from('game_members').select('*').eq('game_id',gameId).eq('user_id',uid).maybeSingle()),
    loadMemberRoster(),
    loadCachedParties(),
    limitedCoreRead(supabase.rpc('has_seen_my_intro'))
   ]);
   const fields=['game','metrics','events','channels','stages','votes','evaluations','crises','documents','profiles','formal_documents'] as const;
   const payload=bundle.data as Record<string,unknown>|null;
   if(bundle.error||!payload||!fields.every(key=>Object.prototype.hasOwnProperty.call(payload,key))){
    const status=bundle.status,code=String(bundle.error?.code||'');
    if([402,429,502,503,504].includes(status)||['PGRST003','57014','42501'].includes(code)){
     throw bundle.error||new Error('Данные игровой комнаты временно недоступны.');
    }
    // Rolling deployment compatibility: do not multiply requests on overload.
    const legacy=await readLegacyBootstrap();
    return [legacy[0],m,legacy[1],legacy[2],mb,legacy[3],legacy[4],pa,
     legacy[5],legacy[6],legacy[7],legacy[8],legacy[9],legacy[10],intro];
   }
   const row=(key:typeof fields[number])=>({data:payload[key],error:null});
   return [row('game'),m,row('metrics'),row('events'),mb,row('channels'),
    row('stages'),pa,row('votes'),row('evaluations'),row('crises'),
    row('documents'),row('profiles'),row('formal_documents'),intro];
  })().catch(error=>{
   if(readCurrent(ticket,'core')){backendRecoveryAfter.current=Date.now()+90000;setError(error)}
   return null;
  });
  if(!results)return;
  const [g,m,mt,ev,mb,ch,st,pa,vo,ge,cr,dc,pf,fd,intro]=results;
  // Store only published presentation data. Roles, answers, votes and private
  // metrics are never persisted on the student's device.
  if(!st.error&&!mt.error&&!ev.error&&authUser.current===uid){
   void writeLocalGameSnapshot(gameId,uid,{
    stages:(st.data||[]) as Stage[],
    metrics:((mt.data||[]) as Metric[]).filter(value=>value.is_public),
    events:(ev.data||[]) as EventItem[]
   });
  }
  if(!readCurrent(ticket,'core'))return;
  const coreResults=[g,m,mt,ev,mb,ch,st,pa,vo,ge,cr,dc,pf,fd,intro];
  if(coreResults.some(result=>['PGRST003','57014'].includes(String((result.error as {code?:string}|null)?.code||'')))){
   backendRecoveryAfter.current=Date.now()+90000;
  }else if(coreResults.every(result=>!result.error))backendRecoveryAfter.current=0;
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
  acceptedMember.current=member;lastCoreSuccessAt.current=Date.now();lastFullPresentationAt.current=lastCoreSuccessAt.current;if(readCurrent(ticket,'game'))setGame(g.data as Game);setMe(member);
  if(!mt.error&&readCurrent(ticket,'metrics'))setMetrics((mt.data||[]) as Metric[]);
  if(mt.error&&readCurrent(ticket,'metrics'))setError(mt.error);
  if(!ev.error)setEvents((ev.data||[]) as EventItem[]);
  if(!mb.error&&readCurrent(ticket,'members'))setMembers((mb.data||[]) as Member[]);
  if(!ch.error&&readCurrent(ticket,'channels'))setChannels((ch.data||[]) as Channel[]);
  if(!st.error&&readCurrent(ticket,'stages'))setStages((st.data||[]) as Stage[]);
  if(!pa.error&&readCurrent(ticket,'parties'))setParties(previous=>((pa.data||[]) as Party[]).map(row=>{
    const old=previous.find(p=>p.id===row.id);
    return {...row,logo_url:old?.logo_path===row.logo_path?old?.logo_url||null:null};
   }));
  if(!vo.error&&readCurrent(ticket,'votes')){
   const voteRows=(vo.data||[]) as Vote[];setVotes(voteRows);
   const ids=voteRows.map(v=>v.id);
   if(ids.length){
    const ba=await supabase.from('game_ballots').select(GAME_BALLOT_COLUMNS).in('vote_id',ids);
    // Session, game or a newer core refresh may have changed during this read.
    if(!readCurrent(ticket,'core'))return;
    if(!ba.error&&readCurrent(ticket,'votes'))setBallots((ba.data||[]) as Ballot[]);
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
  if(!fd.error&&readCurrent(ticket,'formal')){
   const summaries=(fd.data||[]) as FormalDocument[];
   // Keep a complete, still-current document cache after refreshing the lightweight core.
   if(!formalFullVersion.current||formalFullVersion.current!==formalVersion(summaries)){
    formalFullVersion.current='';setFormalDocuments(summaries);
   }
  }
  if(!intro.error)setIntroAccountSeen(!!intro.data);
 }

 function loadCoreForView(){
  const uid=authUser.current;
  if(!uid)return loadCoreSections();
  const key=gameId+':'+uid+':'+readEpoch.current;
  // Avoid concurrent initial entry reads. Subsequent explicit core refreshes
   // must still be authoritative, even when another screen is hydrating.
   if(lastCoreSuccessAt.current===0||initialCoreReads.current.has(key))
    return coalesceInFlight(initialCoreReads.current,key,loadCoreSections);
   return loadCoreSections();
 }

 async function hydrateActiveView(allowFreshCore=false,forceOffices=false){
  // Rapid view navigation can reuse recently updated common data.
  // Realtime, recovery and explicit refresh still force the core read.
  const jobs:Promise<unknown>[]=[loadRepublicOffices(forceOffices)];
  // Navigation does not invalidate an already verified core. Role/game are
  // checked by the small session_recovery RPC; opened sections read lazily.
  const core=!allowFreshCore||lastCoreSuccessAt.current===0
   ?loadCoreForView():null;
  if(core)jobs.unshift(core);
  const view=activeViewRef.current;
  if(view==='parties'||view==='profile')jobs.push(loadPartyAssets(view==='parties'));
  // Teacher dossiers must fetch document rows, not just party representation.
  if(view==='teacher')jobs.push(loadPartyDocuments());
  if(view==='teacher')jobs.push(loadPartyDossierRows());
  if(view==='parties'||view==='teacher')jobs.push(loadPartyRepresentation(false));
  if(view==='documents')jobs.push(loadFormalRegistry());
  // The entry RPC already delivers party summaries. On dashboard, wait for it
  // before the political wall reads the same parties from its scoped cache.
  if(view==='actions'||view==='dashboard')
   jobs.push(core?core.then(()=>loadPoliticalWall()):loadPoliticalWall());
  if(view==='teacher')jobs.push(loadClassroomTelemetry(),loadImpactEngine());
  if(chatOpenRef.current)jobs.push(loadChatOverview());
  await Promise.allSettled(jobs);
  // The overview needs document status/title only. Other opened sections receive
  // complete bodies on demand, once per unchanged document revision set.
  if(['stages','votes','actions','teacher'].includes(view)&&activeViewRef.current===view&&!formalFullVersion.current)
   await loadFormalDetails();
 }

 async function loadOlderPoliticalPosts():Promise<boolean>{
  if(!politicalHasOlder||politicalFullMode.current||politicalPagePending.current||!politicalCursor.current)return false;
  const cursor=politicalCursor.current,epoch=readEpoch.current;
  politicalPagePending.current=true;setPoliticalOlderLoading(true);
  try{
   const r=await supabase.rpc('get_political_wall_page',{
    p_game_id:gameId,p_cursor_pinned:!!cursor.pinned,p_cursor_created_at:cursor.created_at,p_cursor_id:cursor.id
   });
   if(!alive.current||activeGameRef.current!==gameId||readEpoch.current!==epoch||politicalFullMode.current)return false;
   if(r.error){setError(r.error);return false}
   const page=r.data as {posts?:PoliticalPost[];media?:PoliticalPostMedia[];formal_links?:PoliticalPostFormalLink[];has_more?:boolean}|null;
   if(!page||!Array.isArray(page.posts)||!Array.isArray(page.media)||!Array.isArray(page.formal_links)){setError('Не удалось загрузить историю публикаций.');return false}
   if(!page.posts.length){setPoliticalHasOlder(false);return false}
   const last=page.posts.at(-1)!;
   politicalOlderLoaded.current=true;
   politicalCursor.current={id:last.id,created_at:last.created_at,pinned:!!last.pinned};
   setPoliticalHasOlder(!!page.has_more);
   setPoliticalPosts(previous=>{
    const all=new Map(previous.map(p=>[p.id,p]));page.posts!.forEach(p=>all.set(p.id,p));
    return [...all.values()].sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||
     b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
   });
   setPostFormalLinks(previous=>[...new Map([...previous,...page.formal_links!].map(l=>[l.post_id+':'+l.formal_document_id,l])).values()]);
   if(page.posts.some(post=>post.source_key?.startsWith('media-party-registration:')))void loadPartyDocuments();
   setPoliticalMedia(previous=>{
    const cached=new Map(previous.map(row=>[row.id,row]));
    return [...new Map([...previous,...page.media!.map(row=>({...row,url:cached.get(row.id)?.url||null}))].map(row=>[row.id,row])).values()];
   });
   const attachments=page.media.filter(row=>row.storage_path);
   if(attachments.length)void Promise.all(attachments.map(async row=>({
    id:row.id,path:row.storage_path,url:await signedAssetUrl('game-assets',row.storage_path)
   }))).then(links=>{
    if(!alive.current||activeGameRef.current!==gameId||readEpoch.current!==epoch)return;
    const urls=new Map(links.map(x=>[x.id,x]));
    setPoliticalMedia(previous=>previous.map(row=>{
     const link=urls.get(row.id);return link&&link.path===row.storage_path?{...row,url:link.url||row.url||null}:row;
    }));
   }).catch(()=>{});
   return true;
  }finally{
   if(activeGameRef.current===gameId&&readEpoch.current===epoch){
    politicalPagePending.current=false;setPoliticalOlderLoading(false);
   }
  }
 }
 function setPoliticalWallFullSearch(enabled:boolean){
  if(politicalFullMode.current===enabled)return;
  politicalFullMode.current=enabled;politicalOlderLoaded.current=false;politicalCursor.current=null;
  politicalPagePending.current=false;setPoliticalHasOlder(false);
  if(enabled)setPoliticalSearchLoading(true);
  void loadPoliticalWall();
 }

 async function loadRepublicOffices(force=false):Promise<void>{
  // Share only presentation reads inside one authorised browser; auth and
  // role decisions continue through the authoritative game identity RPC.
  const scope=gameId+':'+(authUser.current||'')+':'+readEpoch.current;
  const cache=officeReadState.current;
  if(cache.scope!==scope){cache.scope=scope;cache.lastSuccessAt=0;cache.lastAttemptAt=0;cache.inflight=null}
  if(cache.inflight){await cache.inflight;return}
  if(!force&&cache.lastSuccessAt&&Date.now()-cache.lastSuccessAt<PRESENTATION_CACHE_TTL_MS)return;
  cache.lastAttemptAt=Date.now();
  const request=readSafely(['offices'],async ticket=>{
   const result=await supabase.from('game_office_assignments').select('id,game_id,user_id,role_title,status,created_at').eq('game_id',gameId).order('created_at');
   if(!readCurrent(ticket))return;
   requireSuccessful([result]);
   setOfficeRows((result.data||[]) as GameOfficeAssignment[]);
   if(cache.scope===scope)cache.lastSuccessAt=Date.now();
  });
  cache.inflight=request;
  try{await request}
  finally{if(cache.scope===scope&&cache.inflight===request)cache.inflight=null}
 }

 async function loadClassroomTelemetry(){
  await readSafely(['telemetry'],async ticket=>{
   // One teacher-only RLS snapshot; no change to presence writes or journal.
   const projection=await limitedCoreRead(supabase.rpc('get_classroom_telemetry_projection',{p_game_id:gameId}));
   if(!readCurrent(ticket))return;
   if(projection.error&&['PGRST202','42883'].includes(String(projection.error.code||''))){
    // Rolling schema rollout only: do not retry denied or overloaded RPCs.
    const [al,pr]=await Promise.all([
     supabase.from('game_activity').select('*').eq('game_id',gameId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(20),
     supabase.from('game_presence').select('*').eq('game_id',gameId).order('last_seen_at',{ascending:false})
    ]);
    if(!readCurrent(ticket))return;
    requireSuccessful([al,pr]);
    setActivities((al.data||[]) as Activity[]);setPresence((pr.data||[]) as Presence[]);
    return;
   }
   requireSuccessful([projection]);
   const data=projection.data as {activity?:Activity[];presence?:Presence[]}|null;
   if(!data||!Array.isArray(data.activity)||!Array.isArray(data.presence)){
    setError('Не удалось получить журнал аудитории.');return;
   }
   setActivities(data.activity);setPresence(data.presence);
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
  void signedDocumentLinks(rows.map(row=>({id:row.id,path:row.storage_path}))).then(links=>{
   if(!readCurrent(ticket,'partyDocuments'))return;
   const byId=new Map(links.map(link=>[link.id,link]));
   setPartyDocuments(previous=>previous.map(row=>{
    const link=byId.get(row.id);
    return link&&link.path===row.storage_path?{...row,url:link.url||row.url||null,url_loading:false}:row;
   }));
  });
 }

 async function loadPartyDossierRows(){
  // Teacher dossiers require long registration notes and descriptions, which
  // the initial dashboard deliberately omits. Upgrade only this party read.
  await readSafely(['parties'],async ticket=>{
   const result=await loadCachedParties();
   if(!readCurrent(ticket,'parties'))return;
   requireSuccessful([result]);
   acceptPartyRows((result.data||[]) as Party[],ticket);
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

 async function loadPartyAssets(includeDocuments=true){
  // Profile needs party identity and personal images, not party document rows
  // or their Storage signatures. Party/teacher dossiers retain full reads.
  const scopes:ReadScope[]=includeDocuments?['parties','profiles','partyDocuments']:['parties','profiles'];
  await readSafely(scopes,async ticket=>{
   // Render each table as soon as its own query completes.
   // An overloaded document service must not make parties disappear.
   const partyRead=loadCachedParties().then(({data,error})=>{
    if(!readCurrent(ticket,'parties'))return;
    if(error)setError(error);
    else acceptPartyRows((data||[]) as Party[],ticket);
   });
   const documentRead=includeDocuments
    ?Promise.resolve(supabase.from('party_documents').select('*').eq('game_id',gameId).order('created_at',{ascending:false})).then(({data,error})=>{
      if(!readCurrent(ticket,'partyDocuments'))return;
      if(error)setError(error);
      else acceptPartyDocuments((data||[]) as PartyDocument[],ticket);
     })
    :Promise.resolve();
   const includeProfileBio=activeViewRef.current==='profile';
   const profileQuery=!includeProfileBio
     ?supabase.from('game_profiles').select(PROFILE_ASSET_COLUMNS).eq('game_id',gameId)
     :supabase.from('game_profiles').select('*').eq('game_id',gameId);
    const profileRead=Promise.resolve(profileQuery).then(({data,error})=>{
    if(!readCurrent(ticket,'profiles'))return;
    if(error){setError(error);return}
   if(readCurrent(ticket,'profiles')){
    const rows=(data||[]) as unknown as GameProfile[];
    setProfiles(previous=>{
     const source=!includeProfileBio?mergeProfileAssetRows(previous,rows as ProfileAssetRow[]):rows;
     return source.map(row=>{
      const old=previous.find(p=>p.user_id===row.user_id);
      return {...row,avatar_url:old?.avatar_path===row.avatar_path?old?.avatar_url||null:null,
       signature_url:old?.signature_path===row.signature_path?old?.signature_url||null:null};
     });
    });
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
   // A single read-only RPC projects the three RLS-scoped collections.
   // Personal role checks and the existing party/roster cache stay separate.
   const [projection,pa,mb]=await Promise.all([
    limitedCoreRead(supabase.rpc('get_party_representation_projection',{p_game_id:gameId})),
    refreshParties?loadCachedParties(true):Promise.resolve({data:null,error:null}),
    loadMemberRoster()
   ]);
   if(!readActive(ticket))return;
   let pi:{data:PartyInvitation[]|null;error:unknown};
   let pm:{data:PartyMandateAllocation[]|null;error:unknown};
   let ag:{data:PartyAgreement[]|null;error:unknown};
   if(projection.error&&['PGRST202','42883'].includes(String(projection.error.code||''))){
    // Only a missing RPC can use the legacy per-table RLS read.
    const [oldInvites,oldMandates,oldAgreements]=await Promise.all([
     supabase.from('party_invitations').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
     supabase.from('party_member_mandates').select('*').eq('game_id',gameId),
     supabase.from('party_agreements').select('*').eq('game_id',gameId).order('created_at',{ascending:false})
    ]);
    pi={data:oldInvites.data,error:oldInvites.error};
    pm={data:oldMandates.data,error:oldMandates.error};
    ag={data:oldAgreements.data,error:oldAgreements.error};
   }else if(projection.error){
    pi={data:null,error:projection.error};pm={data:null,error:projection.error};ag={data:null,error:projection.error};
   }else{
    const payload=projection.data as {invitations?:PartyInvitation[];mandates?:PartyMandateAllocation[];agreements?:PartyAgreement[]}|null;
    if(!payload||!Array.isArray(payload.invitations)||!Array.isArray(payload.mandates)||!Array.isArray(payload.agreements)){
     setError('Не удалось получить представительство партий.');return;
    }
    pi={data:payload.invitations,error:null};pm={data:payload.mandates,error:null};ag={data:payload.agreements,error:null};
   }
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

 async function loadFormalDetails(){
  if(formalFullVersion.current)return;
  await readSafely(['formal'],async ticket=>{
   const response=await limitedCoreRead(supabase.from('formal_documents').select('*').eq('game_id',gameId).order('updated_at',{ascending:false}));
   if(!readCurrent(ticket))return;
   requireSuccessful([response]);
   const rows=(response.data||[]) as FormalDocument[];
   formalFullVersion.current=formalVersion(rows);
   setFormalDocuments(previous=>rows.map(row=>{
    const old=previous.find(doc=>doc.id===row.id);
    return {...row,file_url:old?.source_file_path===row.source_file_path?old.file_url||null:null};
   }));
  });
 }
 async function loadFormalRegistry(ids?:string[]){
  await readSafely(['formal'],async ticket=>{
   // One consistent RLS-scoped snapshot, also supporting narrow ID refresh.
   // Only a missing RPC may use the old two reads during schema rollout.
   const projection=await limitedCoreRead(supabase.rpc('get_formal_registry_projection',{
    p_game_id:gameId,p_document_ids:ids??null
   }));
   let fd:{data:FormalDocument[]|null;error:unknown};
   let fh:{data:FormalHistory[]|null;error:unknown};
   if(projection.error&&['PGRST202','42883'].includes(String(projection.error.code||''))){
    const docs=supabase.from('formal_documents').select('*').eq('game_id',gameId).order('updated_at',{ascending:false});
    const history=supabase.from('formal_document_history').select('*').eq('game_id',gameId).order('created_at',{ascending:false});
    const [previousDocuments,previousHistory]=await Promise.all([
     limitedCoreRead(ids?docs.in('id',ids):docs),
     limitedCoreRead(ids?history.in('document_id',ids):history)
    ]);
    fd={data:(previousDocuments.data||null) as FormalDocument[]|null,error:previousDocuments.error};
    fh={data:(previousHistory.data||null) as FormalHistory[]|null,error:previousHistory.error};
   }else if(projection.error){
    fd={data:null,error:projection.error};fh={data:null,error:projection.error};
   }else{
    const payload=projection.data as {documents?:FormalDocument[];history?:FormalHistory[]}|null;
    if(!payload||!Array.isArray(payload.documents)||!Array.isArray(payload.history)){
     setError('Не удалось загрузить реестр документов.');return;
    }
    fd={data:payload.documents,error:null};
    fh={data:payload.history,error:null};
   }
   if(!readCurrent(ticket)){
    if(readActive(ticket)){
     if(ids)for(const id of ids)changedFormalIds.current.add(id);
     scheduleRealtimeReload(3000,[ids?'formal_document_changes':'formal_documents']);
    }
    return;
   }
   requireSuccessful([fd,fh]);
   if(ids)for(const id of ids)changedFormalIds.current.delete(id);
   const rows=(fd.data||[]) as FormalDocument[];
   if(!ids)formalFullVersion.current=formalVersion(rows);
   // Render the register independently from Storage availability.
   setFormalDocuments(previous=>{
    const cached=new Map(previous.map(row=>[row.id,row]));
    const accepted=rows.map(row=>{
     const old=cached.get(row.id);
     return {...row,file_url:old?.source_file_path===row.source_file_path?old.file_url||null:null};
    });
    return (ids?[...previous.filter(row=>!ids.includes(row.id)),...accepted]:accepted).sort((a,b)=>b.updated_at.localeCompare(a.updated_at));
   });
   setFormalHistory(previous=>(ids?[...previous.filter(row=>!ids.includes(row.document_id)),...(fh.data||[]) as FormalHistory[]]:(fh.data||[]) as FormalHistory[]).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id-a.id));
   void signedDocumentLinks(rows.filter(row=>row.source_file_path).map(row=>({
    id:row.id,path:row.source_file_path!
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
   // Six RLS-checked feeds share one consistent PostgreSQL statement;
   // party identity stays in its independent session-scoped cache.

   const full=politicalFullMode.current;
   const [paged,pa]=await Promise.all([
    limitedCoreRead(full
     ?supabase.rpc('get_political_wall_projection',{p_game_id:gameId})
     :supabase.rpc('get_political_wall_page',{p_game_id:gameId})),
    loadCachedParties()
   ]);
   // Old deployments keep using their original projection until this
   // nonbreaking migration is installed. Never retry on rate limits.
   const projection=!full&&paged.error&&['PGRST202','42883'].includes(String(paged.error.code||''))
    ?await limitedCoreRead(supabase.rpc('get_political_wall_projection',{p_game_id:gameId}))
    :paged;
   if(!readActive(ticket))return;
   let pp:{data:PoliticalPost[]|null;error:unknown};
   let px:{data:PoliticalPostMedia[]|null;error:unknown};
   let pl:{data:PoliticalPostFormalLink[]|null;error:unknown};
   let mh:{data:MetricHistory[]|null;error:unknown};
   let psh:{data:PartySupportHistory[]|null;error:unknown};
   let mt:{data:Metric[]|null;error:unknown};
   if(projection.error&&['PGRST202','42883'].includes(String(projection.error.code||''))){
    // Compatible only with an absent RPC; no extra requests on overload.
    const [oldPosts,oldMedia,oldLinks,oldMetrics,oldSupport,oldState]=await Promise.all([
     supabase.from('political_posts').select('*').eq('game_id',gameId).order('created_at',{ascending:false}).limit(250),
     supabase.from('political_post_media').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
     supabase.from('political_post_formal_links').select('*').eq('game_id',gameId),
     supabase.from('state_metric_history').select('*').eq('game_id',gameId).order('recorded_at',{ascending:false}).order('id',{ascending:false}).limit(50),
     supabase.from('party_support_history').select('*').eq('game_id',gameId).order('recorded_at',{ascending:false}).order('id',{ascending:false}).limit(50),
     supabase.from('state_metrics').select('*').eq('game_id',gameId).order('sort_order')
    ]);
    pp={data:oldPosts.data,error:oldPosts.error};px={data:oldMedia.data,error:oldMedia.error};
    pl={data:oldLinks.data,error:oldLinks.error};mh={data:oldMetrics.data,error:oldMetrics.error};
    psh={data:oldSupport.data,error:oldSupport.error};mt={data:oldState.data,error:oldState.error};
   }else if(projection.error){
    pp={data:null,error:projection.error};px={data:null,error:projection.error};
    pl={data:null,error:projection.error};mh={data:null,error:projection.error};
    psh={data:null,error:projection.error};mt={data:null,error:projection.error};
   }else{
    const data=projection.data as {posts?:PoliticalPost[];media?:PoliticalPostMedia[];formal_links?:PoliticalPostFormalLink[];metric_history?:MetricHistory[];support_history?:PartySupportHistory[];metrics?:Metric[];has_more?:boolean;total_posts?:number;actor_options?:{actor_key:string;actor_label:string}[]}|null;
    if(!data||!Array.isArray(data.posts)||!Array.isArray(data.media)||
       !Array.isArray(data.formal_links)||!Array.isArray(data.metric_history)||
       !Array.isArray(data.support_history)||!Array.isArray(data.metrics)){
     setError('Не удалось получить политическую ленту.');return;
    }
    pp={data:data.posts,error:null};px={data:data.media,error:null};
    pl={data:data.formal_links,error:null};mh={data:data.metric_history,error:null};
    psh={data:data.support_history,error:null};mt={data:data.metrics,error:null};
   }
   if(!readActive(ticket))return;
   requireSuccessful([pp,px,pl,mh,psh,mt,pa]);
   if(readCurrent(ticket,'political')){
    // Only sign files belonging to posts still visible under RLS.
    const posts=(pp.data||[]) as PoliticalPost[];
    const visiblePostIds=new Set(posts.map(post=>post.id));
    const rows=((px.data||[]) as PoliticalPostMedia[]).filter(item=>visiblePostIds.has(item.post_id));

    const pageData=projection.data as {has_more?:boolean;total_posts?:number}|null;
    const isPaged=!full&&typeof pageData?.has_more==='boolean';
    setPoliticalPostTotal(isPaged?Number(pageData?.total_posts||posts.length):posts.length);
    const actorData=projection.data as {actor_options?:{actor_key:string;actor_label:string}[]}|null;
    setPoliticalActorOptions(isPaged&&Array.isArray(actorData?.actor_options)
     ?actorData!.actor_options!:Array.from(new Map(posts.map(p=>[p.actor_key,{actor_key:p.actor_key,actor_label:p.actor_label}])).values()));
    if(full||!isPaged){
     politicalCursor.current=null;politicalOlderLoaded.current=false;setPoliticalHasOlder(false);
     setPoliticalPosts(posts);
    }else{
     if(!politicalOlderLoaded.current){
      const last=posts.at(-1);
      politicalCursor.current=last?{id:last.id,created_at:last.created_at,pinned:!!last.pinned}:null;
      setPoliticalHasOlder(!!pageData?.has_more);
      setPoliticalPosts(posts);
     }else{
      setPoliticalPosts(previous=>{
       const all=new Map(previous.filter(p=>p.game_id===gameId).map(p=>[p.id,p]));
       posts.forEach(p=>all.set(p.id,p));
       return [...all.values()].sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||
        b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
      });
     }
    }
    setPoliticalMedia(previous=>{
     const cached=new Map(previous.map(row=>[row.id,row]));
     const combined=politicalOlderLoaded.current&&!full?[...previous.filter(row=>!rows.some(r=>r.id===row.id)),...rows]:rows;
     return combined.map(row=>{
      const old=cached.get(row.id);
      return {...row,url:old?.storage_path===row.storage_path?old.url||null:null};
     });
    });
    setPostFormalLinks(previous=>politicalOlderLoaded.current&&!full
     ?[...new Map([...previous,...(pl.data||[] as PoliticalPostFormalLink[])].map(row=>[row.post_id+':'+row.formal_document_id,row])).values()]
     :(pl.data||[]) as PoliticalPostFormalLink[]);
    setMetricHistory(([...(mh.data||[])] as MetricHistory[]).sort((a,b)=>a.recorded_at.localeCompare(b.recorded_at)||a.id-b.id));
    setPartySupportHistory(([...(psh.data||[])] as PartySupportHistory[]).sort((a,b)=>a.recorded_at.localeCompare(b.recorded_at)||a.id-b.id));
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
   if(readCurrent(ticket,'political'))setPoliticalSearchLoading(false);
   if(readCurrent(ticket,'parties'))acceptPartyRows((pa.data||[]) as Party[],ticket);
  });
 }

 async function loadImpactEngine(){
  await readSafely(['impact'],async ticket=>{
   // Read-only projection: one consistent snapshot under each table's original RLS.
   // All scoring, manual corrections, and mutations remain unchanged.
   const response=await limitedCoreRead(supabase.rpc('get_impact_engine_projection',{p_game_id:gameId}));
   if(!readCurrent(ticket))return;
   if(response.error&&['PGRST202','42883'].includes(String(response.error.code||''))){
    // Only older schemas may fall back. Never amplify 402/429/5xx.
    const [ir,il]=await Promise.all([
     supabase.from('impact_rules').select('*').eq('game_id',gameId).order('priority'),
     supabase.from('impact_ledger').select('*').eq('game_id',gameId).order('created_at',{ascending:false}).limit(10)
    ]);
    if(!readCurrent(ticket))return;
    requireSuccessful([ir,il]);
    setImpactRules((ir.data||[]) as ImpactRule[]);setImpactLedger((il.data||[]) as ImpactLedger[]);
    return;
   }
   requireSuccessful([response]);
   const snapshot=response.data as {rules?:ImpactRule[];ledger?:ImpactLedger[]}|null;
   if(!snapshot||!Array.isArray(snapshot.rules)||!Array.isArray(snapshot.ledger)){
    setError('Не удалось получить состояние последствий.');return;
   }
   setImpactRules(snapshot.rules);
   setImpactLedger(snapshot.ledger);
  });
 }

 async function loadChatOverview(){
  const uid=authUser.current;
  if(!uid)return [];
  const scope=gameId+':'+uid+':'+readEpoch.current;
  return coalesceInFlight(chatOverviewReads.current,scope,async()=>{
   const result=await readSafely(['overview'],async ticket=>{
    const r=await limitedCoreRead(supabase.rpc('get_my_chat_overview',{p_game_id:gameId}));
    if(!readCurrent(ticket))return [] as ChatOverview[];
    requireSuccessful([r]);
    const rows=(r.data||[]) as ChatOverview[];
    setChatOverview(rows);
    return rows;
   });
   return result||[];
  });
 }
 async function markChatRead(cid:string){
  const uid=authUser.current;
  if(!cid||!uid||!alive.current||!chatOpenRef.current||channelRef.current!==cid||document.visibilityState!=='visible')return;
  const scope=gameId+':'+uid+':'+cid;
  if(readReceipt.current.scope!==scope){
   if(readReceipt.current.timer!==null)clearTimeout(readReceipt.current.timer);
   readReceipt.current={scope,timer:null,running:false,queued:false,lastAt:0};
  }
  const receipt=readReceipt.current;
  receipt.queued=true;
  if(receipt.running||receipt.timer!==null)return;
  const flush=async()=>{
   receipt.timer=null;
   if(receipt!==readReceipt.current||!alive.current||activeGameRef.current!==gameId||authUser.current!==uid
     ||!chatOpenRef.current||channelRef.current!==cid||document.visibilityState!=='visible')return;
   receipt.queued=false;receipt.running=true;receipt.lastAt=Date.now();
   try{
    const r=await within(supabase.rpc('mark_chat_channel_read',{p_channel_id:cid}));
    if(receipt===readReceipt.current&&!r.error)scheduleRealtimeChatOverview();
   }catch{/* An optional read receipt must not interrupt message delivery. */}
   finally{
    receipt.running=false;
    if(receipt===readReceipt.current&&receipt.queued)void markChatRead(cid);
   }
  };
  const delay=Math.max(0,3000-(Date.now()-receipt.lastAt));
  if(delay)receipt.timer=setTimeout(()=>void flush(),delay);
  else void flush();
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
    // Always fetch only the latest ten rows. Previously loaded older pages
    // must not be re-requested on new messages, refresh or reconnect.
    const r=await supabase.from('chat_messages').select('*').eq('channel_id',cid)
     .order('created_at',{ascending:false}).order('id',{ascending:false})
     .limit(CHAT_HISTORY_PAGE_SIZE);
    if(!readCurrent(ticket)||channelRef.current!==cid)return;
    requireSuccessful([r]);
    const cached=new Map(messageRowsRef.current.filter(m=>m.channel_id===cid).map(m=>[m.id,m]));
    const rows=((r.data||[]) as Message[]).map(m=>{
     const old=cached.get(m.id);
     return {...m,url:m.storage_path&&old?.storage_path===m.storage_path?old.url||null:null};
    });
    const ordered=[...rows].reverse();
    const oldestFetched=rows[rows.length-1];
    const recentWindowMoved=!!oldestFetched&&(
     oldestChatCursor.current?.id!==oldestFetched.id||
     oldestChatCursor.current?.created_at!==oldestFetched.created_at
    );
    // If no older pages were requested, newer messages can shift the latest
    // ten; advance the cursor so the displaced eleventh row stays reachable.
    if(initial||!oldestChatCursor.current||
       (requestedHistoryCount.current===CHAT_HISTORY_PAGE_SIZE&&recentWindowMoved)){
     oldestChatCursor.current=oldestFetched?{created_at:oldestFetched.created_at,id:oldestFetched.id}:null;
     setHasOlderChatMessages(rows.length===CHAT_HISTORY_PAGE_SIZE);
    }
    const newest=rows[0];
    const oldest=rows[rows.length-1];
    setMessages(previous=>{
     // Keep historical pages deliberately requested by the reader, but
     // replace the fetched recent window so missed deletions stay deleted.
     const retained=previous.filter(m=>m.channel_id===cid&&(
      newest&&(m.created_at>newest.created_at||(m.created_at===newest.created_at&&m.id>newest.id))||
      oldest&&requestedHistoryCount.current>CHAT_HISTORY_PAGE_SIZE&&
      (m.created_at<oldest.created_at||(m.created_at===oldest.created_at&&m.id<oldest.id))
     ));
     return mergeChatMessages(retained,ordered,chatWindowLimit());
    });
    // Sign only the newly fetched media; historical signed URLs are cached.
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
 async function loadOlderChatMessages():Promise<boolean>{
  const cid=channelRef.current,cursor=oldestChatCursor.current,version=chatChannelVersion.current;
  if(!cid||!cursor||loadingOlderChatRef.current||!hasOlderChatMessages)return false;
  loadingOlderChatRef.current=true;setOlderChatLoading(true);
  const ticket:ReadTicket={gameId,epoch:readEpoch.current,versions:{}};
  try{
   const r=await supabase.from('chat_messages').select('*').eq('channel_id',cid)
    .or(chatHistoryCursorFilter(cursor))
    .order('created_at',{ascending:false}).order('id',{ascending:false})
    .limit(CHAT_HISTORY_PAGE_SIZE);
   if(!readActive(ticket)||channelRef.current!==cid||chatChannelVersion.current!==version||r.error){
    if(r.error&&channelRef.current===cid)setError(userError(r.error));
    return false;
   }
   const rows=(r.data||[]) as Message[];
   setHasOlderChatMessages(rows.length===CHAT_HISTORY_PAGE_SIZE);
   if(!rows.length)return false;
   const last=rows[rows.length-1];
   oldestChatCursor.current={created_at:last.created_at,id:last.id};
   requestedHistoryCount.current+=rows.length;
   const cached=new Map(messageRowsRef.current.map(m=>[m.id,m]));
   const page=rows.map(m=>({...m,url:cached.get(m.id)?.url||null}));
   setMessages(previous=>mergeChatMessages(previous,page,chatWindowLimit()));
   // Don't delay text display for media URL signatures.
   const media=page.filter(m=>m.storage_path&&!m.url);
   if(media.length)void Promise.all(media.map(async m=>({
    id:m.id,path:m.storage_path,url:await signedAssetUrl('game-media',m.storage_path!)
   }))).then(links=>{
    if(!readActive(ticket)||channelRef.current!==cid||chatChannelVersion.current!==version)return;
    const byId=new Map(links.map(link=>[link.id,link]));
    setMessages(previous=>previous.map(m=>{
     const link=byId.get(m.id);
     return link&&link.path===m.storage_path?{...m,url:link.url||m.url||null}:m;
    }));
   }).catch(()=>{/* An older attachment can be refreshed on demand. */});
   return true;
  }catch(error){
   if(channelRef.current===cid)setError(userError(error));
   return false;
  }finally{if(channelRef.current===cid&&chatChannelVersion.current===version){loadingOlderChatRef.current=false;setOlderChatLoading(false)}}
 }
 async function loadRecentChatMessages(cid:string){
  if(recentChatRecoveryRunning.current||channelRef.current!==cid)return;
  // A recovery poll must not invalidate an in-flight initial history load.
  const ticket:ReadTicket={gameId,epoch:readEpoch.current,versions:{}};
  recentChatRecoveryRunning.current=true;
  try{
   const latest=messageRowsRef.current.filter(m=>m.channel_id===cid).at(-1)?.created_at;
   if(!latest)return; // The first fetch is strictly ten messages.
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
   if(readActive(ticket)&&channelRef.current===cid)setMessages(previous=>mergeChatMessages(previous,rows,chatWindowLimit()));
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
   // Channel RLS and message RLS both apply inside one SECURITY INVOKER call.
   const projection=await limitedCoreRead(supabase.rpc('get_chat_pins_projection',{p_channel_id:cid}));
   if(!readCurrent(ticket)||channelRef.current!==cid)return;
   let pins:ChatPin[];
   let messages:Message[];
   if(projection.error&&['PGRST202','42883'].includes(String(projection.error.code||''))){
    // Transitional schema fallback only. Never double-read on 402, 429 or 5xx.
    const r=await supabase.from('chat_pins').select('id,game_id,channel_id,message_id,pinned_by,pinned_at')
     .eq('channel_id',cid).order('pinned_at',{ascending:false}).limit(12);
    if(!readCurrent(ticket)||channelRef.current!==cid)return;
    requireSuccessful([r]);
    pins=(r.data||[]) as ChatPin[];
    const ids=pins.map(p=>p.message_id);
    if(!ids.length){setChatPins([]);setPinnedMessages([]);return}
    const linked=await supabase.from('chat_messages').select('*').in('id',ids).eq('channel_id',cid);
    if(!readCurrent(ticket)||channelRef.current!==cid)return;
    requireSuccessful([linked]);
    messages=(linked.data||[]) as Message[];
   }else{
    requireSuccessful([projection]);
    const snapshot=projection.data as {pins?:ChatPin[];messages?:Message[]}|null;
    if(!snapshot||!Array.isArray(snapshot.pins)||!Array.isArray(snapshot.messages)){
     setError('Не удалось загрузить закреплённые сообщения.');return;
    }
    pins=snapshot.pins;messages=snapshot.messages;
   }
   if(!pins.length){setChatPins([]);setPinnedMessages([]);return}
   const media=await Promise.all(messages.map(async m=>{
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
 async function refreshAffected(tables:readonly string[]){
  await loadRealtimeSections(new Set(tables));
  for(const table of tables)notifyGameDataRefresh(gameId,table);
 }
 async function refresh(){invalidatePartyRows();await loadAll(false);await Promise.all([hydrateActiveView(false,true),refreshBudgetPulse()]);notifyGameDataRefresh(gameId);if(channelRef.current)await loadMessages(channelRef.current)}
 async function refreshDocuments(id:string){await loadFormalRegistry([id]);notifyGameDataRefresh(gameId,'formal_documents')}
 async function refreshEventEffects(){await Promise.all([loadPoliticalWall(),refreshBudgetPulse()]);notifyGameDataRefresh(gameId,'event_decisions')}

 async function logActivity(eventType:string,label:string,viewKey?:string,payload:Record<string,unknown>={}){
  const uid=me?.user_id;if(!uid||authUser.current!==uid)return;
  await supabase.from('game_activity').insert({game_id:gameId,actor_id:uid,event_type:eventType,label,view_key:viewKey||null,payload});
 }
 async function touchPresence(viewKey:string,label?:string){
  if(typeof document!=='undefined'&&document.visibilityState==='hidden')return;
  const uid=me?.user_id;if(!uid||authUser.current!==uid)return;
  const scope=gameId+':'+uid,now=Date.now();
   // Realtime Presence reports connectivity promptly. Persist only the latest
   // navigated view during rapid transitions; keep SQL authority and activity.
   const previous=lastPresenceWrite.current;
   if(previous.scope===scope&&previous.view===viewKey&&now-previous.at<60000){
    pendingPresenceWrite.current=null;
    return;
   }
   if(presenceInFlight.current===scope||
      (previous.scope===scope&&now-previous.at<PRESENCE_MIN_WRITE_INTERVAL_MS)){
    pendingPresenceWrite.current={scope,view:viewKey,label};
    if(presenceFlushTimer.current===null){
     const delay=presenceInFlight.current===scope?1000:
      Math.max(1000,PRESENCE_MIN_WRITE_INTERVAL_MS-(now-previous.at));
     presenceFlushTimer.current=setTimeout(()=>{
      presenceFlushTimer.current=null;
      const pending=pendingPresenceWrite.current;pendingPresenceWrite.current=null;
      if(pending&&pending.scope===gameId+':'+authUser.current)
       void touchPresence(pending.view,pending.label);
     },delay);
    }
    return;
   }
   pendingPresenceWrite.current=null;
   presenceInFlight.current=scope;
   lastPresenceWrite.current={scope,view:viewKey,at:now};
   try{
   // A single SECURITY INVOKER RPC preserves presence and the navigation
   // journal under their original RLS checks and database triggers.
   const response=await supabase.rpc('record_my_game_presence',{
    p_game_id:gameId,p_view:viewKey,p_label:label||null
   });
   if(response.error?.code==='PGRST202'){
    // Rolling deployments: an older DB schema still accepts the existing
    // two-request path. Never retry a permission/timeout/unknown RPC error,
    // as its transaction may already have committed.
    const legacy=await supabase.from('game_presence').upsert({
     game_id:gameId,user_id:uid,current_view:viewKey,last_seen_at:new Date(now).toISOString()
    },{onConflict:'game_id,user_id'});
    if(!legacy.error&&label)await logActivity('navigation',label,viewKey);
   }
   }finally{
    if(presenceInFlight.current===scope)presenceInFlight.current='';
    if((pendingPresenceWrite.current as {scope:string;view:string;label?:string}|null)?.scope===scope&&presenceFlushTimer.current===null){
     presenceFlushTimer.current=setTimeout(()=>{
      presenceFlushTimer.current=null;
      const pending=pendingPresenceWrite.current;pendingPresenceWrite.current=null;
      if(pending&&pending.scope===gameId+':'+authUser.current)
       void touchPresence(pending.view,pending.label);
     },1000);
    }
   }
  }
 
  async function logout(){await supabase.auth.signOut();if(me?.user_id)void deleteLocalGameSnapshot(gameId,me.user_id);router.replace('/')}
 async function setTurn(open:boolean){const r=await supabase.from('games').update({turn_open:open,status:open?'running':'paused',turn_ends_at:open?new Date(Date.now()+12*60*1000).toISOString():null}).eq('id',gameId);if(r.error)setError(r.error.message);else await refreshAffected(['stage_game'])}
 async function setTurnMinutes(minutes:number){if(!game)return;const r=await supabase.from('games').update({turn_open:true,status:'running',turn_ends_at:new Date(Date.now()+minutes*60*1000).toISOString()}).eq('id',gameId);if(r.error)setError(r.error.message);else await refreshAffected(['stage_game'])}

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
 async function setStageDeadline(stageId:string,value:string){const r=await supabase.from('game_stages').update({deadline:value?new Date(value).toISOString():null}).eq('id',stageId);if(r.error)setError(r.error.message);else await refreshAffected(['game_stages'])}


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
  await Promise.all([loadPartyRepresentation(),loadPartyAssets()]);notifyGameDataRefresh(gameId,'party_chair_ballots');return true;
 }
 async function renameParty(id:string,newName:string):Promise<boolean>{
  const name=newName.trim().replace(/\s+/g,' ');
  if(name.length<3||name.length>100){setError('Название партии должно содержать от 3 до 100 символов');return false}
  const result=await supabase.rpc('rename_game_party',{p_party_id:id,p_new_name:name});
  if(result.error){setError(result.error.message);return false}
  invalidatePartyRows();
  await refresh();
  return true;
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
  if(!teacher){setError('Goust Voting доступен только преподавателю.');return false}
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
 // Parliamentary representation before a party allocation is entered is shared
 // equally across current students; after allocation all GV/penalty reductions
 // come from the verified party mandate records.
 function gdMandateCapacity(uid:string){
  const totalBase=partyMandates.reduce((n,a)=>n+Math.max(0,Number(a.base_mandates)||0),0);
  if(totalBase>0)return partyMandates.filter(a=>a.user_id===uid).reduce((n,a)=>n+Math.max(0,Number(a.effective_mandates)||0),0);
  const roster=members.filter(m=>m.kind==='student'&&!m.roster_archived_at)
   .sort((a,b)=>String(a.joined_at||'').localeCompare(String(b.joined_at||''))||a.user_id.localeCompare(b.user_id));
  const rank=roster.findIndex(m=>m.user_id===uid);
  return rank<0?0:Math.floor(450/roster.length)+(rank<450%roster.length?1:0);
 }
 function gdEffectivePresence(uid:string,declared:number|null|undefined){
  const capacity=gdMandateCapacity(uid);
  return Math.max(0,Math.min(capacity,declared==null?capacity:Number(declared)||0));
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
  if(v.electorate_snapshot?.weights){
   // PostgreSQL verifies current membership, meeting registration and office
   // authority. Do not reject a voter captured in the electorate snapshot
   // solely because the current role title has not been updated in the UI.
   return Number(v.electorate_snapshot.weights[me.user_id]||0)>0
    &&(v.institution_key!=='gd'||gdMandateCapacity(me.user_id)>0);
  }
  if(v.institution_key==='gd')return gdMandateCapacity(me.user_id)>0;
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
  return v.institution_key==='gd'?gdMandateCapacity(me.user_id):partyMandates.find(x=>x.user_id===me.user_id)?.effective_mandates||0;
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
 function quorum(v:Vote,registrations:{user_id:string;institution_key:string;stage_no:number;present_mandates?:number|null}[]=[]){
  const eligible=eligibleWeight(v),cast=ballots.filter(b=>b.vote_id===v.id).reduce((n,b)=>n+Number(b.weight),0);
  const attendance=v.electorate_snapshot?.attendance_required||v.procedure_key==='registered_session';
  const present=v.status==='closed'&&v.result_present!=null?Number(v.result_present):attendance?registrations.filter(r=>r.institution_key===v.institution_key&&r.stage_no===v.stage_no).reduce((n,r)=>n+(v.institution_key==='gd'?Math.min(gdEffectivePresence(r.user_id,r.present_mandates),v.electorate_snapshot?Number(v.electorate_snapshot.weights[r.user_id]||0):gdMandateCapacity(r.user_id)):v.electorate_snapshot?Number(v.electorate_snapshot.weights[r.user_id]||0):v.voting_mode==='mandate'?(partyMandates.find(a=>a.user_id===r.user_id)?.effective_mandates||0):memberMatchesInstitution(r.user_id,v.institution_key)?1:0),0):cast;
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
  if(r.error){setError(r.error.message);return false}
  let closed=false;
  await readSafely(['votes'],async ticket=>{
   const [vo,ba]=await Promise.all([
    limitedCoreRead(supabase.from('game_votes').select('*').eq('game_id',gameId).eq('id',v.id).maybeSingle()),
    limitedCoreRead(supabase.from('game_ballots').select(GAME_BALLOT_COLUMNS).eq('vote_id',v.id))
   ]);
   if(!readActive(ticket))return;
   closed=vo.data?.status==='closed';
   if(!readCurrent(ticket))return;
   requireSuccessful([vo,ba]);
   if(vo.data){const confirmed=vo.data as Vote;setVotes(previous=>[...previous.filter(row=>row.id!==v.id),confirmed].sort((a,b)=>b.opened_at.localeCompare(a.opened_at)))}
   setBallots(previous=>[...previous.filter(row=>row.vote_id!==v.id),...(ba.data||[]) as Ballot[]]);
  });
  // The last registered ballot may close a procedure and change offices or documents.
  if(closed)await refresh();else notifyGameDataRefresh(gameId,'game_votes');
  return true;
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
  await refreshAffected(['game_evaluations']);
 }

 // After a single-table write, refresh only the affected RLS-scoped feed.
 // Use the same read-ticket generation as the Realtime reconciliation path:
 // a delayed HTTP result must not repopulate a previous user/game.
 async function refreshChangedFeed(table:'game_events'|'game_documents'){
  if(table==='game_events'){
   await readSafely(['events'],async ticket=>{
    const result=await limitedCoreRead(supabase.from('game_events').select('*')
     .eq('game_id',gameId).order('published_at',{ascending:false}).limit(100));
    if(!readCurrent(ticket))return;
    requireSuccessful([result]);
    setEvents((result.data||[]) as EventItem[]);
   });
  }else{
   await readSafely(['documents'],async ticket=>{
    const result=await limitedCoreRead(supabase.from('game_documents').select('*')
     .eq('game_id',gameId).order('created_at',{ascending:false}));
    if(!readCurrent(ticket))return;
    requireSuccessful([result]);
    setDocuments((result.data||[]) as GameDocument[]);
   });
  }
  notifyGameDataRefresh(gameId,table);
 }

 async function publishEvent(title:string,body:string,severity='notice',category='Режиссёрская'){if(!me||!title.trim()||!body.trim())return false;const r=await supabase.from('game_events').insert({game_id:gameId,round_no:currentStage?.stage_no||1,category,severity,title:title.trim(),body:body.trim(),created_by:me.user_id});if(r.error){setError(r.error.message);return false}await refreshChangedFeed('game_events');return true}
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

 async function createDocument(data:{title:string;type:string;body:string}){if(!teacher||!me||!data.title.trim())return false;const r=await supabase.from('game_documents').insert({game_id:gameId,title:data.title.trim(),doc_type:data.type.trim()||'Документ',body:data.body.trim()||null,created_by:me.user_id});if(r.error){setError(r.error.message);return false}await refreshChangedFeed('game_documents');return true}


 async function saveProfile(bio:string,file?:File,gender?:'male'|'female'|'unspecified'){
  if(!me||me.kind==='observer')return false;
  const prior=profiles.find(p=>p.user_id===me.user_id);
  const oldPath=prior?.avatar_path||null;
  let avatarPath=oldPath;
  if(file){
    const path=(me.kind==='teacher'?'teacher-assets/'+me.user_id:gameId+'/profiles/'+me.user_id)+'/avatar-'+crypto.randomUUID()+'.webp';
    const location=resolveStoredAsset('game-assets',path);
    const up=await supabase.storage.from(location.bucket).upload(location.path,file,{upsert:false,contentType:file.type});
    if(up.error){setError(up.error.message);return false}
    avatarPath=path;
  }
  const changes={bio:bio.trim()||null,avatar_path:avatarPath,...(gender?{gender}:{}),updated_at:new Date().toISOString()};
  const r=prior?await supabase.from('game_profiles').update(changes).eq('game_id',gameId).eq('user_id',me.user_id).select('user_id,avatar_path').single():
   await supabase.from('game_profiles').insert({game_id:gameId,user_id:me.user_id,...changes}).select('user_id,avatar_path').single();
  if(r.error||!r.data){
   if(file&&avatarPath){const location=resolveStoredAsset('game-assets',avatarPath);await supabase.storage.from(location.bucket).remove([location.path]);}
   setError(r.error?.message||'Не удалось подтвердить сохранение профиля.');return false;
  }
  if(file&&oldPath&&oldPath!==avatarPath&&me.kind!=='teacher')await supabase.storage.from('game-assets').remove([oldPath]);
  await loadPartyAssets();return true;
 }

 async function saveSignature(file:File){
  if(!me||me.kind==='observer'){setError('Подпись может сохранить только участник, вошедший в собственную учётную запись.');return false}
  if(file.type!=='image/png'||file.size===0||file.size>2*1024*1024){setError('Загрузите PNG-подпись размером до 2 МБ.');return false}
  // Detect a stale teacher or other account session before attempting Storage
  // writes. The actual permission remains enforced on the server by RLS.
  const active=await supabase.auth.getSession();
  if(active.error||active.data.session?.user.id!==me.user_id){
   setError('Вы вошли под другой учётной записью. Откройте вход для участника и войдите под своим именем.');return false;
  }
  const path=(me.kind==='teacher'?'teacher-assets/'+me.user_id:gameId+'/profiles/'+me.user_id)+'/signature-'+crypto.randomUUID()+'.png';
  const location=resolveStoredAsset('game-assets',path);
  const up=await supabase.storage.from(location.bucket).upload(location.path,file,{contentType:'image/png',upsert:false});
  if(up.error){setError(up.error.message+' Проверьте, что вход выполнен под своей учётной записью участника.');return false}
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

 async function deletePartyDocument(id:string):Promise<{deleted:boolean;storageWarning?:string;historyRetained?:boolean}>{
  if(!teacher){setError('Удаление документов доступно только преподавателю.');return {deleted:false}}
  const r=await supabase.rpc('teacher_delete_party_document',{p_document_id:id});
  if(r.error){setError(r.error.message);return {deleted:false}}
  const result=r.data as {deleted?:boolean;storage_path?:string;historical_file_retained?:boolean}|null;
  if(!result?.deleted){setError('Документ уже удалён или недоступен.');await loadPartyDocuments();return {deleted:false}}
  setPartyDocuments(previous=>previous.filter(doc=>doc.id!==id));
  // DB record and its audit trail are committed before Storage cleanup.
  let storageWarning:string|undefined;
  if(result.storage_path){
   const removed=await supabase.storage.from('game-assets').remove([result.storage_path]);
   if(removed.error){storageWarning='Документ исключён из досье, но файл в хранилище не удалён. Требуется повторная очистка.';setError(storageWarning)}
  }
  await loadPartyDocuments();
  notifyGameDataRefresh(gameId);
  return {deleted:true,storageWarning,historyRetained:!!result.historical_file_retained};
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
  await loadFormalRegistry(typeof r.data==='string'?[r.data]:undefined);return r.data as string;
 }
 async function deleteFormalDocument(id:string){
  const r=await supabase.rpc('delete_formal_document',{p_document_id:id});
  if(r.error){setError(r.error.message);return false}
  await loadFormalRegistry([id]);return !!r.data?.deleted;
 }
 async function advanceFormalDocument(id:string,action:'advance'|'return'|'reject'='advance',note?:string){
  const r=await supabase.rpc('advance_formal_document',{p_document_id:id,p_action:action,p_note:note||null});
  if(r.error){setError(r.error.message);return false}
  await loadFormalRegistry();return true;
 }
 async function updateFormalDraft(id:string,title:string,bodyText:string,metadata?:Record<string,unknown>){
  const r=await supabase.rpc('update_formal_draft',{p_document_id:id,p_title:title,p_body_text:bodyText,p_metadata:metadata||null});
  if(r.error){setError(r.error.message);return false}
  await loadFormalRegistry([id]);return true;
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

 return {gdMandateCapacity,gdEffectivePresence,game:game?.id===gameId?game:null,me:visibleMe,metrics:sharedMetrics,budgetPulse,budgetPulseError,refreshBudgetPulse,activeView,setActiveView,events,members,officeAssignments,channels,channelId,setChannelId,messages,hasOlderChatMessages,olderChatLoading,loadOlderChatMessages,chatPins,pinnedMessages,chatOverview,chatUnreadCount:chatOverview.reduce((sum,row)=>sum+Number(row.unread_count||0),0),chatMentionCount:chatOverview.reduce((sum,row)=>sum+Number(row.mention_count||0),0),setChatChannelPinned,markChatRead,chatLoading,stages,parties,votes,ballots,evaluations,crises,documents,activities,presence,profiles,profilesLoaded:profileGameId===gameId,introAccountSeen,partyDocuments,partyInvitations,partyMandates,partyAgreements,politicalPosts,politicalPostTotal,politicalActorOptions,politicalHasOlder,politicalOlderLoading,politicalSearchLoading,loadOlderPoliticalPosts,setPoliticalWallFullSearch,politicalMedia,postFormalLinks,metricHistory:sharedMetricHistory,partySupportHistory,impactRules,impactLedger,formalDocuments,formalHistory,loading,error,setError,chatOpen,setChatOpen,recording,recordingPreview,recordingSaving,chatMediaError,chatMediaPhase,recordingStartedAt,recordingStream:recordingStream.current,realtimeState,teacher,names,currentStage,myEvaluations,averageVsn,
  refresh,refreshDocuments,refreshEventEffects,logout,touchPresence,logActivity,setTurn,setTurnMinutes,openStage,manageStage,nextStage,resetStageProgress,configureStageDeadline,setStageDeadline,availableActors,createPoliticalPost,updatePoliticalPost,addMediaToPoliticalPost,acceptPoliticalPost,rejectPoliticalPost,approvePostImpact,createVoteFromPost,updateImpactRule,revertImpactEntry,createParty,voteForPartyChair,updateParty,renameParty,setPartyLeader,setPartyMandates,updatePartyStatistics,inviteToParty,respondPartyInvitation,cancelPartyInvitation,removePartyMember,proposePartyAgreement,respondPartyAgreement,submitPartyRegistration,reviewPartyRegistration,applyPartyGhostLoss,drawGhostVoting,clearPartyGhostLoss,applyGhostVotingBatch,deleteParty,updateMember,createVote,canVote,ballotWeight,castVote,castVoteAllocation,setStudentMandates,closeVote,deleteVote,tally,quorum,setEvaluation,publishEvent,triggerCrisis,ghostVoting,createDocument,updateMetric,saveProfile,saveSignature,savePartyIdentity,uploadPartyDocument,reviewPartyDocument,deletePartyDocument,createFormalDocument,deleteFormalDocument,advanceFormalDocument,updateFormalDraft,vetoFormalDocument,resolveBudgetConciliation,startBudgetRejectionBranch,sendText,sendChatFile,setChatPin,refreshChatMediaUrl,toggleRecording,discardRecording,sendRecordingPreview};
}
