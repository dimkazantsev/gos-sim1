'use client';
import {ArrowRight,ArrowUpRight,BookOpen,Check,Clock3,FileText,Landmark,MessageCircle,Vote,Users} from 'lucide-react';
import type {ReturnTypeRepublic} from './viewTypes';
import type {View} from './types';
import {STAGE_ACTIONS} from './stageActions';
import StateMetricsDock from './StateMetricsDock';

export default function DashboardView({g,onNavigate}:{g:ReturnTypeRepublic;onNavigate:(view:View)=>void}){
 const {game,me,currentStage,stages,teacher,parties,members,events,actions,votes,ballots,formalDocuments,setChatOpen}=g;
 if(!game||!me)return null;
 const stageNo=currentStage?.stage_no||game.current_round||1;
 const task=STAGE_ACTIONS[stageNo]||STAGE_ACTIONS[1];
 const complete=stages.filter(s=>s.status==='completed').length;
 const openVotes=votes.filter(v=>v.status==='open');
 const availableVotes=openVotes.filter(v=>g.canVote(v)&&!ballots.some(b=>b.vote_id===v.id&&b.voter_id===me.user_id));
 const submitted=actions.filter(a=>a.status==='submitted'&&(teacher||a.author_id===me.user_id));
 const totalMandates=parties.reduce((n,p)=>n+Number(p.mandates||0),0);
 const participants=members.filter(m=>m.kind==='student').length;
 const myParty=parties.find(p=>p.name===me.team);
 return <div className="overviewPage">
  <header className="overviewHeading"><div><span className="overline">{game.title}</span><h1>{teacher?'Игра под вашим управлением.':'Большие решения. Ваш ход.'}</h1></div><button aria-label="Открыть карту игры" className="quietButton" onClick={()=>onNavigate('stages')}>Карта игры<ArrowUpRight aria-hidden="true"/></button></header>
  <div className="overviewLead">
   <section className="missionCard" aria-labelledby="mission-title">
    <div className="missionTop"><span className="overline">ТЕКУЩИЙ ЭТАП / {String(stageNo).padStart(2,'0')}</span><span className={'missionState '+(game.turn_open?'open':'paused')}><span/>{game.turn_open?'Ход открыт':'Пауза'}</span></div>
    <h2 id="mission-title">{currentStage?.title||'Начало новой республики'}</h2>
    <p>{currentStage?.summary||task.body}</p>
    <div className="missionBottom"><button className="missionButton" onClick={()=>onNavigate(task.target)}>{task.button}<ArrowUpRight aria-hidden="true"/></button><span className="missionNumber" aria-hidden="true">{String(stageNo).padStart(2,'0')}</span></div>
    <div className="missionProgress" aria-label={`Завершено ${complete} из ${stages.length||16} этапов`}>{Array.from({length:stages.length||16},(_,i)=><span key={i} className={stages.find(s=>s.stage_no===i+1)?.status==='completed'?'done':stageNo===i+1?'current':''}/>)}</div>
    <div className="missionProgressLabel"><span>Путь к работающему государству</span><span>{complete} / {stages.length||16}</span></div>
   </section>
   <section className="agendaCard" aria-labelledby="agenda-title"><div className="sectionTop"><span className="overline">В ФОКУСЕ</span><span className="agendaSymbol"><ArrowUpRight aria-hidden="true"/></span></div><h2 id="agenda-title">Ближайшие действия</h2>
    <button className="agendaAction" onClick={()=>onNavigate(teacher?'teacher':task.target)}><span className="agendaIcon blue"><BookOpen aria-hidden="true"/></span><span><b>{teacher?'Подготовить следующий ход':task.title}</b><small>{teacher?'Этапы, время и состав участников':game.turn_open?'Открыть рабочее пространство':'Можно изучить задачу во время паузы'}</small></span><ArrowRight aria-hidden="true"/></button>
    <button className="agendaAction" onClick={()=>onNavigate('votes')}><span className="agendaIcon pink"><Vote aria-hidden="true"/></span><span><b>{availableVotes.length?'Ожидают вашего голоса':'Центр голосований'}</b><small>{availableVotes.length?`Доступно без вашего бюллетеня: ${availableVotes.length}`:openVotes.length?`Открытых процедур: ${openVotes.length}`:'Открытых процедур пока нет'}</small></span><ArrowRight aria-hidden="true"/></button>
    <button className="agendaAction" onClick={()=>setChatOpen(true)}><span className="agendaIcon neutral"><MessageCircle aria-hidden="true"/></span><span><b>Обсудить с командой</b><small>{me.team||'Общая беседа'}</small></span><ArrowRight aria-hidden="true"/></button>
    <div className="agendaFoot"><Clock3 aria-hidden="true"/><span>{submitted.length?`Решения на рассмотрении: ${submitted.length}`:'Новые события и решения появятся в ленте.'}</span></div>
   </section>
  </div>
  <section className="overviewMetrics"><div className="sectionTop"><div><span className="overline">РЕШЕНИЯ И ПОСЛЕДСТВИЯ</span><h2>Пульс государства</h2></div><span className="sectionHint">Нажмите на показатель, чтобы увидеть историю</span></div><StateMetricsDock g={g}/></section>
  <div className="overviewBottom">
   <section className="overviewFeed"><div className="sectionTop"><h2>Что происходит</h2><button className="textButton" onClick={()=>onNavigate('actions')}>Все процессы<ArrowUpRight aria-hidden="true"/></button></div>
    {events.length?<ol className="eventTimeline">{events.slice(0,4).map(event=><li key={event.id}><span className={'eventDot '+event.severity}/><div><time dateTime={event.published_at}>{new Date(event.published_at).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</time><h3>{event.title}</h3><p>{event.body}</p></div></li>)}</ol>:<div className="overviewEmpty"><span><FileText aria-hidden="true"/></span><h3>История только начинается</h3><p>Здесь появятся объявления преподавателя и события вашей республики.</p><button className="textButton" onClick={()=>onNavigate('actions')}>Открыть ленту процессов<ArrowRight aria-hidden="true"/></button></div>}
   </section>
   <section className="republicCard"><div className="sectionTop"><span className="overline">СОСТАВ РЕСПУБЛИКИ</span><Landmark aria-hidden="true"/></div><h2>{teacher?'Ваш учебный парламент':me.role_title||'Участник республики'}</h2><p>{teacher?'Команды, представители и принятые решения.':myParty?myParty.name:'Ваша роль и партия появятся здесь после назначения.'}</p>
    <div className="republicStats"><div><Users aria-hidden="true"/><strong>{participants}</strong><span>участников</span></div><div><Landmark aria-hidden="true"/><strong>{parties.length}</strong><span>партий</span></div><div><FileText aria-hidden="true"/><strong>{formalDocuments.length}</strong><span>НПА в реестре</span></div></div>
    {totalMandates>0?<div className="mandateSummary"><div className="mandateLabel"><b>Распределение мандатов</b><span>{totalMandates}</span></div><div className="mandateBar" role="img" aria-label={parties.filter(p=>p.mandates>0).map(p=>`${p.name}: ${p.mandates}`).join('; ')}>{parties.filter(p=>p.mandates>0).map((p,i)=><span key={p.id} style={{width:p.mandates/totalMandates*100+'%',background:p.color||['#2453E6','#EFA5CB','#172E74'][i%3]}}/>)}</div><ul className="mandateLegend">{parties.filter(p=>p.mandates>0).map((p,i)=><li key={p.id}><i style={{background:p.color||['#2453E6','#EFA5CB','#172E74'][i%3]}}/><span>{p.name}</span><b>{p.mandates}</b></li>)}</ul></div>:<div className="republicPending"><Check aria-hidden="true"/><p>Мандаты появятся после проведения выборов.</p></div>}
    <button className="textButton" onClick={()=>onNavigate('parties')}>Открыть партии<ArrowUpRight aria-hidden="true"/></button>
   </section>
  </div>
 </div>;
}
