'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import type {ReturnTypeRepublic} from './viewTypes';
import {useGameTableSync} from './useGameTableSync';
import {Landmark,Vote,BarChart3,CheckCircle2,CalendarDays} from 'lucide-react';

type System='relative'|'absolute'|'qualified'|'preferential';
type MyChoice={my_system:System|null;my_threshold:number|null;votes_count:number;closed:boolean;result:{system_type:System;threshold_pct:number|null;votes_total:number;tally:Record<string,number>}|null};
type PollDecision={status:'open'|'closed';result:boolean|null};
type Schedule={first_day:string;second_day:string;voting_day:string;campaign_starts_at:string;voting_starts_at:string;counting_deadline:string;appointment_document_id:string}|null;
const systems:Record<System,string>={relative:'Относительное большинство',absolute:'Абсолютное большинство',qualified:'Квалифицированное большинство',preferential:'Преференциальная система'};
const order=Object.keys(systems) as System[];

export default function PresidentialStage6CivicVote({g}:{g:ReturnTypeRepublic}){
 const {game,me,teacher,members,setError}=g;
 const gameId=game?.id||'';
 const [choice,setChoice]=useState<MyChoice|null>(null);
 const [poll,setPoll]=useState<PollDecision|null>(null);
 const [pollMine,setPollMine]=useState<boolean|null>(null);
 const [pollCounts,setPollCounts]=useState({yes:0,no:0});
 const [schedule,setSchedule]=useState<Schedule>(null);
 const [firstDay,setFirstDay]=useState('');
 const [system,setSystem]=useState<System>('absolute');
 const [threshold,setThreshold]=useState('65');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const active=useRef(true);
 useEffect(()=>{active.current=true;return()=>{active.current=false}},[]);
 const isStudent=!!me&&members.some(m=>m.user_id===me.user_id&&m.kind==='student'&&!m.roster_archived_at);
 async function load(){
  if(!gameId)return;
  const [c,p,v,s]=await Promise.all([
   supabase.rpc('get_presidential_student_system_vote',{p_game_id:gameId}),
   supabase.from('presidential_poll_decision').select('status,result').eq('game_id',gameId).maybeSingle(),
   supabase.from('presidential_poll_decision_votes').select('user_id,choice').eq('game_id',gameId),
   supabase.rpc('get_presidential_three_day_election',{p_game_id:gameId})
  ]);
  if(!active.current)return;
  const failed=[c,p,v,s].find(x=>x.error);
  if(failed?.error){setError(userError(failed.error));return}
  const current=c.data as MyChoice;setChoice(current);
  if(current?.my_system){setSystem(current.my_system);setThreshold(String(current.my_threshold||65))}
  setPoll(p.data as PollDecision|null);
  const votes=(v.data||[]) as Array<{user_id:string;choice:boolean}>;
  setPollMine(votes.find(x=>x.user_id===me?.user_id)?.choice??null);
  setPollCounts({yes:votes.filter(x=>x.choice).length,no:votes.filter(x=>!x.choice).length});
  const slot=(s.data||null) as Schedule;setSchedule(slot);
  if(slot&&!firstDay)setFirstDay(slot.first_day);
 }
 useEffect(()=>{setChoice(null);setPoll(null);setSchedule(null);setFirstDay('');setNotice('');void load()},[gameId,me?.user_id]);
 useGameTableSync(gameId,['presidential_election_settings','presidential_poll_decision','presidential_poll_decision_votes','formal_documents'],load,gameId+'|'+me?.user_id);
 async function act(fn:string,args:Record<string,unknown>,message:string){
  if(busy||!gameId)return;
  setBusy(true);setNotice('');
  try{const r=await supabase.rpc(fn,args);if(r.error)throw r.error;setNotice(message);await load();await g.refresh()}
  catch(error){setError(userError(error))}
  finally{if(active.current)setBusy(false)}
 }
 const completed=choice?.closed||false;
 const dateText=(date:string)=>new Date(date+'T12:00:00').toLocaleDateString('ru-RU');
 return <section id="stage6-election-decisions" className="presSystemDecision presStage6" aria-label="Личные решения студентов по президентским выборам">
  <header className="stage6Intro"><div><small>ЭТАП 6 · ПОДГОТОВКА ВЫБОРОВ</small><h3>Порядок выборов Президента Российской Федерации</h3>
   <p>Совет Федерации назначает даты выборов. Каждый студент лично выбирает избирательную систему и голосует о необходимости социологического опроса. Ниже на этом же этапе оформляются документы кандидатов для ЦИК. Голосование за кандидатов и подсчёт итогов — на этапе 7.</p>
  </div></header>
  <div className="stage7Grid stage6ElectionGrid">
   <section className="stage7Panel stage6VoteCard"><div className="stage7PanelHead stage6CardHead"><div><small>01 · СОВЕТ ФЕДЕРАЦИИ</small><h3>Назначение трёх дней выборов</h3><p>Агитация — 60 часов: с 08:00 первого дня до 20:00 третьего. Голосование в третий день с 20:00, итоги ЦИК — до 23:59.</p></div><span className="stage6CardIcon" aria-hidden="true"><Landmark size={23}/></span></div>
    {schedule&&<div className="stage7Notice"><b>Выборы назначены:</b> {dateText(schedule.first_day)} — {dateText(schedule.voting_day)}. Третий день: голосование в 20:00, подсчёт до 23:59.</div>}
    {teacher&&<div className="pollCreate"><label>Первый день выборов<input type="date" value={firstDay} disabled={busy||completed} onChange={e=>setFirstDay(e.target.value)}/></label>
     <button className="primary" disabled={busy||completed||!firstDay} onClick={()=>void act('set_presidential_three_day_election',{p_game_id:gameId,p_first_day:firstDay},'Совет Федерации утвердил все три дня выборов.')}> {schedule?'Обновить даты выборов':'Назначить три дня выборов'}</button></div>}
    {schedule&&<p className="stage6CardFootnote">Постановление Совета Федерации опубликовано в реестре НПА.</p>}
   </section>
   <section className="stage7Panel stage6VoteCard"><div className="stage7PanelHead stage6CardHead"><div><small>02 · ЛИЧНОЕ ГОЛОСОВАНИЕ</small><h3>Избирательная система</h3><p>Один студент — один голос. Выбор можно изменить до подведения итогов.</p></div><span className="stage6CardIcon" aria-hidden="true"><Vote size={23}/></span></div>
    {!completed&&isStudent&&<div className="pollCreate"><label>Система<select value={system} disabled={busy} onChange={e=>setSystem(e.target.value as System)}>{order.map(k=><option value={k} key={k}>{systems[k]}</option>)}</select></label>
      {system==='qualified'&&<label>Порог квалифицированного большинства, %<input type="number" min="51" max="100" step="1" value={threshold} disabled={busy} onChange={e=>setThreshold(e.target.value)}/></label>}
      <button className="primary" disabled={busy||(system==='qualified'&&(!Number.isFinite(Number(threshold))||Number(threshold)<51||Number(threshold)>100))} onClick={()=>void act('cast_presidential_student_system_vote',{p_game_id:gameId,p_system_type:system,p_threshold_pct:system==='qualified'?Number(threshold):null},'Ваш личный голос сохранён.')}> {choice?.my_system?'Изменить мой голос':'Проголосовать лично'}</button></div>}
    <p className="stage6CardFootnote">Проголосовало: <b>{choice?.votes_count||0}</b>. {choice?.my_system?'Ваш выбор: '+systems[choice.my_system]+'.':isStudent?'Вы ещё не проголосовали.':''}</p>
    {completed&&choice?.result&&<div className="stage7Notice"><b>Решение студентов:</b> {systems[choice.result.system_type]}{choice.result.system_type==='qualified'?' ('+choice.result.threshold_pct+'%)':''}. Голосов: {choice.result.votes_total}.</div>}
   </section>
   <section className="stage7Panel stage6VoteCard"><div className="stage7PanelHead stage6CardHead"><div><small>03 · ЛИЧНОЕ ГОЛОСОВАНИЕ</small><h3>Нужен ли социологический опрос?</h3><p>Опрос войдёт в итоговую формулу только при положительном решении студентов.</p></div><span className="stage6CardIcon" aria-hidden="true"><BarChart3 size={23}/></span></div>
    {!poll&&teacher&&<button className="primary" disabled={busy||completed} onClick={()=>void act('open_presidential_poll_decision',{p_game_id:gameId},'Голосование о социологическом опросе открыто.')}>Открыть голосование</button>}
    {poll&&<div className="pollDecision"><b>{poll.status==='open'?'Голосование открыто':poll.result?'Социологический опрос утверждён':'Социологический опрос не используется'}</b><p>За: {pollCounts.yes}; Против: {pollCounts.no}.</p>
      {poll.status==='open'&&isStudent&&<div className="pollChoice"><button className={pollMine===true?'active yes':''} disabled={busy} onClick={()=>void act('vote_presidential_poll_decision',{p_game_id:gameId,p_choice:true},'Ваш голос «За» учтён.')}>За</button><button className={pollMine===false?'active no':''} disabled={busy} onClick={()=>void act('vote_presidential_poll_decision',{p_game_id:gameId,p_choice:false},'Ваш голос «Против» учтён.')}>Против</button></div>}
      {poll.status==='open'&&teacher&&<button className="secondary" disabled={busy} onClick={()=>void act('close_presidential_poll_decision',{p_game_id:gameId},'Решение о социологическом опросе утверждено.')}>Закрыть голосование</button>}
    </div>}
   </section>
   {teacher&&<section className="stage7Panel stage6VoteCard"><div className="stage7PanelHead stage6CardHead"><div><small>04 · ПОДТВЕРЖДЕНИЕ</small><h3>Применить результаты личного голосования</h3><p>Для завершения нужны назначенные даты и результаты двух голосований. При равенстве голосов потребуется переголосование.</p></div><span className="stage6CardIcon" aria-hidden="true"><CheckCircle2 size={23}/></span></div>
    <button className="primary" disabled={busy||completed||!schedule||poll?.status!=='closed'||!choice?.votes_count} onClick={()=>void act('finalize_presidential_student_system_vote',{p_game_id:gameId},'Решение студентов утверждено и передано в ЦИК.')}>Зафиксировать решение студентов</button>
   </section>}
  </div>
  {notice&&<p className="stage7Notice stage6Notice" role="status">{notice}</p>}
 </section>;
}
