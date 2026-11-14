'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {stageAnalysisPhase} from './stageAnalysisWindow';
import styles from './MandatoryStageAnalysis.module.css';

type Stage={stage_no:number;title:string;status:'open'|'completed'|'locked';completed_at:string|null};
type Saved={stage_no:number};

/** Non-modal analysis card: it must never prevent navigation to the next stage. */
export default function MandatoryStageAnalysis({gameId,userId,stages}:{gameId:string;userId:string;stages:Stage[]}){
 const [now,setNow]=useState(()=>Date.now());
 const [known,setKnown]=useState<Saved[]|null>(null);
 const [value,setValue]=useState('');
 const [collapsed,setCollapsed]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const request=useRef(0);
 const active=stages.filter(s=>s.stage_no>=1&&s.stage_no<=16&&stageAnalysisPhase(s,now)==='active')
  .sort((a,b)=>a.stage_no-b.stage_no);
 const windowKey=active.map(s=>s.stage_no+':'+s.completed_at).join(',');
 useEffect(()=>{
  // The clock is client-only. No timers poll Supabase.
  const id=window.setInterval(()=>setNow(Date.now()),30000);
  return()=>window.clearInterval(id);
 },[]);
 useEffect(()=>{
  let alive=true;
  const sequence=++request.current;
  setKnown(null);setError('');
  if(!active.length)return()=>{alive=false;request.current++};
  // One indexed, user-scoped metadata read for the eligible stages only.
  void supabase.from('stage_debriefs').select('stage_no')
   .eq('game_id',gameId).eq('user_id',userId).in('stage_no',active.map(s=>s.stage_no))
   .then(result=>{
    if(!alive||sequence!==request.current)return;
    if(result.error){setError('Не удалось проверить ранее сданные анализы.');return}
    setKnown((result.data||[]) as Saved[]);
   });
  return()=>{alive=false;request.current++};
 },[gameId,userId,windowKey]);

 const current=known===null?null:active.find(s=>!known.some(row=>row.stage_no===s.stage_no));
 useEffect(()=>{setValue('')},[current?.stage_no]);
 if(!active.length||(known!==null&&!current))return null;

 const completeAt=current?.completed_at?Date.parse(current.completed_at):0;
 const remaining=completeAt?Math.max(0,completeAt+3600000-now):0;
 const timeLabel=remaining<60000?'Менее минуты':Math.ceil(remaining/60000)+' мин';
 async function retry(){
  if(busy||!active.length)return;
  setBusy(true);setError('');
  const r=await supabase.from('stage_debriefs').select('stage_no')
   .eq('game_id',gameId).eq('user_id',userId).in('stage_no',active.map(s=>s.stage_no));
  if(r.error)setError('Не удалось проверить анализы. Повторите попытку.');
  else setKnown((r.data||[]) as Saved[]);
  setBusy(false);
 }
 async function submit(){
  if(!current||busy||value.trim().length<40||stageAnalysisPhase(current,Date.now())!=='active')return;
  const stageNo=current.stage_no;
  setBusy(true);setError('');
  const r=await supabase.rpc('submit_stage_debrief',{p_game_id:gameId,p_stage_no:stageNo,p_body:value.trim()});
  if(r.error)setError('Анализ не сохранён. Проверьте срок сдачи и соединение, затем повторите.');
  else setKnown(previous=>[...(previous||[]).filter(row=>row.stage_no!==stageNo),{stage_no:stageNo}]);
  setBusy(false);
 }
 return <section className={styles.card} aria-label="Обязательный анализ завершённого этапа">
  <header className={styles.heading}>
   <div>
    <small>ГОС.ID · АНАЛИЗ ЭТАПА</small>
    <h2>{current?'Этап '+current.stage_no+' · '+current.title:'Проверка анализа этапа'}</h2>
    <p>{current?'Этап завершён. Анализ обязателен в течение часа после завершения. Следующий этап доступен независимо от отправки.':'Проверяем уже отправленные работы…'}</p>
   </div>
   <button type="button" className="secondary" onClick={()=>setCollapsed(v=>!v)} aria-expanded={!collapsed}>
    {collapsed?'Развернуть':'Свернуть'}
   </button>
  </header>
  {current&&<div className={styles.clock} role="status">Осталось на отправку: <strong>{timeLabel}</strong></div>}
  {!collapsed&&<>
   {current?<div className={styles.content}>
    <label htmlFor="mandatory-stage-analysis-body">Причины решений, интересы участников, правила и политические последствия</label>
    <textarea id="mandatory-stage-analysis-body" rows={6} maxLength={12000} value={value} disabled={busy}
     onChange={e=>setValue(e.target.value)} placeholder="Проанализируйте результаты и последствия завершённого этапа."/>
    <p className={styles.hint}>{value.trim().length} знаков · не менее 40 для отправки</p>
   </div>:<div className={styles.content}><p>Загружаем сведения о сдаче анализа…</p></div>}
   {error&&<p className={styles.error} role="alert">{error}</p>}
   <footer className={styles.footer}>
    {current?<button type="button" className="primary" disabled={busy||remaining===0||value.trim().length<40}
     onClick={()=>void submit()}>{busy?'Сохраняем…':'Отправить анализ'}</button>
     :<button type="button" className="secondary" disabled={busy} onClick={()=>void retry()}>
      {busy?'Проверяем…':'Повторить проверку'}
     </button>}
   </footer>
  </>}
 </section>;
}
