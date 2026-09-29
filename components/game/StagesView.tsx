'use client';
import {IconAction} from '../ui/IconAction';
import {ArrowRight,ArrowUpRight,BookOpenText,Building2,CalendarClock,ChartNoAxesCombined,CheckCircle2,CircleDot,ClipboardCheck,ClipboardList,Landmark,LockKeyhole,Map,MapPin,Network,Scale,ShieldAlert,SlidersHorizontal,Target,UserRoundX,UsersRound,Vote,Wallet} from 'lucide-react';
import {useEffect,useState,type CSSProperties} from 'react';
import {useDialog} from '../ui/useDialog';
import type {ReturnTypeRepublic} from './viewTypes';
import type {Stage} from './types';
import {formatDeadline} from './constants';
import {STAGE_DETAILS} from './stageDetails';
import {GAME_PHASES,STAGE_SYSTEM,gamePhaseForStage} from './stageSystem';
import DeadlineControl from './DeadlineControl';
import PresidentialElectionLab from './PresidentialElectionLab';
import PresidentialSystemDecisionPanel from './PresidentialSystemDecisionPanel';
import DumaLeadershipElection from './DumaLeadershipElection';
import GhostPolicyLab from './GhostPolicyLab';
import ElectoralArchitectureLab from './ElectoralArchitectureLab';
import GovernmentFormationLab from './GovernmentFormationLab';
import GovernmentStructurePanel from './GovernmentStructurePanel';
import InstitutionStaffingLab from './InstitutionStaffingLab';
import StateProgramLab from './StateProgramLab';
import BudgetLab from './BudgetLab';
import MunicipalProjectLab from './MunicipalProjectLab';
import MunicipalGovernancePanel from './MunicipalGovernancePanel';
import SystemDebriefLab from './SystemDebriefLab';
import LegislativeSessionLab from './LegislativeSessionLab';
import GovernmentProgramSessionLab from './GovernmentProgramSessionLab';
import CrisisRoom from './CrisisRoom';
import StageReadinessPanel from './StageReadinessPanel';

// A consistent icon language for the sixteen institutions and decisions.
const STAGE_ICONS=[UsersRound,SlidersHorizontal,Map,Landmark,UserRoundX,ClipboardCheck,Vote,Building2,Network,Target,ClipboardList,Scale,Wallet,MapPin,ShieldAlert,ChartNoAxesCombined] as const;

