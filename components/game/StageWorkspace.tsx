'use client';

import type {CSSProperties} from 'react';
import {
 ArrowLeft,BookOpenText,Building2,CalendarClock,ChartNoAxesCombined,CheckCircle2,
 CircleDot,ClipboardCheck,ClipboardList,ExternalLink,Landmark,Layers3,LockKeyhole,
 Map,MapPin,Network,Route,Scale,ShieldAlert,Target,UserRoundX,UsersRound,Vote,Wallet
} from 'lucide-react';
import type {ReturnTypeRepublic} from './viewTypes';
import type {Stage,View} from './types';
import {formatDeadline} from './constants';
import {STAGE_DETAILS} from './stageDetails';
import {STAGE_SYSTEM,gamePhaseForStage} from './stageSystem';
import DeadlineControl from './DeadlineControl';
import StagePolicyEditor from './StagePolicyEditor';
import StageArtifacts,{STAGE_FORMS} from './StageArtifacts';
import StageReadinessPanel from './StageReadinessPanel';
import PresidentialElectionLab from './PresidentialElectionLab';
import PresidentialSystemDecisionPanel from './PresidentialSystemDecisionPanel';
import DumaLeadershipElection from './DumaLeadershipElection';
import GhostPolicyLab from './GhostPolicyLab';
import ElectoralArchitectureLab from './ElectoralArchitectureLab';
import GovernmentFormationLab from './GovernmentFormationLab';
import GovernmentStructurePanel from './GovernmentStructurePanel';
import InstitutionStaffingLab from './InstitutionStaffingLab';
import StateProgramLab from './StateProgramLab';
import MunicipalProjectLab from './MunicipalProjectLab';
import MunicipalGovernancePanel from './MunicipalGovernancePanel';
import SystemDebriefLab from './SystemDebriefLab';
import LegislativeSessionLab from './LegislativeSessionLab';
import GovernmentProgramSessionLab from './GovernmentProgramSessionLab';
import CrisisRoom from './CrisisRoom';

const STAGE_ICONS=[UsersRound,Route,Map,Landmark,UserRoundX,ClipboardCheck,Vote,Building2,Network,Target,ClipboardList,Scale,Wallet,MapPin,ShieldAlert,ChartNoAxesCombined] as const;

const VIEW_LABELS:Partial<Record<View,string>>={
 parties:'Партии / фракции',
 votes:'Голосование',
 documents:'Реестр НПА',
 budget:'Бюджет',
 events:'События',
 grades:'Журнал / оценки',
 actions:'Политический процесс',
 profile:'Профиль',
 stages:'Этапы'
};

