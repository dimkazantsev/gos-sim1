'use client';
import {useEffect,useState,useRef} from 'react';
import {supabase} from '@/lib/supabase';
type Row={id:string;question:string|null;topic:string;options:string[]|null;stage_no:number;available_at?:string;deadline?:string;answered_at?:string|null;chosen_index?:number|null;correct_index?:number|null;is_correct?:boolean|null;explanation?:string|null;legal_act?:string|null;article?:string|null;source_url?:string|null};
const legal=(r:Row)=>r.source_url&&/^https:\/\//.test(r.source_url)?<a href={r.source_url} target="_blank" rel="noopener noreferrer">{r.legal_act}, {r.article} ↗</a>:<span>{r.legal_act} {r.article}</span>;
export function BlitzOverlay({gameId,enabled}:{gameId:string;enabled:boolean}){
 const refreshBusy=useRef(false),answerBusy=useRef(false);
 const [card,setCard]=useState<Row|null>(null),[feedback,setFeedback]=useState<Row|null>(null),[time,setTime]=useState(20),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(!enabled||card||feedback)return;let stopped=false;async function refresh(){if(refreshBusy.current)return;refreshBusy.current=true;try{const d=await supabase.rpc('blitz_issue_today',{p_game:gameId});if(d.error){setError('');return}const r=await supabase.rpc('blitz_open',{p_game:gameId});if(!stopped&&!r.error&&r.data){setTime(Math.max(0,Math.ceil((Date.parse(r.data.deadline)-Date.now())/1000)));setCard(r.data as Row)}}finally{refreshBusy.current=false}}void refresh();const id=setInterval(()=>void refresh(),90000);const request=()=>{void refresh()};window.addEventListener('blitz:open',request);return()=>{stopped=true;clearInterval(id);window.removeEventListener('blitz:open',request)}},[gameId,enabled,!!card,!!feedback]);
 useEffect(()=>{if(!card?.deadline)return;const f=()=>setTime(Math.max(0,Math.ceil((Date.parse(card.deadline!)-Date.now())/1000)));f();const id=setInterval(f,250);return()=>clearInterval(id)},[card?.deadline]);
 async function answer(choice:number){if(!card||answerBusy.current||busy||feedback)return;answerBusy.current=true;setBusy(true);try{const r=await supabase.rpc('blitz_answer',{p_id:card.id,p_choice:choice});if(r.error)setError(r.error.message);else{setError('');setFeedback({...card,...r.data})}}catch(e){setError(e instanceof Error?e.message:'Ответ не отправлен. Повторите попытку.')}finally{answerBusy.current=false;setBusy(false)}}
 useEffect(()=>{if(card?.deadline&&time===0&&Date.now()>=Date.parse(card.deadline)&&!feedback&&!busy)void answer(-1)},[card?.id,card?.deadline,time,!!feedback,busy]);
 useEffect(()=>{if(!feedback)return;const id=setTimeout(()=>{setCard(null);setFeedback(null);setError('')},4800);return()=>clearTimeout(id)},[feedback]);
 if(!enabled)return null;
 if(!card)return null;
 return <div className="blitzBackdrop" role="presentation"><section className="blitzCard" role="dialog" aria-modal="true" aria-label="Блиц-вопрос">
  <header><strong>Блиц · {card.topic}</strong><span aria-live="off">{feedback?'Ответ зафиксирован':time+' секунд'}</span></header>
  <h2>{card.question}</h2>
  <div className="blitzAnswers">{(card.options||[]).map((option,i)=><button key={i} type="button" disabled={busy||!!feedback||time===0} onClick={()=>void answer(i)} className={feedback?(i===feedback.correct_index?'correct':i===feedback.chosen_index?'incorrect':''):''}>{option}</button>)}</div>
  {feedback&&<footer><p><b>{feedback.is_correct?'Правильно':'Ответ неверный или время истекло.'}</b> {feedback.explanation}</p>{legal(feedback)}<button type="button" className="primary" onClick={()=>{setCard(null);setFeedback(null);setError('')}}>Продолжить игру</button></footer>}
  {error&&<p role="alert">{error}</p>}
 </section></div>;
}
export function BlitzArchive({gameId,userId}:{gameId:string;userId:string}){
 const [rows,setRows]=useState<Row[]>([]),[offset,setOffset]=useState(0),[hasMore,setHasMore]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const request=useRef(0);
 async function load(next=0){
  const token=++request.current;setLoading(true);setError('');
  const r=await supabase.rpc('blitz_archive',{p_game:gameId,p_student:userId,p_offset:next,p_limit:30});
  if(token!==request.current)return;
  if(r.error)setError('Не удалось загрузить историю блиц-вопросов. Повторите запрос.');
  else{
   const page=Array.isArray(r.data)?r.data as Row[]:[];
   setRows(old=>next?[...old,...page]:page);setOffset(next+page.length);setHasMore(page.length===30);
  }
  setLoading(false);
 }
 useEffect(()=>{setRows([]);setOffset(0);setHasMore(false);void load(0);return()=>{request.current++}},[gameId,userId]);
 return <section className="surface blitzArchive" id="profile-blitz-archive" aria-label="Личный раздел блиц-вопросов">
  <header className="blitzArchiveHeader">
   <div><small>ПРАВОВЫЕ ЗНАНИЯ</small><h2>Блиц-вопросы</h2><p>История ответов по этапам: вопрос, правильный ответ и ваш выбор. На новый вопрос отводится 20 секунд.</p></div>
   <strong>{rows.length} записей{hasMore?' (есть ещё)':''}</strong>
  </header>
  <div className="blitzArchiveToolbar"><button type="button" className="secondary" disabled={loading} onClick={()=>void load(0)}>Обновить историю</button><button type="button" className="primary" onClick={()=>window.dispatchEvent(new Event('blitz:open'))}>Перейти к доступному вопросу</button></div>
  {error&&<p role="alert">{error}</p>}
  {loading&&<p role="status">Загрузка блиц-вопросов…</p>}
  {!loading&&!error&&!rows.length&&<p className="blitzArchiveEmpty">Назначенных вопросов пока нет. Новые задания появятся здесь автоматически.</p>}
  <div className="blitzArchiveList">{rows.map(r=>{
   const answered=Boolean(r.answered_at);
   const correct=answered&&r.is_correct===true;
   const unansweredChoice=r.chosen_index==null||r.chosen_index<0;
   const chosenAnswer=unansweredChoice?'Ответ не дан (время истекло)':r.options?.[r.chosen_index!]||'Ответ не найден';
   const correctAnswer=r.correct_index!=null&&r.correct_index>=0?r.options?.[r.correct_index]||'Ответ недоступен':'Ответ недоступен';
   const available=!r.available_at||Date.parse(r.available_at)<=Date.now();
   return <article key={r.id} className={'blitzHistoryCard '+(answered?(correct?'isCorrect':'isIncorrect'):'isPending')}>
    <div className="blitzHistoryMeta"><span className="blitzHistoryStage">Этап {r.stage_no}</span><span className="blitzHistoryStatus">{answered?(correct?'Верно':'Неверно'):'Ожидает ответа'}</span></div>
    <p className="blitzHistoryQuestion">{r.question||'Вопрос ожидает открытия'}</p>
    {answered?<div className="blitzHistoryAnswers">
     <div className="blitzHistoryAnswer blitzHistoryAnswerCorrect"><span>Правильный ответ</span><strong>{correctAnswer}</strong></div>
     <div className="blitzHistoryAnswer blitzHistoryAnswerStudent"><span>Ваш ответ</span><strong>{chosenAnswer}</strong></div>
    </div>:<div className="blitzHistoryPending">
     <p>Правильный ответ будет показан после завершения попытки.</p>
     <button type="button" className="secondary" disabled={!available} onClick={()=>window.dispatchEvent(new Event('blitz:open'))}>{available?'Ответить · 20 секунд':'Вопрос ещё не доступен'}</button>
    </div>}
    {answered&&(r.explanation||r.legal_act||r.source_url)&&<details className="blitzHistoryExplain"><summary>Пояснение и правовой источник</summary>{r.explanation&&<p>{r.explanation}</p>}{(r.legal_act||r.source_url)&&legal(r)}</details>}
   </article>;
  })}</div>
  {hasMore&&<button type="button" className="secondary blitzArchiveMore" disabled={loading} onClick={()=>void load(offset)}>Загрузить ещё 30</button>}
 </section>;
}
