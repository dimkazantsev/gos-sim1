'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {StageReadiness} from './StageReadinessPanel';
import {CheckCircle2,ChevronRight,CircleDot,LockKeyhole,RefreshCw,RotateCcw,Search,ShieldAlert,X} from 'lucide-react';
import {useDialog} from '../ui/useDialog';
import type {ReturnTypeRepublic} from './viewTypes';
import StagePolicyEditor from './StagePolicyEditor';
import DeadlineControl from './DeadlineControl';
import StyledSelect from '../ui/StyledSelect';

type StageFilter='all'|'open'|'completed'|'locked';
type ResetTarget=number|'all'|null;

const FILTERS:{value:StageFilter;label:string}[]=[
 {value:'all',label:'Все'},
 {value:'open',label:'Текущие'},
 {value:'completed',label:'Завершённые'},
 {value:'locked',label:'Закрытые'}
];

export default function TeacherStageManager({g,onOpenStage}:{
 g:ReturnTypeRepublic;onOpenStage:(stageNo:number)=>void
}){
 const {stages,teacher,resetStageProgress,game}=g;
 const [readiness,setReadiness]=useState<StageReadiness[]>([]);
 const [readinessLoading,setReadinessLoading]=useState(false);
 const [expanded,setExpanded]=useState<number|null>(null);
 const [stageSort,setStageSort]=useState<'number'|'reverse'|'status'>('number');
 const [filter,setFilter]=useState<StageFilter>('all');
 const [search,setSearch]=useState('');
 const [resetTarget,setResetTarget]=useState<ResetTarget>(null);
 const [confirmation,setConfirmation]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 async function refreshReadiness(){
  if(!game)return;
  setReadinessLoading(true);
  const r=await supabase.rpc('get_game_readiness',{p_game_id:game.id});
  if(!r.error&&Array.isArray(r.data))setReadiness(r.data as StageReadiness[]);
  setReadinessLoading(false);
 }
 useEffect(()=>{void refreshReadiness()},[game?.id]);
 useEffect(()=>{
  if(!game)return;
  const c=supabase.channel('teacher-stage-readiness:'+game.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'stage_readiness_overrides',filter:'game_id=eq.'+game.id},()=>void refreshReadiness())
   .subscribe();
  return()=>{void supabase.removeChannel(c)};
 },[game?.id]);
 const closeDialog=()=>{if(busy)return;setResetTarget(null);setConfirmation('');setError('')};
 const dialogRef=useDialog(resetTarget!==null,closeDialog);
 const completed=stages.filter(s=>s.status==='completed').length;
 const active=stages.filter(s=>s.status==='open').length;
 const searchTerm=search.trim().toLocaleLowerCase('ru-RU');
 const shown=stages.filter(s=>(filter==='all'||s.status===filter)&&(
  !searchTerm||[String(s.stage_no),String(s.stage_no).padStart(2,'0'),s.title].some(t=>t.toLocaleLowerCase('ru-RU').includes(searchTerm))
 )).sort((a,b)=>stageSort==='reverse'?b.stage_no-a.stage_no:stageSort==='status'?(a.status==='open'?-1:a.status==='locked'?1:0)-(b.status==='open'?-1:b.status==='locked'?1:0)||a.stage_no-b.stage_no:a.stage_no-b.stage_no);
 const selectedStage=stages.find(x=>x.stage_no===(expanded??currentStageNumber()));
 function currentStageNumber(){return stages.find(x=>x.status==='open')?.stage_no||game?.current_round||1}
 const selectedReady=readiness.find(x=>x.stage_no===selectedStage?.stage_no);
 const targetStage=typeof resetTarget==='number'?stages.find(s=>s.stage_no===resetTarget):null;
 const all=resetTarget==='all';
 const canReset=resetTarget!==null&&!busy&&(!all||confirmation.trim()==='СБРОСИТЬ');
 function askReset(target:ResetTarget){
  if(!teacher||target===null)return;
  setNotice('');setError('');setConfirmation('');setResetTarget(target);
 }
 async function confirmReset(){
  if(!canReset||!teacher)return;
  setBusy(true);setError('');
  try{
   const ok=await resetStageProgress(all?null:resetTarget as number);
   if(!ok){setError('Не удалось сбросить этапы. Проверьте сообщение об ошибке в верхней части приложения.');return}
   setNotice(all?'Все этапы сброшены. Ход остановлен.':'Этап '+resetTarget+' сброшен.');
   if(all){setFilter('all');setSearch('')}
   void refreshReadiness();
   setResetTarget(null);setConfirmation('');
  }catch(err){
   setError(err instanceof Error?err.message:'Не удалось сбросить этапы.');
  }finally{setBusy(false)}
 }
 if(!teacher)return null;

 return <section className="teacherStageManager" aria-labelledby="teacher-stage-manager-title">
  <header className="teacherStageManagerHead">
   <div className="teacherStageManagerHeading">
    <span className="teacherEyebrow">РЕЖИССЁР ИГРЫ</span>
    <h2 id="teacher-stage-manager-title">Управление этапами</h2>
    <p>Статус прохождения и фактическая процедурная готовность каждого этапа отображаются вместе.</p>
   </div>
   <div className="teacherStageManagerTools">
    <div className="teacherStageManagerTotals" aria-label="Прогресс этапов">
     <span><strong>{completed}</strong> / {stages.length} завершено</span>
     <span><CircleDot size={14} aria-hidden="true"/>{active} текущих</span>
    </div>
    <button type="button" className="teacherReadinessRefresh" onClick={()=>void refreshReadiness()} disabled={readinessLoading} aria-label="Перепроверить готовность всех этапов"><RefreshCw size={16} aria-hidden="true"/> {readinessLoading?'Проверка…':'Проверить готовность'}</button>
    <button type="button" className="teacherResetAll" onClick={()=>askReset('all')} disabled={busy}>
     <RotateCcw size={16} strokeWidth={2} aria-hidden="true"/> Сбросить все этапы
    </button>
   </div>
  </header>

  <div className="teacherStageManagerToolbar">
   <div className="teacherStageFilter" role="group" aria-label="Отбор этапов">
    {FILTERS.map(item=><button type="button" key={item.value} className={filter===item.value?'isActive':''} aria-pressed={filter===item.value}
     onClick={()=>setFilter(item.value)}>{item.label}<span>{item.value==='all'?stages.length:stages.filter(s=>s.status===item.value).length}</span></button>)}
   </div>
   <label className="teacherStageSearch"><Search size={16} aria-hidden="true"/><input type="search" placeholder="Найти этап" aria-label="Найти этап" value={search} onChange={e=>setSearch(e.target.value)}/></label>
   <StyledSelect label="Порядок этапов" value={stageSort} onChange={x=>setStageSort(x as typeof stageSort)}
    options={[{value:'number',label:'По номеру ↑'},{value:'reverse',label:'По номеру ↓'},{value:'status',label:'Текущие сначала'}]}/>
   <button type="button" className="teacherStageCurrentShortcut" onClick={()=>{setExpanded(currentStageNumber());setFilter('all');setSearch('')}}>Текущий этап</button>
  </div>
  {notice&&<div className="teacherStageNotice" role="status"><CheckCircle2 size={16} aria-hidden="true"/>{notice}
   <button type="button" aria-label="Скрыть уведомление" onClick={()=>setNotice('')}><X size={15}/></button></div>}
  <div className="teacherStageSplit">
   <nav className="teacherStageList" aria-label="Выбор этапа">
    {shown.length===0?<div className="teacherStageEmpty">Этапов по фильтру нет.</div>:shown.map(stage=>{
     const ready=readiness.find(r=>r.stage_no===stage.stage_no);
     const StatusIcon=stage.status==='completed'?CheckCircle2:stage.status==='open'?CircleDot:LockKeyhole;
     return <button type="button" key={stage.id} className={'teacherStageListItem '+(selectedStage?.stage_no===stage.stage_no?'selected ':'')+'is-'+stage.status}
       aria-current={selectedStage?.stage_no===stage.stage_no?'step':undefined}
       onClick={()=>setExpanded(stage.stage_no)}>
       <span className="teacherStageNumber">{String(stage.stage_no).padStart(2,'0')}</span>
       <span className="teacherStageListCopy"><strong>{stage.title}</strong><small><StatusIcon size={13}/>{stage.status==='open'?'Текущий':stage.status==='completed'?'Завершён':'Закрыт'}{ready?.ready?' · Готов':ready?' · Есть препятствия':''}</small></span>
       <ChevronRight size={17} aria-hidden="true"/>
     </button>;
    })}
   </nav>
   <div className="teacherStageInspector">
    {selectedStage?<><header className="teacherStageInspectorHead"><div className="teacherStageInspectorIdentity">
      <span className="teacherStageNumber">{String(selectedStage.stage_no).padStart(2,'0')}</span>
      <div><small>ЭТАП · {selectedStage.status==='open'?'ТЕКУЩИЙ':selectedStage.status==='completed'?'ЗАВЕРШЁН':'ЗАКРЫТ'}</small><h3>{selectedStage.title}</h3></div>
     </div>
     <button type="button" className="teacherStageInspectorReset" onClick={()=>askReset(selectedStage.stage_no)} title="Сбросить этот этап" aria-label={'Сбросить этап '+selectedStage.stage_no} disabled={busy}><RotateCcw size={17}/></button></header>
     {selectedStage.summary&&<p className="teacherStageInspectorSummary">{selectedStage.summary}</p>}
     <section className="teacherStageInspectorSection"><h4>Процедурная готовность</h4>
      {selectedReady?<><p>{selectedReady.ready?'Основные требования выполнены.':'Необходимо выполнить процедуры.'}</p>
       {selectedReady.blockers.map((v,i)=><p className="blocked" key={'b'+i}>{v}</p>)}
       {selectedReady.warnings.map((v,i)=><p className="warning" key={'w'+i}>{v}</p>)}
      </>:<p>Идёт проверка готовности.</p>}
     </section>
     <StagePolicyEditor key={selectedStage.id} g={g} stageNo={selectedStage.stage_no}/>
     <DeadlineControl g={g} stageNo={selectedStage.stage_no}/>
     <div className="teacherStageInspectorActions">
      {selectedStage.status!=='open'&&<button type="button" onClick={()=>{if(window.confirm('Сделать этап '+selectedStage.stage_no+' текущим?'))void g.openStage(selectedStage.stage_no)}}>Сделать текущим</button>}
      <button type="button" className="primary" onClick={()=>onOpenStage(selectedStage.stage_no)}>Открыть процедуры этапа <ChevronRight size={16}/></button>
     </div>
    </>:<p>Выберите этап из списка.</p>}
   </div>
  </div>
  {resetTarget!==null&&<div className="teacherResetBackdrop" onMouseDown={event=>{if(event.target===event.currentTarget)closeDialog()}}>
   <section className="teacherResetDialog" ref={dialogRef} role="alertdialog" tabIndex={-1} aria-modal="true"
    aria-labelledby="teacher-reset-title" aria-describedby="teacher-reset-description">
    <div className="teacherResetDialogTop">
     <span className="teacherResetWarningIcon"><ShieldAlert size={23} aria-hidden="true"/></span>
     <button type="button" className="teacherResetClose" onClick={closeDialog} disabled={busy} aria-label="Закрыть предупреждение">
      <X size={18} aria-hidden="true"/>
     </button>
    </div>
    <h2 id="teacher-reset-title">{all?'Сбросить все 16 этапов?':'Сбросить этап '+resetTarget+'?'}</h2>
    <p id="teacher-reset-description">{all
     ?'Все этапы снова станут закрытыми, их сроки будут очищены. Игровой ход остановится, а следующий запуск начнётся с первого этапа.'
     :'Статус, дедлайн и даты прохождения этапа «'+(targetStage?.title||'')+'» будут очищены. Если этап текущий, игровой ход остановится.'}</p>
    <div className="teacherResetPreserve"><CheckCircle2 size={17} aria-hidden="true"/>
     <span>Документы, голосования, действия и оценки студентов сохранятся. Остальные этапы при одиночном сбросе не изменяются.</span>
    </div>
    {all&&<label className="teacherResetWord">Для подтверждения введите <strong>СБРОСИТЬ</strong>
     <input type="text" value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder="СБРОСИТЬ"
      autoComplete="off" spellCheck={false} disabled={busy}/>
    </label>}
    {error&&<p className="teacherResetError" role="alert">{error}</p>}
    <div className="teacherResetDialogActions">
     <button type="button" className="teacherResetCancel" onClick={closeDialog} disabled={busy}>Отмена</button>
     <button type="button" className="teacherResetConfirm" onClick={()=>void confirmReset()} disabled={!canReset}>
      <RotateCcw size={16} aria-hidden="true"/>{busy?'Выполняется…':all?'Сбросить все':'Сбросить этап'}
     </button>
    </div>
   </section>
  </div>}
 </section>;
}
