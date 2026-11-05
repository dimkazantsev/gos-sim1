'use client';
import {useEffect,useRef} from 'react';

// One WebSocket belongs to the game shell. Stage widgets share its health
// signal instead of opening N subscriptions per visible panel.
const connectedGames=new Set<string>();
export function setGameRealtimeConnection(gameId:string,connected:boolean){
 if(!gameId)return;
 if(connected)connectedGames.add(gameId);
 else connectedGames.delete(gameId);
}
export function gameRealtimeConnected(gameId:string){return connectedGames.has(gameId)}
// These tables have both a shared handler and server Realtime publication.
// Other tables retain their fallback until equivalent push delivery exists.
export const GAME_PUSH_TABLES:ReadonlySet<string>=new Set([
 'game_stages','game_parties','party_invitations','party_chair_ballots',
 'formal_documents','political_posts','game_votes','blitz_assignments',
 'stage_deadline_rules','parliamentary_election_rules','regional_election_rules',
 'state_metrics','party_documents',
 'duma_sessions','duma_agenda_items',
 'institution_session_registrations','bill_amendments','bill_amendment_packs',
 // Private metadata-only Broadcast is emitted by one statement-level trigger.
 'event_cases','event_assignments','event_collaboration_invites',
 'event_decisions','event_case_outcomes','event_authority_evidence',
 'event_case_routing','event_discussion_messages'
]);
export const GAME_DATA_REFRESH_EVENT='gos-sims:refresh';
export const KSRF_PROPOSAL_REFRESH_EVENT='gos-sims:ksrf-proposals';
export const SECTION_UPDATES_REFRESH_EVENT='gos-sims:section-updates';
export const EVENT_PENDING_COUNT_EVENT='gos-sims:event-pending-count';
export function notifyEventPendingCount(gameId:string,userId:string,count:number){
 window.dispatchEvent(new CustomEvent(EVENT_PENDING_COUNT_EVENT,{detail:{gameId,userId,count}}));
}
export function notifySectionUpdates(gameId:string){window.dispatchEvent(new CustomEvent(SECTION_UPDATES_REFRESH_EVENT,{detail:{gameId}}))}
export function notifyGameDataRefresh(gameId:string,table?:string,caseId?:string){
 // KSRF proposals only invalidate their own small list. Broadcasting through
 // the generic event caused unrelated stage widgets to query on every proposal.
 const eventName=table==='parliamentary_election_rules'||table==='regional_election_rules'
  ?KSRF_PROPOSAL_REFRESH_EVENT:GAME_DATA_REFRESH_EVENT;
 window.dispatchEvent(new CustomEvent(eventName,{detail:{gameId,table,caseId}}));
}

