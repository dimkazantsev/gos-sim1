'use client';
import {useEffect,useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import {STAGE_SYSTEM} from './stageSystem';

export type StageReadiness={
 stage_no:number;
 ready:boolean;
 blockers:string[];
 warnings:string[];
 metrics:Record<string,unknown>;
};

export default function StageReadinessPanel({g,stageNo,compact=false}:{g:ReturnTypeRepublic;stageNo:number;compact?:boolean}){
 const {game}=g;
 const [state,setState]=useState<StageReadiness|null>(null);
 const [loading,setLoading]=useState(false);

 async function load(){
  if(!game)return;setLoading(true);
  const r=await supabase.rpc('get_stage_readiness',{p_game_id:game.id,p_stage_no:stageNo});
  if(!r.error&&r.data)setState(r.data as StageReadiness);
  setLoading(false);
 }
 useEffect(()=>{void load()},[game?.id,stageNo]);
 useEffect(()=>{
  if(!game)return;
  const tables=['game_parties','game_votes','office_elections','presidential_candidates','presidential_election_settings','government_nominations','institution_units','institution_assignments','state_programs','government_sessions','duma_sessions','formal_documents','budget_scenarios','municipal_projects','game_crises','game_reflections'];
  const ch=supabase.channel('stage-readiness:'+game.id+':'+stageNo);
  for(const table of tables)ch.on('postgres_changes',{event:'*',schema:'public',table,filter:'game_id=eq.'+game.id},()=>void load());
  ch.subscribe();
  return()=>{void supabase.removeChannel(ch)}
 },[game?.id,stageNo]);

 const status=loading?'loading':state?.ready?(state.warnings?.length?'warning':'ready'):'blocked';
 const title=loading?'Проверка…':state?.ready?(state.warnings?.length?'Основная процедура завершена':'Этап процедурно готов'):'Есть незавершённые процедуры';
 const card=STAGE_SYSTEM[stageNo];

 if(compact)return <div className={'stageReadinessCompact '+status}>
  <span>{status==='ready'?'✓':status==='warning'?'!':status==='loading'?'…':'×'}</span>
  <div><b>{title}</b><small>{state?.blockers?.[0]||state?.warnings?.[0]||card?.institution||'Проверка состояния этапа'}</small></div>
 </div>;

 return <section className={'stageReadinessPanel '+status}>
  <header><div><small>ПРОЦЕДУРНАЯ ГОТОВНОСТЬ</small><h3>{title}</h3><p>{card?.institution||'Игровой институт'} · этап {stageNo}</p></div><strong>{status==='ready'?'✓':status==='warning'?'!':status==='loading'?'…':'×'}</strong></header>
  {state?.blockers?.length>0&&<div className="stageReadinessGroup blockers"><b>Обязательно завершить</b><ul>{state.blockers.map(x=><li key={x}>{x}</li>)}</ul></div>}
  {state?.warnings?.length>0&&<div className="stageReadinessGroup warnings"><b>Проверьте перед переходом</b><ul>{state.warnings.map(x=><li key={x}>{x}</li>)}</ul></div>}
  {state?.ready&&!state.warnings?.length&&<div className="stageReadinessOk">Ключевые процедуры этого этапа зафиксированы в системе.</div>}
  <button className="secondary stageReadinessRefresh" onClick={()=>void load()} disabled={loading}>↻ Перепроверить</button>
 </section>;
}
