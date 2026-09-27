'use client';
import {useEffect,useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';

type InfoRequest={id:string;crisis_id:string;game_id:string;requester_id:string;question:string;answer:string|null;status:'pending'|'answered';created_at:string;answered_at:string|null};
type CrisisResponse={id:string;crisis_id:string;game_id:string;user_id:string;role_title:string|null;action_plan:string;legal_basis:string|null;resources:string|null;public_message:string|null;teacher_note:string|null;status:'submitted'|'reviewed';created_at:string;updated_at:string};

const intensityLabel:Record<string,string>={low:'Низкая',medium:'Средняя',high:'Высокая',ultra:'Ультра'};
const intensityClass=(x:string)=>x==='ultra'?'ultra':x==='high'?'high':x==='medium'?'medium':'low';

export default function CrisisRoom({g}:{g:ReturnTypeRepublic}){
 const {game,me,teacher,crises,members,currentStage,triggerCrisis,setError}=g;
 const active=useMemo(()=>crises.filter(c=>c.status==='active').sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime())[0],[crises]);
 const [requests,setRequests]=useState<InfoRequest[]>([]);
 const [responses,setResponses]=useState<CrisisResponse[]>([]);
 const [question,setQuestion]=useState('');
 const [answerDraft,setAnswerDraft]=useState<Record<string,string>>({});
 const [plan,setPlan]=useState('');
 const [legal,setLegal]=useState('');
 const [resources,setResources]=useState('');
 const [message,setMessage]=useState('');
 const [reviewDraft,setReviewDraft]=useState<Record<string,string>>({});
 const [resolution,setResolution]=useState('');
 const [busy,setBusy]=useState(false);
 const [now,setNow]=useState(Date.now());

 async function load(){
  if(!game||!active)return;
  const [q,r]=await Promise.all([
   supabase.from('crisis_information_requests').select('*').eq('game_id',game.id).eq('crisis_id',active.id).order('created_at',{ascending:true}),
   supabase.from('crisis_responses').select('*').eq('game_id',game.id).eq('crisis_id',active.id).order('created_at',{ascending:true})
  ]);
  if(!q.error)setRequests((q.data||[]) as InfoRequest[]);
  if(!r.error){
   const rows=(r.data||[]) as CrisisResponse[];
   setResponses(rows);
   const mine=rows.find(x=>x.user_id===me?.user_id);
   if(mine){setPlan(mine.action_plan||'');setLegal(mine.legal_basis||'');setResources(mine.resources||'');setMessage(mine.public_message||'')}
  }
 }

 useEffect(()=>{void load()},[game?.id,active?.id,me?.user_id]);
 useEffect(()=>{
  if(!game||!active)return;
  const ch=supabase.channel('crisis-room:'+active.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'crisis_information_requests',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'crisis_responses',filter:'game_id=eq.'+game.id},()=>void load())
   .subscribe();
  return()=>{void supabase.removeChannel(ch)}
 },[game?.id,active?.id]);
 useEffect(()=>{const id=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(id)},[]);

 if(!game||!me)return null;
 if(!active){
  if(!teacher||currentStage?.stage_no!==15)return null;
  return <section className="crisisCommand crisisLauncher">
   <header className="crisisCommandHead"><div className="crisisSignal"><span>!</span><div><small>ЭТАП 15 · КРИЗИСНОЕ УПРАВЛЕНИЕ</small><h2>Сценарий ещё не запущен</h2><p>Система случайно выберет тип кризиса и интенсивность, после чего участники получат ограниченное окно для запроса данных и управленческой реакции.</p></div></div><div className="crisisClock"><small>СОСТОЯНИЕ</small><strong>ГОТОВ</strong><span>ожидается запуск преподавателем</span></div></header>
   <div className="crisisLaunchBody"><div><b>Что произойдёт после запуска</b><p>Создастся кризис этапа 15, включится 20-минутное окно первичной реакции, появятся запросы сведений, планы действий, правовые основания, ресурсы и публичная коммуникация.</p></div><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);await triggerCrisis();setBusy(false)}}>⚠ Запустить случайный кризис</button></div>
  </section>;
 }
 const deadline=active.response_deadline?new Date(active.response_deadline).getTime():null;
 const left=deadline?Math.max(0,Math.floor((deadline-now)/1000)):null;
 const late=deadline!==null&&left===0;
 const mm=left===null?'—':String(Math.floor(left/60)).padStart(2,'0')+':'+String(left%60).padStart(2,'0');
 const myResponse=responses.find(x=>x.user_id===me.user_id);

 async function ask(){
  if(question.trim().length<5)return;setBusy(true);
  const r=await supabase.rpc('ask_crisis_information',{p_crisis_id:active.id,p_question:question.trim()});
  if(r.error)setError(r.error.message);else{setQuestion('');await load()}setBusy(false);
 }
 async function answer(id:string){
  const x=(answerDraft[id]||'').trim();if(!x)return;setBusy(true);
  const r=await supabase.rpc('answer_crisis_information',{p_request_id:id,p_answer:x});
  if(r.error)setError(r.error.message);else{setAnswerDraft(v=>({...v,[id]:''}));await load()}setBusy(false);
 }
 async function submit(){
  if(plan.trim().length<20)return;setBusy(true);
  const r=await supabase.rpc('submit_crisis_response',{p_crisis_id:active.id,p_action_plan:plan.trim(),p_legal_basis:legal.trim()||null,p_resources:resources.trim()||null,p_public_message:message.trim()||null});
  if(r.error)setError(r.error.message);else await load();setBusy(false);
 }
 async function review(id:string){
  setBusy(true);const r=await supabase.rpc('review_crisis_response',{p_response_id:id,p_teacher_note:(reviewDraft[id]||'').trim()||null});
  if(r.error)setError(r.error.message);else await load();setBusy(false);
 }
 async function resolve(){
  setBusy(true);const r=await supabase.rpc('resolve_crisis',{p_crisis_id:active.id,p_resolution_note:resolution.trim()||null});
  if(r.error)setError(r.error.message);setBusy(false);
 }

 return <section className={'crisisCommand '+intensityClass(active.intensity)}>
  <header className="crisisCommandHead">
   <div className="crisisSignal"><span>!</span><div><small>АКТИВНЫЙ КРИЗИС · ЭТАП {active.stage_no}</small><h2>{active.crisis_type}</h2><p>{active.description}</p></div></div>
   <div className="crisisClock"><small>ОКНО ПЕРВИЧНОЙ РЕАКЦИИ</small><strong className={late?'late':''}>{late?'СРОК ИСТЁК':mm}</strong><span>{intensityLabel[active.intensity]} интенсивность</span></div>
  </header>

  <div className="crisisCommandGrid">
   <article className="crisisIntel">
    <div className="crisisSectionHead"><div><small>ИНФОРМАЦИОННАЯ НЕОПРЕДЕЛЁННОСТЬ</small><h3>Запросы сведений</h3></div><span>{requests.filter(x=>x.status==='pending').length} ждут ответа</span></div>
    <div className="crisisIntelList">{requests.length===0?<div className="crisisEmpty">Дополнительные сведения ещё не запрашивали.</div>:requests.map(q=><div className={'crisisIntelRow '+q.status} key={q.id}><div><b>{members.find(m=>m.user_id===q.requester_id)?.full_name||'Участник'}</b><p>{q.question}</p>{q.answer&&<blockquote>{q.answer}</blockquote>}</div>{teacher&&q.status==='pending'&&<div className="crisisAnswer"><input value={answerDraft[q.id]||''} onChange={e=>setAnswerDraft(v=>({...v,[q.id]:e.target.value}))} placeholder="Дать только ту информацию, которую участники смогли получить…"/><button disabled={busy||!(answerDraft[q.id]||'').trim()} onClick={()=>void answer(q.id)}>Ответить</button></div>}</div>)}</div>
    {!teacher&&<div className="crisisAsk"><input value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Каких данных не хватает для решения?"/><button disabled={busy||question.trim().length<5} onClick={()=>void ask()}>Запросить сведения</button></div>}
   </article>

   <article className="crisisResponsePanel">
    <div className="crisisSectionHead"><div><small>{teacher?'РЕАКЦИИ ОРГАНОВ ВЛАСТИ':'ВАША РЕАКЦИЯ'}</small><h3>{teacher?'Оперативные решения':'План действий'}</h3></div>{!teacher&&<span>{myResponse?.status==='reviewed'?'Проверено':myResponse?'Отправлено':'Черновик'}</span>}</div>
    {teacher?<div className="crisisResponseList">{responses.length===0?<div className="crisisEmpty">Решения участников ещё не поступили.</div>:responses.map(r=><article key={r.id}><header><div><b>{members.find(m=>m.user_id===r.user_id)?.full_name||'Участник'}</b><span>{r.role_title||'Роль не назначена'}</span></div><em>{r.status==='reviewed'?'Проверено':'Ждёт проверки'}</em></header><section><small>ДЕЙСТВИЯ</small><p>{r.action_plan}</p></section>{r.legal_basis&&<section><small>ПРАВОВОЕ ОСНОВАНИЕ</small><p>{r.legal_basis}</p></section>}{r.resources&&<section><small>РЕСУРСЫ</small><p>{r.resources}</p></section>}{r.public_message&&<section><small>ПУБЛИЧНАЯ КОММУНИКАЦИЯ</small><p>{r.public_message}</p></section>}<div className="crisisReview"><textarea rows={2} value={reviewDraft[r.id]??r.teacher_note??''} onChange={e=>setReviewDraft(v=>({...v,[r.id]:e.target.value}))} placeholder="Комментарий преподавателя"/><button disabled={busy} onClick={()=>void review(r.id)}>Зафиксировать разбор</button></div></article>)}</div>
    :<div className="crisisResponseForm"><label>1 · Управленческое решение<textarea rows={5} value={plan} onChange={e=>setPlan(e.target.value)} placeholder="Что именно вы делаете сейчас, кто исполняет и в какой последовательности?"/></label><label>2 · Полномочия и правовое основание<textarea rows={3} value={legal} onChange={e=>setLegal(e.target.value)} placeholder="На каком полномочии, норме или компетенции основано решение?"/></label><label>3 · Ресурсы и ограничения<textarea rows={3} value={resources} onChange={e=>setResources(e.target.value)} placeholder="Люди, бюджет, информация, время, инфраструктура, риски…"/></label><label>4 · Публичная коммуникация<textarea rows={3} value={message} onChange={e=>setMessage(e.target.value)} placeholder="Что ваш орган сообщает гражданам и другим институтам?"/></label><button className="primary" disabled={busy||plan.trim().length<20} onClick={()=>void submit()}>{myResponse?'Обновить решение':'Отправить решение'}</button>{myResponse?.teacher_note&&<div className="crisisTeacherFeedback"><b>Комментарий преподавателя</b><p>{myResponse.teacher_note}</p></div>}</div>}
   </article>
  </div>

  {teacher&&<footer className="crisisResolution"><div><small>ЗАВЕРШЕНИЕ СЦЕНАРИЯ</small><p>Фиксируйте результат только после разбора решений: что сработало, какие полномочия были использованы корректно и какие последствия возникли.</p></div><textarea rows={3} value={resolution} onChange={e=>setResolution(e.target.value)} placeholder="Итог кризиса и ключевые последствия"/><button className="primary" disabled={busy} onClick={()=>void resolve()}>Завершить кризис</button></footer>}
 </section>;
}
