'use client';

import {useCallback,useEffect,useState,type CSSProperties} from 'react';
import {ArrowLeft,BookOpenText,CalendarClock,CheckCircle2,ChevronLeft,ChevronRight,ClipboardCheck,FileText,Landmark,Link2,MessageCircle,Route,Settings2,Vote} from 'lucide-react';
import {isStageWorkOpen,stageWorkLabel} from './stageWorkStatus';
import type {Stage,View} from './types';
import type {ReturnTypeRepublic} from './viewTypes';
import {formatDeadline} from './constants';
import {STAGE_DETAILS} from './stageDetails';
import {STAGE_OPERATIONS} from './stageOperations';
import {gamePhaseForStage} from './stageSystem';
import StageArtifacts from './StageArtifacts';
import StageReadinessPanel from './StageReadinessPanel';
import StagePolicyEditor,{CONSEQUENCE_OPTIONS} from './StagePolicyEditor';
import {supabase} from '@/lib/supabase';
import {GAME_DATA_REFRESH_EVENT} from './useGameTableSync';
import GovernmentFormationWorkspace from './GovernmentFormationWorkspace';
import InstitutionStaffingLab from './InstitutionStaffingLab';
import StateProgramLab from './StateProgramLab';
import GovernmentProgramSessionLab from './GovernmentProgramSessionLab';
import LegislativeSessionLab from './LegislativeSessionLab';
import BudgetView from './BudgetView';
import MunicipalGovernancePanel from './MunicipalGovernancePanel';
import MunicipalProjectLab from './MunicipalProjectLab';
import CrisisRoom from './CrisisRoom';
import SystemDebriefLab from './SystemDebriefLab';
import InstitutionRegistrationPanel from './InstitutionRegistrationPanel';
import ElectoralArchitectureLab from './ElectoralArchitectureLab';
import DumaLeadershipElection from './DumaLeadershipElection';
import GhostPolicyLab from './GhostPolicyLab';
import PresidentialSystemDecisionPanel from './PresidentialSystemDecisionPanel';
import PresidentialElectionLab from './PresidentialElectionLab';
import PresidentialElectionStage7 from './PresidentialElectionStage7';

// User-facing labels are separate from stable Supabase consequence identifiers.
function formatStageConsequence(type:string,magnitude:number|null):string{
 const label=CONSEQUENCE_OPTIONS.find(option=>option.value===type)?.label||'Иное последствие';
 if(magnitude==null||!Number.isFinite(Number(magnitude)))return label;
 const value=Number(magnitude),number=value.toLocaleString('ru-RU');
 if(type==='representation_loss'||type==='regional_seat_loss'){
  const abs=Math.abs(value);
  const unit=!Number.isInteger(abs)?'места':abs%100>=11&&abs%100<=14?'мест':abs%10===1?'место':abs%10>=2&&abs%10<=4?'места':'мест';
  return label+' — '+number+' '+unit;
 }
 if(type==='ghost_risk')return label+' — +'+number+' к весу риска';
 if(type==='presidential_rating_loss')return label+' — на '+number+' п. п.';
 return label+' — '+number;
}

type Tab='work'|'rules'|'materials'|'check'|'settings';
type Props={g:ReturnTypeRepublic;stage:Stage;readOnly?:boolean;onBack:()=>void;onOpenStage?:(no:number)=>void;onOpenVotes:(id?:string)=>void;onOpenDocument?:(id:string)=>void;onCreateDocument?:(key:string,no:number)=>void;onNavigate?:(view:View)=>void};
const VIEW_NAMES:Partial<Record<View,string>>={parties:'Партии и фракции',votes:'Голосования',documents:'Реестр НПА',budget:'Бюджет',events:'События',grades:'Журнал оценок',actions:'Политический процесс',profile:'Профиль'};
const BODIES:Partial<Record<number,string[]>>={2:['ksrf'],3:['ksrf'],4:['gd'],5:['gd'],6:['gd'],11:['government'],12:['gd','committee'],13:['gd','committee','sf'],14:['municipality']};

