'use client';
import {useMemo,useState} from 'react';
import type {ReturnTypeRepublic} from './viewTypes';
import {VSN_LABEL} from './constants';

const VIEW_NAMES:Record<string,string>={
 dashboard:'Главный экран',stages:'Этапы игры',parties:'Партии и фракции',votes:'Голосования',documents:'Документы',actions:'Мои решения',teacher:'Пульт преподавателя',chat:'Связь'
};

function timerText(seconds:number){
 const m=Math.floor(seconds/60),s=seconds%60;
 return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}

export default function TeacherView({g,onOpenScreen}:{g:ReturnTypeRepublic;onOpenScreen:()=>void}){
 const {game,currentStage,members,metrics,evaluations,actions,activities,presence,names,secondsLeft,nextStage,setTurn,setTurnMinutes,publishEvent,triggerCrisis,ghostVoting,setEvaluation,updateMember,updateMetric}=g;
 const [eventTitle,setEventTitle]=useState(''),[eventBody,setEventBody]=useState('');
 if(!game)return null;

 const studentRows=useMemo(()=>members.filter(m=>m.kind!=='teacher').map(m=>{
  const p=presence.find(x=>x.user_id===m.user_id);
  const last=activities.find(x=>x.actor_id===m.user_id);
  const online=!!p&&(Date.now()-new Date(p.last_seen_at).getTime()<90000);
  return {m,p,last,online};
 }).sort((a,b)=>Number(b.online)-Number(a.online)||new Date(b.p?.last_seen_at||0).getTime()-new Date(a.p?.last_seen_at||0).getTime()),[members,presence,activities]);

 async function publish(){if(await publishEvent(eventTitle,eventBody)){setEventTitle('');setEventBody('')}}

 return <>
  <section className="teacherHero">
   <div>
    <small>ПУЛЬТ ПРЕПОДАВАТЕЛЯ</small>
    <h1>Управление занятием</h1>
    <p>Здесь видно, что происходит прямо сейчас, что делают студенты и какие действия можно запустить следующим шагом.</p>
   </div>
   <button className="screenLaunch" onClick={onOpenScreen}><span>▣</span><b>Открыть общий экран</b><small>Для проектора — без служебных кнопок</small></button>
  </section>

  <section className="controlStrip">
   <article>
    <span className="stepNo">1</span>
    <div><small>ТЕКУЩИЙ ЭТАП</small><b>{currentStage?.stage_no}. {currentStage?.title}</b><p>{currentStage?.mode}</p></div>
   </article>
   <article>
    <span className="stepNo">2</span>
    <div><small>ХОД ИГРЫ</small><b className={game.turn_open?'stateOpen':'statePause'}>{game.turn_open?'Открыт':'Пауза'}</b><p>{game.turn_open&&game.turn_ends_at?'Осталось '+timerText(secondsLeft):'Студенты не могут отправлять решения'}</p></div>
    <button className={game.turn_open?'secondary':'primary'} onClick={()=>setTurn(!game.turn_open)}>{game.turn_open?'Пауза':'Открыть ход'}</button>
   </article>
   <article>
    <span className="stepNo">3</span>
    <div><small>СЛЕДУЮЩИЙ ШАГ</small><b>Перейти дальше</b><p>Закрыть текущий этап и открыть следующий</p></div>
    <button className="primary" onClick={nextStage}>Следующий этап →</button>
   </article>
  </section>

  <section className="teacherMainGrid">
   <article className="surface liveStudents">
    <div className="surfaceHead"><div><small>СЕЙЧАС В ИГРЕ</small><h2>Студенты</h2></div><span>{studentRows.filter(x=>x.online).length} онлайн</span></div>
    <div className="studentLiveList">
     {studentRows.length===0?<div className="emptyState">Студенты ещё не подключились.</div>:studentRows.map(({m,p,last,online})=><div className="studentLiveRow" key={m.user_id}>
      <span className={online?'onlineDot':'offlineDot'}/>
      <div className="studentLiveIdentity"><b>{m.full_name}</b><small>{m.team||m.group_name||'Без команды'} · {m.role_title||'роль не назначена'}</small></div>
      <div className="studentNow"><label>Сейчас</label><b>{p?VIEW_NAMES[p.current_view]||p.current_view:'Нет данных'}</b></div>
      <div className="studentLast"><label>Последнее действие</label><b>{last?.label||'—'}</b><small>{last?new Date(last.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):''}</small></div>
     </div>)}
    </div>
   </article>

   <article className="surface activityPanel">
    <div className="surfaceHead"><div><small>ЖИВАЯ ЛЕНТА</small><h2>Что нажимают и делают</h2></div><span>{activities.length}</span></div>
    <div className="activityFeed">
     {activities.length===0?<div className="emptyState">Активность появится после действий студентов.</div>:activities.slice(0,80).map(a=><div className="activityRow" key={a.id}>
      <time>{new Date(a.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time>
      <span className="activityAvatar">{(names[a.actor_id]||'?').split(' ').slice(0,2).map(x=>x[0]).join('').toUpperCase()}</span>
      <div><b>{names[a.actor_id]||'Участник'}</b><p>{a.label}</p>{a.view_key&&<small>{VIEW_NAMES[a.view_key]||a.view_key}</small>}</div>
     </div>)}
    </div>
   </article>
  </section>

  <section className="teacherActionsGrid">
   <article className="surface actionGuide">
    <div className="surfaceHead"><div><small>БЫСТРОЕ УПРАВЛЕНИЕ</small><h2>Что запустить сейчас</h2></div></div>
    <div className="directorButtons">
     <button onClick={()=>setTurnMinutes(10)}><span>10:00</span><b>Короткий ход</b><small>Открыть студентам 10 минут</small></button>
     <button onClick={()=>setTurnMinutes(20)}><span>20:00</span><b>Рабочий ход</b><small>Открыть студентам 20 минут</small></button>
     <button onClick={()=>setTurnMinutes(30)}><span>30:00</span><b>Большой раунд</b><small>Открыть студентам 30 минут</small></button>
     <button className="dangerQuick" onClick={triggerCrisis}><span>⚠</span><b>Разыграть кризис</b><small>Случайный тип и интенсивность</small></button>
     <button onClick={ghostVoting}><span>⚡</span><b>Ghost voting</b><small>Потеря 25–50 депутатов</small></button>
     <button onClick={onOpenScreen}><span>▣</span><b>Общий экран</b><small>Вывести игру на проектор</small></button>
    </div>
   </article>

   <article className="surface">
    <div className="surfaceHead"><div><small>СОБЫТИЕ ДЛЯ ВСЕХ</small><h2>Опубликовать в общий экран</h2></div></div>
    <div className="eventComposer"><input value={eventTitle} onChange={e=>setEventTitle(e.target.value)} placeholder="Заголовок события"/><textarea rows={5} value={eventBody} onChange={e=>setEventBody(e.target.value)} placeholder="Что произошло и что должны учитывать участники"/><button className="primary" onClick={publish}>Опубликовать событие</button></div>
   </article>
  </section>

  <section className="teacherLowerGrid">
   <article className="surface"><div className="surfaceHead"><div><small>ПОКАЗАТЕЛИ ГОСУДАРСТВА</small><h2>Изменить KPI</h2></div></div><div className="metricEditor">{metrics.map(m=><label key={m.id}><span>{m.label}</span><input key={m.id+String(m.value)} type="number" defaultValue={m.value} onBlur={e=>updateMetric(m.id,+e.target.value)}/><em>{m.unit||''}</em></label>)}</div></article>
   <article className="surface"><div className="surfaceHead"><div><small>ОЖИДАЮТ РЕШЕНИЯ</small><h2>Очередь преподавателя</h2></div><span>{actions.filter(a=>a.status==='submitted').length}</span></div><div className="queueSummary">{actions.filter(a=>a.status==='submitted').slice(0,6).map(a=><div key={a.id}><b>{names[a.author_id]||'Участник'}</b><span>{a.title}</span></div>)}{actions.filter(a=>a.status==='submitted').length===0&&<div className="emptyState">Нет решений на рассмотрении.</div>}</div></article>
  </section>

  <section className="surface"><div className="surfaceHead"><div><small>ВСН · ЭТАП {currentStage?.stage_no}</small><h2>Индивидуальная оценка вклада</h2></div><span>0 · Н · С · В</span></div><div className="evaluationRows">{members.filter(m=>m.kind!=='teacher').map(m=>{const ev=evaluations.find(x=>x.user_id===m.user_id&&x.stage_no===(currentStage?.stage_no||1));return <div key={m.user_id}><div className="studentIdentity"><b>{m.full_name}</b><span>{m.team||m.group_name||'Без команды'}</span><input key={m.user_id+(m.role_title||'')} defaultValue={m.role_title||''} onBlur={e=>updateMember(m.user_id,{role_title:e.target.value})} placeholder="Игровая роль"/></div><div className="vsnButtons">{[0,1,2,3].map(s=><button key={s} className={ev?.score===s?'active':''} onClick={()=>setEvaluation(m.user_id,s)}><b>{VSN_LABEL[s]}</b><small>{s}</small></button>)}</div></div>})}</div></section>
 </>;
}
