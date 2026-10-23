'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import type {ReturnTypeRepublic} from './viewTypes';
import styles from './LegislativeSessionLab.module.css';

export default function Stage12SpeakerOrder({g,item,documentAuthor,reading,canChair,locked,onSaved}:{
 g:ReturnTypeRepublic;item:{id:string;agenda_no:number;speaker_order?:string[]|null};
 documentAuthor?:string|null;reading:number;canChair:boolean;locked:boolean;onSaved:()=>Promise<void>
}){
 const members=g.members.filter(member=>member.kind!=='observer'&&!member.roster_archived_at);
 const suggested=documentAuthor&&members.some(m=>m.user_id===documentAuthor)&&reading===1?[documentAuthor]:[];
 const persisted=item.speaker_order||[];
 const [order,setOrder]=useState<string[]>(persisted.length?persisted:suggested);
 const [candidate,setCandidate]=useState('');
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 useEffect(()=>{setOrder(persisted.length?persisted:suggested);setMessage('')},[item.id,item.speaker_order?.join(','),documentAuthor,reading]);
 const name=(id:string)=>members.find(m=>m.user_id===id)?.full_name||'Участник больше не доступен';
 const phases=reading===1?['Доклад инициатора — до 3 минут','Содоклад профильного комитета','Вопросы депутатов — до 20 минут','Прения и заключительные выступления']:
 reading===2?['Доклад профильного комитета — до 7 минут','Выступления по таблице поправок','Обсуждение и голосование по поправкам']:
 ['Доклад профильного комитета — до 3 минут','Выступления по мотивам голосования','Голосование за закон в целом'];
 function move(index:number,delta:number){setOrder(current=>{const next=[...current],other=index+delta;if(other<0||other>=next.length)return current;[next[index],next[other]]=[next[other],next[index]];return next})}
 async function save(){
  if(busy||locked||!canChair)return;
  setBusy(true);setMessage('');
  const result=await supabase.rpc('set_stage12_speaker_order',{p_item_id:item.id,p_speakers:order});
  if(result.error){g.setError(userError(result.error));setMessage('Не удалось сохранить очерёдность. Проверьте полномочия и регистрацию.')}
  else {setMessage('Очередность выступающих сохранена.');await onSaved()}
  setBusy(false);
 }
 return <div className={styles.speakerOrderItem}>
  <b>Вопрос № {item.agenda_no}</b>
  <p>Установленная процедура: {phases.join(' → ')}.</p>
  <ol className={styles.speakerOrderList}>{order.map((id,index)=><li key={id}>
   <span>{index+1}. {name(id)}</span>
   {canChair&&!locked&&<div className={styles.speakerOrderButtons}>
    <button type="button" className="secondary" aria-label={'Переместить '+name(id)+' выше'} disabled={busy||index===0} onClick={()=>move(index,-1)}>↑</button>
    <button type="button" className="secondary" aria-label={'Переместить '+name(id)+' ниже'} disabled={busy||index===order.length-1} onClick={()=>move(index,1)}>↓</button>
    <button type="button" className="secondary" aria-label={'Убрать '+name(id)+' из очереди'} disabled={busy} onClick={()=>setOrder(old=>old.filter(x=>x!==id))}>×</button>
   </div>}
  </li>)}</ol>
  {order.length===0&&<p>Выступающие ещё не назначены. Регламентная последовательность сформирована автоматически, персональный состав уточняет председательствующий.</p>}
  {canChair&&!locked&&<div className={styles.speakerOrderEditor}>
   <label>Добавить выступающего
    <select value={candidate} onChange={event=>setCandidate(event.target.value)}>
     <option value="">Выберите участника</option>
     {members.filter(member=>!order.includes(member.user_id)).map(member=><option key={member.user_id} value={member.user_id}>{member.full_name}</option>)}
    </select>
   </label>
   <button type="button" className="secondary" disabled={!candidate||busy||order.length>=40} onClick={()=>{setOrder(v=>[...v,candidate]);setCandidate('')}}>Добавить</button>
   <button type="button" className="primary" disabled={busy||order.join(',')===persisted.join(',')} onClick={()=>void save()}>Сохранить очерёдность</button>
  </div>}
  {message&&<p role="status">{message}</p>}
 </div>;
}
