'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {GAME_DATA_REFRESH_EVENT,SECTION_UPDATES_REFRESH_EVENT,gameRealtimeConnected} from './useGameTableSync';
import type {View} from './types';

const READABLE_SECTIONS=new Set<View>(['dashboard','stages','parties','votes','documents','actions','events','teacher']);
export function useSectionUpdates(gameId:string|undefined,userId:string|undefined,view:View,readOnly:boolean){
 const [counts,setCounts]=useState<Record<string,number>>({});
 useEffect(()=>{
  setCounts({});
  if(!gameId||!userId||readOnly)return;
  let live=true,running=false,queued=false;
  let lastFallbackAt=Date.now(),lastFocusAt=0;
  let pending:ReturnType<typeof setTimeout>|undefined;
  async function load(){
   if(running){queued=true;return}
   running=true;
   try{
    const r=await supabase.rpc('get_section_updates',{p_game_id:gameId});
    if(live&&!r.error&&r.data)setCounts(r.data as Record<string,number>);
   }finally{running=false;if(queued&&live){queued=false;void load()}}
  }
  const invalidated=(e:Event)=>{
   if((e as CustomEvent<{gameId:string}>).detail?.gameId!==gameId||pending!==undefined)return;
   pending=setTimeout(()=>{pending=undefined;if(live)void load()},250);
  };
  const focused=()=>{
   if(document.visibilityState!=='visible')return;
   const now=Date.now();if(now-lastFocusAt<1500)return;
   lastFocusAt=now;void load();
  };
  void load();
  const poll=setInterval(()=>{
   if(document.visibilityState!=='visible')return;
   const now=Date.now();
   // The shared game WebSocket delivers invalidation events immediately.
   // Poll rarely while subscribed, but retain 30-40s recovery offline.
   if(gameRealtimeConnected(gameId)&&now-lastFallbackAt<180000)return;
   lastFallbackAt=now;void load();
  },30000+Math.floor(Math.random()*10000));
  window.addEventListener(GAME_DATA_REFRESH_EVENT,invalidated);
  window.addEventListener(SECTION_UPDATES_REFRESH_EVENT,invalidated);
  window.addEventListener('focus',focused);
  return()=>{live=false;clearTimeout(pending);clearInterval(poll);window.removeEventListener(GAME_DATA_REFRESH_EVENT,invalidated);window.removeEventListener(SECTION_UPDATES_REFRESH_EVENT,invalidated);window.removeEventListener('focus',focused)};
 },[gameId,userId,readOnly]);
 useEffect(()=>{
  if(!gameId||!userId||readOnly||!READABLE_SECTIONS.has(view))return;
  // New items arriving after entry remain unread.
  const enteredAt=new Date().toISOString();
  const id=setTimeout(()=>{
   void supabase.rpc('mark_section_read',{p_game_id:gameId,p_section:view,p_seen_at:enteredAt})
    .then(r=>{if(!r.error)window.dispatchEvent(new CustomEvent(GAME_DATA_REFRESH_EVENT,{detail:{gameId}}))});
  },1500);
  return()=>clearTimeout(id);
 },[gameId,userId,view,readOnly]);
 return counts;
}
