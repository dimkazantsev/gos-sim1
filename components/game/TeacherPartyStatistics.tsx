'use client';
import {useEffect,useState} from 'react';
import {PencilLine,Save,X} from 'lucide-react';
import type {Party} from './types';
import type {ReturnTypeRepublic} from './viewTypes';
import styles from './TeacherPartyStatistics.module.css';

type Values={rating:number|null;support:number;mandates:number};
const valuesOf=(party:Party):Values=>({
 rating:party.rating??null,support:party.support,mandates:party.mandates
});

export default function TeacherPartyStatistics({g,party,invitations}:{g:ReturnTypeRepublic;party:Party;invitations:number}){
 const [editing,setEditing]=useState(false);
 const [busy,setBusy]=useState(false);
 const [base,setBase]=useState<Values>(()=>valuesOf(party));
 const [rating,setRating]=useState(party.rating===null||party.rating===undefined?'':String(party.rating));
 const [support,setSupport]=useState(String(party.support));
 const [mandates,setMandates]=useState(String(party.mandates));
 const [notice,setNotice]=useState('');
 const [failure,setFailure]=useState(false);
 useEffect(()=>{
  if(editing)return;
  setRating(party.rating===null||party.rating===undefined?'':String(party.rating));
  setSupport(String(party.support));
  setMandates(String(party.mandates));
 },[editing,party.id,party.rating,party.support,party.mandates]);
 const next:Values={
  rating:rating.trim()===''?null:Number(rating),
  support:Number(support),
  mandates:Number(mandates)
 };
 const valid=(
  (next.rating===null||(Number.isFinite(next.rating)&&next.rating>=0&&next.rating<=100))&&
  support.trim()!==''&&Number.isFinite(next.support)&&next.support>=0&&next.support<=100&&
  mandates.trim()!==''&&Number.isInteger(next.mandates)&&next.mandates>=0&&next.mandates<=450
 );
 const changed=next.rating!==base.rating||next.support!==base.support||next.mandates!==base.mandates;
 const outdated=editing&&(party.rating??null)!==base.rating||editing&&(party.support!==base.support||party.mandates!==base.mandates);
 function start(){
  const current=valuesOf(party);
  setBase(current);
  setRating(current.rating===null?'':String(current.rating));
  setSupport(String(current.support));
  setMandates(String(current.mandates));
  setNotice('');setFailure(false);setEditing(true);
 }
 function cancel(){setEditing(false);setNotice('');setFailure(false)}
 async function save(){
  if(!g.teacher||!valid||busy||!changed||outdated)return;
  setBusy(true);setNotice('');setFailure(false);
  try{
   let reason='Не удалось сохранить показатели. Повторите попытку.';
   const ok=await g.updatePartyStatistics(party.id,next,base,message=>{reason=message});
   if(ok){
    setNotice('Показатели партии сохранены.');
    setEditing(false);
   }else{
    setNotice(reason);
    setFailure(true);
   }
  }catch{
   setNotice('Не удалось сохранить показатели. Повторите попытку.');
   setFailure(true);
  }finally{setBusy(false)}
 }
 if(!g.teacher)return null;
 return <div className={styles.wrap} aria-label={'Показатели партии '+party.name}>
  <div className={styles.grid}>
   <label className={styles.metric}>
    <span>Рейтинг, %</span>
    {editing?<input type="number" min="0" max="100" step="0.1" value={rating} onChange={e=>setRating(e.target.value)} disabled={busy} placeholder="Не задан" aria-label={'Рейтинг партии '+party.name}/>:
     <strong>{party.rating??'—'}</strong>}
   </label>
   <label className={styles.metric}>
    <span>Поддержка, %</span>
    {editing?<input type="number" min="0" max="100" step="0.1" value={support} onChange={e=>setSupport(e.target.value)} disabled={busy} aria-label={'Поддержка партии '+party.name}/>:
     <strong>{party.support}</strong>}
   </label>
   <label className={styles.metric}>
    <span>Мандаты</span>
    {editing?<input type="number" min="0" max="450" step="1" value={mandates} onChange={e=>setMandates(e.target.value)} disabled={busy} aria-label={'Мандаты партии '+party.name}/>:
     <strong>{party.mandates}</strong>}
   </label>
   <div className={styles.metric}><span>Регионов</span><strong>{party.regions}</strong></div>
   <div className={styles.metric}><span>Бюджет</span><strong>{party.budget}</strong></div>
   <div className={styles.metric}><span>Приглашений</span><strong>{invitations}</strong></div>
  </div>
  {editing?<>
   {outdated&&<p role="alert" className={styles.error}>Показатели изменились в другой сессии. Отмените редактирование и откройте его заново.</p>}
   <div className={styles.actions}>
    <button type="button" className="primary" disabled={!valid||!changed||busy||outdated} onClick={()=>void save()}><Save size={15} aria-hidden="true"/>{busy?'Сохранение…':'Сохранить показатели'}</button>
    <button type="button" className="secondary" disabled={busy} onClick={cancel}><X size={15} aria-hidden="true"/>Отмена</button>
   </div>
   <small className={styles.hint}>Мандаты: не более 450 суммарно у всех фракций. Изменение недоступно во время открытого голосования Государственной Думы.</small>
  </>:<div className={styles.actions}><button type="button" className="secondary" onClick={start}><PencilLine size={15} aria-hidden="true"/>Изменить рейтинг и показатели</button></div>}
  {notice&&<p role={failure?'alert':'status'} className={failure?styles.error:styles.success}>{notice}</p>}
 </div>;
}
