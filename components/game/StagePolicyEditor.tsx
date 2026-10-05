'use client';
import {useEffect,useState} from 'react';
import {CalendarClock,Save} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import StyledSelect from '../ui/StyledSelect';

const CONSEQUENCE_OPTIONS=[
 {value:'none',label:'Без игрового последствия'},
 {value:'representation_loss',label:'Потеря представительства'},
 {value:'regional_seat_loss',label:'Потеря региональных мест'},
 {value:'ghost_risk',label:'Рост риска Ghost voting'},
 {value:'presidential_rating_loss',label:'Снижение рейтинга кандидата'}
] as const;

const recommendedConsequence=(stageNo:number):typeof CONSEQUENCE_OPTIONS[number]['value']=>
 stageNo<=2?'representation_loss':stageNo===3?'regional_seat_loss':stageNo===5?'ghost_risk':stageNo===6?'presidential_rating_loss':'none';

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
 const [consequenceType,setConsequenceType]=useState<typeof CONSEQUENCE_OPTIONS[number]['value']>(recommendedConsequence(stageNo));
 const [consequenceMagnitude,setConsequenceMagnitude]=useState('');
 const [hours,setHours]=useState('24');
 const [unit,setUnit]=useState<'hours'|'days'>('hours');
 const [saving,setSaving]=useState(false);
 const [message,setMessage]=useState('');
 useEffect(()=>{
  if(!game||!stage)return;
  let active=true;
  const gameId=game.id;
  const stageDeadline=stage.deadline;
  async function loadRule(){
   const {data,error}=await supabase.from('stage_deadline_rules').select('*').eq('game_id',gameId).eq('stage_no',stageNo).maybeSingle();
   if(!active)return;
   if(error){setMessage(error.message);return}
   setDeadline(localDate(data?.deadline_at??stageDeadline));
   setInclusive(data?.inclusive??true);
   setPenalty(String(data?.penalty_points??0));
   setDescription(data?.penalty_description??'За просрочку отчёта по этапу');
   setConsequenceType((data?.consequence_type??recommendedConsequence(stageNo)) as typeof CONSEQUENCE_OPTIONS[number]['value']);
   setConsequenceMagnitude(data?.consequence_magnitude==null?'':String(data.consequence_magnitude));
  }
  const sync=(event:Event)=>{
   const detail=(event as CustomEvent<{gameId?:string;stageNo?:number}>).detail;
   if(detail?.gameId===gameId&&detail?.stageNo===stageNo)void loadRule();
  };
  void loadRule();
  window.addEventListener('gos-stage-policy-updated',sync);
  return()=>{active=false;window.removeEventListener('gos-stage-policy-updated',sync)};
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
  const consequenceNumber=Number(consequenceMagnitude);
  const consequenceValue=consequenceType==='none'?null:consequenceNumber;
  if(consequenceType!=='none'&&(!Number.isFinite(consequenceNumber)||consequenceNumber<=0)){setMessage('Укажите положительную величину игрового последствия.');return}
  setSaving(true);setMessage('');
  const ok=await configureStageDeadline(stageNo,deadline?new Date(deadline).toISOString():null,inclusive,n,description,consequenceType,consequenceValue);
  setSaving(false);
  setMessage(ok?'Единое правило этапа сохранено.':'Не удалось сохранить правило. Подробности в уведомлении приложения.');
 }
 if(!teacher)return null;
 return <section className="stagePolicyEditor" aria-label={'Дедлайн и штрафы этапа '+stageNo}>
  <h4><CalendarClock size={16} aria-hidden="true"/> Дедлайн и правило просрочки</h4>
  <p>Настройте правило один раз. При фиксации нарушения система автоматически применит указанный штраф или игровое последствие — повторно вводить их не потребуется.</p>
  <div className="stagePolicyQuick">
   <label>Через<input type="number" min="1" max="365" value={hours} onChange={e=>setHours(e.target.value)}/></label>
   <StyledSelect label="Единица" value={unit} onChange={v=>setUnit(v as 'hours'|'days')} options={[{value:'hours',label:'часов'},{value:'days',label:'дней'}]}/>
   <button type="button" onClick={fillRelative}>Рассчитать дату</button>
  </div>
  <div className="stagePolicyFields">
   <label>Дедлайн<input type="datetime-local" value={deadline} onChange={e=>setDeadline(e.target.value)}/></label>
   <StyledSelect label="Правило срока" value={inclusive?'inclusive':'exclusive'} onChange={v=>setInclusive(v==='inclusive')} options={[{value:'inclusive',label:'До, включительно'},{value:'exclusive',label:'Строго до указанного времени'}]}/>
   <label>Штраф студенту, баллов<input type="number" step="0.5" min="0" max="3" value={penalty} onChange={e=>setPenalty(e.target.value)}/></label>
   <StyledSelect label="Последствие для партии" value={consequenceType} onChange={v=>{setConsequenceType(v as typeof CONSEQUENCE_OPTIONS[number]['value']);if(v==='none')setConsequenceMagnitude('')}} options={CONSEQUENCE_OPTIONS.map(x=>({value:x.value,label:x.label}))}/>
   {consequenceType!=='none'&&<label>Величина последствия<div className="stagePolicyMagnitudeField"><input type="number" min="0.1" step="0.1" value={consequenceMagnitude} onChange={e=>setConsequenceMagnitude(e.target.value)} placeholder="0"/><span>{consequenceType==='representation_loss'||consequenceType==='regional_seat_loss'?'Мест':'Значение'}</span></div></label>}
   <label className="stagePolicyDescription">Основание правила<input type="text" maxLength={240} value={description} onChange={e=>setDescription(e.target.value)}/></label>
  </div>
  <div className="stagePolicyFooter"><button type="button" onClick={()=>setDeadline('')} disabled={saving}>Убрать срок</button><button type="button" onClick={()=>void save()} disabled={saving}><Save size={15} aria-hidden="true"/>{saving?'Сохранение…':'Сохранить правило'}</button></div>
  {message&&<p className="stagePolicyMessage" role="status">{message}</p>}
 </section>;
}
