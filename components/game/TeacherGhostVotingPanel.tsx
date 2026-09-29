'use client';
import {useEffect,useState} from 'react';
import {ShieldAlert,Save,RotateCcw} from 'lucide-react';
import type {ReturnTypeRepublic} from './viewTypes';
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
 const eligible=parties.filter(p=>p.mandates>0);
 function distribute(){
  const n=Number(uniform);
  if(!Number.isInteger(n)||n<0||n>50){setNotice('Укажите целое число от 0 до 50.');return}
  setLosses(prev=>({...prev,...Object.fromEntries(target.map(p=>[p.id,Math.min(n,p.mandates)]))}));
  setNotice('');
 }
 async function save(){
  if(!teacher||busy)return;
  const values=parties.filter(p=>p.mandates>0).map(p=>({party_id:p.id,loss:Number(losses[p.id]??0)}));
  if(!values.length){setNotice('Сначала назначьте мандаты партиям.');return}
  if(values.some((v,i)=>!Number.isInteger(v.loss)||v.loss<0||v.loss>Math.min(50,parties.filter(p=>p.mandates>0)[i].mandates))){
   setNotice('Число потерянных мандатов должно быть целым и не превышать 50 или численность фракции.');return
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
  <header><div><small>НАСТРОЙКА СЦЕНАРИЯ</small><h2>Ghost Voting · распределение потерь</h2><p>Настройте отдельно каждую фракцию или назначьте одинаковое число всем. Ограничение — не более 50 мандатов и не более размера фракции.</p></div><ShieldAlert size={24} aria-hidden="true"/></header>
  <div className="ghostBulk"><label>Применить к<select value={scope} onChange={e=>setScope(e.target.value as 'all'|'selected')}><option value="selected">Одной партии</option><option value="all">Всем партиям</option></select></label>
   {scope==='selected'&&<label>Партия<select value={chosen} onChange={e=>setChosen(e.target.value)}>{parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
   <label>Потеря мандатов<input type="number" min="0" max="50" step="1" value={uniform} onChange={e=>setUniform(e.target.value)}/></label>
   <button type="button" onClick={distribute}>Распределить</button>
  </div>
  <div className="ghostPartyList">{parties.length===0?<p>Партии ещё не созданы.</p>:parties.map(p=><label key={p.id} className="ghostPartyRow">
   <span className="ghostPartyMark" style={{background:p.color}}>{p.name.slice(0,2).toUpperCase()}</span><span className="ghostPartyName"><b>{p.name}</b><small>Мандатов: {p.mandates} · Сейчас потеряно: {p.ghost_loss_current}</small></span>
   <span className="ghostPartyInput">Потеря<input type="number" min="0" step="1" max={Math.min(50,p.mandates)} disabled={!p.mandates} value={losses[p.id]??0} onChange={e=>setLosses(prev=>({...prev,[p.id]:Number(e.target.value)}))}/></span>
   <strong>{Math.max(0,p.mandates-Number(losses[p.id]??0))} доступно</strong>
  </label>)}</div>
  <footer><button type="button" onClick={()=>void clear()} disabled={busy||!parties.some(p=>p.ghost_active)}><RotateCcw size={16} aria-hidden="true"/> Снять ограничения</button><button type="button" onClick={()=>void save()} disabled={busy||!eligible.length}><Save size={16} aria-hidden="true"/>{busy?'Применение…':'Сохранить распределение'}</button></footer>
  {notice&&<p className="ghostNotice" role="status">{notice}</p>}
 </section>;
}
