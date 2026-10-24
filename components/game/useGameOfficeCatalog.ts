'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {gameOfficeGroups,type GameGovernmentStructure,type GameUnit,type RoleGroup} from './gameOfficeCatalog';

type Snapshot={gameId:string;groups:RoleGroup[];ready:boolean;error:string};
const defaults=gameOfficeGroups();

// Only the editor of game offices needs these two bounded queries.
// No subscription, polling or full roster lookup is added.
export function useGameOfficeCatalog(gameId:string|undefined,enabled:boolean){
 const [snapshot,setSnapshot]=useState<Snapshot>({gameId:'',groups:defaults,ready:false,error:''});
 useEffect(()=>{
  if(!gameId||!enabled)return;
  let alive=true;
  void (async()=>{
   const [structure,units]=await Promise.all([
    supabase.from('government_structures')
     .select('social_title,economic_title,defence_title,foreign_title,internal_title,status')
     .eq('game_id',gameId).limit(1).maybeSingle(),
    supabase.from('institution_units')
     .select('unit_kind,unit_key,title').eq('game_id',gameId)
     .in('unit_kind',['committee','ministry']).limit(12)
   ]);
   if(!alive)return;
   if(structure.error||units.error){
    setSnapshot({gameId,groups:defaults,ready:false,error:'Не удалось загрузить утверждённые должности игры.'});
    return;
   }
   setSnapshot({gameId,groups:gameOfficeGroups(
    (structure.data||null) as GameGovernmentStructure|null,
    (units.data||[]) as GameUnit[]
   ),ready:true,error:''});
  })();
  return()=>{alive=false};
 },[gameId,enabled]);
 if(!gameId||!enabled)return {groups:defaults,ready:false,error:''};
 if(snapshot.gameId!==gameId)return {groups:defaults,ready:false,error:''};
 return snapshot;
}
