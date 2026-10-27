'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {GAME_DATA_REFRESH_EVENT,SECTION_UPDATES_REFRESH_EVENT,gameRealtimeConnected,notifySectionUpdates} from './useGameTableSync';
import type {View} from './types';

const READABLE_SECTIONS=new Set<View>(['dashboard','stages','parties','votes','documents','actions','events','teacher']);
const UPDATE_TABLES=new Set(['formal_documents','game_votes','event_assignments','event_collaboration_invites','event_decisions','political_posts','game_parties','party_invitations','game_stages','party_documents','game_members']);
export function useSectionUpdates(gameId:string|undefined,userId:string|undefined,view:View,readOnly:boolean){
 const [counts,setCounts]=useState<Record<string,number>>({});
 // Ignore snapshots that started before a confirmed local read acknowledgement.
 const optimisticVersion=useRef(0);
 const lastRelevantMutationAt=useRef(0);
 useEffect(()=>{
  setCounts({});
  optimisticVersion.current+=1;
  lastRelevantMutationAt.current=0;
  if(!gameId||!userId||readOnly)return;
  let live=true,running=false,queued=false,blocked=false,initialPending=true;
  let lastFallbackAt=Date.now(),lastFocusAt=0,lastStartedAt=0,recoveryAfter=0;
  const userJitter=[...userId].reduce((n,c)=>(Math.imul(n,33)+c.charCodeAt(0))>>>0,0)%9000;
  let pending:ReturnType<typeof setTimeout>|undefined;
  async function load(){
   if(!live||blocked||document.visibilityState!=='visible'||Date.now()<recoveryAfter)return;
   if(running){queued=true;return}
   running=true;lastStartedAt=Date.now();
   const startedVersion=optimisticVersion.current;
   try{
    const r=await supabase.rpc('get_section_updates',{p_game_id:gameId});
    if(r.status===402)blocked=true;
    if(r.error&&['PGRST003','57014'].includes(r.error.code))recoveryAfter=Date.now()+120000;
    else if(r.status>=500)recoveryAfter=Date.now()+90000;
    if(live&&!r.error&&r.data&&startedVersion===optimisticVersion.current)setCounts(r.data as Record<string,number>);
   }catch{recoveryAfter=Date.now()+30000}
   finally{running=false;if(queued&&live){queued=false;schedule()}}
  }
  function schedule(){
   if(!live||blocked||initialPending||pending!==undefined||document.visibilityState!=='visible')return;
   // Cold invalidation: stagger simultaneous classroom broadcasts as well as
   // the initial bootstrap. Inside the 15-second window, retain the cap.
   pending=setTimeout(()=>{pending=undefined;void load()},Math.max(250+userJitter,15000-(Date.now()-lastStartedAt)));
  }
  const invalidated=(e:Event)=>{
   const detail=(e as CustomEvent<{gameId:string;table?:string}>).detail;
   if(detail?.gameId!==gameId||detail.table&&!UPDATE_TABLES.has(detail.table))return;
   if(e.type===GAME_DATA_REFRESH_EVENT)lastRelevantMutationAt.current=Date.now();
   // A local read already updates its own badge; no second unbounded RPC.
   schedule();
  };
  const focused=()=>{
   if(document.visibilityState!=='visible')return;
   const now=Date.now();if(now-lastFocusAt<60000)return;
   lastFocusAt=now;schedule();
  };
  // Spread initial counters across classroom clients.
  const initial=setTimeout(()=>{initialPending=false;void load()},600+userJitter);
  const poll=setInterval(()=>{
   if(document.visibilityState!=='visible')return;
   const now=Date.now();
   // The shared game WebSocket delivers invalidation events immediately.
   // Poll rarely while subscribed, but retain 30-40s recovery offline.
   if(gameRealtimeConnected(gameId)&&now-lastFallbackAt<300000)return;
   lastFallbackAt=now;schedule();
  },90000+userJitter);
  window.addEventListener(GAME_DATA_REFRESH_EVENT,invalidated);
  window.addEventListener(SECTION_UPDATES_REFRESH_EVENT,invalidated);
  window.addEventListener('focus',focused);
  document.addEventListener('visibilitychange',focused);
  return()=>{live=false;clearTimeout(initial);clearTimeout(pending);clearInterval(poll);window.removeEventListener(GAME_DATA_REFRESH_EVENT,invalidated);window.removeEventListener(SECTION_UPDATES_REFRESH_EVENT,invalidated);window.removeEventListener('focus',focused);document.removeEventListener('visibilitychange',focused)};
 },[gameId,userId,readOnly]);
 useEffect(()=>{
  if(!gameId||!userId||readOnly||!READABLE_SECTIONS.has(view))return;
  // New items arriving after entry remain unread.
  const enteredAtMs=Date.now();
  const enteredAt=new Date(enteredAtMs).toISOString();
  let active=true;
  const id=setTimeout(()=>{
   void supabase.rpc('mark_section_read',{p_game_id:gameId,p_section:view,p_seen_at:enteredAt})
    .then(r=>{
     if(!active||r.error)return;
     // The server marks only items that existed when the section was entered.
     // Never optimistically hide notifications arriving after that moment.
     if(lastRelevantMutationAt.current<=enteredAtMs){
      optimisticVersion.current+=1;
      setCounts(previous=>({...previous,[view]:0}));
     }
     notifySectionUpdates(gameId);
    });
  },1500);
  return()=>{active=false;clearTimeout(id)};
 },[gameId,userId,view,readOnly]);
 return counts;
}
