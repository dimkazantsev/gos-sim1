'use client';
import {userError} from '@/lib/userError';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import StageReadinessPanel,{type StageReadiness} from './StageReadinessPanel';
import {CheckCircle2,ChevronRight,CircleDot,LockKeyhole,RefreshCw,RotateCcw,Search,ShieldAlert,X} from 'lucide-react';
import dynamic from 'next/dynamic';
import {useDialog} from '../ui/useDialog';
import type {ReturnTypeRepublic} from './viewTypes';
const StagePolicyEditor=dynamic(()=>import('./StagePolicyEditor'),{loading:()=>null});
const DeadlineControl=dynamic(()=>import('./DeadlineControl'),{loading:()=>null});
import StyledSelect from '../ui/StyledSelect';
import {GAME_DATA_REFRESH_EVENT} from './useGameTableSync';

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
 const [readinessSnapshot,setReadinessSnapshot]=useState<{scope:string;rows:StageReadiness[]}|null>(null);
 const [readinessFailure,setReadinessFailure]=useState<{scope:string;message:string}|null>(null);
 const [readinessLoading,setReadinessLoading]=useState(false);
 const [stageReadinessSnapshot,setStageReadinessSnapshot]=useState<{scope:string;stageNo:number;row:StageReadiness}|null>(null);
 const [stageReadinessError,setStageReadinessError]=useState<{scope:string;stageNo:number;message:string}|null>(null);
 const [stageReadinessLoading,setStageReadinessLoading]=useState<{scope:string;stageNo:number}|null>(null);
 const stageReadinessPending=useRef(new Set<string>());
 const selectedControllers=useRef(new Map<string,AbortController>());
 const scope=JSON.stringify([game?.id,g.me?.user_id,g.me?.kind,teacher]);
 const activeScope=useRef(scope),alive=useRef(true);activeScope.current=scope;
 const reads=useRef({scope,promise:null as Promise<void>|null,queued:false,explicit:false,controller:null as AbortController|null});
 if(reads.current.scope!==scope)reads.current={scope,promise:null,queued:false,explicit:false,controller:null};
 const readState=reads.current;
 const scopeCurrent=()=>alive.current&&activeScope.current===scope;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 useEffect(()=>{setReadinessLoading(false);return()=>{readState.controller?.abort()}},[scope]);
 const [expanded,setExpanded]=useState<number|null>(null);
 const [detailsStage,setDetailsStage]=useState<number|null>(null);
 const [stageSort,setStageSort]=useState<'number'|'reverse'|'status'>('number');
 const [filter,setFilter]=useState<StageFilter>('all');
 const [search,setSearch]=useState('');
 const [resetTarget,setResetTarget]=useState<ResetTarget>(null);
 const [confirmation,setConfirmation]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [stageActionBusy,setStageActionBusy]=useState(false);
 const [extensionMinutes,setExtensionMinutes]=useState(30);
 async function changeStage(stageNo:number,action:'open'|'close'|'extend'){
  if(stageActionBusy)return;
  if(action==='open'&&!window.confirm('Открыть этап '+stageNo+' независимо от остальных открытых этапов?'))return;
  setStageActionBusy(true);setError('');setNotice('');
  try{
   const ok=await g.manageStage(stageNo,action,action==='extend'?extensionMinutes:30);
   if(ok){setNotice(action==='open'?'Этап '+stageNo+' открыт.':action==='close'?'Этап '+stageNo+' завершён.':'Срок этапа '+stageNo+' продлён на '+extensionMinutes+' минут. Продление не открывает завершённые голосования и не снимает задолженности по итоговым документам. Проверяйте личные ограничения в кабинете участника.');setReadinessSnapshot(null);setStageReadinessSnapshot(null);}
   else setError('Не удалось изменить статус этапа. Проверьте сообщение системы.');
  }finally{setStageActionBusy(false)}
 }
 async function refreshReadiness(background=false){
  if(!game||!teacher||!scopeCurrent()||background&&document.visibilityState!=='visible')return;
  const state=reads.current;state.explicit=state.explicit||!background;
  if(state.promise){state.queued=true;return state.promise}
  state.promise=(async()=>{
   do{
    state.queued=false;const passive=!state.explicit;state.explicit=false;
    const controller=new AbortController();state.controller=controller;
    const current=()=>scopeCurrent()&&!controller.signal.aborted&&(!passive||document.visibilityState==='visible');
    let timeout:ReturnType<typeof setTimeout>|undefined;
    setReadinessLoading(true);setReadinessFailure(null);
    try{
     const r=await Promise.race([
      supabase.rpc('get_game_readiness',{p_game_id:game.id}).abortSignal(controller.signal),
      new Promise<never>((_,reject)=>{controller.signal.addEventListener('abort',()=>{clearTimeout(timeout);reject(new Error('Сервер не ответил на проверку готовности вовремя.'))},{once:true});timeout=setTimeout(()=>controller.abort(),12000)})
     ]);
     if(!current())continue;
     if(r.error)throw r.error;
     if(!Array.isArray(r.data))throw new Error('Сервер не вернул результаты проверки этапов.');
     setReadinessSnapshot({scope,rows:r.data as StageReadiness[]});
    }catch(err){
     if(scopeCurrent()&&(!passive||document.visibilityState==='visible')){
      setReadinessSnapshot(null);setReadinessFailure({scope,message:(userError(err)||'Не удалось проверить готовность этапов.')});
     }
    }finally{clearTimeout(timeout);if(state.controller===controller)state.controller=null;if(scopeCurrent())setReadinessLoading(false)}
   }while(state.queued&&scopeCurrent());
  })().finally(()=>{state.promise=null});
  return state.promise;
 }
 // No bulk readiness query on mount, focus, or the periodic recovery interval.
 useEffect(()=>{
  const invalidate=(event:Event)=>{
   const d=(event as CustomEvent<{gameId?:string;table?:string}>).detail;
   if(d?.gameId===game?.id&&(!d.table||['stage_readiness_overrides','formal_documents','game_stages','game_votes'].includes(d.table))){setReadinessSnapshot(null);setStageReadinessSnapshot(null)}
  };
  window.addEventListener(GAME_DATA_REFRESH_EVENT,invalidate);
  return()=>window.removeEventListener(GAME_DATA_REFRESH_EVENT,invalidate);
 },[game?.id]);
 useEffect(()=>{
  setReadinessSnapshot(null);setStageReadinessSnapshot(null);setStageReadinessError(null);setStageReadinessLoading(null);
  return()=>{for(const controller of selectedControllers.current.values())controller.abort();selectedControllers.current.clear();stageReadinessPending.current.clear()};
 },[scope]);
 async function checkSelectedStage(stageNo:number){
  const key=scope+':'+stageNo;
  if(!game||!teacher||!scopeCurrent()||stageReadinessPending.current.has(key))return;
  stageReadinessPending.current.add(key);
  const controller=new AbortController();
  selectedControllers.current.set(key,controller);
  let timeout:ReturnType<typeof setTimeout>|undefined;
  setStageReadinessLoading({scope,stageNo});setStageReadinessError(null);
  try{
   // One stage readiness calculation, bounded to 12 seconds.
   const r=await Promise.race([
    supabase.rpc('get_stage_readiness',{p_game_id:game.id,p_stage_no:stageNo}).abortSignal(controller.signal),
    new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new Error('Сервер не ответил на проверку этапа вовремя.'))},12000)})
   ]);
   if(!scopeCurrent())return;
   if(r.error)throw r.error;
   const row=r.data as StageReadiness|null;
   if(!row||row.stage_no!==stageNo||typeof row.ready!=='boolean')throw new Error('Сервер не вернул проверку этапа.');
   setStageReadinessSnapshot({scope,stageNo,row});
  }catch(error){
   if(scopeCurrent()){setStageReadinessSnapshot(null);setStageReadinessError({scope,stageNo,message:userError(error)})}
  }finally{
   clearTimeout(timeout);
   stageReadinessPending.current.delete(key);
   if(selectedControllers.current.get(key)===controller)selectedControllers.current.delete(key);
   if(scopeCurrent())setStageReadinessLoading(null);
  }
 }
 const closeDialog=()=>{if(busy)return;setResetTarget(null);setConfirmation('');setError('')};
 const dialogRef=useDialog(resetTarget!==null,closeDialog);
 const readiness=readinessSnapshot&&readinessSnapshot.scope===scope?readinessSnapshot.rows:[];
 const readinessChecked=Boolean(readinessSnapshot&&readinessSnapshot.scope===scope);
 const readinessError=readinessFailure&&readinessFailure.scope===scope?readinessFailure.message:'';
 const completed=stages.filter(s=>s.status==='completed').length;
 const active=stages.filter(s=>s.status==='open').length;
 const searchTerm=search.trim().toLocaleLowerCase('ru-RU');
 const shown=stages.filter(s=>(filter==='all'||s.status===filter)&&(
  !searchTerm||[String(s.stage_no),String(s.stage_no).padStart(2,'0'),s.title].some(t=>t.toLocaleLowerCase('ru-RU').includes(searchTerm))
 )).sort((a,b)=>stageSort==='reverse'?b.stage_no-a.stage_no:stageSort==='status'?(a.status==='open'?-1:a.status==='locked'?1:0)-(b.status==='open'?-1:b.status==='locked'?1:0)||a.stage_no-b.stage_no:a.stage_no-b.stage_no);
 const selectedStage=stages.find(x=>x.stage_no===(expanded??currentStageNumber()));
 function currentStageNumber(){return stages.find(x=>x.status==='open')?.stage_no||game?.current_round||1}
 const selectedStageNo=selectedStage?.stage_no;
 const matchedSingle=stageReadinessSnapshot?.scope===scope&&stageReadinessSnapshot.stageNo===selectedStageNo?stageReadinessSnapshot.row:null;
 const selectedReady=matchedSingle||readiness.find(x=>x.stage_no===selectedStageNo);
 const selectedChecked=Boolean(matchedSingle)||readinessChecked;
 const selectedLoading=readinessLoading||stageReadinessLoading?.scope===scope&&stageReadinessLoading.stageNo===selectedStageNo;
 const selectedError=stageReadinessError?.scope===scope&&stageReadinessError.stageNo===selectedStageNo?stageReadinessError.message:readinessError;
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
   setReadinessSnapshot(null);setStageReadinessSnapshot(null);
   setResetTarget(null);setConfirmation('');
  }catch(err){
   setError((userError(err)||'Не удалось сбросить этапы.'));
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
   <button type="button" className="teacherStageCurrentShortcut" onClick={()=>{setExpanded(currentStageNumber());setDetailsStage(null);setFilter('all');setSearch('')}}>Текущий этап</button>
  </div>
  {notice&&<div className="teacherStageNotice" role="status"><CheckCircle2 size={16} aria-hidden="true"/>{notice}
   <button type="button" aria-label="Скрыть уведомление" onClick={()=>setNotice('')}><X size={15}/></button></div>}
  <div className="teacherStageSplit">
   <div className="teacherStageSidebar">
    <nav className="teacherStageList" aria-label="Выбор этапа">
    {shown.length===0?<div className="teacherStageEmpty">Этапов по фильтру нет.</div>:shown.map(stage=>{
     const ready=readiness.find(r=>r.stage_no===stage.stage_no);
     const StatusIcon=stage.status==='completed'?CheckCircle2:stage.status==='open'?CircleDot:LockKeyhole;
     return <button type="button" key={stage.id} className={'teacherStageListItem '+(selectedStage?.stage_no===stage.stage_no?'selected ':'')+'is-'+stage.status}
       aria-current={selectedStage?.stage_no===stage.stage_no?'step':undefined}
       onClick={()=>{setExpanded(stage.stage_no);setDetailsStage(null)}}>
       <span className="teacherStageNumber">{String(stage.stage_no).padStart(2,'0')}</span>
       <span className="teacherStageListCopy"><strong>{stage.title}</strong><small><StatusIcon size={13}/>{stage.status==='open'?'Текущий':stage.status==='completed'?'Завершён':'Закрыт'}{ready?.ready?' · Готов':ready?' · Есть препятствия':''}{stage.deadline?' · До '+new Date(stage.deadline).toLocaleDateString('ru-RU'):' · Срок не задан'}</small></span>
       <ChevronRight size={17} aria-hidden="true"/>
     </button>;
    })}
    </nav>
    {selectedStage&&<button type="button" className="teacherStageCurrentShortcut" aria-expanded={detailsStage===selectedStage.stage_no} onClick={()=>setDetailsStage(n=>n===selectedStage.stage_no?null:selectedStage.stage_no)}>{detailsStage===selectedStage.stage_no?'Скрыть сроки и последствия':'Сроки, штрафы и нарушения'}</button>}
    {selectedStage&&detailsStage===selectedStage.stage_no&&<DeadlineControl g={g} stageNo={selectedStage.stage_no}/>}
   </div>
   <div className="teacherStageInspector">
    {selectedStage?<><header className="teacherStageInspectorHead"><div className="teacherStageInspectorIdentity">
      <span className="teacherStageNumber">{String(selectedStage.stage_no).padStart(2,'0')}</span>
      <div><small>ЭТАП · {selectedStage.status==='open'?'ТЕКУЩИЙ':selectedStage.status==='completed'?'ЗАВЕРШЁН':'ЗАКРЫТ'}</small><h3>{selectedStage.title}</h3></div>
     </div>
     <button type="button" className="teacherStageInspectorReset" onClick={()=>askReset(selectedStage.stage_no)} title="Сбросить этот этап" aria-label={'Сбросить этап '+selectedStage.stage_no} disabled={busy}><RotateCcw size={17}/></button></header>
     {selectedStage.summary&&<p className="teacherStageInspectorSummary">{selectedStage.summary}</p>}
     <StageReadinessPanel g={g} stageNo={selectedStage.stage_no} compact compactReadiness={selectedReady} compactChecked={selectedChecked} compactLoading={Boolean(selectedLoading)} compactError={selectedError} onCompactRefresh={()=>void checkSelectedStage(selectedStage.stage_no)}/>
     <div className="teacherStageInspectorActions" aria-label="Действия с выбранным этапом">
      <div className={"teacherStageFlowActions"+(selectedStage.status!=="open"?" isOpening":"")}>
       {selectedStage.status!=='open'
        ?<button type="button" className="teacherStageOpenFull" disabled={stageActionBusy} onClick={()=>void changeStage(selectedStage.stage_no,'open')}>Открыть этап</button>
        :<>
         <button type="button" disabled={stageActionBusy||readinessLoading}
    title={!selectedReady?.ready?'Сначала выполните обязательные процедуры и оформите итоговые документы':'Завершить проверенный этап'}
    onClick={()=>void changeStage(selectedStage.stage_no,'close')}>Завершить этап</button>
         <label className="teacherStageExtendField">Продление, минут
          <input aria-label="Продление этапа в минутах" type="number" min={1} max={43200} value={extensionMinutes} onChange={e=>setExtensionMinutes(Math.max(1,Math.min(43200,Number(e.target.value)||1)))}/>
         </label>
         <button type="button" disabled={stageActionBusy} onClick={()=>void changeStage(selectedStage.stage_no,'extend')}>Продлить этап</button>
        </>}
      </div>
      <button type="button" className="primary teacherStageProcedures" onClick={()=>onOpenStage(selectedStage.stage_no)}>Открыть процедуры этапа <ChevronRight size={16}/></button>
     </div>
     {detailsStage===selectedStage.stage_no&&<StagePolicyEditor key={selectedStage.id} g={g} stageNo={selectedStage.stage_no}/>}
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
