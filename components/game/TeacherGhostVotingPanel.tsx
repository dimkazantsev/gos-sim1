'use client';
import {useEffect,useState} from 'react';
import {ShieldAlert,Save,RotateCcw} from 'lucide-react';
import type {ReturnTypeRepublic} from './viewTypes';
import StyledSelect from '../ui/StyledSelect';
export default function TeacherGhostVotingPanel({g}:{g:ReturnTypeRepublic}){
 const {parties,teacher,applyGhostVotingBatch,clearPartyGhostLoss}=g;
 const [losses,setLosses]=useState<Record<string,number>>({});
 const [scope,setScope]=useState<'all'|'selected'>('selected');
 const [chosen,setChosen]=useState('');
 const [uniform,setUniform]=useState('25');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 useEffect(()=>{
  setLosses(Object.fromEntries(parties.map(p=>[p.id,p.ghost_loss_current])));
  if(parties.length&&!parties.some(p=>p.id===chosen))setChosen(parties[0].id);
 },[parties]);
 const target=scope==='all'?parties:parties.filter(p=>p.id===chosen);
 const pendingLoss=parties.reduce((n,p)=>n+Math.max(0,Number(losses[p.id]??0)),0);
 const eligible=parties;
 function distribute(){
  const n=Number(uniform);
  if(!Number.isInteger(n)||n<0||n>50){setNotice('Укажите целое число от 0 до 50.');return}
  if(scope==='all'){
   const next=Object.fromEntries(parties.map(p=>[p.id,0])) as Record<string,number>;
   for(let i=0;i<n;i++){
    const available=parties.filter(p=>next[p.id]<50);
    const seed=new Uint32Array(1);crypto.getRandomValues(seed);
    const party=available[seed[0]%available.length];if(!party)break;
    next[party.id]++;
   }
   setLosses(prev=>({...prev,...next}));
   setNotice('Общая сумма '+n+' случайно распределена между '+parties.length+' партиями. Сохраните распределение.');
  }else{
   setLosses(prev=>({...prev,...Object.fromEntries(target.map(p=>[p.id,n]))}));
   setNotice('Для выбранной партии установлена потеря '+n+'. Сохраните распределение.');
  }
 }
 async function save(){
  if(!teacher||busy)return;
  const values=parties.map(p=>({party_id:p.id,loss:Number(losses[p.id]??0)}));
  if(!values.length){setNotice('Сначала назначьте мандаты партиям.');return}
  if(values.some((v,i)=>!Number.isInteger(v.loss)||v.loss<0||v.loss>50)){
   setNotice('Число плановой потери должно быть целым, от 0 до 50.');return
  }
  if(!window.confirm('Назначить выбранные потери мандатов всем указанным фракциям? Ранее установленные потери для них будут заменены.'))return;
  setBusy(true);const ok=await applyGhostVotingBatch(values);setBusy(false);
  setNotice(ok?'Потери мандатов сохранены для '+values.length+' фракций.':'Не удалось применить изменения. Проверьте уведомления игры.');
 }
 async function clear(){
  if(!window.confirm('Снять ограничения Ghost Voting со всех фракций?'))return;
  setBusy(true);const ok=await clearPartyGhostLoss();setBusy(false);
  setNotice(ok?'Полный состав фракций восстановлен.':'Не удалось восстановить мандаты.');
 }
 if(!teacher)return null;
 return <section className="teacherGhostPanel" aria-label="Настройка Ghost Voting">
  <header><div><small>НАСТРОЙКА СЦЕНАРИЯ</small><h2>Ghost Voting · распределение потерь</h2><p>Настройте отдельно каждую фракцию или назначьте одинаковое число всем. Сумма для всех партий распределяется случайно; для одной партии назначается выбранное значение. Не более 50 для каждой.</p></div><ShieldAlert size={24} aria-hidden="true"/></header>
  <div className="ghostBulk">
   <StyledSelect label="Применить к" value={scope} onChange={v=>setScope(v as typeof scope)}
    options={[{value:'selected',label:'Одной партии'},{value:'all',label:'Всем партиям'}]}/>
   {scope==='selected'&&<StyledSelect label="Партия" value={chosen} onChange={setChosen}
     options={parties.map(p=>({value:p.id,label:p.name}))}/>}
   <label>{scope==='all'?'Общая сумма потерь':'Потеря выбранной партии'}<input type="number" min="0" max="50" step="1" value={uniform} onChange={e=>setUniform(e.target.value)}/></label>
   <button type="button" onClick={distribute} disabled={!target.length}>Распределить</button>
  </div>
  <p className="ghostScenarioExplanation">Распределить — заполнить значения ниже, «Сохранить распределение» — записать их в игру. Если партия пока имеет 0 мандатов, потери сохранятся как план и начнут действовать после распределения мандатов. Текущие и последующие депутатские голосования учитывают уменьшенный вес.</p>
  <div className="ghostScenarioSummary"><span>Плановые потери: <b>{pendingLoss}</b></span><span>Фактические потери сейчас: <b>{parties.reduce((n,p)=>n+Math.min(p.mandates,Number(losses[p.id]??0)),0)}</b></span></div>
  <div className="ghostPartyList">{parties.length===0?<p>Партии ещё не созданы.</p>:parties.map(p=><label key={p.id} className="ghostPartyRow">
   <span className="ghostPartyMark" style={{background:p.color}}>{p.name.slice(0,2).toUpperCase()}</span><span className="ghostPartyName"><b>{p.name}</b><small>Мандатов: {p.mandates} · Сейчас потеряно: {p.ghost_loss_current}</small></span>
   <span className="ghostPartyInput">Потеря<input type="number" min="0" step="1" max={50} value={losses[p.id]??0} onChange={e=>setLosses(prev=>({...prev,[p.id]:Number(e.target.value)}))}/></span>
   <strong>{Math.max(0,p.mandates-Number(losses[p.id]??0))} доступно</strong>
  </label>)}</div>
  <footer><button type="button" onClick={()=>void clear()} disabled={busy||!parties.some(p=>p.ghost_active)}><RotateCcw size={16} aria-hidden="true"/> Снять ограничения</button><button type="button" onClick={()=>void save()} disabled={busy||!eligible.length}><Save size={16} aria-hidden="true"/>{busy?'Применение…':'Сохранить распределение'}</button></footer>
  {notice&&<p className="ghostNotice" role="status">{notice}</p>}
 </section>;
}
