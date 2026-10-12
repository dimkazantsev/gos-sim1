'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {ArrowRight,ArrowUpRight,BookOpen,Check,Clock3,FileText,Landmark,MessageCircle,Vote,Users} from 'lucide-react';
import type {ReturnTypeRepublic} from './viewTypes';
import type {PoliticalPost,View} from './types';
import {STAGE_ACTIONS} from './stageActions';
import StateMetricsDock from './StateMetricsDock';
import RepublicLeadership from './RepublicLeadership';

export default function DashboardView({g,onNavigate,onOpenProfile}:{g:ReturnTypeRepublic;onNavigate:(view:View)=>void;onOpenProfile?:(id:string)=>void}){
 const {game,me,currentStage,stages,teacher,parties,members,votes,ballots,formalDocuments,setChatOpen}=g;
 const [recentPosts,setRecentPosts]=useState<Pick<PoliticalPost,'id'|'title'|'body'|'created_at'|'status'>[]>([]);
 const [feedLoading,setFeedLoading]=useState(true);
 const [feedError,setFeedError]=useState(false);
 const gameId=game?.id;
 useEffect(()=>{
  if(!gameId){setRecentPosts([]);setFeedLoading(false);setFeedError(false);return}
  let cancelled=false;
  // The overview reads only four live posts; historical game_events are not
  // linked to the political feed and must never be presented as active posts.
  setFeedLoading(true);setFeedError(false);setRecentPosts([]);
  void (async()=>{
   const {data,error}=await supabase.from('political_posts')
    .select('id,title,body,created_at,status')
    .eq('game_id',gameId)
    .is('deleted_at',null)
    .order('created_at',{ascending:false})
    .limit(4);
   if(cancelled)return;
   setRecentPosts(error?[]:(data||[]) as Pick<PoliticalPost,'id'|'title'|'body'|'created_at'|'status'>[]);
   setFeedError(Boolean(error));
   setFeedLoading(false);
  })();
  return ()=>{cancelled=true};
 },[gameId]);
 if(!game||!me)return null;
 const stageNo=currentStage?.stage_no||game.current_round||1;
 const task=STAGE_ACTIONS[stageNo]||STAGE_ACTIONS[1];
 const complete=stages.filter(s=>s.status==='completed').length;
 const openVotes=votes.filter(v=>v.status==='open');
 const availableVotes=openVotes.filter(v=>g.canVote(v)&&!ballots.some(b=>b.vote_id===v.id&&b.voter_id===me.user_id));
 const totalMandates=parties.reduce((n,p)=>n+Number(p.mandates||0),0);
 const participants=members.filter(m=>m.kind==='student').length;
 const myParty=parties.find(p=>p.name===me.team);
 return <div className="overviewPage">
  <header className="overviewHeading"><div><span className="overline">{game.title}</span><h1>{teacher?'Игра под вашим управлением.':'Республика в действии. Ваш ход.'}</h1></div><button aria-label="Открыть карту игры" className="quietButton" onClick={()=>onNavigate('stages')}>Карта игры<ArrowUpRight aria-hidden="true"/></button></header>
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
    <div className="agendaFoot"><Clock3 aria-hidden="true"/><span>{openVotes.length?`Открытых голосований: ${openVotes.length}`:'Новые события появятся в ленте.'}</span></div>
   </section>
  </div>
  <section className="overviewMetrics"><div className="sectionTop"><div><span className="overline">ПОКАЗАТЕЛИ И ПОСЛЕДСТВИЯ</span><h2>Пульс государства</h2></div><span className="sectionHint">Нажмите на показатель, чтобы увидеть историю</span></div><StateMetricsDock g={g}/></section>
  <div className="overviewBottom">
   <section className="overviewFeed"><div className="sectionTop"><h2>Что происходит</h2><button className="textButton" onClick={()=>onNavigate('actions')}>Все процессы<ArrowUpRight aria-hidden="true"/></button></div>
    {feedLoading?<div className="overviewEmpty" role="status"><p>Загрузка публикаций…</p></div>
    :feedError?<div className="overviewEmpty" role="status"><span><FileText aria-hidden="true"/></span><h3>Не удалось получить публикации</h3><p>Проверьте ленту политического процесса.</p><button className="textButton" onClick={()=>onNavigate('actions')}>Открыть политический процесс<ArrowRight aria-hidden="true"/></button></div>
    :recentPosts.length?<ol className="eventTimeline">{recentPosts.map(post=><li key={post.id}><span className="eventDot notice"/><div><time dateTime={post.created_at}>{new Date(post.created_at).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</time><h3>{post.title}</h3><p>{post.body.replace(/\s+/g,' ').slice(0,210)}{post.body.length>210?'…':''}</p></div></li>)}</ol>
    :<div className="overviewEmpty"><span><FileText aria-hidden="true"/></span><h3>Публикаций пока нет</h3><p>Здесь появятся действующие публикации политического процесса.</p><button className="textButton" onClick={()=>onNavigate('actions')}>Открыть политический процесс<ArrowRight aria-hidden="true"/></button></div>}
   </section>
   <section className="republicCard"><div className="sectionTop"><span className="overline">СОСТАВ РЕСПУБЛИКИ</span><Landmark aria-hidden="true"/></div><h2>{teacher?'Ваш учебный парламент':me.role_title||'Участник республики'}</h2><p>{teacher?'Участники, партии и руководство республики.':myParty?myParty.name:'Ваша роль и партия появятся здесь после назначения.'}</p>
    <div className="republicStats"><div><Users aria-hidden="true"/><strong>{participants}</strong><span>участников</span></div><div><Landmark aria-hidden="true"/><strong>{parties.length}</strong><span>партий</span></div><div><FileText aria-hidden="true"/><strong>{formalDocuments.length}</strong><span>НПА в реестре</span></div></div>
    <RepublicLeadership g={g} onOpenProfile={onOpenProfile}/>
    {totalMandates>0?<div className="mandateSummary"><div className="mandateLabel"><b>Распределение мандатов</b><span>{totalMandates}</span></div><div className="mandateBar" role="img" aria-label={parties.filter(p=>p.mandates>0).map(p=>`${p.name}: ${p.mandates}`).join('; ')}>{parties.filter(p=>p.mandates>0).map((p,i)=><span key={p.id} style={{width:p.mandates/totalMandates*100+'%',background:p.color||['#2453E6','#EFA5CB','#172E74'][i%3]}}/>)}</div><ul className="mandateLegend">{parties.filter(p=>p.mandates>0).map((p,i)=><li key={p.id}><i style={{background:p.color||['#2453E6','#EFA5CB','#172E74'][i%3]}}/><span>{p.name}</span><b>{p.mandates}</b></li>)}</ul></div>:<div className="republicPending"><Check aria-hidden="true"/><p>Мандаты появятся после проведения выборов.</p></div>}
    <button className="textButton" onClick={()=>onNavigate('parties')}>Открыть партии<ArrowUpRight aria-hidden="true"/></button>
   </section>
  </div>
 </div>;
}
