'use client';
import {useMemo,useState} from 'react';
import {Activity,ArrowRight,BarChart3,BookOpenText,GraduationCap,Network,Pause,Play,Radio,UsersRound,Wrench} from 'lucide-react';
import ClassroomJournal from './ClassroomJournal';
import ParticipantsAnalytics from './ParticipantsAnalytics';
import TeacherStageManager from './TeacherStageManager';
import type {ReturnTypeRepublic} from './viewTypes';
import ImpactRulesPanel from './ImpactRulesPanel';
import GradesView from './GradesView';

function timerText(seconds:number){
 const m=Math.floor(seconds/60),s=seconds%60;
 return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}

type Workspace='overview'|'stages'|'journal'|'analytics'|'grades'|'impact'|'parties'|'tools';
const WORKSPACES=[
 {key:'overview',title:'Обзор',icon:Activity},
 {key:'stages',title:'Этапы',icon:BookOpenText},
 {key:'journal',title:'Журнал',icon:UsersRound},
 {key:'analytics',title:'Аналитика',icon:BarChart3},
 {key:'grades',title:'Оценки',icon:GraduationCap},
 {key:'impact',title:'Модель последствий',icon:Network},
 {key:'parties',title:'Фракции',icon:UsersRound},
 {key:'tools',title:'Инструменты',icon:Wrench}
] as const;