export default function StageWorkspace({
 g,stage,readOnly=false,onBack,onOpenVotes,onOpenDocument,onCreateDocument,onNavigate
}:{
 g:ReturnTypeRepublic;
 stage:Stage;
 readOnly?:boolean;
 onBack:()=>void;
 onOpenVotes:()=>void;
 onOpenDocument?:(id:string)=>void;
 onCreateDocument?:(key:string,stageNo:number)=>void;
 onNavigate?:(view:View)=>void;
}){
 const detail=STAGE_DETAILS[stage.stage_no];
 const system=STAGE_SYSTEM[stage.stage_no];
 const phase=gamePhaseForStage(stage.stage_no);
 const task=STAGE_FORMS[stage.stage_no];
 const StageIcon=STAGE_ICONS[stage.stage_no-1]||BookOpenText;
 const StatusIcon=stage.status==='completed'?CheckCircle2:stage.status==='open'?CircleDot:LockKeyhole;
 const docs=g.formalDocuments.filter(d=>d.stage_no===stage.stage_no);
 const votes=g.votes.filter(v=>v.stage_no===stage.stage_no);
 const openVotes=votes.filter(v=>v.status==='open');
 const completedDocs=docs.filter(d=>['published','signed','adopted'].includes(d.status_code)).length;
 const primaryView=task?.target;
 const primaryLabel=primaryView?VIEW_LABELS[primaryView]||'профильный раздел':'эта страница';

 return <div className="stageWorkspacePage" style={{'--stage-phase-accent':phase.accent} as CSSProperties}>
  <header className="stageWorkspaceHero">
   <button type="button" className="stageWorkspaceBack" onClick={onBack} aria-label="Вернуться ко всем этапам"><span className="stageWorkspaceBackIcon" aria-hidden="true"><ArrowLeft size={20}/></span><span className="stageWorkspaceBackCopy"><small>К карте игры</small><b>Все этапы</b></span></button>
   <div className="stageWorkspaceHeroMain">
    <div className="stageWorkspaceBadge" aria-hidden="true"><StageIcon size={25}/><span>{String(stage.stage_no).padStart(2,'0')}</span></div>
    <div className="stageWorkspaceTitle">
     <span className="stageWorkspaceEyebrow">{phase.short} · {stage.mode}</span>
     <h1>{stage.title}</h1>
     <p>{stage.summary}</p>
     <div className="stageWorkspacePills">
      <span className={'stageWorkspaceStatus is-'+stage.status}><StatusIcon size={15}/>{stage.status==='open'?'Этап открыт':stage.status==='completed'?'Этап завершён':'Этап закрыт'}</span>
      {stage.deadline&&<span><CalendarClock size={15}/> До {formatDeadline(stage.deadline)}</span>}
      {votes.length>0&&<span className={openVotes.length?'isAttention':''}><Vote size={15}/>{openVotes.length?openVotes.length+' открытых голосований':'Голосований: '+votes.length}</span>}
     </div>
    </div>
   </div>
   <div className="stageWorkspaceSummary" aria-label="Сводка этапа">
    <div><small>Документы</small><b>{docs.length}</b><span>{completedDocs} финализировано</span></div>
    <div><small>Голосования</small><b>{votes.length}</b><span>{openVotes.length?openVotes.length+' требуют действия':'Нет открытых'}</span></div>
    <div><small>Результаты</small><b>{detail.outputs.length}</b><span>контрольных итогов</span></div>
    <div><small>Маршрут</small><b>{detail.steps.length}</b><span>пошаговых действий</span></div>
   </div>
  </header>

  <section className="stageStudentRoute">
   <div className="stageStudentRouteIcon"><Route size={24}/></div>
   <div>
    <small>КАК ВЫПОЛНИТЬ ЭТАП</small>
    <h2>{primaryView?'Основная работа ведётся в разделе «'+primaryLabel+'»':'Все рабочие формы находятся на этой странице'}</h2>
    <p>{task?.help||'Выполните действия ниже, сохраните документы и завершите связанные процедуры. Система автоматически подтянет результаты в карточку этапа.'}</p>
   </div>
   <div className="stageStudentRouteActions">
    {detail.rulesUrl&&<a className="secondary stageRulesButton" href={detail.rulesUrl} target="_blank" rel="noreferrer"><BookOpenText size={17}/> Правила игры <ExternalLink size={14}/></a>}
    {primaryView&&onNavigate&&<button type="button" className="primary" onClick={()=>onNavigate(primaryView)}><ExternalLink size={17}/> Перейти и выполнить</button>}
   </div>
  </section>

  <div className="stageWorkspaceOverview">
   <section className="stageWorkspaceCard stageWorkspaceGoal">
    <small>СМЫСЛ ЭТАПА</small>
    <h2>Что происходит и зачем</h2>
    <p>{detail.goal}</p>
   </section>
   <section className="stageWorkspaceCard stageWorkspaceInstitution">
    <small>ИНСТИТУЦИОНАЛЬНАЯ ЛОГИКА</small>
    <h2>{system.institution}</h2>
    <p>{system.strategicQuestion}</p>
    <div><span>{system.legalMode}</span><span>{system.gameMechanic}</span></div>
   </section>
  </div>

  <section className="stageWorkspaceBlueprint">
   <div className="stageWorkspaceSectionHead">
    <div><small>ПОШАГОВЫЙ МАРШРУТ</small><h2>Что студент должен сделать</h2></div>
    <span>{detail.steps.length} действий</span>
   </div>
   <div className="stageWorkspaceSteps">
    {detail.steps.map((step,index)=><article key={index}><span>{String(index+1).padStart(2,'0')}</span><p>{step}</p></article>)}
   </div>
  </section>

  <div className="stageWorkspaceTwoColumns">
   <section className="stageWorkspaceCard">
    <small>ЭТАП СЧИТАЕТСЯ ВЫПОЛНЕННЫМ, КОГДА</small>
    <h2>Контрольные результаты</h2>
    <ul className="stageWorkspaceCheckList">{detail.outputs.map((item,index)=><li key={index}><CheckCircle2 size={17}/><span>{item}</span></li>)}</ul>
   </section>
   <section className="stageWorkspaceCard">
    <small>ПРОЦЕДУРА</small>
    <h2>Как проходит этап</h2>
    <ol className="stageWorkspaceProcedure">{detail.procedure.map((item,index)=><li key={index}><b>{index+1}</b><span>{item}</span></li>)}</ol>
   </section>
  </div>

  {detail.notes.length>0&&<section className="stageWorkspaceNotes">
   <small>ВАЖНО ДО НАЧАЛА РАБОТЫ</small>
   <div>{detail.notes.map((item,index)=><p key={index}><span>!</span>{item}</p>)}</div>
  </section>}

  {g.teacher&&!readOnly&&<section className="stageWorkspaceTeacher">
   <header className="stageWorkspaceTeacherHead">
    <div><small>ПРЕПОДАВАТЕЛЬ</small><h2>Управление этапом</h2><p>Настройки ниже синхронизированы с «Управление → Этапы».</p></div>
    {stage.status!=='open'&&<button type="button" className="primary" onClick={()=>void g.openStage(stage.stage_no)}>Открыть этот этап</button>}
   </header>
   <StagePolicyEditor g={g} stageNo={stage.stage_no}/>
  </section>}

  <section className="stageWorkspaceExecution">
   <div className="stageWorkspaceSectionHead">
    <div><small>РАБОЧЕЕ МЕСТО</small><h2>Документы, формы и процедуры</h2><p>Заполняйте формы здесь или переходите в профильный раздел. Сохранённые НПА, голосования и результаты синхронизируются с этапом.</p></div>
    <Layers3 size={25}/>
   </div>

   <fieldset className="stageWorkspaceControls" disabled={readOnly}>
    <legend className="srOnly">Рабочие действия этапа</legend>
    {readOnly&&<p className="readOnlyNote">Режим просмотра участника: формы показаны для проверки интерфейса, но изменение данных заблокировано.</p>}

    <DeadlineControl g={g} stageNo={stage.stage_no}/>
    <StageArtifacts g={g} stage={stage} readOnly={readOnly} onOpenDocument={onOpenDocument} onCreateDocument={onCreateDocument} onNavigate={onNavigate} onOpenVotes={onOpenVotes}/>

    {(stage.stage_no===2||stage.stage_no===3)&&<ElectoralArchitectureLab g={g} stageNo={stage.stage_no as 2|3} onOpenVotes={onOpenVotes}/>}
    {stage.stage_no===4&&<DumaLeadershipElection g={g}/>}
    {stage.stage_no===5&&<GhostPolicyLab g={g} onOpenVotes={onOpenVotes}/>}
    {stage.stage_no===7&&<PresidentialSystemDecisionPanel g={g} onOpenVotes={onOpenVotes}/>}
    {(stage.stage_no===6||stage.stage_no===7)&&<PresidentialElectionLab g={g}/>}
    {stage.stage_no===8&&<><GovernmentStructurePanel g={g}/><GovernmentFormationLab g={g}/></>}
    {stage.stage_no===9&&<InstitutionStaffingLab g={g}/>}
    {(stage.stage_no===10||stage.stage_no===11)&&<StateProgramLab g={g}/>}
    {stage.stage_no===11&&<GovernmentProgramSessionLab g={g} onOpenVotes={onOpenVotes}/>}
    {stage.stage_no===12&&<LegislativeSessionLab g={g} onOpenVotes={onOpenVotes}/>}
    {stage.stage_no===14&&<><MunicipalGovernancePanel g={g}/><MunicipalProjectLab g={g}/></>}
    {stage.stage_no===15&&<CrisisRoom g={g}/>}
    {stage.stage_no===16&&<SystemDebriefLab g={g}/>}

    <StageReadinessPanel g={g} stageNo={stage.stage_no} rulesUrl={detail.rulesUrl} rulesLabel={detail.rulesSection||'Правила игры'}/>
   </fieldset>
  </section>

  {(detail.sources?.length||detail.rulesUrl)&&<section className="stageWorkspaceSources">
   <div><small>СПРАВОЧНАЯ БАЗА</small><h2>Правила и нормативные источники</h2></div>
   <div className="stageWorkspaceSourceLinks">
    {detail.sources?.map((source,index)=><a key={index} href={source.url} target="_blank" rel="noreferrer"><BookOpenText size={17}/><span>{source.label}</span><ExternalLink size={14}/></a>)}
    {detail.rulesUrl&&<a href={detail.rulesUrl} target="_blank" rel="noreferrer"><BookOpenText size={17}/><span>{detail.rulesSection||'Полные правила этапа'}</span><ExternalLink size={14}/></a>}
   </div>
  </section>}


 </div>;
}
