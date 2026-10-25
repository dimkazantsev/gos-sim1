'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import {GAME_DATA_REFRESH_EVENT} from './useGameTableSync';
import type {BudgetCalculation} from './federalBudgetMath';
import type {Metric,MetricHistory} from './types';

export type BudgetPulse={game_id:string;mode:'baseline'|'draft'|'document'|'published';plan_id:string|null;document_id:string|null;plan_revision:number|null;note:string;calculation:BudgetCalculation;as_of:string;history:MetricHistory[]};
export const budgetModeLabel=(mode:BudgetPulse['mode'])=>({baseline:'Исходный прогноз 2026 года',draft:'Общий сохраненный черновик',document:'Проект закона в реестре',published:'Опубликованный игровой бюджет'}[mode]);

/** One server calculation for all shared panels. Local unsaved work never enters it. */
export function useBudgetPulse(gameId:string,enabled:boolean){
 const [pulse,setPulse]=useState<BudgetPulse|null>(null),[error,setError]=useState('');
 const scope=useRef({gameId,enabled}),request=useRef(0),alive=useRef(false);
 scope.current={gameId,enabled};
 const refresh=useCallback(async()=>{
  if(!enabled||!gameId||!alive.current)return;
  const ticket=++request.current;
  try{
   const r=await supabase.rpc('get_budget_pulse',{p_game_id:gameId});
   if(!alive.current||ticket!==request.current||scope.current.gameId!==gameId||!scope.current.enabled)return;
   if(r.error)throw r.error;
   if(r.data?.game_id!==gameId||!Number.isFinite(Number(r.data?.calculation?.revenue)))throw new Error('Не удалось получить общий расчет доходов бюджета.');
   setPulse(r.data as BudgetPulse);setError('');
  }catch(e){if(alive.current&&ticket===request.current&&scope.current.gameId===gameId)setError(userError(e));}
 },[gameId,enabled]);
 useEffect(()=>{
  alive.current=true;setPulse(null);setError('');
  if(!enabled)return()=>{alive.current=false;request.current++;};
  void refresh();
  // The game shell already owns the WebSocket: never create a second channel.
  // Explicit saves call refreshBudgetPulse directly; other clients reconcile
  // without racing to re-run this expensive budget calculation.
  const relevant=new Set(['formal_documents','state_metrics','game_fiscal_policy','game_fiscal_regions','game_fiscal_rates','budget_simulator_plans','budget_simulator_state','budget_transfer_requests']);
  let pending:ReturnType<typeof setTimeout>|undefined,lastAutomaticAt=Date.now();
  function automatic(){
   if(document.visibilityState!=='visible'||Date.now()-lastAutomaticAt<8000)return;
   lastAutomaticAt=Date.now();void refresh();
  }
  function changed(event:Event){
   const detail=(event as CustomEvent<{gameId?:string;table?:string}>).detail;
   if(detail?.gameId!==gameId||detail.table&&!relevant.has(detail.table))return;
   if(pending!==undefined)return;
   pending=setTimeout(()=>{pending=undefined;automatic()},1200);
  }
  const timer=setInterval(automatic,60000+Math.floor(Math.random()*15000));
  const resume=()=>{if(document.visibilityState==='visible')automatic()};
  document.addEventListener('visibilitychange',resume);
  window.addEventListener(GAME_DATA_REFRESH_EVENT,changed);
  return()=>{alive.current=false;request.current++;clearInterval(timer);clearTimeout(pending);document.removeEventListener('visibilitychange',resume);window.removeEventListener(GAME_DATA_REFRESH_EVENT,changed)};
 },[gameId,enabled,refresh]);
 return {budgetPulse:enabled&&pulse?.game_id===gameId?pulse:null,budgetPulseError:enabled?error:'',refreshBudgetPulse:refresh};
}

export function withBudgetIncome(metrics:Metric[],pulse:BudgetPulse|null){
 if(!pulse)return metrics;
 const last=pulse.history.at(-1);
 return metrics.map(m=>m.metric_key==='budget'?{...m,label:'Доходы бюджета',value:Number(pulse.calculation.revenue),previous_value:Number(last?.previous_value??pulse.calculation.revenue),unit:'млн ₽',min_value:null,max_value:null,description:pulse.note+' До опубликования закона это прогноз, а не исполнение бюджета.'}:m);
}
