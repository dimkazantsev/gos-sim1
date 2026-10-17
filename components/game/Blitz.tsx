'use client';
import {useEffect,useState,useRef,useCallback} from 'react';
import {createPortal} from 'react-dom';
import {RefreshCw,X} from 'lucide-react';
import {useDialog} from '../ui/useDialog';
import {supabase} from '@/lib/supabase';
type Row={id:string;question:string|null;topic:string;options:string[]|null;stage_no:number;available_at?:string;started_at?:string|null;deadline?:string;answered_at?:string|null;chosen_index?:number|null;correct_index?:number|null;is_correct?:boolean|null;explanation?:string|null;legal_act?:string|null;article?:string|null;source_url?:string|null};
const legal=(r:Row)=>r.source_url&&/^https:\/\//.test(r.source_url)?<a href={r.source_url} target="_blank" rel="noopener noreferrer">{r.legal_act}, {r.article} ↗</a>:<span>{r.legal_act} {r.article}</span>;
export function BlitzOverlay({gameId,enabled}:{gameId:string;enabled:boolean}){
 const refreshBusy=useRef(false),answerBusy=useRef(false),selectedQueued=useRef('');
 const since=useRef(new Date().toISOString());
 const archiveShowing=useRef(false);
 useEffect(()=>{const opened=()=>{archiveShowing.current=true},closed=()=>{archiveShowing.current=false};window.addEventListener('blitz:archive-open',opened);window.addEventListener('blitz:archive-close',closed);return()=>{window.removeEventListener('blitz:archive-open',opened);window.removeEventListener('blitz:archive-close',closed)}},[]);
 const [card,setCard]=useState<Row|null>(null),[feedback,setFeedback]=useState<Row|null>(null),[time,setTime]=useState(20),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{since.current=new Date().toISOString();setCard(null);setFeedback(null)},[gameId]);
 useEffect(()=>{
  if(!enabled||card||feedback)return;
  let stopped=false;
  async function refresh(selectedId=''){
   if(archiveShowing.current&&!selectedId)return;
   if(refreshBusy.current){if(selectedId)selectedQueued.current=selectedId;return}
   refreshBusy.current=true;
   try{
    const issued=await supabase.rpc('blitz_issue_today',{p_game:gameId});
    if(issued.error){if(selectedId&&!stopped)setError('Не удалось подготовить блиц-вопрос.');return}
    if(issued.data>0)window.dispatchEvent(new Event('blitz:updated'));
    const result=selectedId
     ?await supabase.rpc('blitz_open_selected',{p_id:selectedId})
     :await supabase.rpc('blitz_open_recent',{p_game:gameId,p_not_before:since.current});
    if(stopped)return;
    if(result.error){if(selectedId)setError(result.error.message);return}
    if(result.data){
     const question=result.data as Row;
     setCard(question);
     setTime(Math.max(0,Math.ceil((Date.parse(question.deadline||'')-Date.now())/1000)));
     setError('');
    }else if(selectedId){setError('Вопрос уже закрыт или недоступен. Обновите историю.');window.dispatchEvent(new Event('blitz:updated'))}
   }finally{
    refreshBusy.current=false;
    const queued=selectedQueued.current;selectedQueued.current='';
    if(queued&&!stopped)void refresh(queued);
   }
  }
  void refresh();
  const id=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh()},45000);
  const request=(event:Event)=>void refresh((event as CustomEvent<{assignmentId?:string}>).detail?.assignmentId||'');
  window.addEventListener('blitz:open',request);
  return()=>{stopped=true;window.clearInterval(id);window.removeEventListener('blitz:open',request)}
 },[gameId,enabled,!!card,!!feedback]);
 useEffect(()=>{if(!card?.deadline)return;const f=()=>setTime(Math.max(0,Math.ceil((Date.parse(card.deadline!)-Date.now())/1000)));f();const id=setInterval(f,250);return()=>clearInterval(id)},[card?.deadline]);
 async function answer(choice:number){if(!card||answerBusy.current||busy||feedback)return;answerBusy.current=true;setBusy(true);try{const r=await supabase.rpc('blitz_answer',{p_id:card.id,p_choice:choice});if(r.error)setError(r.error.message);else{setError('');setFeedback({...card,...r.data});window.dispatchEvent(new Event('blitz:updated'))}}catch(e){setError(e instanceof Error?e.message:'Ответ не отправлен. Повторите попытку.')}finally{answerBusy.current=false;setBusy(false)}}
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
export function BlitzArchive({gameId,userId,open,onClose}:{gameId:string;userId:string;open:boolean;onClose:()=>void}){
 const [rows,setRows]=useState<Row[]>([]),[filter,setFilter]=useState<'pending'|'answered'>('pending');
 const [offset,setOffset]=useState(0),[hasMore,setHasMore]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const [counts,setCounts]=useState({pending:0,scheduled:0,answered:0});
 const [active,setActive]=useState<Row|null>(null),[activeFeedback,setActiveFeedback]=useState<Row|null>(null);
 const [activeSeconds,setActiveSeconds]=useState(20),[activeError,setActiveError]=useState('');
 const [answerBusy,setAnswerBusy]=useState(false);
 const activeLock=useRef(false);
 async function openSelected(id:string){
  if(active||activeLock.current)return;
  activeLock.current=true;setActiveError('');
  try{
   const result=await supabase.rpc('blitz_open_selected',{p_id:id});
   if(result.error){setActiveError(result.error.message);void refresh();return;}
   if(!result.data){setActiveError('Вопрос уже закрыт или недоступен.');void refresh();return;}
   const question=result.data as Row;
   setActive(question);
   setActiveSeconds(Math.max(0,Math.ceil((Date.parse(question.deadline||'')-Date.now())/1000)));
  }catch(e){setActiveError(e instanceof Error?e.message:'Вопрос не открылся.')}
  finally{activeLock.current=false;}
 }
 async function answerSelected(choice:number){
  if(!active||activeFeedback||answerBusy||activeLock.current)return;
  activeLock.current=true;setAnswerBusy(true);setActiveError('');
  try{
   const result=await supabase.rpc('blitz_answer',{p_id:active.id,p_choice:choice});
   if(result.error)setActiveError('Ответ не сохранён: '+result.error.message);
   else{setActiveFeedback({...active,...result.data});window.dispatchEvent(new Event('blitz:updated'));}
  }catch(e){setActiveError(e instanceof Error?e.message:'Ответ не отправлен.')}
  finally{activeLock.current=false;setAnswerBusy(false);}
 }
 useEffect(()=>{
  if(!active?.deadline||activeFeedback)return;
  const tick=()=>setActiveSeconds(Math.max(0,Math.ceil((Date.parse(active.deadline||'')-Date.now())/1000)));
  tick();const timer=window.setInterval(tick,250);return()=>window.clearInterval(timer);
 },[active?.deadline,!!activeFeedback]);
 useEffect(()=>{if(active&&activeSeconds===0&&Date.now()>=Date.parse(active.deadline||'')&&!activeFeedback&&!answerBusy)void answerSelected(-1)},[active?.id,activeSeconds,!!activeFeedback,answerBusy]);
 useEffect(()=>{if(!activeFeedback)return;const timer=window.setTimeout(()=>{setActive(null);setActiveFeedback(null);void refresh()},4800);return()=>window.clearTimeout(timer)},[activeFeedback]);
 useEffect(()=>{if(!open)return;window.dispatchEvent(new Event('blitz:archive-open'));return()=>{window.dispatchEvent(new Event('blitz:archive-close'))}},[open]);

 const request=useRef(0);
 const dialogRef=useDialog(open,onClose);
 const load=useCallback(async(next=0)=>{
  const token=++request.current;
  setLoading(true);setError('');
  const r=await supabase.rpc('blitz_archive_filtered',{p_game:gameId,p_student:userId,p_state:filter,p_offset:next,p_limit:30});
  if(token!==request.current)return;
  if(r.error)setError('Не удалось загрузить блиц-вопросы. Повторите запрос.');
  else{
   const page=Array.isArray(r.data)?r.data as Row[]:[];
   setRows(old=>next?[...old.filter(x=>!page.some(y=>y.id===x.id)),...page]:page);
   setOffset(next+page.length);setHasMore(page.length===30);
  }
  setLoading(false);
 },[gameId,userId,filter]);
 const refresh=useCallback(async()=>{
  const r=await supabase.rpc('blitz_inbox_counts',{p_game:gameId});
  if(!r.error&&r.data)setCounts(r.data as typeof counts);
  await load(0);
 },[gameId,load]);
 useEffect(()=>{setRows([]);setOffset(0);setHasMore(false);if(open)void refresh();return()=>{request.current++}},[gameId,userId,filter,open,refresh]);
 useEffect(()=>{
  if(!open)return;
  const update=()=>{if(!active)void refresh()};
  window.addEventListener('blitz:updated',update);
  const timer=window.setInterval(()=>{if(!active&&document.visibilityState==='visible')void refresh()},20000);
  return()=>{window.removeEventListener('blitz:updated',update);window.clearInterval(timer)};
 },[open,refresh,active?.id]);
 if(!open||typeof document==='undefined')return null;
 return createPortal(<div className="blitzArchiveBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
  <section ref={dialogRef} tabIndex={-1} className="surface blitzArchive blitzArchiveModal" role="dialog" aria-modal="true" aria-label="История блиц-вопросов">
   <header className="blitzArchiveHeader"><div><small>ПРАВОВЫЕ ЗНАНИЯ</small><h2>Блиц-вопросы</h2><p>Новые вопросы сохраняются, даже когда вы не в игре. При открытии начинается отсчёт 20 секунд.</p></div>
    <button type="button" onClick={onClose} className="blitzArchiveClose" aria-label="Закрыть блиц-вопросы"><X size={19}/></button></header>
   <div className="blitzArchiveTabs" role="tablist" aria-label="Статус блиц-вопросов">
    <button type="button" role="tab" aria-selected={filter==='pending'} className={filter==='pending'?'active':''} onClick={()=>{if(!active)setFilter('pending')}}>Ответ не дан <span>{counts.pending}{counts.scheduled?' +'+counts.scheduled+' позже':''}</span></button>
    <button type="button" role="tab" aria-selected={filter==='answered'} className={filter==='answered'?'active':''} onClick={()=>{if(!active)setFilter('answered')}}>Ответ дан <span>{counts.answered}</span></button>
    <button type="button" onClick={()=>void refresh()} disabled={loading} className="blitzArchiveRefresh" aria-label="Обновить историю"><RefreshCw size={17}/></button>
   </div>
   {error&&<p role="alert">{error}</p>}
   {activeError&&<p role="alert">{activeError}</p>}
   {loading&&<p role="status">Обновление списка…</p>}
   {!loading&&!error&&!rows.length&&<p className="blitzArchiveEmpty">{filter==='pending'?'Неотвеченных вопросов нет.':'Ответов пока нет.'}</p>}
   <div className="blitzArchiveList">{rows.map((r,index)=>{
    const answered=Boolean(r.answered_at),correct=answered&&r.is_correct===true;
    const available=!r.available_at||Date.parse(r.available_at)<=Date.now();
    const choice=r.chosen_index==null||r.chosen_index<0?'Ответ не дан (время истекло)':r.options?.[r.chosen_index]||'Ответ не найден';
    const correctAnswer=r.correct_index!=null&&r.correct_index>=0?r.options?.[r.correct_index]||'Ответ недоступен':'Ответ недоступен';
    return <article key={r.id} className={'blitzHistoryCard '+(answered?(correct?'isCorrect':'isIncorrect'):'isPending')}>
     <div className="blitzHistoryMeta"><span className="blitzHistoryStage">Этап {r.stage_no}{answered&&r.topic?' · '+r.topic:''}</span><span className="blitzHistoryStatus">{answered?(correct?'Верно':'Неверно'):available?'Ожидает ответа':'Запланирован'}</span></div>
     {answered?<><p className="blitzHistoryQuestion">{r.question}</p>
      <div className="blitzHistoryAnswers"><div className="blitzHistoryAnswer blitzHistoryAnswerCorrect"><span>Правильный ответ</span><strong>{correctAnswer}</strong></div>
       <div className="blitzHistoryAnswer blitzHistoryAnswerStudent"><span>Ваш ответ</span><strong>{choice}</strong></div></div>
      {(r.explanation||r.legal_act||r.source_url)&&<details className="blitzHistoryExplain"><summary>Пояснение и правовой источник</summary>{r.explanation&&<p>{r.explanation}</p>}{(r.legal_act||r.source_url)&&legal(r)}</details>}
     </>:<div className="blitzHistoryPending"><button type="button" className="blitzPendingQuestion" disabled={!available||!!active} onClick={()=>void openSelected(r.id)}>Блиц-вопрос № {index+1}</button><p>Текст и варианты появятся только после начала попытки. С этого момента даётся 20 секунд на ответ.</p>
      <button type="button" className="secondary" disabled={!available||!!active} onClick={()=>void openSelected(r.id)}>{available?'Начать · 20 секунд':'Пока недоступен'}</button></div>}

     {active?.id===r.id&&<div className="blitzInlineQuiz" role="group" aria-label="Открытый блиц-вопрос">
      <div className="blitzInlineTimer"><strong>Вопрос открыт</strong><span>{activeFeedback?'Ответ сохранён':activeSeconds+' секунд'}</span></div>
      <h3>{active.question}</h3>
      <div className="blitzAnswers">{(active.options||[]).map((option,i)=>
       <button key={i} type="button" disabled={answerBusy||!!activeFeedback||activeSeconds===0} onClick={()=>void answerSelected(i)}
        className={activeFeedback?(i===activeFeedback.correct_index?'correct':i===activeFeedback.chosen_index?'incorrect':''):''}>{option}</button>
      )}</div>
      {activeFeedback&&<p className="blitzInlineFeedback">{activeFeedback.is_correct?'Верно.':'Неверно или время истекло.'} {activeFeedback.explanation}</p>}
     </div>}
    </article>;
   })}</div>
   {hasMore&&<button type="button" className="secondary blitzArchiveMore" disabled={loading} onClick={()=>void load(offset)}>Загрузить ещё 30</button>}
  </section></div>,document.body);
}
