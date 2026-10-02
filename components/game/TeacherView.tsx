'use client';
import {useMemo,useState} from 'react';
import {Award,Activity,AlertTriangle,ArrowRight,BarChart3,BookOpenText,Clock3,Download,GraduationCap,Network,Pause,Play,Radio,RotateCcw,UsersRound,Wrench,Zap} from 'lucide-react';
import ClassroomJournal from './ClassroomJournal';
import ParticipantsAnalytics from './ParticipantsAnalytics';
import TeacherStageManager from './TeacherStageManager';
import TeacherPartyDossiers from './TeacherPartyDossiers';
import TeacherGhostVotingPanel from './TeacherGhostVotingPanel';
import EventWorkspace from './EventWorkspace';
import type {ReturnTypeRepublic} from './viewTypes';
import ImpactRulesPanel from './ImpactRulesPanel';
import GradesView from './GradesView';
import TeacherAwards from './TeacherAwards';
import {useSavedGameState,savedChoice} from './useSavedGameState';
import {useHorizontalWheel} from './useHorizontalWheel';

function timerText(seconds:number){
 const m=Math.floor(seconds/60),s=seconds%60;
 return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}

type Workspace='overview'|'stages'|'journal'|'analytics'|'grades'|'impact'|'parties'|'tools'|'event'|'awards';
const WORKSPACES=[
 {key:'overview',title:'Обзор',icon:Activity},
 {key:'stages',title:'Этапы',icon:BookOpenText},
 {key:'journal',title:'Журнал',icon:UsersRound},
 {key:'analytics',title:'Аналитика',icon:BarChart3},
 {key:'grades',title:'Оценки',icon:GraduationCap},
 {key:'impact',title:'Модель последствий',icon:Network},
 {key:'parties',title:'Фракции',icon:UsersRound},
 {key:'tools',title:'Инструменты',icon:Wrench},
 {key:'event',title:'Event',icon:BookOpenText},
 {key:'awards',title:'Награды',icon:Award}
] as const;

