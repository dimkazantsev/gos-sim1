'use client';
import {ArrowRight,ArrowUpRight,BookOpenText,Building2,CalendarClock,ChartNoAxesCombined,CheckCircle2,ChevronRight,CircleDot,ClipboardCheck,ClipboardList,Landmark,Layers3,LockKeyhole,Map,MapPin,Network,Search,Scale,ShieldAlert,SlidersHorizontal,Target,RotateCcw,TriangleAlert,UserRoundX,UsersRound,Vote,Wallet,X} from 'lucide-react';
import {useEffect,useState,type CSSProperties} from 'react';
import {useDialog} from '../ui/useDialog';
import {IconAction} from '../ui/IconAction';
import type {ReturnTypeRepublic} from './viewTypes';
import type {Stage} from './types';
import {formatDeadline} from './constants';
import {STAGE_DETAILS} from './stageDetails';
import {GAME_PHASES,gamePhaseForStage} from './stageSystem';
import StageWorkspace from './StageWorkspace';
import {useSavedGameState} from './useSavedGameState';

// A consistent icon language for the sixteen institutions and decisions.
const STAGE_ICONS=[UsersRound,SlidersHorizontal,Map,Landmark,UserRoundX,ClipboardCheck,Vote,Building2,Network,Target,ClipboardList,Scale,Wallet,MapPin,ShieldAlert,ChartNoAxesCombined] as const;
type StageFilter='all'|'open'|'voting'|'completed'|'locked';

