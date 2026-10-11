'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import {STAGE_SYSTEM} from './stageSystem';
import type {StageReadiness} from './StageReadinessPanel';

export default function GameReadinessMatrix({g}:{g:ReturnTypeRepublic}){
 const {game,stages}=g;
 const [result,setResult]=useState<{gameId:string;rows:StageReadiness[];checkedAt:number}|null>(null);
 const [failure,setFailure]=useState<{gameId:string;message:string}|null>(null);
 const [pendingGame,setPendingGame]=useState<string|null>(null);
 const request=useRef(0);
 const activeGame=useRef(game?.id);activeGame.current=game?.id;

 async function load(){
  if(!game)return;
  const gameId=game.id,version=++request.current;
  const current=()=>version===request.current&&activeGame.current===gameId;
  setPendingGame(gameId);
  try{
   const r=await supabase.rpc('get_game_readiness',{p_game_id:gameId});
   if(!current())return;
   if(r.error)throw new Error(r.error.message);
   const data=r.data;
   if(!Array.isArray(data)||data.length!==16||new Set(data.map(x=>x?.stage_no)).size!==16||data.some(x=>
    !x||!Number.isInteger(x.stage_no)||x.stage_no<1||x.stage_no>16||typeof x.ready!=='boolean'||
    !Array.isArray(x.blockers)||x.blockers.some((v:unknown)=>typeof v!=='string')||
    !Array.isArray(x.warnings)||x.warnings.some((v:unknown)=>typeof v!=='string')))
    throw new Error('Сервер не вернул полную проверку 16 этапов.');
   setResult({gameId,rows:data as StageReadiness[],checkedAt:Date.now()});setFailure(null);
  }catch(error){
   if(current()){setResult(null);setFailure({gameId,message:error instanceof Error?error.message:'Не удалось загрузить проверку.'});}
  }finally{if(current())setPendingGame(null);}
 }
 useEffect(()=>()=>{request.current++},[game?.id]);
 if(!game)return null;

 const rows=result?.gameId===game.id?result.rows:[];
 const loadError=failure?.gameId===game.id?failure.message:'';
 const loading=pendingGame===game.id;
 const checked=rows.length===16;
 const checkedAt=result?.gameId===game.id?result.checkedAt:null;
 const ready=rows.filter(x=>x.ready).length;
 const blocked=rows.filter(x=>!x.ready).length;
 const warning=rows.filter(x=>x.ready&&x.warnings.length>0).length;

 return <section className="gameReadinessMatrix">
  <header><div><small>СКВОЗНОЙ КОНТРОЛЬ</small><h3>Готовность 16 этапов</h3><p>Проверка всех этапов выполняется только по запросу преподавателя. Результат не обновляется автоматически.</p></div><div className="gameReadinessCounters"><span><b>{checked?ready:'—'}</b> готовы</span><span><b>{checked?warning:'—'}</b> с предупреждением</span><span><b>{checked?blocked:'—'}</b> не закрыты</span><button type="button" className="secondary" aria-label={checked?'Повторить проверку готовности':'Проверить готовность 16 этапов'} disabled={loading} onClick={()=>void load()}>{loading?'Проверяем…':checked?'↻ Обновить':'↻ Проверить'}</button></div></header>
  {loadError&&<p role="alert">Проверка недоступна: {loadError}</p>}
  {!loading&&!checked&&!loadError&&<p className="readinessManualNotice" role="status">Проверка ещё не запускалась. Нажмите «Проверить», чтобы получить актуальные результаты.</p>}
  {checkedAt&&<p className="readinessManualNotice">Данные на {new Date(checkedAt).toLocaleString('ru-RU')}. После действий участников запустите проверку повторно.</p>}
  <div className="gameReadinessGrid">{Array.from({length:16},(_,i)=>i+1).map(no=>{
   const r=rows.find(x=>x.stage_no===no);
   const stage=stages.find(x=>x.stage_no===no);
   const status=loading&&!r?'loading':!r?'unavailable':r.ready?(r.warnings.length?'warning':'ready'):'blocked';
   return <article className={status} key={no}><div className="gameReadinessNo">{String(no).padStart(2,'0')}</div><div><small>{STAGE_SYSTEM[no]?.institution||'Этап'}</small><b>{stage?.title||'Этап '+no}</b><p>{r?.blockers?.[0]||r?.warnings?.[0]||(r?.ready?'Ключевые процедуры зафиксированы':loadError?'Проверка недоступна':'Проверка не запускалась')}</p></div><span>{status==='ready'?'✓':status==='warning'?'!':status==='loading'?'…':status==='unavailable'?'—':'×'}</span></article>
  })}</div>
 </section>;
}
