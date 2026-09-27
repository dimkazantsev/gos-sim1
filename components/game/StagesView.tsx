'use client';
import {useState,type CSSProperties} from 'react';
import type {ReturnTypeRepublic} from './viewTypes';
import type {Stage} from './types';
import {formatDeadline,stageIcon} from './constants';
import {STAGE_DETAILS} from './stageDetails';
import {GAME_PHASES,STAGE_SYSTEM,gamePhaseForStage} from './stageSystem';
import DeadlineControl from './DeadlineControl';
import PresidentialElectionLab from './PresidentialElectionLab';
import DumaLeadershipElection from './DumaLeadershipElection';
import GovernmentFormationLab from './GovernmentFormationLab';
import StateProgramLab from './StateProgramLab';

export default function StagesView({g,onOpenVotes}:{g:ReturnTypeRepublic;onOpenVotes:()=>void}){
 const {stages,votes,teacher,nextStage,openStage,setStageDeadline}=g;
 const [selected,setSelected]=useState<Stage|null>(null);
 const detail=selected?STAGE_DETAILS[selected.stage_no]:null;
 const current=stages.find(s=>s.status==='open')||stages.find(s=>s.status!=='completed')||stages.at(-1);
 const currentPhase=current?gamePhaseForStage(current.stage_no):GAME_PHASES[0];
 const selectedSystem=selected?STAGE_SYSTEM[selected.stage_no]:null;

 return <>
  <section className="pageHeader">
   <div><small>АРХИТЕКТУРА ИГРЫ</small><h1>16 этапов «Республики Политология»</h1><p>Нажмите на любой этап — откроются полные правила, задачи, результаты и процедура.</p></div>
   {teacher&&<button className="primary" onClick={nextStage}>Открыть следующий этап</button>}
  </section>

  <section className="stagePhaseRail" aria-label="Фазы государственного строительства">
   <div className="stagePhaseIntro"><small>КАРТА ГОСУДАРСТВА</small><b>{currentPhase.title}</b><span>Текущая фаза · этап {current?.stage_no||1} из 16</span></div>
   <div className="stagePhaseTrack">{GAME_PHASES.map(p=>{
    const completed=stages.filter(s=>s.stage_no>=p.range[0]&&s.stage_no<=p.range[1]&&s.status==='completed').length;
    const total=p.range[1]-p.range[0]+1;
    const active=!!current&&current.stage_no>=p.range[0]&&current.stage_no<=p.range[1];
    return <button key={p.id} className={active?'active':''} onClick={()=>{const s=stages.find(x=>x.stage_no===p.range[0]);if(s)setSelected(s)}} style={{'--phase-accent':p.accent} as CSSProperties}>
     <i>{String(p.range[0]).padStart(2,'0')}{p.range[1]!==p.range[0]?'–'+String(p.range[1]).padStart(2,'0'):''}</i>
     <b>{p.short}</b><span>{completed}/{total}</span>
    </button>
   })}</div>
  </section>

  <div className="stageTimeline">
   {stages.map(s=><article
    className={`stageCard stageClickable ${s.status}`}
    key={s.id}
    role="button"
    tabIndex={0}
    onClick={()=>setSelected(s)}
    onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(s)}}}
    aria-label={'Открыть полное описание этапа '+s.stage_no+': '+s.title}
   >
    <div className="stageNo"><i>{stageIcon(s.stage_no)}</i><span>{String(s.stage_no).padStart(2,'0')}</span></div>
    <div className="stageCardBody">
     <small>{s.mode}</small>
     <h3>{s.title}</h3>
     <p>{s.summary}</p>
     <div className="stageMeta">
      <span className={`statusTag ${s.status}`}>{s.status==='open'?'Сейчас':s.status==='completed'?'Завершён':'Закрыт'}</span>
      {s.deadline&&<span className="deadlineTag">до {formatDeadline(s.deadline)}</span>}
      {votes.some(v=>v.stage_no===s.stage_no&&v.status==='open')&&<span className="stageVoteTag">● Есть голосование</span>}
      <span className="stageOpenHint">Подробнее →</span>
     </div>
    </div>
   </article>)}
  </div>

  {selected&&detail&&<div className="stageModalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null)}}>
   <section className="stageDetailPanel" role="dialog" aria-modal="true" aria-labelledby="stage-detail-title">
    <header className="stageDetailHeader">
     <div className="stageDetailBadge">{String(selected.stage_no).padStart(2,'0')}</div>
     <div>
      <small>{selected.mode}</small>
      <h2 id="stage-detail-title">{selected.title}</h2>
      <div className="stageDetailStatus">
       <span className={`statusTag ${selected.status}`}>{selected.status==='open'?'Текущий этап':selected.status==='completed'?'Завершён':'Закрыт'}</span>
       {selected.deadline&&<span className="deadlineTag">Дедлайн: {formatDeadline(selected.deadline)}</span>}
       {votes.filter(v=>v.stage_no===selected.stage_no).length>0&&<span className="stageVoteTag">{votes.filter(v=>v.stage_no===selected.stage_no&&v.status==='open').length?('● Открыто '+votes.filter(v=>v.stage_no===selected.stage_no&&v.status==='open').length):('Голосований: '+votes.filter(v=>v.stage_no===selected.stage_no).length)}</span>}
      </div>
     </div>
     <button className="stageClose" onClick={()=>setSelected(null)} aria-label="Закрыть описание">×</button>
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
      <div className="stageRulesCalloutIcon">?</div>
      <div>
       <small>УТОЧНИТЬ ПО ПРАВИЛАМ</small>
       <h3>{detail.rulesSection||('Этап '+selected.stage_no)}</h3>
       <p>Если нужна формулировка без сокращений, примеры, специальные условия или процедурные детали — откройте соответствующий раздел полного документа правил.</p>
      </div>
      <a href={detail.rulesUrl} target="_blank" rel="noreferrer">Открыть полные правила <span>↗</span></a>
     </section>}

     {votes.some(v=>v.stage_no===selected.stage_no&&v.status==='open')&&<section className="stageVotingLink">
      <div><small>СВЯЗАННОЕ ГОЛОСОВАНИЕ</small><b>По этому этапу сейчас идёт процедурное голосование</b><p>Откройте центр голосований, чтобы увидеть кворум, связанные НПА и результат процедуры.</p></div>
      <button className="primary" onClick={onOpenVotes}>Перейти к голосованию →</button>
     </section>}

     <DeadlineControl g={g} stageNo={selected.stage_no}/>

     {selected.stage_no===4&&<DumaLeadershipElection g={g}/>} 

     {(selected.stage_no===6||selected.stage_no===7)&&<PresidentialElectionLab g={g}/>} 

     {selected.stage_no===8&&<GovernmentFormationLab g={g}/>} 

     {(selected.stage_no===10||selected.stage_no===11)&&<StateProgramLab g={g}/>} 

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
 </>;
}
