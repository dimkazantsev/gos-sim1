'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import {STAGE_SYSTEM} from './stageSystem';
import type {StageReadiness} from './StageReadinessPanel';

export default function GameReadinessMatrix({g}:{g:ReturnTypeRepublic}){
 const {game,stages}=g;
 const [rows,setRows]=useState<StageReadiness[]>([]);
 const [loading,setLoading]=useState(false);

 async function load(){
  if(!game)return;setLoading(true);
  const r=await supabase.rpc('get_game_readiness',{p_game_id:game.id});
  if(!r.error&&Array.isArray(r.data))setRows(r.data as StageReadiness[]);
  setLoading(false);
 }
 useEffect(()=>{void load()},[game?.id]);
 if(!game)return null;

 const ready=rows.filter(x=>x.ready).length;
 const blocked=rows.filter(x=>!x.ready).length;
 const warning=rows.filter(x=>x.ready&&x.warnings.length>0).length;

 return <section className="gameReadinessMatrix">
  <header><div><small>СКВОЗНОЙ КОНТРОЛЬ</small><h3>Готовность 16 этапов</h3><p>Система проверяет фактические результаты процедур, а не статус карточки этапа. Переходы остаются ручными.</p></div><div className="gameReadinessCounters"><span><b>{ready}</b> готовы</span><span><b>{warning}</b> с предупреждением</span><span><b>{blocked}</b> не закрыты</span><button className="secondary" disabled={loading} onClick={()=>void load()}>↻</button></div></header>
  <div className="gameReadinessGrid">{Array.from({length:16},(_,i)=>i+1).map(no=>{
   const r=rows.find(x=>x.stage_no===no);
   const stage=stages.find(x=>x.stage_no===no);
   const status=loading&&!r?'loading':r?.ready?(r.warnings.length?'warning':'ready'):'blocked';
   return <article className={status} key={no}><div className="gameReadinessNo">{String(no).padStart(2,'0')}</div><div><small>{STAGE_SYSTEM[no]?.institution||'Этап'}</small><b>{stage?.title||'Этап '+no}</b><p>{r?.blockers?.[0]||r?.warnings?.[0]||(r?.ready?'Ключевые процедуры зафиксированы':'Проверка состояния…')}</p></div><span>{status==='ready'?'✓':status==='warning'?'!':status==='loading'?'…':'×'}</span></article>
  })}</div>
 </section>;
}
