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
 'institution_session_registrations','bill_amendments','bill_amendment_packs'
]);
export const GAME_DATA_REFRESH_EVENT='gos-sims:refresh';
export const KSRF_PROPOSAL_REFRESH_EVENT='gos-sims:ksrf-proposals';
export const SECTION_UPDATES_REFRESH_EVENT='gos-sims:section-updates';
export function notifySectionUpdates(gameId:string){window.dispatchEvent(new CustomEvent(SECTION_UPDATES_REFRESH_EVENT,{detail:{gameId}}))}
export function notifyGameDataRefresh(gameId:string,table?:string){
 // KSRF proposals only invalidate their own small list. Broadcasting through
 // the generic event caused unrelated stage widgets to query on every proposal.
 const eventName=table==='parliamentary_election_rules'||table==='regional_election_rules'
  ?KSRF_PROPOSAL_REFRESH_EVENT:GAME_DATA_REFRESH_EVENT;
 window.dispatchEvent(new CustomEvent(eventName,{detail:{gameId,table}}));
}

// Stage workspaces do not open Postgres Changes subscriptions themselves.
// A classroom can have 30+ clients and several stage widgets per screen; a
// subscription per widget multiplies catalog work in Realtime. Keep these
// views eventually consistent through local invalidation, focus/online
// recovery and a low-frequency visible-tab poll.
export function useGameTableSync(gameId:string|undefined,_tables:readonly string[],load:()=>Promise<unknown>,scope='',onlyTable?:string,minRefreshMs=750,fallbackMs=60000){
 const latest=useRef(load);latest.current=load;
 const tableKey=_tables.join('|');
 useEffect(()=>{
  if(!gameId)return;
  let disposed=false,running=false,queued=false,timer:ReturnType<typeof setTimeout>|undefined;
  // Keep last fallback per mounted widget; direct mutations and Realtime
  // invalidation still refresh immediately through GAME_DATA_REFRESH_EVENT.
  let lastFallbackAt=Date.now(),lastStartedAt=0;
  const hasPushCoverage=_tables.length>0&&_tables.every(table=>GAME_PUSH_TABLES.has(table));
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
   if(disposed||timer!==undefined)return;
   if(document.visibilityState!=='visible'){queued=true;return}
   timer=setTimeout(()=>void flush(),Math.max(delay,minRefreshMs-(Date.now()-lastStartedAt)));
  }
  let lastVisibleRecoveryAt=0;
  function visible(){
   const now=Date.now();
   if(document.visibilityState==='visible'&&(queued||now-lastVisibleRecoveryAt>20000)){lastVisibleRecoveryAt=now;schedule()}
  }
  function local(event:Event){
   const detail=(event as CustomEvent<{gameId:string;table?:string}>).detail;
   if(detail?.gameId!==gameId)return;
   if(onlyTable&&detail.table!==onlyTable)return;
   if(!onlyTable&&detail.table&&_tables.length&&!_tables.includes(detail.table))return;
   schedule();
  }
  void flush();
  // Fall back without aligning all classroom tabs and stage widgets on the same tick.
  const poll=setInterval(()=>{
    if(document.visibilityState!=='visible')return;
    const now=Date.now();
    // A healthy shared Realtime connection makes 25–35s whole-widget polling
    // redundant. Retain 3-minute reconciliation for missed changes.
    if(hasPushCoverage&&gameRealtimeConnected(gameId)&&now-lastFallbackAt<180000)return;
    lastFallbackAt=now;
    schedule(0);
  },fallbackMs+Math.floor(Math.random()*Math.min(15000,fallbackMs/4)));
  window.addEventListener('focus',visible);window.addEventListener('online',visible);
  const eventName=onlyTable?KSRF_PROPOSAL_REFRESH_EVENT:GAME_DATA_REFRESH_EVENT;
  window.addEventListener(eventName,local);document.addEventListener('visibilitychange',visible);
  return()=>{disposed=true;clearTimeout(timer);clearInterval(poll);window.removeEventListener('focus',visible);window.removeEventListener('online',visible);window.removeEventListener(eventName,local);document.removeEventListener('visibilitychange',visible)};
 },[gameId,scope,onlyTable,tableKey,minRefreshMs,fallbackMs]);
}