export default function GovernanceStageWorkspace({g,stage,readOnly=false,onBack,onOpenStage,onOpenVotes,onOpenDocument,onCreateDocument,onNavigate}:Props){
 const [tab,setTab]=useState<Tab>('work');
 const [sessionGate,setSessionGate]=useState<{stage:number;ready:boolean}|null>(null);
 const onMeetingReadyChange=useCallback((ready:boolean)=>{
  setSessionGate(old=>old?.stage===stage.stage_no&&old.ready===ready?old:{stage:stage.stage_no,ready});
 },[stage.stage_no]);
 const [liveRule,setLiveRule]=useState<{deadline_at:string|null;inclusive:boolean;penalty_points:number;penalty_description:string;consequence_type:string;consequence_magnitude:number|null}|null>(null);
 useEffect(()=>{
  if(!g.game)return;
  const gameId=g.game.id;let active=true;
  async function load(){
   const {data,error}=await supabase.from('stage_deadline_rules')
    .select('deadline_at,inclusive,penalty_points,penalty_description,consequence_type,consequence_magnitude')
    .eq('game_id',gameId).eq('stage_no',stage.stage_no).maybeSingle();
   if(active&&!error)setLiveRule(data||null);
  }
  const update=(e:Event)=>{
   const detail=(e as CustomEvent<{gameId?:string;stageNo?:number}>).detail;
   if(detail?.gameId===gameId&&(detail.stageNo===undefined||detail.stageNo===stage.stage_no))void load();
  };
  void load();
  window.addEventListener(GAME_DATA_REFRESH_EVENT,update);
  window.addEventListener('gos-stage-policy-updated',update);
  return()=>{active=false;window.removeEventListener(GAME_DATA_REFRESH_EVENT,update);window.removeEventListener('gos-stage-policy-updated',update)};
 },[g.game?.id,stage.stage_no,stage.deadline]);
 const operation=STAGE_OPERATIONS[stage.stage_no],detail=STAGE_DETAILS[stage.stage_no],phase=gamePhaseForStage(stage.stage_no);
 const docs=g.formalDocuments.filter(d=>d.stage_no===stage.stage_no);
 const votes=g.votes.filter(v=>v.stage_no===stage.stage_no);
 const openVotes=votes.filter(v=>v.status==='open');
 const publicChannel=g.channels.find(c=>c.kind==='public'&&c.name!=='Вне игры');
 const bodies=BODIES[stage.stage_no];
 const teacher=g.teacher&&!readOnly;
 const stageLocked=!isStageWorkOpen(g.game,stage);
 const viewer=readOnly||g.me?.kind==='observer'||(stageLocked&&!teacher);
 const ksrfSessionBlocked=(stage.stage_no===2||stage.stage_no===3)&&!teacher&&
  !(sessionGate?.stage===stage.stage_no&&sessionGate.ready);
 useEffect(()=>{if(!teacher&&tab==='settings')setTab('work')},[teacher,tab]);
 const tabs:{id:Tab;title:string;icon:typeof Route;count?:number}[]=[
  {id:'work',title:'Работа',icon:Landmark},
  {id:'rules',title:'Маршрут и правила',icon:Route},
  {id:'materials',title:'Материалы',icon:FileText,count:docs.length+votes.length},
  {id:'check',title:'Проверка',icon:ClipboardCheck},
  ...(teacher?[{id:'settings' as const,title:'Настройки',icon:Settings2}]:[])
 ];
 function chat(){if(publicChannel){g.setChannelId(publicChannel.id);g.setChatOpen(true)}}
 const sectionId='governance-stage-'+stage.stage_no;
 return <div className="stageOperations" data-stage={stage.stage_no} style={{'--stage-phase-accent':phase.accent} as CSSProperties}>
  <header className="stageOperationsHeader">
   <div className="stageOperationsBreadcrumb"><button type="button" onClick={onBack}><ArrowLeft size={18}/><span>Все этапы</span></button><span>{phase.short}</span><span className={'stageOperationsStatus is-'+stage.status}>{stageWorkLabel(g.game,stage)}</span></div>
   <div className="stageOperationsTitle"><span className="stageOperationsNumber">{String(stage.stage_no).padStart(2,'0')}</span><div><h1>{operation.title}</h1><p>{operation.action}</p></div></div>
   <div className="stageOperationsMeta">
    <span><CalendarClock size={17}/>{stage.deadline?'До '+formatDeadline(stage.deadline):'Срок не установлен'}</span>
    {publicChannel&&<button type="button" onClick={chat}><MessageCircle size={17}/>Обсудить</button>}
   </div>
  </header>

  <nav className="stageOperationsTabs" aria-label={'Разделы этапа '+stage.stage_no}>
   {tabs.map(({id,title,icon:Icon,count})=><button type="button" key={id} aria-current={tab===id?'page':undefined} aria-controls={sectionId+'-'+id} onClick={()=>setTab(id)}><Icon size={18}/><span>{title}</span>{count!==undefined&&<b>{count}</b>}</button>)}
  </nav>

  <section id={sectionId+'-work'} className="stageOperationsPane" hidden={tab!=='work'} aria-label="Рабочие процедуры">
   <div className="stageOperationsHandoff"><div><small>Основание</small><span>{operation.input}</span></div><ChevronRight size={18} aria-hidden="true"/><div><small>Результат этапа</small><span>{operation.output}</span></div></div>
   {viewer&&<p className="stageOperationsNotice" role="status">{readOnly?'Просмотр участника. Изменение данных отключено.':g.me?.kind==='observer'?'Гостевой просмотр. Рабочие действия доступны назначенным участникам.':stageLocked?'Этап завершён или ещё не открыт. Изменение данных недоступно до решения преподавателя.':''}</p>}
   {bodies&&<div className="stageOperationsRegistration"><InstitutionRegistrationPanel g={g} readOnly={stage.stage_no===2||stage.stage_no===3?readOnly||g.me?.kind==='observer':viewer} stageNo={stage.stage_no} initialBody={bodies[0]} allowedBodies={bodies} onOpenDocument={onOpenDocument} onMeetingReadyChange={onMeetingReadyChange}/></div>}
   {ksrfSessionBlocked&&!viewer&&<p className="stageOperationsNotice" role="status">Действия КСРФ станут доступны после утверждения повестки и вашей регистрации на заседание. Сначала выполните эти действия в блоке выше.</p>}
   <fieldset className="stageOperationsControls" disabled={viewer||ksrfSessionBlocked}>
    <legend className="srOnly">Действия этапа {stage.stage_no}</legend>
    <div className="stageOperationsModules">
     {stage.stage_no===1&&<section className="stageOperationsFoundation"><h2>Создание и регистрация партии</h2><p>Название, идеология, программа, устав, символика и регистрационные документы заполняются в разделе «Партии и фракции». Минюст проверяет пакет; замечания и итог регистрации доступны участникам.</p><div className="stageOperationsPartyList">{g.parties.map(p=><article key={p.id}><strong>{p.name}</strong><span>{p.registration_status==='registered'?'Зарегистрирована':p.registration_status==='submitted'?'На проверке':p.registration_status==='revision'?'Нужна доработка':p.registration_status==='rejected'?'Отклонена':'Черновик'}</span></article>)}</div>{!g.parties.length&&<p>Партии пока не созданы.</p>}<button type="button" className="primary" disabled={!onNavigate} onClick={()=>onNavigate?.('parties')}>Открыть партии и регистрационные пакеты</button></section>}
     {(stage.stage_no===2||stage.stage_no===3)&&<ElectoralArchitectureLab g={g} stageNo={stage.stage_no as 2|3} onOpenVotes={onOpenVotes}/>}
     {stage.stage_no===4&&<><DumaLeadershipElection g={g}/><InstitutionStaffingLab g={g} mode="committees"/></>}
     {stage.stage_no===5&&<GhostPolicyLab g={g} onOpenVotes={onOpenVotes}/>}
     {stage.stage_no===6&&<><PresidentialSystemDecisionPanel g={g} stageNo={6} onOpenVotes={onOpenVotes} onNavigate={onNavigate} onOpenDocument={onOpenDocument}/><PresidentialElectionLab g={g}/></>}
     {stage.stage_no===7&&<><PresidentialSystemDecisionPanel g={g} stageNo={7} onOpenVotes={onOpenVotes} onNavigate={onNavigate} onOpenDocument={onOpenDocument}/><PresidentialElectionStage7 g={g}/></>}
     {stage.stage_no===8&&<GovernmentFormationWorkspace g={g} stageNo={8} onOpenVotes={onOpenVotes} onOpenStage={onOpenStage} onOpenDocument={onOpenDocument} onNavigate={onNavigate}/>}
     {stage.stage_no===9&&<><GovernmentFormationWorkspace g={g} stageNo={9} onOpenVotes={onOpenVotes} onOpenStage={onOpenStage} onOpenDocument={onOpenDocument} onNavigate={onNavigate}/><section id="ministry-teams" className="stageOperationsMinistryTeams"><InstitutionStaffingLab g={g} mode="ministries"/></section></>}
     {stage.stage_no===10&&<StateProgramLab g={g}/>}
     {stage.stage_no===11&&<GovernmentProgramSessionLab g={g} onOpenVotes={onOpenVotes} onOpenDocument={onOpenDocument}/>}
     {stage.stage_no===12&&<><div className="stageOperationsActionBar"><p>Сначала подготовьте законопроект и материалы досье, затем включите документ в повестку.</p><button type="button" className="primary" onClick={()=>setTab('materials')}><FileText size={17}/>Подготовить документы</button></div><LegislativeSessionLab g={g} onOpenVotes={onOpenVotes} onOpenDocument={onOpenDocument}/></>}
     {stage.stage_no===13&&<BudgetView g={g} readOnly={viewer} onOpenDocument={id=>onOpenDocument?.(id)} onOpenEvents={()=>onNavigate?.('events')} onOpenVotes={onOpenVotes}/>}
     {stage.stage_no===14&&<><MunicipalGovernancePanel g={g}/><MunicipalProjectLab g={g}/></>}
     {stage.stage_no===15&&<CrisisRoom g={g}/>}
     {stage.stage_no===16&&<SystemDebriefLab g={g}/>}
    </div>
   </fieldset>
   <footer className="stageOperationsWorkFooter"><span><ClipboardCheck size={18}/>Проверка учитывает сохранённые результаты процедур</span><button type="button" className="secondary" onClick={()=>setTab('check')}>Проверить завершение</button></footer>
  </section>

  <section id={sectionId+'-rules'} className="stageOperationsPane" hidden={tab!=='rules'} aria-label="Маршрут и правила">
   <div className="stageOperationsRuleIntro"><h2>Порядок работы</h2><p>{detail.goal}</p><p><b>Участники: </b>{operation.participants}</p></div>
   <section className="stageOperationsRuleIntro" aria-label="Действующие правила этапа"><h3>Установленные преподавателем сроки и последствия</h3><p><b>Статус:</b> {stageWorkLabel(g.game,stage)}</p><p><b>Срок:</b> {stage.deadline?formatDeadline(stage.deadline):'Преподаватель не установил'}</p>{liveRule&&<><p><b>Правило:</b> {liveRule.inclusive?'До указанного времени включительно':'Строго до указанного времени'}</p><p><b>Штраф:</b> {liveRule.penalty_points||0} баллов. {liveRule.penalty_description}</p>{liveRule.consequence_type!=='none'&&<p><b>Последствие:</b> {formatStageConsequence(liveRule.consequence_type,liveRule.consequence_magnitude)}</p>}</>}</section>
   <ol className="stageOperationsRoute">{detail.steps.map((step,i)=><li key={step}><span>{i+1}</span><p>{step}</p></li>)}</ol>
   <div className="stageOperationsRuleColumns"><section><h3>Процедура</h3><ul>{detail.procedure.map(text=><li key={text}>{text}</li>)}</ul></section><section><h3>Контрольные результаты</h3><ul className="stageOperationsOutputs">{detail.outputs.map(text=><li key={text}><CheckCircle2 size={17}/><span>{text}</span></li>)}</ul></section></div>
   <section className="stageOperationsLegal"><ScaleLabel/><p>{operation.legalNote}</p>{detail.notes.map(note=><p key={note}>{note}</p>)}</section>
   <div className="stageOperationsSources">{detail.sources?.map(source=><a key={source.url} href={source.url} target="_blank" rel="noreferrer"><BookOpenText size={18}/><span>{source.label}</span></a>)}{detail.rulesUrl&&<a href={detail.rulesUrl} target="_blank" rel="noreferrer"><Route size={18}/><span>{detail.rulesSection||'Правила игры'}</span></a>}</div>
  </section>

  <section id={sectionId+'-materials'} className="stageOperationsPane" hidden={tab!=='materials'} aria-label="Документы и голосования">
   <StageArtifacts g={g} stage={stage} readOnly={viewer} onOpenDocument={onOpenDocument} onCreateDocument={onCreateDocument} onNavigate={onNavigate} onOpenVotes={onOpenVotes}/>
   <div className="stageOperationsRelated"><h3><Link2 size={18}/>Связанные разделы</h3><div>{operation.related.map(view=><button type="button" key={view} disabled={!onNavigate} onClick={()=>onNavigate?.(view)}>{VIEW_NAMES[view]||'Раздел игры'}</button>)}</div></div>
  </section>

  <section id={sectionId+'-check'} className="stageOperationsPane" hidden={tab!=='check'} aria-label="Проверка завершения">
   <div className="stageOperationsCheckSummary"><span><FileText size={18}/>{docs.length} документов</span><span><Vote size={18}/>{openVotes.length} открытых голосований</span></div>
   <StageReadinessPanel g={g} stageNo={stage.stage_no} readOnly={viewer} rulesUrl={detail.rulesUrl} rulesLabel="Правила этапа"/>
   {teacher&&<button type="button" className="secondary stageOperationsSettingsLink" onClick={()=>setTab('settings')}>Настроить сроки и оценивание</button>}
  </section>

  {teacher&&<section id={sectionId+'-settings'} className="stageOperationsPane" hidden={tab!=='settings'} aria-label="Настройки преподавателя"><div className="stageOperationsRuleIntro"><h2>Управление этапом</h2><p>Сроки и правила оценивания общие с разделом «Управление».</p></div><StagePolicyEditor g={g} stageNo={stage.stage_no}/>{stage.status!=='open'&&<button type="button" className="primary" onClick={()=>void g.openStage(stage.stage_no)}>Открыть этап {stage.stage_no}</button>}</section>}

  <nav className="stageOperationsPager" aria-label="Переход между этапами"><button type="button" disabled={stage.stage_no===1||!onOpenStage} onClick={()=>onOpenStage?.(stage.stage_no-1)}><ChevronLeft size={18}/><span>{stage.stage_no===1?'Начало':'Этап '+(stage.stage_no-1)}</span></button><button type="button" onClick={onBack}>Карта игры</button><button type="button" disabled={stage.stage_no===16||!onOpenStage} onClick={()=>onOpenStage?.(stage.stage_no+1)}><span>{stage.stage_no===16?'Финал':'Этап '+(stage.stage_no+1)}</span><ChevronRight size={18}/></button></nav>
 </div>;
}

function ScaleLabel(){return <h3><Landmark size={18}/>Правовые основания и порядок проведения</h3>}
