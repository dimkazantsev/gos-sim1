'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {View} from './types';
export function useSectionUpdates(gameId:string|undefined,userId:string|undefined,view:View,readOnly:boolean){
 const [counts,setCounts]=useState<Record<string,number>>({});
 useEffect(()=>{
  setCounts({});if(!gameId||!userId||readOnly)return;let live=true;
  async function load(){const r=await supabase.rpc('get_section_updates',{p_game_id:gameId});if(live&&!r.error&&r.data)setCounts(r.data as Record<string,number>);}
  void load();const id=setInterval(()=>void load(),20000);
  return()=>{live=false;clearInterval(id)};
 },[gameId,userId,readOnly,view]);
 useEffect(()=>{
  if(!gameId||!userId||readOnly||!['documents','votes','events'].includes(view))return;
  // The cutoff is captured on entry, so later arrivals remain unread.
  const enteredAt=new Date().toISOString();
  const id=setTimeout(()=>{void supabase.rpc('mark_section_read',{p_game_id:gameId,p_section:view,p_seen_at:enteredAt}).then(r=>{if(!r.error)setCounts(c=>({...c,[view]:0}));});},1500);
  return()=>clearTimeout(id);
 },[gameId,userId,view,readOnly]);
 return counts;
}