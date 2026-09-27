'use client';
import {useMemo,useState} from 'react';
import type {ReturnTypeRepublic} from './viewTypes';
import {VSN_LABEL} from './constants';

const VIEW_NAMES:Record<string,string>={
 dashboard:'Главный экран',stages:'Этапы',parties:'Партии',votes:'Голосования',documents:'Материалы',actions:'Решения',teacher:'Управление',chat:'Связь'
};

function timerText(seconds:number){
 const m=Math.floor(seconds/60),s=seconds%60;
 return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}

export default function TeacherView({g,onOpenScreen}:{g:ReturnTypeRepublic;onOpenScreen:()=>void}){
 const {game,currentStage,members,parties,partyMandates,partyInvitations,metrics,evaluations,actions,activities,presence,names,secondsLeft,nextStage,setTurn,setTurnMinutes,publishEvent,triggerCrisis,ghostVoting,setEvaluation,updateMember,updateMetric}=g;
 const [eventTitle,setEventTitle]=useState(''),[eventBody,setEventBody]=useState('');
 if(!game)return null;

 const studentIds=useMemo(()=>new Set(members.filter(m=>m.kind!=='teacher').map(m=>m.user_id)),[members]);
 const studentActivities=useMemo(()=>activities.filter(a=>studentIds.has(a.actor_id)),[activities,studentIds]);
 const studentRows=useMemo(()=>members.filter(m=>m.kind!=='teacher').map(m=>{
  const p=presence.find(x=>x.user_id===m.user_id);
  const last=studentActivities.find(x=>x.actor_id===m.user_id);
  const online=!!p&&(Date.now()-new Date(p.last_seen_at).getTime()<90000);
  return {m,p,last,online};
 }).sort((a,b)=>Number(b.online)-Number(a.online)||new Date(b.p?.last_seen_at||0).getTime()-new Date(a.p?.last_seen_at||0).getTime()),[members,presence,studentActivities]);

 const pending=actions.filter(a=>a.status==='submitted');
 const onlineCount=studentRows.filter(x=>x.online).length;

 async function publish(){if(await publishEvent(eventTitle,eventBody)){setEventTitle('');setEventBody('')}}
 function confirmNext(){if(window.confirm('Завершить текущий этап и открыть следующий?'))void nextStage()}
 function confirmCrisis(){if(window.confirm('Разыграть случайный кризис для всей аудитории?'))void triggerCrisis()}
 function confirmGhost(){if(window.confirm('Запустить ghost voting?'))void ghostVoting()}
 function exportSession(){
  const rows=[['Время','Участник','Тип','Действие','Раздел']];
  for(const a of [...activities].reverse())rows.push([new Date(a.created_at).toLocaleString('ru-RU'),names[a.actor_id]||a.actor_id,a.event_type,a.label,a.view_key||'']);
  const csv=rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='gos-sim-activity-'+new Date().toISOString().slice(0,10)+'.csv';a.click();URL.revokeObjectURL(url);
 }

 return <div className="teacherSimple">
  <section className="teacherFocus">
   <div className="teacherFocusCopy">
    <small>СЕЙЧАС</small>
    <h1>{currentStage?.stage_no}. {currentStage?.title}</h1>
    <p>{currentStage?.summary||'Управляйте текущим этапом, наблюдайте за действиями студентов и переводите игру дальше только когда аудитория готова.'}</p>
   </div>
   <div className="teacherFocusState">
    <span className={game.turn_open?'bigState on':'bigState off'}>{game.turn_open?'ХОД ОТКРЫТ':'ПАУЗА'}</span>
    <b>{game.turn_open&&game.turn_ends_at?timerText(secondsLeft):'—'}</b>
   </div>
  </section>

  <section className="teacherPrimaryActions">
   <button className={game.turn_open?'teacherAction dangerLite':'teacherAction primaryAction'} onClick={()=>setTurn(!game.turn_open)}>
    <span>{game.turn_open?'Ⅱ':'▶'}</span>
    <div><b>{game.turn_open?'Поставить на паузу':'Открыть ход'}</b><small>{game.turn_open?'Временно остановить действия студентов':'Разрешить студентам выполнять задания'}</small></div>
   </button>
   <button className="teacherAction" onClick={onOpenScreen}>
    <span>▣</span><div><b>Общий экран</b><small>Открыть экран для проектора и аудитории</small></div>
   </button>
   <button className="teacherAction" onClick={confirmNext}>
    <span>→</span><div><b>Следующий этап</b><small>Завершить текущий и перейти дальше</small></div>
   </button>
  </section>

  <section className="teacherPulse">
   <article className="pulseCard"><small>В ИГРЕ СЕЙЧАС</small><strong>{onlineCount}</strong><span>из {studentRows.length} студентов онлайн</span></article>
   <article className="pulseCard"><small>ЖДУТ РЕШЕНИЯ</small><strong>{pending.length}</strong><span>{pending.length?'нужно рассмотреть':'очередь пуста'}</span></article>
   <article className="pulseCard"><small>АКТИВНОСТЬ</small><strong>{studentActivities.length}</strong><span>действий за сессию</span></article>
  </section>

  <section className="teacherSimpleGrid">
   <article className="surface">
    <div className="surfaceHead"><div><small>СТУДЕНТЫ</small><h2>Кто что делает</h2></div><span>{onlineCount} онлайн</span></div>
    <div className="studentLiveList">
     {studentRows.length===0?<div className="emptyState">Студенты ещё не подключились.</div>:studentRows.map(({m,p,last,online})=><div className="studentLiveRow simple" key={m.user_id}>
      <span className={online?'onlineDot':'offlineDot'}/>
      <div className="studentLiveIdentity"><b>{m.full_name}</b><small>{m.team||m.group_name||'Без команды'} · {m.role_title||'роль не назначена'}</small></div>
      <div className="studentNow"><label>Сейчас</label><b>{p?VIEW_NAMES[p.current_view]||p.current_view:'Нет данных'}</b></div>
      <div className="studentLast"><label>Последнее действие</label><b>{last?.label||'—'}</b><small>{last?new Date(last.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):''}</small></div>
     </div>)}
    </div>
   </article>

   <article className="surface">
    <div className="surfaceHead"><div><small>ЛЕНТА</small><h2>Последние действия</h2></div></div>
    <div className="activityFeed simple">
     {studentActivities.length===0?<div className="emptyState">Здесь появятся действия студентов.</div>:studentActivities.slice(0,25).map(a=><div className="activityRow" key={a.id}>
      <time>{new Date(a.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</time>
      <span className="activityAvatar">{(names[a.actor_id]||'?').split(' ').slice(0,2).map(x=>x[0]).join('').toUpperCase()}</span>
      <div><b>{names[a.actor_id]||'Участник'}</b><p>{a.label}</p></div>
     </div>)}
    </div>
   </article>
  </section>

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
       <div className="teacherMandateRows">{pm.map(m=>{const a=partyMandates.find(x=>x.party_id===p.id&&x.user_id===m.user_id);return <div key={m.user_id}><b>{m.full_name}</b><span>{a?.base_mandates||0} манд.</span><em>{a?.ghost_loss?('−'+a.ghost_loss+' GV'):'—'}</em><strong>{a?.effective_mandates||0} голосов</strong></div>})}</div>
      </article>
    })}
   </div>
  </section>

  <details className="teacherDetails">
   <summary><div><b>Быстрые сценарии и события</b><span>Таймер, кризис, ghost voting, публикация события</span></div><i>+</i></summary>
   <div className="teacherDetailsBody">
    <div className="directorButtons compact">
     {[10,20,30,60].map(n=><button key={n} onClick={()=>setTurnMinutes(n)}><span>{n}:00</span><b>Ход на {n} минут</b></button>)}
     <button className="dangerQuick" onClick={confirmCrisis}><span>⚠</span><b>Разыграть кризис</b></button>
     <button onClick={confirmGhost}><span>⚡</span><b>Ghost voting</b></button>
     <button onClick={exportSession}><span>⇩</span><b>Экспорт журнала</b></button>
    </div>
    <div className="eventComposer"><input value={eventTitle} onChange={e=>setEventTitle(e.target.value)} placeholder="Заголовок события"/><textarea rows={4} value={eventBody} onChange={e=>setEventBody(e.target.value)} placeholder="Что произошло?"/><button className="primary" onClick={publish}>Опубликовать всем</button></div>
   </div>
  </details>

  <details className="teacherDetails">
   <summary><div><b>Оценки, роли и показатели</b><span>ВСН, игровые роли и KPI государства</span></div><i>+</i></summary>
   <div className="teacherDetailsBody split">
    <div><h3>Показатели государства</h3><div className="metricEditor">{metrics.map(m=><label key={m.id}><span>{m.label}</span><input key={m.id+String(m.value)} type="number" defaultValue={m.value} onBlur={e=>updateMetric(m.id,+e.target.value)}/><em>{m.unit||''}</em></label>)}</div></div>
    <div><h3>ВСН и роли</h3><div className="evaluationRows">{members.filter(m=>m.kind!=='teacher').map(m=>{const ev=evaluations.find(x=>x.user_id===m.user_id&&x.stage_no===(currentStage?.stage_no||1));return <div key={m.user_id}><div className="studentIdentity"><b>{m.full_name}</b><input key={m.user_id+(m.role_title||'')} defaultValue={m.role_title||''} onBlur={e=>updateMember(m.user_id,{role_title:e.target.value})} placeholder="Игровая роль"/></div><div className="vsnButtons">{[0,1,2,3].map(s=><button key={s} className={ev?.score===s?'active':''} onClick={()=>setEvaluation(m.user_id,s)}><b>{VSN_LABEL[s]}</b><small>{s}</small></button>)}</div></div>})}</div></div>
   </div>
  </details>
 </div>;
}
