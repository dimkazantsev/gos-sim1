'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {GAME_DATA_REFRESH_EVENT} from './useGameTableSync';
import type {View} from './types';

const READABLE_SECTIONS=new Set<View>(['dashboard','stages','parties','votes','documents','actions','events','teacher']);
export function useSectionUpdates(gameId:string|undefined,userId:string|undefined,view:View,readOnly:boolean){
 const [counts,setCounts]=useState<Record<string,number>>({});
 useEffect(()=>{
  setCounts({});
  if(!gameId||!userId||readOnly)return;
  let live=true,running=false,queued=false;
  async function load(){
   if(running){queued=true;return}
   running=true;
   try{
    const r=await supabase.rpc('get_section_updates',{p_game_id:gameId});
    if(live&&!r.error&&r.data)setCounts(r.data as Record<string,number>);
   }finally{running=false;if(queued&&live){queued=false;void load()}}
  }
  const invalidated=(e:Event)=>{
   if((e as CustomEvent<{gameId:string}>).detail?.gameId===gameId)void load();
  };
  const focused=()=>{if(document.visibilityState==='visible')void load()};
  void load();
  const poll=setInterval(focused,30000);
  window.addEventListener(GAME_DATA_REFRESH_EVENT,invalidated);
  window.addEventListener('focus',focused);
  return()=>{live=false;clearInterval(poll);window.removeEventListener(GAME_DATA_REFRESH_EVENT,invalidated);window.removeEventListener('focus',focused)};
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
