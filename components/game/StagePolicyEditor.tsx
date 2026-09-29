'use client';
import {useEffect,useState} from 'react';
import {CalendarClock,Save} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';

function localDate(iso:string|null|undefined){
 if(!iso)return '';
 const date=new Date(iso);
 if(!Number.isFinite(date.getTime()))return '';
 const p=(n:number)=>String(n).padStart(2,'0');
 return date.getFullYear()+'-'+p(date.getMonth()+1)+'-'+p(date.getDate())+'T'+p(date.getHours())+':'+p(date.getMinutes());
}
export default function StagePolicyEditor({g,stageNo}:{g:ReturnTypeRepublic;stageNo:number}){
 const {game,stages,teacher,configureStageDeadline}=g;
 const stage=stages.find(s=>s.stage_no===stageNo);
 const [deadline,setDeadline]=useState('');
 const [inclusive,setInclusive]=useState(true);
 const [penalty,setPenalty]=useState('0');
 const [description,setDescription]=useState('За просрочку отчёта по этапу');
 const [hours,setHours]=useState('24');
 const [unit,setUnit]=useState<'hours'|'days'>('hours');
 const [saving,setSaving]=useState(false);
 const [message,setMessage]=useState('');
 useEffect(()=>{
  if(!game||!stage)return;
  let active=true;
  void supabase.from('stage_deadline_rules').select('*').eq('game_id',game.id).eq('stage_no',stageNo).maybeSingle()
   .then(({data,error})=>{
    if(!active)return;
    if(error){setMessage(error.message);return}
    setDeadline(localDate(data?.deadline_at??stage.deadline));
    setInclusive(data?.inclusive??true);
    setPenalty(String(data?.penalty_points??0));
    setDescription(data?.penalty_description??'За просрочку отчёта по этапу');
   });
  return()=>{active=false};
 },[game?.id,stageNo,stage?.deadline]);
 function fillRelative(){
  const n=Number(hours);
  if(!Number.isFinite(n)||n<=0||n>365){setMessage('Укажите от 1 до 365 часов или дней.');return}
  setDeadline(localDate(new Date(Date.now()+n*(unit==='days'?86400000:3600000)).toISOString()));
  setMessage('');
 }
 async function save(){
  const n=Number(penalty);
  if(!Number.isFinite(n)||n<0||n>3){setMessage('Штраф должен быть от 0 до 3 баллов.');return}
  if(deadline&&!Number.isFinite(new Date(deadline).getTime())){setMessage('Некорректная дата.');return}
  setSaving(true);setMessage('');
  const ok=await configureStageDeadline(stageNo,deadline?new Date(deadline).toISOString():null,inclusive,n,description);
  setSaving(false);
  setMessage(ok?'Правило сохранено для этапа '+stageNo+'.':'Не удалось сохранить правило. Подробности в уведомлении приложения.');
 }
 if(!teacher)return null;
 return <section className="stagePolicyEditor" aria-label={'Дедлайн и штрафы этапа '+stageNo}>
  <h4><CalendarClock size={16} aria-hidden="true"/> Сроки и штрафы</h4>
  <p>Укажите точный момент окончания. Правило хранится отдельно от оценок; установление штрафа само по себе не изменяет утверждённые оценки.</p>
  <div className="stagePolicyQuick">
   <label>Через<input type="number" min="1" max="365" value={hours} onChange={e=>setHours(e.target.value)}/></label>
   <label>Единица<select value={unit} onChange={e=>setUnit(e.target.value as 'hours'|'days')}><option value="hours">часов</option><option value="days">дней</option></select></label>
   <button type="button" onClick={fillRelative}>Рассчитать дату</button>
  </div>
  <div className="stagePolicyFields">
   <label>Дедлайн — до, включительно<input type="datetime-local" value={deadline} onChange={e=>setDeadline(e.target.value)}/></label>
   <label>Формулировка<select value={inclusive?'inclusive':'exclusive'} onChange={e=>setInclusive(e.target.value==='inclusive')}><option value="inclusive">До, включительно</option><option value="exclusive">Строго до указанного времени</option></select></label>
   <label>Штраф, баллов<input type="number" step="0.5" min="0" max="3" value={penalty} onChange={e=>setPenalty(e.target.value)}/></label>
   <label className="stagePolicyDescription">Основание штрафа<input type="text" maxLength={240} value={description} onChange={e=>setDescription(e.target.value)}/></label>
  </div>
  <div className="stagePolicyFooter"><button type="button" onClick={()=>setDeadline('')} disabled={saving}>Убрать срок</button><button type="button" onClick={()=>void save()} disabled={saving}><Save size={15} aria-hidden="true"/>{saving?'Сохранение…':'Сохранить правило'}</button></div>
  {message&&<p className="stagePolicyMessage" role="status">{message}</p>}
 </section>;
}
