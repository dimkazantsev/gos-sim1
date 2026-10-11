'use client';
import {useEffect,useState,useRef} from 'react';
import {supabase} from '@/lib/supabase';
type Row={id:string;question:string;topic:string;options:string[];stage_no:number;deadline?:string;answered_at?:string|null;chosen_index?:number|null;correct_index?:number|null;is_correct?:boolean|null;explanation?:string|null;legal_act?:string|null;article?:string|null;source_url?:string|null};
const legal=(r:Row)=>r.source_url&&/^https:\/\//.test(r.source_url)?<a href={r.source_url} target="_blank" rel="noopener noreferrer">{r.legal_act}, {r.article} ↗</a>:<span>{r.legal_act} {r.article}</span>;
export function BlitzOverlay({gameId,enabled}:{gameId:string;enabled:boolean}){
 const refreshBusy=useRef(false);
 const [card,setCard]=useState<Row|null>(null),[feedback,setFeedback]=useState<Row|null>(null),[time,setTime]=useState(20),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(!enabled||card||feedback)return;let stopped=false;async function refresh(){if(refreshBusy.current)return;refreshBusy.current=true;try{const d=await supabase.rpc('blitz_issue_today',{p_game:gameId});if(d.error){setError('');return}const r=await supabase.rpc('blitz_open',{p_game:gameId});if(!stopped&&!r.error&&r.data)setCard(r.data as Row)}finally{refreshBusy.current=false}}void refresh();const id=setInterval(()=>{if(!card&&!feedback)void refresh()},90000);return()=>{stopped=true;clearInterval(id)}},[gameId,enabled,!!card,!!feedback]);
 useEffect(()=>{if(!card?.deadline)return;const f=()=>setTime(Math.max(0,Math.ceil((Date.parse(card.deadline!)-Date.now())/1000)));f();const id=setInterval(f,250);return()=>clearInterval(id)},[card?.deadline]);
 async function answer(choice:number){if(!card||busy||feedback)return;setBusy(true);const r=await supabase.rpc('blitz_answer',{p_id:card.id,p_choice:choice});if(r.error)setError(r.error.message);else setFeedback({...card,...r.data});setBusy(false)}
 useEffect(()=>{if(card&&time===0&&!feedback&&!busy)void answer(-1)},[card?.id,time,!!feedback,busy]);
 useEffect(()=>{if(!feedback)return;const id=setTimeout(()=>{setCard(null);setFeedback(null);setError('')},4800);return()=>clearTimeout(id)},[feedback]);
 if(!enabled)return null;
 if(!card)return null;
 return <div className="blitzBackdrop" role="presentation"><section className="blitzCard" role="dialog" aria-modal="true" aria-label="Блиц-вопрос">
  <header><strong>Блиц · {card.topic}</strong><span aria-live="off">{feedback?'Ответ зафиксирован':time+' секунд'}</span></header>
  <h2>{card.question}</h2>
  <div className="blitzAnswers">{card.options.map((option,i)=><button key={i} type="button" disabled={busy||!!feedback||time===0} onClick={()=>void answer(i)} className={feedback?(i===feedback.correct_index?'correct':i===feedback.chosen_index?'incorrect':''):''}>{option}</button>)}</div>
  {feedback&&<footer><p><b>{feedback.is_correct?'Правильно':'Ответ неверный или время истекло.'}</b> {feedback.explanation}</p>{legal(feedback)}<button type="button" className="primary" onClick={()=>{setCard(null);setFeedback(null);setError('')}}>Продолжить игру</button></footer>}
  {error&&<p role="alert">{error}</p>}
 </section></div>;
}
export function BlitzArchive({gameId,userId}:{gameId:string;userId:string}){
 const [rows,setRows]=useState<Row[]>([]),[open,setOpen]=useState(false),[offset,setOffset]=useState(0),[error,setError]=useState('');
 async function load(next=0){const r=await supabase.rpc('blitz_archive',{p_game:gameId,p_student:userId,p_offset:next,p_limit:30});if(r.error){setError(r.error.message);return}setRows(prev=>next?[...prev,...(r.data as Row[])]:r.data as Row[]);setOffset(next+30)}
 return <div className="blitzArchiveWrap"><button type="button" onClick={()=>{setOpen(!open);if(!open)void load()}}>Блиц-вопросы</button>{open&&<section className="surface blitzArchive"><h2>Блиц-вопросы</h2>{error&&<p role="alert">{error}</p>}{!rows.length&&<p>Назначенных вопросов пока нет.</p>}{rows.map(r=><details key={r.id}><summary>{r.answered_at?(r.is_correct?'✓':'✕'):'◷'} · Этап {r.stage_no} · {r.question}</summary><p>{r.options?.map((o,i)=><span key={i} className={'blitzOption '+(r.answered_at&&i===r.correct_index?'correct':r.answered_at&&i===r.chosen_index?'incorrect':'')}>{o}</span>)}</p>{r.answered_at&&<p>{r.explanation} {legal(r)}</p>}</details>)}{rows.length>=offset&&<button type="button" onClick={()=>void load(offset)}>Загрузить ещё</button>}</section>}</div>;
}
