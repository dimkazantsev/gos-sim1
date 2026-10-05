'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {AlertTriangle,CheckCircle2,ChevronDown,ExternalLink,History,RefreshCw,ShieldCheck,XCircle} from 'lucide-react';
import type {ReturnTypeRepublic} from './viewTypes';
import {STAGE_SYSTEM} from './stageSystem';

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

export default function StageReadinessPanel({g,stageNo,compact=false,rulesUrl,rulesLabel}:{g:ReturnTypeRepublic;stageNo:number;compact?:boolean;rulesUrl?:string;rulesLabel?:string}){
 const {game,teacher,setError}=g;
 const [state,setState]=useState<StageReadiness|null>(null);
 const [overrideReason,setOverrideReason]=useState('');
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
  const tables=['stage_readiness_overrides','game_parties','game_votes','office_elections','presidential_candidates','presidential_election_settings','presidential_system_proposals','presidential_candidate_program_points','presidential_candidate_documents','presidential_support_group','presidential_signature_batches','government_nominations','government_structures','institution_units','institution_assignments','state_programs','state_program_budget_years','government_sessions','duma_sessions','formal_documents','budget_scenarios','municipal_mayor_elections','municipal_districts','municipal_district_members','municipal_projects','municipal_project_evidence','game_crises','game_reflections'];
  const ch=supabase.channel('stage-readiness:'+game.id+':'+stageNo);
  for(const table of tables)ch.on('postgres_changes',{event:'*',schema:'public',table,filter:'game_id=eq.'+game.id},()=>void load());
  ch.subscribe();
  return()=>{void supabase.removeChannel(ch)}
 },[game?.id,stageNo]);

 async function setOverride(){
  if(!game||overrideReason.trim().length<10)return;
  setLoading(true);
  const r=await supabase.rpc('set_stage_readiness_override',{p_game_id:game.id,p_stage_no:stageNo,p_reason:overrideReason.trim()});
  if(r.error)setError(r.error.message);else{setOverrideReason('');await load()}
  setLoading(false);
 }
 async function clearOverride(){
  if(!game)return;setLoading(true);
  const r=await supabase.rpc('clear_stage_readiness_override',{p_game_id:game.id,p_stage_no:stageNo});
  if(r.error)setError(r.error.message);else await load();
  setLoading(false);
 }

 const status=loading?'loading':state?.ready?(state.warnings?.length?'warning':'ready'):'blocked';
 const title=loading?'Проверка…':state?.ready?(state.warnings?.length?'Основная процедура завершена':'Этап процедурно готов'):'Есть незавершённые процедуры';
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
    <p>{card?.institution||'Игровой институт'}</p>
   </div>
   <div className="stageReadinessHeroActions">
    {rulesUrl&&<a className="stageReadinessRules" href={rulesUrl} target="_blank" rel="noreferrer"><ExternalLink size={16}/><span>{rulesLabel||'Правила игры'}</span></a>}
    <button type="button" className="stageReadinessRefresh" onClick={()=>void load()} disabled={loading} title="Перепроверить готовность"><RefreshCw size={17} className={loading?'isSpinning':''}/><span>Перепроверить</span></button>
   </div>
  </header>

  <div className="stageReadinessStats" aria-label="Сводка процедурной готовности">
   <div><small>Обязательных блокеров</small><b>{blockerCount}</b><span>{blockerCount?'Нужно завершить':'Нет препятствий'}</span></div>
   <div><small>Предупреждений</small><b>{warningCount}</b><span>{warningCount?'Нужно проверить':'Замечаний нет'}</span></div>
   <div><small>Статус</small><b className="stageReadinessStateText">{status==='ready'?'Готов':status==='warning'?'С оговорками':status==='loading'?'Проверка':'Не готов'}</b><span>Системная проверка</span></div>
  </div>

  {(blockerCount>0||warningCount>0)&&<div className="stageReadinessChecklist">
   {blockerCount>0&&<section className="stageReadinessGroup blockers"><header><XCircle size={17}/><div><b>Обязательно завершить</b><small>Без этого этап процедурно не закрыт</small></div></header><ul>{state!.blockers.map(x=><li key={x}><span aria-hidden="true">•</span><p>{x}</p></li>)}</ul></section>}
   {warningCount>0&&<section className="stageReadinessGroup warnings"><header><AlertTriangle size={17}/><div><b>Проверьте перед переходом</b><small>Не блокирует этап, но требует внимания</small></div></header><ul>{state!.warnings.map(x=><li key={x}><span aria-hidden="true">•</span><p>{x}</p></li>)}</ul></section>}
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