export default function StagesView({g,onOpenVotes,onOpenDocument,onCreateDocument,onNavigate,focusStageNo=0,readOnly=false}:{g:ReturnTypeRepublic;onOpenVotes:()=>void;onOpenDocument?:(id:string)=>void;onCreateDocument?:(key:string,stageNo:number)=>void;onNavigate?:(view:import('./types').View)=>void;focusStageNo?:number;readOnly?:boolean}){
 const {stages,votes,teacher,nextStage}=g;
 const [selectedStageNo,setSelectedStageNo]=useSavedGameState(g.game?.id,g.me?.user_id,'stage-selected',0,value=>Number.isInteger(value)&&Number(value)>=0&&Number(value)<=16);
 const selected=stages.find(s=>s.stage_no===selectedStageNo)||null;
 function setSelected(stage:Stage|null){setSelectedStageNo(stage?.stage_no||0)}
 const [resetTarget,setResetTarget]=useState<number|'all'|null>(null);
 const [resetConfirmation,setResetConfirmation]=useState('');
 const [resetBusy,setResetBusy]=useState(false);
 const [resetNotice,setResetNotice]=useState('');
 const resetDialogRef=useDialog(resetTarget!==null,()=>{if(!resetBusy){setResetTarget(null);setResetConfirmation('')}});

 const [stageFilter,setStageFilter]=useState<StageFilter>('all');
 const [phaseFilter,setPhaseFilter]=useState<string|null>(null);
 const [stageSearch,setStageSearch]=useState('');
 useEffect(()=>{if(focusStageNo)setSelected(stages.find(s=>s.stage_no===focusStageNo)||null)},[focusStageNo]);
 const detail=selected?STAGE_DETAILS[selected.stage_no]:null;
 const current=stages.find(s=>s.status==='open')||stages.find(s=>s.status!=='completed')||stages.at(-1);

 const completedCount=stages.filter(s=>s.status==='completed').length;
 const openCount=stages.filter(s=>s.status==='open').length;
 const votingStageNos=new Set(votes.filter(v=>v.status==='open').map(v=>v.stage_no));
 const votingCount=stages.filter(s=>votingStageNos.has(s.stage_no)).length;
 const completionPercent=stages.length?Math.round(completedCount/stages.length*100):0;
 const resetStage=resetTarget==='all'?null:resetTarget;
 const resetStageRecord=typeof resetTarget==='number'?stages.find(s=>s.stage_no===resetTarget):null;
 const resetIsAll=resetTarget==='all';
 const canConfirmReset=resetTarget!==null&&!resetBusy&&(!resetIsAll||resetConfirmation.trim()==='СБРОСИТЬ');
 function requestReset(target:number|'all'){
  if(!teacher||readOnly)return;
  setResetNotice('');
  setResetConfirmation('');
  setResetTarget(target);
 }
 async function confirmReset(){
  if(!canConfirmReset||!teacher||readOnly)return;
  setResetBusy(true);
  try{
   const ok=await g.resetStageProgress(resetStage);
   if(ok){
    setResetNotice(resetIsAll?'Статусы и сроки всех этапов сброшены. Игровой таймер остановлен.':('Этап '+resetStage+' сброшен.'));
    setResetTarget(null);
    setResetConfirmation('');
    if(resetIsAll){setStageFilter('all');setPhaseFilter(null);setStageSearch('')}
    if(selected&&resetStage!==null&&selected.stage_no===resetStage)setSelected(null);
   }
  }finally{setResetBusy(false)}
 }

 const stageFilters:{id:StageFilter;label:string;count:number}[]=[
  {id:'all',label:'Все этапы',count:stages.length},
  {id:'open',label:'Текущие',count:openCount},
  {id:'voting',label:'Голосования',count:votingCount},
  {id:'completed',label:'Завершённые',count:completedCount},
  {id:'locked',label:'Закрытые',count:stages.filter(s=>s.status==='locked').length}
 ];
 const selectedPhase=phaseFilter?GAME_PHASES.find(p=>p.id===phaseFilter):null;
 const normalizedSearch=stageSearch.trim().toLocaleLowerCase('ru-RU');
 const visibleStages=stages.filter(s=>
  (!selectedPhase||(s.stage_no>=selectedPhase.range[0]&&s.stage_no<=selectedPhase.range[1]))&&
  (stageFilter==='all'||(stageFilter==='voting'?votingStageNos.has(s.stage_no):s.status===stageFilter))&&
  (!normalizedSearch||[String(s.stage_no),String(s.stage_no).padStart(2,'0'),s.title,s.summary,s.mode].some(part=>part.toLocaleLowerCase('ru-RU').includes(normalizedSearch)))
 );
 if(selected&&detail){
  return <StageWorkspace
   g={g}
   stage={selected}
   readOnly={readOnly}
   onBack={()=>setSelected(null)}
   onOpenStage={stageNo=>setSelected(stages.find(item=>item.stage_no===stageNo)||null)}
   onOpenVotes={onOpenVotes}
   onOpenDocument={onOpenDocument}
   onCreateDocument={onCreateDocument}
   onNavigate={onNavigate}
  />;
 }
 return <div className="stagesPage stagesAtlas">
  <section className="stageAtlasHero" aria-labelledby="stage-atlas-title">
   <div className="stageAtlasHeading">
    <span className="stageAtlasOverline"><Layers3 size={16} strokeWidth={2} aria-hidden="true"/> КАРТА ИГРЫ · {stages.length} ЭТАПОВ</span>
    <h1 id="stage-atlas-title">Этапы и задачи</h1>
    <p>Путь от создания партий до управления государством. Выберите этап, чтобы изучить его правила и выполнить задачи.</p>
   </div>
   <div className="stageAtlasHeroAside">
    <div className="stageAtlasProgressBox">
     <div className="stageAtlasProgressTop"><span>Прогресс республики</span><strong>{completedCount} <span>/ {stages.length}</span></strong></div>
     <div className="stageAtlasProgressTrack" role="progressbar" aria-label="Пройдено этапов" aria-valuemin={0} aria-valuemax={stages.length} aria-valuenow={completedCount}>
      <span style={{width:completionPercent+'%'}}/>
     </div>
     <div className="stageAtlasProgressBottom"><span>{completionPercent}% выполнено</span><span>{openCount?openCount+' сейчас активно':'Активных этапов нет'}</span></div>
    </div>
    {teacher&&!readOnly&&<div className="stageAtlasTeacherActions">
     <button type="button" className="stageAtlasResetAll" onClick={()=>requestReset('all')} disabled={resetBusy}><RotateCcw size={16} strokeWidth={2} aria-hidden="true"/> Сбросить все этапы</button>
     <button type="button" className="primary stageAtlasNext" onClick={nextStage} disabled={completedCount===stages.length}>Открыть следующий этап <ArrowRight size={17} aria-hidden="true"/></button>
    </div>}
   </div>
  </section>

  {resetNotice&&<div className="stageAtlasResetNotice" role="status"><CheckCircle2 size={17} aria-hidden="true"/>{resetNotice}<IconAction onClick={()=>setResetNotice('')} label="Скрыть сообщение"/></div>}
  <section className="stageAtlasPhases" aria-label="Фазы государственного строительства">
   <div className="stageAtlasSectionHead">
    <div><span className="stageAtlasEyebrow">МАРШРУТ</span><h2>Шесть фаз игры</h2></div>
    {phaseFilter&&<button type="button" className="stageAtlasClear" onClick={()=>setPhaseFilter(null)}>Показать все фазы <X size={15} aria-hidden="true"/></button>}
   </div>
   <div className="stageAtlasPhaseList">
    {GAME_PHASES.map(p=>{
     const done=stages.filter(s=>s.stage_no>=p.range[0]&&s.stage_no<=p.range[1]&&s.status==='completed').length;
     const total=p.range[1]-p.range[0]+1;
     const isCurrent=!!current&&current.stage_no>=p.range[0]&&current.stage_no<=p.range[1];
     const isSelected=phaseFilter===p.id;
     return <button type="button" key={p.id} className={'stageAtlasPhase'+(isCurrent?' isCurrent':'')+(isSelected?' isSelected':'')} aria-pressed={isSelected} title={p.title} onClick={()=>setPhaseFilter(isSelected?null:p.id)} style={{'--phase-accent':p.accent} as CSSProperties}>
      <span className="stageAtlasPhaseRange">{String(p.range[0]).padStart(2,'0')}{p.range[1]!==p.range[0]?' — '+String(p.range[1]).padStart(2,'0'):''}</span>
      <span className="stageAtlasPhaseTitle">{p.short}</span>
      <span className="stageAtlasPhaseBottom"><span>{done}/{total} пройдено</span>{done===total?<CheckCircle2 size={15} aria-hidden="true"/>:isCurrent?<CircleDot size={15} aria-hidden="true"/>:<ChevronRight size={15} aria-hidden="true"/>}</span>
      <span className="stageAtlasPhaseMeter" aria-hidden="true"><span style={{width:Math.round(done/total*100)+'%'}}/></span>
     </button>;
    })}
   </div>
  </section>

  <section className="stageAtlasDirectory" aria-label="Каталог этапов">
   <div className="stageAtlasDirectoryHead">
    <div><span className="stageAtlasEyebrow">РАБОЧАЯ КАРТА</span><h2>{selectedPhase?selectedPhase.title:'Все этапы'}</h2></div>
    <span className="stageAtlasVisibleCount">{visibleStages.length} из {stages.length}</span>
   </div>
   <div className="stageAtlasToolbar">
    <div className="stageAtlasFilters" role="group" aria-label="Фильтр этапов">
     {stageFilters.map(filter=><button type="button" key={filter.id} className={'stageAtlasFilter'+(stageFilter===filter.id?' isActive':'')} aria-pressed={stageFilter===filter.id} onClick={()=>setStageFilter(filter.id)}>
      {filter.label}<span>{filter.count}</span>
     </button>)}
    </div>
    <label className="stageAtlasSearch">
     <Search size={18} strokeWidth={2} aria-hidden="true"/>
     <input type="search" placeholder="Поиск по этапам" aria-label="Поиск по этапам" value={stageSearch} onChange={e=>setStageSearch(e.target.value)}/>
    </label>
   </div>
   {visibleStages.length>0?<div className="stageAtlasGrid">
    {visibleStages.map(s=>{
     const StageIcon=STAGE_ICONS[s.stage_no-1]||BookOpenText;
     const StatusIcon=s.status==='completed'?CheckCircle2:s.status==='open'?CircleDot:LockKeyhole;
     const hasOpenVote=votingStageNos.has(s.stage_no);
     const openDetails=()=>setSelected(s);
     return <article className={'stageAtlasCard is-'+s.status} key={s.id}>
      <div className="stageAtlasCardMain">
       <div className="stageAtlasCardGlyph" aria-hidden="true"><StageIcon size={22} strokeWidth={1.8}/><span>{String(s.stage_no).padStart(2,'0')}</span></div>
       <div className="stageAtlasCardContent">
        <div className="stageAtlasCardTopline">
         <span className="stageAtlasCardMode">{s.mode}</span>
         <span className={'stageAtlasCardStatus is-'+s.status}><StatusIcon size={15} strokeWidth={2.1} aria-hidden="true"/>{s.status==='open'?'Текущий этап':s.status==='completed'?'Завершён':'Закрыт'}</span>
        </div>
        <h3>{s.title}</h3>
        <p>{s.summary}</p>
       </div>
      </div>
      <div className="stageAtlasCardFooter">
       <div className="stageAtlasCardDeadline">{s.deadline?<><CalendarClock size={15} aria-hidden="true"/>До {formatDeadline(s.deadline)}</>:hasOpenVote?<span className="stageAtlasVoteIndicator"><span/>Требует внимания</span>:<span className="stageAtlasCardStageName">Этап {String(s.stage_no).padStart(2,'0')}</span>}</div>
       <div className="stageAtlasCardActions">
        {hasOpenVote&&<button type="button" className="stageAtlasVoteAction" onClick={onOpenVotes} aria-label={'Открыть голосования этапа '+s.stage_no}><Vote size={16} aria-hidden="true"/>Голосование</button>}
        <button type="button" className="stageAtlasDetailAction" onClick={openDetails} aria-label={'Подробнее об этапе '+s.stage_no+': '+s.title}>Подробнее <ArrowUpRight size={16} strokeWidth={2} aria-hidden="true"/></button>
        {teacher&&!readOnly&&<button type="button" className="stageAtlasResetStage" title={'Сбросить этап '+s.stage_no} aria-label={'Сбросить этап '+s.stage_no+': '+s.title} onClick={()=>requestReset(s.stage_no)} disabled={resetBusy}><RotateCcw size={17} strokeWidth={1.9} aria-hidden="true"/></button>}
       </div>
      </div>
     </article>;
    })}
   </div>:<div className="stageAtlasEmpty" role="status">
    <Search size={24} aria-hidden="true"/>
    <strong>Этапы не найдены</strong>
    <p>Измените поисковый запрос или сбросьте фильтры.</p>
    <button type="button" onClick={()=>{setStageSearch('');setStageFilter('all');setPhaseFilter(null)}}>Сбросить фильтры</button>
   </div>}
  </section>


  {resetTarget!==null&&teacher&&!readOnly&&<div className="stageResetBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!resetBusy)setResetTarget(null)}}>
   <section className="stageResetDialog" ref={resetDialogRef} role="alertdialog" aria-modal="true" aria-labelledby="stage-reset-title" aria-describedby="stage-reset-description" tabIndex={-1}>
    <div className="stageResetDialogIcon"><TriangleAlert size={25} strokeWidth={1.9} aria-hidden="true"/></div>
    <h2 id="stage-reset-title">{resetIsAll?'Сбросить все этапы?':'Сбросить этап '+resetTarget+'?'}</h2>
    <p id="stage-reset-description">{resetIsAll
     ?'Все 16 этапов вернутся в закрытое состояние. Текущий этап будет сброшен, а игровой таймер остановится.'
     :'Статус, дата открытия, дата завершения и дедлайн этапа «'+(resetStageRecord?.title||'')+'» будут очищены. Если это текущий этап, игровой таймер остановится.'}</p>
    <div className="stageResetKeep"><BookOpenText size={17} aria-hidden="true"/><span>Документы, результаты голосований, действия студентов и оценки сохранятся. Сброс касается только статусов и сроков этапов.</span></div>
    {resetIsAll&&<label className="stageResetConfirmLabel">Для подтверждения введите <strong>СБРОСИТЬ</strong>
     <input type="text" value={resetConfirmation} onChange={e=>setResetConfirmation(e.target.value)} autoComplete="off" spellCheck={false} placeholder="СБРОСИТЬ" disabled={resetBusy}/>
    </label>}
    <div className="stageResetDialogActions">
     <button type="button" className="stageResetCancel" disabled={resetBusy} onClick={()=>{setResetTarget(null);setResetConfirmation('')}}>Отмена</button>
     <button type="button" className="stageResetConfirm" disabled={!canConfirmReset} onClick={()=>void confirmReset()}>{resetBusy?'Выполняется…':resetIsAll?'Сбросить все этапы':'Сбросить этап'}</button>
    </div>
   </section>
  </div>}
 </div>;
}
