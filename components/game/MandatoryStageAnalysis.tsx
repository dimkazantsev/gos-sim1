'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import styles from './MandatoryStageAnalysis.module.css';

type Stage={stage_no:number;title:string};
type Saved={stage_no:number;body:string};
export default function MandatoryStageAnalysis({gameId,userId,completedStages,onComplete}:{
 gameId:string;userId:string;completedStages:Stage[];onComplete:()=>void
}){
 const ordered=[...completedStages].filter(s=>s.stage_no>=1&&s.stage_no<=16).sort((a,b)=>a.stage_no-b.stage_no);
 const [known,setKnown]=useState<Saved[]|null>(null);
 const [value,setValue]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const request=useRef(0);
 const dialog=useRef<HTMLElement>(null);
 const resolved=useRef(false);
 const completedKey=ordered.map(s=>s.stage_no).join(',');
 useEffect(()=>{
  let active=true;const sequence=++request.current;
  async function load(){
   // No per-stage query: one indexed user-scoped read, only after closure.
   const result=await supabase.from('stage_debriefs').select('stage_no,body')
    .eq('game_id',gameId).eq('user_id',userId)
    .in('stage_no',ordered.map(s=>s.stage_no));
   if(!active||sequence!==request.current)return;
   if(result.error){setError('Не удалось проверить анализы. Проверьте подключение и повторите запрос.');return}
   setKnown((result.data||[]) as Saved[]);setError('');
  }
  if(ordered.length)void load();
  return()=>{active=false;request.current++};
 },[gameId,userId,completedKey]);
 const remaining=known===null?[]:ordered.filter(s=>!known.some(r=>r.stage_no===s.stage_no));
 const current=remaining[0];
 useEffect(()=>{
  if(known!==null&&!remaining.length&&!resolved.current){resolved.current=true;onComplete();}
 },[known,remaining.length,onComplete]);
 useEffect(()=>{
  if(current)setValue('');
 },[current?.stage_no]);
 useEffect(()=>{
  if(current)dialog.current?.focus();
  const previous=document.body.style.overflow;
  if(current)document.body.style.overflow='hidden';
  return()=>{document.body.style.overflow=previous};
 },[current?.stage_no]);
 async function retry(){
  if(busy)return;setBusy(true);setError('');
  const result=await supabase.from('stage_debriefs').select('stage_no,body').eq('game_id',gameId)
   .eq('user_id',userId).in('stage_no',ordered.map(s=>s.stage_no));
  if(result.error)setError('Не удалось загрузить анализы. Повторите запрос.');
  else setKnown((result.data||[]) as Saved[]);
  setBusy(false);
 }
 async function submit(){
  if(!current||busy||value.trim().length<40)return;
  setBusy(true);setError('');
  const stageNo=current.stage_no,body=value.trim();
  const result=await supabase.rpc('submit_stage_debrief',{p_game_id:gameId,p_stage_no:stageNo,p_body:body});
  if(result.error){
   setError('Не удалось сохранить анализ. Текст сохранён в этом окне. Повторите отправку.');
  }else{
   setKnown(previous=>[...(previous||[]).filter(r=>r.stage_no!==stageNo),{stage_no:stageNo,body}]);
  }
  setBusy(false);
 }
 if(!ordered.length||resolved.current)return null;
 return <div className={styles.backdrop}>
  <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="mandatory-stage-analysis-title"
   aria-describedby="mandatory-stage-analysis-description" tabIndex={-1} ref={dialog}
   onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();}}}>
   <div className={styles.heading}>
    <small>ГОС.ID · ОБЯЗАТЕЛЬНЫЙ АНАЛИЗ</small>
    <h2 id="mandatory-stage-analysis-title">{current?'Этап '+current.stage_no+' · '+current.title:'Проверка завершённых этапов'}</h2>
    <p id="mandatory-stage-analysis-description">После закрытия этапа преподавателем необходимо сдать индивидуальный анализ. Окно закроется автоматически после отправки всех накопившихся анализов.</p>
   </div>
   {current?<div className={styles.content}>
    <div className={styles.counter}><strong>Этап {current.stage_no} из 16</strong><span>Осталось анализов: {remaining.length}</span></div>
    <label htmlFor="mandatory-stage-analysis-body">Анализ принятых решений, причин, интересов участников, применённых правил и политических последствий</label>
    <textarea id="mandatory-stage-analysis-body" rows={8} maxLength={12000} value={value}
     onChange={event=>setValue(event.target.value)} placeholder="Опишите, что произошло на этапе, какие решения принимались и почему, каковы их результаты и последствия."/>
    <p className={styles.hint}>{value.trim().length} знаков · для отправки необходимо не менее 40</p>
   </div>:<div className={styles.content}><p>Проверяем уже отправленные анализы…</p></div>}
   {error&&<p className={styles.error} role="alert">{error}</p>}
   <footer className={styles.footer}>
    {current?<button type="button" className="primary" onClick={()=>void submit()}
      disabled={busy||value.trim().length<40}>{busy?'Сохраняем…':'Отправить анализ и продолжить'}</button>
    :<button type="button" className="secondary" disabled={busy} onClick={()=>void retry()}>{busy?'Проверяем…':'Повторить проверку'}</button>}
   </footer>
  </section>
 </div>;
}
