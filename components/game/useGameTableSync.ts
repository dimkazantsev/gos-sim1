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
export const GAME_DATA_REFRESH_EVENT='gos-sims:refresh';
export function notifyGameDataRefresh(gameId:string){window.dispatchEvent(new CustomEvent(GAME_DATA_REFRESH_EVENT,{detail:{gameId}}))}

// Stage workspaces do not open Postgres Changes subscriptions themselves.
// A classroom can have 30+ clients and several stage widgets per screen; a
// subscription per widget multiplies catalog work in Realtime. Keep these
// views eventually consistent through local invalidation, focus/online
// recovery and a low-frequency visible-tab poll.
export function useGameTableSync(gameId:string|undefined,_tables:readonly string[],load:()=>Promise<unknown>,scope=''){
 const latest=useRef(load);latest.current=load;
 useEffect(()=>{
  if(!gameId)return;
  let disposed=false,running=false,queued=false,timer:ReturnType<typeof setTimeout>|undefined;
  // Keep last fallback per mounted widget; direct mutations and Realtime
  // invalidation still refresh immediately through GAME_DATA_REFRESH_EVENT.
  let lastFallbackAt=Date.now();
  async function flush(){
   if(disposed)return;
   timer=undefined;
   if(running){queued=true;return}
   running=true;
   try{await latest.current()}catch(error){console.error('Stage refresh failed',error)}
   finally{running=false;if(queued&&!disposed){queued=false;schedule(250)}}
  }
  function schedule(delay=120){if(disposed||timer!==undefined)return;timer=setTimeout(()=>void flush(),delay)}
  function visible(){if(document.visibilityState==='visible')schedule()}
  function local(event:Event){if((event as CustomEvent<{gameId:string}>).detail?.gameId===gameId)schedule()}
  void flush();
  // Fall back without aligning all classroom tabs and stage widgets on the same tick.
  const poll=setInterval(()=>{
    if(document.visibilityState!=='visible')return;
    const now=Date.now();
    // A healthy shared Realtime connection makes 25–35s whole-widget polling
    // redundant. Retain 3-minute reconciliation for missed changes.
    if(gameRealtimeConnected(gameId)&&now-lastFallbackAt<180000)return;
    lastFallbackAt=now;
    schedule(0);
  },25000+Math.floor(Math.random()*10000));
  window.addEventListener('focus',visible);window.addEventListener('online',visible);
  window.addEventListener(GAME_DATA_REFRESH_EVENT,local);document.addEventListener('visibilitychange',visible);
  return()=>{disposed=true;clearTimeout(timer);clearInterval(poll);window.removeEventListener('focus',visible);window.removeEventListener('online',visible);window.removeEventListener(GAME_DATA_REFRESH_EVENT,local);document.removeEventListener('visibilitychange',visible)};
 },[gameId,scope]);
}
