'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
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
  const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},20000);
  const resume=()=>{if(document.visibilityState==='visible')void refresh();};
  document.addEventListener('visibilitychange',resume);
  let pending:ReturnType<typeof setTimeout>|undefined;
  const changed=()=>{clearTimeout(pending);pending=setTimeout(()=>void refresh(),250);};
  let channel=supabase.channel('budget-pulse:'+gameId);
  for(const table of ['budget_simulator_plans','budget_simulator_state','budget_transfer_requests','game_fiscal_policy','game_fiscal_regions','game_fiscal_rates','formal_documents','event_case_outcomes','state_metrics'])
   channel=channel.on('postgres_changes',{event:'*',schema:'public',table,filter:'game_id=eq.'+gameId},changed);
  channel.subscribe();
  return()=>{alive.current=false;request.current++;clearInterval(timer);clearTimeout(pending);document.removeEventListener('visibilitychange',resume);void supabase.removeChannel(channel);};
 },[gameId,enabled,refresh]);
 return {budgetPulse:enabled&&pulse?.game_id===gameId?pulse:null,budgetPulseError:enabled?error:'',refreshBudgetPulse:refresh};
}

export function withBudgetIncome(metrics:Metric[],pulse:BudgetPulse|null){
 if(!pulse)return metrics;
 const last=pulse.history.at(-1);
 return metrics.map(m=>m.metric_key==='budget'?{...m,label:'Доходы бюджета',value:Number(pulse.calculation.revenue),previous_value:Number(last?.previous_value??pulse.calculation.revenue),unit:'млн ₽',min_value:null,max_value:null,description:pulse.note+' До опубликования закона это прогноз, а не исполнение бюджета.'}:m);
}