export default function StagesView({g,onOpenVotes,focusStageNo=0,readOnly=false}:{g:ReturnTypeRepublic;onOpenVotes:()=>void;focusStageNo?:number;readOnly?:boolean}){
 const {stages,votes,teacher,nextStage,openStage,setStageDeadline}=g;
 const [selected,setSelected]=useState<Stage|null>(null);
 const dialogRef=useDialog(!!selected,()=>setSelected(null));
 useEffect(()=>{if(focusStageNo)setSelected(stages.find(s=>s.stage_no===focusStageNo)||null)},[focusStageNo]);
 const detail=selected?STAGE_DETAILS[selected.stage_no]:null;
 const current=stages.find(s=>s.status==='open')||stages.find(s=>s.status!=='completed')||stages.at(-1);
 const currentPhase=current?gamePhaseForStage(current.stage_no):GAME_PHASES[0];
 const selectedSystem=selected?STAGE_SYSTEM[selected.stage_no]:null;
 const SelectedStageIcon=STAGE_ICONS[(selected?.stage_no||1)-1]||BookOpenText;
 const SelectedStatusIcon=selected?.status==='completed'?CheckCircle2:selected?.status==='open'?CircleDot:LockKeyhole;
 const selectedOpenVoteCount=selected?votes.filter(v=>v.stage_no===selected.stage_no&&v.status==='open').length:0;
 const selectedVoteCount=selected?votes.filter(v=>v.stage_no===selected.stage_no).length:0;

 return <div className="stagesPage">
  <section className="pageHeader">
   <div><small>КАРТА ИГРЫ · 16 ЭТАПОВ</small><h1>Путь вашей республики</h1><p>Нажмите на любой этап — откроются полные правила, задачи, результаты и процедура.</p></div>
   {teacher&&<button type="button" className="primary stageNextButton" onClick={nextStage}>Открыть следующий этап <ArrowRight size={17} aria-hidden="true"/></button>}
  </section>

  <section className="stagePhaseRail" aria-label="Фазы государственного строительства">
   <div className="stagePhaseIntro"><small>КАРТА ГОСУДАРСТВА</small><b>{currentPhase.title}</b><span>Текущая фаза · этап {current?.stage_no||1} из 16</span></div>
   <div className="stagePhaseTrack">{GAME_PHASES.map(p=>{
    const completed=stages.filter(s=>s.stage_no>=p.range[0]&&s.stage_no<=p.range[1]&&s.status==='completed').length;
    const total=p.range[1]-p.range[0]+1;
    const active=!!current&&current.stage_no>=p.range[0]&&current.stage_no<=p.range[1];
    return <button key={p.id} className={active?'active':''} onClick={()=>{const s=stages.find(x=>x.stage_no===p.range[0]);if(s)setSelected(s)}} style={{'--phase-accent':p.accent} as CSSProperties}>
     <i>{String(p.range[0]).padStart(2,'0')}{p.range[1]!==p.range[0]?'–'+String(p.range[1]).padStart(2,'0'):''}</i>
     <b>{p.short}</b><span className="stagePhaseProgress">{completed===total?<CheckCircle2 size={14} aria-hidden="true"/>:<CircleDot size={14} aria-hidden="true"/>}{completed}/{total}</span>
    </button>
   })}</div>
  </section>


  <div className="stageTimeline">
   {stages.map(s=>{
    const StageIcon=STAGE_ICONS[s.stage_no-1]||BookOpenText;
    const StatusIcon=s.status==='completed'?CheckCircle2:s.status==='open'?CircleDot:LockKeyhole;
    const hasOpenVote=votes.some(v=>v.stage_no===s.stage_no&&v.status==='open');
    const openDetails=()=>setSelected(s);
    return <article className={'stageCard '+s.status} key={s.id}>
     <button type="button" className="stageCardPrimary" onClick={openDetails} aria-label={'Открыть описание этапа '+s.stage_no+': '+s.title}>
      <div className="stageCardTop">
       <span className="stageNo" aria-hidden="true"><StageIcon size={22} strokeWidth={1.85}/><span>{String(s.stage_no).padStart(2,'0')}</span></span>
       <span className="stageCardBody">
        <span className="stageCardMode">{s.mode}</span>
        <span className="stageCardTitle">{s.title}</span>
        <span className="stageCardSummary">{s.summary}</span>
       </span>
      </div>
     </button>
     <div className="stageCardFooter">
      <div className="stageCardFooterExtras">
       {s.deadline&&<span className="stageDeadlinePill"><CalendarClock size={15} aria-hidden="true"/><span>До {formatDeadline(s.deadline)}</span></span>}
       {hasOpenVote&&<button type="button" className="stageVoteQuick" onClick={onOpenVotes} aria-label={'Перейти к голосованиям этапа '+s.stage_no}>
        <Vote size={16} strokeWidth={1.9} aria-hidden="true"/><span>Голосование</span><ArrowUpRight size={15} aria-hidden="true"/>
       </button>}
      </div>
      <div className="stageCardFooterRow">
       <span className={'stageStatusPill stageStatusPill--'+s.status}><StatusIcon size={16} strokeWidth={2.1} aria-hidden="true"/><span>{s.status==='open'?'Текущий':s.status==='completed'?'Завершён':'Закрыт'}</span></span>
       <button type="button" className="stageCardOpen" onClick={openDetails} aria-label={'Подробнее об этапе '+s.stage_no}>
        <span>Подробнее</span><ArrowRight size={17} strokeWidth={2} aria-hidden="true"/>
       </button>
      </div>
     </div>
    </article>
   })}
  </div>

  {selected&&detail&&<div className="stageModalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null)}}>
   <section ref={dialogRef} tabIndex={-1} className="stageDetailPanel" role="dialog" aria-modal="true" aria-labelledby="stage-detail-title">
    <header className="stageDetailHeader">
     <div className="stageDetailBadge" aria-hidden="true"><SelectedStageIcon size={23} strokeWidth={1.9}/><span>{String(selected.stage_no).padStart(2,'0')}</span></div>
     <div>
      <small>{selected.mode}</small>
      <h2 id="stage-detail-title">{selected.title}</h2>
      <div className="stageDetailStatus">
       <span className={'stageStatusPill stageStatusPill--'+selected.status}><SelectedStatusIcon size={15} aria-hidden="true"/>{selected.status==='open'?'Текущий этап':selected.status==='completed'?'Завершён':'Закрыт'}</span>
       {selected.deadline&&<span className="stageDeadlinePill"><CalendarClock size={15} aria-hidden="true"/>Дедлайн: {formatDeadline(selected.deadline)}</span>}
       {selectedVoteCount>0&&<span className={'stageVotePill'+(selectedOpenVoteCount?' isOpen':'')}><Vote size={15} aria-hidden="true"/>{selectedOpenVoteCount?'Открыто голосований: '+selectedOpenVoteCount:'Голосований: '+selectedVoteCount}</span>}

      </div>
     </div>
     <IconAction className="stageClose" onClick={()=>setSelected(null)} label="Закрыть описание"/>
    </header>

    <div className="stageDetailScroll">
     <section className="stageLead">
      <small>СМЫСЛ ЭТАПА</small>
      <p>{detail.goal}</p>
     </section>

     {selectedSystem&&<section className="stageSystemLens">
      <div><small>ИНСТИТУЦИОНАЛЬНЫЙ РЕЖИМ</small><b>{selectedSystem.institution}</b><span>{selectedSystem.legalMode}</span></div>
      <div><small>СТРАТЕГИЧЕСКИЙ ВОПРОС</small><p>{selectedSystem.strategicQuestion}</p></div>
      <div><small>МЕХАНИКА ЭТАПА</small><p>{selectedSystem.gameMechanic}</p></div>
     </section>}

     <div className="stageDetailGrid">
      <section className="stageDetailBlock stageSteps">
       <small>ЧТО НУЖНО СДЕЛАТЬ</small>
       <ol>{detail.steps.map((x,i)=><li key={i}><span>{i+1}</span><p>{x}</p></li>)}</ol>
      </section>

      <section className="stageDetailBlock">
       <small>ЧТО ДОЛЖНО ПОЛУЧИТЬСЯ</small>
       <ul className="stageOutputList">{detail.outputs.map((x,i)=><li key={i}>✓ {x}</li>)}</ul>
      </section>
     </div>

     <section className="stageDetailBlock">
      <small>КАК ПРОХОДИТ ЭТАП</small>
      <div className="stageProcedure">{detail.procedure.map((x,i)=><p key={i}><b>{String(i+1).padStart(2,'0')}</b><span>{x}</span></p>)}</div>
     </section>

     {detail.notes.length>0&&<section className="stageNotes">
      <small>ВАЖНО</small>
      {detail.notes.map((x,i)=><p key={i}>! {x}</p>)}
     </section>}

     {detail.sources&&detail.sources.length>0&&<section className="stageSources">
      <small>НОРМАТИВНЫЕ И ИНФОРМАЦИОННЫЕ ИСТОЧНИКИ</small>
      <div>{detail.sources.map((x,i)=><a key={i} href={x.url} target="_blank" rel="noreferrer">{x.label}<span>↗</span></a>)}</div>
     </section>}

     <section className="stageRuleSource">
      <div><small>ОСНОВА ОПИСАНИЯ</small><b>Правила деловой игры «Республика Политология»</b></div>
      <p>Описание адаптировано для интерфейса из полного сценария игры; содержание этапа сохранено, а длинные процедурные положения структурированы для удобного чтения.</p>
     </section>

     {detail.rulesUrl&&<section className="stageRulesCallout">
      <div className="stageRulesCalloutIcon"><BookOpenText size={23} strokeWidth={1.9} aria-hidden="true"/></div>
      <div>
       <small>УТОЧНИТЬ ПО ПРАВИЛАМ</small>
       <h3>{detail.rulesSection||('Этап '+selected.stage_no)}</h3>
       <p>Если нужна формулировка без сокращений, примеры, специальные условия или процедурные детали — откройте соответствующий раздел полного документа правил.</p>
      </div>
      <a href={detail.rulesUrl} target="_blank" rel="noreferrer">Открыть полные правила <span>↗</span></a>
     </section>}

     {votes.some(v=>v.stage_no===selected.stage_no&&v.status==='open')&&<section className="stageVotingLink">
      <div><small>СВЯЗАННОЕ ГОЛОСОВАНИЕ</small><b>По этому этапу сейчас идёт процедурное голосование</b><p>Откройте центр голосований, чтобы увидеть кворум, связанные НПА и результат процедуры.</p></div>
      <button className="primary stageModalVoteAction" onClick={onOpenVotes}><Vote size={18} aria-hidden="true"/>Перейти к голосованию <ArrowRight size={17} aria-hidden="true"/></button>
     </section>}

     <fieldset className="labControls" disabled={readOnly}><legend className="srOnly">Рабочие действия этапа</legend>{readOnly&&<p className="readOnlyNote">Просмотр интерфейса участника. Рабочие действия доступны в его собственной сессии.</p>}
     <DeadlineControl g={g} stageNo={selected.stage_no}/>

     {(selected.stage_no===2||selected.stage_no===3)&&<ElectoralArchitectureLab g={g} stageNo={selected.stage_no as 2|3} onOpenVotes={onOpenVotes}/>} 

     {selected.stage_no===4&&<DumaLeadershipElection g={g}/>} 

     {selected.stage_no===5&&<GhostPolicyLab g={g} onOpenVotes={onOpenVotes}/>} 

     {selected.stage_no===7&&<PresidentialSystemDecisionPanel g={g} onOpenVotes={onOpenVotes}/>} 

     {(selected.stage_no===6||selected.stage_no===7)&&<PresidentialElectionLab g={g}/>} 

     {selected.stage_no===8&&<><GovernmentStructurePanel g={g}/><GovernmentFormationLab g={g}/></>} 

     {selected.stage_no===9&&<InstitutionStaffingLab g={g}/>} 

     {(selected.stage_no===10||selected.stage_no===11)&&<StateProgramLab g={g}/>} 

     {selected.stage_no===11&&<GovernmentProgramSessionLab g={g} onOpenVotes={onOpenVotes}/>} 

     {selected.stage_no===12&&<LegislativeSessionLab g={g} onOpenVotes={onOpenVotes}/>} 

     {selected.stage_no===13&&<BudgetLab g={g}/>} 

     {selected.stage_no===14&&<><MunicipalGovernancePanel g={g}/><MunicipalProjectLab g={g}/></>} 

     {selected.stage_no===15&&<CrisisRoom g={g}/>} 

     {selected.stage_no===16&&<SystemDebriefLab g={g}/>} 

     <StageReadinessPanel g={g} stageNo={selected.stage_no}/>
     </fieldset>

     {teacher&&<section className="stageTeacherActions">
      <div><small>УПРАВЛЕНИЕ ЭТАПОМ</small><b>Действия преподавателя</b></div>
      <div>
       {selected.status!=='open'&&<button className="primary" onClick={()=>void openStage(selected.stage_no)}>Открыть этот этап</button>}
       <label>Дедлайн<input type="datetime-local" onChange={e=>void setStageDeadline(selected.id,e.target.value)}/></label>
      </div>
     </section>}
    </div>
   </section>
  </div>}
 </div>;
}