// Stage workspaces do not open Postgres Changes subscriptions themselves.
// A classroom can have 30+ clients and several stage widgets per screen; a
// subscription per widget multiplies catalog work in Realtime. Keep these
// views eventually consistent through local invalidation, focus/online
// recovery and a low-frequency visible-tab poll.
export function useGameTableSync(gameId:string|undefined,_tables:readonly string[],load:()=>Promise<unknown>,scope='',onlyTable?:string,minRefreshMs=750,fallbackMs=60000,initialDelayMs=0,onlyCaseId?:string,connectedFallbackMs?:number){
 const latest=useRef(load);latest.current=load;
 const tableKey=_tables.join('|');
 useEffect(()=>{
  if(!gameId)return;
  let disposed=false,running=false,queued=false,timer:ReturnType<typeof setTimeout>|undefined;
  let hiddenAt=document.visibilityState==='hidden'?Date.now():0;
  // Keep last fallback per mounted widget; direct mutations and Realtime
  // invalidation still refresh immediately through GAME_DATA_REFRESH_EVENT.
  let lastFallbackAt=Date.now(),lastStartedAt=0,initialPending=false;
  const hasPushCoverage=_tables.length>0&&_tables.every(table=>GAME_PUSH_TABLES.has(table));
  // Event widgets keep just one rare safety reconciliation while subscribed.
  const eventOnly=_tables.length>0&&_tables.every(table=>table.startsWith('event_'));
  const connectedReconcileMs=connectedFallbackMs??(eventOnly?900000:180000);
  async function flush(){
   timer=undefined;
   if(disposed)return;
   if(document.visibilityState!=='visible'){queued=true;return}
   if(running){queued=true;return}
   queued=false;running=true;lastStartedAt=Date.now();
   try{await latest.current()}catch(error){console.error('Stage refresh failed',error)}
   finally{running=false;if(queued&&!disposed){queued=false;schedule(250)}}
  }
  function schedule(delay=120){
   if(disposed)return;
   // A real update or focus must supersede a delayed initial badge read.
   if(initialPending){initialPending=false;clearTimeout(timer);timer=undefined}
   if(timer!==undefined)return;
   if(document.visibilityState!=='visible'){queued=true;return}
   timer=setTimeout(()=>void flush(),Math.max(delay,minRefreshMs-(Date.now()-lastStartedAt)));
  }
  let lastVisibleRecoveryAt=0,skipFocusUntil=0;
  function visible(){
   if(document.visibilityState!=='visible'){
    if(!hiddenAt)hiddenAt=Date.now();
    pausePolling();
    // Preserve the unfinished read; never execute it offscreen.
    if(timer!==undefined){clearTimeout(timer);timer=undefined;initialPending=false;queued=true}
    return;
   }
   startPolling();
   const now=Date.now(),hiddenFor=hiddenAt?now-hiddenAt:0;
   hiddenAt=0;
   // A short tab switch without changes must not cause a second read from
   // the follow-up focus event fired by browsers after visibilitychange.
   if(hiddenFor>0&&hiddenFor<30000)skipFocusUntil=now+1000;
   // A deferred FIRST snapshot must run as soon as it becomes visible,
   // including a manual Realtime subscription during the hidden interval.
   if(queued&&lastStartedAt===0){
    lastVisibleRecoveryAt=now;lastFallbackAt=now;
    void flush();return;
   }
   // A normal focused tab still recovers a stale readiness panel (>20s).
   // Focus, online and visibility share this one in-flight widget scheduler.
   if(queued||(now-lastVisibleRecoveryAt>20000&&
       (hiddenFor>=30000||(hiddenFor===0&&now>=skipFocusUntil)))){
    lastVisibleRecoveryAt=now;lastFallbackAt=now;schedule();
   }
  }
  // Restored connectivity must retry failed reads even after a recent focus event.
  const online=()=>{queued=true;visible()};
  function local(event:Event){
   const detail=(event as CustomEvent<{gameId:string;table?:string;caseId?:string}>).detail;
   if(detail?.gameId!==gameId)return;
   if(onlyTable&&detail.table!==onlyTable)return;
   if(onlyCaseId&&detail.caseId&&detail.caseId!==onlyCaseId)return;
   if(!onlyTable&&detail.table&&_tables.length&&!_tables.includes(detail.table))return;
   schedule();
  }
  // Only explicitly opted-in nonessential counters wait during mass login.
  // Direct mutations and Realtime invalidations still schedule an immediate read.
  if(initialDelayMs>0){
   if(document.visibilityState==='visible'){
    initialPending=true;
    timer=setTimeout(()=>{initialPending=false;void flush()},initialDelayMs);
   }else queued=true;
  }else void flush();
  // Fall back without aligning all classroom tabs and stage widgets on the same tick.
  const pollDelay=fallbackMs+Math.floor(Math.random()*Math.min(15000,fallbackMs/4));
  let poll:ReturnType<typeof setInterval>|null=null;
  function pausePolling(){if(poll!==null){clearInterval(poll);poll=null}}
  function startPolling(){
   if(disposed||poll!==null||document.visibilityState!=='visible')return;
   poll=setInterval(()=>{
    if(document.visibilityState!=='visible'||typeof navigator!=='undefined'&&!navigator.onLine)return;
    const now=Date.now();
    // A healthy shared Realtime connection makes frequent whole-widget
    // polling redundant. Keep only its existing bounded safety fallback.
    if(hasPushCoverage&&gameRealtimeConnected(gameId!)&&now-lastFallbackAt<connectedReconcileMs)return;
    lastFallbackAt=now;
    schedule(0);
   },pollDelay);
  }
  startPolling();
  window.addEventListener('focus',visible);window.addEventListener('online',online);
  const eventName=onlyTable?KSRF_PROPOSAL_REFRESH_EVENT:GAME_DATA_REFRESH_EVENT;
  window.addEventListener(eventName,local);document.addEventListener('visibilitychange',visible);
  return()=>{disposed=true;clearTimeout(timer);pausePolling();window.removeEventListener('focus',visible);window.removeEventListener('online',online);window.removeEventListener(eventName,local);document.removeEventListener('visibilitychange',visible)};
 },[gameId,scope,onlyTable,onlyCaseId,tableKey,minRefreshMs,fallbackMs,initialDelayMs,connectedFallbackMs]);
}
