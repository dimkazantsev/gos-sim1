'use client';
import {useEffect,useMemo,useState} from 'react';
import {ClipboardCheck,MessageCircle,UsersRound,Vote} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import InstitutionRegistrationPanel from './InstitutionRegistrationPanel';

type Nomination={
 id:string;
 office_title:string;
 office_kind:'prime_minister'|'deputy_pm'|'duma_minister'|'security_minister'|'central_bank_chair';
 route:'president_to_duma'|'pm_to_duma'|'president_after_sf';
 candidate_name:string;
 attempt_no:number;
 status:'submitted'|'vote_open'|'approved'|'rejected'|'consultation_pending'|'consulted'|'appointed'|'withdrawn';
 vote_id:string|null;
 created_at:string;
};

const STATUS:Record<Nomination['status'],string>={
 submitted:'Внесена в повестку',
 vote_open:'Голосование открыто',
 approved:'Утверждена ГД',
 rejected:'Отклонена ГД',
 consultation_pending:'Консультация СФ',
 consulted:'Консультация проведена',
 appointed:'Назначен(а)',
 withdrawn:'Отозвана'
};

export default function GovernmentDumaSessionPanel({g,onOpenVotes}:{g:ReturnTypeRepublic;onOpenVotes:(voteId?:string)=>void}){
 const {game,me,teacher,votes,setError}=g;
 const [rows,setRows]=useState<Nomination[]>([]);
 const [registrations,setRegistrations]=useState<Array<{user_id:string;institution_key:string;stage_no:number}>>([]);
 const [registrationOpen,setRegistrationOpen]=useState(false);
 const [busy,setBusy]=useState(false);

 async function load(){
  if(!game)return;
  const [n,r]=await Promise.all([
   supabase.from('government_nominations').select('id,office_title,office_kind,route,candidate_name,attempt_no,status,vote_id,created_at').eq('game_id',game.id).eq('stage_no',8).order('created_at',{ascending:true}),
   supabase.from('institution_session_registrations').select('user_id,institution_key,stage_no').eq('game_id',game.id).eq('stage_no',8).eq('institution_key','gd')
  ]);
  if(!n.error)setRows((n.data||[]) as Nomination[]);
  if(!r.error)setRegistrations(r.data||[]);
 }

 useEffect(()=>{void load()},[game?.id]);
 useEffect(()=>{
  if(!game)return;
  const ch=supabase.channel('stage8-duma-session:'+game.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'government_nominations',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'institution_session_registrations',filter:'game_id=eq.'+game.id},()=>void load())
   .subscribe();
  return()=>{void supabase.removeChannel(ch)}
 },[game?.id]);

 if(!game||!me)return null;

 const dumaRows=rows.filter(x=>x.route==='president_to_duma'||x.route==='pm_to_duma');
 const openVotes=dumaRows.map(x=>x.vote_id?g.votes.find(v=>v.id===x.vote_id):undefined).filter(v=>v?.status==='open');
 const decided=dumaRows.filter(x=>['approved','rejected','appointed'].includes(x.status)).length;
 const myRegistered=registrations.some(x=>x.user_id===me.user_id);
 const publicChannel=g.channels.find(channel=>channel.kind==='public'&&channel.name!=='Вне игры'&&['Публичная политика','Общая беседа','Общий штаб','Общий чат'].includes(channel.name))||g.channels.find(channel=>channel.kind==='public'&&channel.name!=='Вне игры');
 const meetingState=openVotes.length?'Заседание идёт':dumaRows.some(x=>x.status==='submitted')?'Повестка сформирована':dumaRows.length&&decided===dumaRows.length?'Рассмотрение завершено':'Ожидает кандидатур';

 function openChat(){
  if(!publicChannel)return;
  g.setChannelId(publicChannel.id);
  g.setChatOpen(true);
 }

 function openNominations(){
  document.getElementById('stage8-government-nominations')?.scrollIntoView({behavior:'smooth',block:'start'});
 }

 async function openVote(id:string){
  setBusy(true);
  const r=await supabase.rpc('open_government_nomination_vote',{p_nomination_id:id});
  if(r.error)setError(r.error.message);
  else{
   await g.refresh();
   await load();
   onOpenVotes(String(r.data));
  }
  setBusy(false);
 }

 const activeVoteId=openVotes[0]?.id||dumaRows.find(x=>x.vote_id)?.vote_id||undefined;

 return <section className="governmentDumaSession">
  <header className="governmentDumaSessionHead">
   <div>
    <small>ГОСУДАРСТВЕННАЯ ДУМА · ЭТАП 8</small>
    <h2>Заседание по формированию Правительства</h2>
    <p>Кандидатуры, которые по процедуре требуют рассмотрения Государственной Думой, собираются здесь в единую повестку. Регистрация, публичное обсуждение и голосование используют общие системные модули игры.</p>
   </div>
   <div className="governmentDumaSessionState">
    <small>СТАТУС ЗАСЕДАНИЯ</small>
    <b>{meetingState}</b>
    <span>{dumaRows.length} вопросов · {openVotes.length} голосований открыто</span>
   </div>
  </header>

  <section className="presProcedureHub governmentProcedureHub" aria-label="Маршрут заседания Государственной Думы">
   <header className="presProcedureHubHead">
    <div><small>МАРШРУТ ЗАСЕДАНИЯ</small><b>Государственная Дума · формирование Правительства</b></div>
    <span>Регистрация → обсуждение → кандидатуры → голосование</span>
   </header>
   <div className="presProcedureHubActions">
    <button type="button" className={myRegistered?'isDone':'isCurrent'} onClick={()=>setRegistrationOpen(v=>!v)}>
     <span className="presProcedureStepNo">01</span><ClipboardCheck size={18}/>
     <span><small>ПРИСУТСТВИЕ</small><b>Регистрация на заседание</b><em>{myRegistered?'Вы зарегистрированы':'Зарегистрировано: '+registrations.length}</em></span>
    </button>
    <button type="button" disabled={!publicChannel} className={publicChannel?'isReady':'isLocked'} onClick={openChat}>
     <span className="presProcedureStepNo">02</span><MessageCircle size={18}/>
     <span><small>ОБСУЖДЕНИЕ</small><b>Публичный чат</b><em>{publicChannel?'Открыть обсуждение':'Нет публичного канала'}</em></span>
    </button>
    <button type="button" className={dumaRows.length?'isDone':'isWaiting'} onClick={openNominations}>
     <span className="presProcedureStepNo">03</span><UsersRound size={18}/>
     <span><small>ПОВЕСТКА</small><b>Кандидатуры</b><em>{dumaRows.length?'Вопросов: '+dumaRows.length:'Кандидатуры ещё не внесены'}</em></span>
    </button>
    <button type="button" className={openVotes.length?'isLive':dumaRows.some(x=>x.vote_id)?'isDone':'isWaiting'} disabled={!activeVoteId} onClick={()=>onOpenVotes(activeVoteId)}>
     <span className="presProcedureStepNo">04</span><Vote size={18}/>
     <span><small>РЕШЕНИЕ</small><b>Голосование</b><em>{openVotes.length?'Открыто: '+openVotes.length:dumaRows.some(x=>x.vote_id)?'Есть завершённые голосования':'Ожидает открытия'}</em></span>
    </button>
   </div>
  </section>

  {registrationOpen&&<div className="governmentDumaRegistration"><InstitutionRegistrationPanel g={g} stageNo={8} initialBody="gd" allowedBodies={['gd']} defaultOpen/></div>}

  <section className="governmentDumaAgenda">
   <header><div><small>ПОВЕСТКА ЗАСЕДАНИЯ</small><h3>Кандидатуры, требующие решения Государственной Думы</h3></div><span>{decided}/{dumaRows.length} рассмотрено</span></header>
   {dumaRows.length===0?<div className="governmentDumaAgendaEmpty">Пока нет внесённых кандидатур. Внесите кандидатуру ниже — она автоматически появится в повестке заседания.</div>:<div className="governmentDumaAgendaList">{dumaRows.map((n,index)=>{
    const vote=n.vote_id?votes.find(v=>v.id===n.vote_id):undefined;
    return <article key={n.id} className={'governmentDumaAgendaItem '+n.status}>
     <span className="governmentDumaAgendaNo">{String(index+1).padStart(2,'0')}</span>
     <div><small>{n.office_title}</small><b>{n.candidate_name}</b><span>Попытка {n.attempt_no}/3 · {STATUS[n.status]}</span></div>
     {teacher&&n.status==='submitted'&&<button className="primary" disabled={busy} onClick={()=>void openVote(n.id)}>Открыть голосование</button>}
     {vote?.status==='open'&&<button className="secondary" onClick={()=>onOpenVotes(vote.id)}>Перейти к голосованию</button>}
     {vote?.status==='closed'&&<strong>{vote.result_label||'Голосование завершено'}</strong>}
    </article>
   })}</div>}
  </section>
 </section>;
}
