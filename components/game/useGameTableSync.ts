'use client';
import {useEffect,useId,useRef} from 'react';
import {supabase} from '@/lib/supabase';

export const GAME_DATA_REFRESH_EVENT='gos-sims:refresh';
export function notifyGameDataRefresh(gameId:string){window.dispatchEvent(new CustomEvent(GAME_DATA_REFRESH_EVENT,{detail:{gameId}}))}

// Always use current selections/drafts in subscription callbacks. Coalesce
// bursts into one read and recover state when a mobile tab becomes visible.
export function useGameTableSync(gameId:string|undefined,tables:readonly string[],load:()=>Promise<unknown>,scope=''){
 const latest=useRef(load);latest.current=load;
 const instance=useId();
 const tableKey=tables.join('|');
 useEffect(()=>{
  if(!gameId)return;
  let disposed=false,running=false,queued=false,timer:ReturnType<typeof setTimeout>|undefined;
  async function flush(){
   if(disposed)return;
   if(running){queued=true;return}
   running=true;
   try{await latest.current()}catch(error){console.error('Stage refresh failed',error)}finally{running=false;if(queued&&!disposed){queued=false;schedule()}}
  }
  function schedule(){if(disposed)return;clearTimeout(timer);timer=setTimeout(()=>void flush(),160)}
  function visible(){if(document.visibilityState==='visible')schedule()}
  function local(event:Event){if((event as CustomEvent<{gameId:string}>).detail?.gameId===gameId)schedule()}
  const channel=supabase.channel('stage-sync:'+gameId+':'+instance+':'+scope);
  for(const table of tableKey.split('|').filter(Boolean)){
   // Ballots inherit their game through vote_id; DELETE events have no
   // reliable game filter. RLS checks delivery, and every load is game-scoped.
   channel.on('postgres_changes',{event:'*',schema:'public',table},payload=>{
    const row=payload.new as {game_id?:string};
    if(payload.eventType==='DELETE'||!row.game_id||row.game_id===gameId)schedule();
   });
  }
  channel.subscribe(status=>{if(status==='SUBSCRIBED')schedule()});
  void flush();
  window.addEventListener('focus',schedule);window.addEventListener('online',schedule);
  window.addEventListener(GAME_DATA_REFRESH_EVENT,local);document.addEventListener('visibilitychange',visible);
  return()=>{disposed=true;clearTimeout(timer);window.removeEventListener('focus',schedule);window.removeEventListener('online',schedule);window.removeEventListener(GAME_DATA_REFRESH_EVENT,local);document.removeEventListener('visibilitychange',visible);void supabase.removeChannel(channel)};
 },[gameId,tableKey,instance,scope]);
}
