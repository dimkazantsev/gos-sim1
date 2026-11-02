'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {stageAnalysisPhase} from './stageAnalysisWindow';
import styles from './MandatoryStageAnalysis.module.css';

type Stage={stage_no:number;title:string;status:'open'|'completed'|'locked';deadline:string|null};
type Saved={stage_no:number};
export default function MandatoryStageAnalysis({gameId,userId,stages,onComplete}:{
 gameId:string;userId:string;stages:Stage[];onComplete:()=>void
}){
 const ordered=[...stages].filter(s=>s.stage_no>=1&&s.stage_no<=16).sort((a,b)=>a.stage_no-b.stage_no);
 const [known,setKnown]=useState<Saved[]|null>(null);
 const [acknowledged,setAcknowledged]=useState<number[]>([]);
 const [value,setValue]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const request=useRef(0);
 const dialog=useRef<HTMLElement>(null);
 const resolved=useRef(false);
 const windowKey=ordered.map(s=>s.stage_no+':'+s.status+':'+(s.deadline||'')).join(',');
 useEffect(()=>{
  let active=true;
  const sequence=++request.current;
  async function load(){
   // One indexed, user-scoped metadata read. Never download previously written texts.
   const result=await supabase.from('stage_debriefs').select('stage_no')
    .eq('game_id',gameId).eq('user_id',userId)
    .in('stage_no',ordered.map(s=>s.stage_no));
   if(!active||sequence!==request.current)return;
   if(result.error){setError('Не удалось проверить сданные анализы. Повторите запрос.');return}
   setKnown((result.data||[]) as Saved[]);setError('');
  }
  if(ordered.length)void load();
  return()=>{active=false;request.current++};
 },[gameId,userId,windowKey]);
 const now=Date.now();
 const remaining=known===null?[]:ordered.filter(s=>!acknowledged.includes(s.stage_no)&&
  !known.some(row=>row.stage_no===s.stage_no)&&
  ['active','expired'].includes(stageAnalysisPhase(s,now)));
 const current=remaining[0];
 const expired=!!current&&stageAnalysisPhase(current,now)==='expired';
 const blocking=!!current&&!expired;
 useEffect(()=>{
  if(known!==null&&!remaining.length&&!resolved.current){resolved.current=true;onComplete()}
 },[known,remaining.length,onComplete]);
 useEffect(()=>{if(current)setValue('')},[current?.stage_no]);
 useEffect(()=>{
  dialog.current?.focus();
  if(!blocking)return;
  const previous=document.body.style.overflow;
  document.body.style.overflow='hidden';
  return()=>{document.body.style.overflow=previous};
 },[blocking,current?.stage_no]);
 async function retry(){
  if(busy)return;setBusy(true);setError('');
  const result=await supabase.from('stage_debriefs').select('stage_no').eq('game_id',gameId)
   .eq('user_id',userId).in('stage_no',ordered.map(s=>s.stage_no));
  if(result.error)setError('Не удалось проверить анализы. Повторите запрос.');
  else setKnown((result.data||[]) as Saved[]);
  setBusy(false);
 }
 async function submit(){
  if(!current||expired||busy||value.trim().length<40)return;
  const stageNo=current.stage_no,body=value.trim();
  setBusy(true);setError('');
  const result=await supabase.rpc('submit_stage_debrief',{p_game_id:gameId,p_stage_no:stageNo,p_body:body});
  if(result.error){
   setError('Анализ не сохранён. Если срок этапа истёк, отправка уже недоступна. Иначе проверьте подключение и повторите попытку.');
  }else{
   setKnown(previous=>[...(previous||[]).filter(r=>r.stage_no!==stageNo),{stage_no:stageNo}]);
  }
  setBusy(false);
 }
 function acknowledge(){
  if(!current||!expired)return;
  setAcknowledged(previous=>[...previous,current.stage_no]);
 }
 if(!ordered.length||resolved.current)return null;
 return <div className={styles.backdrop}>
  <section className={styles.dialog} role="dialog" aria-modal={blocking}
   aria-labelledby="mandatory-stage-analysis-title" aria-describedby="mandatory-stage-analysis-description"
   tabIndex={-1} ref={dialog} onKeyDown={event=>{
    if(event.key==='Escape'){
     if(blocking){event.preventDefault();event.stopPropagation()}
     else if(expired){event.preventDefault();acknowledge()}
    }
   }}>
   <div className={styles.heading}>
    <small>ГОС.ID · АНАЛИЗ ЭТАПА</small>
    <h2 id="mandatory-stage-analysis-title">{current?'Этап '+current.stage_no+' · '+current.title:'Проверка анализов'}</h2>
    <p id="mandatory-stage-analysis-description">{expired
     ?'Этап уже завершён. Отправка анализа этого этапа недоступна.'
     :'За час до окончания этапа необходимо отправить индивидуальный анализ. После успешной отправки окно закроется автоматически.'}</p>
   </div>
   {current?<div className={styles.content}>
    <div className={styles.counter}><strong>Этап {current.stage_no} из 16</strong><span>Осталось этапов: {remaining.length}</span></div>
    {expired?<p>Срок сдачи истёк. Этот анализ нельзя отправить или изменить. Уже сданные анализы сохраняются.</p>:<>
     <label htmlFor="mandatory-stage-analysis-body">Причины решений, интересы участников, правила и политические последствия</label>
     <textarea id="mandatory-stage-analysis-body" rows={8} maxLength={12000} value={value}
      onChange={event=>setValue(event.target.value)} placeholder="Проанализируйте результаты и последствия этапа."/>
     <p className={styles.hint}>{value.trim().length} знаков · не менее 40 для отправки</p>
    </>}
   </div>:<div className={styles.content}><p>{error?'Не удалось проверить сохранённые работы.':'Проверяем сохранённые анализы…'}</p></div>}
   {error&&<p className={styles.error} role="alert">{error}</p>}
   <footer className={styles.footer}>
    {expired?<button type="button" className="secondary" onClick={acknowledge}>Понятно{remaining.length>1?' · далее':''}</button>
    :current?<button type="button" className="primary" onClick={()=>void submit()} disabled={busy||value.trim().length<40}>
      {busy?'Сохраняем…':'Отправить анализ и продолжить'}
     </button>
    :<button type="button" className="secondary" disabled={busy} onClick={()=>void retry()}>{busy?'Проверяем…':'Повторить проверку'}</button>}
   </footer>
  </section>
 </div>;
}