export default function TeacherView({g,onOpenProcesses,onOpenStages,initialWorkspace='overview',onOpenChat}:{g:ReturnTypeRepublic;onOpenProcesses:()=>void;onOpenStages:(stageNo:number)=>void;initialWorkspace?:Workspace;onOpenChat?:(channelId:string)=>void}){
 const {game,currentStage,members,parties,partyMandates,partyInvitations,metrics,metricHistory,politicalPosts,formalDocuments,votes,ballots,evaluations,activities,presence,names,secondsLeft,nextStage,setTurn,setTurnMinutes,publishEvent,triggerCrisis,ghostVoting,clearPartyGhostLoss,updateMember,updateMetric}=g;

 const [workspace,setWorkspace]=useSavedGameState<Workspace>(g.game?.id,g.me?.user_id,'teacher-workspace',initialWorkspace,savedChoice(...WORKSPACES.map(w=>w.key)));
 const navigationRef=useHorizontalWheel(game?.id);

 const studentIds=useMemo(()=>new Set(members.filter(m=>m.kind!=='teacher').map(m=>m.user_id)),[members]);
 const studentActivities=useMemo(()=>activities.filter(a=>studentIds.has(a.actor_id)),[activities,studentIds]);


 if(!game)return null;
 const onlineCount=members.filter(m=>m.kind==='student'&&presence.some(p=>p.user_id===m.user_id&&Date.now()-new Date(p.last_seen_at).getTime()<90000)).length;


 function confirmNext(){if(window.confirm('Перейти к следующему этапу? Проверьте индикатор процедурной готовности выше: переход остаётся ручным и может быть выполнен даже при незавершённых процедурах.'))void nextStage()}
 function confirmCrisis(){if(window.confirm('Разыграть случайный кризис для всей аудитории?'))void triggerCrisis()}
 function confirmGhost(){if(window.confirm('Запустить ghost voting?'))void ghostVoting()}
 function exportSession(){
  const rows=[['Время','Участник','Тип','Действие','Раздел']];
  for(const a of [...activities].reverse())rows.push([new Date(a.created_at).toLocaleString('ru-RU'),names[a.actor_id]||a.actor_id,a.event_type,a.label,a.view_key||'']);
  const csv=rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='gos-sims-activity-'+new Date().toISOString().slice(0,10)+'.csv';a.click();URL.revokeObjectURL(url);
 }

 return <div className="teacherSimple teacherCommand">
  <section className="teacherWorkspace" aria-label="Рабочие разделы управления">
   <div ref={navigationRef} className="teacherWorkspaceNav" role="tablist" aria-label="Рабочие разделы преподавателя">
    {WORKSPACES.map(item=>{
     const Icon=item.icon;
     return <button key={item.key} type="button" role="tab" id={'teacher-tab-'+item.key}
      aria-controls="teacher-workspace-panel" aria-selected={workspace===item.key} tabIndex={workspace===item.key?0:-1}
      className={workspace===item.key?'active':''} onClick={()=>setWorkspace(item.key)}
      onKeyDown={event=>{
       if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
       event.preventDefault();
       const index=WORKSPACES.findIndex(entry=>entry.key===item.key);
       const nextIndex=event.key==='Home'?0:event.key==='End'?WORKSPACES.length-1:
        (index+(event.key==='ArrowRight'?1:-1)+WORKSPACES.length)%WORKSPACES.length;
       const next=WORKSPACES[nextIndex];setWorkspace(next.key);
       document.getElementById('teacher-tab-'+next.key)?.focus();
      }}>
      <Icon size={18} strokeWidth={1.9} aria-hidden="true"/><span>{item.title}</span>
     </button>
    })}
   </div>
   <section className="teacherCommandBar" aria-label="Быстрое управление игрой">
   <div className="teacherCommandStage">
    <span className="teacherEyebrow">ПУЛЬТ ПРЕПОДАВАТЕЛЯ</span>
    <div className="teacherCommandStageLine">
     <span className="teacherCommandStageNo">{String(currentStage?.stage_no||game.current_round||1).padStart(2,'0')}</span>
     <div>
      <small>ТЕКУЩИЙ ЭТАП</small>
      <h1>{currentStage?.title||'Подготовка игры'}</h1>
     </div>
    </div>
   </div>
   <div className="teacherCommandClock">
    <span className={game.turn_open?'teacherTurnBadge isOpen':'teacherTurnBadge isPaused'}>{game.turn_open?'ХОД ОТКРЫТ':'ПАУЗА'}</span>
    <strong>{game.turn_open&&game.turn_ends_at?timerText(secondsLeft):'—'}</strong>
   </div>
   <div className="teacherQuickActions">
    <button type="button" className={game.turn_open?'teacherQuick danger':'teacherQuick primary'} onClick={()=>setTurn(!game.turn_open)}>
     <span>{game.turn_open?<Pause size={18} strokeWidth={2} aria-hidden="true"/>:<Play size={18} strokeWidth={2} aria-hidden="true"/>}</span>
     <b>{game.turn_open?'Пауза':'Открыть ход'}</b>
    </button>
    <button type="button" className="teacherQuick" onClick={onOpenProcesses}>
     <span><Radio size={18} strokeWidth={2} aria-hidden="true"/></span><b>Политический процесс</b>
    </button>
    <button type="button" className="teacherQuick" onClick={confirmNext}>
     <span><ArrowRight size={18} strokeWidth={2} aria-hidden="true"/></span><b>Следующий этап</b>
    </button>
   </div>
  </section>
   <div className="teacherWorkspacePanel" id="teacher-workspace-panel" role="tabpanel" aria-labelledby={'teacher-tab-'+workspace} tabIndex={0}>
    {workspace==='overview'&&<>
     <div className="teacherOverviewStats">
      <article><small>В ИГРЕ СЕЙЧАС</small><strong>{onlineCount}</strong><span>из {members.filter(m=>m.kind==='student').length} студентов онлайн</span></article>
      <article><small>ОТКРЫТЫЕ ГОЛОСОВАНИЯ</small><strong>{votes.filter(v=>v.status==='open').length}</strong><span>{votes.some(v=>v.status==='open')?'процедуры сейчас открыты':'открытых процедур нет'}</span></article>
      <article><small>АКТИВНОСТЬ</small><strong>{studentActivities.length}</strong><span>событий в загруженной ленте</span></article>
      <article><small>ГОТОВНОСТЬ</small><strong>{g.stages.filter(s=>s.status==='completed').length}/{g.stages.length}</strong><span>этапов завершено</span></article>
     </div>
    </>}

    {workspace==='stages'&&<TeacherStageManager g={g} onOpenStage={onOpenStages}/>}
    {workspace==='journal'&&<ClassroomJournal g={g}/>}

    {workspace==='analytics'&&<section className="teacherAnalytics surface">
   <div className="surfaceHead"><div><small>АНАЛИТИКА ИГРЫ</small><h2>Общая статистика и вклад участников</h2></div><span>{members.filter(m=>m.kind==='student').length} студентов</span></div>
   <div className="teacherAnalyticsCards">
    <div><small>ПУБЛИКАЦИИ</small><strong>{politicalPosts.length}</strong><span>политических процессов</span></div>
    <div><small>ПАРТИИ</small><strong>{parties.length}</strong><span>политических организаций в игре</span></div>
    <div><small>НПА</small><strong>{formalDocuments.length}</strong><span>в реестре</span></div>
    <div><small>ГОЛОСОВАНИЯ</small><strong>{votes.length}</strong><span>{votes.filter(v=>v.status==='open').length} открыто</span></div>
    <div><small>ИЗМЕНЕНИЯ KPI</small><strong>{metricHistory.filter(h=>h.source_type!=='baseline').length}</strong><span>зафиксированных изменений</span></div>
   </div>
   <ParticipantsAnalytics g={g}/>
  </section>}

    {workspace==='grades'&&<GradesView g={g}/>}
    {workspace==='awards'&&<TeacherAwards g={g}/>}
    {workspace==='impact'&&<ImpactRulesPanel g={g}/>}

    {workspace==='parties'&&<TeacherPartyDossiers g={g} onOpenChat={onOpenChat}/>}

    {workspace==='tools'&&<>
    <details className="teacherDetails" open>
   <summary><div><b>Быстрые инструменты</b><span>Таймер, кризис и Ghost Voting; публикации доступны в политических процессах</span></div><i>+</i></summary>
   <div className="teacherDetailsBody">
    <div className="directorButtons compact">
     {[10,20,30,60].map(n=><button key={n} onClick={()=>setTurnMinutes(n)}><span><Clock3 size={21} strokeWidth={1.8}/></span><b>Ход на {n} минут</b></button>)}
     <button className="dangerQuick" onClick={confirmCrisis}><span><AlertTriangle size={22} strokeWidth={1.8}/></span><b>Разыграть кризис</b></button>
     <button onClick={confirmGhost}><span><Zap size={22} strokeWidth={1.8}/></span><b>Случайное Ghost Voting</b></button>
     {parties.some(p=>p.ghost_active)&&<button onClick={()=>{if(confirm('Завершить ближайшее заседание ГД и восстановить полный состав всех фракций?'))void clearPartyGhostLoss()}}><span><RotateCcw size={22} strokeWidth={1.8}/></span><b>Завершить заседание ГД · снять GV</b></button>}
     <button onClick={exportSession}><span><Download size={22} strokeWidth={1.8}/></span><b>Экспорт журнала</b></button>
    </div>
    <TeacherGhostVotingPanel g={g}/>

   </div>
  </details>

  <details className="teacherDetails">
   <summary><div><b>Игровые роли</b><span>Назначение должностей участникам; ручная корректировка рейтингов находится в модели последствий</span></div><i>+</i></summary>
   <div className="teacherDetailsBody split">
    
    <div><h3>Игровые роли</h3><div className="evaluationRows">{members.filter(m=>m.kind!=='teacher').map(m=><div key={m.user_id}><div className="studentIdentity"><b>{m.full_name}</b><input key={m.user_id+(m.role_title||'')} defaultValue={m.role_title||''} onBlur={e=>updateMember(m.user_id,{role_title:e.target.value})} aria-label="Игровая роль участника" placeholder="Игровая роль"/></div></div>)}</div></div>
   </div>
  </details>
    </>}
    {workspace==='event'&&<EventWorkspace g={g} mode="manage"/>}
   </div>
  </section>
 </div>;
}
