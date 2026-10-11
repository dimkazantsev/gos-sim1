'use client';
import {useEffect,useRef} from 'react';

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
  let lastRun=0;
  async function flush(){
   if(disposed)return;
   if(running){queued=true;return}
   running=true;lastRun=Date.now();
   try{await latest.current()}catch(error){console.error('Stage refresh failed',error)}
   finally{running=false;if(queued&&!disposed){queued=false;schedule(250)}}
  }
  function schedule(delay=120){if(disposed)return;clearTimeout(timer);timer=setTimeout(()=>void flush(),delay)}
  function visible(){if(document.visibilityState==='visible'&&Date.now()-lastRun>90000)schedule()}
  function local(event:Event){if((event as CustomEvent<{gameId:string}>).detail?.gameId===gameId)schedule()}
  void flush();
  // Only active screens poll, and idle views fetch at most once per five minutes.
  // Voting-related widgets can refresh more often; local writes remain immediate.
  const pollMs=/vote|voting|ballot/i.test(scope)?90000:300000;
  const poll=setInterval(()=>{if(document.visibilityState==='visible')schedule(0)},pollMs);
  window.addEventListener('focus',visible);window.addEventListener('online',visible);
  window.addEventListener(GAME_DATA_REFRESH_EVENT,local);document.addEventListener('visibilitychange',visible);
  return()=>{disposed=true;clearTimeout(timer);clearInterval(poll);window.removeEventListener('focus',visible);window.removeEventListener('online',visible);window.removeEventListener(GAME_DATA_REFRESH_EVENT,local);document.removeEventListener('visibilitychange',visible)};
 },[gameId,scope]);
}
