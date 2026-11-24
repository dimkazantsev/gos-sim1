'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import {GAME_DATA_REFRESH_EVENT} from './useGameTableSync';
import type {BudgetCalculation} from './federalBudgetMath';
import type {Metric,MetricHistory} from './types';

export type BudgetPulse={game_id:string;mode:'baseline'|'draft'|'document'|'published';plan_id:string|null;document_id:string|null;plan_revision:number|null;note:string;calculation:BudgetCalculation;as_of:string;history:MetricHistory[]};
export const budgetModeLabel=(mode:BudgetPulse['mode'])=>({baseline:'Прогноз на 2027 год',draft:'Общий сохраненный черновик',document:'Проект закона в реестре',published:'Опубликованный игровой бюджет'}[mode]);

/** One server calculation for all shared panels. Local unsaved work never enters it. */
export function useBudgetPulse(gameId:string,enabled:boolean){
 const [pulse,setPulse]=useState<BudgetPulse|null>(null),[error,setError]=useState('');
 const scope=useRef({gameId,enabled}),request=useRef(0),alive=useRef(false);
 // One calculation in flight per mounted game view. Concurrent invalidations
 // request at most one trailing reconciliation, rather than a new RPC each.
 const inFlight=useRef<{gameId:string;rerun:boolean;promise:Promise<void>}|null>(null);
 scope.current={gameId,enabled};
 const refresh=useCallback(async()=>{
  if(!enabled||!gameId||!alive.current)return;
  const running=inFlight.current;
  if(running?.gameId===gameId){
   running.rerun=true; // A save during a slow read must not be lost.
   return running.promise;
  }
  const state={gameId,rerun:false,promise:Promise.resolve()};
  const work=async()=>{
   do{
    state.rerun=false;
    const ticket=++request.current;
    try{
     const r=await supabase.rpc('get_budget_pulse',{p_game_id:gameId});
     if(!alive.current||ticket!==request.current||scope.current.gameId!==gameId||!scope.current.enabled)continue;
     if(r.error)throw r.error;
     if(r.data?.game_id!==gameId||!Number.isFinite(Number(r.data?.calculation?.revenue)))throw new Error('Не удалось получить общий расчет доходов бюджета.');
     setPulse(r.data as BudgetPulse);setError('');
    }catch(e){if(alive.current&&ticket===request.current&&scope.current.gameId===gameId)setError(userError(e));}
   }while(state.rerun&&alive.current&&scope.current.enabled&&scope.current.gameId===gameId);
  };
  state.promise=work();
  inFlight.current=state;
  try{await state.promise}finally{if(inFlight.current===state)inFlight.current=null}
 },[gameId,enabled]);
 useEffect(()=>{
  alive.current=true;setPulse(null);setError('');
  if(!enabled)return()=>{alive.current=false;request.current++;};
  // The game shell owns the sole socket. Keep budget authority behind its
  // existing RPC; never cache or calculate unpublished rights offscreen.
  const relevant=new Set(['formal_documents','state_metrics','game_fiscal_policy','game_fiscal_regions','game_fiscal_rates','budget_simulator_plans','budget_simulator_state','budget_transfer_requests','state_programs','state_program_budget_commitments']);
  let pending:ReturnType<typeof setTimeout>|undefined,lastAutomaticAt=Date.now();
  let dirtyWhileHidden=document.visibilityState!=='visible';
  // No periodic budget polling: the existing shared Realtime invalidation,
  // focus/visibility recovery and online event already cover refreshes.
  // Each idle visible client no longer calls get_budget_pulse every ~3 min.
  if(!dirtyWhileHidden)void refresh();
  function automatic(force=false){
   if(document.visibilityState!=='visible'){dirtyWhileHidden=true;return}
   if(!force&&Date.now()-lastAutomaticAt<8000)return;
   lastAutomaticAt=Date.now();dirtyWhileHidden=false;void refresh();
  }
  function changed(event:Event){
   const detail=(event as CustomEvent<{gameId?:string;table?:string}>).detail;
   if(detail?.gameId!==gameId||detail.table&&!relevant.has(detail.table))return;
   if(document.visibilityState!=='visible'){dirtyWhileHidden=true;return}
   if(pending!==undefined)return;
   pending=setTimeout(()=>{pending=undefined;automatic()},1200);
  }
  function cancelPending(){
   if(pending!==undefined){clearTimeout(pending);pending=undefined;dirtyWhileHidden=true}
  }
  const resume=()=>{
   if(document.visibilityState!=='visible'){cancelPending();return}
   // Do not refetch on a short tab switch without changes.
   if(dirtyWhileHidden||Date.now()-lastAutomaticAt>=180000)automatic(dirtyWhileHidden);
  };
  const online=()=>{dirtyWhileHidden=true;automatic(true)};
  document.addEventListener('visibilitychange',resume);
  window.addEventListener('focus',resume);
  window.addEventListener('online',online);
  window.addEventListener(GAME_DATA_REFRESH_EVENT,changed);
  return()=>{
   alive.current=false;request.current++;cancelPending();
   document.removeEventListener('visibilitychange',resume);
   window.removeEventListener('focus',resume);
   window.removeEventListener('online',online);
   window.removeEventListener(GAME_DATA_REFRESH_EVENT,changed);
  };
 },[gameId,enabled,refresh]);
 return {budgetPulse:enabled&&pulse?.game_id===gameId?pulse:null,budgetPulseError:enabled?error:'',refreshBudgetPulse:refresh};
}

export function withBudgetIncome(metrics:Metric[],pulse:BudgetPulse|null){
 if(!pulse)return metrics;
 const last=pulse.history.at(-1);
 return metrics.map(m=>m.metric_key==='budget'?{...m,label:'Доходы бюджета',value:Number(pulse.calculation.revenue),previous_value:Number(last?.previous_value??pulse.calculation.revenue),unit:'млн ₽',min_value:null,max_value:null,description:pulse.note+' До опубликования закона это прогноз, а не исполнение бюджета.'}:m);
}