export default function TeacherView({g,onOpenProcesses,onOpenStages}:{g:ReturnTypeRepublic;onOpenProcesses:()=>void;onOpenStages:(stageNo:number)=>void}){
 const {game,currentStage,members,parties,partyMandates,partyInvitations,metrics,metricHistory,politicalPosts,politicalDecisions,formalDocuments,votes,ballots,evaluations,actions,activities,presence,names,secondsLeft,nextStage,setTurn,setTurnMinutes,publishEvent,triggerCrisis,ghostVoting,clearPartyGhostLoss,updateMember,updateMetric}=g;
 const [eventTitle,setEventTitle]=useState(''),[eventBody,setEventBody]=useState('');
 const [workspace,setWorkspace]=useState<Workspace>('overview');

 const studentIds=useMemo(()=>new Set(members.filter(m=>m.kind!=='teacher').map(m=>m.user_id)),[members]);
 const studentActivities=useMemo(()=>activities.filter(a=>studentIds.has(a.actor_id)),[activities,studentIds]);


 if(!game)return null;
 const pending=actions.filter(a=>a.status==='submitted');
 const onlineCount=members.filter(m=>m.kind==='student'&&presence.some(p=>p.user_id===m.user_id&&Date.now()-new Date(p.last_seen_at).getTime()<90000)).length;

 async function publish(){if(await publishEvent(eventTitle,eventBody)){setEventTitle('');setEventBody('')}}
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
   <div className="teacherWorkspaceNav" role="tablist" aria-label="Рабочие разделы преподавателя">
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
      {item.key==='overview'&&pending.length>0&&<em>{pending.length}</em>}
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
     <span><Radio size={18} strokeWidth={2} aria-hidden="true"/></span><b>Процессы</b>
    </button>
    <button type="button" className="teacherQuick" onClick={confirmNext}>
     <span><ArrowRight size={18} strokeWidth={2} aria-hidden="true"/></span><b>Следующий этап</b>
    </button>
   </div>
  </section>
   <div className="teacherWorkspacePanel" id="teacher-workspace-panel" role="tabpanel" aria-labelledby={'teacher-tab-'+workspace} tabIndex={0}>
    {workspace==='overview'&&<>



     <div className="teacherOverviewQuick">
      <button type="button" onClick={()=>setWorkspace('stages')}>Управление этапами <ArrowRight size={16} aria-hidden="true"/></button>
      <button type="button" onClick={()=>setWorkspace('journal')}>Журнал аудитории <ArrowRight size={16} aria-hidden="true"/></button>
     </div>

    </>}

    {workspace==='stages'&&<TeacherStageManager g={g} onOpenStage={onOpenStages}/>}
    {workspace==='journal'&&<ClassroomJournal g={g}/>}

    {workspace==='analytics'&&<section className="teacherAnalytics surface">
   <div className="surfaceHead"><div><small>АНАЛИТИКА ИГРЫ</small><h2>Общая статистика и вклад участников</h2></div><span>{members.filter(m=>m.kind==='student').length} студентов</span></div>
   <div className="teacherAnalyticsCards">
    <div><small>ПУБЛИКАЦИИ</small><strong>{politicalPosts.length}</strong><span>политических процессов</span></div>
    <div><small>РЕШЕНИЯ</small><strong>{politicalDecisions.length}</strong><span>принято и зарегистрировано</span></div>
    <div><small>НПА</small><strong>{formalDocuments.length}</strong><span>в реестре</span></div>
    <div><small>ГОЛОСОВАНИЯ</small><strong>{votes.length}</strong><span>{votes.filter(v=>v.status==='open').length} открыто</span></div>
    <div><small>ИЗМЕНЕНИЯ KPI</small><strong>{metricHistory.filter(h=>h.source_type!=='baseline').length}</strong><span>зафиксированных изменений</span></div>
   </div>
   <ParticipantsAnalytics g={g}/>
  </section>}

    {workspace==='grades'&&<GradesView g={g}/>}
    {workspace==='impact'&&<ImpactRulesPanel g={g}/>}

    {workspace==='parties'&&<>
    <section className="surface teacherRepresentation">
   <div className="surfaceHead"><div><small>ПРЕДСТАВИТЕЛЬСТВО В ГД</small><h2>Фракции, студенты и мандаты</h2></div><span>{parties.reduce((a,p)=>a+Number(p.mandates||0),0)}/450</span></div>
   <div className="teacherPartyMatrix">
    {parties.length===0?<div className="emptyState">Партии ещё не созданы.</div>:parties.map(p=>{
      const pm=members.filter(m=>m.kind==='student'&&m.team===p.name);
      const leader=members.find(m=>m.user_id===p.leader_user_id);
      const pending=partyInvitations.filter(i=>i.party_id===p.id&&i.status==='pending').length;
      return <article key={p.id}>
       <header><span style={{background:p.color}}>{p.name.slice(0,2).toUpperCase()}</span><div><b>{p.name}</b><small>{leader?'Руководитель: '+leader.full_name:'Руководитель не назначен'}</small></div><strong>{p.mandates}</strong></header>
       <div className="teacherPartyStats"><span>{pm.length} студентов</span><span>{p.ghost_active?('GV −'+p.ghost_loss_current):'GV нет'}</span><span>{pending} приглашений</span><span>{Math.max(0,p.mandates-p.ghost_loss_current)} голосов сейчас</span></div>
       <div className="teacherMandateRows">{pm.map(m=>{const a=partyMandates.find(x=>x.party_id===p.id&&x.user_id===m.user_id);return <div key={m.user_id}><b>{m.full_name}</b><span data-label="Мандаты">{a?.base_mandates||0} манд.</span><em data-label="Потери GV">{a?.ghost_loss?('−'+a.ghost_loss+' GV'):'—'}</em><strong data-label="Доступно">{a?.effective_mandates||0} голосов</strong></div>})}</div>
      </article>
    })}
   </div>
  </section>

  <details className="teacherDetails">
   <summary><div><b>Журнал партийных приглашений</b><span>Вся история формирования фракций: приглашено, принято, отклонено, отменено</span></div><i>+</i></summary>
   <div className="teacherDetailsBody">
    <div className="teacherInviteLog">
     {partyInvitations.length===0?<div className="emptyState">Приглашений пока не было.</div>:partyInvitations.map(inv=>{
      const p=parties.find(x=>x.id===inv.party_id);
      const student=members.find(m=>m.user_id===inv.invited_user_id);
      const sender=members.find(m=>m.user_id===inv.invited_by);
      return <div key={inv.id}>
       <span className={'inviteStatus '+inv.status}>{inv.status==='accepted'?'✓':inv.status==='declined'?'×':inv.status==='cancelled'?'—':'○'}</span>
       <div><b>{student?.full_name||'Студент'}</b><small>{p?.name||'Партия'} · пригласил {sender?.full_name||'участник'}</small></div>
       <em>{inv.status==='pending'?'Ожидает':inv.status==='accepted'?'Принято':inv.status==='declined'?'Отклонено':'Отменено'}</em>
       <time>{new Date(inv.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}{inv.responded_at?' → '+new Date(inv.responded_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):''}</time>
      </div>
     })}
    </div>
   </div>
  </details>
    </>}

    {workspace==='tools'&&<>
    <details className="teacherDetails" open>
   <summary><div><b>Быстрые сценарии и события</b><span>Таймер, кризис, ghost voting, публикация события</span></div><i>+</i></summary>
   <div className="teacherDetailsBody">
    <div className="directorButtons compact">
     {[10,20,30,60].map(n=><button key={n} onClick={()=>setTurnMinutes(n)}><span>{n}:00</span><b>Ход на {n} минут</b></button>)}
     <button className="dangerQuick" onClick={confirmCrisis}><span>⚠</span><b>Разыграть кризис</b></button>
     <button onClick={confirmGhost}><span>⚡</span><b>Ghost voting</b></button>
     {parties.some(p=>p.ghost_active)&&<button onClick={()=>{if(confirm('Завершить ближайшее заседание ГД и восстановить полный состав всех фракций?'))void clearPartyGhostLoss()}}><span>↺</span><b>Завершить заседание ГД · снять GV</b></button>}
     <button onClick={exportSession}><span>⇩</span><b>Экспорт журнала</b></button>
    </div>
    <div className="eventComposer"><input aria-label="Заголовок события" value={eventTitle} onChange={e=>setEventTitle(e.target.value)} placeholder="Заголовок события"/><textarea aria-label="Описание события" rows={4} value={eventBody} onChange={e=>setEventBody(e.target.value)} placeholder="Что произошло?"/><button className="primary" onClick={publish}>Опубликовать всем</button></div>
   </div>
  </details>

  <details className="teacherDetails">
   <summary><div><b>Роли и показатели</b><span>Игровые роли и KPI государства; журнал ВСН расположен выше</span></div><i>+</i></summary>
   <div className="teacherDetailsBody split">
    <div><h3>Показатели государства</h3><div className="metricEditor">{metrics.map(m=><label key={m.id}><span>{m.label}</span><input key={m.id+String(m.value)} type="number" defaultValue={m.value} onBlur={e=>updateMetric(m.id,+e.target.value)}/><em>{m.unit||''}</em></label>)}</div></div>
    <div><h3>Игровые роли</h3><div className="evaluationRows">{members.filter(m=>m.kind!=='teacher').map(m=><div key={m.user_id}><div className="studentIdentity"><b>{m.full_name}</b><input key={m.user_id+(m.role_title||'')} defaultValue={m.role_title||''} onBlur={e=>updateMember(m.user_id,{role_title:e.target.value})} aria-label="Игровая роль участника" placeholder="Игровая роль"/></div></div>)}</div></div>
   </div>
  </details>
    </>}
   </div>
  </section>
 </div>;
}
