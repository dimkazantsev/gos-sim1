'use client';
import {useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {AlertTriangle,CheckCircle2,ChevronDown,ExternalLink,History,RefreshCw,ShieldCheck,XCircle} from 'lucide-react';
import type {ReturnTypeRepublic} from './viewTypes';
import {STAGE_SYSTEM} from './stageSystem';
import {STAGE_REALTIME_TABLES} from './stageRealtimeTables';
import {useGameTableSync} from './useGameTableSync';

export type StageReadiness={
 stage_no:number;
 ready:boolean;
 blockers:string[];
 warnings:string[];
 metrics:Record<string,unknown>;
 overridden?:boolean;
 override_reason?:string|null;
 override_at?:string|null;
 original_blockers?:string[];
};

export default function StageReadinessPanel({g,stageNo,compact=false,readOnly=false,rulesUrl,rulesLabel}:{g:ReturnTypeRepublic;stageNo:number;compact?:boolean;readOnly?:boolean;rulesUrl?:string;rulesLabel?:string}){
 const {game,setError}=g;
 const teacher=g.teacher&&!readOnly;
 const [state,setState]=useState<StageReadiness|null>(null);
 const [overrideReason,setOverrideReason]=useState('');
 const [loading,setLoading]=useState(false);
 const [loadError,setLoadError]=useState('');
 const request=useRef(0);

 async function load(){
  if(!game)return;const version=++request.current;setLoading(true);
  try{
   const r=await supabase.rpc('get_stage_readiness',{p_game_id:game.id,p_stage_no:stageNo});
   if(version!==request.current)return;
   if(r.error){setState(null);setLoadError(r.error.message)}else if(r.data){setState(r.data as StageReadiness);setLoadError('')}else{setState(null);setLoadError('Сервер не вернул результат проверки.')}
  }catch(error){if(version===request.current){setState(null);setLoadError(error instanceof Error?error.message:'Не удалось загрузить проверку.')}}
  finally{if(version===request.current)setLoading(false)}
 }
 useGameTableSync(game?.id,STAGE_REALTIME_TABLES,load,String(stageNo));

 async function setOverride(){
  if(!game||!teacher||overrideReason.trim().length<10)return;
  setLoading(true);
  const r=await supabase.rpc('set_stage_readiness_override',{p_game_id:game.id,p_stage_no:stageNo,p_reason:overrideReason.trim()});
  if(r.error)setError(r.error.message);else{setOverrideReason('');await load()}
  setLoading(false);
 }
 async function clearOverride(){
  if(!game||!teacher)return;setLoading(true);
  const r=await supabase.rpc('clear_stage_readiness_override',{p_game_id:game.id,p_stage_no:stageNo});
  if(r.error)setError(r.error.message);else await load();
  setLoading(false);
 }

 const status=loading?'loading':state?.ready?(state.warnings?.length?'warning':'ready'):'blocked';
 const title=loading?'Проверка…':loadError?'Проверка недоступна':state?.ready?(state.warnings?.length?'Основная процедура завершена':'Этап процедурно готов'):'Есть незавершённые процедуры';
 const card=STAGE_SYSTEM[stageNo];

 if(compact)return <div className={'stageReadinessCompact '+status}>
  <span>{status==='ready'?'✓':status==='warning'?'!':status==='loading'?'…':'×'}</span>
  <div><b>{title}</b><small>{state?.blockers?.[0]||state?.warnings?.[0]||card?.institution||'Проверка состояния этапа'}</small></div>
 </div>;

 const blockerCount=state?.blockers?.length||0;
 const warningCount=state?.warnings?.length||0;
 const StatusIcon=status==='ready'?CheckCircle2:status==='warning'?AlertTriangle:status==='loading'?RefreshCw:XCircle;
 return <section className={'stageReadinessPanel stageReadinessWorkspace '+status} aria-live="polite">
  <header className="stageReadinessHero">
   <div className="stageReadinessHeroIcon" aria-hidden="true"><StatusIcon size={22}/></div>
   <div className="stageReadinessHeroCopy">
    <small>ПРОЦЕДУРНАЯ ГОТОВНОСТЬ · ЭТАП {stageNo}</small>
    <h3>{title}</h3>
    <div className="stageReadinessMeta">
     <span className={blockerCount?'hasBlockers':''}><b>{blockerCount}</b> обязательных</span>
     <span className={warningCount?'hasWarnings':''}><b>{warningCount}</b> замечаний</span>
     <span>{card?.institution||'Игровой институт'}</span>
    </div>
   </div>
   <div className="stageReadinessHeroActions">
    {rulesUrl&&<a className="stageReadinessRules" href={rulesUrl} target="_blank" rel="noreferrer"><ExternalLink size={16}/><span>{rulesLabel||'Правила игры'}</span></a>}
    <button type="button" className="stageReadinessRefresh" onClick={()=>void load()} disabled={loading} title="Перепроверить готовность"><RefreshCw size={17} className={loading?'isSpinning':''}/><span>Перепроверить</span></button>
   </div>
  </header>

  {loadError&&<p className="stageOperationsNotice" role="alert">{loadError} Повторите проверку после восстановления связи.</p>}

  {(blockerCount>0||warningCount>0)&&<div className={'stageReadinessChecklist '+((blockerCount>0)!==(warningCount>0)?'single':'')}>
   {blockerCount>0&&<section className="stageReadinessGroup blockers">
    <header>
     <span className="stageReadinessGroupIcon" aria-hidden="true"><XCircle size={17}/></span>
     <div><b>Нужно завершить</b><small>{blockerCount===1?'Одно обязательное условие блокирует переход':blockerCount+' обязательных условий блокируют переход'}</small></div>
     <span className="stageReadinessGroupCount" aria-label={'Обязательных условий: '+blockerCount}>{blockerCount}</span>
    </header>
    <ol>{state!.blockers.map((x,i)=><li key={x}><span className="stageReadinessItemIndex" aria-hidden="true">{String(i+1).padStart(2,'0')}</span><p>{x}</p></li>)}</ol>
   </section>}
   {warningCount>0&&<section className="stageReadinessGroup warnings">
    <header>
     <span className="stageReadinessGroupIcon" aria-hidden="true"><AlertTriangle size={17}/></span>
     <div><b>Стоит проверить</b><small>{warningCount===1?'Одно замечание не блокирует переход':warningCount+' замечаний не блокируют переход'}</small></div>
     <span className="stageReadinessGroupCount" aria-label={'Замечаний: '+warningCount}>{warningCount}</span>
    </header>
    <ol>{state!.warnings.map((x,i)=><li key={x}><span className="stageReadinessItemIndex" aria-hidden="true">{String(i+1).padStart(2,'0')}</span><p>{x}</p></li>)}</ol>
   </section>}
  </div>}

  {state?.ready&&!warningCount&&<div className="stageReadinessOk"><CheckCircle2 size={19}/><div><b>Все обязательные процедуры зафиксированы</b><span>Этап может быть завершён или использован как основание для перехода к следующему.</span></div></div>}

  {state?.overridden&&<section className="stageReadinessOverrideNotice"><header><History size={18}/><div><b>Историческое прохождение подтверждено</b><small>Ручное подтверждение преподавателя</small></div></header><p>{state.override_reason}</p>{state.original_blockers&&state.original_blockers.length>0&&<details><summary>Какие структурированные записи отсутствуют <ChevronDown size={15}/></summary><ul>{state.original_blockers.map(x=><li key={x}>{x}</li>)}</ul></details>}{state.override_at&&<time>{new Date(state.override_at).toLocaleString('ru-RU')}</time>}{teacher&&<button type="button" className="stageReadinessClearOverride" disabled={loading} onClick={()=>void clearOverride()}>Отменить подтверждение</button>}</section>}

  {teacher&&!state?.overridden&&state&&!state.ready&&<details className="stageReadinessOverride">
   <summary><History size={18}/><span><b>Этап был пройден раньше?</b><small>Используйте только для результатов, которые были зафиксированы до появления структурированной механики</small></span><ChevronDown size={18}/></summary>
   <div className="stageReadinessOverrideForm">
    <label>Где и как был зафиксирован результат<textarea rows={4} value={overrideReason} onChange={e=>setOverrideReason(e.target.value)} placeholder="Например: протокол заседания, загруженный документ, запись преподавателя. Минимум 10 символов."/></label>
    <div className="stageReadinessOverrideActions"><span><ShieldCheck size={16}/> Подтверждение сохранится в истории этапа</span><button type="button" className="secondary" disabled={loading||overrideReason.trim().length<10} onClick={()=>void setOverride()}>Подтвердить историческое прохождение</button></div>
   </div>
  </details>}
 </section>;
}
